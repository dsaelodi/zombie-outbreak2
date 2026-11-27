import type { IScreen } from '../app/ScreenManager';
import { audioManager } from '../audio/AudioManager';
import type { GameSession } from '../core/GameSession';
import { formatTime } from '../utils/math';

export interface ResultCallbacks {
  onNextStage: (nextStageIndex: number) => void;
  onRetryStage: (stageIndex: number) => void;
  onMainMenu: () => void;
}

export class ResultScreen implements IScreen {
  private root: HTMLDivElement | null = null;

  constructor(
    private readonly session: GameSession,
    private readonly callbacks: ResultCallbacks
  ) {}

  public mount(container: HTMLElement): void {
    const result = this.session.lastResult ?? this.session.buildResult(false, 'Mission ended.');

    const root = document.createElement('div');
    root.className =
      'w-full h-full flex items-center justify-center p-6 bg-[#0a0c0e]/88';

    const titleText = result.campaignVictory
      ? 'CAMPAIGN COMPLETED'
      : result.completed
      ? 'Stage Completed'
      : 'Mission Failed';

    const eyebrowColor = result.campaignVictory
      ? 'text-[#fbbf24]'
      : result.completed
      ? 'text-[#22c55e]'
      : 'text-[#ef4444]';

    root.innerHTML = `
      <div class="screen-panel w-full max-w-2xl p-6 md:p-8 shadow-2xl">
        <div class="border-b border-white/10 pb-5 mb-6">
          <div class="text-xs font-semibold uppercase tracking-[0.2em] ${eyebrowColor}">
            ${result.campaignVictory ? 'All 4 Stages Cleared · ' : ''}Stage ${result.stageId} · ${result.stageName}
          </div>
          <h2 class="font-horror text-5xl uppercase tracking-wide mt-1 ${
            result.campaignVictory
              ? 'text-[#fbbf24]'
              : result.completed
              ? 'text-[#f4efe9]'
              : 'text-[#ef4444]'
          }">
            ${titleText}
          </h2>
          ${
            result.campaignVictory
              ? `<div class="mt-3 px-4 py-2.5 bg-[#1a0508]/90 border-l-2 border-[#dc2626] font-mono-num text-xs uppercase tracking-[0.2em] text-[#fecaca]">THE KING HAS FALLEN — THE OUTBREAK IS NOT FORGOTTEN</div>`
              : ''
          }
          <p class="text-sm text-[#c4c1b9] mt-2">${result.reason}</p>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
          <div class="p-4 bg-white/[0.03] border border-white/10">
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Campaign Score</div>
            <div class="font-mono-num text-2xl font-bold text-white mt-1">${result.score.toLocaleString()}</div>
          </div>

          <div class="p-4 bg-white/[0.03] border border-white/10">
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Zombies Eliminated</div>
            <div class="font-mono-num text-2xl font-bold text-[#d97706] mt-1">${result.kills}</div>
          </div>

          <div class="p-4 bg-white/[0.03] border border-white/10">
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Accuracy</div>
            <div class="font-mono-num text-2xl font-bold text-white mt-1">${result.accuracyPercent}%</div>
          </div>

          <div class="p-4 bg-white/[0.03] border border-white/10">
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Shots Fired</div>
            <div class="font-mono-num text-xl font-semibold text-[#eceae4] mt-1">${result.shotsFired}</div>
          </div>

          <div class="p-4 bg-white/[0.03] border border-white/10">
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Successful Hits</div>
            <div class="font-mono-num text-xl font-semibold text-[#eceae4] mt-1">${result.shotsHit}</div>
          </div>

          <div class="p-4 bg-white/[0.03] border border-white/10">
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Duration</div>
            <div class="font-mono-num text-xl font-semibold text-[#eceae4] mt-1">${formatTime(result.elapsedSec)}</div>
          </div>
        </div>

        <div class="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-white/10">
          <button type="button" data-action="menu" class="btn-secondary px-5 py-3 text-sm font-semibold w-full sm:w-auto">
            Main Menu
          </button>

          <div class="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            <button type="button" data-action="retry" class="btn-secondary px-6 py-3 text-base font-bold w-full sm:w-auto">
              ${result.campaignVictory ? 'Replay Stage 4' : 'Retry Stage'}
            </button>
            ${
              result.hasNextStage
                ? `<button type="button" data-action="next" class="btn-primary px-8 py-3 text-lg font-bold w-full sm:w-auto">Next Stage</button>`
                : ''
            }
          </div>
        </div>
      </div>
    `;

    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      void audioManager.play('ui_click');

      if (action === 'next') {
        void audioManager.play('ui_select');
        this.callbacks.onNextStage(result.stageIndex + 1);
      } else if (action === 'retry') {
        void audioManager.play('ui_select');
        this.callbacks.onRetryStage(result.stageIndex);
      } else if (action === 'menu') {
        this.callbacks.onMainMenu();
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
