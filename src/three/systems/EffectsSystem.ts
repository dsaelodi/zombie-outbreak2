import * as THREE from 'three';

type ParticleKind = 'blood' | 'blood_dark' | 'spark' | 'resist' | 'flame_orange' | 'flame_yellow' | 'dust';

interface PooledParticle {
  active: boolean;
  kind: ParticleKind;
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  grow: boolean;
  baseScale: number;
}

interface TracerBeam {
  line: THREE.Line;
  life: number;
  maxLife: number;
}

interface ShockRing {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxRadius: number;
}

interface FloorBloodDecal {
  active: boolean;
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  targetScale: number;
}

const MAX_POOLED_PARTICLES = 180;
const MAX_BLOOD_DECALS = 26;

/**
 * Pooled VFX & Blood Particle Controller.
 * Pre-allocates reusable particle meshes and floor blood splatters so rapid combat
 * produces zero per-hit mesh allocations or unbounded scene graph growth.
 */
export class EffectsSystem {
  private readonly particlePool: PooledParticle[] = [];
  private poolCursor = 0;

  private readonly decalPool: FloorBloodDecal[] = [];
  private decalCursor = 0;

  private tracers: TracerBeam[] = [];
  private rings: ShockRing[] = [];

  private readonly particleGeo = new THREE.BoxGeometry(0.065, 0.065, 0.065);
  private readonly flameGeo = new THREE.DodecahedronGeometry(0.14);
  private readonly ringGeo = new THREE.RingGeometry(0.45, 0.72, 24);
  private readonly decalGeo = new THREE.CircleGeometry(0.5, 10);

