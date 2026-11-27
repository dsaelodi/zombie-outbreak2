import * as THREE from 'three';
import type { CrowdDensityLevel } from '../../data/gameConfig';

export type CrowdBehaviorState =
  | 'idle'
  | 'cheering'
  | 'hysterical'
  | 'silent_freeze'
  | 'collapsing';

const DENSITY_COUNTS: Record<CrowdDensityLevel, number> = {
  low: 600,
  medium: 1200,
  high: 1800,
};

/**
 * GPU-instanced low-poly zombie spectator horde surrounding Stage 4: The Arena of the Dead.
 * Uses only 3 InstancedMeshes (torsos, heads, raised arms) with typed-array transforms
 * and zero per-frame allocations to keep 600–1,800 spectators running smoothly in WebGL.
 */
export class ZombieCrowdManager {
  public readonly root = new THREE.Group();
  public readonly instanceCount: number;

  private readonly arenaCenterX = 0;
  private readonly arenaCenterZ = -22;

  private readonly torsoGeo: THREE.BoxGeometry;
  private readonly headGeo: THREE.BoxGeometry;
  private readonly armsGeo: THREE.BoxGeometry;

  private readonly torsoMat: THREE.MeshStandardMaterial;
  private readonly headMat: THREE.MeshStandardMaterial;
  private readonly armsMat: THREE.MeshStandardMaterial;

  private readonly torsoMesh: THREE.InstancedMesh;
  private readonly headMesh: THREE.InstancedMesh;
  private readonly armsMesh: THREE.InstancedMesh;

  private readonly baseX: Float32Array;
  private readonly baseY: Float32Array;
  private readonly baseZ: Float32Array;
  private readonly yaw: Float32Array;
  private readonly tierNorm: Float32Array;
  private readonly phaseOffset: Float32Array;
  private readonly scaleVar: Float32Array;

  private readonly dummy = new THREE.Object3D();
  private state: CrowdBehaviorState = 'cheering';
  private collapseProgress = 0;
  private collapseTimer = 0;
  private showcaseExcitement = 0;

  constructor(density: CrowdDensityLevel, isSoftwareGl: boolean) {
    const requested = DENSITY_COUNTS[density] ?? 1200;
    this.instanceCount = isSoftwareGl ? Math.min(450, requested) : requested;

    this.torsoGeo = new THREE.BoxGeometry(0.46, 0.72, 0.28);
    this.headGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    this.armsGeo = new THREE.BoxGeometry(0.68, 0.44, 0.18);

    this.torsoMat = new THREE.MeshStandardMaterial({
      color: 0x3f433c,
      roughness: 0.9,
      metalness: 0.05,
    });
    this.headMat = new THREE.MeshStandardMaterial({
      color: 0x6b7764,
      roughness: 0.85,
      metalness: 0.04,
    });
    this.armsMat = new THREE.MeshStandardMaterial({
      color: 0x5c6857,
      roughness: 0.86,
      metalness: 0.04,
    });

    this.torsoMesh = new THREE.InstancedMesh(this.torsoGeo, this.torsoMat, this.instanceCount);
    this.headMesh = new THREE.InstancedMesh(this.headGeo, this.headMat, this.instanceCount);
    this.armsMesh = new THREE.InstancedMesh(this.armsGeo, this.armsMat, this.instanceCount);

    this.torsoMesh.frustumCulled = false;
    this.headMesh.frustumCulled = false;
    this.armsMesh.frustumCulled = false;

    this.baseX = new Float32Array(this.instanceCount);
    this.baseY = new Float32Array(this.instanceCount);
    this.baseZ = new Float32Array(this.instanceCount);
    this.yaw = new Float32Array(this.instanceCount);
    this.tierNorm = new Float32Array(this.instanceCount);
    this.phaseOffset = new Float32Array(this.instanceCount);
    this.scaleVar = new Float32Array(this.instanceCount);

    this.populateStands();
    this.root.add(this.torsoMesh, this.headMesh, this.armsMesh);
    this.update(0.016, 0);
  }

