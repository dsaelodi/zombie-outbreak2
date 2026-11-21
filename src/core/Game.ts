import * as THREE from 'three';
import { audioManager } from '../audio/AudioManager';
import type { PoseController } from '../cv/PoseController';
import {
  DEFAULT_GAME_CONFIG,
  STORY_CINEMATIC_CONFIG,
  type CrowdDensityLevel,
  type UserSettings,
} from '../data/gameConfig';
import { STAGES } from '../data/stages';
import { getStagePreInvasionIntro } from '../data/storyCinematics';
import type { WeaponId } from '../data/weapons';
import { BOSS_PHASE2_CONFIG } from '../data/zombies';
import { MouseInputProvider } from '../input/MouseInputProvider';
import { PoseInputProvider } from '../input/PoseInputProvider';
import type { IInputProvider, InputMode, PlayerInputState } from '../input/PlayerInput';
import { AssetManager } from '../three/AssetManager';
import { CameraRig } from '../three/CameraRig';
import { Weapon } from '../three/entities/Weapon';
import { Zombie } from '../three/entities/Zombie';
import { GameRenderer } from '../three/Renderer';
import {
  AutoMovementController,
  type AutoMovementCallbacks,
} from '../three/systems/AutoMovementController';
import { BossChaseController } from '../three/systems/BossChaseController';
import {
  Stage4CinematicController,
  type Stage4CinematicCallbacks,
  type Stage4CinematicMode,
} from '../three/systems/Stage4CinematicController';
import { CombatSystem } from '../three/systems/CombatSystem';
import { EffectsSystem } from '../three/systems/EffectsSystem';
import { GrandOutroController, type GrandOutroCallbacks } from '../three/systems/GrandOutroController';
import { GrenadeManager } from '../three/systems/GrenadeManager';
import { HomeScreenShowcaseController } from '../three/systems/HomeScreenShowcaseController';
import { MissionSystem } from '../three/systems/MissionSystem';
import { RaycastSystem } from '../three/systems/RaycastSystem';
import { ScoreSystem } from '../three/systems/ScoreSystem';
import { SpawnSystem } from '../three/systems/SpawnSystem';
import {
  StoryCinematicController,
  type StoryCinematicCallbacks,
} from '../three/systems/StoryCinematicController';
import { TransitionController } from '../three/systems/TransitionController';
import { WeaponManager } from '../three/systems/WeaponManager';
import { World } from '../three/World';
import type { EventBus } from './EventBus';
import { GameLoop } from './GameLoop';
import type { GameSession } from './GameSession';

export type EngineMode = 'backdrop' | 'playing' | 'paused';

export interface HudSnapshot {
  input: PlayerInputState;
  fps: number;
  activeZombies: number;
  missionState: string;
  weaponWheelOpen: boolean;
  timeScale: number;
  isTransitioning: boolean;
}

export class Game {
  public readonly scene = new THREE.Scene();
  public readonly renderer: GameRenderer;
  public readonly cameraRig = new CameraRig();
  public readonly assetManager = new AssetManager();
  public readonly world: World;
  public readonly weapon: Weapon;
  public readonly weaponManager: WeaponManager;

  private readonly spawnSystem = new SpawnSystem();
  private readonly raycastSystem = new RaycastSystem();
  private readonly combatSystem = new CombatSystem();
  private readonly grenadeManager = new GrenadeManager();
  private readonly missionSystem = new MissionSystem();
  private readonly scoreSystem = new ScoreSystem();
  private readonly effectsSystem = new EffectsSystem();
  private readonly transitionController = new TransitionController();
  private readonly autoMove = new AutoMovementController();
  private readonly stage4Cinematic = new Stage4CinematicController();
  private readonly storyCinematic = new StoryCinematicController();
  private readonly chaseController: BossChaseController;
  private readonly grandOutro: GrandOutroController;
  public readonly showcaseController: HomeScreenShowcaseController;

  private readonly mouseProvider = new MouseInputProvider();
  private readonly poseProvider: PoseInputProvider;
  private activeProvider: IInputProvider;

  private readonly zombies: Zombie[] = [];
  private readonly loop: GameLoop;

  private mode: EngineMode = 'backdrop';
  private weaponWheelOpen = false;
  private timeScale = 1.0;
  private crowdDensity: CrowdDensityLevel = 'medium';
  private stageCompletionDelayTimer = -1;
  private pendingCompletionReason = '';
  private bossFinalDeathTriggered = false;
  private lastTriggeredBossPhase: 1 | 2 = 1;
  private crowdCollapseActive = false;
  private crowdCollapseProgress = 0;
  private pendingPostOpeningStageIntro = false;

  private lastInputState: PlayerInputState = {
    aimX: 0,
    aimY: 0,
    fireHeld: false,
    reloadTriggered: false,
    pauseTriggered: false,
    wheelTogglePressed: false,
    wheelCancelPressed: false,
    directWeaponSelect: null,
    mode: 'mouse',
    trackingActive: true,
  };

  private hudSnapshotCb?: (snapshot: HudSnapshot) => void;
  private wheelVisualCb?: (open: boolean) => void;
  private readonly onResizeBound = (): void => {
    this.renderer.resize(this.cameraRig.camera);
  };

  constructor(
    canvasContainer: HTMLElement,
    private readonly session: GameSession,
    private readonly events: EventBus,
    private readonly poseController: PoseController,
    onContextLost?: (lost: boolean) => void
  ) {
    this.renderer = new GameRenderer(canvasContainer, onContextLost);
    this.renderer.setupEnvironment(this.scene);

    this.world = new World(
      this.scene,
      this.renderer.renderer,
      this.renderer.isSoftwareGl
    );
    this.weapon = new Weapon(this.cameraRig.camera, this.assetManager);
    this.weapon.root.visible = false;
    this.scene.add(this.cameraRig.camera);

    this.weaponManager = new WeaponManager(this.events);
    this.poseProvider = new PoseInputProvider(poseController);
    this.activeProvider = this.mouseProvider;
    this.chaseController = new BossChaseController(this.events);
    this.grandOutro = new GrandOutroController(this.events);
    this.showcaseController = new HomeScreenShowcaseController(this.events);

    this.world.loadBossArena(this.crowdDensity);
    this.world.setCrowdState('idle');
    audioManager.setEnvironmentAmbience('boss_arena');
    this.renderer.precompile(this.scene, this.cameraRig.camera);
    this.showcaseController.enterHomeIdle(
      this.scene,
      this.assetManager,
      this.weapon,
      this.cameraRig,
      this.effectsSystem
    );
    window.addEventListener('resize', this.onResizeBound);

    this.loop = new GameLoop(this.renderer, (dtSec, elapsedSec, nowMs) => {
      this.tick(dtSec, elapsedSec, nowMs);
    });
    this.loop.start();

    void this.assetManager.initialize();
  }

  public setHudCallback(cb: (snapshot: HudSnapshot) => void): void {
    this.hudSnapshotCb = cb;
  }

  public setWheelVisualCallback(cb: (open: boolean) => void): void {
    this.wheelVisualCb = cb;
  }

