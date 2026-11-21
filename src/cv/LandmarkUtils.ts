import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { calculateAngle2D, calculateAngle3D, type Point3D } from '../utils/math';
import {
  HAND_LANDMARK,
  POSE_LANDMARK,
  type FingerGunEvaluation,
  type LeftHandGestureEval,
  type NormalizedLandmarkPoint,
} from './types';

export interface SelectedHandData {
  landmarks: NormalizedLandmarkPoint[] | null;
  worldLandmarks: NormalizedLandmarkPoint[] | null;
  confidence: number;
}

export function getLandmarkConfidence(lm: NormalizedLandmarkPoint | undefined): number {
  if (!lm) return 0;
  const vis = lm.visibility ?? 1.0;
  const pres = lm.presence ?? 1.0;
  return Math.min(vis, pres);
}

export function isLandmarkReliable(
  lm: NormalizedLandmarkPoint | undefined,
  threshold: number
): lm is NormalizedLandmarkPoint {
  if (!lm) return false;
  return getLandmarkConfidence(lm) >= threshold;
}

function dist3(a: Point3D, b: Point3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Computes upper-body confidence focusing on right aiming arm and shoulders.
 */
export function computeUpperBodyConfidence(
  landmarks: NormalizedLandmarkPoint[] | undefined
): { validCount: number; averageConfidence: number } {
  if (!landmarks || landmarks.length < 17) {
    return { validCount: 0, averageConfidence: 0 };
  }

  const keyIndices = [
    POSE_LANDMARK.RIGHT_SHOULDER,
    POSE_LANDMARK.LEFT_SHOULDER,
    POSE_LANDMARK.RIGHT_ELBOW,
    POSE_LANDMARK.RIGHT_WRIST,
  ];

  let sum = 0;
  let validCount = 0;

  for (const idx of keyIndices) {
    const conf = getLandmarkConfidence(landmarks[idx]);
    sum += conf;
    if (conf >= 0.35) validCount++;
  }

  return {
    validCount,
    averageConfidence: sum / keyIndices.length,
  };
}

/**
 * Computes mirrored right-shoulder-relative right-wrist offset.
 * Moving real right hand right -> positive dx. Moving real right hand up -> negative dy (screen space).
 */
export function computeMirroredRightWristOffset(
  poseLandmarks: NormalizedLandmarkPoint[] | null,
  handLandmarks?: NormalizedLandmarkPoint[] | null
): { dx: number; dy: number } | null {
  const rShoulder = poseLandmarks?.[POSE_LANDMARK.RIGHT_SHOULDER];
  const poseWrist = poseLandmarks?.[POSE_LANDMARK.RIGHT_WRIST];
  const handWrist = handLandmarks?.[HAND_LANDMARK.WRIST];

  const wrist = handWrist ?? poseWrist;
  if (!rShoulder || !wrist) return null;

  const wristMirroredX = 1 - wrist.x;
  const shoulderMirroredX = 1 - rShoulder.x;

  return {
    dx: wristMirroredX - shoulderMirroredX,
    dy: wrist.y - rShoulder.y,
  };
}

function getHandScore(handResult: HandLandmarkerResult, index: number): number {
  return handResult.handedness?.[index]?.[0]?.score ?? 0.8;
}

/**
 * Selects non-overlapping right and left hands from HandLandmarkerResult,
 * cross-checking wrist proximity against Pose landmarks to prevent mirrored handedness swaps.
 */
export function selectDualHands(
  handResult: HandLandmarkerResult | null,
  poseLandmarks: NormalizedLandmarkPoint[] | null
): { rightHand: SelectedHandData; leftHand: SelectedHandData } {
  const empty: SelectedHandData = { landmarks: null, worldLandmarks: null, confidence: 0 };
  if (!handResult || !handResult.landmarks || handResult.landmarks.length === 0) {
    return { rightHand: empty, leftHand: empty };
  }

  const poseRightWrist = poseLandmarks?.[POSE_LANDMARK.RIGHT_WRIST];
  const poseLeftWrist = poseLandmarks?.[POSE_LANDMARK.LEFT_WRIST];
  const rWristOk = Boolean(poseRightWrist && getLandmarkConfidence(poseRightWrist) >= 0.35);
  const lWristOk = Boolean(poseLeftWrist && getLandmarkConfidence(poseLeftWrist) >= 0.35);

  let rightIdx = -1;
  let leftIdx = -1;

  // 1. Pick Right Hand closest to RIGHT_WRIST (16)
  if (rWristOk && poseRightWrist) {
    let bestDist = Infinity;
    for (let i = 0; i < handResult.landmarks.length; i++) {
      const hw = handResult.landmarks[i]?.[HAND_LANDMARK.WRIST];
      if (!hw) continue;
      const dRight = Math.hypot(hw.x - poseRightWrist.x, hw.y - poseRightWrist.y);
      const dLeft =
        lWristOk && poseLeftWrist
          ? Math.hypot(hw.x - poseLeftWrist.x, hw.y - poseLeftWrist.y)
          : Infinity;
      if (dRight < 0.27 && dRight < dLeft && dRight < bestDist) {
        bestDist = dRight;
        rightIdx = i;
      }
    }
  }

  // Fallback for Right Hand via handedness label
  if (rightIdx === -1) {
    for (let i = 0; i < handResult.landmarks.length; i++) {
      const label = handResult.handedness?.[i]?.[0]?.categoryName;
      if (label === 'Right') {
        rightIdx = i;
        break;
      }
    }
  }

  // 2. Pick Left Hand closest to LEFT_WRIST (15), never reusing rightIdx
  if (lWristOk && poseLeftWrist) {
    let bestDist = Infinity;
    for (let i = 0; i < handResult.landmarks.length; i++) {
      if (i === rightIdx) continue;
      const hw = handResult.landmarks[i]?.[HAND_LANDMARK.WRIST];
      if (!hw) continue;
      const dLeft = Math.hypot(hw.x - poseLeftWrist.x, hw.y - poseLeftWrist.y);
      const dRight =
        rWristOk && poseRightWrist
          ? Math.hypot(hw.x - poseRightWrist.x, hw.y - poseRightWrist.y)
          : Infinity;
      if (dLeft < 0.27 && dLeft <= dRight && dLeft < bestDist) {
        bestDist = dLeft;
        leftIdx = i;
      }
    }
  }

  // Fallback for Left Hand via handedness label (excluding rightIdx)
  if (leftIdx === -1) {
    for (let i = 0; i < handResult.landmarks.length; i++) {
      if (i === rightIdx) continue;
      const label = handResult.handedness?.[i]?.[0]?.categoryName;
      if (label === 'Left') {
        leftIdx = i;
        break;
      }
    }
  }

  const build = (idx: number): SelectedHandData =>
    idx === -1
      ? empty
      : {
          landmarks: handResult.landmarks[idx] as NormalizedLandmarkPoint[],
          worldLandmarks: (handResult.worldLandmarks?.[idx] ??
            null) as NormalizedLandmarkPoint[] | null,
          confidence: getHandScore(handResult, idx),
        };

  return {
    rightHand: build(rightIdx),
    leftHand: build(leftIdx),
  };
}

/**
 * Legacy helper kept for backward compatibility (e.g. calibration preview).
 */
export function selectRightHand(
  handResult: HandLandmarkerResult | null,
  poseLandmarks: NormalizedLandmarkPoint[] | null
): {
  landmarks: NormalizedLandmarkPoint[] | null;
  worldLandmarks: NormalizedLandmarkPoint[] | null;
} {
  const { rightHand } = selectDualHands(handResult, poseLandmarks);
  return {
    landmarks: rightHand.landmarks,
    worldLandmarks: rightHand.worldLandmarks,
  };
}

/**
 * Evaluates whether the right hand is in the finger-gun base stance
 * (thumb extended, middle/ring/pinky curled) and measures index finger curl angle.
 */
export function evaluateRightFingerGun(
  handLandmarks: NormalizedLandmarkPoint[] | null,
  handWorldLandmarks: NormalizedLandmarkPoint[] | null
): FingerGunEvaluation {
  if (!handLandmarks || handLandmarks.length < 21) {
    return {
      handDetected: false,
      thumbExtended: false,
      otherFingersCurled: false,
      fingerGunStance: false,
      indexAngleDeg: 0,
    };
  }

  const pts =
    handWorldLandmarks && handWorldLandmarks.length >= 21
      ? handWorldLandmarks
      : handLandmarks;
  const use3D = pts === handWorldLandmarks;

  const wrist = pts[HAND_LANDMARK.WRIST];
  const thumbCmc = pts[HAND_LANDMARK.THUMB_CMC];
  const thumbMcp = pts[HAND_LANDMARK.THUMB_MCP];
  const thumbIp = pts[HAND_LANDMARK.THUMB_IP];
  const thumbTip = pts[HAND_LANDMARK.THUMB_TIP];

  const indexMcp = pts[HAND_LANDMARK.INDEX_MCP];
  const indexPip = pts[HAND_LANDMARK.INDEX_PIP];
  const indexDip = pts[HAND_LANDMARK.INDEX_DIP];
  const indexTip = pts[HAND_LANDMARK.INDEX_TIP];

  const pipAngle = use3D
    ? calculateAngle3D(indexMcp, indexPip, indexTip)
    : calculateAngle2D(indexMcp, indexPip, indexTip);
  const dipAngle = use3D
    ? calculateAngle3D(indexPip, indexDip, indexTip)
    : calculateAngle2D(indexPip, indexDip, indexTip);
  const indexAngleDeg = pipAngle * 0.7 + dipAngle * 0.3;

  const thumbAngle = use3D
    ? calculateAngle3D(thumbCmc, thumbMcp, thumbTip)
    : calculateAngle2D(thumbCmc, thumbMcp, thumbTip);
  const thumbOutFromIndex =
    dist3(thumbTip, indexMcp) > dist3(thumbIp, indexMcp) * 0.92 &&
    dist3(thumbTip, pts[HAND_LANDMARK.PINKY_MCP]) >
      dist3(thumbMcp, pts[HAND_LANDMARK.PINKY_MCP]) * 0.95;
  const thumbExtended = thumbAngle >= 122 && thumbOutFromIndex;

  const isFingerCurled = (mcpIdx: number, pipIdx: number, tipIdx: number): boolean => {
    const mcp = pts[mcpIdx];
    const pip = pts[pipIdx];
    const tip = pts[tipIdx];
    const angle = use3D
      ? calculateAngle3D(mcp, pip, tip)
      : calculateAngle2D(mcp, pip, tip);
    const tipCloserThanPip = dist3(tip, wrist) < dist3(pip, wrist) * 1.18;
    return angle < 142 || tipCloserThanPip;
  };

  const midCurled = isFingerCurled(
    HAND_LANDMARK.MIDDLE_MCP,
    HAND_LANDMARK.MIDDLE_PIP,
    HAND_LANDMARK.MIDDLE_TIP
  );
  const ringCurled = isFingerCurled(
    HAND_LANDMARK.RING_MCP,
    HAND_LANDMARK.RING_PIP,
    HAND_LANDMARK.RING_TIP
  );
  const pinkyCurled = isFingerCurled(
    HAND_LANDMARK.PINKY_MCP,
    HAND_LANDMARK.PINKY_PIP,
    HAND_LANDMARK.PINKY_TIP
  );

  const curledCount = Number(midCurled) + Number(ringCurled) + Number(pinkyCurled);
  const otherFingersCurled = curledCount >= 2;
  const fingerGunStance = thumbExtended && otherFingersCurled;

  return {
    handDetected: true,
    thumbExtended,
    otherFingersCurled,
    fingerGunStance,
    indexAngleDeg,
  };
}

/**
 * Evaluates closed fist vs 1–5 raised fingers for either hand.
 * Used for left-hand hold-to-open fist / open-to-close detection AND right-hand 1–5 weapon selection.
 */
export function evaluateHandFingers(
  handLandmarks: NormalizedLandmarkPoint[] | null,
  handWorldLandmarks: NormalizedLandmarkPoint[] | null,
  confidence = 1
): LeftHandGestureEval {
  if (!handLandmarks || handLandmarks.length < 21) {
    return {
      handDetected: false,
      confidence: 0,
      extendedFingers: [false, false, false, false, false],
      fingerCount: 0,
      isFist: false,
    };
  }

  const pts =
    handWorldLandmarks && handWorldLandmarks.length >= 21
      ? handWorldLandmarks
      : handLandmarks;
  const use3D = pts === handWorldLandmarks;

  const wrist = pts[HAND_LANDMARK.WRIST];
  const thumbCmc = pts[HAND_LANDMARK.THUMB_CMC];
  const thumbMcp = pts[HAND_LANDMARK.THUMB_MCP];
  const thumbIp = pts[HAND_LANDMARK.THUMB_IP];
  const thumbTip = pts[HAND_LANDMARK.THUMB_TIP];
  const indexMcp = pts[HAND_LANDMARK.INDEX_MCP];
  const indexPip = pts[HAND_LANDMARK.INDEX_PIP];
  const middleMcp = pts[HAND_LANDMARK.MIDDLE_MCP];
  const pinkyMcp = pts[HAND_LANDMARK.PINKY_MCP];

  const palmScale = Math.max(0.015, dist3(wrist, middleMcp));

  // Thumb: straight joint + clearly abducted away from index knuckle & pinky side of palm
  const thumbAngle = use3D
    ? calculateAngle3D(thumbCmc, thumbMcp, thumbTip)
    : calculateAngle2D(thumbCmc, thumbMcp, thumbTip);
  const thumbIpAngle = use3D
    ? calculateAngle3D(thumbMcp, thumbIp, thumbTip)
    : calculateAngle2D(thumbMcp, thumbIp, thumbTip);
  const thumbApartFromIndex = dist3(thumbTip, indexMcp) > palmScale * 0.56;
  const thumbOutFromPinky = dist3(thumbTip, pinkyMcp) > dist3(thumbMcp, pinkyMcp) * 1.12;
  const thumbExtended =
    thumbAngle >= 134 && thumbIpAngle >= 138 && thumbApartFromIndex && thumbOutFromPinky;

  const isDigitExtended = (mcpIdx: number, pipIdx: number, tipIdx: number): boolean => {
    const mcp = pts[mcpIdx];
    const pip = pts[pipIdx];
    const tip = pts[tipIdx];
    const angle = use3D
      ? calculateAngle3D(mcp, pip, tip)
      : calculateAngle2D(mcp, pip, tip);
    const dTip = dist3(tip, wrist);
    const dPip = dist3(pip, wrist);
    const dMcp = dist3(mcp, wrist);
    return angle >= 145 && dTip > dPip * 1.14 && dTip > dMcp * 1.32;
  };

  const indexExtended = isDigitExtended(
    HAND_LANDMARK.INDEX_MCP,
    HAND_LANDMARK.INDEX_PIP,
    HAND_LANDMARK.INDEX_TIP
  );
  const middleExtended = isDigitExtended(
    HAND_LANDMARK.MIDDLE_MCP,
    HAND_LANDMARK.MIDDLE_PIP,
    HAND_LANDMARK.MIDDLE_TIP
  );
  const ringExtended = isDigitExtended(
    HAND_LANDMARK.RING_MCP,
    HAND_LANDMARK.RING_PIP,
    HAND_LANDMARK.RING_TIP
  );
  const pinkyExtended = isDigitExtended(
    HAND_LANDMARK.PINKY_MCP,
    HAND_LANDMARK.PINKY_PIP,
    HAND_LANDMARK.PINKY_TIP
  );

  const extendedFingers: [boolean, boolean, boolean, boolean, boolean] = [
    thumbExtended,
    indexExtended,
    middleExtended,
    ringExtended,
    pinkyExtended,
  ];

  const fingerCount =
    Number(thumbExtended) +
    Number(indexExtended) +
    Number(middleExtended) +
    Number(ringExtended) +
    Number(pinkyExtended);

  // Strict fist: 0 extended fingers AND all four main fingertips folded inward toward palm
  const isDigitFolded = (pipIdx: number, tipIdx: number): boolean =>
    dist3(pts[tipIdx], wrist) < dist3(pts[pipIdx], wrist) * 1.15;

  const fourFolded =
    isDigitFolded(HAND_LANDMARK.INDEX_PIP, HAND_LANDMARK.INDEX_TIP) &&
    isDigitFolded(HAND_LANDMARK.MIDDLE_PIP, HAND_LANDMARK.MIDDLE_TIP) &&
    isDigitFolded(HAND_LANDMARK.RING_PIP, HAND_LANDMARK.RING_TIP) &&
    isDigitFolded(HAND_LANDMARK.PINKY_PIP, HAND_LANDMARK.PINKY_TIP);

  const thumbTucked =
    !thumbExtended &&
    (dist3(thumbTip, indexPip) < palmScale * 0.92 ||
      dist3(thumbTip, middleMcp) < palmScale * 0.94);

  const isFist = fingerCount === 0 && fourFolded && thumbTucked;

  return {
    handDetected: true,
    confidence,
    extendedFingers,
    fingerCount,
    isFist,
  };
}

export const evaluateLeftHandFingers = evaluateHandFingers;

/**
 * Checks whether both wrists are clearly raised above their corresponding shoulders.
 */
export function areBothHandsRaised(
  landmarks: NormalizedLandmarkPoint[],
  confidenceThreshold: number
): boolean {
  const lShoulder = landmarks[POSE_LANDMARK.LEFT_SHOULDER];
  const rShoulder = landmarks[POSE_LANDMARK.RIGHT_SHOULDER];
  const lWrist = landmarks[POSE_LANDMARK.LEFT_WRIST];
  const rWrist = landmarks[POSE_LANDMARK.RIGHT_WRIST];

  if (
    !isLandmarkReliable(lShoulder, confidenceThreshold) ||
    !isLandmarkReliable(rShoulder, confidenceThreshold) ||
    !isLandmarkReliable(lWrist, confidenceThreshold) ||
    !isLandmarkReliable(rWrist, confidenceThreshold)
  ) {
    return false;
  }

  const margin = 0.04;
  return lWrist.y < lShoulder.y - margin && rWrist.y < rShoulder.y - margin;
}
