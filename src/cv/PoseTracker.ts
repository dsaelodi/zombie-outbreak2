import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type HandLandmarkerResult,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { ASSET_CONFIG } from '../data/gameConfig';
import { logger } from '../utils/logger';

export interface DualTrackerResult {
  poseResult: PoseLandmarkerResult | null;
  handResult: HandLandmarkerResult | null;
}

export class PoseTracker {
  private poseLandmarker: PoseLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;
  private initializing: Promise<boolean> | null = null;
  private lastVideoTime = -1;

  public isReady(): boolean {
    return this.poseLandmarker !== null && this.handLandmarker !== null;
  }

  public async initialize(): Promise<boolean> {
    if (this.isReady()) return true;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          ASSET_CONFIG.mediapipeWasmPath
        );

        const createWithDelegate = async (delegate: 'GPU' | 'CPU') => {
          const [pose, hand] = await Promise.all([
            PoseLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: ASSET_CONFIG.poseModelPath,
                delegate,
              },
              runningMode: 'VIDEO',
              numPoses: 1,
              minPoseDetectionConfidence: 0.45,
              minPosePresenceConfidence: 0.45,
              minTrackingConfidence: 0.45,
            }),
            HandLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: ASSET_CONFIG.handModelPath,
                delegate,
              },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.45,
              minHandPresenceConfidence: 0.45,
              minTrackingConfidence: 0.45,
            }),
          ]);
          return { pose, hand };
        };

        try {
          const { pose, hand } = await createWithDelegate('GPU');
          this.poseLandmarker = pose;
          this.handLandmarker = hand;
        } catch {
          const { pose, hand } = await createWithDelegate('CPU');
          this.poseLandmarker = pose;
          this.handLandmarker = hand;
        }
        return true;
      } catch (err) {
        logger.error(
          'PoseTracker',
          'Failed to initialize MediaPipe PoseLandmarker / HandLandmarker',
          err
        );
        this.dispose();
        return false;
      } finally {
        this.initializing = null;
      }
    })();

    return this.initializing;
  }

  public detectForVideo(
    video: HTMLVideoElement,
    timestampMs: number
  ): DualTrackerResult | null {
    if (!this.poseLandmarker || !this.handLandmarker) return null;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }
    if (video.currentTime === this.lastVideoTime) {
      return null;
    }
    this.lastVideoTime = video.currentTime;

    try {
      const poseResult = this.poseLandmarker.detectForVideo(video, timestampMs);
      const handResult = this.handLandmarker.detectForVideo(video, timestampMs);
      return { poseResult, handResult };
    } catch (err) {
      logger.warn('PoseTracker', 'CV inference frame skipped', err);
      return null;
    }
  }

  public dispose(): void {
    if (this.poseLandmarker) {
      this.poseLandmarker.close();
      this.poseLandmarker = null;
    }
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
    this.lastVideoTime = -1;
  }
}
