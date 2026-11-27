import type { IScreen } from '../app/ScreenManager';
import { audioManager } from '../audio/AudioManager';
import type { PoseController } from '../cv/PoseController';
import type { UserSettings } from '../data/gameConfig';

export interface CalibrationCallbacks {
  onCalibrationComplete: () => void;
  onUseMouseFallback: () => void;
  onBack: () => void;
}

export class CalibrationScreen implements IScreen {
  private root: HTMLDivElement | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private testCrosshair: HTMLElement | null = null;
  private angleTextEl: HTMLElement | null = null;
  private angleBarEl: HTMLElement | null = null;
  private statusBadgeEl: HTMLElement | null = null;
  private stanceBadgeEl: HTMLElement | null = null;
  private step1El: HTMLElement | null = null;
  private step2El: HTMLElement | null = null;
  private step3El: HTMLElement | null = null;
  private confirmBtn: HTMLButtonElement | null = null;

  private rafId = 0;
  private disposed = false;
  private testFireTimerMs = 0;
  private lastTickMs = 0;

  private bodyConfirmed = false;
  private stanceConfirmed = false;
  private smgTestPassed = false;
  private releaseTestPassed = false;
  private baselineCaptured = false;

  constructor(
    private readonly poseController: PoseController,
    private readonly getSettings: () => UserSettings,
    private readonly callbacks: CalibrationCallbacks
  ) {}