  private populateStands(): void {
    const tiers = 7;
    const minRadius = 21.4;
    const tierRadiusStep = 1.78;
    const baseStepY = 2.65;
    const tierHeightStep = 1.24;

    const tintPalette = [
      new THREE.Color(0x4b5548),
      new THREE.Color(0x523c38),
      new THREE.Color(0x3a4048),
      new THREE.Color(0x5e5343),
      new THREE.Color(0x472d2d),
    ];

    let placed = 0;
    let seed = 1337;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    while (placed < this.instanceCount) {
      const tierIdx = placed % tiers;
      const tierRatio = tierIdx / (tiers - 1);
      const radius = minRadius + tierIdx * tierRadiusStep + (rand() - 0.5) * 0.72;
      const angle = rand() * Math.PI * 2;
      const x = this.arenaCenterX + Math.cos(angle) * radius;
      const z = this.arenaCenterZ + Math.sin(angle) * radius;

      // Keep sightlines open at the Elevator Entrance Gate (south) and Giant Exit Gate (north)
      const isSouthEntranceGap = z > -1.5 && Math.abs(x) < 5.6;
      const isNorthExitGap = (z < -38.5 && Math.abs(x) < 7.2) || z < -39.5;
      if (isSouthEntranceGap || isNorthExitGap) {
        continue;
      }

      this.baseX[placed] = x;
      this.baseY[placed] = baseStepY + tierIdx * tierHeightStep;
      this.baseZ[placed] = z;
      this.yaw[placed] = Math.atan2(this.arenaCenterX - x, this.arenaCenterZ - z) + (rand() - 0.5) * 0.28;
      this.tierNorm[placed] = tierRatio;
      this.phaseOffset[placed] = rand() * Math.PI * 2;
      this.scaleVar[placed] = 0.88 + rand() * 0.26;

      const c = tintPalette[placed % tintPalette.length];
      this.torsoMesh.setColorAt(placed, c);
      const skinTint = new THREE.Color().setHSL(
        0.24 + (placed % 5) * 0.02,
        0.14,
        0.38 + (placed % 4) * 0.04
      );
      this.headMesh.setColorAt(placed, skinTint);
      this.armsMesh.setColorAt(placed, skinTint);
      placed++;
    }

    if (this.torsoMesh.instanceColor) {
      this.torsoMesh.instanceColor.needsUpdate = true;
    }
    if (this.headMesh.instanceColor) {
      this.headMesh.instanceColor.needsUpdate = true;
    }
    if (this.armsMesh.instanceColor) {
      this.armsMesh.instanceColor.needsUpdate = true;
    }
  }

  public setState(state: CrowdBehaviorState, collapseProgress?: number): void {
    this.state = state;
    if (collapseProgress !== undefined) {
      this.collapseProgress = Math.max(0, Math.min(1, collapseProgress));
    }
    if (state !== 'collapsing' && collapseProgress === undefined) {
      this.collapseTimer = 0;
    }
  }

  public setShowcaseExcitement(boost01: number): void {
    this.showcaseExcitement = Math.max(0, Math.min(1, boost01));
  }

  public getState(): CrowdBehaviorState {
    return this.state;
  }

