import { audioManager } from '../audio/AudioManager';
import { EventBus, type GameScreenId } from '../core/EventBus';
import { Game } from '../core/Game';
import { GameSession } from '../core/GameSession';
import { PoseController } from '../cv/PoseController';
import {
  DEFAULT_GAME_CONFIG,
  loadUserSettings,
  saveUserSettings,
  type UserSettings,
} from '../data/gameConfig';
import { CameraSetup } from '../ui/CameraSetup';
import { CalibrationScreen } from '../ui/CalibrationScreen';
import { HUD } from '../ui/HUD';
import { MainMenu } from '../ui/MainMenu';
import { MissionBriefing } from '../ui/MissionBriefing';
import { PauseScreen } from '../ui/PauseScreen';
import { ResultScreen } from '../ui/ResultScreen';
import { SettingsModal } from '../ui/SettingsScreen';
import { logger } from '../utils/logger';
import { GameStateMachine } from './GameStateMachine';
import { ScreenManager } from './ScreenManager';

export class AppController {
  private readonly events = new EventBus();
  private readonly session = new GameSession();
  private readonly poseController = new PoseController();
  private readonly stateMachine = new GameStateMachine(this.events);

  private readonly canvasLayer: HTMLDivElement;
  private readonly uiLayer: HTMLDivElement;
  private readonly contextBanner: HTMLDivElement;

  private readonly game: Game;
  private readonly screenManager: ScreenManager;
  private readonly settingsModal: SettingsModal;
  private readonly hudScreen: HUD;

  private settings: UserSettings;
  private inactivityTimerId: number | null = null;
  private unsubs: Array<() => void> = [];

  private readonly onActivity = (): void => this.resetInactivityTimer();
  private readonly onVisibilityChange = (): void => {
    if (document.hidden && this.stateMachine.getState() === 'playing') {
      this.pauseGameplay();
    }
  };

  constructor(private readonly mountNode: HTMLElement) {
    this.settings = loadUserSettings();
    logger.setDebug(this.settings.debugMode);

    this.mountNode.innerHTML = '';

    this.canvasLayer = document.createElement('div');
    this.canvasLayer.className = 'game-canvas-layer';

    this.uiLayer = document.createElement('div');
    this.uiLayer.className = 'ui-layer';

    this.contextBanner = document.createElement('div');
    this.contextBanner.className =
      'hidden fixed inset-0 z-50 flex items-center justify-center bg-[#0a0c0e]/95 text-center p-6';
    this.contextBanner.innerHTML = `
      <div class="screen-panel max-w-md p-6">
        <h2 class="font-display text-2xl font-bold text-white uppercase">Graphics Context Interrupted</h2>
        <p class="text-sm text-[#9ba1a6] mt-2">WebGL rendering was temporarily suspended by the browser and will resume automatically.</p>
      </div>
    `;

    this.mountNode.append(this.canvasLayer, this.uiLayer, this.contextBanner);

    this.game = new Game(
      this.canvasLayer,
      this.session,
      this.events,
      this.poseController,
      (lost) => {
        this.contextBanner.classList.toggle('hidden', !lost);
      }
    );

    // Blur & darken ONLY the 3D canvas layer when Weapon Wheel opens (keeping UI & PiP razor sharp)
    this.game.setWheelVisualCallback((open) => {
      this.canvasLayer.classList.toggle('canvas-wheel-blur', open);
    });

    this.applySettings(this.settings);
    this.screenManager = new ScreenManager(this.uiLayer);

    this.settingsModal = new SettingsModal(
      () => this.settings,
      (next) => this.applySettings(next),
      () => this.game.setShowcaseModalPaused(this.stateMachine.getState() !== 'main_menu')
    );

    this.hudScreen = new HUD(
      this.events,
      this.poseController,
      () => this.session.getCurrentStage(),
      () => this.settings,
      {
        onPauseClick: () => this.pauseGameplay(),
        onReloadClick: () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
        },
        onSelectWeapon: (weaponId) => this.game.selectWeaponFromUI(weaponId),
        onCancelWheel: () => this.game.cancelWheelFromUI(),
        onSkipTransition: () => this.game.skipTransition(),
        onSkipBossCinematic: () => this.game.skipBossCinematic(),
        onDismissLore: () => this.game.dismissLore(),
        onSkipElevator: () => this.game.skipElevator(),
        onSkipBossIntro: () => this.game.skipBossIntro(),
        onSkipStoryCinematic: () => this.game.skipStoryCinematic(),
        getWeaponSlots: () => this.game.weaponManager.getAllSlots(),
      }
    );

