import * as THREE from 'three';
import type { EventBus } from '../../core/EventBus';
import type { GameSession } from '../../core/GameSession';
import { DEFAULT_GAME_CONFIG } from '../../data/gameConfig';
import type { WeaponId } from '../../data/weapons';
import type { PlayerInputState } from '../../input/PlayerInput';
import type { CameraRig } from '../CameraRig';
import type { Weapon } from '../entities/Weapon';
import type { Zombie } from '../entities/Zombie';
import { BOSS_PHASE2_CONFIG } from '../../data/zombies';
import type { EffectsSystem } from './EffectsSystem';
import type { GrenadeManager } from './GrenadeManager';
import type { RaycastSystem } from './RaycastSystem';
import type { ScoreSystem } from './ScoreSystem';
import type { ReloadAudioPhase, WeaponManager } from './WeaponManager';

interface BossBioProjectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  damage: number;
  lifeSec: number;
  kind: 'orb' | 'spike' | 'shockwave';
}

export interface CombatCallbacks {
  onArFire: () => void;
  onSmgFire: () => void;
  onFlameBurst: () => void;
  onGrenadeThrow: () => void;
  onExplosion: () => void;
  onEmptyClick: () => void;
  onReloadStart: () => void;
  onReloadPhase: (weaponId: WeaponId, phase: ReloadAudioPhase) => void;
  onReloadComplete: () => void;
  onZombieHit: () => void;
  onZombieImpact?: (zombie: Zombie, headshot: boolean, effectiveness: 'weak' | 'normal' | 'resisted') => void;
  onZombieDeath: () => void;
  onZombieAttack: () => void;
  onZombieGroan: (zombie: Zombie) => void;
  onBossRoar: () => void;
  onBossHit: () => void;
  onBossDeath: (boss: Zombie) => void;
  onBossPhaseChanged?: (phase: 1 | 2, shielded: boolean, transitionStarted?: boolean) => void;
  onBossShockwave?: () => void;
  onBossTendril?: () => void;
  onBossJumpPrep?: () => void;
  onBossJumpLaunch?: () => void;
  onBossJumpLand?: () => void;
}

export class CombatSystem {
  private groanCooldownTimer = 2.0;
  private bossProjectiles: BossBioProjectile[] = [];
  private readonly orbGeo = new THREE.DodecahedronGeometry(0.24);
  private readonly orbMat = new THREE.MeshBasicMaterial({ color: 0x84cc16 });
  private readonly spikeGeo = new THREE.ConeGeometry(0.16, 0.72, 5);
  private readonly spikeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  private readonly waveGeo = new THREE.BoxGeometry(2.6, 0.42, 0.52);
  private readonly waveMat = new THREE.MeshBasicMaterial({ color: 0xdc2626 });

  private readonly _tracerStart = new THREE.Vector3();
  private readonly _tracerEnd = new THREE.Vector3();
  private readonly _rayDir = new THREE.Vector3();
  private readonly _ndc = new THREE.Vector2();
  private readonly _playerPos = new THREE.Vector3(0, 0, 0);

  public reset(scene?: THREE.Scene): void {
    this.groanCooldownTimer = 1.8;
    if (scene) {
      this.clearProjectiles(scene);
    }
  }

  public clearProjectiles(scene: THREE.Scene): void {
    for (const p of this.bossProjectiles) {
      scene.remove(p.mesh);
    }
    this.bossProjectiles = [];
  }

