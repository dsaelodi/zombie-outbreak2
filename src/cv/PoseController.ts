import { DEFAULT_POSE_CONFIG, type PoseConfig } from '../data/gameConfig';
import { clamp, damp, lerp, StabilizedAimFilter } from '../utils/math';
import { CameraManager, type CameraResult } from './CameraManager';
import { GestureRecognizer } from './GestureRecognizer';
import {
  areBothHandsRaised,
  computeMirroredRightWristOffset,
  computeUpperBodyConfidence,
  evaluateHandFingers,
  evaluateRightFingerGun,
  isLandmarkReliable,
  selectDualHands,
} from './LandmarkUtils';
import { LeftHandGestureController } from './LeftHandGestureController';
import { PoseCalibration } from './PoseCalibration';
import { PoseTracker } from './PoseTracker';
import {
  HAND_LANDMARK,
  POSE_LANDMARK,
  type FingerGunEvaluation,
  type HandFingerEval,
  type NormalizedLandmarkPoint,
  type PoseDebugData,
  type TrackingStatus,
  type TriggerGestureState,
  type WeaponWheelGestureOutput,
} from './types';

export interface PoseFrameOutput {
  aimX: number; // -1..1
  aimY: number; // -1..1
  fireHeld: boolean;
  pauseTriggered: boolean;
  wheel: WeaponWheelGestureOutput;
  debug: PoseDebugData;
}

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [0, 13], [13, 14], [14, 15], [15, 16],// Ring
  [0, 17], [17, 18], [18, 19], [19, 20],// Pinky
  [5, 9], [9, 13], [13, 17],
];

const EMPTY_LEFT_EVAL: HandFingerEval = {
  handDetected: false,
  confidence: 0,
  extendedFingers: [false, false, false, false, false],
  fingerCount: 0,
  isFist: false,
};