  public setShowcaseModalPaused(paused: boolean): void {
    this.showcaseController.setModalPaused(paused);
  }

  public resetShowcaseToIdle(): void {
    if (this.mode !== 'backdrop') return;
    this.renderer.renderer.toneMappingExposure = 1.15;
    if (this.showcaseController.isGameplaySequenceActive()) {
      this.showcaseController.enterHomeIdle(
        this.scene,
        this.assetManager,
        this.weapon,
        this.cameraRig,
        this.effectsSystem
      );
    }
  }

  public applySettings(settings: UserSettings): void {
    this.mouseProvider.setSensitivity(settings.aimSensitivity);
    this.showcaseController.setEnabled(settings.autoShowcaseEnabled);
    this.crowdDensity = settings.crowdDensity ?? 'medium';
    this.cameraRig.configureFeedback(
      settings.cameraShakeIntensity,
      settings.vibrationEnabled
    );
  }

  public setInputMode(mode: InputMode): void {
    this.activeProvider.disable();
    this.activeProvider = mode === 'pose' ? this.poseProvider : this.mouseProvider;
    if (this.mode === 'playing') {
      this.activeProvider.enable();
    }
  }

  public getInputMode(): InputMode {
    return this.activeProvider.mode;
  }

  public selectWeaponFromUI(weaponId: WeaponId): void {
    if (
      this.mode !== 'playing' ||
      this.transitionController.isActive() ||
      this.autoMove.isCombatLocked() ||
      this.autoMove.isInLore() ||
      this.stage4Cinematic.isActive()
    ) {
      return;
    }
    this.switchWeapon(weaponId);
    this.setWeaponWheelOpen(false);
    this.poseController.leftWheel.closeManual(performance.now());
  }

  public cancelWheelFromUI(): void {
    if (!this.weaponWheelOpen) return;
    this.setWeaponWheelOpen(false);
    this.poseController.leftWheel.closeManual(performance.now());
  }

  public dismissLore(): void {
    if (this.mode !== 'playing' || !this.autoMove.isInLore()) return;
    this.autoMove.dismissLore(this.cameraRig, this.getAutoMoveCallbacks());
  }

  public skipElevator(): void {
    if (this.mode !== 'playing' || !this.autoMove.canSkipElevator()) return;
    this.autoMove.skipElevator(this.cameraRig, this.getAutoMoveCallbacks());
  }

  public skipBossIntro(): void {
    if (this.mode !== 'playing' || !this.stage4Cinematic.canSkip()) return;
    this.stage4Cinematic.skip(this.cameraRig, this.scene, (mode) =>
      this.finishStage4Cinematic(mode)
    );
  }

  public skipTransition(): void {
    if (!this.transitionController.isActive()) return;
    this.transitionController.skip(this.cameraRig, this.weapon, (stageIdx) => {
      this.events.emit('stage:transition_end', { stageIndex: stageIdx });
    });
  }

  public skipBossCinematic(): void {
    if (!this.stage4Cinematic.canSkip()) return;
    this.stage4Cinematic.skip(this.cameraRig, this.scene, (mode) =>
      this.finishStage4Cinematic(mode)
    );
  }

  public skipStoryCinematic(): void {
    if (this.mode !== 'playing' || !this.storyCinematic.canSkip()) return;
    this.storyCinematic.skip(this.scene, this.cameraRig, this.getStoryCinematicCallbacks());
  }

  private playStageMusic(stageId: number): void {
    const track =
      stageId === 1
        ? 'music_stage1'
        : stageId === 2
        ? 'music_stage2'
        : stageId === 3
        ? 'music_stage3'
        : 'music_boss';
    void audioManager.playMusic(track);
  }

  private switchWeapon(weaponId: WeaponId): void {
    const changed = this.weaponManager.switchWeapon(weaponId);
    this.session.activeWeapon = weaponId;
    this.weapon.setActiveWeapon(weaponId);
    if (changed) {
      void audioManager.play('weapon_switch');
    }
  }

  private setWeaponWheelOpen(open: boolean): void {
    if (this.weaponWheelOpen === open) return;
    this.weaponWheelOpen = open;
    this.timeScale = open ? DEFAULT_GAME_CONFIG.weaponWheelTimeScale : 1.0;
    this.events.emit('wheel:toggled', { open });
    this.wheelVisualCb?.(open);
    void audioManager.play(open ? 'wheel_open' : 'wheel_close');
  }

