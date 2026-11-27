import * as THREE from 'three';

type ParticleKind =
  | 'blood'
  | 'blood_dark'
  | 'spark'
  | 'resist'
  | 'flame_orange'
  | 'flame_yellow'
  | 'dust'
  | 'brass_shell'
  | 'smoke';

interface PooledParticle {
  active: boolean;
  kind: ParticleKind;
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  grow: boolean;
  baseScale: number;
}

interface PooledTracerBeam {
  active: boolean;
  line: THREE.Line;
  posAttr: THREE.BufferAttribute;
  mat: THREE.LineBasicMaterial;
  life: number;
  maxLife: number;
}

interface PooledShockRing {
  active: boolean;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
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

const MAX_POOLED_PARTICLES = 210;
const MAX_BLOOD_DECALS = 30;
const MAX_POOLED_TRACERS = 24;
const MAX_POOLED_RINGS = 10;

/**
 * Pooled VFX, Shell Casing, Tracer & Blood Particle Controller.
 * Pre-allocates reusable particle meshes, bullet tracers, shockwave rings, and floor decals
 * so rapid combat produces zero per-shot mesh/geometry/material allocations.
 */
export class EffectsSystem {
  private readonly particlePool: PooledParticle[] = [];
  private poolCursor = 0;

  private readonly decalPool: FloorBloodDecal[] = [];
  private decalCursor = 0;

  private readonly tracerPool: PooledTracerBeam[] = [];
  private tracerCursor = 0;

  private readonly ringPool: PooledShockRing[] = [];
  private ringCursor = 0;

  private readonly particleGeo = new THREE.BoxGeometry(0.065, 0.065, 0.065);
  private readonly shellGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.042, 6);
  private readonly flameGeo = new THREE.DodecahedronGeometry(0.14, 1);
  private readonly ringGeo = new THREE.RingGeometry(0.45, 0.72, 36);
  private readonly decalGeo = new THREE.CircleGeometry(0.5, 16);

