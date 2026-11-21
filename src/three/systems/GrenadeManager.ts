import * as THREE from 'three';
import type { EventBus } from '../../core/EventBus';
import type { GameSession } from '../../core/GameSession';
import { WEAPONS } from '../../data/weapons';
import type { CameraRig } from '../CameraRig';
import type { Zombie } from '../entities/Zombie';
import type { EffectsSystem } from './EffectsSystem';
import type { ScoreSystem } from './ScoreSystem';

interface ActiveGrenade {
  mesh: THREE.Group;
  ledMat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  fuseSec: number;
  bounces: number;
  ageSec: number;
}

export class GrenadeManager {
  private grenades: ActiveGrenade[] = [];
  private readonly bodyGeo = new THREE.SphereGeometry(0.11, 10, 8);
  private readonly bodyMat = new THREE.MeshStandardMaterial({
    color: 0x3b4d32,
    roughness: 0.6,
    metalness: 0.35,
  });
  private readonly ledGeo = new THREE.SphereGeometry(0.035, 6, 6);

  public throwGrenade(
    scene: THREE.Scene,
    origin: THREE.Vector3,
    forwardDir: THREE.Vector3
  ): void {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const led = new THREE.Mesh(this.ledGeo, ledMat);
    led.position.y = 0.11;
    group.add(body, led);
    group.position.copy(origin);
    scene.add(group);

    const vel = forwardDir.clone().normalize().multiplyScalar(18.5);
    vel.y += 5.2;

    this.grenades.push({
      mesh: group,
      ledMat,
      vel,
      fuseSec: WEAPONS.grenade.fuseSec ?? 1.15,
      bounces: 0,
      ageSec: 0,
    });
  }

  public update(
    dtSec: number,
    scene: THREE.Scene,
    zombies: Zombie[],
    session: GameSession,
    cameraRig: CameraRig,
    effects: EffectsSystem,
    scoreSystem: ScoreSystem,
    events: EventBus,
    callbacks: {
      onExplosion: () => void;
      onZombieDeath: () => void;
      onBossDeath?: (boss: Zombie) => void;
      onBossPhaseChanged?: (phase: 1 | 2, shielded: boolean, transitionStarted?: boolean) => void;
    }
  ): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.ageSec += dtSec;
      g.fuseSec -= dtSec;

      // Gravity + ground bounce
      g.vel.y -= 16.5 * dtSec;
      g.mesh.position.addScaledVector(g.vel, dtSec);
      g.mesh.rotation.x += dtSec * 10;
      g.mesh.rotation.z += dtSec * 7;

      // Blinking fuse indicator
      const blinkOn = Math.sin(g.ageSec * 28) > 0;
      g.ledMat.color.setHex(blinkOn ? 0xff3b3b : 0x450a0a);

      if (g.mesh.position.y <= 0.14) {
        g.mesh.position.y = 0.14;
        if (g.bounces < 2) {
          g.vel.y = Math.abs(g.vel.y) * 0.42;
          g.vel.x *= 0.58;
          g.vel.z *= 0.58;
          g.bounces++;
        } else {
          g.vel.set(0, 0, 0);
        }
      }

      // Direct proximity trigger against living zombies
      let directHit = false;
      for (const z of zombies) {
        if (z.state === 'dead') continue;
        const targetY = z.variant === 'crawler' ? 0.38 : 1.0;
        const d = g.mesh.position.distanceTo(
          new THREE.Vector3(z.root.position.x, z.root.position.y + targetY, z.root.position.z)
        );
        if (d < (z.variant === 'boss' ? 1.85 : 0.95)) {
          directHit = true;
          break;
        }
      }

      if (g.fuseSec <= 0 || directHit) {
        const blastPos = g.mesh.position.clone();
        this.removeGrenade(scene, i);
        this.detonateAt(
          blastPos,
          WEAPONS.grenade.damage,
          WEAPONS.grenade.explosionRadius ?? 6.8,
          'grenade',
          scene,
          zombies,
          session,
          cameraRig,
          effects,
          scoreSystem,
          events,
          callbacks
        );
      }
    }
  }

  public detonateAt(
    center: THREE.Vector3,
    baseDamage: number,
    radius: number,
    source: 'grenade' | 'blast',
    scene: THREE.Scene,
    zombies: Zombie[],
    session: GameSession,
    cameraRig: CameraRig,
    effects: EffectsSystem,
    scoreSystem: ScoreSystem,
    events: EventBus,
    callbacks: {
      onExplosion: () => void;
      onZombieDeath: () => void;
      onBossDeath?: (boss: Zombie) => void;
      onBossPhaseChanged?: (phase: 1 | 2, shielded: boolean, transitionStarted?: boolean) => void;
    },
    excludeZombie?: Zombie
  ): void {
    effects.spawnExplosion(scene, center, radius);
    cameraRig.triggerImpactShake('high');
    callbacks.onExplosion();

    let kills = 0;
    for (const z of zombies) {
      if (z.state === 'dead' || z === excludeZombie) continue;
      const dist = Math.hypot(
        z.root.position.x - center.x,
        z.root.position.z - center.z
      );
      if (dist > radius) continue;

      const falloff = Math.max(0.32, 1 - (dist / radius) * 0.65);
      const dmgRes = z.applyDamage(
        baseDamage * falloff,
        source,
        false,
        callbacks.onBossPhaseChanged
      );

      if (dmgRes.finalDamage > 0) {
        scoreSystem.awardHit(session, false);
        events.emit('zombie:hit', {
          zombieId: z.id,
          damage: dmgRes.finalDamage,
          remainingHp: z.health,
          headshot: false,
          effectiveness: dmgRes.effectiveness,
          clampedByFireRule: dmgRes.clampedByFireRule,
        });
      }

      if (dmgRes.killed) {
        kills++;
        const awarded = scoreSystem.awardKill(session, z.variant, false);
        if (z.variant === 'boss' && callbacks.onBossDeath) {
          callbacks.onBossDeath(z);
        } else {
          callbacks.onZombieDeath();
        }
        events.emit('zombie:killed', {
          zombieId: z.id,
          variant: z.variant,
          scoreAwarded: awarded,
        });
      }
    }

    if (source === 'grenade') {
      events.emit('grenade:exploded', {
        x: center.x,
        y: center.y,
        z: center.z,
        kills,
      });
    }
  }

  private removeGrenade(scene: THREE.Scene, index: number): void {
    const g = this.grenades[index];
    scene.remove(g.mesh);
    g.ledMat.dispose();
    this.grenades.splice(index, 1);
  }

  public clear(scene: THREE.Scene): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      this.removeGrenade(scene, i);
    }
  }

  public dispose(scene: THREE.Scene): void {
    this.clear(scene);
    this.bodyGeo.dispose();
    this.bodyMat.dispose();
    this.ledGeo.dispose();
  }
}