  private getAutoMoveCallbacks(): AutoMovementCallbacks {
    return {
      onObjectiveBanner: (text) => {
        this.session.currentObjectiveOverride = text;
        this.emitMissionUpdate();
      },
      onStoryBanner: (label, sublabel, tone) => {
        this.events.emit('story:banner', { label, sublabel, tone });
      },
      onFootstep: () => void audioManager.play('footstep', { minIntervalMs: 140 }),
      onEnterCombatPoint: (stop) => {
        const stage = this.session.getCurrentStage();
        const waveIdx = stop.waveIndex ?? 0;
        const spawnZ = stop.spawnCenterZ ?? stop.z - 22;
        this.spawnSystem.startStopWave(stage, waveIdx, spawnZ, this.events);
        this.emitMissionUpdate();
      },
      onLoreOpened: (doc, index, total) => {
        this.setWeaponWheelOpen(false);
        this.poseController.leftWheel.reset();
        void audioManager.play('lore_paper');
        this.events.emit('lore:opened', {
          code: doc.code,
          title: doc.title,
          locationLabel: doc.locationLabel,
          body: doc.body,
          index,
          total,
        });
      },
      onLoreClosed: () => {
        this.events.emit('lore:closed', {});
      },
      onSiren: () => void audioManager.play('distant_siren'),
      onGateOpen: (kind) => {
        if (kind === 'bunker') void audioManager.play('bunker_open');
        else if (kind === 'arena_exit') void audioManager.play('exit_gate_open');
        else void audioManager.play('gate_open');
      },
      onCreatureRoar: () => void audioManager.play('boss_roar'),
      onFacilityAlarm: () => void audioManager.play('facility_alarm'),
      onElevatorChime: () => void audioManager.play('elevator_chime'),
      onElevatorHum: () => void audioManager.play('elevator_hum'),
      onElevatorDoorOpen: () => void audioManager.play('elevator_door_open'),
      onElevatorDoorClose: () => void audioManager.play('elevator_door_close'),
      onElevatorBrake: () => void audioManager.play('elevator_brake'),
      onElevatorSequenceEvent: (event) => {
        this.events.emit('elevator:sequence_event', { event });
      },
      onCameraStateChange: (state) => {
        this.cameraRig.setCameraState(state, this.events);
      },
      onElevatorState: (active, progress, depthMeters, canSkip, phaseLabel) => {
        this.events.emit('elevator:state', { active, progress, depthMeters, canSkip, phaseLabel });
      },
      onSetVillageGate: (open) => this.world.setVillageGateOpen(open),
      onUpdateStage1Creature: (visible, turnP, walkAwayP) => {
        this.world.updateStage1Creature(visible, turnP, walkAwayP);
      },
      onSetBunkerDoor: (open) => this.world.setBunkerDoorOpen(open),
      onSetAlphaKingSilhouette: (visible, vanishP) => {
        this.world.setAlphaKingSilhouette(visible, vanishP);
      },
      onSetKingElevatorSequence: (visible, phase, phaseP, elapsedSec) => {
        this.world.setKingElevatorSequence(visible, phase, phaseP, elapsedSec);
      },
      onSetFacilityAlarmVisual: (active) => this.world.setFacilityAlarm(active),
      onSetCorridorElevator: (doorOpen, descending, speedFactor, cageYOffset) => {
        this.world.setElevatorState({ doorOpen, descending, speedFactor, cageYOffset });
      },
      onSeamlessStageAdvance: (nextStageIndex) => {
        this.clearEntities();
        this.session.prepareStage(nextStageIndex, true);
        const nextStage = this.session.getCurrentStage();
        const introMeta = getStagePreInvasionIntro(nextStageIndex);
        this.weaponManager.prepareForNextStage(
          nextStage.carryStateFromPrevious.preserveAmmo,
          nextStage.carryStateFromPrevious.bonusGrenadesOnStageStart
        );
        this.spawnSystem.startStage(nextStage, this.events, true);
        this.combatSystem.reset(this.scene);
        audioManager.setEnvironmentAmbience(nextStage.environment);
        this.playStageMusic(nextStage.id);
        this.events.emit('story:banner', {
          label: nextStage.titleCard,
          sublabel: introMeta.quote,
          tone: 'objective',
          durationSec: 4.5,
        });
        this.emitMissionUpdate();
      },
      onSwitchToArenaWorld: () => {
        this.clearEntities();
        this.session.prepareStage(3, true);
        const arenaStage = this.session.getCurrentStage();
        this.weaponManager.prepareForNextStage(
          arenaStage.carryStateFromPrevious.preserveAmmo,
          arenaStage.carryStateFromPrevious.bonusGrenadesOnStageStart
        );
        this.world.loadBossArena(this.crowdDensity);
        this.world.setCrowdState('idle');
        this.spawnSystem.startStage(arenaStage, this.events, true);
        const boss = this.spawnSystem.spawnArenaBoss(
          arenaStage,
          this.zombies,
          this.scene,
          this.assetManager
        );
        boss.cinematicControlled = true;
        this.combatSystem.reset(this.scene);
        audioManager.setEnvironmentAmbience('boss_arena');
        this.playStageMusic(arenaStage.id);
        this.emitMissionUpdate();
      },
      onSetArenaElevatorGate: (open) => this.world.setArenaElevatorGateOpen(open),
      onEnterArenaBossIntro: () => {
        const arenaStage = this.session.getCurrentStage();
        const boss =
          this.zombies.find((z) => z.variant === 'boss') ??
          this.spawnSystem.spawnArenaBoss(
            arenaStage,
            this.zombies,
            this.scene,
            this.assetManager
          );
        this.setWeaponWheelOpen(false);
        this.poseController.leftWheel.reset();
        this.weapon.root.visible = false;
        audioManager.setArenaCrowdState('intro');
        this.events.emit('boss:intro_start', { bossName: 'THE KING · SUBJECT ALPHA' });
        this.stage4Cinematic.startBossIntro(boss, this.getStage4CinematicCallbacks());
      },
      onSetArenaExitGate: (open) => this.world.setArenaExitGateOpen(open),
      onSetArenaExitGateState: (lockRetract, openProgress, dustProgress) => {
        this.world.setArenaExitGateState({ lockRetract, openProgress, dustProgress });
      },
      onExitGateStateEvent: (state, progress) => {
        this.events.emit('stage:exit_gate_state', { state, progress });
      },
      onEnterGrandOutro: () => {
        this.startGrandOutro();
      },
      onEndingOverlay: (visible, title, subtitle, fadeAlpha) => {
        this.events.emit('campaign:ending_overlay', {
          visible,
          title,
          subtitle,
          fadeAlpha,
        });
      },
      onCampaignEndingComplete: () => {
        this.weapon.root.visible = false;
        this.mode = 'paused';
        this.activeProvider.disable();
        const summary = this.session.buildResult(
          true,
          this.pendingCompletionReason ||
            'The King has fallen. You walked out of the Arena of the Dead alive.'
        );
        this.events.emit('mission:completed', {
          stageIndex: this.session.stageIndex,
          campaignVictory: summary.campaignVictory,
        });
      },
      onSetWeaponVisible: (visible) => {
        this.weapon.root.visible = visible;
      },
    };
  }

  private getGrandOutroCallbacks(): GrandOutroCallbacks {
    return {
      onSetDawnAtmosphere: (t01) => {
        this.world.setArenaOutroDawnAtmosphere(t01);
      },
      onStartCelebrationAudio: () => {
        // Silence all horror ambience, distant groans & minor-key music before sunlit celebration
        audioManager.stopAmbience();
        audioManager.stopMusic();
        void audioManager.play('crowd_cheer_celebration');
        void audioManager.play('crowd_clap');
        void audioManager.playMusic('music_outro_celebration');
      },
      onCrowdCheerPulse: () => {
        void audioManager.play('crowd_cheer_celebration', { volume: 0.88 });
        void audioManager.play('crowd_clap', { volume: 0.85 });
      },
    };
  }

  private startGrandOutro(): void {
    this.setWeaponWheelOpen(false);
    this.poseController.leftWheel.reset();
    this.weapon.root.visible = false;
    this.grandOutro.start(this.cameraRig, this.getGrandOutroCallbacks());
  }

  private finishBossIntro(): void {
    this.events.emit('boss:intro_end', {});
    this.cameraRig.resetForGameplay();
    this.cameraRig.setBasePosition(0, 1.68, -2.0);
    this.cameraRig.setBaseHeadingYaw(0);
    this.cameraRig.update(0.016);

    const boss = this.zombies.find((z) => z.variant === 'boss') ?? null;
    if (boss) {
      boss.cinematicControlled = false;
      this.session.bossActive = true;
      this.session.bossName = 'THE KING · SUBJECT ALPHA';
      this.session.bossHealth = boss.health;
      this.session.bossMaxHealth = boss.maxHealth;
      this.session.bossPhase = 1;
      this.session.bossSuperPhase = 1;
      this.session.bossShielded = boss.bossShielded;
    }

    this.world.setCrowdState('cheering');
    audioManager.setArenaCrowdState('phase1');
    void audioManager.play('arena_crowd_cheer');
    this.weapon.root.visible = true;
    this.session.currentObjectiveOverride = 'Defeat The King (Subject Alpha)';
    this.events.emit('story:banner', {
      label: 'PHASE I · THE MONARCH AWAKENS',
      sublabel: 'Aim & Fire — Survive The Arena',
      tone: 'danger',
    });
    this.emitMissionUpdate();
  }

