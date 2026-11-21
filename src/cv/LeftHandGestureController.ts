import { DEFAULT_GAME_CONFIG } from '../data/gameConfig';
import { WEAPON_ORDER, type WeaponId } from '../data/weapons';
import { clamp } from '../utils/math';
import type { HandFingerEval, WeaponWheelGestureOutput } from './types';

export interface LeftHandWheelConfig {
  /** Duration closed left fist must be held to open weapon wheel */
  fistHoldMs: number;
  /** Duration open left hand must be held to close weapon wheel */
  openReleaseHoldMs: number;
  /** Duration right-hand 1–5 fingers must stabilize before committing selection */
  fingerSelectStableMs: number;
  /** Safe timeout to close wheel if left-hand tracking is lost completely */
  leftLossCloseMs: number;
  wheelCooldownMs: number;
  minConfidence: number;
}

const DEFAULT_WHEEL_CONFIG: LeftHandWheelConfig = {
  fistHoldMs: DEFAULT_GAME_CONFIG.fistHoldMs,
  openReleaseHoldMs: 180,
  fingerSelectStableMs: 220,
  leftLossCloseMs: 900,
  wheelCooldownMs: 420,
  minConfidence: 0.45,
};

const EMPTY_HAND_EVAL: HandFingerEval = {
  handDetected: false,
  confidence: 0,
  extendedFingers: [false, false, false, false, false],
  fingerCount: 0,
  isFist: false,
};

/**
 * Dual-Hand Hold-Based Weapon Wheel State Machine:
 * - LEFT HAND = Visibility Control:
 *   * Closed Fist held >= fistHoldMs -> OPENS wheel and KEEPS it open while held
 *   * Open / Unclenched Hand held >= openReleaseHoldMs -> CLOSES wheel cleanly
 *   * Brief tracking flicker (< leftLossCloseMs) preserves open state; sustained loss safely closes
 * - RIGHT HAND = Weapon Selection (active ONLY while wheel is open):
 *   * 1 finger -> Assault Rifle ('ar')
 *   * 2 fingers -> SMG ('smg')
 *   * 3 fingers -> Flamethrower ('flamethrower')
 *   * 4 fingers -> Frag Grenade ('grenade')
 *   * 5 fingers -> No selection (does NOT select and does NOT close wheel)
 *   * Selecting a weapon updates immediately (once per gesture transition) while wheel stays open
 */
export class LeftHandGestureController {
  private readonly cfg: LeftHandWheelConfig;
  private wheelOpen = false;
  private manualOverrideOpen = false;

  private fistHoldStartMs: number | null = null;
  private openReleaseStartMs: number | null = null;
  private wheelOpenedAtMs = 0;
  private cooldownUntilMs = 0;
  private lastLeftReliableMs = 0;

  private rightFingerWindow: number[] = [];
  private candidateRightCount: number | null = null;
  private candidateRightStartMs = 0;
  private lastCommittedRightCount: number | null = null;
  private lastRightReliableMs = 0;

  constructor(config?: Partial<LeftHandWheelConfig>) {
    this.cfg = { ...DEFAULT_WHEEL_CONFIG, ...config };
  }

  public isOpen(): boolean {
    return this.wheelOpen;
  }

  public reset(): void {
    this.wheelOpen = false;
    this.manualOverrideOpen = false;
    this.fistHoldStartMs = null;
    this.openReleaseStartMs = null;
    this.wheelOpenedAtMs = 0;
    this.cooldownUntilMs = 0;
    this.lastLeftReliableMs = 0;
    this.resetRightSelectionState();
  }

  private resetRightSelectionState(): void {
    this.rightFingerWindow = [];
    this.candidateRightCount = null;
    this.candidateRightStartMs = 0;
    this.lastCommittedRightCount = null;
    this.lastRightReliableMs = 0;
  }

  public toggleManual(nowMs: number): { wheelOpen: boolean; justOpened: boolean; justClosed: boolean } {
    if (this.wheelOpen) {
      this.closeInternal(nowMs, false);
      return { wheelOpen: false, justOpened: false, justClosed: true };
    }
    this.openInternal(nowMs, true);
    return { wheelOpen: true, justOpened: true, justClosed: false };
  }

