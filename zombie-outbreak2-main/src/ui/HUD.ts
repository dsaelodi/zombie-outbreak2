import type { IScreen } from '../app/ScreenManager';
import { audioManager } from '../audio/AudioManager';
import type { EventBus } from '../core/EventBus';
import type { HudSnapshot } from '../core/Game';
import type { PoseController } from '../cv/PoseController';
import type { UserSettings } from '../data/gameConfig';
import type { StageConfig } from '../data/stages';
import { WEAPONS, type WeaponId, type WeaponSlotRuntime } from '../data/weapons';
import { formatTime } from '../utils/math';
import { WeaponWheelOverlay } from './WeaponWheelOverlay';

export interface HUDCallbacks {
  onPauseClick: () => void;
  onReloadClick: () => void;
  onSelectWeapon: (weaponId: WeaponId) => void;
  onCancelWheel: () => void;
  onSkipTransition: () => void;
  onSkipBossCinematic: () => void;
  onDismissLore: () => void;
  onSkipElevator: () => void;
  onSkipBossIntro: () => void;
  onSkipStoryCinematic: () => void;
  getWeaponSlots: () => Record<WeaponId, WeaponSlotRuntime>;
}

export class HUD implements IScreen {
  private root: HTMLDivElement | null = null;
  private damageFlashEl: HTMLDivElement | null = null;
  private crosshairEl: HTMLDivElement | null = null;
  private hitmarkerEl: SVGElement | null = null;

  private healthBarEl: HTMLElement | null = null;
  private healthTextEl: HTMLElement | null = null;
  private stageHeaderEl: HTMLElement | null = null;
  private objectiveEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  private scoreEl: HTMLElement | null = null;
  private killsEl: HTMLElement | null = null;
  private weaponLabelEl: HTMLElement | null = null;
  private ammoEl: HTMLElement | null = null;
  private grenadeBadgeEl: HTMLElement | null = null;
  private trackingEl: HTMLElement | null = null;
  private pauseHoldBoxEl: HTMLElement | null = null;
  private pauseHoldBarEl: HTMLElement | null = null;
  private pipCanvas: HTMLCanvasElement | null = null;
  private pipWrapper: HTMLElement | null = null;
  private debugPanelEl: HTMLElement | null = null;

  // Stage 4 Boss HUD elements
  private bossHudEl: HTMLElement | null = null;
  private bossNameEl: HTMLElement | null = null;
  private bossPhaseEl: HTMLElement | null = null;
  private bossShieldEl: HTMLElement | null = null;
  private bossHpBarEl: HTMLElement | null = null;
  private bossTelegraphEl: HTMLElement | null = null;
  private chaseBannerEl: HTMLElement | null = null;

  // Story Banner, Lore Card, Elevator HUD, Ending Overlay
  private storyBannerEl: HTMLElement | null = null;
  private storyBannerTitleEl: HTMLElement | null = null;
  private storyBannerSubEl: HTMLElement | null = null;
  private loreCardEl: HTMLElement | null = null;
  private loreCodeEl: HTMLElement | null = null;
  private loreTitleEl: HTMLElement | null = null;
  private loreLocationEl: HTMLElement | null = null;
  private loreBodyEl: HTMLElement | null = null;
  private loreCounterEl: HTMLElement | null = null;
  private elevatorHudEl: HTMLElement | null = null;
  private elevatorLabelEl: HTMLElement | null = null;
  private elevatorDepthEl: HTMLElement | null = null;
  private elevatorBarEl: HTMLElement | null = null;
  private elevatorSkipBtnEl: HTMLElement | null = null;
  private endingOverlayEl: HTMLElement | null = null;
  private endingTitleEl: HTMLElement | null = null;
  private endingSubEl: HTMLElement | null = null;

  // Grand BINUS Celebration Outro & Transparent End Card
  private outroBarEl: HTMLElement | null = null;
  private outroEyebrowEl: HTMLElement | null = null;
  private outroTitleEl: HTMLElement | null = null;
  private outroSubtitleEl: HTMLElement | null = null;
  private outroEndCardEl: HTMLElement | null = null;

  // Walking Stage Transition Title Card
  private transitionCardEl: HTMLElement | null = null;
  private transitionTitleEl: HTMLElement | null = null;
  private transitionSubtitleEl: HTMLElement | null = null;
  private transitionHintEl: HTMLElement | null = null;

  // Boss Intro & Death Cinematic Overlay
  private hudTopRowEl: HTMLElement | null = null;
  private hudBottomLeftEl: HTMLElement | null = null;
  private hudBottomRightEl: HTMLElement | null = null;
  private cinematicOverlayEl: HTMLElement | null = null;
  private cinematicTopLabelEl: HTMLElement | null = null;
  private cinematicBottomEyebrowEl: HTMLElement | null = null;
  private cinematicShotLabelEl: HTMLElement | null = null;
  private cinematicSkipBtnEl: HTMLElement | null = null;
  private cinematicFadeEl: HTMLElement | null = null;
  private phase2BannerEl: HTMLElement | null = null;
  private phase2BannerSubEl: HTMLElement | null = null;
  private phase2BannerNameEl: HTMLElement | null = null;

  // Story / Pre-Invasion Cinematic Overlay Elements
  private storyCinOverlayEl: HTMLElement | null = null;
  private storyCinEyebrowEl: HTMLElement | null = null;
  private storyCinTitleEl: HTMLElement | null = null;
  private storyCinSubtitleEl: HTMLElement | null = null;
  private storyCinCardEl: HTMLElement | null = null;
  private storyCinCardEyebrowEl: HTMLElement | null = null;
  private storyCinCardTitleEl: HTMLElement | null = null;
  private storyCinCardQuoteEl: HTMLElement | null = null;
  private storyCinCardObjectiveEl: HTMLElement | null = null;
  private storyCinSkipBtnEl: HTMLElement | null = null;
  private storyCinFadeEl: HTMLElement | null = null;

  private cinematicMode: 'none' | 'boss_intro' | 'boss_death' | 'story' | 'outro' = 'none';
  private bossPhaseTransitionText: string | null = null;
  private loreActive = false;
  private elevatorCanSkip = false;
  private storyBannerTimer = 0;
  private phase2BannerTimer = 0;

