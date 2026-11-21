import type { IScreen } from '../app/ScreenManager';
import { audioManager } from '../audio/AudioManager';
import { ControlsGuideModal } from './ControlsGuideModal';
import type { SettingsModal } from './SettingsScreen';

export interface PauseCallbacks {
  onResume: () => void;
  onRestartStage: () => void;
  onExitToMenu: () => void;
}

export class PauseScreen implements IScreen {
  private root: HTMLDivElement | null = null;
  private controlsModal = new ControlsGuideModal();

  constructor(
    private readonly callbacks: PauseCallbacks,
    private readonly settingsModal: SettingsModal
  ) {}

  public mount(container: HTMLElement): void {
    const root = document.createElement('div');
    root.className =
      'w-full h-full flex items-center justify-center p-6 bg-black/75';

    root.innerHTML = `
      <div class="screen-panel w-full max-w-md p-6 md:p-8 shadow-2xl">
        <div class="border-b border-white/10 pb-4 mb-6 text-center">
          <div class="text-xs uppercase tracking-[0.22em] text-[#dc2626] font-semibold">Game Paused</div>
          <h2 class="font-horror text-4xl text-[#f4efe9] uppercase mt-1">Mission Paused</h2>
        </div>

        <div class="space-y-3">
          <button type="button" data-action="resume" class="btn-primary w-full py-3.5 text-lg font-bold">
            Resume
          </button>
          <button type="button" data-action="restart" class="btn-secondary w-full py-3 text-base font-semibold">
            Restart Stage
          </button>
          <button type="button" data-action="controls" class="btn-secondary w-full py-3 text-base font-semibold">
            Controls Guide
          </button>
          <button type="button" data-action="settings" class="btn-secondary w-full py-3 text-base font-semibold">
            Settings
          </button>
          <button type="button" data-action="menu" class="btn-secondary w-full py-3 text-base font-semibold text-[#fca5a5]">
            Exit to Main Menu
          </button>
        </div>
      </div>
    `;

    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      void audioManager.play('ui_click');

      if (action === 'resume') {
        this.callbacks.onResume();
      } else if (action === 'restart') {
        this.callbacks.onRestartStage();
      } else if (action === 'controls') {
        this.controlsModal.open(root);
      } else if (action === 'settings') {
        this.settingsModal.open(root);
      } else if (action === 'menu') {
        this.callbacks.onExitToMenu();
      }
    });

    container.appendChild(root);
    this.root = root;
  }

  public unmount(): void {
    this.controlsModal.close();
    this.root?.remove();
    this.root = null;
  }
}
