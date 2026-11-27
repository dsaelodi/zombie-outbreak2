import * as THREE from 'three';
import type { CameraStateId, EventBus } from '../core/EventBus';
import { triggerHapticImpact, type HapticImpactLevel } from '../utils/haptics';
import { damp, lerp } from '../utils/math';

const IMPACT_SHAKE_BY_LEVEL: Record<HapticImpactLevel, number> = {
  low: 0.065,
  medium: 0.13,
  high: 0.24,
  very_high: 0.36,
};

function isReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class CameraRig {
  public readonly camera: THREE.PerspectiveCamera;
  private cameraState: CameraStateId = 'NORMAL_FPS';
  private readonly defaultBasePos = new THREE.Vector3(0, 1.68, 0);
  private readonly basePosition = new THREE.Vector3(0, 1.68, 0);
  private readonly defaultFov = 62;

  private targetYaw = 0;
  private targetPitch = 0;
  private currentYaw = 0;
  private currentPitch = 0;
  private baseHeadingYaw = 0;
  private currentHeadingYaw = 0;

  private shakeIntensity = 0;
  private shakeTime = 0;
  private recoilKickPitch = 0;
  private userShakeMultiplier = 1.0;
  private userVibrationEnabled = true;

  // Automatic Chase Sprint & Walk Bob state
  private chaseSprintActive = false;
  private sprintSpeedNorm = 0;
  private walkBobActive = false;
  private walkBobSpeedNorm = 0;
  private freeLookWide = false;
  private sprintBobPhase = 0;
  private currentFov = 62;

  private transitionActive = false;
  private transitionPos = new THREE.Vector3(0, 1.68, 0);
  private transitionYaw = 0;
  private transitionPitch = 0;

  private cinematicActive = false;
  private cinematicPos = new THREE.Vector3(0, 1.68, 0);
  private cinematicLookAt = new THREE.Vector3(0, 1.5, -10);
  private cinematicCurPos = new THREE.Vector3(0, 1.68, 0);
  private cinematicCurLookAt = new THREE.Vector3(0, 1.5, -10);
  private cinematicSmoothRate = 0;
  private cinematicShake = 0;
  private targetFovOverride: number | null = null;

  constructor() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(this.defaultFov, aspect, 0.08, 220);
    this.camera.position.copy(this.basePosition);
    this.camera.rotation.order = 'YXZ';
  }

  public getCameraState(): CameraStateId {
    return this.cameraState;
  }

  public setCameraState(state: CameraStateId, events?: EventBus): void {
    if (this.cameraState === state) return;
    this.cameraState = state;
    events?.emit('camera:state_changed', { state });
  }

  public configureFeedback(shakeIntensity: number, vibrationEnabled: boolean): void {
    this.userShakeMultiplier = Math.max(0, Math.min(2, shakeIntensity));
    this.userVibrationEnabled = vibrationEnabled;
  }

  public getPlayerFeetPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.basePosition.x, 0, this.basePosition.z);
  }

  public setBasePosition(x: number, y: number, z: number): void {
    this.basePosition.set(x, y, z);
  }

  public setBaseHeadingYaw(yawRad: number): void {
    this.baseHeadingYaw = yawRad;
  }

  public setTargetFov(fov: number | null): void {
    this.targetFovOverride = fov;
  }

  public setChaseSprintState(active: boolean, speedNorm = 1): void {
    this.chaseSprintActive = active;
    this.sprintSpeedNorm = active ? Math.max(0, Math.min(1.35, speedNorm)) : 0;
  }

  public setWalkBobState(active: boolean, speedNorm = 0.72): void {
    this.walkBobActive = active;
    this.walkBobSpeedNorm = active ? Math.max(0, Math.min(1.2, speedNorm)) : 0;
  }

  public setFreeLookRange(wide: boolean): void {
    this.freeLookWide = wide;
  }

  public setMenuOrbit(elapsedSec: number): void {
    this.cameraState = 'NORMAL_FPS';
    this.transitionActive = false;
    this.cinematicActive = false;
    this.cinematicSmoothRate = 0;
    this.chaseSprintActive = false;
    this.walkBobActive = false;
    this.freeLookWide = false;
    this.targetFovOverride = null;
    this.sprintSpeedNorm = 0;
    this.walkBobSpeedNorm = 0;
    this.basePosition.copy(this.defaultBasePos);
    this.baseHeadingYaw = 0;
    this.currentHeadingYaw = 0;
    this.setFov(56);
    this.camera.position.set(
      Math.sin(elapsedSec * 0.22) * 0.85,
      1.78 + Math.sin(elapsedSec * 0.35) * 0.06,
      1.4
    );
    this.camera.lookAt(0, 1.48, -11);
  }

  public resetForGameplay(): void {
    this.cameraState = 'NORMAL_FPS';
    this.transitionActive = false;
    this.cinematicActive = false;
    this.cinematicSmoothRate = 0;
    this.cinematicShake = 0;
    this.chaseSprintActive = false;
    this.walkBobActive = false;
    this.freeLookWide = false;
    this.targetFovOverride = null;
    this.sprintSpeedNorm = 0;
    this.walkBobSpeedNorm = 0;
    this.sprintBobPhase = 0;
    this.basePosition.copy(this.defaultBasePos);
    this.baseHeadingYaw = 0;
    this.currentHeadingYaw = 0;
    this.setFov(this.defaultFov);
    this.camera.position.copy(this.basePosition);
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.currentYaw = 0;
    this.currentPitch = 0;
    this.shakeIntensity = 0;
    this.recoilKickPitch = 0;
    this.camera.rotation.set(0, 0, 0, 'YXZ');
  }

  private setFov(nextFov: number): void {
    this.currentFov = nextFov;
    if (Math.abs(this.camera.fov - nextFov) > 0.05) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  public setTransitionPose(
    active: boolean,
    pos?: THREE.Vector3,
    yaw = 0,
    pitch = 0
  ): void {
    this.transitionActive = active;
    if (pos) this.transitionPos.copy(pos);
    this.transitionYaw = yaw;
    this.transitionPitch = pitch;
  }

  public setCinematicPose(
    active: boolean,
    pos?: THREE.Vector3,
    lookAt?: THREE.Vector3,
    fov = 56,
    shake = 0,
    smoothRate = 0
  ): void {
    const wasActive = this.cinematicActive;
    this.cinematicActive = active;
    if (!active) {
      this.cinematicShake = 0;
      this.cinematicSmoothRate = 0;
      this.setFov(this.defaultFov);
      return;
    }
    this.cinematicSmoothRate = smoothRate;
    if (pos) {
      this.cinematicPos.copy(pos);
      if (!wasActive || smoothRate <= 0) {
        this.cinematicCurPos.copy(pos);
      }
    }
    if (lookAt) {
      this.cinematicLookAt.copy(lookAt);
      if (!wasActive || smoothRate <= 0) {
        this.cinematicCurLookAt.copy(lookAt);
      }
    }
    this.cinematicShake = shake;
    if (smoothRate > 0) {
      this.setFov(lerp(this.currentFov, fov, 0.25));
    } else {
      this.setFov(fov);
    }
  }

  public setAimParallax(aimX: number, aimY: number): void {
    const yawRange = this.freeLookWide
      ? 1.55
      : this.chaseSprintActive
      ? 0.38
      : 0.22;
    const pitchRange = this.freeLookWide
      ? 0.55
      : this.chaseSprintActive
      ? 0.18
      : 0.13;
    this.targetYaw = -aimX * yawRange;
    this.targetPitch = aimY * pitchRange;
  }

  public triggerRecoil(amount = 0.018): void {
    const scale = isReducedMotionPreferred() ? 0.35 : 1;
    this.recoilKickPitch = Math.min(0.06, this.recoilKickPitch + amount * scale);
  }

  public triggerDamageShake(intensity = 0.09): void {
    const mult = isReducedMotionPreferred() ? 0.25 : this.userShakeMultiplier;
    this.shakeIntensity = Math.min(0.42, this.shakeIntensity + intensity * mult);
  }

  public triggerImpactShake(level: HapticImpactLevel): void {
    const base = IMPACT_SHAKE_BY_LEVEL[level];
    const mult = isReducedMotionPreferred() ? 0.25 : this.userShakeMultiplier;
    this.shakeIntensity = Math.min(0.45, Math.max(this.shakeIntensity, base * mult));
    triggerHapticImpact(level, this.userVibrationEnabled, this.userShakeMultiplier);
  }

  public getShakeIntensity(): number {
    return this.shakeIntensity;
  }

  public update(dtSec: number): void {
    if (this.cinematicActive) {
      if (this.cinematicSmoothRate > 0) {
        const alpha = 1 - Math.exp(-this.cinematicSmoothRate * dtSec);
        this.cinematicCurPos.lerp(this.cinematicPos, alpha);
        this.cinematicCurLookAt.lerp(this.cinematicLookAt, alpha);
      } else {
        this.cinematicCurPos.copy(this.cinematicPos);
        this.cinematicCurLookAt.copy(this.cinematicLookAt);
      }
      const mult = isReducedMotionPreferred() ? 0.25 : this.userShakeMultiplier;
      this.cinematicShake = damp(this.cinematicShake, 0, 8, dtSec);
      const sx = (Math.random() - 0.5) * this.cinematicShake * mult;
      const sy = (Math.random() - 0.5) * this.cinematicShake * mult;
      this.camera.position.set(
        this.cinematicCurPos.x + sx,
        Math.max(0.38, this.cinematicCurPos.y + sy),
        this.cinematicCurPos.z
      );
      this.camera.lookAt(this.cinematicCurLookAt);
      return;
    }

    if (this.transitionActive) {
      this.camera.position.lerp(this.transitionPos, Math.min(1, dtSec * 12));
      this.camera.rotation.set(this.transitionPitch, this.transitionYaw, 0, 'YXZ');
      return;
    }

    this.currentYaw = damp(this.currentYaw, this.targetYaw, 10, dtSec);
    this.currentPitch = damp(this.currentPitch, this.targetPitch, 10, dtSec);

    // Smooth shortest-angle interpolation for sprint chase heading
    let angleDiff = this.baseHeadingYaw - this.currentHeadingYaw;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    this.currentHeadingYaw += angleDiff * Math.min(1, dtSec * 6.5);

    this.recoilKickPitch = damp(this.recoilKickPitch, 0, 18, dtSec);
    this.shakeIntensity = damp(this.shakeIntensity, 0, 9.5, dtSec);
    this.shakeTime += dtSec * 42;

    // Rhythmic camera shake combining multi-frequency wave + micro jitter
    const shakeX =
      (Math.sin(this.shakeTime * 1.3) * 0.65 + (Math.random() - 0.5) * 0.7) *
      this.shakeIntensity;
    const shakeY =
      (Math.cos(this.shakeTime * 1.7) * 0.65 + (Math.random() - 0.5) * 0.7) *
      this.shakeIntensity;
    const shakeRoll = Math.sin(this.shakeTime * 1.1) * this.shakeIntensity * 0.22;

    // Sprint head-bob + dynamic FOV boost during Stage 4 Boss Phase 2 Chase
    let bobX = 0;
    let bobY = 0;
    let sprintRoll = 0;
    const baseOrOverrideFov = this.targetFovOverride ?? this.defaultFov;
    const targetFov =
      this.chaseSprintActive && this.sprintSpeedNorm > 0.1
        ? baseOrOverrideFov + 6.5 * Math.min(1, this.sprintSpeedNorm)
        : baseOrOverrideFov;
    if (Math.abs(this.currentFov - targetFov) > 0.05) {
      this.setFov(lerp(this.currentFov, targetFov, Math.min(1, dtSec * 5)));
    }

    if (!isReducedMotionPreferred()) {
      if (this.chaseSprintActive && this.sprintSpeedNorm > 0.05) {
        this.sprintBobPhase += dtSec * (9.8 * this.sprintSpeedNorm);
        bobY = Math.abs(Math.sin(this.sprintBobPhase)) * 0.068 * this.sprintSpeedNorm;
        bobX = Math.cos(this.sprintBobPhase * 0.5) * 0.048 * this.sprintSpeedNorm;
        sprintRoll = Math.sin(this.sprintBobPhase * 0.5) * 0.016 * this.sprintSpeedNorm;
      } else if (this.walkBobActive && this.walkBobSpeedNorm > 0.05) {
        this.sprintBobPhase += dtSec * (5.6 * this.walkBobSpeedNorm);
        bobY = Math.abs(Math.sin(this.sprintBobPhase)) * 0.036 * this.walkBobSpeedNorm;
        bobX = Math.cos(this.sprintBobPhase * 0.5) * 0.022 * this.walkBobSpeedNorm;
        sprintRoll = Math.sin(this.sprintBobPhase * 0.5) * 0.007 * this.walkBobSpeedNorm;
      }
    }

    const rightX = Math.cos(this.currentHeadingYaw);
    const rightZ = -Math.sin(this.currentHeadingYaw);

    this.camera.position.set(
      this.basePosition.x + rightX * (bobX + shakeX * 0.6),
      this.basePosition.y + bobY + shakeY * 0.6,
      this.basePosition.z + rightZ * (bobX + shakeX * 0.6)
    );
    this.camera.rotation.set(
      this.currentPitch + this.recoilKickPitch + shakeY * 0.35,
      this.currentHeadingYaw + this.currentYaw + shakeX * 0.32,
      shakeRoll + sprintRoll,
      'YXZ'
    );
  }
}