const EMPTY_WHEEL_OUT: WeaponWheelGestureOutput = {
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

export class PoseController {
  public readonly camera = new CameraManager();
  public readonly tracker = new PoseTracker();
  public readonly calibration = new PoseCalibration();
  public readonly gestures = new GestureRecognizer();
  public readonly leftWheel = new LeftHandGestureController();

  private readonly aimFilter = new StabilizedAimFilter();

  private config: PoseConfig = { ...DEFAULT_POSE_CONFIG };
  private sensitivity = 1.45;

  private status: TrackingStatus = 'uninitialized';
  private lastErrorMessage = '';

  private targetAimX = 0;
  private targetAimY = 0;
  private smoothAimX = 0;
  private smoothAimY = 0;

  private lastInferenceTimeMs = 0;
  private lastAimFilterMs = 0;
  private inferenceCountWindow = 0;
  private inferenceRateTimerMs = 0;
  private measuredInferenceFps = 0;

  private lastReliablePoseMs = 0;
  private lastConfidence = 0;
  private lastPauseProgress = 0;
  private lastPoseLandmarks: NormalizedLandmarkPoint[] | null = null;
  private lastHandLandmarks: NormalizedLandmarkPoint[] | null = null;
  private lastLeftHandLandmarks: NormalizedLandmarkPoint[] | null = null;
  private visualRightHand: NormalizedLandmarkPoint[] | null = null;
  private visualLeftHand: NormalizedLandmarkPoint[] | null = null;
  private lastLeftEval: HandFingerEval = { ...EMPTY_LEFT_EVAL };
  private lastRightWheelEval: HandFingerEval = { ...EMPTY_LEFT_EVAL };
  private lastWheelOutput: WeaponWheelGestureOutput = { ...EMPTY_WHEEL_OUT };

  private lastFingerGun: FingerGunEvaluation = {
    handDetected: false,
    thumbExtended: false,
    otherFingersCurled: false,
    fingerGunStance: false,
    indexAngleDeg: 0,
  };
  private lastTriggerState: TriggerGestureState = 'NO_STANCE';
  private lastIndexAngleDeg = 165;
  private triggerStabilizeUntilMs = 0;
  private lastFireHeld = false;
  private lastOffset = { dx: 0, dy: 0 };

  public updateConfig(partial: Partial<PoseConfig>, sensitivity?: number): void {
    this.config = { ...this.config, ...partial };
    if (sensitivity !== undefined) {
      this.sensitivity = sensitivity;
    }
  }

  public getStatus(): TrackingStatus {
    return this.status;
  }

  public getErrorMessage(): string {
    return this.lastErrorMessage;
  }

  public isTrackingActive(): boolean {
    return this.status === 'tracking';
  }

  public isBodyVisible(): boolean {
    return this.status === 'tracking' && this.lastConfidence >= this.config.confidenceThreshold;
  }

  public getLastOffset(): { dx: number; dy: number } {
    return { ...this.lastOffset };
  }

  public async initializeSystem(): Promise<{ ok: boolean; message?: string }> {
    this.status = 'initializing';
    this.lastErrorMessage = '';

    const camRes: CameraResult = await this.camera.start(640, 480);
    if (!camRes.ok) {
      this.status = 'error';
      this.lastErrorMessage = camRes.message ?? 'Camera unavailable.';
      return { ok: false, message: this.lastErrorMessage };
    }

    const trackerOk = await this.tracker.initialize();
    if (!trackerOk) {
      this.status = 'error';
      this.lastErrorMessage =
        'Pose & hand tracking models failed to initialize. Switch to Mouse & Keyboard mode.';
      return { ok: false, message: this.lastErrorMessage };
    }

    this.status = 'ready';
    this.gestures.reset();
    this.leftWheel.reset();
    this.aimFilter.reset(0, 0);
    return { ok: true };
  }

  public stop(): void {
    this.camera.stop();
    this.gestures.reset();
    this.leftWheel.reset();
    this.aimFilter.reset(0, 0);
    this.status = 'uninitialized';
    this.lastPoseLandmarks = null;
    this.lastHandLandmarks = null;
    this.lastLeftHandLandmarks = null;
    this.visualRightHand = null;
    this.visualLeftHand = null;
    this.lastLeftEval = { ...EMPTY_LEFT_EVAL };
    this.lastRightWheelEval = { ...EMPTY_LEFT_EVAL };
    this.lastWheelOutput = { ...EMPTY_WHEEL_OUT };
    this.lastFireHeld = false;
    this.targetAimX = 0;
    this.targetAimY = 0;
    this.smoothAimX = 0;
    this.smoothAimY = 0;
  }

  public update(nowMs: number, dtSec: number): PoseFrameOutput {
    let pauseTriggered = false;
    let wheelFrameOutput: WeaponWheelGestureOutput = {
      ...this.lastWheelOutput,
      justOpened: false,
      justClosed: false,
      selectedWeapon: null,
    };

    const minIntervalMs = 1000 / Math.max(5, this.config.inferenceFps);

    if (
      this.camera.isActive() &&
      this.tracker.isReady() &&
      nowMs - this.lastInferenceTimeMs >= minIntervalMs
    ) {
      const filterDtSec =
        this.lastAimFilterMs > 0
          ? clamp((nowMs - this.lastAimFilterMs) / 1000, 1 / 60, 0.15)
          : 1 / Math.max(5, this.config.inferenceFps);
      this.lastInferenceTimeMs = nowMs;
      this.lastAimFilterMs = nowMs;

      const dual = this.tracker.detectForVideo(this.camera.getVideoElement(), nowMs);

      this.inferenceCountWindow++;
      if (nowMs - this.inferenceRateTimerMs >= 1000) {
        this.measuredInferenceFps = this.inferenceCountWindow;
        this.inferenceCountWindow = 0;
        this.inferenceRateTimerMs = nowMs;
      }

      if (dual) {
        const poseLms = (dual.poseResult?.landmarks?.[0] ?? null) as
          | NormalizedLandmarkPoint[]
          | null;
        this.lastPoseLandmarks = poseLms;

        const { rightHand, leftHand } = selectDualHands(dual.handResult, poseLms);
        this.lastHandLandmarks = rightHand.landmarks;
        this.lastLeftHandLandmarks = leftHand.landmarks;

        this.lastFingerGun = evaluateRightFingerGun(
          rightHand.landmarks,
          rightHand.worldLandmarks
        );
        this.lastLeftEval = evaluateHandFingers(
          leftHand.landmarks,
          leftHand.worldLandmarks,
          leftHand.confidence
        );
        this.lastRightWheelEval = evaluateHandFingers(
          rightHand.landmarks,
          rightHand.worldLandmarks,
          rightHand.confidence
        );

        wheelFrameOutput = this.leftWheel.update(
          nowMs,
          this.lastLeftEval,
          this.lastRightWheelEval
        );
        this.lastWheelOutput = wheelFrameOutput;

        const confStats = computeUpperBodyConfidence(poseLms ?? undefined);
        this.lastConfidence = confStats.averageConfidence;

        const rShoulder = poseLms?.[POSE_LANDMARK.RIGHT_SHOULDER];
        const rWrist = poseLms?.[POSE_LANDMARK.RIGHT_WRIST];

        const poseReliable =
          isLandmarkReliable(rShoulder, this.config.confidenceThreshold) &&
          (isLandmarkReliable(rWrist, this.config.confidenceThreshold) ||
            rightHand.landmarks !== null);

        if (poseReliable && poseLms) {
          this.status = 'tracking';
          this.lastReliablePoseMs = nowMs;

          const bothRaised = areBothHandsRaised(poseLms, this.config.confidenceThreshold);
          const gestureRes = this.gestures.update(
            nowMs,
            this.lastFingerGun,
            bothRaised,
            true,
            this.config
          );
          // Disable aiming & shooting while dual-hand weapon wheel is held open
          this.lastFireHeld = wheelFrameOutput.wheelOpen ? false : gestureRes.fireHeld;
          pauseTriggered = gestureRes.pauseTriggered;
          this.lastPauseProgress = gestureRes.pauseHoldProgress;

          const angleDelta = Math.abs(this.lastFingerGun.indexAngleDeg - this.lastIndexAngleDeg);
          if (
            this.lastFingerGun.handDetected &&
            (angleDelta > 7 || gestureRes.triggerState !== this.lastTriggerState)
          ) {
            this.triggerStabilizeUntilMs = nowMs + 160;
          }
          this.lastIndexAngleDeg = this.lastFingerGun.indexAngleDeg;
          this.lastTriggerState = gestureRes.triggerState;

          const triggerStabilizeFactor =
            nowMs < this.triggerStabilizeUntilMs
              ? 0.4
              : gestureRes.fireHeld
              ? 0.78
              : 1.0;

          if (!wheelFrameOutput.wheelOpen) {
            const offset = computeMirroredRightWristOffset(poseLms, rightHand.landmarks);
            if (offset) {
              this.lastOffset = offset;
              const cal = this.calibration.getData();
              const relX = offset.dx - cal.baselineOffsetX;
              const relY = offset.dy - cal.baselineOffsetY;

              const gainX = this.config.horizontalAimGain * this.sensitivity;
              const gainY = this.config.verticalAimGain * this.sensitivity;

              const rawAimX = clamp(relX * gainX, -0.94, 0.94);
              const rawAimY = clamp(-relY * gainY, -0.9, 0.9);

              const filtered = this.aimFilter.filter(
                rawAimX,
                rawAimY,
                filterDtSec,
                this.config.aimSmoothing,
                triggerStabilizeFactor
              );
              this.targetAimX = clamp(filtered.x, -0.94, 0.94);
              this.targetAimY = clamp(filtered.y, -0.9, 0.9);
            }
          }
        } else if (nowMs - this.lastReliablePoseMs > 450) {
          this.status = 'lost';
          this.lastFireHeld = false;
          const gestureRes = this.gestures.update(
            nowMs,
            this.lastFingerGun,
            false,
            false,
            this.config
          );
          this.lastPauseProgress = gestureRes.pauseHoldProgress;
        }
      }
    }

    const smoothLambda = lerp(18, 6.5, clamp(this.config.aimSmoothing, 0.05, 0.95));
    this.smoothAimX = damp(this.smoothAimX, this.targetAimX, smoothLambda, dtSec);
    this.smoothAimY = damp(this.smoothAimY, this.targetAimY, smoothLambda, dtSec);

    // Visually smooth real detected hand landmarks every frame to eliminate CV jitter without inventing fake points
    this.visualRightHand = smoothVisualHandLandmarks(this.visualRightHand, this.lastHandLandmarks, dtSec);
    this.visualLeftHand = smoothVisualHandLandmarks(this.visualLeftHand, this.lastLeftHandLandmarks, dtSec);

    return {
      aimX: this.smoothAimX,
      aimY: this.smoothAimY,
      fireHeld: wheelFrameOutput.wheelOpen ? false : this.lastFireHeld,
      pauseTriggered,
      wheel: wheelFrameOutput,
      debug: {
        status: this.status,
        confidence: this.lastConfidence,
        inferenceFps: this.measuredInferenceFps,
        indexAngleDeg: this.lastFingerGun.indexAngleDeg,
        fingerGunStance: this.lastFingerGun.fingerGunStance,
        thumbExtended: this.lastFingerGun.thumbExtended,
        otherFingersCurled: this.lastFingerGun.otherFingersCurled,
        handDetected: this.lastFingerGun.handDetected,
        triggerState: this.gestures.getTriggerState(),
        aimX: this.smoothAimX,
        aimY: this.smoothAimY,
        pauseHoldProgress: this.lastPauseProgress,
        bodyVisible: this.isBodyVisible(),
        poseLandmarks: this.lastPoseLandmarks,
        handLandmarks: this.lastHandLandmarks,
        leftHandDetected: this.lastLeftEval.handDetected,
        leftHandLandmarks: this.lastLeftHandLandmarks,
        leftFingerCount: this.lastLeftEval.fingerCount,
        leftIsFist: this.lastLeftEval.isFist,
        rightWheelFingerCount: this.lastRightWheelEval.fingerCount,
        weaponWheelOpen: wheelFrameOutput.wheelOpen,
        hoveredSlot: wheelFrameOutput.hoveredSlot,
        wheelLockProgress: wheelFrameOutput.lockProgress,
      },
    };
  }

  /**
   * Renders mirrored webcam video + lightweight glowing dual-hand 21-point skeletons & optional pose skeleton.
   */
  public renderPreviewCanvas(
    canvas: HTMLCanvasElement,
    showPoseSkeleton = true,
    showHandOverlay = true
  ): void {
    const ctx = canvas.getContext('2d');
    const video = this.camera.getVideoElement();
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (video.readyState >= 2) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = '#111417';
      ctx.fillRect(0, 0, w, h);
    }

    // 1. Optional upper-body pose skeleton (shown in setup, calibration, or F3 debug)
    if (showPoseSkeleton && this.lastPoseLandmarks) {
      const lms = this.lastPoseLandmarks;
      const toCanvas = (idx: number) => {
        const p = lms[idx];
        if (!p) return null;
        return {
          x: (1 - p.x) * w,
          y: p.y * h,
          reliable: isLandmarkReliable(p, this.config.confidenceThreshold),
        };
      };

      const poseConns: Array<[number, number]> = [
        [POSE_LANDMARK.LEFT_SHOULDER, POSE_LANDMARK.RIGHT_SHOULDER],
        [POSE_LANDMARK.LEFT_SHOULDER, POSE_LANDMARK.LEFT_ELBOW],
        [POSE_LANDMARK.LEFT_ELBOW, POSE_LANDMARK.LEFT_WRIST],
        [POSE_LANDMARK.RIGHT_SHOULDER, POSE_LANDMARK.RIGHT_ELBOW],
        [POSE_LANDMARK.RIGHT_ELBOW, POSE_LANDMARK.RIGHT_WRIST],
      ];

      ctx.lineWidth = 1.6;
      for (const [aIdx, bIdx] of poseConns) {
        const a = toCanvas(aIdx);
        const b = toCanvas(bIdx);
        if (!a || !b) continue;
        ctx.strokeStyle =
          a.reliable && b.reliable ? 'rgba(245,158,11,0.55)' : 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    if (!showHandOverlay) return;

    const scaleFactor = clamp(w / 320, 0.72, 1.55);

    // 2. Right hand (Aim + Finger-Gun Trigger OR 1-5 Wheel Selection when open)
    const rightLms = this.visualRightHand ?? this.lastHandLandmarks;
    if (rightLms && rightLms.length >= 21) {
      const wheelOpen = this.lastWheelOutput.wheelOpen;
      const triggerFiring = !wheelOpen && this.gestures.getTriggerState() === 'FIRING';
      const stanceReady = !wheelOpen && this.lastFingerGun.fingerGunStance;
      const primaryColor = wheelOpen
        ? '#38bdf8'
        : triggerFiring
        ? '#ff4444'
        : stanceReady
        ? '#22c55e'
        : '#fbbf24';
      const glowRgba = wheelOpen
        ? 'rgba(56, 189, 248, 0.36)'
        : triggerFiring
        ? 'rgba(255, 68, 68, 0.34)'
        : stanceReady
        ? 'rgba(34, 197, 94, 0.32)'
        : 'rgba(251, 191, 36, 0.30)';

      renderHandSkeletonOverlay(ctx, rightLms, w, h, scaleFactor, {
        lineColor: primaryColor,
        lineGlow: glowRgba,
        jointColor: primaryColor,
        palmColor: '#e2e8f0',
        tipColor: triggerFiring ? '#ffffff' : '#f8fafc',
        tipAccentColor: wheelOpen
          ? '#22d3ee'
          : triggerFiring
          ? '#ff3b3b'
          : stanceReady
          ? '#4ade80'
          : '#fbbf24',
        highlightIndexTip: triggerFiring,
      });

      if (wheelOpen) {
        const wristX = (1 - rightLms[0].x) * w;
        const wristY = rightLms[0].y * h;
        const rCount = this.lastRightWheelEval.fingerCount;
        const rLabel = `SEL ${rCount}F`;
        ctx.font = `bold ${Math.round(10 * scaleFactor)}px monospace`;
        const rx = clamp(wristX - 18, 4, w - 48);
        const ry = clamp(wristY + 16, 14, h - 5);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillText(rLabel, rx + 1, ry + 1);
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(rLabel, rx, ry);
      }
    }

    // 3. Left hand (Weapon Wheel HOLD Fist = Open, Open Hand = Close)
    const leftLms = this.visualLeftHand ?? this.lastLeftHandLandmarks;
    if (leftLms && leftLms.length >= 21) {
      const isFist = this.lastLeftEval.isFist;
      const wheelOpen = this.lastWheelOutput.wheelOpen;
      const primaryColor = isFist ? '#fbbf24' : '#94a3b8';
      const glowRgba = isFist
        ? 'rgba(251, 191, 36, 0.36)'
        : wheelOpen
        ? 'rgba(248, 113, 113, 0.28)'
        : 'rgba(148, 163, 184, 0.25)';

      renderHandSkeletonOverlay(ctx, leftLms, w, h, scaleFactor, {
        lineColor: primaryColor,
        lineGlow: glowRgba,
        jointColor: primaryColor,
        palmColor: '#fef3c7',
        tipColor: '#ffffff',
        tipAccentColor: isFist ? '#f59e0b' : '#cbd5e1',
        highlightIndexTip: false,
      });

      const wristX = (1 - leftLms[0].x) * w;
      const wristY = leftLms[0].y * h;
      const label = wheelOpen ? (isFist ? 'HOLD' : 'OPEN') : isFist ? 'FIST' : 'L-OPEN';
      ctx.font = `bold ${Math.round(10 * scaleFactor)}px monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      const lx = clamp(wristX - 16, 4, w - 46);
      const ly = clamp(wristY + 16, 14, h - 5);
      ctx.fillText(label, lx + 1, ly + 1);
      ctx.fillStyle = isFist ? '#fbbf24' : '#cbd5e1';
      ctx.fillText(label, lx, ly);
    }
  }

  public dispose(): void {
    this.stop();
    this.tracker.dispose();
  }
}

const FINGERTIP_INDICES = new Set<number>([
  HAND_LANDMARK.THUMB_TIP,
  HAND_LANDMARK.INDEX_TIP,
  HAND_LANDMARK.MIDDLE_TIP,
  HAND_LANDMARK.RING_TIP,
  HAND_LANDMARK.PINKY_TIP,
]);

const PALM_LANDMARK_INDICES = new Set<number>([
  HAND_LANDMARK.WRIST,
  1,
  HAND_LANDMARK.INDEX_MCP,
  HAND_LANDMARK.MIDDLE_MCP,
  13,
  HAND_LANDMARK.PINKY_MCP,
]);

const PALM_CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [0, 5],
  [0, 17],
  [5, 9],
  [9, 13],
  [13, 17],
];

export function smoothVisualHandLandmarks(
  prev: NormalizedLandmarkPoint[] | null,
  target: NormalizedLandmarkPoint[] | null,
  dtSec: number,
  lambda = 28
): NormalizedLandmarkPoint[] | null {
  if (!target || target.length === 0) return null;
  if (!prev || prev.length !== target.length) {
    return target.map((pt) => ({ ...pt }));
  }
  const safeDt = clamp(dtSec, 0.001, 0.1);
  for (let i = 0; i < target.length; i++) {
    prev[i].x = damp(prev[i].x, target[i].x, lambda, safeDt);
    prev[i].y = damp(prev[i].y, target[i].y, lambda, safeDt);
    prev[i].z = damp(prev[i].z, target[i].z, lambda, safeDt);
    prev[i].visibility = target[i].visibility;
  }
  return prev;
}

interface HandOverlayStyle {
  lineColor: string;
  lineGlow: string;
  jointColor: string;
  palmColor: string;
  tipColor: string;
  tipAccentColor: string;
  highlightIndexTip: boolean;
}

function renderHandSkeletonOverlay(
  ctx: CanvasRenderingContext2D,
  lms: NormalizedLandmarkPoint[],
  w: number,
  h: number,
  scaleFactor: number,
  style: HandOverlayStyle
): void {
  // Pass 1: Soft glow outer lines for high contrast against bright/dark webcam feeds
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.lineGlow;
  ctx.lineWidth = 3.2 * scaleFactor;
  ctx.beginPath();
  for (const [aIdx, bIdx] of HAND_CONNECTIONS) {
    const a = lms[aIdx];
    const b = lms[bIdx];
    ctx.moveTo((1 - a.x) * w, a.y * h);
    ctx.lineTo((1 - b.x) * w, b.y * h);
  }
  for (const [aIdx, bIdx] of PALM_CONNECTIONS) {
    const a = lms[aIdx];
    const b = lms[bIdx];
    ctx.moveTo((1 - a.x) * w, a.y * h);
    ctx.lineTo((1 - b.x) * w, b.y * h);
  }
  ctx.stroke();

  // Pass 2: Crisp thin inner skeleton lines
  ctx.strokeStyle = style.lineColor;
  ctx.lineWidth = 1.25 * scaleFactor;
  ctx.beginPath();
  for (const [aIdx, bIdx] of HAND_CONNECTIONS) {
    const a = lms[aIdx];
    const b = lms[bIdx];
    ctx.moveTo((1 - a.x) * w, a.y * h);
    ctx.lineTo((1 - b.x) * w, b.y * h);
  }
  ctx.stroke();

  // Pass 3: Distinct visual nodes (palm vs finger joints vs glowing fingertips)
  for (let i = 0; i < lms.length; i++) {
    const px = (1 - lms[i].x) * w;
    const py = lms[i].y * h;

    if (FINGERTIP_INDICES.has(i)) {
      const isTriggerTip = style.highlightIndexTip && i === HAND_LANDMARK.INDEX_TIP;
      const auraR = (isTriggerTip ? 7.2 : 5.4) * scaleFactor;
      const midR = (isTriggerTip ? 4.2 : 3.2) * scaleFactor;
      const coreR = (isTriggerTip ? 2.1 : 1.5) * scaleFactor;

      ctx.fillStyle = style.lineGlow;
      ctx.beginPath();
      ctx.arc(px, py, auraR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = style.tipAccentColor;
      ctx.beginPath();
      ctx.arc(px, py, midR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = style.tipColor;
      ctx.beginPath();
      ctx.arc(px, py, coreR, 0, Math.PI * 2);
      ctx.fill();
    } else if (PALM_LANDMARK_INDICES.has(i)) {
      const ringR = (i === 0 ? 3.8 : 2.9) * scaleFactor;
      const coreR = (i === 0 ? 1.9 : 1.4) * scaleFactor;

      ctx.fillStyle = 'rgba(10, 14, 18, 0.72)';
      ctx.beginPath();
      ctx.arc(px, py, ringR + 0.8 * scaleFactor, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = style.jointColor;
      ctx.lineWidth = 1.2 * scaleFactor;
      ctx.beginPath();
      ctx.arc(px, py, ringR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = style.palmColor;
      ctx.beginPath();
      ctx.arc(px, py, coreR, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const haloR = 3.2 * scaleFactor;
      const dotR = 1.8 * scaleFactor;

      ctx.fillStyle = 'rgba(10, 14, 18, 0.6)';
      ctx.beginPath();
      ctx.arc(px, py, haloR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = style.jointColor;
      ctx.beginPath();
      ctx.arc(px, py, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