  public closeManual(nowMs: number): void {
    if (!this.wheelOpen) return;
    this.closeInternal(nowMs, true);
  }

  private openInternal(nowMs: number, manual = false): void {
    this.wheelOpen = true;
    this.manualOverrideOpen = manual;
    this.wheelOpenedAtMs = nowMs;
    this.fistHoldStartMs = null;
    this.openReleaseStartMs = null;
    this.lastLeftReliableMs = nowMs;
    this.resetRightSelectionState();
  }

  private closeInternal(nowMs: number, applyCooldown: boolean): void {
    this.wheelOpen = false;
    this.manualOverrideOpen = false;
    this.fistHoldStartMs = null;
    this.openReleaseStartMs = null;
    this.resetRightSelectionState();
    if (applyCooldown) {
      this.cooldownUntilMs = nowMs + this.cfg.wheelCooldownMs;
    }
  }

  private pushAndSmoothRightFingerCount(rawCount: number): number {
    this.rightFingerWindow.push(rawCount);
    if (this.rightFingerWindow.length > 5) {
      this.rightFingerWindow.shift();
    }
    const counts = new Map<number, number>();
    for (const c of this.rightFingerWindow) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let bestVal = rawCount;
    let bestFreq = 0;
    for (const [val, freq] of counts.entries()) {
      if (freq > bestFreq) {
        bestFreq = freq;
        bestVal = val;
      }
    }
    return bestFreq >= 2 || this.rightFingerWindow.length === 1 ? bestVal : rawCount;
  }