  private wheelOverlay: WeaponWheelOverlay;
  private currentActiveWeapon: WeaponId = 'ar';
  private unsubs: Array<() => void> = [];
  private hitmarkerTimer = 0;
  private damageFlashTimer = 0;
  private recoilScaleTimer = 0;
  private telegraphTimer = 0;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' || e.code === 'Enter') {
      if (this.cinematicMode === 'story') {
        e.preventDefault();
        this.callbacks.onSkipStoryCinematic();
        return;
      }
      if (this.loreActive) {
        e.preventDefault();
        this.callbacks.onDismissLore();
        return;
      }
      if (this.elevatorCanSkip) {
        e.preventDefault();
        this.callbacks.onSkipElevator();
        return;
      }
      if (this.cinematicMode === 'boss_intro') {
        e.preventDefault();
        this.callbacks.onSkipBossIntro();
        return;
      }
      if (this.cinematicMode === 'boss_death') {
        e.preventDefault();
        this.callbacks.onSkipBossCinematic();
        return;
      }
    }
    if (e.code === 'F3') {
      e.preventDefault();
      if (this.debugPanelEl) {
        this.debugPanelEl.classList.toggle('hidden');
      }
    }
  };

  constructor(
    private readonly events: EventBus,
    private readonly poseController: PoseController,
    private readonly getStage: () => StageConfig,
    private readonly getSettings: () => UserSettings,
    private readonly callbacks: HUDCallbacks
  ) {
    this.wheelOverlay = new WeaponWheelOverlay({
      onSelect: (id) => this.callbacks.onSelectWeapon(id),
      onCancel: () => this.callbacks.onCancelWheel(),
    });
  }

  public mount(container: HTMLElement): void {
    const root = document.createElement('div');
    root.className = 'relative w-full h-full pointer-events-none select-none';

    const stage = this.getStage();
    const settings = this.getSettings();

    root.innerHTML = `
      <!-- Damage Vignette -->
      <div data-damage-flash class="damage-flash"></div>

      <!-- Top HUD Row -->
      <div data-hud-top class="absolute top-4 left-4 right-4 flex items-start justify-between gap-4">
        <!-- Top-Left: Player Health -->
        <div class="bg-[#0c0f12]/88 border border-white/12 px-4 py-3 min-w-[210px] pointer-events-auto">
          <div class="flex items-center justify-between text-xs uppercase tracking-wider text-[#9ba1a6] mb-1.5">
            <span>Vitality</span>
            <span data-health-text class="font-mono-num text-sm font-semibold text-white">100 / 100</span>
          </div>
          <div class="w-full h-2.5 bg-white/10 overflow-hidden">
            <div data-health-bar class="h-full bg-[#c92a2a] transition-all duration-150" style="width:100%;"></div>
          </div>
        </div>

        <!-- Top-Center: Stage, Wave Objective & Boss Health -->
        <div class="flex flex-col items-center gap-2">
          <div class="bg-[#0c0f12]/88 border border-white/12 px-5 py-2.5 text-center min-w-[300px]">
            <div data-stage-header class="text-[11px] uppercase tracking-[0.18em] text-[#d97706] font-semibold">
              Stage ${stage.id} · ${stage.name}
            </div>
            <div class="flex items-center justify-center gap-4 mt-1">
              <span data-objective class="font-display text-xl font-bold text-white uppercase tracking-wide">
                ${stage.objectiveLabel}
              </span>
              <span data-timer class="font-mono-num text-xl font-bold text-[#eceae4] ${
                stage.timeLimitSec === null ? 'hidden' : ''
              }">
                ${stage.timeLimitSec !== null ? formatTime(stage.timeLimitSec) : ''}
              </span>
            </div>
          </div>

          <!-- Dynamic Story Banner (Non-Intrusive Top-Center Notification) -->
          <div data-story-banner class="hidden bg-[#0e090a]/92 border-y border-[#d97706] px-6 py-2 text-center shadow-lg transition-opacity duration-300 max-w-lg">
            <div data-story-banner-title class="font-horror text-xl md:text-2xl text-white uppercase tracking-wider"></div>
            <div data-story-banner-sub class="text-xs font-mono-num text-[#d97706] uppercase tracking-widest mt-0.5"></div>
          </div>

          <!-- Stage 4 Unified King Boss Health Bar -->
          <div data-boss-hud class="hidden bg-[#120b0d]/92 border border-[#ef4444]/45 px-5 py-2.5 w-[470px] max-w-[88vw] shadow-xl transition-colors duration-300">
            <div class="flex items-center justify-between text-xs uppercase tracking-wider mb-1.5">
              <div class="flex items-center gap-2">
                <span data-boss-name class="font-horror text-lg text-white tracking-wider">THE KING · SUBJECT ALPHA</span>
                <span data-boss-phase class="px-1.5 py-0.5 bg-[#991b1b] text-white font-mono-num text-[10px] font-bold">PHASE I</span>
              </div>
              <span data-boss-shield class="text-[11px] font-semibold text-[#fbbf24]">WEAK: AR CORE</span>
            </div>
            <div class="w-full h-3 bg-white/10 overflow-hidden">
              <div data-boss-hp class="h-full bg-gradient-to-r from-[#dc2626] to-[#f97316] transition-all duration-100" style="width:100%;"></div>
            </div>
            <div data-boss-telegraph class="hidden text-center text-xs font-bold uppercase tracking-[0.16em] text-[#fde047] mt-1">
              WARNING: SEISMIC TITAN SLAM
            </div>
          </div>

          <div data-chase-banner class="hidden bg-[#1a0508]/92 border border-[#dc2626] px-4 py-1 text-[11px] font-mono-num font-bold uppercase tracking-[0.2em] text-[#fecaca]">
            PURSUIT · AUTOMATIC SPRINT ACTIVE · AIM &amp; FIRE!
          </div>
        </div>

        <!-- Top-Right: Tracking Status & Pause -->
        <div class="flex items-center gap-2.5 pointer-events-auto">
          <div class="bg-[#0c0f12]/88 border border-white/12 px-3.5 py-2 text-xs font-mono-num">
            <span data-tracking-status class="text-[#eceae4]">Ready</span>
          </div>
          <button type="button" data-action="pause" class="btn-secondary px-4 py-2 text-xs font-bold">
            Pause
          </button>
        </div>
      </div>

      <!-- Lore Inspection Overlay Card -->
      <div data-lore-card class="hidden fixed inset-0 z-35 flex items-center justify-center p-6 pointer-events-none">
        <div class="bg-[#0d1014]/94 border border-[#d97706]/60 p-6 md:p-7 max-w-xl w-full shadow-2xl pointer-events-auto">
          <div class="flex items-center justify-between text-[11px] font-mono-num uppercase tracking-[0.2em] text-[#d97706] mb-1">
            <span data-lore-code>LOG // --</span>
            <span data-lore-counter>1 / 1</span>
          </div>
          <h3 data-lore-title class="font-horror text-2xl md:text-3xl text-[#f4efe9] uppercase tracking-wide">
            RECOVERED DOCUMENT
          </h3>
          <div data-lore-location class="text-xs uppercase tracking-widest text-[#9ba1a6] mt-0.5 mb-3 border-b border-white/10 pb-2">
            Location
          </div>
          <p data-lore-body class="text-sm md:text-base text-[#eceae4] leading-relaxed font-sans">
            ...
          </p>
          <div class="flex items-center justify-between mt-5 pt-3 border-t border-white/10">
            <span class="text-xs text-[#9ba1a6]">Move right hand to look around · Auto-continues</span>
            <button type="button" data-action="dismiss-lore" class="btn-secondary px-4 py-1.5 text-xs font-bold">
              Continue [Space]
            </button>
          </div>
        </div>
      </div>

      <!-- Elevator Descent Shaft HUD -->
      <div data-elevator-hud class="hidden fixed bottom-24 left-1/2 -translate-x-1/2 z-30 bg-[#0b0e12]/92 border border-[#d97706]/55 px-6 py-4 w-[380px] max-w-[90vw] pointer-events-auto shadow-2xl">
        <div class="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-[#d97706] font-mono-num mb-2">
          <span data-elevator-label>SUB-LEVEL ELEVATOR</span>
          <span data-elevator-depth class="font-bold text-white">0m / -140m</span>
        </div>
        <div class="w-full h-2 bg-white/10 overflow-hidden mb-3">
          <div data-elevator-bar class="h-full bg-[#d97706] transition-all duration-100" style="width:0%;"></div>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-[#9ba1a6]">Free look active</span>
          <button type="button" data-action="skip-elevator" class="hidden btn-secondary px-3 py-1 text-xs font-bold">
            Skip Descent [Space]
          </button>
        </div>
      </div>

      <!-- Bottom-Left: Webcam PiP & Debug Drawer -->
      <div data-hud-bl class="absolute bottom-4 left-4 flex flex-col gap-2 items-start z-40">
        <div data-debug-panel class="${settings.debugMode ? '' : 'hidden'} bg-[#0c0f12]/92 border border-white/15 p-3 text-[11px] font-mono-num text-[#c4c1b9] w-[265px] space-y-1">
          <div class="text-white font-semibold uppercase tracking-wider border-b border-white/10 pb-1 mb-1">Telemetry (F3)</div>
          <div data-dbg-fps>FPS: --</div>
          <div data-dbg-cv>Pose Rate: -- Hz</div>
          <div data-dbg-zombies>Active Zombies: 0</div>
          <div data-dbg-track>Tracking: --</div>
          <div data-dbg-angle>Right Trigger: --</div>
          <div data-dbg-left>Left Wheel: --</div>
          <div data-dbg-aim>Aim NDC: 0.00, 0.00</div>
          <div data-dbg-mission>Mission: --</div>
        </div>

        <div data-pause-hold class="hidden bg-[#0c0f12]/90 border border-[#d97706]/60 px-3 py-1.5 text-xs text-[#fcd34d] w-[176px]">
          <div class="mb-1">Hold both hands to pause...</div>
          <div class="w-full h-1.5 bg-white/10">
            <div data-pause-bar class="h-full bg-[#d97706]" style="width:0%;"></div>
          </div>
        </div>

        <div data-pip-wrap class="hidden bg-[#0c0f12]/88 border border-white/15 p-1">
          <canvas width="176" height="132" data-pip-canvas class="block w-[176px] h-[132px]"></canvas>
        </div>
      </div>

      <!-- Bottom-Right: Score, Kills, Grenade & Active Weapon -->
      <div data-hud-br class="absolute bottom-4 right-4 flex items-end gap-2.5 pointer-events-auto">
        <div class="bg-[#0c0f12]/88 border border-white/12 px-4 py-3 text-right">
          <div class="text-[11px] uppercase tracking-wider text-[#9ba1a6]">Eliminations · Score</div>
          <div class="flex items-baseline justify-end gap-3 mt-0.5 font-mono-num">
            <span data-kills class="text-lg font-semibold text-[#d97706]">0 Kills</span>
            <span class="text-white/25">|</span>
            <span data-score class="text-xl font-bold text-white">000,000</span>
          </div>
        </div>

        <div class="bg-[#0c0f12]/88 border border-white/12 px-3.5 py-3 text-right min-w-[116px]">
          <div class="text-[11px] uppercase tracking-wider text-[#9ba1a6]">Frag [4]</div>
          <div data-grenade-badge class="font-mono-num text-lg font-bold text-[#ef4444] mt-0.5">5 / 5 READY</div>
        </div>

        <div class="bg-[#0c0f12]/88 border border-white/12 px-4 py-3 text-right min-w-[175px]">
          <div class="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wider text-[#9ba1a6]">
            <span>[Tab / Fist]</span>
            <span data-weapon-label class="text-white font-semibold">M4A1 AR</span>
          </div>
          <div class="flex items-center justify-end gap-2 mt-0.5">
            <span data-ammo class="font-mono-num text-xl font-bold text-white">28 / 28</span>
            <button type="button" data-action="reload" class="btn-secondary px-2 py-0.5 text-[11px] font-semibold">R</button>
          </div>
        </div>
      </div>

      <!-- Cinematic Stage Transition Title Card -->
      <div data-transition-card class="hidden fixed inset-0 z-25 flex flex-col items-center justify-end pb-20 bg-gradient-to-t from-[#080a0c]/88 via-transparent to-[#080a0c]/70 pointer-events-auto">
        <div class="text-center px-6 py-5 bg-[#0a0c0f]/82 border border-white/15 max-w-xl shadow-2xl">
          <div data-transition-subtitle class="text-xs uppercase tracking-[0.24em] text-[#d97706] font-semibold mb-1">
            Advancing Sector
          </div>
          <h2 data-transition-title class="font-horror text-4xl md:text-5xl text-[#f4efe9] uppercase tracking-wide">
            STAGE
          </h2>
          <div data-transition-hint class="text-sm text-[#c4c1b9] mt-2">
            Advancing...
          </div>
          <button type="button" data-action="skip-transition" class="btn-secondary mt-4 px-5 py-1.5 text-xs font-semibold">
            Skip Walk
          </button>
        </div>
      </div>

      <!-- Boss Phase Banner -->
      <div data-phase2-banner class="hidden fixed inset-x-0 top-24 z-35 flex flex-col items-center justify-center pointer-events-none px-6 text-center transition-opacity duration-500">
        <div class="bg-[#0b0203]/92 border-y-2 border-[#dc2626] px-10 py-5 shadow-[0_0_50px_rgba(220,38,38,0.55)] max-w-2xl">
          <div data-phase2-sub class="text-xs font-mono-num uppercase tracking-[0.32em] text-[#fca5a5] font-bold mb-1">
            PHASE 2 — AWAKENED
          </div>
          <div data-phase2-name class="font-horror text-4xl md:text-5xl text-[#ef4444] uppercase drop-shadow-[0_4px_18px_rgba(220,38,38,0.85)]">
            THE KING
          </div>
        </div>
      </div>

      <!-- Opening Story & Stage Pre-Invasion Cinematic Overlay -->
      <div data-story-cinematic class="hidden fixed inset-0 z-32 pointer-events-none flex flex-col justify-between">
        <div data-story-fade class="fixed inset-0 bg-black pointer-events-none opacity-0 transition-opacity duration-150"></div>

        <!-- Top Letterbox Bar -->
        <div class="relative z-10 w-full h-14 md:h-16 bg-black/92 border-b border-white/10 flex items-center justify-between px-6 md:px-10">
          <div>
            <div data-story-cin-eyebrow class="text-[10px] font-mono-num uppercase tracking-[0.26em] text-[#d97706]">PROLOGUE</div>
            <div data-story-cin-title class="font-horror text-lg md:text-xl text-[#f4efe9] uppercase tracking-wider">ZOMBIE OUTBREAK</div>
          </div>
          <button type="button" data-action="skip-story-cinematic" class="hidden pointer-events-auto btn-secondary px-5 py-2 text-xs font-bold tracking-wider">
            Skip [Space]
          </button>
        </div>

        <!-- Centered Stage / Title Narrative Card -->
        <div data-story-cin-card class="hidden relative z-10 mx-auto my-auto px-7 py-6 bg-[#0a0c0f]/92 border border-white/15 max-w-xl w-[90%] text-center shadow-2xl">
          <div data-story-card-eyebrow class="text-xs font-mono-num uppercase tracking-[0.28em] text-[#d97706] font-bold mb-1">STAGE 1</div>
          <h2 data-story-card-title class="font-horror text-4xl md:text-5xl text-[#f4efe9] uppercase tracking-wide mb-3">
            ABANDONED VILLAGE
          </h2>
          <p data-story-card-quote class="text-sm md:text-base italic text-[#eceae4] mb-3"></p>
          <div data-story-card-objective class="hidden text-xs font-mono-num uppercase tracking-[0.18em] text-[#fca5a5] border-t border-white/10 pt-2.5"></div>
        </div>

        <!-- Bottom Letterbox & Subtitle Bar -->
        <div class="relative z-10 w-full min-h-[76px] bg-black/92 border-t border-white/10 flex items-center justify-center px-6 md:px-12 py-3 text-center">
          <p data-story-cin-subtitle class="text-sm md:text-base text-[#f4efe9] max-w-3xl leading-snug"></p>
        </div>
      </div>

      <!-- Boss Intro & Death Multi-Angle Cinematic Letterbox & Skip -->
      <div data-boss-cinematic class="hidden fixed inset-0 z-30 pointer-events-none flex flex-col justify-between">
        <div class="w-full h-14 md:h-16 bg-black/95 border-b border-white/10 flex items-center px-6 md:px-10">
          <span data-cinematic-top class="text-[11px] uppercase tracking-[0.26em] text-[#ef4444] font-semibold">Subject Alpha · Arena Sequence</span>
        </div>
        <div data-cinematic-fade class="fixed inset-0 bg-black pointer-events-none opacity-0 transition-opacity duration-150"></div>
        <div class="w-full h-16 md:h-20 bg-black/95 border-t border-white/10 flex items-center justify-between px-6 md:px-10 relative z-10">
          <div>
            <div data-cinematic-eyebrow class="text-[10px] uppercase tracking-[0.22em] text-[#9ba1a6]">Stage 4</div>
            <div data-cinematic-shot class="font-horror text-2xl md:text-3xl text-white uppercase tracking-wider">THE KING</div>
          </div>
          <button type="button" data-action="skip-boss-cinematic" class="hidden pointer-events-auto btn-secondary px-5 py-2 text-xs font-bold tracking-wider">
            Skip Cinematic [Space]
          </button>
        </div>
      </div>

      <!-- Final Campaign Ending Title Overlay (Fallback Fade) -->
      <div data-ending-overlay class="hidden fixed inset-0 z-50 bg-black flex flex-col items-center justify-center text-center px-6 transition-opacity duration-700" style="opacity:0;">
        <h2 data-ending-title class="font-horror text-5xl md:text-7xl text-[#f4efe9] uppercase tracking-wider">
          THE KING HAS FALLEN
        </h2>
        <div data-ending-sub class="font-mono-num text-sm md:text-lg text-[#dc2626] uppercase tracking-[0.35em] mt-4">
          THE OUTBREAK IS NOT FORGOTTEN
        </div>
      </div>

      <!-- Grand BINUS Sunlit Celebration Outro Caption Bar (Shots 1-5) -->
      <div data-outro-bar class="hidden fixed inset-x-0 bottom-0 z-40 pointer-events-none px-6 pb-8 pt-6 bg-gradient-to-t from-black/80 via-black/45 to-transparent flex flex-col items-center text-center">
        <div data-outro-eyebrow class="text-[11px] font-mono-num uppercase tracking-[0.28em] text-[#fbbf24] font-bold mb-1">
          DAWN SANCTUARY PLAZA
        </div>
        <div data-outro-title class="font-horror text-3xl md:text-4xl text-white uppercase tracking-wider drop-shadow-lg">
          INTO THE DAWN
        </div>
        <p data-outro-subtitle class="text-sm md:text-base text-[#eceae4] mt-1 max-w-2xl"></p>
      </div>

      <!-- Grand Finale Transparent End Card (Shot 6 over live celebrating BINUS 3D plaza) -->
      <div data-outro-endcard class="hidden fixed inset-0 z-50 pointer-events-auto flex flex-col items-center justify-center text-center px-6 bg-gradient-to-b from-black/45 via-black/20 to-black/65">
        <div class="bg-[#0b1420]/76 backdrop-blur-sm border border-[#fbbf24]/55 px-8 py-9 md:px-12 md:py-11 max-w-2xl w-full shadow-2xl">
          <div class="text-xs font-mono-num uppercase tracking-[0.35em] text-[#fbbf24] font-bold mb-3">
            CAMPAIGN COMPLETED
          </div>
          <h2 class="font-horror text-4xl md:text-6xl text-white uppercase tracking-wider leading-tight drop-shadow-md">
            THE KING HAS FALLEN.
          </h2>
          <div class="font-horror text-2xl md:text-4xl text-[#fde68a] uppercase tracking-wider mt-2 drop-shadow-md">
            THE SURVIVORS RISE.
          </div>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8">
            <button type="button" data-action="outro-restart" class="btn-primary px-7 py-3 text-sm font-bold uppercase tracking-wider w-full sm:w-auto">
              Restart Campaign
            </button>
            <button type="button" data-action="outro-home" class="btn-secondary px-7 py-3 text-sm font-bold uppercase tracking-wider w-full sm:w-auto">
              Return to Home Screen
            </button>
          </div>
        </div>
      </div>

      <!-- Dynamic Crosshair -->
      <div data-crosshair class="crosshair-root" style="left:50%;top:50%;">
        <svg viewBox="0 0 44 44" class="w-full h-full">
          <circle cx="22" cy="22" r="13" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.6" />
          <circle cx="22" cy="22" r="2" fill="#ef4444" />
          <line x1="22" y1="3" x2="22" y2="11" stroke="rgba(255,255,255,0.9)" stroke-width="1.8" />
          <line x1="22" y1="33" x2="22" y2="41" stroke="rgba(255,255,255,0.9)" stroke-width="1.8" />
          <line x1="3" y1="22" x2="11" y2="22" stroke="rgba(255,255,255,0.9)" stroke-width="1.8" />
          <line x1="33" y1="22" x2="41" y2="22" stroke="rgba(255,255,255,0.9)" stroke-width="1.8" />
          <g data-hitmarker opacity="0">
            <line x1="12" y1="12" x2="17" y2="17" stroke="#ef4444" stroke-width="2.4" />
            <line x1="32" y1="12" x2="27" y2="17" stroke="#ef4444" stroke-width="2.4" />
            <line x1="12" y1="32" x2="17" y2="27" stroke="#ef4444" stroke-width="2.4" />
            <line x1="32" y1="32" x2="27" y2="27" stroke="#ef4444" stroke-width="2.4" />
          </g>
        </svg>
      </div>
    `;

    this.damageFlashEl = root.querySelector('[data-damage-flash]');
    this.crosshairEl = root.querySelector('[data-crosshair]');
    this.hitmarkerEl = root.querySelector('[data-hitmarker]');
    this.healthBarEl = root.querySelector('[data-health-bar]');
    this.healthTextEl = root.querySelector('[data-health-text]');
    this.stageHeaderEl = root.querySelector('[data-stage-header]');
    this.objectiveEl = root.querySelector('[data-objective]');
    this.timerEl = root.querySelector('[data-timer]');
    this.scoreEl = root.querySelector('[data-score]');
    this.killsEl = root.querySelector('[data-kills]');
    this.weaponLabelEl = root.querySelector('[data-weapon-label]');
    this.ammoEl = root.querySelector('[data-ammo]');
    this.grenadeBadgeEl = root.querySelector('[data-grenade-badge]');
    this.trackingEl = root.querySelector('[data-tracking-status]');
    this.pauseHoldBoxEl = root.querySelector('[data-pause-hold]');
    this.pauseHoldBarEl = root.querySelector('[data-pause-bar]');
    this.pipCanvas = root.querySelector('[data-pip-canvas]');
    this.pipWrapper = root.querySelector('[data-pip-wrap]');
    this.debugPanelEl = root.querySelector('[data-debug-panel]');

    this.bossHudEl = root.querySelector('[data-boss-hud]');
    this.bossNameEl = root.querySelector('[data-boss-name]');
    this.bossPhaseEl = root.querySelector('[data-boss-phase]');
    this.bossShieldEl = root.querySelector('[data-boss-shield]');
    this.bossHpBarEl = root.querySelector('[data-boss-hp]');
    this.bossTelegraphEl = root.querySelector('[data-boss-telegraph]');
    this.chaseBannerEl = root.querySelector('[data-chase-banner]');

    this.storyBannerEl = root.querySelector('[data-story-banner]');
    this.storyBannerTitleEl = root.querySelector('[data-story-banner-title]');
    this.storyBannerSubEl = root.querySelector('[data-story-banner-sub]');
    this.loreCardEl = root.querySelector('[data-lore-card]');
    this.loreCodeEl = root.querySelector('[data-lore-code]');
    this.loreTitleEl = root.querySelector('[data-lore-title]');
    this.loreLocationEl = root.querySelector('[data-lore-location]');
    this.loreBodyEl = root.querySelector('[data-lore-body]');
    this.loreCounterEl = root.querySelector('[data-lore-counter]');
    this.elevatorHudEl = root.querySelector('[data-elevator-hud]');
    this.elevatorLabelEl = root.querySelector('[data-elevator-label]');
    this.elevatorDepthEl = root.querySelector('[data-elevator-depth]');
    this.elevatorBarEl = root.querySelector('[data-elevator-bar]');
    this.elevatorSkipBtnEl = root.querySelector('[data-action="skip-elevator"]');
    this.endingOverlayEl = root.querySelector('[data-ending-overlay]');
    this.endingTitleEl = root.querySelector('[data-ending-title]');
    this.endingSubEl = root.querySelector('[data-ending-sub]');
    this.outroBarEl = root.querySelector('[data-outro-bar]');
    this.outroEyebrowEl = root.querySelector('[data-outro-eyebrow]');
    this.outroTitleEl = root.querySelector('[data-outro-title]');
    this.outroSubtitleEl = root.querySelector('[data-outro-subtitle]');
    this.outroEndCardEl = root.querySelector('[data-outro-endcard]');

    this.transitionCardEl = root.querySelector('[data-transition-card]');
    this.transitionTitleEl = root.querySelector('[data-transition-title]');
    this.transitionSubtitleEl = root.querySelector('[data-transition-subtitle]');
    this.transitionHintEl = root.querySelector('[data-transition-hint]');

    this.hudTopRowEl = root.querySelector('[data-hud-top]');
    this.hudBottomLeftEl = root.querySelector('[data-hud-bl]');
    this.hudBottomRightEl = root.querySelector('[data-hud-br]');
    this.cinematicOverlayEl = root.querySelector('[data-boss-cinematic]');
    this.cinematicTopLabelEl = root.querySelector('[data-cinematic-top]');
    this.cinematicBottomEyebrowEl = root.querySelector('[data-cinematic-eyebrow]');
    this.cinematicShotLabelEl = root.querySelector('[data-cinematic-shot]');
    this.cinematicSkipBtnEl = root.querySelector('[data-action="skip-boss-cinematic"]');
    this.cinematicFadeEl = root.querySelector('[data-cinematic-fade]');
    this.phase2BannerEl = root.querySelector('[data-phase2-banner]');
    this.phase2BannerSubEl = root.querySelector('[data-phase2-sub]');
    this.phase2BannerNameEl = root.querySelector('[data-phase2-name]');

    this.storyCinOverlayEl = root.querySelector('[data-story-cinematic]');
    this.storyCinEyebrowEl = root.querySelector('[data-story-cin-eyebrow]');
    this.storyCinTitleEl = root.querySelector('[data-story-cin-title]');
    this.storyCinSubtitleEl = root.querySelector('[data-story-cin-subtitle]');
    this.storyCinCardEl = root.querySelector('[data-story-cin-card]');
    this.storyCinCardEyebrowEl = root.querySelector('[data-story-card-eyebrow]');
    this.storyCinCardTitleEl = root.querySelector('[data-story-card-title]');
    this.storyCinCardQuoteEl = root.querySelector('[data-story-card-quote]');
    this.storyCinCardObjectiveEl = root.querySelector('[data-story-card-objective]');
    this.storyCinSkipBtnEl = root.querySelector('[data-action="skip-story-cinematic"]');
    this.storyCinFadeEl = root.querySelector('[data-story-fade]');

    this.wheelOverlay.mount(root);

    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      void audioManager.play('ui_click');
      const action = btn.dataset.action;
      if (action === 'pause') {
        this.callbacks.onPauseClick();
      } else if (action === 'reload') {
        this.callbacks.onReloadClick();
      } else if (action === 'skip-transition') {
        this.callbacks.onSkipTransition();
      } else if (action === 'dismiss-lore') {
        this.callbacks.onDismissLore();
      } else if (action === 'skip-elevator') {
        this.callbacks.onSkipElevator();
      } else if (action === 'skip-story-cinematic') {
        this.callbacks.onSkipStoryCinematic();
      } else if (action === 'skip-boss-cinematic') {
        if (this.cinematicMode === 'boss_intro') {
          this.callbacks.onSkipBossIntro();
        } else {
          this.callbacks.onSkipBossCinematic();
        }
      } else if (action === 'outro-restart') {
        this.events.emit('outro:restart_campaign', {});
      } else if (action === 'outro-home') {
        this.events.emit('outro:return_home', {});
      }
    });

    window.addEventListener('keydown', this.onKeyDown);

    this.unsubs.push(
      this.events.on('shot:fired', () => {
        this.recoilScaleTimer = 0.09;
        if (this.crosshairEl) {
          this.crosshairEl.style.transform = 'scale(1.28)';
        }
      }),
      this.events.on('zombie:hit', ({ headshot, effectiveness }) => {
        this.hitmarkerTimer = 0.16;
        if (this.hitmarkerEl) {
          this.hitmarkerEl.setAttribute('opacity', '1');
          const color =
            effectiveness === 'resisted'
              ? '#94a3b8'
              : headshot || effectiveness === 'weak'
              ? '#f59e0b'
              : '#ef4444';
          this.hitmarkerEl
            .querySelectorAll('line')
            .forEach((l) => l.setAttribute('stroke', color));
        }
      }),
      this.events.on('player:damaged', () => {
        this.damageFlashTimer = 0.28;
        if (this.damageFlashEl) {
          this.damageFlashEl.style.opacity = '1';
        }
      }),
      this.events.on('boss:telegraph', ({ attackName }) => {
        this.telegraphTimer = 1.25;
        if (this.bossTelegraphEl) {
          this.bossTelegraphEl.textContent = `WARNING: ${attackName}`;
          this.bossTelegraphEl.classList.remove('hidden');
        }
      }),
      this.events.on('story:banner', ({ label, sublabel, tone, durationSec }) => {
        this.storyBannerTimer = durationSec ?? 3.5;
        if (this.storyBannerTitleEl) this.storyBannerTitleEl.textContent = label;
        if (this.storyBannerSubEl) this.storyBannerSubEl.textContent = sublabel ?? '';
        if (this.storyBannerEl) {
          const borderColor =
            tone === 'danger' ? '#dc2626' : tone === 'ending' ? '#fbbf24' : '#d97706';
          this.storyBannerEl.style.borderColor = borderColor;
          this.storyBannerEl.classList.remove('hidden');
          this.storyBannerEl.style.opacity = '1';
        }
      }),
      this.events.on('lore:opened', ({ code, title, locationLabel, body, index, total }) => {
        this.loreActive = true;
        if (this.loreCodeEl) this.loreCodeEl.textContent = code;
        if (this.loreTitleEl) this.loreTitleEl.textContent = title;
        if (this.loreLocationEl) this.loreLocationEl.textContent = locationLabel;
        if (this.loreBodyEl) this.loreBodyEl.textContent = body;
        if (this.loreCounterEl) this.loreCounterEl.textContent = `${index} / ${total}`;
        this.loreCardEl?.classList.remove('hidden');
      }),
      this.events.on('lore:closed', () => {
        this.loreActive = false;
        this.loreCardEl?.classList.add('hidden');
      }),
      this.events.on('elevator:state', ({ active, progress, depthMeters, canSkip, phaseLabel }) => {
        this.elevatorCanSkip = active && canSkip;
        this.elevatorHudEl?.classList.toggle('hidden', !active);
        if (this.elevatorLabelEl) {
          this.elevatorLabelEl.textContent = phaseLabel
            ? `SUB-LEVEL ELEVATOR · ${phaseLabel}`
            : 'SUB-LEVEL ELEVATOR';
        }
        if (this.elevatorDepthEl) {
          this.elevatorDepthEl.textContent = `${depthMeters}m / -140m`;
        }
        if (this.elevatorBarEl) {
          this.elevatorBarEl.style.width = `${Math.round(progress * 100)}%`;
        }
        this.elevatorSkipBtnEl?.classList.toggle('hidden', !canSkip);
      }),
      this.events.on('outro:shot_changed', ({ active, eyebrow, title, subtitle, showEndCard }) => {
        if (!active) {
          if (this.cinematicMode === 'outro') this.cinematicMode = 'none';
          this.outroBarEl?.classList.add('hidden');
          this.outroEndCardEl?.classList.add('hidden');
          this.hudTopRowEl?.classList.remove('hidden');
          this.hudBottomLeftEl?.classList.remove('hidden');
          this.hudBottomRightEl?.classList.remove('hidden');
          this.crosshairEl?.classList.remove('hidden');
          return;
        }
        this.cinematicMode = 'outro';
        this.hudTopRowEl?.classList.add('hidden');
        this.hudBottomLeftEl?.classList.add('hidden');
        this.hudBottomRightEl?.classList.add('hidden');
        this.crosshairEl?.classList.add('hidden');
        this.bossHudEl?.classList.add('hidden');
        this.chaseBannerEl?.classList.add('hidden');
        this.storyBannerEl?.classList.add('hidden');

        if (showEndCard) {
          this.outroBarEl?.classList.add('hidden');
          this.outroEndCardEl?.classList.remove('hidden');
        } else {
          this.outroEndCardEl?.classList.add('hidden');
          if (this.outroEyebrowEl) this.outroEyebrowEl.textContent = eyebrow;
          if (this.outroTitleEl) this.outroTitleEl.textContent = title;
          if (this.outroSubtitleEl) this.outroSubtitleEl.textContent = subtitle;
          this.outroBarEl?.classList.remove('hidden');
        }
      }),
      this.events.on('campaign:ending_overlay', ({ visible, title, subtitle, fadeAlpha }) => {
        if (!this.endingOverlayEl) return;
        this.endingOverlayEl.classList.toggle('hidden', !visible);
        if (visible) {
          if (this.endingTitleEl) this.endingTitleEl.textContent = title;
          if (this.endingSubEl) this.endingSubEl.textContent = subtitle;
          requestAnimationFrame(() => {
            if (this.endingOverlayEl) {
              this.endingOverlayEl.style.opacity = `${Math.max(0, Math.min(1, fadeAlpha))}`;
            }
          });
        } else {
          this.endingOverlayEl.style.opacity = '0';
        }
      }),
      this.events.on('stage:transition_start', ({ titleCard, subtitle }) => {
        const currStage = this.getStage();
        if (this.transitionTitleEl) this.transitionTitleEl.textContent = titleCard;
        if (this.transitionSubtitleEl) this.transitionSubtitleEl.textContent = subtitle;
        if (this.transitionHintEl) this.transitionHintEl.textContent = currStage.transitionWalkHint;
        this.transitionCardEl?.classList.remove('hidden');
      }),
      this.events.on('stage:transition_end', () => {
        this.transitionCardEl?.classList.add('hidden');
      }),
      this.events.on('boss:phase_transition', ({ transitioning, label }) => {
        this.bossPhaseTransitionText = transitioning ? label : null;
      }),
      this.events.on('story:cinematic_start', ({ title, subtitle }) => {
        this.cinematicMode = 'story';
        this.hudTopRowEl?.classList.add('hidden');
        this.hudBottomLeftEl?.classList.add('hidden');
        this.hudBottomRightEl?.classList.add('hidden');
        this.crosshairEl?.classList.add('hidden');
        if (this.storyCinTitleEl) this.storyCinTitleEl.textContent = title;
        if (this.storyCinSubtitleEl) this.storyCinSubtitleEl.textContent = subtitle;
        this.storyCinCardEl?.classList.add('hidden');
        this.storyCinSkipBtnEl?.classList.add('hidden');
        if (this.storyCinFadeEl) this.storyCinFadeEl.style.opacity = '0';
        this.storyCinOverlayEl?.classList.remove('hidden');
      }),
      this.events.on('story:cinematic_frame', ({
        eyebrow,
        title,
        subtitleText,
        description,
        objective,
        showStageCard,
        canSkip,
        fadeAlpha,
      }) => {
        if (this.storyCinEyebrowEl) this.storyCinEyebrowEl.textContent = eyebrow;
        if (this.storyCinTitleEl) this.storyCinTitleEl.textContent = title;
        if (this.storyCinSubtitleEl) this.storyCinSubtitleEl.textContent = subtitleText;
        this.storyCinSkipBtnEl?.classList.toggle('hidden', !canSkip);
        if (this.storyCinFadeEl) {
          this.storyCinFadeEl.style.opacity = `${Math.max(0, Math.min(1, fadeAlpha))}`;
        }
        if (this.storyCinCardEl) {
          this.storyCinCardEl.classList.toggle('hidden', !showStageCard);
          if (showStageCard) {
            if (this.storyCinCardEyebrowEl) this.storyCinCardEyebrowEl.textContent = eyebrow;
            if (this.storyCinCardTitleEl) this.storyCinCardTitleEl.textContent = title;
            if (this.storyCinCardQuoteEl) {
              this.storyCinCardQuoteEl.textContent = description ?? '';
            }
            if (this.storyCinCardObjectiveEl) {
              this.storyCinCardObjectiveEl.classList.toggle('hidden', !objective);
              this.storyCinCardObjectiveEl.textContent = objective
                ? `OBJECTIVE · ${objective}`
                : '';
            }
          }
        }
      }),
      this.events.on('story:cinematic_end', () => {
        this.cinematicMode = 'none';
        this.storyCinOverlayEl?.classList.add('hidden');
        this.storyCinCardEl?.classList.add('hidden');
        if (this.storyCinFadeEl) this.storyCinFadeEl.style.opacity = '0';
        this.hudTopRowEl?.classList.remove('hidden');
        this.hudBottomLeftEl?.classList.remove('hidden');
        this.hudBottomRightEl?.classList.remove('hidden');
        this.crosshairEl?.classList.remove('hidden');
      }),
      this.events.on('boss:approach_state', ({ label }) => {
        if (this.chaseBannerEl && label) {
          this.chaseBannerEl.classList.remove('hidden');
          this.chaseBannerEl.textContent = label;
          this.chaseBannerEl.style.borderColor = '#dc2626';
          this.chaseBannerEl.style.color = '#fecaca';
        }
      }),
      this.events.on('chase:beat_changed', ({ name }) => {
        if (this.chaseBannerEl && name) {
          this.chaseBannerEl.classList.remove('hidden');
          this.chaseBannerEl.textContent = name;
        }
      }),
      this.events.on('chase:state_changed', ({ active, phase, label }) => {
        if (!this.chaseBannerEl) return;
        this.chaseBannerEl.classList.toggle('hidden', !active);
        if (active) {
          this.chaseBannerEl.textContent = label;
          const isVuln = phase === 'vulnerability';
          this.chaseBannerEl.style.borderColor = isVuln ? '#f59e0b' : '#dc2626';
          this.chaseBannerEl.style.color = isVuln ? '#fde68a' : '#fecaca';
        }
      }),
      this.events.on('boss:intro_start', ({ bossName }) => {
        this.cinematicMode = 'boss_intro';
        this.hudTopRowEl?.classList.add('hidden');
        this.hudBottomLeftEl?.classList.add('hidden');
        this.hudBottomRightEl?.classList.add('hidden');
        this.crosshairEl?.classList.add('hidden');
        if (this.cinematicTopLabelEl) {
          this.cinematicTopLabelEl.textContent = `${bossName} · The Arena of the Dead`;
        }
        if (this.cinematicBottomEyebrowEl) {
          this.cinematicBottomEyebrowEl.textContent = 'Stage 4 Boss Encounter';
        }
        this.cinematicOverlayEl?.classList.remove('hidden');
        this.cinematicSkipBtnEl?.classList.add('hidden');
        if (this.cinematicFadeEl) this.cinematicFadeEl.style.opacity = '0';
      }),
      this.events.on('boss:intro_frame', ({ title, subtitle, canSkip, fadeAlpha }) => {
        if (this.cinematicBottomEyebrowEl) this.cinematicBottomEyebrowEl.textContent = subtitle;
        if (this.cinematicShotLabelEl) this.cinematicShotLabelEl.textContent = title;
        this.cinematicSkipBtnEl?.classList.toggle('hidden', !canSkip);
        if (this.cinematicFadeEl) {
          this.cinematicFadeEl.style.opacity = `${Math.max(0, Math.min(1, fadeAlpha))}`;
        }
      }),
      this.events.on('boss:intro_end', () => {
        this.cinematicMode = 'none';
        this.cinematicOverlayEl?.classList.add('hidden');
        this.hudTopRowEl?.classList.remove('hidden');
        this.hudBottomLeftEl?.classList.remove('hidden');
        this.hudBottomRightEl?.classList.remove('hidden');
        this.crosshairEl?.classList.remove('hidden');
        if (this.cinematicFadeEl) this.cinematicFadeEl.style.opacity = '0';
      }),
      this.events.on('boss:cinematic_start', ({ bossName, isResurrection, eyebrow }) => {
        this.cinematicMode = 'boss_death';
        this.chaseBannerEl?.classList.add('hidden');
        this.hudTopRowEl?.classList.add('hidden');
        this.hudBottomLeftEl?.classList.add('hidden');
        this.hudBottomRightEl?.classList.add('hidden');
        this.crosshairEl?.classList.add('hidden');
        this.phase2BannerEl?.classList.add('hidden');
        this.phase2BannerTimer = 0;
        if (this.cinematicTopLabelEl) {
          this.cinematicTopLabelEl.textContent = isResurrection
            ? `${bossName} · PHASE 1 → PHASE 2 TRANSFORMATION`
            : `${bossName} · NEUTRALIZED`;
        }
        if (this.cinematicBottomEyebrowEl) {
          this.cinematicBottomEyebrowEl.textContent =
            eyebrow ?? (isResurrection ? 'Phase 1 Broken' : 'Campaign Finale');
        }
        this.cinematicOverlayEl?.classList.remove('hidden');
        this.cinematicSkipBtnEl?.classList.add('hidden');
        if (this.cinematicFadeEl) this.cinematicFadeEl.style.opacity = '0';
      }),
      this.events.on(
        'boss:cinematic_frame',
        ({ shotLabel, subtitle, eyebrow, canSkip, fadeAlpha, revealTitle, revealSubtitle }) => {
          if (this.cinematicBottomEyebrowEl) {
            this.cinematicBottomEyebrowEl.textContent =
              subtitle && subtitle.length > 0 ? subtitle : eyebrow ?? 'Stage 4';
          }
          if (this.cinematicShotLabelEl) this.cinematicShotLabelEl.textContent = shotLabel;
          if (this.cinematicSkipBtnEl) {
            this.cinematicSkipBtnEl.classList.toggle('hidden', !canSkip);
          }
          if (this.cinematicFadeEl) {
            this.cinematicFadeEl.style.opacity = `${Math.max(0, Math.min(1, fadeAlpha))}`;
          }
          if (this.phase2BannerEl && revealTitle) {
            if (this.phase2BannerNameEl) this.phase2BannerNameEl.textContent = revealTitle;
            if (this.phase2BannerSubEl) {
              this.phase2BannerSubEl.textContent = revealSubtitle ?? 'PHASE 2 — AWAKENED';
            }
            this.phase2BannerEl.classList.remove('hidden');
            this.phase2BannerEl.style.opacity = '1';
          }
        }
      ),
      this.events.on('boss:phase2_reveal', ({ bossName }) => {
        if (this.phase2BannerEl) {
          if (this.phase2BannerNameEl) this.phase2BannerNameEl.textContent = bossName;
          if (this.phase2BannerSubEl) {
            this.phase2BannerSubEl.textContent = 'PHASE 2 — AWAKENED';
          }
          this.phase2BannerEl.classList.remove('hidden');
          this.phase2BannerEl.style.opacity = '1';
          this.phase2BannerTimer = 2.8;
        }
      }),
      this.events.on('boss:cinematic_end', () => {
        this.cinematicMode = 'none';
        this.cinematicOverlayEl?.classList.add('hidden');
        this.phase2BannerEl?.classList.add('hidden');
        this.phase2BannerTimer = 0;
        this.hudTopRowEl?.classList.remove('hidden');
        this.hudBottomLeftEl?.classList.remove('hidden');
        this.hudBottomRightEl?.classList.remove('hidden');
        this.crosshairEl?.classList.remove('hidden');
        if (this.cinematicFadeEl) this.cinematicFadeEl.style.opacity = '0';
      }),
      this.events.on('mission:updated', (data) => {
        this.currentActiveWeapon = data.activeWeapon;
        const pct = Math.max(0, Math.min(100, (data.health / data.maxHealth) * 100));
        if (this.healthBarEl) {
          this.healthBarEl.style.width = `${pct}%`;
          this.healthBarEl.style.backgroundColor = pct > 35 ? '#c92a2a' : '#ef4444';
        }
        if (this.healthTextEl) {
          this.healthTextEl.textContent = `${data.health} / ${data.maxHealth}`;
        }
        if (this.scoreEl) {
          this.scoreEl.textContent = data.score.toLocaleString().padStart(6, '0');
        }
        if (this.killsEl) {
          this.killsEl.textContent = `${data.kills} Kills`;
        }

        const def = WEAPONS[data.activeWeapon];
        if (this.weaponLabelEl) {
          this.weaponLabelEl.textContent = def.shortName;
          this.weaponLabelEl.style.color = def.accentColor;
        }
        if (this.ammoEl) {
          if (data.activeWeapon === 'grenade') {
            this.ammoEl.textContent =
              data.grenadeCooldownSec > 0.05
                ? `CD ${data.grenadeCooldownSec.toFixed(1)}s`
                : `${data.grenadeCount} / ${data.grenadeMax}`;
          } else if (data.isReloading) {
            this.ammoEl.textContent = 'RELOADING';
          } else if (data.activeWeapon === 'flamethrower') {
            this.ammoEl.textContent = `${data.ammo}% FUEL`;
          } else {
            this.ammoEl.textContent = `${data.ammo} / ${data.magazineSize}`;
          }
          this.ammoEl.style.color = data.isReloading
            ? '#d97706'
            : data.ammo <= 3
            ? '#ef4444'
            : '#ffffff';
        }

        if (this.grenadeBadgeEl) {
          this.grenadeBadgeEl.textContent =
            data.grenadeCooldownSec > 0.05
              ? `${data.grenadeCount}/${data.grenadeMax} · ${data.grenadeCooldownSec.toFixed(1)}s`
              : `${data.grenadeCount}/${data.grenadeMax} READY`;
          this.grenadeBadgeEl.style.color =
            data.grenadeCount <= 0
              ? '#64748b'
              : data.grenadeCooldownSec > 0.05
              ? '#f59e0b'
              : '#ef4444';
        }

        const currStage = this.getStage();
        if (this.stageHeaderEl) {
          this.stageHeaderEl.textContent = `Stage ${currStage.id} · ${currStage.name}`;
        }
        if (this.objectiveEl) {
          this.objectiveEl.textContent =
            data.objectiveBanner && data.objectiveBanner.length > 0
              ? data.objectiveBanner
              : `Wave ${data.waveIndex}/${data.totalWaves} · ${data.remainingEnemies} Left`;
        }
        if (this.timerEl) {
          if (data.remainingTimeSec !== null) {
            this.timerEl.classList.remove('hidden');
            this.timerEl.textContent = formatTime(data.remainingTimeSec);
            this.timerEl.style.color = data.remainingTimeSec <= 15 ? '#ef4444' : '#eceae4';
          } else {
            this.timerEl.classList.add('hidden');
          }
        }

        // Stage 4 Two-Phase King Boss HUD (Strictly Phase 1 and Phase 2)
        if (this.bossHudEl) {
          this.bossHudEl.classList.toggle('hidden', !data.bossActive);
          if (data.bossActive) {
            const isPhase2 = data.bossPhase === 2;
            this.bossHudEl.classList.toggle('border-[#dc2626]', isPhase2);
            this.bossHudEl.classList.toggle('border-[#ef4444]/45', !isPhase2);
            this.bossHudEl.style.backgroundColor = isPhase2
              ? 'rgba(28, 4, 8, 0.95)'
              : 'rgba(18, 11, 13, 0.92)';
            this.bossHudEl.style.boxShadow = isPhase2
              ? '0 0 30px rgba(220, 38, 38, 0.45)'
              : '';

            if (this.bossNameEl) {
              this.bossNameEl.textContent = data.bossName;
              this.bossNameEl.style.color = isPhase2 ? '#fca5a5' : '#ffffff';
            }
            if (this.bossPhaseEl) {
              const phaseText =
                this.bossPhaseTransitionText ??
                (isPhase2 ? 'THE KING — PHASE 2' : 'THE KING — PHASE 1');
              this.bossPhaseEl.textContent = phaseText;
              this.bossPhaseEl.style.backgroundColor = this.bossPhaseTransitionText
                ? '#b45309'
                : isPhase2
                ? '#7f1d1d'
                : '#991b1b';
            }
            if (this.bossShieldEl) {
              this.bossShieldEl.textContent = this.bossPhaseTransitionText
                ? 'INVULNERABLE · TRANSITIONING'
                : isPhase2
                ? 'AWAKENED PURSUIT · AR / FIRE'
                : 'CORE EXPOSED · USE AR (WHITE)';
              this.bossShieldEl.style.color = this.bossPhaseTransitionText
                ? '#fbbf24'
                : isPhase2
                ? '#fca5a5'
                : '#f8fafc';
            }
            if (this.bossHpBarEl && data.bossMaxHealth > 0) {
              const bossPct = Math.max(0, Math.min(100, (data.bossHealth / data.bossMaxHealth) * 100));
              this.bossHpBarEl.style.width = `${bossPct}%`;
              this.bossHpBarEl.className = isPhase2
                ? 'h-full bg-gradient-to-r from-[#7f1d1d] via-[#dc2626] to-[#f43f5e] transition-all duration-100'
                : 'h-full bg-gradient-to-r from-[#dc2626] to-[#f97316] transition-all duration-100';
            }
          }
        }
      })
    );

    container.appendChild(root);
    this.root = root;
  }

  public updateFrame(snapshot: HudSnapshot): void {
    if (!this.root) return;

    this.wheelOverlay.setOpen(snapshot.weaponWheelOpen);
    if (snapshot.weaponWheelOpen) {
      const wg = snapshot.input.wheelGesture;
      this.wheelOverlay.updateState({
        activeWeapon: this.currentActiveWeapon,
        hoveredSlot: wg?.hoveredSlot ?? null,
        fingerCount: wg?.fingerCount ?? 0,
        lockProgress: wg?.lockProgress ?? 0,
        cancelProgress: wg?.cancelProgress ?? 0,
        slots: this.callbacks.getWeaponSlots(),
      });
    }

    if (this.crosshairEl) {
      this.crosshairEl.classList.toggle(
        'hidden',
        this.cinematicMode !== 'none' ||
          snapshot.isTransitioning ||
          snapshot.weaponWheelOpen ||
          this.loreActive
      );
      const leftPct = (snapshot.input.aimX * 0.5 + 0.5) * 100;
      const topPct = (-snapshot.input.aimY * 0.5 + 0.5) * 100;
      this.crosshairEl.style.left = `${leftPct}%`;
      this.crosshairEl.style.top = `${topPct}%`;

      if (this.recoilScaleTimer > 0) {
        this.recoilScaleTimer -= 1 / 60;
        if (this.recoilScaleTimer <= 0) {
          this.crosshairEl.style.transform = 'scale(1)';
        }
      }
    }

    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer -= 1 / 60;
      if (this.hitmarkerTimer <= 0 && this.hitmarkerEl) {
        this.hitmarkerEl.setAttribute('opacity', '0');
      }
    }

    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= 1 / 60;
      if (this.damageFlashTimer <= 0 && this.damageFlashEl) {
        this.damageFlashEl.style.opacity = '0';
      }
    }

    if (this.telegraphTimer > 0) {
      this.telegraphTimer -= 1 / 60;
      if (this.telegraphTimer <= 0 && this.bossTelegraphEl) {
        this.bossTelegraphEl.classList.add('hidden');
      }
    }

    if (this.storyBannerTimer > 0) {
      this.storyBannerTimer -= 1 / 60;
      if (this.storyBannerTimer <= 0.35 && this.storyBannerEl) {
        this.storyBannerEl.style.opacity = '0';
      }
      if (this.storyBannerTimer <= 0 && this.storyBannerEl) {
        this.storyBannerEl.classList.add('hidden');
      }
    }

    if (this.phase2BannerTimer > 0) {
      this.phase2BannerTimer -= 1 / 60;
      if (this.phase2BannerTimer <= 0.45 && this.phase2BannerEl) {
        this.phase2BannerEl.style.opacity = '0';
      }
      if (this.phase2BannerTimer <= 0 && this.phase2BannerEl) {
        this.phase2BannerEl.classList.add('hidden');
      }
    }

    const settings = this.getSettings();
    const isPose = snapshot.input.mode === 'pose';
    const activeDef = WEAPONS[this.currentActiveWeapon];

    if (this.trackingEl) {
      if (snapshot.weaponWheelOpen) {
        this.trackingEl.textContent = isPose
          ? 'Left Fist Held · Right 1–4 Select · 5 Hold · Open Left Hand to Close'
          : 'Weapon Wheel: Click Slot or Press 1–4';
        this.trackingEl.className = 'text-[#fbbf24]';
      } else if (!isPose) {
        this.trackingEl.textContent = `Mouse & Keyboard (${activeDef.shortName})`;
        this.trackingEl.className = 'text-[#9ba1a6]';
      } else if (!snapshot.input.trackingActive) {
        this.trackingEl.textContent = 'Pose Lost — Step into View';
        this.trackingEl.className = 'text-[#ef4444]';
      } else if (snapshot.input.poseDebug?.triggerState === 'FIRING') {
        this.trackingEl.textContent = `Right Finger-Gun: Firing ${activeDef.shortName}`;
        this.trackingEl.className = 'text-[#ef4444]';
      } else if (snapshot.input.poseDebug?.fingerGunStance) {
        this.trackingEl.textContent = `Ready (${activeDef.shortName}) · Left Fist = Wheel`;
        this.trackingEl.className = 'text-[#22c55e]';
      } else {
        this.trackingEl.textContent = 'Form Right Finger-Gun';
        this.trackingEl.className = 'text-[#d97706]';
      }
    }

    if (this.pipWrapper && this.pipCanvas) {
      if (isPose && settings.showCameraPip) {
        this.pipWrapper.classList.remove('hidden');
        this.poseController.renderPreviewCanvas(this.pipCanvas, settings.debugMode, true);
      } else {
        this.pipWrapper.classList.add('hidden');
      }
    }

    const holdProgress = snapshot.input.poseDebug?.pauseHoldProgress ?? 0;
    if (this.pauseHoldBoxEl && this.pauseHoldBarEl) {
      if (holdProgress > 0.05) {
        this.pauseHoldBoxEl.classList.remove('hidden');
        this.pauseHoldBarEl.style.width = `${Math.round(holdProgress * 100)}%`;
      } else {
        this.pauseHoldBoxEl.classList.add('hidden');
      }
    }

    if (this.debugPanelEl && !this.debugPanelEl.classList.contains('hidden')) {
      const dbg = snapshot.input.poseDebug;
      const setTxt = (sel: string, txt: string) => {
        const el = this.debugPanelEl?.querySelector(sel);
        if (el) el.textContent = txt;
      };
      setTxt('[data-dbg-fps]', `Render FPS: ${snapshot.fps} · Scale: ${snapshot.timeScale.toFixed(2)}x`);
      setTxt('[data-dbg-cv]', `Pose Rate: ${dbg ? dbg.inferenceFps : 0} Hz`);
      setTxt('[data-dbg-zombies]', `Active Zombies: ${snapshot.activeZombies}`);
      setTxt(
        '[data-dbg-track]',
        `Tracking: ${dbg ? `${dbg.status} (${Math.round(dbg.confidence * 100)}%)` : 'mouse'}`
      );
      setTxt(
        '[data-dbg-angle]',
        `Right Trigger: ${
          dbg ? `${Math.round(dbg.indexAngleDeg)}° [${dbg.triggerState}]` : 'N/A'
        }`
      );
      setTxt(
        '[data-dbg-left]',
        `Dual Wheel: ${
          dbg
            ? `L=${dbg.leftHandDetected ? (dbg.leftIsFist ? 'FIST' : `${dbg.leftFingerCount}F`) : 'none'} · R=${dbg.rightWheelFingerCount}F [${dbg.weaponWheelOpen ? 'OPEN' : 'IDLE'}]`
            : 'Keyboard'
        }`
      );
      setTxt(
        '[data-dbg-aim]',
        `Aim NDC: ${snapshot.input.aimX.toFixed(2)}, ${snapshot.input.aimY.toFixed(2)}`
      );
      setTxt('[data-dbg-mission]', `Mission: ${snapshot.missionState}`);
    }
  }

  public unmount(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.wheelOverlay.unmount();
    this.root?.remove();
    this.root = null;
  }
}