  public update(dtSec: number, elapsedSec: number): void {
    if (this.state === 'collapsing') {
      this.collapseTimer = Math.min(1, this.collapseTimer + dtSec * 0.28);
    }
    const effectiveCollapse = Math.max(this.collapseProgress, this.collapseTimer);

    const activeBoost =
      this.state === 'cheering' || this.state === 'hysterical' ? this.showcaseExcitement : 0;

    const speed =
      (this.state === 'hysterical'
        ? 9.2
        : this.state === 'cheering'
        ? 4.8
        : this.state === 'idle'
        ? 1.9
        : 0) *
      (1 + activeBoost * 0.55);

    const bounceAmp =
      (this.state === 'hysterical'
        ? 0.22
        : this.state === 'cheering'
        ? 0.1
        : this.state === 'idle'
        ? 0.03
        : 0) *
      (1 + activeBoost * 1.15);

    const armRaiseBase =
      (this.state === 'hysterical'
        ? 0.44
        : this.state === 'cheering'
        ? 0.34
        : 0.08) +
      activeBoost * 0.22;

    const d = this.dummy;

    for (let i = 0; i < this.instanceCount; i++) {
      const s = this.scaleVar[i];
      const ph = this.phaseOffset[i];
      const bx = this.baseX[i];
      const by = this.baseY[i];
      const bz = this.baseZ[i];
      const yRot = this.yaw[i];

      if (this.state === 'collapsing') {
        // Staggered ring-by-ring collapse from inner rim outward
        const threshold = this.tierNorm[i] * 0.72;
        const localFall = Math.max(0, Math.min(1, (effectiveCollapse - threshold) / 0.28));
        const slumpPitch = localFall * 1.38;
        const dropY = localFall * 0.48;

        d.position.set(bx, by + (0.36 - dropY) * s, bz);
        d.rotation.set(slumpPitch, yRot, (i % 2 === 0 ? 0.18 : -0.18) * localFall);
        d.scale.setScalar(s);
        d.updateMatrix();
        this.torsoMesh.setMatrixAt(i, d.matrix);

        d.position.set(
          bx + Math.sin(yRot) * localFall * 0.32,
          by + (0.86 - dropY * 1.45) * s,
          bz + Math.cos(yRot) * localFall * 0.32
        );
        d.rotation.set(slumpPitch * 0.7, yRot, 0);
        d.scale.setScalar(s);
        d.updateMatrix();
        this.headMesh.setMatrixAt(i, d.matrix);

        d.position.set(
          bx + Math.sin(yRot) * localFall * 0.26,
          by + (0.55 - dropY * 1.25) * s,
          bz + Math.cos(yRot) * localFall * 0.26
        );
        d.rotation.set(slumpPitch, yRot, 0);
        d.scale.setScalar(s);
        d.updateMatrix();
        this.armsMesh.setMatrixAt(i, d.matrix);
        continue;
      }

      if (this.state === 'silent_freeze') {
        d.position.set(bx, by + 0.36 * s, bz);
        d.rotation.set(0.06, yRot, 0);
        d.scale.setScalar(s);
        d.updateMatrix();
        this.torsoMesh.setMatrixAt(i, d.matrix);

        d.position.set(bx, by + 0.88 * s, bz);
        d.rotation.set(0.12, yRot, 0);
        d.updateMatrix();
        this.headMesh.setMatrixAt(i, d.matrix);

        d.position.set(bx, by + 0.44 * s, bz);
        d.rotation.set(0.05, yRot, 0);
        d.updateMatrix();
        this.armsMesh.setMatrixAt(i, d.matrix);
        continue;
      }

      const wave = Math.sin(elapsedSec * speed + ph);
      const jump = Math.max(0, wave) * bounceAmp;
      const sway = Math.cos(elapsedSec * (speed * 0.6) + ph) * 0.09;

      d.position.set(bx, by + (0.36 + jump) * s, bz);
      d.rotation.set(0.08 + Math.abs(wave) * 0.08, yRot, sway);
      d.scale.setScalar(s);
      d.updateMatrix();
      this.torsoMesh.setMatrixAt(i, d.matrix);

      d.position.set(bx, by + (0.88 + jump) * s, bz);
      d.rotation.set(-0.08 + wave * 0.14, yRot, sway * 1.4);
      d.updateMatrix();
      this.headMesh.setMatrixAt(i, d.matrix);

      const armLift = armRaiseBase + Math.abs(Math.sin(elapsedSec * speed * 1.15 + ph)) * 0.32;
      d.position.set(bx, by + (0.58 + jump + armLift) * s, bz);
      d.rotation.set(-0.35 + wave * 0.25, yRot, sway * 1.2);
      d.updateMatrix();
      this.armsMesh.setMatrixAt(i, d.matrix);
    }

    this.torsoMesh.instanceMatrix.needsUpdate = true;
    this.headMesh.instanceMatrix.needsUpdate = true;
    this.armsMesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    this.torsoGeo.dispose();
    this.headGeo.dispose();
    this.armsGeo.dispose();
    this.torsoMat.dispose();
    this.headMat.dispose();
    this.armsMat.dispose();
    this.torsoMesh.dispose();
    this.headMesh.dispose();
    this.armsMesh.dispose();
  }
}
