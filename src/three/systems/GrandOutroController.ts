import * as THREE from 'three';
import type { EventBus } from '../../core/EventBus';
import { clamp, lerp } from '../../utils/math';
import type { CameraRig } from '../CameraRig';

export interface GrandOutroCallbacks {
  onSetDawnAtmosphere: (t01: number) => void;
  onStartCelebrationAudio: () => void;
  onCrowdCheerPulse: () => void;
}

export class GrandOutroController {
  private active = false;
  private elapsedSec = 0;
  private currentShot = 0;
  private endCardEmitted = false;
  private shot2AudioFired = false;
  private shot4AudioFired = false;

  private readonly _camPos = new THREE.Vector3();
  private readonly _lookAt = new THREE.Vector3();

  constructor(private readonly events: EventBus) {}

  public isActive(): boolean {
    return this.active;
  }

  public getCurrentShot(): number {
    return this.currentShot;
  }

  public start(cameraRig: CameraRig, callbacks: GrandOutroCallbacks): void {
    this.active = true;
    this.elapsedSec = 0;
    this.currentShot = 1;
    this.endCardEmitted = false;
    this.shot2AudioFired = false;
    this.shot4AudioFired = false;

    cameraRig.setWalkBobState(false, 0);
    cameraRig.setChaseSprintState(false, 0);
    cameraRig.setTargetFov(null);
    cameraRig.setCameraState('ARENA_EXIT', this.events);

    callbacks.onStartCelebrationAudio();
    callbacks.onSetDawnAtmosphere(0.18);

    this.emitShot(1, false, 0, {
      eyebrow: 'EPILOGUE · BEYOND THE GATE',
      title: 'INTO THE DAWN',
      subtitle: 'Stepping out of the Arena of the Dead into daylight...',
    });
  }

  public reset(cameraRig?: CameraRig): void {
    const wasActive = this.active;
    this.active = false;
    this.elapsedSec = 0;
    this.currentShot = 0;
    this.endCardEmitted = false;
    if (cameraRig) {
      cameraRig.setCinematicPose(false);
      cameraRig.setCameraState('NORMAL_FPS', this.events);
    }
    if (wasActive) {
      this.events.emit('outro:shot_changed', {
        active: false,
        shot: 0,
        totalShots: 6,
        eyebrow: '',
        title: '',
        subtitle: '',
        showEndCard: false,
        fadeAlpha: 0,
      });
    }
  }