  private getStoryCinematicCallbacks(): StoryCinematicCallbacks {
    return {
      onStart: (payload) => {
        this.events.emit('story:cinematic_start', payload);
      },
      onFrame: (payload) => {
        this.events.emit('story:cinematic_frame', payload);
      },
      onEnd: (kind) => {
        this.events.emit('story:cinematic_end', { kind });
        if (kind === 'opening' && this.pendingPostOpeningStageIntro) {
          this.pendingPostOpeningStageIntro = false;
          this.storyCinematic.startStageIntro(
            this.session.stageIndex,
            this.scene,
            this.cameraRig,
            this.getStoryCinematicCallbacks()
          );
          return;
        }
        this.beginStageRouteAfterCinematic();
      },
      onPlaySfx: (sfx) => void audioManager.play(sfx),
      onSetCrowdState: (state) => this.world.setCrowdState(state),
      onSetFacilityAlarm: (active) => this.world.setFacilityAlarm(active),
      onSetExposure: (exposure) => {
        this.renderer.renderer.toneMappingExposure = exposure;
      },
    };
  }

  private beginStageRouteAfterCinematic(): void {
    const stage = this.session.getCurrentStage();
    this.cameraRig.resetForGameplay();
    this.weapon.root.visible = true;
    this.autoMove.startForStage(
      this.session.stageIndex,
      this.cameraRig,
      this.getAutoMoveCallbacks()
    );
    this.events.emit('story:banner', {
      label: stage.titleCard,
      sublabel: stage.subtitle,
      tone: 'objective',
    });
    this.emitMissionUpdate();
    void audioManager.play('weapon_handling');
  }

  public startMission(stageIndex: number): void {
    this.showcaseController.abortImmediate(
      this.scene,
      this.weapon,
      this.cameraRig,
      this.effectsSystem
    );
    this.renderer.renderer.toneMappingExposure = 1.15;
    this.clearEntities();
    this.stageCompletionDelayTimer = -1;
    this.pendingCompletionReason = '';
    this.bossFinalDeathTriggered = false;
    this.lastTriggeredBossPhase = 1;
    this.crowdCollapseActive = false;
    this.crowdCollapseProgress = 0;
    this.pendingPostOpeningStageIntro = false;

    this.storyCinematic.reset(this.scene, this.cameraRig);
    this.grandOutro.reset(this.cameraRig);
    this.chaseController.reset(this.cameraRig);
    this.stage4Cinematic.reset(this.cameraRig, this.scene);
    this.transitionController.reset(this.cameraRig, this.weapon);
    this.autoMove.reset(this.cameraRig);
    this.poseController.leftWheel.reset();
    this.setWeaponWheelOpen(false);
    this.events.emit('lore:closed', {});
    this.events.emit('elevator:state', {
      active: false,
      progress: 0,
      depthMeters: 0,
      canSkip: false,
    });
    this.events.emit('campaign:ending_overlay', {
      visible: false,
      title: '',
      subtitle: '',
      fadeAlpha: 0,
    });

    this.session.prepareStage(stageIndex, false);
    this.weaponManager.resetAll();
    this.weapon.setActiveWeapon('ar');

    const stage = this.session.getCurrentStage();
    if (stageIndex === 3) {
      this.world.loadBossArena(this.crowdDensity);
      this.world.setArenaElevatorGateOpen(1);
      this.world.setCrowdState('idle');
    } else {
      this.world.loadCampaignCorridor();
    }

    audioManager.setArenaCrowdState('off');
    audioManager.setEnvironmentAmbience(stage.environment);
    this.playStageMusic(stage.id);
    this.spawnSystem.startStage(stage, this.events, true);
    this.combatSystem.reset(this.scene);
    this.cameraRig.resetForGameplay();
    this.mode = 'playing';
    this.activeProvider.enable();

    if (stageIndex === 3) {
      const boss = this.spawnSystem.spawnArenaBoss(
        stage,
        this.zombies,
        this.scene,
        this.assetManager
      );
      boss.cinematicControlled = true;
    }

    if (STORY_CINEMATIC_CONFIG.enabled) {
      this.weapon.root.visible = false;
      if (stageIndex === 0) {
        this.pendingPostOpeningStageIntro = true;
        this.storyCinematic.startOpening(
          this.scene,
          this.cameraRig,
          this.getStoryCinematicCallbacks()
        );
      } else {
        this.storyCinematic.startStageIntro(
          stageIndex,
          this.scene,
          this.cameraRig,
          this.getStoryCinematicCallbacks()
        );
      }
    } else {
      this.beginStageRouteAfterCinematic();
    }
  }

  public pause(): void {
    if (this.mode !== 'playing') return;
    this.setWeaponWheelOpen(false);
    this.mode = 'paused';
    this.activeProvider.disable();
    audioManager.setArenaCrowdPaused(true);
  }

  public resume(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'playing';
    this.activeProvider.enable();
    audioManager.setArenaCrowdPaused(false);
  }

  public stopToBackdrop(): void {
    this.clearEntities();
    this.renderer.renderer.toneMappingExposure = 1.15;
    this.stageCompletionDelayTimer = -1;
    this.bossFinalDeathTriggered = false;
    this.lastTriggeredBossPhase = 1;
    this.crowdCollapseActive = false;
    this.crowdCollapseProgress = 0;
    this.pendingPostOpeningStageIntro = false;

    this.storyCinematic.reset(this.scene, this.cameraRig);
    this.grandOutro.reset(this.cameraRig);
    this.world.setBossPhase2Atmosphere(false);
    this.chaseController.reset(this.cameraRig);
    this.stage4Cinematic.reset(this.cameraRig, this.scene);
    this.transitionController.reset(this.cameraRig, this.weapon);
    this.autoMove.reset(this.cameraRig);
    this.setWeaponWheelOpen(false);
    this.events.emit('lore:closed', {});
    this.events.emit('elevator:state', {
      active: false,
      progress: 0,
      depthMeters: 0,
      canSkip: false,
    });
    this.events.emit('campaign:ending_overlay', {
      visible: false,
      title: '',
      subtitle: '',
      fadeAlpha: 0,
    });
    this.mode = 'backdrop';
    this.weapon.root.visible = false;
    this.activeProvider.disable();
    this.world.loadBossArena(this.crowdDensity);
    this.world.setCrowdState('idle');
    audioManager.setArenaCrowdState('off');
    audioManager.setEnvironmentAmbience('boss_arena');
    this.showcaseController.enterHomeIdle(
      this.scene,
      this.assetManager,
      this.weapon,
      this.cameraRig,
      this.effectsSystem
    );
  }

  public clearEntities(): void {
    for (const z of this.zombies) {
      z.dispose(this.scene);
    }
    this.zombies.length = 0;
    this.chaseController.reset(this.cameraRig);
    this.combatSystem.clearProjectiles(this.scene);
    this.grenadeManager.clear(this.scene);
    this.effectsSystem.clear(this.scene);
    this.session.activeZombieCount = 0;
  }

