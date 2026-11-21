import type { IScreen } from '../app/ScreenManager';
import { audioManager } from '../audio/AudioManager';
import type { PoseController } from '../cv/PoseController';

export interface CameraSetupCallbacks {
  onContinueToCalibration: () => void;
  onUseMouseFallback: () => void;
  onBack: () => void;
}

export class CameraSetup implements IScreen {
  private root: HTMLDivElement | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private statusEl: HTMLElement | null = null;
  private bodyStatusEl: HTMLElement | null = null;
  private errorBoxEl: HTMLElement | null = null;
  private continueBtn: HTMLButtonElement | null = null;
  private rafId = 0;
  private disposed = false;

  constructor(
    private readonly poseController: PoseController,
    private readonly callbacks: CameraSetupCallbacks
  ) {}

  public mount(container: HTMLElement): void {
    this.disposed = false;
    const root = document.createElement('div');
    root.className =
      'w-full h-full flex items-center justify-center p-6 bg-[#0a0c0e]/85';

    root.innerHTML = `
      <div class="screen-panel w-full max-w-4xl p-6 md:p-8 shadow-2xl">
        <div class="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
          <div>
            <div class="text-xs uppercase tracking-[0.22em] text-[#dc2626] font-semibold">Step 1 of 2</div>
            <h2 class="font-horror text-3xl md:text-4xl text-[#f4efe9] uppercase">Webcam &amp; Pose Setup</h2>
          </div>
          <button type="button" data-action="back" class="btn-secondary px-4 py-2 text-sm font-semibold">Back</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
          <!-- Preview -->
          <div class="md:col-span-7 bg-[#060809] border border-white/10 flex flex-col justify-between overflow-hidden">
            <canvas width="640" height="480" data-preview class="w-full aspect-[4/3] object-cover block"></canvas>
            <div class="px-4 py-2.5 border-t border-white/10 flex items-center justify-between text-xs font-mono-num bg-[#0e1114]">
              <span data-status class="text-[#eceae4]">Initializing camera &amp; pose model...</span>
              <span data-body-status class="text-[#9ba1a6]">Waiting for pose</span>
            </div>
          </div>

          <!-- Instructions & Fallback -->
          <div class="md:col-span-5 flex flex-col justify-between gap-5">
            <div class="space-y-4">
              <h3 class="font-display text-xl font-bold text-white uppercase">Booth Positioning</h3>
              <ul class="space-y-2.5 text-sm text-[#c4c1b9]">
                <li>1. Allow browser webcam permission when prompted.</li>
                <li>2. Stand 1.5–2.5 meters back so your shoulders and right hand are clearly visible.</li>
                <li>3. Raise your right hand in front of you to form a finger-gun stance.</li>
              </ul>

              <div data-error-box class="hidden p-3.5 bg-[#c92a2a]/15 border border-[#c92a2a]/50 text-sm text-[#fca5a5]"></div>
            </div>

            <div class="space-y-3 pt-4 border-t border-white/10">
              <button type="button" data-action="continue" disabled class="btn-primary w-full py-3.5 text-lg font-bold">
                Continue to Calibration
              </button>
              <button type="button" data-action="mouse" class="btn-secondary w-full py-3 text-sm font-semibold">
                Use Mouse &amp; Keyboard Instead
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.previewCanvas = root.querySelector('[data-preview]');
    this.statusEl = root.querySelector('[data-status]');
    this.bodyStatusEl = root.querySelector('[data-body-status]');
    this.errorBoxEl = root.querySelector('[data-error-box]');
    this.continueBtn = root.querySelector('[data-action="continue"]');

    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      void audioManager.play('ui_click');

      if (action === 'back') {
        this.callbacks.onBack();
      } else if (action === 'continue') {
        void audioManager.play('ui_select');
        this.callbacks.onContinueToCalibration();
      } else if (action === 'mouse') {
        void audioManager.play('ui_select');
        this.callbacks.onUseMouseFallback();
      }
    });

    container.appendChild(root);
    this.root = root;

    void this.initCamera();
    this.loopPreview();
  }

  private async initCamera(): Promise<void> {
    const res = await this.poseController.initializeSystem();
    if (this.disposed) return;

    if (!res.ok) {
      if (this.statusEl) this.statusEl.textContent = 'Camera unavailable';
      if (this.bodyStatusEl) this.bodyStatusEl.textContent = 'Use Mouse Fallback';
      if (this.errorBoxEl) {
        this.errorBoxEl.textContent =
          res.message ?? 'Camera unavailable. Switch to Mouse & Keyboard.';
        this.errorBoxEl.classList.remove('hidden');
      }
      if (this.continueBtn) this.continueBtn.disabled = true;
      return;
    }

    if (this.statusEl) this.statusEl.textContent = 'Pose Landmarker Ready';
    if (this.continueBtn) this.continueBtn.disabled = false;
  }

  private loopPreview = (): void => {
    if (this.disposed) return;
    const now = performance.now();
    const out = this.poseController.update(now, 1 / 60);

    if (this.previewCanvas) {
      this.poseController.renderPreviewCanvas(this.previewCanvas, true);
    }

    if (this.poseController.getStatus() !== 'error') {
      if (this.statusEl) {
        this.statusEl.textContent =
          out.debug.status === 'tracking'
            ? `Tracking Active (${Math.round(out.debug.confidence * 100)}%)`
            : out.debug.status === 'initializing'
            ? 'Initializing camera & pose model...'
            : 'Stand in camera view';
      }
      if (this.bodyStatusEl) {
        if (out.debug.bodyVisible) {
          this.bodyStatusEl.textContent = 'Upper body visible';
          this.bodyStatusEl.className = 'text-[#22c55e]';
        } else {
          this.bodyStatusEl.textContent = 'Body not detected';
          this.bodyStatusEl.className = 'text-[#d97706]';
        }
      }
    }

    this.rafId = requestAnimationFrame(this.loopPreview);
  };

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