  public update(
    nowMs: number,
    leftEval: HandFingerEval,
    rightEval: HandFingerEval = EMPTY_HAND_EVAL
  ): WeaponWheelGestureOutput {
    const leftReliable = leftEval.handDetected && leftEval.confidence >= this.cfg.minConfidence;

    // ==================== WHEEL CURRENTLY CLOSED ====================
    if (!this.wheelOpen) {
      if (leftReliable && nowMs >= this.cooldownUntilMs && leftEval.isFist) {
        if (this.fistHoldStartMs === null) {
          this.fistHoldStartMs = nowMs;
        }
        const elapsed = nowMs - this.fistHoldStartMs;
        const progress = clamp(elapsed / this.cfg.fistHoldMs, 0, 1);
        if (elapsed >= this.cfg.fistHoldMs) {
          this.openInternal(nowMs, false);
          return {
            wheelOpen: true,
            justOpened: true,
            justClosed: false,
            hoveredSlot: null,
            fingerCount: 0,
            lockProgress: 0,
            cancelProgress: 0,
            fistHoldProgress: 1,
            selectedWeapon: null,
          };
        }
        return {
          wheelOpen: false,
          justOpened: false,
          justClosed: false,
          hoveredSlot: null,
          fingerCount: 0,
          lockProgress: 0,
          cancelProgress: 0,
          fistHoldProgress: progress,
          selectedWeapon: null,
        };
      }

      this.fistHoldStartMs = null;
      return {
        wheelOpen: false,
        justOpened: false,
        justClosed: false,
        hoveredSlot: null,
        fingerCount: 0,
        lockProgress: 0,
        cancelProgress: 0,
        fistHoldProgress: 0,
        selectedWeapon: null,
      };
    }

    // ==================== WHEEL CURRENTLY OPEN ====================
    // 1. Check Left Hand HOLD rule (keep open while fist held; close when hand opens or tracking lost)
    if (!this.manualOverrideOpen) {
      if (leftReliable) {
        this.lastLeftReliableMs = nowMs;
        if (leftEval.isFist) {
          this.openReleaseStartMs = null;
        } else {
          // Clearly unclenched / open hand closes the wheel after short release debounce
          const extraDelay = leftEval.fingerCount <= 1 ? 110 : 0;
          if (this.openReleaseStartMs === null) {
            this.openReleaseStartMs = nowMs;
          }
          if (nowMs - this.openReleaseStartMs >= this.cfg.openReleaseHoldMs + extraDelay) {
            this.closeInternal(nowMs, true);
            return {
              wheelOpen: false,
              justOpened: false,
              justClosed: true,
              hoveredSlot: null,
              fingerCount: 0,
              lockProgress: 0,
              cancelProgress: 0,
              fistHoldProgress: 0,
              selectedWeapon: null,
            };
          }
        }
      } else if (nowMs - this.lastLeftReliableMs > this.cfg.leftLossCloseMs) {
        // Left hand lost beyond flicker window -> safely close wheel
        this.closeInternal(nowMs, false);
        return {
          wheelOpen: false,
          justOpened: false,
          justClosed: true,
          hoveredSlot: null,
          fingerCount: 0,
          lockProgress: 0,
          cancelProgress: 0,
          fistHoldProgress: 0,
          selectedWeapon: null,
        };
      }
    }

    // 2. Check Right Hand Weapon Selection (1..4 select & keep wheel open; 5 = no selection)
    const rightReliable = rightEval.handDetected && rightEval.confidence >= this.cfg.minConfidence;

    if (!rightReliable) {
      if (nowMs - this.lastRightReliableMs > 650) {
        this.candidateRightCount = null;
        this.candidateRightStartMs = 0;
        this.rightFingerWindow = [];
      }
      return {
        wheelOpen: true,
        justOpened: false,
        justClosed: false,
        hoveredSlot:
          this.candidateRightCount && this.candidateRightCount >= 1 && this.candidateRightCount <= 4
            ? WEAPON_ORDER[this.candidateRightCount - 1]
            : null,
        fingerCount: this.candidateRightCount ?? 0,
        lockProgress: 0,
        cancelProgress: 0,
        fistHoldProgress: 1,
        selectedWeapon: null,
      };
    }

    this.lastRightReliableMs = nowMs;

    if (nowMs - this.wheelOpenedAtMs < 130) {
      return {
        wheelOpen: true,
        justOpened: false,
        justClosed: false,
        hoveredSlot: null,
        fingerCount: 0,
        lockProgress: 0,
        cancelProgress: 0,
        fistHoldProgress: 1,
        selectedWeapon: null,
      };
    }

    const smoothedCount = this.pushAndSmoothRightFingerCount(rightEval.fingerCount);

    if (smoothedCount === 0) {
      this.candidateRightCount = null;
      this.candidateRightStartMs = 0;
      this.lastCommittedRightCount = null;
      return {
        wheelOpen: true,
        justOpened: false,
        justClosed: false,
        hoveredSlot: null,
        fingerCount: 0,
        lockProgress: 0,
        cancelProgress: 0,
        fistHoldProgress: 1,
        selectedWeapon: null,
      };
    }

    if (this.candidateRightCount !== smoothedCount) {
      this.candidateRightCount = smoothedCount;
      this.candidateRightStartMs = nowMs;
    }

    const holdElapsed = nowMs - this.candidateRightStartMs;
    const progress = clamp(holdElapsed / this.cfg.fingerSelectStableMs, 0, 1);

    // 5 fingers raised on Right Hand -> intentional NO SELECTION (never closes wheel!)
    if (smoothedCount === 5) {
      if (holdElapsed >= this.cfg.fingerSelectStableMs) {
        this.lastCommittedRightCount = 5;
      }
      return {
        wheelOpen: true,
        justOpened: false,
        justClosed: false,
        hoveredSlot: null,
        fingerCount: 5,
        lockProgress: 0,
        cancelProgress: progress,
        fistHoldProgress: 1,
        selectedWeapon: null,
      };
    }

    // 1–4 fingers raised on Right Hand -> select weapon ONCE when held past debounce, keeping wheel OPEN
    const targetSlot: WeaponId = WEAPON_ORDER[smoothedCount - 1];
    let selectedWeapon: WeaponId | null = null;
    if (
      holdElapsed >= this.cfg.fingerSelectStableMs &&
      this.lastCommittedRightCount !== smoothedCount
    ) {
      this.lastCommittedRightCount = smoothedCount;
      selectedWeapon = targetSlot;
    }

    return {
      wheelOpen: true,
      justOpened: false,
      justClosed: false,
      hoveredSlot: targetSlot,
      fingerCount: smoothedCount,
      lockProgress: this.lastCommittedRightCount === smoothedCount ? 1 : progress,
      cancelProgress: 0,
      fistHoldProgress: 1,
      selectedWeapon,
    };
  }
}
