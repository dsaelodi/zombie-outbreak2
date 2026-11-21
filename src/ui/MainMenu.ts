import { audioManager } from '../audio/AudioManager';
import type { IScreen } from '../app/ScreenManager';
import type { EventBus, ShowcaseState } from '../core/EventBus';
import { ControlsGuideModal } from './ControlsGuideModal';
import { SettingsModal } from './SettingsScreen';

export interface MainMenuCallbacks {
  onPlay: () => void;
  openSettings: () => void;
  onModalToggle?: (open: boolean) => void;
}

export class MainMenu implements IScreen {
  private root: HTMLDivElement | null = null;
  private controlsModal: ControlsGuideModal;
  private creditsOverlay: HTMLDivElement | null = null;
  private unsubShowcase: (() => void) | null = null;
  private unsubFade: (() => void) | null = null;

  private utilityBarEl: HTMLElement | null = null;
  private heroHeaderEl: HTMLElement | null = null;
  private playBtnWrapEl: HTMLElement | null = null;
  private secondaryButtonsEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private showcaseBadgeEl: HTMLElement | null = null;
  private showcaseBadgeTextEl: HTMLElement | null = null;
  private showcaseCurtainEl: HTMLElement | null = null;
  private bloodLayerEl: SVGSVGElement | null = null;

  constructor(
    private readonly callbacks: MainMenuCallbacks,
    private readonly settingsModal: SettingsModal,
    private readonly events?: EventBus
  ) {
    this.controlsModal = new ControlsGuideModal(() => {
      this.callbacks.onModalToggle?.(false);
    });
  }

