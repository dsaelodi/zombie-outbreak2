import { logger } from '../utils/logger';

export type CameraErrorReason =
  | 'unsupported'
  | 'permission_denied'
  | 'not_found'
  | 'in_use'
  | 'unknown';

export interface CameraResult {
  ok: boolean;
  reason?: CameraErrorReason;
  message?: string;
}

export class CameraManager {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement;

  constructor() {
    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;
  }

  public getVideoElement(): HTMLVideoElement {
    return this.videoElement;
  }

  public isActive(): boolean {
    return Boolean(this.stream && this.videoElement.readyState >= 2);
  }

  public async start(width = 640, height = 480): Promise<CameraResult> {
    if (this.stream && this.videoElement.readyState >= 2) {
      return { ok: true };
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return {
        ok: false,
        reason: 'unsupported',
        message: 'Camera API is unavailable in this browser context. Use Mouse & Keyboard mode.',
      };
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          facingMode: 'user',
        },
        audio: false,
      });

      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();
      return { ok: true };
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      logger.warn('CameraManager', 'Webcam initialization failed', err);

      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return {
          ok: false,
          reason: 'permission_denied',
          message:
            'Camera permission was denied. Allow camera access in your browser bar or switch to Mouse & Keyboard.',
        };
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return {
          ok: false,
          reason: 'not_found',
          message: 'No webcam device was detected. Connect a camera or use Mouse & Keyboard.',
        };
      }
      if (name === 'NotReadableError' || name === 'TrackStartError') {
        return {
          ok: false,
          reason: 'in_use',
          message: 'Webcam is currently used by another application.',
        };
      }
      return {
        ok: false,
        reason: 'unknown',
        message: 'Could not initialize webcam stream. You can play using Mouse & Keyboard.',
      };
    }
  }

  public stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.videoElement.srcObject = null;
  }
}
