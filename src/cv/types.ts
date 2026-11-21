import type { WeaponId } from '../data/weapons';

export const POSE_LANDMARK = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

export const HAND_LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export interface NormalizedLandmarkPoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

export type TrackingStatus =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'tracking'
  | 'lost'
  | 'error';

export type TriggerGestureState = 'NO_STANCE' | 'READY' | 'FIRING';

export interface FingerGunEvaluation {
  handDetected: boolean;
  thumbExtended: boolean;
  otherFingersCurled: boolean;
  fingerGunStance: boolean;
  indexAngleDeg: number;
}

export interface HandFingerEval {
  handDetected: boolean;
  confidence: number;
  /** [thumb, index, middle, ring, pinky] */
  extendedFingers: [boolean, boolean, boolean, boolean, boolean];
  fingerCount: number;
  isFist: boolean;
}

export type LeftHandGestureEval = HandFingerEval;

export interface WeaponWheelGestureOutput {
  wheelOpen: boolean;
  justOpened: boolean;
  justClosed: boolean;
  hoveredSlot: WeaponId | null;
  fingerCount: number;
  lockProgress: number;
  cancelProgress: number;
  fistHoldProgress: number;
  selectedWeapon: WeaponId | null;
}

export interface CalibrationData {
  isCalibrated: boolean;
  baselineOffsetX: number;
  baselineOffsetY: number;
  readyIndexAngleDeg: number;
  curledIndexAngleDeg: number;
}

export interface PoseDebugData {
  status: TrackingStatus;
  confidence: number;
  inferenceFps: number;
  indexAngleDeg: number;
  fingerGunStance: boolean;
  thumbExtended: boolean;
  otherFingersCurled: boolean;
  handDetected: boolean;
  triggerState: TriggerGestureState;
  aimX: number;
  aimY: number;
  pauseHoldProgress: number;
  bodyVisible: boolean;
  poseLandmarks: NormalizedLandmarkPoint[] | null;
  handLandmarks: NormalizedLandmarkPoint[] | null;
  leftHandDetected: boolean;
  leftHandLandmarks: NormalizedLandmarkPoint[] | null;
  leftFingerCount: number;
  leftIsFist: boolean;
  rightWheelFingerCount: number;
  weaponWheelOpen: boolean;
  hoveredSlot: WeaponId | null;
  wheelLockProgress: number;
}