    this.game.setHudCallback((snapshot) => {
      if (this.stateMachine.getState() === 'playing') {
        this.hudScreen.updateFrame(snapshot);
      }
    });

    this.registerScreens();
    this.bindEvents();

    this.stateMachine.transition('main_menu');
    this.screenManager.show('main_menu');
    this.resetInactivityTimer();
  }

  private applySettings(next: UserSettings): void {
    this.settings = { ...next };
    saveUserSettings(this.settings);
    logger.setDebug(this.settings.debugMode);
    this.poseController.updateConfig(
      {
        aimSmoothing: this.settings.aimSmoothing,
        triggerCurlAngleDeg: this.settings.triggerCurlAngleDeg,
        triggerReleaseAngleDeg: this.settings.triggerReleaseAngleDeg,
      },
      this.settings.aimSensitivity
    );
    this.game.applySettings(this.settings);
    this.events.emit('settings:updated', {});
  }

  private registerScreens(): void {
    const mainMenu = new MainMenu(
      {
        onPlay: () => this.goTo('camera_setup'),
        openSettings: () => this.settingsModal.open(this.uiLayer),
        onModalToggle: (open) => {
          this.game.setShowcaseModalPaused(open || this.stateMachine.getState() !== 'main_menu');
        },
      },
      this.settingsModal,
      this.events
    );

    const cameraSetup = new CameraSetup(this.poseController, {
      onContinueToCalibration: () => {
        this.game.setInputMode('pose');
        this.goTo('calibration');
      },
      onUseMouseFallback: () => {
        this.poseController.stop();
        this.game.setInputMode('mouse');
        this.goTo('briefing');
      },
      onBack: () => {
        this.poseController.stop();
        this.goTo('main_menu');
      },
    });

    const calibration = new CalibrationScreen(
      this.poseController,
      () => this.settings,
      {
        onCalibrationComplete: () => {
          this.game.setInputMode('pose');
          this.goTo('briefing');
        },
        onUseMouseFallback: () => {
          this.poseController.stop();
          this.game.setInputMode('mouse');
          this.goTo('briefing');
        },
        onBack: () => this.goTo('camera_setup'),
      }
    );

    const briefing = new MissionBriefing(
      this.session,
      () => this.game.getInputMode(),
      {
        onStartMission: (stageIdx) => this.startMission(stageIdx),
        onSelectControlMode: (mode) => {
          if (mode === 'pose' && !this.poseController.camera.isActive()) {
            this.goTo('camera_setup');
            return;
          }
          if (mode === 'mouse') {
            this.poseController.stop();
          }
          this.game.setInputMode(mode);
        },
        onBackToMenu: () => this.exitToMainMenu(),
      }
    );

    const pauseScreen = new PauseScreen(
      {
        onResume: () => this.resumeGameplay(),
        onRestartStage: () => this.startMission(this.session.stageIndex),
        onExitToMenu: () => this.exitToMainMenu(),
      },
      this.settingsModal
    );

    const resultScreen = new ResultScreen(this.session, {
      onNextStage: (nextIndex) => {
        this.session.stageIndex = nextIndex;
        this.goTo('briefing');
      },
      onRetryStage: (idx) => this.startMission(idx),
      onMainMenu: () => this.exitToMainMenu(),
    });

    this.screenManager.register('main_menu', mainMenu);
    this.screenManager.register('camera_setup', cameraSetup);
    this.screenManager.register('calibration', calibration);
    this.screenManager.register('briefing', briefing);
    this.screenManager.register('playing', this.hudScreen);
    this.screenManager.register('paused', pauseScreen);
    this.screenManager.register('result', resultScreen);
  }

  private bindEvents(): void {
    this.unsubs.push(
      this.events.on('pose:pause_gesture', () => {
        if (this.stateMachine.getState() === 'playing') {
          this.pauseGameplay();
        }
      }),
      this.events.on('boss:phase_changed', ({ phase }) => {
        audioManager.setBossMusicPhase(phase);
      }),
      this.events.on('mission:completed', () => {
        this.canvasLayer.classList.remove('canvas-wheel-blur');
        void audioManager.play('stage_complete');
        void audioManager.playMusic('music_victory');
        this.goTo('result');
      }),
      this.events.on('mission:failed', () => {
        this.canvasLayer.classList.remove('canvas-wheel-blur');
        void audioManager.play('mission_fail');
        void audioManager.playMusic('music_gameover');
        this.goTo('result');
      }),
      this.events.on('outro:restart_campaign', () => {
        this.startMission(0);
      }),
      this.events.on('outro:return_home', () => {
        this.exitToMainMenu();
      })
    );

    window.addEventListener('pointerdown', this.onActivity);
    window.addEventListener('keydown', this.onActivity);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private goTo(screen: GameScreenId): void {
    if (screen !== 'main_menu' && screen !== 'playing' && screen !== 'paused') {
      this.game.resetShowcaseToIdle();
    }
    this.game.setShowcaseModalPaused(screen !== 'main_menu');
    this.stateMachine.transition(screen);
    this.screenManager.show(screen);
  }

  private startMission(stageIndex: number): void {
    this.canvasLayer.classList.remove('canvas-wheel-blur');
    const stageTrack =
      stageIndex === 0
        ? 'music_stage1'
        : stageIndex === 1
        ? 'music_stage2'
        : stageIndex === 2
        ? 'music_stage3'
        : 'music_boss';
    void audioManager.unlock().then(() => {
      void audioManager.playMusic(stageTrack);
      void audioManager.startAmbience();
    });
    this.goTo('playing');
    this.game.startMission(stageIndex);
  }

  private pauseGameplay(): void {
    if (this.stateMachine.getState() !== 'playing') return;
    this.canvasLayer.classList.remove('canvas-wheel-blur');
    this.game.pause();
    void audioManager.play('ui_pause');
    this.goTo('paused');
  }

  private resumeGameplay(): void {
    if (this.stateMachine.getState() !== 'paused') return;
    void audioManager.play('ui_resume');
    this.goTo('playing');
    this.game.resume();
  }

  private exitToMainMenu(): void {
    this.canvasLayer.classList.remove('canvas-wheel-blur');
    this.game.stopToBackdrop();
    this.poseController.stop();
    void audioManager.playMusic('music_menu');
    this.goTo('main_menu');
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimerId !== null) {
      clearTimeout(this.inactivityTimerId);
    }
    this.inactivityTimerId = window.setTimeout(() => {
      if (this.stateMachine.getState() !== 'main_menu') {
        logger.debug('AppController', 'Booth inactivity timeout — returning to Main Menu');
        this.exitToMainMenu();
      }
    }, DEFAULT_GAME_CONFIG.inactivityResetMs);
  }

  public dispose(): void {
    if (this.inactivityTimerId !== null) {
      clearTimeout(this.inactivityTimerId);
    }
    window.removeEventListener('pointerdown', this.onActivity);
    window.removeEventListener('keydown', this.onActivity);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    for (const u of this.unsubs) u();
    this.game.dispose();
    this.poseController.dispose();
    audioManager.dispose();
  }
}