  private readonly bloodMat = new THREE.MeshBasicMaterial({ color: 0x991b1b });
  private readonly darkBloodMat = new THREE.MeshBasicMaterial({ color: 0x4c0519 });
  private readonly sparkMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
  private readonly resistMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
  private readonly dustMat = new THREE.MeshBasicMaterial({
    color: 0x9ca3af,
    transparent: true,
    opacity: 0.7,
  });
  private readonly flameOrangeMat = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.85,
  });
  private readonly flameYellowMat = new THREE.MeshBasicMaterial({
    color: 0xfde047,
    transparent: true,
    opacity: 0.9,
  });

  private initializedPool = false;

  private ensurePool(scene: THREE.Scene): void {
    if (this.initializedPool) return;
    this.initializedPool = true;

    for (let i = 0; i < MAX_POOLED_PARTICLES; i++) {
      const mesh = new THREE.Mesh(this.particleGeo, this.bloodMat);
      mesh.visible = false;
      scene.add(mesh);
      this.particlePool.push({
        active: false,
        kind: 'blood',
        mesh,
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 0.4,
        gravity: 9.8,
        grow: false,
        baseScale: 1,
      });
    }

    for (let i = 0; i < MAX_BLOOD_DECALS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x5c0a0a,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const mesh = new THREE.Mesh(this.decalGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.decalPool.push({
        active: false,
        mesh,
        life: 0,
        maxLife: 12,
        targetScale: 1,
      });
    }
  }

  private getMaterialForKind(kind: ParticleKind): THREE.Material {
    switch (kind) {
      case 'blood':
        return this.bloodMat;
      case 'blood_dark':
        return this.darkBloodMat;
      case 'spark':
        return this.sparkMat;
      case 'resist':
        return this.resistMat;
      case 'dust':
        return this.dustMat;
      case 'flame_orange':
        return this.flameOrangeMat;
      case 'flame_yellow':
        return this.flameYellowMat;
    }
  }

  private acquireParticle(scene: THREE.Scene): PooledParticle {
    this.ensurePool(scene);
    // Prefer inactive slot first; fall back to ring-buffer overwrite if saturated
    for (let offset = 0; offset < MAX_POOLED_PARTICLES; offset++) {
      const idx = (this.poolCursor + offset) % MAX_POOLED_PARTICLES;
      if (!this.particlePool[idx].active) {
        this.poolCursor = (idx + 1) % MAX_POOLED_PARTICLES;
        return this.particlePool[idx];
      }
    }
    const p = this.particlePool[this.poolCursor];
    this.poolCursor = (this.poolCursor + 1) % MAX_POOLED_PARTICLES;
    return p;
  }

  private spawnPooledParticle(
    scene: THREE.Scene,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    kind: ParticleKind,
    life: number,
    gravity: number,
    grow = false,
    baseScale = 1
  ): void {
    const p = this.acquireParticle(scene);
    p.active = true;
    p.kind = kind;
    p.vel.copy(vel);
    p.life = life;
    p.maxLife = life;
    p.gravity = gravity;
    p.grow = grow;
    p.baseScale = baseScale;

    const targetGeo =
      kind === 'flame_orange' || kind === 'flame_yellow' ? this.flameGeo : this.particleGeo;
    if (p.mesh.geometry !== targetGeo) {
      p.mesh.geometry = targetGeo;
    }
    p.mesh.material = this.getMaterialForKind(kind);
    p.mesh.position.copy(pos);
    p.mesh.scale.setScalar(baseScale);
    if (!p.mesh.parent) scene.add(p.mesh);
    p.mesh.visible = true;
  }

  public spawnFloorBloodDecal(
    scene: THREE.Scene,
    x: number,
    z: number,
    size = 0.85
  ): void {
    this.ensurePool(scene);
    const decal = this.decalPool[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % MAX_BLOOD_DECALS;

    decal.active = true;
    decal.life = 11.0;
    decal.maxLife = 11.0;
    decal.targetScale = size * (0.85 + Math.random() * 0.45);
    decal.mesh.position.set(x + (Math.random() - 0.5) * 0.35, 0.022, z + (Math.random() - 0.5) * 0.35);
    decal.mesh.rotation.z = Math.random() * Math.PI * 2;
    decal.mesh.scale.set(decal.targetScale, decal.targetScale * (0.75 + Math.random() * 0.4), 1);
    (decal.mesh.material as THREE.MeshBasicMaterial).opacity = 0.72;
    if (!decal.mesh.parent) scene.add(decal.mesh);
    decal.mesh.visible = true;
  }

  public spawnHitBurst(
    scene: THREE.Scene,
    point: THREE.Vector3,
    isHeadshot: boolean,
    style: 'normal' | 'weak' | 'resisted' = 'normal',
    impactNormal?: THREE.Vector3,
    spawnDecal = true
  ): void {
    const count = isHeadshot || style === 'weak' ? 14 : 8;
    const baseDir = impactNormal ? impactNormal.clone().normalize() : new THREE.Vector3(0, 0.35, 1);

    for (let i = 0; i < count; i++) {
      const kind: ParticleKind =
        style === 'resisted'
          ? 'resist'
          : style === 'weak' && i % 4 === 0
          ? 'spark'
          : i % 3 === 0
          ? 'blood_dark'
          : 'blood';

      const spreadSpeed = isHeadshot ? 5.2 : 3.6;
      const jetSpeed = 2.6 + Math.random() * 3.2;
      const vel = new THREE.Vector3(
        baseDir.x * jetSpeed + (Math.random() - 0.5) * spreadSpeed,
        0.9 + Math.random() * (isHeadshot ? 4.1 : 2.9),
        baseDir.z * jetSpeed + (Math.random() - 0.5) * spreadSpeed
      );
      const life = 0.34 + Math.random() * 0.2;
      const scale = isHeadshot ? 1.1 + Math.random() * 0.55 : 0.75 + Math.random() * 0.45;
      this.spawnPooledParticle(scene, point, vel, kind, life, 11.2, false, scale);
    }

    if (spawnDecal && style !== 'resisted') {
      this.spawnFloorBloodDecal(scene, point.x, point.z, isHeadshot ? 1.05 : 0.72);
    }
  }

  public spawnBossLandingDebris(
    scene: THREE.Scene,
    center: THREE.Vector3,
    radius = 6.5
  ): void {
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2 + Math.random() * 0.25;
      const spd = 4.5 + Math.random() * 6.5;
      const vel = new THREE.Vector3(
        Math.cos(ang) * spd,
        2.4 + Math.random() * 4.8,
        Math.sin(ang) * spd
      );
      const pos = new THREE.Vector3(
        center.x + Math.cos(ang) * 0.6,
        0.22,
        center.z + Math.sin(ang) * 0.6
      );
      this.spawnPooledParticle(
        scene,
        pos,
        vel,
        i % 4 === 0 ? 'spark' : 'dust',
        0.55 + Math.random() * 0.35,
        12.5,
        true,
        1.45
      );
    }

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xdc2626,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(center.x, 0.08, center.z);
    scene.add(ring);
    this.rings.push({ mesh: ring, life: 0.52, maxLife: 0.52, maxRadius: radius });
  }

  public spawnFlameStream(
    scene: THREE.Scene,
    start: THREE.Vector3,
    dir: THREE.Vector3
  ): void {
    for (let i = 0; i < 3; i++) {
      const kind: ParticleKind = i === 0 ? 'flame_yellow' : 'flame_orange';
      const spread = new THREE.Vector3(
        (Math.random() - 0.5) * 2.2,
        (Math.random() - 0.35) * 1.8,
        (Math.random() - 0.5) * 2.2
      );
      const vel = dir.clone().multiplyScalar(17 + Math.random() * 6).add(spread);
      this.spawnPooledParticle(scene, start, vel, kind, 0.42, -2.6, true, 1.0);
    }
  }

  public spawnExplosion(scene: THREE.Scene, center: THREE.Vector3, radius = 6.5): void {
    const pos = center.clone().add(new THREE.Vector3(0, 0.35, 0));
    for (let i = 0; i < 24; i++) {
      const isEmber = i > 13;
      const theta = Math.random() * Math.PI * 2;
      const speed = isEmber ? 6 + Math.random() * 8 : 2.5 + Math.random() * 5;
      const vel = new THREE.Vector3(
        Math.cos(theta) * speed,
        isEmber ? 4 + Math.random() * 7 : 1.5 + Math.random() * 4,
        Math.sin(theta) * speed
      );
      this.spawnPooledParticle(
        scene,
        pos,
        vel,
        i % 3 === 0 ? 'flame_yellow' : 'flame_orange',
        isEmber ? 0.72 : 0.48,
        isEmber ? 11.5 : -1.5,
        !isEmber,
        1.0
      );
    }

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff8c1a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(center.x, 0.08, center.z);
    scene.add(ring);
    this.rings.push({ mesh: ring, life: 0.42, maxLife: 0.42, maxRadius: radius });
  }

  public spawnTracer(
    scene: THREE.Scene,
    start: THREE.Vector3,
    end: THREE.Vector3,
    color = 0xffd166
  ): void {
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.78,
    });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    this.tracers.push({ line, life: 0.08, maxLife: 0.08 });
  }

  public getActiveParticleCount(): number {
    let count = 0;
    for (const p of this.particlePool) {
      if (p.active) count++;
    }
    return count;
  }

  public getPoolCapacity(): number {
    return MAX_POOLED_PARTICLES;
  }

  public getActiveDecalCount(): number {
    let count = 0;
    for (const d of this.decalPool) {
      if (d.active) count++;
    }
    return count;
  }

  public update(scene: THREE.Scene, dtSec: number): void {
    for (const p of this.particlePool) {
      if (!p.active) continue;
      p.life -= dtSec;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dtSec;
      p.mesh.position.addScaledVector(p.vel, dtSec);
      if (p.mesh.position.y < 0.02 && p.gravity > 0) {
        p.mesh.position.y = 0.02;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
        p.vel.y = 0;
      }
      const t = 1 - p.life / p.maxLife;
      const scale = p.baseScale * (p.grow ? 0.7 + t * 2.1 : Math.max(0.12, 1 - t));
      p.mesh.scale.setScalar(scale);
    }

    for (const d of this.decalPool) {
      if (!d.active) continue;
      d.life -= dtSec;
      if (d.life <= 0) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      if (d.life < 2.5) {
        (d.mesh.material as THREE.MeshBasicMaterial).opacity = 0.72 * (d.life / 2.5);
      }
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dtSec;
      if (t.life <= 0) {
        scene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      (t.line.material as THREE.LineBasicMaterial).opacity =
        0.78 * (t.life / t.maxLife);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dtSec;
      if (r.life <= 0) {
        scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const p = 1 - r.life / r.maxLife;
      const s = 1 + p * r.maxRadius;
      r.mesh.scale.setScalar(s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - p);
    }
  }

  public clear(_scene: THREE.Scene): void {
    for (const p of this.particlePool) {
      p.active = false;
      p.mesh.visible = false;
    }
    for (const d of this.decalPool) {
      d.active = false;
      d.mesh.visible = false;
    }
    for (const t of this.tracers) {
      t.line.parent?.remove(t.line);
      t.line.geometry.dispose();
      (t.line.material as THREE.Material).dispose();
    }
    for (const r of this.rings) {
      r.mesh.parent?.remove(r.mesh);
      (r.mesh.material as THREE.Material).dispose();
    }
    this.tracers = [];
    this.rings = [];
  }

  public dispose(scene: THREE.Scene): void {
    this.clear(scene);
    for (const p of this.particlePool) {
      scene.remove(p.mesh);
    }
    for (const d of this.decalPool) {
      scene.remove(d.mesh);
      (d.mesh.material as THREE.Material).dispose();
    }
    this.particlePool.length = 0;
    this.decalPool.length = 0;
    this.initializedPool = false;

    this.particleGeo.dispose();
    this.flameGeo.dispose();
    this.ringGeo.dispose();
    this.decalGeo.dispose();
    this.bloodMat.dispose();
    this.darkBloodMat.dispose();
    this.sparkMat.dispose();
    this.resistMat.dispose();
    this.dustMat.dispose();
    this.flameOrangeMat.dispose();
    this.flameYellowMat.dispose();
  }
}