  public update(
    dtSec: number,
    input: PlayerInputState,
    transitionLocked: boolean,
    session: GameSession,
    zombies: Zombie[],
    scene: THREE.Scene,
    cameraRig: CameraRig,
    weapon: Weapon,
    weaponManager: WeaponManager,
    grenadeManager: GrenadeManager,
    raycastSystem: RaycastSystem,
    effectsSystem: EffectsSystem,
    scoreSystem: ScoreSystem,
    events: EventBus,
    callbacks: CombatCallbacks,
    chaseOptions?: {
      bossSpeedOverride?: number;
      bossJumpTargetOverride?: THREE.Vector3;
      bossExternalMoveHandled?: boolean;
      bossAllowAutoJump?: boolean;
    }
  ): void {
    cameraRig.getPlayerFeetPosition(this._playerPos);
    weaponManager.update(dtSec, callbacks.onReloadComplete, callbacks.onReloadPhase);

    const activeId = weaponManager.getActiveWeaponId();
    const activeSlot = weaponManager.getSlot(activeId);

    if (!transitionLocked) {
      if (
        input.reloadTriggered &&
        activeId !== 'grenade' &&
        activeSlot.ammo < activeSlot.magazineSize
      ) {
        weaponManager.startReload(callbacks.onReloadStart);
      }

      if (input.fireHeld) {
        if (activeSlot.cooldownRemainingMs <= 0 && !activeSlot.isReloading) {
          if (activeSlot.ammo <= 0) {
            if (activeId !== 'grenade') {
              callbacks.onEmptyClick();
              events.emit('shot:empty', { weaponId: activeId });
              weaponManager.startReload(callbacks.onReloadStart);
            } else {
              callbacks.onEmptyClick();
              events.emit('shot:empty', { weaponId: 'grenade' });
            }
          } else {
            this.executeWeaponFire(
              input.aimX,
              input.aimY,
              session,
              zombies,
              scene,
              cameraRig,
              weapon,
              weaponManager,
              grenadeManager,
              raycastSystem,
              effectsSystem,
              scoreSystem,
              events,
              callbacks
            );
          }
        }
      }
    }

    // Update flying frag grenades
    grenadeManager.update(
      dtSec,
      scene,
      zombies,
      session,
      cameraRig,
      effectsSystem,
      scoreSystem,
      events,
      {
        onExplosion: callbacks.onExplosion,
        onZombieDeath: callbacks.onZombieDeath,
        onBossDeath: callbacks.onBossDeath,
        onBossPhaseChanged: (phase, shielded, transitionStarted) => {
          events.emit('boss:phase_changed', { phase, shielded, transitionStarted });
          callbacks.onBossPhaseChanged?.(phase, shielded, transitionStarted);
          if (!transitionStarted && shielded) {
            callbacks.onBossRoar();
          }
        },
      }
    );

    // Update Boss bio-projectiles
    for (let i = this.bossProjectiles.length - 1; i >= 0; i--) {
      const bp = this.bossProjectiles[i];
      bp.lifeSec -= dtSec;
      bp.mesh.position.addScaledVector(bp.vel, dtSec);
      if (bp.kind === 'orb') {
        bp.mesh.rotation.y += dtSec * 8;
      } else if (bp.kind === 'shockwave') {
        bp.mesh.scale.x = 1 + Math.sin(bp.lifeSec * 14) * 0.08;
      }
      const distToPlayer = Math.hypot(
        bp.mesh.position.x - this._playerPos.x,
        bp.mesh.position.z - this._playerPos.z
      );
      if (distToPlayer <= 1.35 || bp.lifeSec <= 0) {
        if (distToPlayer <= 1.35 && !transitionLocked) {
          session.health = Math.max(0, session.health - bp.damage);
          cameraRig.triggerImpactShake('medium');
          callbacks.onZombieAttack();
          events.emit('player:damaged', {
            amount: bp.damage,
            health: session.health,
            maxHealth: session.maxHealth,
          });
        }
        scene.remove(bp.mesh);
        this.bossProjectiles.splice(i, 1);
      }
    }

    // Update zombies AI
    this.groanCooldownTimer -= dtSec;
    const aliveZombies = zombies.filter((z) => z.state !== 'dead');
    if (this.groanCooldownTimer <= 0 && aliveZombies.length > 0 && !transitionLocked) {
      this.groanCooldownTimer = 2.4 + Math.random() * 2.8;
      const speaker = aliveZombies[Math.floor(Math.random() * aliveZombies.length)];
      callbacks.onZombieGroan(speaker);
    }

    const attackCooldownSec = DEFAULT_GAME_CONFIG.zombieAttackCooldownMs / 1000;
    let bossZombie: Zombie | null = null;

    for (let i = zombies.length - 1; i >= 0; i--) {
      const z = zombies[i];
      if (z.variant === 'boss') {
        bossZombie = z;
      }

      if (!transitionLocked) {
        z.update(
          dtSec,
          this._playerPos,
          DEFAULT_GAME_CONFIG.zombieAttackDistance,
          attackCooldownSec,
          {
            onAttackHit: (damage) => {
              session.health = Math.max(0, session.health - damage);
              cameraRig.triggerImpactShake(
                z.variant === 'boss' ? 'high' : z.variant === 'crawler' ? 'low' : 'medium'
              );
              callbacks.onZombieAttack();
              events.emit('player:damaged', {
                amount: damage,
                health: session.health,
                maxHealth: session.maxHealth,
              });
            },
            onExploderDetonate: (pos, src) => {
              grenadeManager.detonateAt(
                pos,
                95,
                5.8,
                'blast',
                scene,
                zombies,
                session,
                cameraRig,
                effectsSystem,
                scoreSystem,
                events,
                {
                  onExplosion: callbacks.onExplosion,
                  onZombieDeath: callbacks.onZombieDeath,
                },
                src
              );
              const playerDist = Math.hypot(
                pos.x - this._playerPos.x,
                pos.z - this._playerPos.z
              );
              if (playerDist <= 5.6) {
                const pDmg = Math.round(32 * (1 - playerDist / 7.5));
                session.health = Math.max(0, session.health - pDmg);
                cameraRig.triggerImpactShake('high');
                events.emit('player:damaged', {
                  amount: pDmg,
                  health: session.health,
                  maxHealth: session.maxHealth,
                });
              }
            },
            onBurnTickDamage: (burnedZombie, damage, killed) => {
              if (damage > 0) {
                events.emit('zombie:hit', {
                  zombieId: burnedZombie.id,
                  damage,
                  remainingHp: burnedZombie.health,
                  headshot: false,
                  effectiveness: 'weak',
                  clampedByFireRule: false,
                });
              }
              if (killed) {
                const awarded = scoreSystem.awardKill(session, burnedZombie.variant, false);
                if (burnedZombie.variant === 'boss') {
                  callbacks.onBossDeath(burnedZombie);
                } else {
                  callbacks.onZombieDeath();
                }
                events.emit('zombie:killed', {
                  zombieId: burnedZombie.id,
                  variant: burnedZombie.variant,
                  scoreAwarded: awarded,
                });
              }
            },
            onBossPhaseChanged: (phase, shielded, transitionStarted) => {
              events.emit('boss:phase_changed', { phase, shielded, transitionStarted });
              callbacks.onBossPhaseChanged?.(phase, shielded, transitionStarted);
            },
            onBossTelegraph: (attackName) => {
              callbacks.onBossRoar();
              events.emit('boss:telegraph', { attackName });
            },
            onBossSlamHit: (damage, center) => {
              effectsSystem.spawnExplosion(scene, center, 4.5);
              cameraRig.triggerImpactShake('very_high');
              const dist = Math.hypot(
                center.x - this._playerPos.x,
                center.z - this._playerPos.z
              );
              if (dist < 13) {
                session.health = Math.max(0, session.health - damage);
                events.emit('player:damaged', {
                  amount: damage,
                  health: session.health,
                  maxHealth: session.maxHealth,
                });
              }
            },
            onBossJumpPrep: () => {
              callbacks.onBossJumpPrep?.();
            },
            onBossJumpLaunch: () => {
              callbacks.onBossJumpLaunch?.();
            },
            onBossJumpLand: (damage, center) => {
              effectsSystem.spawnBossLandingDebris(
                scene,
                center,
                BOSS_PHASE2_CONFIG.jumpImpactRadius
              );
              callbacks.onBossJumpLand?.();
              const dist = Math.hypot(
                center.x - this._playerPos.x,
                center.z - this._playerPos.z
              );
              cameraRig.triggerImpactShake(dist <= 9.5 ? 'very_high' : 'high');
              if (dist <= BOSS_PHASE2_CONFIG.jumpImpactRadius) {
                session.health = Math.max(0, session.health - damage);
                events.emit('player:damaged', {
                  amount: damage,
                  health: session.health,
                  maxHealth: session.maxHealth,
                });
              }
            },
            onBossProjectile: (origin, damage) => {
              const mesh = new THREE.Mesh(this.orbGeo, this.orbMat);
              mesh.position.copy(origin);
              scene.add(mesh);
              const target = new THREE.Vector3(this._playerPos.x, 1.45, this._playerPos.z);
              const vel = target.sub(origin).normalize().multiplyScalar(13.2);
              this.bossProjectiles.push({ mesh, vel, damage, lifeSec: 4.2, kind: 'orb' });
            },
            onBossShockwave: (origin, damage) => {
              callbacks.onBossShockwave?.();
              effectsSystem.spawnExplosion(scene, origin, 3.6);
              const mesh = new THREE.Mesh(this.waveGeo, this.waveMat);
              mesh.position.set(origin.x, 0.28, origin.z);
              scene.add(mesh);
              const target = new THREE.Vector3(this._playerPos.x, 0.28, this._playerPos.z);
              const vel = target.sub(origin).normalize().multiplyScalar(11.5);
              this.bossProjectiles.push({ mesh, vel, damage, lifeSec: 4.5, kind: 'shockwave' });
            },
            onBossTendrilAttack: (origin, damage, count) => {
              callbacks.onBossTendril?.();
              for (let c = 0; c < count; c++) {
                const mesh = new THREE.Mesh(this.spikeGeo, this.spikeMat);
                mesh.rotation.x = Math.PI / 2;
                const lateral = (c - (count - 1) * 0.5) * 0.6;
                mesh.position.copy(origin).add(new THREE.Vector3(lateral, 0, 0));
                scene.add(mesh);
                const target = new THREE.Vector3(
                  this._playerPos.x + lateral * 0.65,
                  1.42,
                  this._playerPos.z
                );
                const vel = target.sub(mesh.position).normalize().multiplyScalar(15.2);
                this.bossProjectiles.push({ mesh, vel, damage, lifeSec: 4.0, kind: 'spike' });
              }
            },
          },
          z.variant === 'boss' ? chaseOptions : undefined
        );
      }

      if (z.markedForRemoval) {
        z.dispose(scene);
        zombies.splice(i, 1);
      }
    }

    if (bossZombie) {
      session.bossActive =
        bossZombie.state !== 'dead' &&
        !bossZombie.cinematicControlled &&
        bossZombie.isBossDamageable();
      session.bossHealth = bossZombie.health;
      session.bossMaxHealth = bossZombie.maxHealth;
      session.bossPhase = bossZombie.bossPhase;
      session.bossSuperPhase = bossZombie.bossSuperPhase;
      session.bossName = 'THE KING · SUBJECT ALPHA';
      session.bossShielded = bossZombie.bossShielded;
    } else {
      session.bossActive = false;
    }

    session.activeZombieCount = zombies.filter((z) => z.state !== 'dead').length;
  }