  public mount(container: HTMLElement): void {
    this.disposed = false;
    this.bodyConfirmed = false;
    this.stanceConfirmed = false;
    this.smgTestPassed = false;
    this.releaseTestPassed = false;
    this.baselineCaptured = false;
    this.testFireTimerMs = 0;
    this.lastTickMs = performance.now();
    this.poseController.calibration.reset();

    const root = document.createElement('div');
    root.className =
      'w-full h-full flex items-center justify-center p-6 bg-[#0a0c0e]/85';

    const settings = this.getSettings();

    root.innerHTML = `
      <div class="screen-panel w-full max-w-5xl p-6 md:p-8 shadow-2xl">
        <div class="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
          <div>
            <div class="text-xs uppercase tracking-[0.22em] text-[#dc2626] font-semibold">Step 2 of 2</div>
            <h2 class="font-horror text-3xl md:text-4xl text-[#f4efe9] uppercase">Right-Hand Calibration</h2>
          </div>
          <button type="button" data-action="back" class="btn-secondary px-4 py-2 text-sm font-semibold">Back</button>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <!-- Interactive Webcam + Live Test Crosshair -->
          <div class="lg:col-span-7 flex flex-col bg-[#060809] border border-white/10 overflow-hidden">
            <div class="relative w-full aspect-[4/3] overflow-hidden">
              <canvas width="640" height="480" data-preview class="w-full h-full object-cover block"></canvas>
              <!-- Test Aim Crosshair inside Preview -->
              <div data-crosshair class="absolute w-9 h-9 -ml-[18px] -mt-[18px] pointer-events-none transition-transform duration-75" style="left:50%;top:50%;">
                <svg viewBox="0 0 36 36" class="w-full h-full">
                  <circle cx="18" cy="18" r="11" fill="none" stroke="#ef4444" stroke-width="2" />
                  <circle cx="18" cy="18" r="2.2" fill="#ffffff" />
                  <line x1="18" y1="2" x2="18" y2="9" stroke="#ef4444" stroke-width="2" />
                  <line x1="18" y1="27" x2="18" y2="34" stroke="#ef4444" stroke-width="2" />
                  <line x1="2" y1="18" x2="9" y2="18" stroke="#ef4444" stroke-width="2" />
                  <line x1="27" y1="18" x2="34" y2="18" stroke="#ef4444" stroke-width="2" />
                </svg>
              </div>
            </div>

            <!-- Live Index Finger Curl Gauge -->
            <div class="p-3.5 border-t border-white/10 bg-[#0e1114] space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-num">
                <span data-status-badge class="text-[#d97706]">Checking tracking...</span>
                <span data-stance-badge class="text-[#9ba1a6]">Finger-Gun: Not Detected</span>
                <span class="text-[#eceae4]">Index Angle: <strong data-angle-text class="text-white">0°</strong> (Fire &le; ${settings.triggerCurlAngleDeg}°)</span>
              </div>
              <div class="w-full h-2 bg-white/10 overflow-hidden">
                <div data-angle-bar class="h-full bg-[#d97706] transition-all duration-75" style="width: 0%;"></div>
              </div>
            </div>
          </div>

          <!-- Checklist & Controls -->
          <div class="lg:col-span-5 flex flex-col justify-between gap-5">
            <div class="space-y-3">
              <div data-step-1 class="p-3.5 border border-white/10 bg-white/[0.03]">
                <div class="font-display text-lg font-bold text-white uppercase">1. Right Hand in Frame</div>
                <p class="text-xs text-[#9ba1a6] mt-0.5">Hold your right hand comfortably in front of your shoulder to steer the stabilized crosshair.</p>
              </div>

              <div data-step-2 class="p-3.5 border border-white/10 bg-white/[0.03]">
                <div class="font-display text-lg font-bold text-white uppercase">2. Form Finger-Gun Stance</div>
                <p class="text-xs text-[#9ba1a6] mt-0.5">Extend only your thumb and index finger; keep middle, ring, and pinky curled.</p>
              </div>

              <div data-step-3 class="p-3.5 border border-white/10 bg-white/[0.03]">
                <div class="font-display text-lg font-bold text-white uppercase">3. Curl Index Finger for SMG Burst</div>
                <p class="text-xs text-[#9ba1a6] mt-0.5">Pull your right index finger (&le; ${settings.triggerCurlAngleDeg}°) like a trigger to fire continuous SMG rounds, then straighten (&ge; ${settings.triggerReleaseAngleDeg}°) to stop.</p>
              </div>

              <button type="button" data-action="recenter" class="btn-secondary w-full py-2.5 text-xs font-semibold">
                Set Current Right-Hand Position as Aim Center
              </button>
            </div>

            <div class="space-y-3 pt-4 border-t border-white/10">
              <button type="button" data-action="confirm" disabled class="btn-primary w-full py-3.5 text-lg font-bold">
                Calibration Incomplete
              </button>
              <button type="button" data-action="mouse" class="btn-secondary w-full py-2.5 text-sm font-semibold">
                Switch to Mouse &amp; Keyboard
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.previewCanvas = root.querySelector('[data-preview]');
    this.testCrosshair = root.querySelector('[data-crosshair]');
    this.angleTextEl = root.querySelector('[data-angle-text]');
    this.angleBarEl = root.querySelector('[data-angle-bar]');
    this.statusBadgeEl = root.querySelector('[data-status-badge]');
    this.stanceBadgeEl = root.querySelector('[data-stance-badge]');
    this.step1El = root.querySelector('[data-step-1]');
    this.step2El = root.querySelector('[data-step-2]');
    this.step3El = root.querySelector('[data-step-3]');
    this.confirmBtn = root.querySelector('[data-action="confirm"]');

    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      void audioManager.play('ui_click');

      if (action === 'back') {
        this.callbacks.onBack();
      } else if (action === 'recenter') {
        const offset = this.poseController.getLastOffset();
        this.poseController.calibration.markCalibratedWithCurrent(offset.dx, offset.dy);
        this.baselineCaptured = true;
      } else if (action === 'confirm') {
        this.poseController.calibration.finalize();
        void audioManager.play('ui_select');
        this.callbacks.onCalibrationComplete();
      } else if (action === 'mouse') {
        void audioManager.play('ui_select');
        this.callbacks.onUseMouseFallback();
      }
    });

    container.appendChild(root);
    this.root = root;
    this.loopCalibration();
  }

  private loopCalibration = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    const dtMs = Math.min(100, Math.max(1, now - this.lastTickMs));
    this.lastTickMs = now;

    const out = this.poseController.update(now, dtMs / 1000);
    const settings = this.getSettings();

    if (this.previewCanvas) {
      this.poseController.renderPreviewCanvas(this.previewCanvas, true);
    }

    if (this.testCrosshair) {
      const pctX = (out.aimX * 0.5 + 0.5) * 100;
      const pctY = (-out.aimY * 0.5 + 0.5) * 100;
      this.testCrosshair.style.left = `${pctX}%`;
      this.testCrosshair.style.top = `${pctY}%`;
    }

    const angle = Math.round(out.debug.indexAngleDeg);
    if (this.angleTextEl) this.angleTextEl.textContent = `${angle}°`;
    if (this.angleBarEl) {
      const pct = Math.max(0, Math.min(100, ((180 - angle) / 110) * 100));
      this.angleBarEl.style.width = `${out.debug.handDetected ? pct : 0}%`;
      this.angleBarEl.style.backgroundColor = out.fireHeld
        ? '#c92a2a'
        : out.debug.fingerGunStance
        ? '#22c55e'
        : '#d97706';
    }

    const trackingReady =
      out.debug.status === 'tracking' && out.debug.bodyVisible;

    if (this.statusBadgeEl) {
      if (trackingReady) {
        this.statusBadgeEl.textContent = `Right Arm Ready (${Math.round(out.debug.confidence * 100)}%)`;
        this.statusBadgeEl.className = 'text-[#22c55e]';
      } else {
        this.statusBadgeEl.textContent = 'Tracking Lost — Step into view';
        this.statusBadgeEl.className = 'text-[#ef4444]';
      }
    }

    if (this.stanceBadgeEl) {
      if (!out.debug.handDetected) {
        this.stanceBadgeEl.textContent = 'Right Hand: Not Detected';
        this.stanceBadgeEl.className = 'text-[#9ba1a6]';
      } else if (out.fireHeld) {
        this.stanceBadgeEl.textContent = 'Trigger Pulled (SMG Firing)';
        this.stanceBadgeEl.className = 'text-[#ef4444]';
      } else if (out.debug.fingerGunStance) {
        this.stanceBadgeEl.textContent = 'Finger-Gun: Active';
        this.stanceBadgeEl.className = 'text-[#22c55e]';
      } else {
        this.stanceBadgeEl.textContent = 'Form Finger-Gun (Thumb + Index Out)';
        this.stanceBadgeEl.className = 'text-[#d97706]';
      }
    }

    if (trackingReady) {
      this.bodyConfirmed = true;
      const offset = this.poseController.getLastOffset();
      if (!out.fireHeld) {
        this.poseController.calibration.recordReadySample(offset.dx, offset.dy, angle);
        if (!this.baselineCaptured) {
          this.baselineCaptured = true;
          this.poseController.calibration.markCalibratedWithCurrent(offset.dx, offset.dy);
        }
      }

      if (out.debug.fingerGunStance) {
        this.stanceConfirmed = true;
      }

      if (this.testFireTimerMs > 0) {
        this.testFireTimerMs -= dtMs;
      }

      if (out.fireHeld) {
        this.smgTestPassed = true;
        this.poseController.calibration.recordCurledSample(angle);
        if (this.testFireTimerMs <= 0) {
          this.testFireTimerMs = 105;
          void audioManager.play('gunshot', {
            volume: 0.65,
            playbackRate: 1.08 + Math.random() * 0.1,
          });
          if (this.testCrosshair) {
            this.testCrosshair.style.transform = 'scale(1.32)';
            setTimeout(() => {
              if (this.testCrosshair) this.testCrosshair.style.transform = 'scale(1)';
            }, 65);
          }
        }
      } else if (this.smgTestPassed && out.debug.fingerGunStance && angle >= settings.triggerReleaseAngleDeg) {
        this.releaseTestPassed = true;
      }
    }

    this.markStep(this.step1El, this.bodyConfirmed);
    this.markStep(this.step2El, this.stanceConfirmed);
    this.markStep(this.step3El, this.smgTestPassed && this.releaseTestPassed);

    const readyToProceed =
      trackingReady &&
      this.bodyConfirmed &&
      this.stanceConfirmed &&
      this.smgTestPassed &&
      this.releaseTestPassed;

    if (this.confirmBtn) {
      this.confirmBtn.disabled = !readyToProceed;
      this.confirmBtn.textContent = !trackingReady
        ? 'Pose Tracking Unavailable'
        : readyToProceed
        ? 'Confirm & Continue'
        : 'Complete Steps 1–3 Above';
    }

    this.rafId = requestAnimationFrame(this.loopCalibration);
  };

  private markStep(el: HTMLElement | null, done: boolean): void {
    if (!el) return;
    el.style.borderColor = done ? 'rgba(34, 197, 94, 0.7)' : 'rgba(255, 255, 255, 0.1)';
    el.style.backgroundColor = done
      ? 'rgba(34, 197, 94, 0.08)'
      : 'rgba(255, 255, 255, 0.03)';
  }

  public unmount(): void {
    this.disposed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.root?.remove();
    this.root = null;
  }
}
