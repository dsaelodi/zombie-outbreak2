import * as THREE from 'three';
import { getStageByIndex } from '../../data/stages';
import type { CameraRig } from '../CameraRig';
import type { Weapon } from '../entities/Weapon';

export class TransitionController {
  private active = false;
  private elapsedSec = 0;
  private durationSec = 4.6;
  private targetStageIndex = 0;
  private footstepAccum = 0;
  private finishedEmitted = false;

  private readonly startPos = new THREE.Vector3(0, 1.68, 7.2);
  private readonly endPos = new THREE.Vector3(0, 1.68, 0);
  private readonly currentPos = new THREE.Vector3();

  public isActive(): boolean {
    return this.active;
  }

  public start(
    nextStageIndex: number,
    onStageSetup: (stageIdx: number) => void,
    onStartEvent: (info: { nextStageIndex: number; titleCard: string; subtitle: string }) => void
  ): void {
    if (this.active) return;
    this.active = true;
    this.elapsedSec = 0;
    this.footstepAccum = 0.15;
    this.finishedEmitted = false;
    this.targetStageIndex = nextStageIndex;

    onStageSetup(nextStageIndex);
    const stage = getStageByIndex(nextStageIndex);
    onStartEvent({
      nextStageIndex,
      titleCard: stage.titleCard,
      subtitle: stage.subtitle,
    });
  }

  public skip(
    cameraRig: CameraRig,
    weapon: Weapon,
    onComplete: (stageIndex: number) => void
  ): void {
    if (!this.active || this.finishedEmitted) return;
    this.finish(cameraRig, weapon, onComplete);
  }

  public reset(cameraRig: CameraRig, weapon: Weapon): void {
    this.active = false;
    this.elapsedSec = 0;
    this.finishedEmitted = false;
    weapon.setTransitionCarry(false);
    cameraRig.setTransitionPose(false);
  }

  private finish(
    cameraRig: CameraRig,
    weapon: Weapon,
    onComplete: (stageIndex: number) => void
  ): void {
    if (this.finishedEmitted) return;
    this.finishedEmitted = true;
    this.active = false;
    weapon.setTransitionCarry(false);
    cameraRig.resetForGameplay();
    onComplete(this.targetStageIndex);
  }

  public update(
    dtSec: number,
    cameraRig: CameraRig,
    weapon: Weapon,
    onFootstep: () => void,
    onComplete: (stageIndex: number) => void
  ): void {
    if (!this.active) return;

    this.elapsedSec += dtSec;
    const t = Math.min(1, this.elapsedSec / this.durationSec);
    // Smooth ease-out stride
    const eased = 1 - Math.pow(1 - t, 2);

    this.currentPos.lerpVectors(this.startPos, this.endPos, eased);
    // Natural walking head bobbing
    const stepPhase = this.elapsedSec * 7.2;
    const bobY = Math.abs(Math.sin(stepPhase)) * 0.058 * (1 - t * 0.35);
    const swayX = Math.cos(stepPhase * 0.5) * 0.06 * (1 - t * 0.35);
    this.currentPos.x += swayX;
    this.currentPos.y += bobY;

    const lookYaw = Math.sin(this.elapsedSec * 1.1) * 0.055 * (1 - t);
    const lookPitch = -0.04 + Math.sin(stepPhase) * 0.012 * (1 - t);

    weapon.setTransitionCarry(true);
    cameraRig.setTransitionPose(true, this.currentPos, lookYaw, lookPitch);

    this.footstepAccum -= dtSec;
    if (this.footstepAccum <= 0 && t < 0.94) {
      this.footstepAccum = 0.44;
      onFootstep();
    }

    if (t >= 1) {
      this.finish(cameraRig, weapon, onComplete);
    }
  }
}