  private readonly bloodMat = new THREE.MeshBasicMaterial({ color: 0x991b1b });
  private readonly darkBloodMat = new THREE.MeshBasicMaterial({ color: 0x4c0519 });
  private readonly brassMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
  private readonly sparkMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly resistMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
  private readonly dustMat = new THREE.MeshBasicMaterial({
    color: 0x9ca3af,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  private readonly smokeMat = new THREE.MeshBasicMaterial({
    color: 0xd1d5db,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  private readonly flameOrangeMat = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly flameYellowMat = new THREE.MeshBasicMaterial({
    color: 0xfde047,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  private initializedPool = false;

  private ensurePool(scene: THREE.Scene): void {
    if (this.initializedPool) return;
    this.initializedPool = true;

    for (let i = 0; i < MAX_POOLED_PARTICLES; i++) {
      const mesh = new THREE.Mesh(this.particleGeo, this.bloodMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.particlePool.push({
        active: false,
        kind: 'blood',
        mesh,
        vel: new THREE.Vector3(),
        rotVel: new THREE.Vector3(),
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
        polygonOffsetUnits: -2,
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

    for (let i = 0; i < MAX_POOLED_TRACERS; i++) {
      const positions = new Float32Array(6);
      const geo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(positions, 3);
      geo.setAttribute('position', posAttr);
      const mat = new THREE.LineBasicMaterial({
        color: 0xffd166,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this.tracerPool.push({
        active: false,
        line,
        posAttr,
        mat,
        life: 0,
        maxLife: 0.085,
      });
    }

    for (let i = 0; i < MAX_POOLED_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff8c1a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.ringPool.push({
        active: false,
        mesh,
        mat,
        life: 0,
        maxLife: 0.45,
        maxRadius: 6.5,
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
      case 'smoke':
        return this.smokeMat;
      case 'brass_shell':
        return this.brassMat;
      case 'flame_orange':
        return this.flameOrangeMat;
      case 'flame_yellow':
        return this.flameYellowMat;
    }
  }

  private acquireParticle(scene: THREE.Scene): PooledParticle {
    this.ensurePool(scene);
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
    baseScale = 1,
    rotVel?: THREE.Vector3
  ): void {
    const p = this.acquireParticle(scene);
    p.active = true;
    p.kind = kind;
    p.vel.copy(vel);
    if (rotVel) {
      p.rotVel.copy(rotVel);
    } else {
      p.rotVel.set(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6
      );
    }
    p.life = life;
    p.maxLife = life;
    p.gravity = gravity;
    p.grow = grow;
    p.baseScale = baseScale;

    const targetGeo =
      kind === 'flame_orange' || kind === 'flame_yellow' || kind === 'smoke'
        ? this.flameGeo
        : kind === 'brass_shell'
        ? this.shellGeo
        : this.particleGeo;
    if (p.mesh.geometry !== targetGeo) {
      p.mesh.geometry = targetGeo;
    }
    p.mesh.material = this.getMaterialForKind(kind);
    p.mesh.position.copy(pos);
    p.mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI
    );
    p.mesh.scale.setScalar(baseScale);
    if (!p.mesh.parent) scene.add(p.mesh);
    p.mesh.visible = true;
  }

  private spawnShockRing(
    scene: THREE.Scene,
    center: THREE.Vector3,
    radius: number,
    colorHex: number,
    durationSec: number
  ): void {
    this.ensurePool(scene);
    const slot = this.ringPool[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % MAX_POOLED_RINGS;

    slot.active = true;
    slot.life = durationSec;
    slot.maxLife = durationSec;
    slot.maxRadius = radius;
    slot.mat.color.setHex(colorHex);
    slot.mat.opacity = 0.9;
    slot.mesh.position.set(center.x, 0.08, center.z);
    slot.mesh.scale.setScalar(1);
    if (!slot.mesh.parent) scene.add(slot.mesh);
    slot.mesh.visible = true;
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
    const count = isHeadshot || style === 'weak' ? 16 : 9;
    const baseDir = impactNormal ? impactNormal.clone().normalize() : new THREE.Vector3(0, 0.35, 1);

    for (let i = 0; i < count; i++) {
      const kind: ParticleKind =
        style === 'resisted'
          ? i % 2 === 0
            ? 'spark'
            : 'resist'
          : (isHeadshot || style === 'weak') && i % 4 === 0
          ? 'spark'
          : i % 3 === 0
          ? 'blood_dark'
          : 'blood';

      const spreadSpeed = isHeadshot ? 5.5 : 3.8;
      const jetSpeed = 2.6 + Math.random() * 3.4;
      const vel = new THREE.Vector3(
        baseDir.x * jetSpeed + (Math.random() - 0.5) * spreadSpeed,
        0.95 + Math.random() * (isHeadshot ? 4.3 : 3.0),
        baseDir.z * jetSpeed + (Math.random() - 0.5) * spreadSpeed
      );
      const life = 0.35 + Math.random() * 0.22;
      const scale = isHeadshot ? 1.15 + Math.random() * 0.55 : 0.78 + Math.random() * 0.45;
      this.spawnPooledParticle(scene, point, vel, kind, life, 11.2, false, scale);
    }

    if (spawnDecal && style !== 'resisted') {
      this.spawnFloorBloodDecal(scene, point.x, point.z, isHeadshot ? 1.1 : 0.75);
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

    this.spawnShockRing(scene, center, radius, 0xdc2626, 0.52);
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
    for (let i = 0; i < 26; i++) {
      const isEmber = i > 14;
      const theta = Math.random() * Math.PI * 2;
      const speed = isEmber ? 6 + Math.random() * 8.5 : 2.5 + Math.random() * 5.2;
      const vel = new THREE.Vector3(
        Math.cos(theta) * speed,
        isEmber ? 4 + Math.random() * 7.5 : 1.5 + Math.random() * 4.2,
        Math.sin(theta) * speed
      );
      this.spawnPooledParticle(
        scene,
        pos,
        vel,
        i % 4 === 0 ? 'spark' : i % 3 === 0 ? 'flame_yellow' : 'flame_orange',
        isEmber ? 0.74 : 0.5,
        isEmber ? 11.5 : -1.5,
        !isEmber,
        1.05
      );
    }

    this.spawnShockRing(scene, center, radius, 0xff8c1a, 0.44);
  }

  public spawnTracer(
    scene: THREE.Scene,
    start: THREE.Vector3,
    end: THREE.Vector3,
    color = 0xffd166
  ): void {
    this.ensurePool(scene);
    const slot = this.tracerPool[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % MAX_POOLED_TRACERS;

    slot.active = true;
    slot.life = 0.085;
    slot.maxLife = 0.085;
    slot.mat.color.setHex(color);
    slot.mat.opacity = 0.9;
    slot.posAttr.setXYZ(0, start.x, start.y, start.z);
    slot.posAttr.setXYZ(1, end.x, end.y, end.z);
    slot.posAttr.needsUpdate = true;
    if (!slot.line.parent) scene.add(slot.line);
    slot.line.visible = true;

    // Eject spinning 3D brass shell casing + subtle muzzle smoke puff
    const shellVel = new THREE.Vector3(
      1.3 + Math.random() * 0.9,
      1.6 + Math.random() * 0.8,
      0.3 + (Math.random() - 0.5) * 0.6
    );
    this.spawnPooledParticle(
      scene,
      start,
      shellVel,
      'brass_shell',
      0.62,
      12.5,
      false,
      1.0,
      new THREE.Vector3(18, 14, 24)
    );

    const smokeVel = new THREE.Vector3(
      (Math.random() - 0.5) * 0.45,
      0.45 + Math.random() * 0.35,
      -0.6 - Math.random() * 0.4
    );
    this.spawnPooledParticle(
      scene,
      start,
      smokeVel,
      'smoke',
      0.24,
      -0.8,
      true,
      0.42
    );
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
      p.mesh.rotation.x += p.rotVel.x * dtSec;
      p.mesh.rotation.y += p.rotVel.y * dtSec;
      p.mesh.rotation.z += p.rotVel.z * dtSec;

      if (p.mesh.position.y < 0.02 && p.gravity > 0) {
        p.mesh.position.y = 0.02;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
        p.vel.y = p.kind === 'brass_shell' ? Math.abs(p.vel.y) * 0.35 : 0;
      }
      const t = 1 - p.life / p.maxLife;
      const scale =
        p.kind === 'brass_shell'
          ? p.baseScale
          : p.baseScale * (p.grow ? 0.7 + t * 2.1 : Math.max(0.12, 1 - t));
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

    for (const t of this.tracerPool) {
      if (!t.active) continue;
      t.life -= dtSec;
      if (t.life <= 0) {
        t.active = false;
        t.line.visible = false;
        continue;
      }
      t.mat.opacity = 0.9 * (t.life / t.maxLife);
    }

    for (const r of this.ringPool) {
      if (!r.active) continue;
      r.life -= dtSec;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const p = 1 - r.life / r.maxLife;
      const s = 1 + p * r.maxRadius;
      r.mesh.scale.setScalar(s);
      r.mat.opacity = 0.9 * (1 - p);
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
    for (const t of this.tracerPool) {
      t.active = false;
      t.line.visible = false;
    }
    for (const r of this.ringPool) {
      r.active = false;
      r.mesh.visible = false;
    }
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
    for (const t of this.tracerPool) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      t.mat.dispose();
    }
    for (const r of this.ringPool) {
      scene.remove(r.mesh);
      r.mat.dispose();
    }
    this.particlePool.length = 0;
    this.decalPool.length = 0;
    this.tracerPool.length = 0;
    this.ringPool.length = 0;
    this.initializedPool = false;

    this.particleGeo.dispose();
    this.shellGeo.dispose();
    this.flameGeo.dispose();
    this.ringGeo.dispose();
    this.decalGeo.dispose();
    this.bloodMat.dispose();
    this.darkBloodMat.dispose();
    this.brassMat.dispose();
    this.sparkMat.dispose();
    this.resistMat.dispose();
    this.dustMat.dispose();
    this.smokeMat.dispose();
    this.flameOrangeMat.dispose();
    this.flameYellowMat.dispose();
  }
}
