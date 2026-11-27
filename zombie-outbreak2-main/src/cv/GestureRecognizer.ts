import type { PoseConfig } from '../data/gameConfig';
import type { FingerGunEvaluation, TriggerGestureState } from './types';

export interface GestureEvents {
  fireHeld: boolean;
  pauseTriggered: boolean;
  pauseHoldProgress: number;
  triggerState: TriggerGestureState;
}

export class GestureRecognizer {
  private triggerState: TriggerGestureState = 'NO_STANCE';
  private pauseHoldStartMs: number | null = null;
  private pauseFiredForCurrentHold = false;

  public reset(): void {
    this.triggerState = 'NO_STANCE';
    this.pauseHoldStartMs = null;
    this.pauseFiredForCurrentHold = false;
  }

  public getTriggerState(): TriggerGestureState {
    return this.triggerState;
  }

  public update(
    nowMs: number,
    fingerGun: FingerGunEvaluation,
    bothHandsRaised: boolean,
    poseValid: boolean,
    config: PoseConfig
  ): GestureEvents {
    let fireHeld = false;
    let pauseTriggered = false;
    let pauseHoldProgress = 0;

    if (!poseValid) {
      this.triggerState = 'NO_STANCE';
      this.pauseHoldStartMs = null;
      return {
        fireHeld: false,
        pauseTriggered: false,
        pauseHoldProgress: 0,
        triggerState: this.triggerState,
      };
    }

    // 1. Finger-Gun + Index Curl continuous SMG trigger
    if (!fingerGun.handDetected || !fingerGun.fingerGunStance) {
      this.triggerState = 'NO_STANCE';
      fireHeld = false;
    } else if (this.triggerState === 'NO_STANCE') {
      // Enter READY only when index is initially extended or clearly formed
      if (fingerGun.indexAngleDeg >= config.triggerCurlAngleDeg) {
        this.triggerState = 'READY';
      } else {
        // User entered frame already holding finger-gun curled trigger
        this.triggerState = 'FIRING';
        fireHeld = true;
      }
    } else if (this.triggerState === 'READY') {
      if (fingerGun.indexAngleDeg <= config.triggerCurlAngleDeg) {
        this.triggerState = 'FIRING';
        fireHeld = true;
      }
    } else if (this.triggerState === 'FIRING') {
      if (fingerGun.indexAngleDeg >= config.triggerReleaseAngleDeg) {
        this.triggerState = 'READY';
        fireHeld = false;
      } else {
        fireHeld = true;
      }
    }

    // 2. Both hands raised above shoulder level for ~1 second triggers pause once
    if (bothHandsRaised) {
      if (this.pauseHoldStartMs === null) {
        this.pauseHoldStartMs = nowMs;
      }
      const heldMs = nowMs - this.pauseHoldStartMs;
      pauseHoldProgress = Math.min(1, heldMs / config.pauseHoldMs);

      if (!this.pauseFiredForCurrentHold && heldMs >= config.pauseHoldMs) {
        pauseTriggered = true;
        this.pauseFiredForCurrentHold = true;
      }
    } else {
      this.pauseHoldStartMs = null;
      this.pauseFiredForCurrentHold = false;
      pauseHoldProgress = 0;
    }

    return {
      fireHeld,
      pauseTriggered,
      pauseHoldProgress,
      triggerState: this.triggerState,
    };
  }
}