  private getStage4CinematicCallbacks(): Stage4CinematicCallbacks {
    return {
      onFrameUI: (payload) => {
        if (payload.mode === 'boss_intro') {
          this.events.emit('boss:intro_frame', {
            title: payload.shotLabel,
            subtitle: payload.subtitle,
            canSkip: payload.canSkip,
            fadeAlpha: payload.fadeAlpha,
          });
        } else {
          this.events.emit('boss:cinematic_frame', {
            shotLabel: payload.shotLabel,
            subtitle: payload.subtitle,
            eyebrow: payload.eyebrow,
            canSkip: payload.canSkip,
            fadeAlpha: payload.fadeAlpha,
            revealTitle: payload.revealTitle,
            revealSubtitle: payload.revealSubtitle,
          });
        }
      },
      onRoyalCommand: () => {
        this.world.setCrowdState('hysterical');
        audioManager.triggerArenaCrowdReaction('royal_command');
        void audioManager.play('arena_crowd_cheer');
      },
      onKingRoar: () => {
        void audioManager.play('boss_roar');
      },
      onBossHitImpact: () => {
        void audioManager.play('boss_hit');
        void audioManager.play('explosion');
      },
      onImpactThud: () => {
        void audioManager.play('boss_slam_impact');
        if (this.stage4Cinematic.getMode() === 'boss_final_death') {
          this.crowdCollapseActive = true;
          this.crowdCollapseProgress = 0.02;
          this.world.setCrowdState('collapsing', 0.02);
        } else {
          this.world.setCrowdState('idle');
        }
      },
      onSilenceHush: () => {
        audioManager.silenceAllMusicAndDistant();
        audioManager.setArenaCrowdState('phase1_defeat_silence');
        this.world.setCrowdState('silent_freeze');
      },
      onKingBreathing: () => {
        void audioManager.play('king_breathing');
      },
      onResurrectionTwitch: () => {
        audioManager.setArenaCrowdState('phase2_transform');
        void audioManager.play('boss_hit');
      },
      onMutationMorph: () => {
        audioManager.setArenaCrowdState('phase2_transform');
        void audioManager.play('boss_mutation_morph');
      },
      onPhase2Reveal: () => {
        this.world.setArenaPhaseAtmosphere(2);
        this.world.setCrowdState('hysterical');
        audioManager.triggerArenaCrowdReaction('phase2_reveal');
        void audioManager.play('arena_crowd_cheer');
        void audioManager.play('boss_phase2_roar');
      },
      onRoarFade: () => {
        audioManager.setArenaCrowdState('off');
        void audioManager.play('boss_death');
      },
      onVictoryCue: () => {
        void audioManager.playMusic('music_victory');
      },
      onComplete: (mode) => this.finishStage4Cinematic(mode),
    };
  }

  private finishStage4Cinematic(mode: Exclude<Stage4CinematicMode, 'none'>): void {
    if (mode === 'boss_intro') {
      this.finishBossIntro();
      return;
    }

    if (mode === 'phase1_to_phase2') {
      this.activatePhase2Encounter();
      return;
    }

    // mode === 'boss_final_death'
    this.events.emit('boss:cinematic_end', {});
    this.events.emit('boss:final_death', { bossName: 'THE KING · SUBJECT ALPHA' });
    this.crowdCollapseActive = true;
    this.crowdCollapseProgress = 1;
    this.world.setCrowdState('collapsing', 1);
    this.cameraRig.resetForGameplay();

    const boss = this.zombies.find((z) => z.variant === 'boss');
    if (boss) {
      boss.cinematicControlled = true;
      boss.setCinematicDeathProgress(1);
    }

    // Reposition player near south arena center to walk north past The Fallen King & collapsed crowd toward Exit Gate
    this.cameraRig.setBasePosition(0, 1.68, -6);
    this.cameraRig.setBaseHeadingYaw(0);
    this.cameraRig.update(0.016);
    this.autoMove.startArenaExitWalk(this.cameraRig, this.getAutoMoveCallbacks());
  }

  private activatePhase2Encounter(): void {
    this.events.emit('boss:cinematic_end', {});
    this.cameraRig.resetForGameplay();

    const bossEntity = this.zombies.find((z) => z.variant === 'boss') ?? null;
    if (bossEntity) {
      bossEntity.activatePhase2Combat();
      this.session.bossActive = true;
      this.session.bossName = 'THE KING · SUBJECT ALPHA';
      this.session.bossHealth = bossEntity.health;
      this.session.bossMaxHealth = bossEntity.maxHealth;
      this.session.bossPhase = 2;
      this.session.bossSuperPhase = 2;
      this.session.bossShielded = false;
      this.lastTriggeredBossPhase = 2;
    }

    this.world.setArenaPhaseAtmosphere(2);
    this.world.setCrowdState('hysterical');
    audioManager.setArenaCrowdState('phase2_chase');
    void audioManager.playMusic('music_boss_phase2');
    audioManager.setBossMusicPhase(2);

    if (bossEntity) {
      this.chaseController.start(this.cameraRig, bossEntity, this.scene, {
        onBossStep: () => void audioManager.play('boss_slam_impact', { minIntervalMs: 360, volume: 0.42 }),
        onPhase2Roar: () => {
          void audioManager.play('boss_phase2_roar');
          audioManager.triggerArenaCrowdReaction('chase_roar');
        },
        onCrowdHysterical: () => {
          this.world.setCrowdState('hysterical');
          audioManager.triggerArenaCrowdReaction('chase_roar');
          void audioManager.play('arena_crowd_cheer');
        },
        onJumpPrep: () => void audioManager.play('boss_jump_prep'),
        onJumpLaunch: () => {
          void audioManager.play('boss_jump_air');
          audioManager.triggerArenaCrowdReaction('jump_launch');
        },
        onJumpLand: () => {
          void audioManager.play('boss_jump_land');
          audioManager.triggerArenaCrowdReaction('jump_land');
        },
        onChaseStart: () => {
          audioManager.setArenaCrowdState('phase2_chase');
          audioManager.triggerArenaCrowdReaction('chase_roar');
        },
        onChaseCompleted: () => {
          audioManager.setArenaCrowdState('phase2_combat');
          this.world.setCrowdState('cheering');
          this.weapon.root.visible = true;
          this.session.currentObjectiveOverride = 'Defeat The King — Phase 2!';
          this.events.emit('story:banner', {
            label: 'STAND YOUR GROUND · PHASE 2 COMBAT!',
            sublabel: 'Free Aim Restored — Bring Down The King!',
            tone: 'danger',
            durationSec: 3.2,
          });
          this.emitMissionUpdate();
        },
      });
    }

    this.weapon.root.visible = true;
    this.session.currentObjectiveOverride = 'Survive Phase 2 — Bring Down The King';
    this.events.emit('boss:phase_transition', {
      fromPhase: 1,
      toPhase: 2,
      label: '',
      transitioning: false,
    });
    this.events.emit('boss:phase2_reveal', { bossName: 'THE KING' });
    this.events.emit('story:banner', {
      label: 'PHASE 2 · THE KING APPROACHES',
      sublabel: 'Stand Your Ground — Aim & Fire!',
      tone: 'danger',
    });
    this.emitMissionUpdate();
  }

