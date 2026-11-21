import type { PoseDebugData, WeaponWheelGestureOutput } from '../cv/types';
import type { WeaponId } from '../data/weapons';

export type InputMode = 'pose' | 'mouse';

export interface PlayerInputState {
  aimX: number; // -1 (left) to +1 (right)
  aimY: number; // -1 (bottom) to +1 (top)
  fireHeld: boolean;
  reloadTriggered: boolean;
  pauseTriggered: boolean;
  wheelTogglePressed: boolean;
  wheelCancelPressed: boolean;
  directWeaponSelect: WeaponId | null;
  wheelGesture?: WeaponWheelGestureOutput;
  mode: InputMode;
  trackingActive: boolean;
  poseDebug?: PoseDebugData;
}

export interface IInputProvider {
  readonly mode: InputMode;
  enable(): void;
  disable(): void;
  poll(nowMs: number, dtSec: number): PlayerInputState;
  dispose(): void;
}
