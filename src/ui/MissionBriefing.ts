import type { IScreen } from '../app/ScreenManager';
import { audioManager } from '../audio/AudioManager';
import type { GameSession } from '../core/GameSession';
import { STAGES } from '../data/stages';
import type { InputMode } from '../input/PlayerInput';

export interface MissionBriefingCallbacks {
  onStartMission: (stageIndex: number) => void;
  onSelectControlMode: (mode: InputMode) => void;
  onBackToMenu: () => void;
}

export class MissionBriefing implements IScreen {
  private root: HTMLDivElement | null = null;

  constructor(
    private readonly session: GameSession,
    private readonly getControlMode: () => InputMode,
    private readonly callbacks: MissionBriefingCallbacks
  ) {}

  public mount(container: HTMLElement): void {
    this.render(container);
  }

  private render(container: HTMLElement): void {
    if (this.root) this.root.remove();

    const root = document.createElement('div');
    root.className =
      'w-full h-full flex items-center justify-center p-6 bg-[#0a0c0e]/86';

    const stage = this.session.getCurrentStage();
    const mode = this.getControlMode();
    const developerMode = import.meta.env.DEV;

    root.innerHTML = `
      <div class="screen-panel w-full max-w-4xl p-6 md:p-8 shadow-2xl">
        ${
          developerMode
            ? '<div class="mb-4 border border-[#d97706]/35 bg-[#d97706]/10 px-3 py-2 text-[11px] font-mono-num font-bold uppercase tracking-[0.16em] text-[#fbbf24]">Developer Mode · All stages available</div>'
            : ''
        }
        <div class="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4 mb-6">
          <div class="flex flex-wrap items-center gap-2">
            ${STAGES.map((s, idx) => {
              const unlocked = idx <= this.session.unlockedStageIndex;
              const active = idx === this.session.stageIndex;
              const accessible = developerMode || unlocked;
              return `
                <button
                  type="button"
                  data-stage="${idx}"
                  ${accessible ? '' : 'disabled'}
                  class="px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider border transition-colors ${
                    active
                      ? 'bg-[#c92a2a] text-white border-[#c92a2a]'
                      : accessible
                      ? 'bg-white/[0.04] text-[#eceae4] border-white/15 hover:border-white/35'
                      : 'bg-white/[0.02] text-[#64748b] border-white/5 opacity-50 cursor-not-allowed'
                  }"
                >
                  Stage ${s.id} · ${s.name}${accessible ? '' : ' (Locked)'}
                </button>
              `;
            }).join('')}
          </div>

          <button type="button" data-action="menu" class="btn-secondary px-4 py-1.5 text-xs font-semibold">
            Main Menu
          </button>
        </div>

        <div class="mb-6">
          <div class="text-xs font-semibold uppercase tracking-[0.2em] text-[#d97706] mb-1">
            Stage ${stage.id} · ${stage.subtitle}
          </div>
          <h2 class="font-horror text-4xl md:text-5xl text-[#f4efe9] uppercase tracking-wide mb-3">
            ${stage.name}
          </h2>
          <p class="text-base text-[#c4c1b9] leading-relaxed max-w-2xl">
            ${stage.description}
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-white/[0.03] border border-white/10 mb-6">
          <div>
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Primary Objective</div>
            <div class="font-display text-xl font-bold text-white uppercase mt-0.5">${stage.objectiveLabel}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Waves &amp; Timer</div>
            <div class="font-mono-num text-base font-semibold text-white mt-1">
              ${stage.waves.length} Wave${stage.waves.length > 1 ? 's' : ''} · ${
      stage.timeLimitSec !== null ? `${stage.timeLimitSec}s Limit` : 'No Time Limit'
    }
            </div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Active Controls</div>
            <div class="text-sm font-semibold text-[#eceae4] mt-1">
              ${mode === 'pose' ? 'Dual-Hand Webcam Tracking' : 'Mouse & Keyboard'}
            </div>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <button type="button" data-action="toggle-mode" class="btn-secondary px-4 py-2.5 text-xs font-semibold w-full sm:w-auto">
            Switch to ${mode === 'pose' ? 'Mouse & Keyboard' : 'Webcam Body Tracking'}
          </button>

          <button type="button" data-action="start" class="btn-primary px-9 py-3.5 text-xl font-bold w-full sm:w-auto">
            Deploy to Stage ${stage.id}
          </button>
        </div>
      </div>
    `;

    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const stageBtn = target.closest('[data-stage]') as HTMLElement | null;
      if (stageBtn && stageBtn.dataset.stage !== undefined) {
        const idx = Number.parseInt(stageBtn.dataset.stage, 10);
        const validStage = Number.isInteger(idx) && idx >= 0 && idx < STAGES.length;
        if (validStage && (developerMode || idx <= this.session.unlockedStageIndex)) {
          void audioManager.play('ui_click');
          this.session.stageIndex = idx;
          this.render(container);
        }
        return;
      }

      const actionBtn = target.closest('[data-action]') as HTMLElement | null;
      if (!actionBtn) return;
      const action = actionBtn.dataset.action;
      void audioManager.play('ui_click');

      if (action === 'menu') {
        this.callbacks.onBackToMenu();
      } else if (action === 'toggle-mode') {
        const nextMode: InputMode = mode === 'pose' ? 'mouse' : 'pose';
        this.callbacks.onSelectControlMode(nextMode);
        this.render(container);
      } else if (action === 'start') {
        void audioManager.play('mission_start');
        this.callbacks.onStartMission(this.session.stageIndex);
      }
    });

    container.appendChild(root);
    this.root = root;
  }

  public unmount(): void {
    this.root?.remove();
    this.root = null;
  }
}