  private startBossDeathCinematic(boss: Zombie): void {
    if (this.bossFinalDeathTriggered) return;
    this.bossFinalDeathTriggered = true;

    audioManager.silenceAllMusicAndDistant();
    audioManager.setArenaCrowdState('off');
    this.world.setCrowdState('silent_freeze');
    this.stageCompletionDelayTimer = -1;
    this.pendingCompletionReason =
      'The King has fallen. You walked out of the Arena of the Dead alive.';
    this.chaseController.reset(this.cameraRig);
    this.setWeaponWheelOpen(false);
    this.poseController.leftWheel.reset();
    this.weapon.root.visible = false;
    this.combatSystem.clearProjectiles(this.scene);
    this.grenadeManager.clear(this.scene);

    // Clear any leftover minor zombies before final cinematic
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const other = this.zombies[i];
      if (other !== boss) {
        other.dispose(this.scene);
        this.zombies.splice(i, 1);
      }
    }

    this.session.bossActive = false;
    this.events.emit('boss:cinematic_start', {
      bossName: 'THE KING · SUBJECT ALPHA',
      isResurrection: false,
      eyebrow: 'Campaign Finale',
    });

    this.stage4Cinematic.startFinalDeath(boss, this.scene, this.getStage4CinematicCallbacks());
  }

  private handleBossPhaseTransition(
    phase: 1 | 2,
    shielded: boolean,
    transitionStarted = false
  ): void {
    if (!transitionStarted) {
      return;
    }

    // Phase 1 has just reached 0 HP: immediately launch the 6-shot Phase 1 -> Phase 2 cinematic
    const bossEntity = this.zombies.find((z) => z.variant === 'boss') ?? null;
    if (!bossEntity || this.lastTriggeredBossPhase >= 2 || this.stage4Cinematic.isActive()) {
      return;
    }

    this.lastTriggeredBossPhase = 2;
    this.session.bossPhase = 1;
    this.session.bossShielded = shielded;
    this.session.bossActive = false; // Hide Boss HP bar during transition cinematic

    this.setWeaponWheelOpen(false);
    this.poseController.leftWheel.reset();
    this.weapon.root.visible = false;
    this.combatSystem.clearProjectiles(this.scene);
    this.grenadeManager.clear(this.scene);

    this.events.emit('boss:phase_transition', {
      fromPhase: 1,
      toPhase: 2,
      label: 'PHASE 1 → PHASE 2',
      transitioning: true,
    });
    this.events.emit('boss:cinematic_start', {
      bossName: 'THE KING · SUBJECT ALPHA',
      isResurrection: true,
      eyebrow: 'Phase 1 Broken',
    });

    this.stage4Cinematic.startPhase1ToPhase2(
      bossEntity,
      this.scene,
      this.effectsSystem,
      this.getStage4CinematicCallbacks()
    );
    this.emitMissionUpdate();
  }

  private emitMissionUpdate(): void {
    const stage = this.session.getCurrentStage();
    const waveInfo = this.spawnSystem.getWaveInfo(stage);
    const activeId = this.weaponManager.getActiveWeaponId();
    const activeSlot = this.weaponManager.getSlot(activeId);
    const grenadeSlot = this.weaponManager.getSlot('grenade');

    this.session.waveIndex = waveInfo.waveIndex;
    this.session.totalWaves = waveInfo.totalWaves;
    this.session.waveName = waveInfo.waveName;
    this.session.remainingEnemies = waveInfo.remainingInQueue + this.session.activeZombieCount;

    this.events.emit('mission:updated', {
      kills: this.session.kills,
      targetKills: waveInfo.totalStageEnemies,
      remainingTimeSec: this.session.remainingTimeSec,
      score: this.session.score,
      health: this.session.health,
      maxHealth: this.session.maxHealth,
      activeWeapon: activeId,
      ammo: activeSlot.ammo,
      magazineSize: activeSlot.magazineSize,
      isReloading: activeSlot.isReloading,
      grenadeCount: grenadeSlot.ammo,
      grenadeMax: grenadeSlot.magazineSize,
      grenadeCooldownSec: grenadeSlot.cooldownRemainingMs / 1000,
      waveIndex: waveInfo.waveIndex,
      totalWaves: waveInfo.totalWaves,
      waveName: waveInfo.waveName,
      remainingEnemies: this.session.remainingEnemies,
      objectiveBanner: this.session.currentObjectiveOverride,
      bossActive: this.session.bossActive,
      bossName: this.session.bossName,
      bossHealth: this.session.bossHealth,
      bossMaxHealth: this.session.bossMaxHealth,
      bossPhase: this.session.bossPhase,
      bossSuperPhase: this.session.bossSuperPhase,
      bossShielded: this.session.bossShielded,
    });
  }

  private tick(dtSec: number, elapsedSec: number, nowMs: number): void {
    this.world.update(elapsedSec, dtSec, this.autoMove.getPlayerZ());

    if (this.mode === 'backdrop') {
      this.showcaseController.update(
        dtSec,
        elapsedSec,
        this.scene,
        this.cameraRig,
        this.weapon,
        this.assetManager,
        this.effectsSystem,
        {
          onArFire: () => void audioManager.play('ar_fire', { minIntervalMs: 85 }),
          onSmgFire: () => void audioManager.play('smg_fire', { minIntervalMs: 55 }),
          onZombieHit: () => void audioManager.play('zombie_hit', { minIntervalMs: 90, volume: 0.72 }),
          onZombieDeath: () => void audioManager.play('zombie_death', { minIntervalMs: 110, volume: 0.8 }),
          onZombieGroan: (x, z, variant) => {
            const sfx =
              variant === 'runner'
                ? 'zombie_runner_shriek'
                : variant === 'crawler'
                ? 'crawler_screech'
                : variant === 'mutated'
                ? 'zombie_mutated_gurgle'
                : 'zombie_groan_basic';
            void audioManager.playSpatial(
              sfx,
              x,
              z,
              this.cameraRig.camera.position.x,
              this.cameraRig.camera.position.z,
              this.cameraRig.camera.rotation.y,
              { minIntervalMs: 500, volume: 0.65 }
            );
          },
          onBossMutation: () => void audioManager.play('boss_mutation_morph'),
          onBossRoar: () => void audioManager.play('boss_phase2_roar'),
          onBossJumpPrep: () => void audioManager.play('boss_jump_prep'),
          onBossJumpLand: () => void audioManager.play('boss_jump_land'),
          onFadeOutDemoAudio: () => audioManager.fadeOutMusic(1.25),
          onRestoreMenuAudio: () => {
            void audioManager.playMusic('music_menu');
          },
          onSetExposure: (exposure) => {
            this.renderer.renderer.toneMappingExposure = exposure;
          },
          onCrowdState: (state, excitement) => {
            this.world.setCrowdState(state, undefined, excitement);
          },
        }
      );
      this.renderer.render(this.scene, this.cameraRig.camera);
      return;
    }

    if (this.mode === 'paused') {
      this.renderer.render(this.scene, this.cameraRig.camera);
      return;
    }

    if (this.storyCinematic.isActive()) {
      this.storyCinematic.update(
        dtSec,
        this.scene,
        this.cameraRig,
        this.getStoryCinematicCallbacks()
      );
      this.renderer.render(this.scene, this.cameraRig.camera);
      return;
    }

    // Unified Stage 4 Cinematics (Boss Intro / Phase 1->2 Transformation / Final Death)
    if (this.stage4Cinematic.isActive()) {
      if (this.crowdCollapseActive) {
        this.crowdCollapseProgress = Math.min(1, this.crowdCollapseProgress + dtSec * 0.42);
        this.world.setCrowdState('collapsing', this.crowdCollapseProgress);
      }
      this.stage4Cinematic.update(
        dtSec,
        this.cameraRig,
        this.scene,
        this.effectsSystem,
        this.getStage4CinematicCallbacks()
      );
      this.cameraRig.update(dtSec);
      this.effectsSystem.update(this.scene, dtSec);
      this.renderer.render(this.scene, this.cameraRig.camera);
      return;
    }

    // Grand BINUS Sunlit Celebration Outro & Live End Card
    if (this.grandOutro.isActive()) {
      this.weapon.root.visible = false;
      this.grandOutro.update(dtSec, this.cameraRig, this.getGrandOutroCallbacks());
      this.cameraRig.update(dtSec);
      this.effectsSystem.update(this.scene, dtSec);
      this.renderer.render(this.scene, this.cameraRig.camera);
      return;
    }

    // Input runs at real-time 1.0x even during weapon wheel slow motion
    const input = this.activeProvider.poll(nowMs, dtSec);
    this.lastInputState = input;

    if (input.pauseTriggered) {
      this.setWeaponWheelOpen(false);
      this.events.emit('pose:pause_gesture', {});
      this.renderer.render(this.scene, this.cameraRig.camera);
      return;
    }

    const isTransitioning = this.transitionController.isActive();
    const moveCallbacks = this.getAutoMoveCallbacks();
    const movementLocked =
      isTransitioning || this.autoMove.isCombatLocked() || this.autoMove.isInLore();

    // Dual-Hand Gesture + Keyboard Weapon Wheel Controls (only allowed when combat/walking active)
    if (!movementLocked) {
      if (input.wheelTogglePressed) {
        const res = this.poseController.leftWheel.toggleManual(nowMs);
        this.setWeaponWheelOpen(res.wheelOpen);
      } else if (input.wheelCancelPressed && this.weaponWheelOpen) {
        this.cancelWheelFromUI();
      } else if (input.directWeaponSelect) {
        this.selectWeaponFromUI(input.directWeaponSelect);
      } else if (input.wheelGesture) {
        const wg = input.wheelGesture;
        if (wg.selectedWeapon) {
          this.switchWeapon(wg.selectedWeapon);
        }
        if (wg.wheelOpen !== this.weaponWheelOpen) {
          this.setWeaponWheelOpen(wg.wheelOpen);
        }
      }
    } else if (this.weaponWheelOpen) {
      this.setWeaponWheelOpen(false);
    }

    const scaledDt = dtSec * this.timeScale;
    const stage = this.session.getCurrentStage();
    const bossEntity = this.zombies.find((z) => z.variant === 'boss') ?? null;

    // Advance Automatic Campaign Route / Elevator / Arena Exit Walk
    this.autoMove.update(scaledDt, this.cameraRig, moveCallbacks);

    // Check if current Combat Point wave cleared (Stages 1–3)
    if (
      this.autoMove.getState() === 'combat_stop' &&
      this.session.stageIndex < 3 &&
      !this.stage4Cinematic.isActive()
    ) {
      const aliveAtStop = this.zombies.filter((z) => z.state !== 'dead').length;
      if (this.spawnSystem.isCurrentStopCleared(aliveAtStop)) {
        this.autoMove.notifyCombatPointCleared(moveCallbacks);
      }
    }

    let chaseOptions:
      | {
          bossSpeedOverride?: number;
          bossJumpTargetOverride?: THREE.Vector3;
          bossExternalMoveHandled?: boolean;
          bossAllowAutoJump?: boolean;
        }
      | undefined;

    let thirdPersonChaseActive = false;

    if (
      this.chaseController.isActive() &&
      this.stageCompletionDelayTimer < 0 &&
      !this.stage4Cinematic.isActive()
    ) {
      const chaseRes = this.chaseController.update(
        scaledDt,
        this.cameraRig,
        bossEntity,
        input.aimX
      );
      thirdPersonChaseActive = chaseRes.thirdPersonCamera;
      if (chaseRes.footstepTriggered) {
        void audioManager.play('chase_footstep', { minIntervalMs: 180, volume: 0.7 });
      }
      if (chaseRes.active) {
        const ctrlPose = this.chaseController.controlsBossPose();
        chaseOptions = {
          bossExternalMoveHandled: ctrlPose,
          bossAllowAutoJump: !ctrlPose,
          bossSpeedOverride: BOSS_PHASE2_CONFIG.chaseSpeed,
          bossJumpTargetOverride: this.chaseController.getBossJumpInterceptPoint(bossEntity),
        };
      }
    }

    // Player aiming remains 100% active during walking, combat, and FPS beats
    this.cameraRig.setAimParallax(input.aimX, input.aimY);
    this.cameraRig.update(scaledDt);

    const activeSlot = this.weaponManager.getSlot();
    const grenadeCooldownSec = this.weaponManager.getSlot('grenade').cooldownRemainingMs / 1000;
    this.weapon.setAim(input.aimX, input.aimY);
    this.weapon.update(
      scaledDt,
      activeSlot.isReloading,
      grenadeCooldownSec,
      this.weaponManager.getReloadProgress()
    );

    const combatLocked =
      this.stageCompletionDelayTimer >= 0 ||
      this.stage4Cinematic.isActive() ||
      this.grandOutro.isActive() ||
      thirdPersonChaseActive ||
      this.autoMove.isCombatLocked() ||
      this.autoMove.isInLore();

    if (
      !this.stage4Cinematic.isActive() &&
      !this.grandOutro.isActive() &&
      !this.autoMove.isCombatLocked() &&
      !this.autoMove.isInLore() &&
      this.stageCompletionDelayTimer < 0
    ) {
      this.weapon.root.visible = !thirdPersonChaseActive;
    }

    if (!combatLocked && this.session.stageIndex < 3) {
      this.spawnSystem.update(
        scaledDt,
        stage,
        this.zombies,
        this.world.spawnPoints,
        this.scene,
        this.assetManager,
        this.events,
        (spawned) => {
          if (spawned.variant === 'boss') {
            void audioManager.play('boss_roar');
          } else if (spawned.variant === 'crawler') {
            void audioManager.play('crawler_screech', { minIntervalMs: 550, volume: 0.72 });
          }
        }
      );
    }

    const effectiveInput = this.weaponWheelOpen ? { ...input, fireHeld: false } : input;

    this.combatSystem.update(
      scaledDt,
      effectiveInput,
      combatLocked,
      this.session,
      this.zombies,
      this.scene,
      this.cameraRig,
      this.weapon,
      this.weaponManager,
      this.grenadeManager,
      this.raycastSystem,
      this.effectsSystem,
      this.scoreSystem,
      this.events,
      {
        onArFire: () => void audioManager.play('ar_fire', { minIntervalMs: 60 }),
        onSmgFire: () => void audioManager.play('smg_fire', { minIntervalMs: 45 }),
        onFlameBurst: () =>
          void audioManager.play('flamethrower_burst', { minIntervalMs: 95 }),
        onGrenadeThrow: () => void audioManager.play('grenade_throw'),
        onExplosion: () => void audioManager.play('explosion'),
        onEmptyClick: () => void audioManager.play('weapon_empty', { minIntervalMs: 220 }),
        onReloadStart: () => void audioManager.play('weapon_reload'),
        onReloadPhase: (weaponId, phase) => {
          if (phase === 'mag_out') {
            void audioManager.play('reload_mag_out');
          } else if (phase === 'mag_in') {
            void audioManager.play(weaponId === 'flamethrower' ? 'reload_fuel' : 'reload_mag_in');
          } else {
            void audioManager.play(weaponId === 'flamethrower' ? 'reload_fuel' : 'reload_bolt');
          }
        },
        onReloadComplete: () => void audioManager.play('weapon_handling'),
        onZombieHit: () => void audioManager.play('zombie_hit', { minIntervalMs: 70 }),
        onZombieImpact: (zombie, headshot, effectiveness) => {
          const impactSfx =
            zombie.variant === 'armored' ||
            (zombie.variant === 'boss' && zombie.bossShielded) ||
            effectiveness === 'resisted'
              ? 'impact_armor'
              : zombie.variant === 'mutated' ||
                zombie.variant === 'exploder' ||
                (zombie.variant === 'boss' && zombie.bossPhase >= 2)
              ? 'impact_mutated'
              : headshot || effectiveness === 'weak'
              ? 'impact_heavy'
              : 'impact_flesh';
          void audioManager.play(impactSfx, { minIntervalMs: 48 });
        },
        onZombieDeath: () => void audioManager.play('zombie_death', { minIntervalMs: 80 }),
        onZombieAttack: () => void audioManager.play('zombie_attack'),
        onZombieGroan: (zombie) => {
          const sfx =
            zombie.variant === 'runner'
              ? 'zombie_runner_shriek'
              : zombie.variant === 'crawler'
              ? 'crawler_screech'
              : zombie.variant === 'armored'
              ? 'zombie_armored_clank'
              : zombie.variant === 'mutated' || zombie.variant === 'exploder'
              ? 'zombie_mutated_gurgle'
              : zombie.variant === 'boss'
              ? zombie.bossPhase >= 2
                ? 'boss_phase2_roar'
                : 'boss_roar'
              : 'zombie_groan_basic';
          void audioManager.playSpatial(
            sfx,
            zombie.root.position.x,
            zombie.root.position.z,
            this.cameraRig.camera.position.x,
            this.cameraRig.camera.position.z,
            this.cameraRig.camera.rotation.y,
            { minIntervalMs: 420 }
          );
        },
        onBossRoar: () => {
          void audioManager.play('boss_roar');
          if (this.session.stageIndex === 3) {
            audioManager.triggerArenaCrowdReaction('boss_attack');
          }
        },
        onBossHit: () => void audioManager.play('boss_hit', { minIntervalMs: 90 }),
        onBossShockwave: () => {
          void audioManager.play('boss_shockwave');
          if (this.session.stageIndex === 3) {
            audioManager.triggerArenaCrowdReaction('boss_attack');
          }
        },
        onBossTendril: () => void audioManager.play('boss_tendril_fire'),
        onBossJumpPrep: () => void audioManager.play('boss_jump_prep'),
        onBossJumpLaunch: () => {
          void audioManager.play('boss_jump_air');
          if (this.session.stageIndex === 3) {
            audioManager.triggerArenaCrowdReaction('jump_launch');
          }
        },
        onBossJumpLand: () => {
          void audioManager.play('boss_jump_land');
          if (this.session.stageIndex === 3) {
            audioManager.triggerArenaCrowdReaction('jump_land');
          }
        },
        onBossPhaseChanged: (phase, shielded, transitionStarted) =>
          this.handleBossPhaseTransition(phase, shielded, transitionStarted),
        onBossDeath: (boss) => {
          this.startBossDeathCinematic(boss);
        },
      },
      chaseOptions
    );

    this.effectsSystem.update(this.scene, scaledDt);

    const aliveCount = this.zombies.filter((z) => z.state !== 'dead').length;
    const outcome = this.missionSystem.update(
      scaledDt,
      this.session,
      stage,
      this.spawnSystem,
      aliveCount,
      true
    );
    this.emitMissionUpdate();

    this.hudSnapshotCb?.({
      input: this.lastInputState,
      fps: this.loop.getFps(),
      activeZombies: this.session.activeZombieCount,
      missionState: `Stage ${stage.id}: ${stage.name}`,
      weaponWheelOpen: this.weaponWheelOpen,
      timeScale: this.timeScale,
      isTransitioning: this.autoMove.isCombatLocked(),
    });

    if (outcome.status === 'failed' && !this.bossFinalDeathTriggered) {
      this.setWeaponWheelOpen(false);
      this.mode = 'paused';
      this.activeProvider.disable();
      this.session.buildResult(false, outcome.reason);
      this.events.emit('mission:failed', {
        stageIndex: this.session.stageIndex,
        reason: outcome.reason,
      });
    }

    this.renderer.render(this.scene, this.cameraRig.camera);
  }

  public getDebugConfigSummary(): Record<string, number> {
    const activeDef = this.weaponManager.getActiveDefinition();
    return {
      weaponDamage: activeDef.damage,
      fireRateMs: activeDef.fireRateMs,
      magazineSize: activeDef.magazineSize,
      timeScale: this.timeScale,
    };
  }

  public dispose(): void {
    audioManager.setArenaCrowdState('off');
    this.loop.stop();
    window.removeEventListener('resize', this.onResizeBound);
    this.activeProvider.disable();
    this.mouseProvider.dispose();
    this.poseProvider.dispose();
    this.showcaseController.dispose(this.scene);
    this.clearEntities();
    this.storyCinematic.reset(this.scene, this.cameraRig);
    this.grandOutro.reset(this.cameraRig);
    this.stage4Cinematic.reset(this.cameraRig, this.scene);
    this.autoMove.reset(this.cameraRig);
    this.weapon.dispose(this.cameraRig.camera);
    this.combatSystem.dispose(this.scene);
    this.grenadeManager.dispose(this.scene);
    this.effectsSystem.dispose(this.scene);
    this.world.dispose(this.scene);
    this.assetManager.dispose();
    this.renderer.dispose();
  }
}