  private executeWeaponFire(
    aimX: number,
    aimY: number,
    session: GameSession,
    zombies: Zombie[],
    scene: THREE.Scene,
    cameraRig: CameraRig,
    weapon: Weapon,
    weaponManager: WeaponManager,
    grenadeManager: GrenadeManager,
    raycastSystem: RaycastSystem,
    effectsSystem: EffectsSystem,
    scoreSystem: ScoreSystem,
    events: EventBus,
    callbacks: CombatCallbacks
  ): void {
    const weaponId = weaponManager.getActiveWeaponId();
    const def = weaponManager.getActiveDefinition();
    const consumed = weaponManager.consumeAmmo(callbacks.onReloadStart);
    if (!consumed) return;

    const slot = weaponManager.getSlot(weaponId);
    weapon.triggerFire(weaponId);

    events.emit('shot:fired', {
      weaponId,
      x: aimX,
      y: aimY,
      ammoRemaining: slot.ammo,
    });

    cameraRig.camera.updateMatrixWorld();
    this._tracerStart.set(0.18, -0.14, -0.52);
    cameraRig.camera.localToWorld(this._tracerStart);

    if (weaponId === 'grenade') {
      const ray = raycastSystem.getAimWorldRay(aimX, aimY, cameraRig.camera);
      grenadeManager.throwGrenade(scene, this._tracerStart, ray.dir);
      callbacks.onGrenadeThrow();
      events.emit('grenade:thrown', { remaining: slot.ammo });
      return;
    }

    if (weaponId === 'flamethrower') {
      const ray = raycastSystem.getAimWorldRay(aimX, aimY, cameraRig.camera);
      effectsSystem.spawnFlameStream(scene, this._tracerStart, ray.dir);
      callbacks.onFlameBurst();

      const flameHits = raycastSystem.castFlameCone(
        aimX,
        aimY,
        cameraRig.camera,
        zombies,
        def.effectiveRange
      );
      if (flameHits.length > 0) {
        session.shotsFired += 1;
        session.shotsHit += 1;
        for (const fh of flameHits) {
          fh.zombie.applyBurn(def.burnDps ?? 20, def.burnDurationSec ?? 3.5);
          const dmgRes = fh.zombie.applyDamage(
            def.damage,
            'flamethrower',
            false,
            (phase, shielded, transitionStarted) => {
              events.emit('boss:phase_changed', { phase, shielded, transitionStarted });
              callbacks.onBossPhaseChanged?.(phase, shielded, transitionStarted);
            }
          );
          if (dmgRes.finalDamage > 0) {
            scoreSystem.awardHit(session, false);
            events.emit('zombie:hit', {
              zombieId: fh.zombie.id,
              damage: dmgRes.finalDamage,
              remainingHp: fh.zombie.health,
              headshot: false,
              effectiveness: dmgRes.effectiveness,
              clampedByFireRule: dmgRes.clampedByFireRule,
            });
          }
          if (dmgRes.killed) {
            const awarded = scoreSystem.awardKill(session, fh.zombie.variant, false);
            if (fh.zombie.variant === 'boss') callbacks.onBossDeath(fh.zombie);
            else callbacks.onZombieDeath();
            events.emit('zombie:killed', {
              zombieId: fh.zombie.id,
              variant: fh.zombie.variant,
              scoreAwarded: awarded,
            });
          }
        }
      }
      return;
    }

    // Ballistic AR / SMG
    session.shotsFired += 1;
    cameraRig.triggerRecoil(weaponId === 'ar' ? 0.015 : 0.008);
    if (weaponId === 'ar') callbacks.onArFire();
    else callbacks.onSmgFire();

    // First check if player shot an incoming Boss Bio-Orb out of the sky
    const ray = raycastSystem.getAimWorldRay(aimX, aimY, cameraRig.camera);
    for (let i = this.bossProjectiles.length - 1; i >= 0; i--) {
      const bp = this.bossProjectiles[i];
      const closestPt = new THREE.Vector3();
      const lineRay = new THREE.Ray(ray.origin, ray.dir);
      lineRay.closestPointToPoint(bp.mesh.position, closestPt);
      const interceptRadius = bp.kind === 'shockwave' ? 1.15 : 0.6;
      if (closestPt.distanceTo(bp.mesh.position) < interceptRadius) {
        effectsSystem.spawnHitBurst(scene, bp.mesh.position, true, 'weak');
        effectsSystem.spawnTracer(
          scene,
          this._tracerStart,
          bp.mesh.position,
          bp.kind === 'orb' ? 0x84cc16 : 0xef4444
        );
        scene.remove(bp.mesh);
        this.bossProjectiles.splice(i, 1);
        scoreSystem.awardHit(session, true);
        return;
      }
    }

    const hit = raycastSystem.castShot(
      aimX,
      aimY,
      cameraRig.camera,
      zombies,
      def.effectiveRange
    );

    if (hit) {
      this._tracerEnd.copy(hit.point);
      effectsSystem.spawnTracer(
        scene,
        this._tracerStart,
        this._tracerEnd,
        weaponId === 'ar' ? 0xfbbf24 : 0x7dd3fc
      );

      const headshot = hit.zone === 'head';
      const baseDmg = headshot ? Math.round(def.damage * def.headshotMultiplier) : def.damage;

      session.shotsHit += 1;
      const dmgRes = hit.zombie.applyDamage(
        baseDmg,
        weaponId,
        headshot,
        (phase, shielded, transitionStarted) => {
          events.emit('boss:phase_changed', { phase, shielded, transitionStarted });
          callbacks.onBossPhaseChanged?.(phase, shielded, transitionStarted);
        }
      );

      effectsSystem.spawnHitBurst(
        scene,
        hit.point,
        headshot,
        dmgRes.effectiveness,
        hit.normal,
        true
      );
      if (dmgRes.finalDamage > 0) {
        scoreSystem.awardHit(session, headshot);
      }

      events.emit('zombie:hit', {
        zombieId: hit.zombie.id,
        damage: dmgRes.finalDamage,
        remainingHp: hit.zombie.health,
        headshot,
        effectiveness: dmgRes.effectiveness,
        clampedByFireRule: dmgRes.clampedByFireRule,
        zone: hit.zone,
      });

      callbacks.onZombieImpact?.(hit.zombie, headshot, dmgRes.effectiveness);

      if (dmgRes.killed) {
        const awarded = scoreSystem.awardKill(session, hit.zombie.variant, headshot);
        if (hit.zombie.variant === 'boss') callbacks.onBossDeath(hit.zombie);
        else callbacks.onZombieDeath();
        events.emit('zombie:killed', {
          zombieId: hit.zombie.id,
          variant: hit.zombie.variant,
          scoreAwarded: awarded,
        });
      } else if (hit.zombie.variant === 'boss') {
        callbacks.onBossHit();
      } else {
        callbacks.onZombieHit();
      }
    } else {
      this._tracerEnd.copy(ray.origin).addScaledVector(ray.dir, 45);
      effectsSystem.spawnTracer(scene, this._tracerStart, this._tracerEnd);
    }
  }

  public dispose(scene: THREE.Scene): void {
    this.clearProjectiles(scene);
    this.orbGeo.dispose();
    this.orbMat.dispose();
    this.spikeGeo.dispose();
    this.spikeMat.dispose();
    this.waveGeo.dispose();
    this.waveMat.dispose();
  }
}