  public mount(container: HTMLElement): void {
    const root = document.createElement('div');
    root.className =
      'relative w-full h-full flex flex-col justify-between p-8 md:p-14 horror-vignette overflow-hidden transition-colors duration-500';

    const isMuted = audioManager.getSettings().muted;

    root.innerHTML = `
      <!-- Atmospheric Irregular Blood Splatters, Dried Stains & Claw Scratches (Edge-framed for clarity) -->
      <svg data-blood-layer viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" class="pointer-events-none fixed inset-0 w-full h-full opacity-60 transition-opacity duration-500">
        <defs>
          <radialGradient id="bloodCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#620909" stop-opacity="0.94" />
            <stop offset="65%" stop-color="#3a0404" stop-opacity="0.72" />
            <stop offset="100%" stop-color="#140101" stop-opacity="0" />
          </radialGradient>
        </defs>
        <!-- Top-left crimson smudge & vertical drips -->
        <path d="M0,0 L265,0 C248,44 195,52 162,88 C134,118 158,158 118,195 C88,224 44,195 22,250 C10,280 0,275 0,275 Z" fill="url(#bloodCore)" />
        <path d="M112,56 Q116,145 112,235 Q110,270 116,288 Q121,264 118,180 Q117,110 117,56 Z" fill="#4f0707" opacity="0.78" />
        <path d="M68,90 Q71,168 68,242 Q66,265 71,278 Q75,258 73,176 Z" fill="#3b0505" opacity="0.7" />
        <path d="M188,24 Q192,82 189,140 Q188,158 192,168 Q195,152 193,92 Z" fill="#520808" opacity="0.62" />
        <circle cx="235" cy="96" r="8" fill="#570808" opacity="0.72" />
        <circle cx="268" cy="78" r="4" fill="#700e0e" opacity="0.66" />
        <circle cx="206" cy="144" r="5" fill="#470606" opacity="0.62" />
        <!-- Top-right jagged claw slashes -->
        <g stroke="#7f1d1d" stroke-linecap="round" opacity="0.48">
          <path d="M1120,42 C1210,88 1295,134 1396,192" stroke-width="5.5" />
          <path d="M1098,74 C1192,118 1280,166 1384,224" stroke-width="4.2" />
          <path d="M1082,108 C1172,150 1258,196 1356,252" stroke-width="3.2" />
        </g>
        <!-- Lower-left subtle dried claw streak -->
        <g stroke="#6b1212" stroke-linecap="round" opacity="0.38">
          <path d="M22,720 C115,695 215,664 298,626" stroke-width="4.5" />
          <path d="M36,752 C128,726 226,695 314,658" stroke-width="3.5" />
          <path d="M52,782 C142,756 232,728 308,694" stroke-width="2.6" />
        </g>
        <!-- Lower-right organic splatter & droplet arcs -->
        <path d="M1440,670 C1345,642 1268,704 1222,758 C1188,798 1236,848 1184,900 L1440,900 Z" fill="url(#bloodCore)" opacity="0.76" />
        <circle cx="1174" cy="782" r="7.5" fill="#520808" opacity="0.62" />
        <circle cx="1198" cy="744" r="4" fill="#6b0d0d" opacity="0.56" />
        <circle cx="1238" cy="702" r="3" fill="#7f1d1d" opacity="0.5" />
      </svg>

      <!-- Top Utility Bar -->
      <div data-menu-utility class="relative z-10 flex items-center justify-between transition-opacity duration-500">
        <div class="text-xs tracking-[0.26em] uppercase text-[#a89f99] font-semibold">
          Sector 04 · Quarantine Zone
        </div>
        <div class="flex items-center gap-3">
          <button type="button" data-action="mute" class="btn-secondary px-4 py-2 text-xs font-bold tracking-wider">
            ${isMuted ? 'Audio: Muted' : 'Audio: On'}
          </button>
          <button type="button" data-action="fullscreen" class="btn-secondary px-4 py-2 text-xs font-bold tracking-wider">
            Fullscreen
          </button>
        </div>
      </div>

      <!-- Horror Hero Lockup & Action Stack (Left Focal Column, leaving Right 3D Showcase clear) -->
      <div class="relative z-10 max-w-xl my-auto">
        <div data-menu-header class="transition-all duration-500">
          <div class="text-xs font-bold tracking-[0.3em] uppercase text-[#dc2626] mb-3">
            Biohazard Survival Campaign
          </div>
          <h1 class="font-horror text-6xl sm:text-7xl md:text-8xl text-[#f4efe9] leading-[0.94] uppercase mb-9 drop-shadow-[0_8px_28px_rgba(0,0,0,0.96)]" style="text-wrap: balance;">
            ZOMBIE<br />
            <span class="text-[#c92a2a] drop-shadow-[0_6px_22px_rgba(127,29,29,0.78)]">OUTBREAK</span>
          </h1>
        </div>

        <!-- Restrained Showcase Indicator (Shown only during automated combat preview) -->
        <div data-showcase-badge class="hidden mb-4">
          <span data-showcase-badge-text class="inline-block px-3 py-1 bg-[#0a0708]/88 border border-[#dc2626]/45 text-[11px] font-mono-num font-bold tracking-[0.24em] uppercase text-[#fca5a5]">
            Live Gameplay Preview
          </span>
        </div>

        <div data-menu-play-wrap class="flex flex-col gap-3.5 max-w-sm transition-opacity duration-300">
          <button type="button" data-action="play" class="btn-primary w-full px-10 py-5 text-3xl font-bold tracking-[0.16em] shadow-[0_12px_36px_rgba(185,28,28,0.42)]">
            PLAY
          </button>

          <div data-menu-secondary class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 transition-all duration-500">
            <button type="button" data-action="howto" class="btn-secondary px-4 py-3.5 text-sm font-bold tracking-[0.1em]">
              How to Play
            </button>
            <button type="button" data-action="settings" class="btn-secondary px-4 py-3.5 text-sm font-bold tracking-[0.1em]">
              Settings
            </button>
            <button type="button" data-action="credits" class="btn-secondary px-4 py-3.5 text-sm font-bold tracking-[0.1em]">
              Credits
            </button>
          </div>
        </div>
      </div>

      <!-- Subtle Bottom Grounding Line -->
      <div data-menu-footer class="relative z-10 flex flex-wrap items-center justify-between gap-4 text-[11px] tracking-[0.14em] uppercase text-[#8b847e] pt-3 transition-opacity duration-500">
        <span>Dual-Hand Pose &amp; Mouse/Keyboard Supported</span>
        <span>4 Stages · The King · Subject Alpha</span>
      </div>

      <!-- Full-Screen Pitch-Dark Showcase Transition Curtain -->
      <div data-showcase-curtain class="pointer-events-none fixed inset-0 z-30 bg-black opacity-0"></div>
    `;

    this.utilityBarEl = root.querySelector('[data-menu-utility]');
    this.heroHeaderEl = root.querySelector('[data-menu-header]');
    this.playBtnWrapEl = root.querySelector('[data-menu-play-wrap]');
    this.secondaryButtonsEl = root.querySelector('[data-menu-secondary]');
    this.footerEl = root.querySelector('[data-menu-footer]');
    this.showcaseBadgeEl = root.querySelector('[data-showcase-badge]');
    this.showcaseBadgeTextEl = root.querySelector('[data-showcase-badge-text]');
    this.showcaseCurtainEl = root.querySelector('[data-showcase-curtain]');
    this.bloodLayerEl = root.querySelector('[data-blood-layer]');

    root.addEventListener('click', (e) => {
      void audioManager.unlock().then(() => {
        void audioManager.playMusic('music_menu');
        void audioManager.startAmbience();
      });

      const target = e.target as HTMLElement;
      const btn = target.closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;

      void audioManager.play('ui_click');

      if (action === 'play') {
        void audioManager.play('ui_select');
        this.callbacks.onPlay();
      } else if (action === 'howto') {
        this.callbacks.onModalToggle?.(true);
        this.controlsModal.open(root);
      } else if (action === 'settings') {
        this.callbacks.onModalToggle?.(true);
        this.settingsModal.open(root);
      } else if (action === 'credits') {
        this.callbacks.onModalToggle?.(true);
        this.openCredits(root);
      } else if (action === 'mute') {
        const muted = audioManager.toggleMute();
        btn.textContent = muted ? 'Audio: Muted' : 'Audio: On';
      } else if (action === 'fullscreen') {
        this.toggleFullscreen();
      }
    });

    if (this.events) {
      this.unsubShowcase = this.events.on('showcase:state_changed', ({ state, mode }) => {
        this.applyShowcaseVisualState(state, mode);
      });
      this.unsubFade = this.events.on('showcase:fade', () => {
        if (this.showcaseCurtainEl) {
          this.showcaseCurtainEl.style.opacity = '0';
        }
        if (this.heroHeaderEl) this.heroHeaderEl.style.opacity = '1';
        if (this.playBtnWrapEl) this.playBtnWrapEl.style.opacity = '1';
        if (this.utilityBarEl) this.utilityBarEl.style.opacity = '1';
        if (this.secondaryButtonsEl) this.secondaryButtonsEl.style.opacity = '1';
        if (this.footerEl) this.footerEl.style.opacity = '1';
      });
    }

    container.appendChild(root);
    this.root = root;
  }