  public update(dtSec: number, cameraRig: CameraRig, callbacks: GrandOutroCallbacks): void {
    if (!this.active) return;

    this.elapsedSec += dtSec;
    const t = this.elapsedSec;

    // Shot 1 (0.0 - 3.0s): Leaving Arena — exiting dark colosseum gate into warm sunlight
    if (t < 3.0) {
      const u = clamp(t / 3.0, 0, 1);
      const ease = u * u * (3 - 2 * u);
      callbacks.onSetDawnAtmosphere(0.18 + ease * 0.82);

      if (t >= 1.1 && cameraRig.getCameraState() !== 'OUTRO_CINEMATIC') {
        cameraRig.setCameraState('OUTRO_CINEMATIC', this.events);
      }

      this._camPos.set(lerp(0, 0.4, ease), lerp(1.75, 2.2, ease), lerp(-38.5, -48.5, ease));
      this._lookAt.set(0, lerp(2.0, 2.5, ease), lerp(-54, -62, ease));
      cameraRig.setCinematicPose(true, this._camPos, this._lookAt, lerp(62, 58, ease), 0, 6.0);
      return;
    }

    callbacks.onSetDawnAtmosphere(1.0);

    // Shot 2 (3.0 - 6.2s): First Crowd Reveal — sweeping across cheering human survivors
    if (t < 6.2) {
      const u = clamp((t - 3.0) / 3.2, 0, 1);
      const ease = u * u * (3 - 2 * u);
      if (this.currentShot !== 2) {
        this.currentShot = 2;
        if (!this.shot2AudioFired) {
          this.shot2AudioFired = true;
          callbacks.onCrowdCheerPulse();
        }
        this.emitShot(2, false, 0, {
          eyebrow: 'DAWN SANCTUARY PLAZA',
          title: 'THE SURVIVORS GATHER',
          subtitle: 'Humanity welcomes you back from the Abyss.',
        });
      }
      this._camPos.set(lerp(-5.6, 5.2, ease), lerp(2.15, 2.45, ease), lerp(-46.8, -50.2, ease));
      this._lookAt.set(lerp(-1.2, 0.8, ease), 1.85, -55.8);
      cameraRig.setCinematicPose(true, this._camPos, this._lookAt, 56, 0, 7.0);
      return;
    }

    // Shot 3 (6.2 - 9.8s): BINUS Message Reveal — focusing cleanly on wooden GABUNG BINUS & banner AYO GABUNG BINUS
    if (t < 9.8) {
      const u = clamp((t - 6.2) / 3.6, 0, 1);
      const ease = u * u * (3 - 2 * u);
      if (this.currentShot !== 3) {
        this.currentShot = 3;
        this.emitShot(3, false, 0, {
          eyebrow: 'HOPE & FUTURE',
          title: 'GABUNG BINUS · AYO GABUNG BINUS',
          subtitle: 'Stand together. Rebuild the future.',
        });
      }
      this._camPos.set(lerp(2.6, -1.8, ease), lerp(2.65, 3.15, ease), lerp(-47.2, -51.4, ease));
      this._lookAt.set(0, lerp(2.85, 3.35, ease), -58.5);
      cameraRig.setCinematicPose(true, this._camPos, this._lookAt, lerp(52, 50, ease), 0, 7.5);
      return;
    }

    // Shot 4 (9.8 - 13.0s): Celebration — clapping, jumping, waving flags in golden sunlight
    if (t < 13.0) {
      const u = clamp((t - 9.8) / 3.2, 0, 1);
      const ease = u * u * (3 - 2 * u);
      if (this.currentShot !== 4) {
        this.currentShot = 4;
        if (!this.shot4AudioFired) {
          this.shot4AudioFired = true;
          callbacks.onCrowdCheerPulse();
        }
        this.emitShot(4, false, 0, {
          eyebrow: 'VICTORY CELEBRATION',
          title: 'THE LONG NIGHT IS OVER',
          subtitle: 'Survivors celebrate across the courtyard.',
        });
      }
      this._camPos.set(lerp(-7.8, 7.4, ease), lerp(2.25, 2.75, ease), lerp(-54.2, -56.4, ease));
      this._lookAt.set(0, 2.1, -60.5);
      cameraRig.setCinematicPose(true, this._camPos, this._lookAt, 56, 0, 7.0);
      return;
    }

    // Shot 5 (13.0 - 17.8s): Outer Wide Cinematic — dramatic crane-up & pull-back framing Arena Fortress + BINUS plaza
    if (t < 17.8) {
      const u = clamp((t - 13.0) / 4.8, 0, 1);
      const ease = u * u * (3 - 2 * u);
      if (this.currentShot !== 5) {
        this.currentShot = 5;
        this.emitShot(5, false, 0, {
          eyebrow: 'GRAND FINALE',
          title: 'CAMPAIGN VICTORY',
          subtitle: 'The Colosseum stands behind you — a new era begins.',
        });
      }
      this._camPos.set(lerp(0.8, 4.2, ease), lerp(4.2, 13.6, ease), lerp(-54.5, -80.5, ease));
      this._lookAt.set(0, lerp(2.4, 3.2, ease), lerp(-56.0, -52.0, ease));
      cameraRig.setCinematicPose(true, this._camPos, this._lookAt, lerp(58, 60, ease), 0, 6.0);
      return;
    }

    // Shot 6 (17.8s+): Final End Card over continuous live celebratory BINUS plaza
    if (this.currentShot !== 6) {
      this.currentShot = 6;
      cameraRig.setCameraState('FINAL_END_CARD', this.events);
    }
    if (!this.endCardEmitted) {
      this.endCardEmitted = true;
      this.emitShot(6, true, 0, {
        eyebrow: 'CAMPAIGN COMPLETED',
        title: 'THE KING HAS FALLEN.',
        subtitle: 'THE SURVIVORS RISE.',
      });
    }

    // Gentle living panoramic drift overlooking the sunlit BINUS plaza behind the transparent End Card
    const drift = t - 17.8;
    this._camPos.set(
      4.2 + Math.sin(drift * 0.16) * 5.2,
      13.6 + Math.sin(drift * 0.24) * 0.85,
      -80.5 + Math.cos(drift * 0.14) * 2.2
    );
    this._lookAt.set(0, 3.0, -54.5);
    cameraRig.setCinematicPose(true, this._camPos, this._lookAt, 60, 0, 4.5);
  }

  private emitShot(
    shot: number,
    showEndCard: boolean,
    fadeAlpha: number,
    copy: { eyebrow: string; title: string; subtitle: string }
  ): void {
    this.events.emit('outro:shot_changed', {
      active: true,
      shot,
      totalShots: 6,
      eyebrow: copy.eyebrow,
      title: copy.title,
      subtitle: copy.subtitle,
      showEndCard,
      fadeAlpha,
    });
  }
}