  private applyShowcaseVisualState(
    state: ShowcaseState,
    _mode?: 'combat' | 'boss_phase2'
  ): void {
    if (!this.root) return;
    const isShowcaseActive = state === 'SHOWCASE_GAMEPLAY' || state === 'SHOWCASE_INTRO';

    this.root.classList.toggle('horror-vignette', !isShowcaseActive);
    this.root.classList.toggle('horror-vignette-showcase', isShowcaseActive);

    const visibleEls = [
      this.utilityBarEl,
      this.heroHeaderEl,
      this.playBtnWrapEl,
      this.secondaryButtonsEl,
      this.footerEl,
    ];
    for (const el of visibleEls) {
      if (!el) continue;
      el.classList.remove('opacity-0', 'pointer-events-none');
      el.style.opacity = '1';
    }

    if (this.bloodLayerEl) {
      this.bloodLayerEl.style.opacity = isShowcaseActive ? '0.32' : '0.6';
    }
    if (this.showcaseBadgeEl) {
      this.showcaseBadgeEl.classList.toggle('hidden', !isShowcaseActive);
    }
    if (this.showcaseBadgeTextEl) {
      this.showcaseBadgeTextEl.textContent = 'The Arena of the Dead · Live Hunt';
    }
  }

  private toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      void document.exitFullscreen?.().catch(() => {});
    }
  }

  private openCredits(parent: HTMLElement): void {
    if (this.creditsOverlay) return;
    const overlay = document.createElement('div');
    overlay.className =
      'fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-6';
    overlay.innerHTML = `
      <div class="screen-panel w-full max-w-lg p-6 md:p-8 shadow-2xl">
        <div class="flex items-center justify-between border-b border-white/10 pb-4 mb-5">
          <div>
            <div class="text-[11px] uppercase tracking-[0.22em] text-[#b91c1c] font-semibold mb-1">Dossier</div>
            <h2 class="font-horror text-3xl md:text-4xl text-[#f4efe9] uppercase">Credits</h2>
          </div>
          <button type="button" data-close-credits class="btn-secondary px-4 py-2 text-sm font-semibold">Close</button>
        </div>
        <div class="space-y-4 text-sm text-[#c4c1b9]">
          <div>
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Project</div>
            <div class="text-base font-semibold text-white">Zombie Outbreak — 4-Stage Gesture FPS Campaign</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">3D Rendering &amp; Physics</div>
            <div>Three.js WebGL Engine · 4 Procedural Campaign Arenas &amp; The King Boss</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Computer Vision</div>
            <div>MediaPipe Pose &amp; Dual-Hand Landmarker (Local Browser Inference)</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-[#9ba1a6]">Audio &amp; Sound Design</div>
            <div>Survival Horror SFX, Dynamic Weapon Audio &amp; Ambience via Web Audio API</div>
          </div>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close-credits]') || e.target === overlay) {
        void audioManager.play('ui_click');
        overlay.remove();
        this.creditsOverlay = null;
        this.callbacks.onModalToggle?.(false);
      }
    });
    parent.appendChild(overlay);
    this.creditsOverlay = overlay;
  }

  public unmount(): void {
    this.unsubShowcase?.();
    this.unsubShowcase = null;
    this.unsubFade?.();
    this.unsubFade = null;
    this.controlsModal.close();
    if (this.creditsOverlay) {
      this.creditsOverlay.remove();
      this.creditsOverlay = null;
      this.callbacks.onModalToggle?.(false);
    }
    this.root?.remove();
    this.root = null;
  }
}
