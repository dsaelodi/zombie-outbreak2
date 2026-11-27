import * as THREE from 'three';
import type { CameraStateId, ElevatorSequenceEvent } from '../../core/EventBus';
import { DEFAULT_GAME_CONFIG, STORY_CINEMATIC_CONFIG } from '../../data/gameConfig';
import {
  getStageRoute,
  LORE_DOCUMENTS,
  type LoreDocument,
  type RouteStopPoint,
  type StageRouteConfig,
} from '../../data/campaignRoutes';
import { clamp, lerp } from '../../utils/math';
import type { CameraRig } from '../CameraRig';

export type AutoMoveState =
  | 'idle'
  | 'walking'
  | 'combat_stop'
  | 'lore_inspect'
  | 'stage1_ending'
  | 'stage2_ending'
  | 'elevator_boarding'
  | 'elevator_descent'
  | 'elevator_exit'
  | 'arena_exit_walk'
  | 'ending_card';

export interface AutoMovementCallbacks {
  onObjectiveBanner: (text: string) => void;
  onStoryBanner: (label: string, sublabel?: string, tone?: 'warning' | 'objective' | 'danger' | 'ending') => void;
  onFootstep: () => void;
  onEnterCombatPoint: (stop: RouteStopPoint) => void;
  onLoreOpened: (doc: LoreDocument, index: number, total: number) => void;
  onLoreClosed: () => void;
  onSiren: () => void;
  onGateOpen: (kind: 'village' | 'bunker' | 'arena_elevator' | 'arena_exit') => void;
  onCreatureRoar: () => void;
  onFacilityAlarm: () => void;
  onElevatorChime: () => void;
  onElevatorHum: () => void;
  onElevatorDoorOpen?: () => void;
  onElevatorDoorClose?: () => void;
  onElevatorBrake?: () => void;
  onElevatorSequenceEvent?: (event: ElevatorSequenceEvent) => void;
  onCameraStateChange?: (state: CameraStateId) => void;
  onElevatorState: (
    active: boolean,
    progress: number,
    depthMeters: number,
    canSkip: boolean,
    phaseLabel?: string
  ) => void;
  onSetVillageGate: (open: number) => void;
  onUpdateStage1Creature: (visible: boolean, turnP: number, walkAwayP: number) => void;
  onSetBunkerDoor: (open: number) => void;
  onSetAlphaKingSilhouette: (visible: boolean, vanishP: number) => void;
  onSetKingElevatorSequence?: (
    visible: boolean,
    phase: 'idle' | 'approaching' | 'entering' | 'positioned' | 'closing' | 'descending' | 'gone',
    phaseP: number,
    elapsedSec: number
  ) => void;
  onSetFacilityAlarmVisual: (active: boolean) => void;
  onSetCorridorElevator: (
    doorOpen: number,
    descending: boolean,
    speedFactor: number,
    cageYOffset?: number
  ) => void;
  onSeamlessStageAdvance: (nextStageIndex: number) => void;
  onSwitchToArenaWorld: () => void;
  onSetArenaElevatorGate: (open: number) => void;
  onEnterArenaBossIntro: () => void;
  onSetArenaExitGate: (open: number) => void;
  onSetArenaExitGateState?: (lockRetract: number, openProgress: number, dustProgress: number) => void;
  onExitGateStateEvent?: (state: 'approaching' | 'unlocking' | 'opening' | 'passing', progress: number) => void;
  onEnterGrandOutro?: () => void;
  onEndingOverlay: (visible: boolean, title: string, subtitle: string, fadeAlpha: number) => void;
  onCampaignEndingComplete: () => void;
  onSetWeaponVisible: (visible: boolean) => void;
}

export class AutoMovementController {
  private state: AutoMoveState = 'idle';
  private route: StageRouteConfig = getStageRoute(0);
  private waypointIdx = 0;
  private triggeredStops = new Set<string>();
  private emittedElevatorEvents = new Set<ElevatorSequenceEvent>();
  private activeStop: RouteStopPoint | null = null;

  private readonly playerPos = new THREE.Vector3(0, 1.68, 0);
  private headingYaw = 0;
  private footstepAccum = 0;
  private sequenceTimer = 0;

  // Lore sub-state
  private loreQueue: LoreDocument[] = [];
  private loreCursor = 0;
  private loreTimer = 0;

  // Story event flags
  private flagA = false;
  private flagB = false;
  private flagC = false;
  private flagD = false;
  private arenaWorldSwapped = false;
  private kingSequenceElapsed = 0;
  private elevatorShakeCooldownSec = 0;

  // Animated Arena Exit Gate state
  private exitGatePhase: 'approaching' | 'focus_wait' | 'unlocking' | 'opening' | 'passing' = 'approaching';
  private exitGateTimer = 0;
  private exitGateOpenProgress = 0;
  private exitGateWaitPosition = new THREE.Vector2(0, -31.5);
  private exitGateHeadingYaw = 0;
  private exitApproachWaypoints: THREE.Vector2[] = [];
  private exitApproachWaypointIndex = 0;
  private exitPassWaypoints: THREE.Vector2[] = [];
  private exitPassWaypointIndex = 0;

  public getState(): AutoMoveState {
    return this.state;
  }

  public getPlayerZ(): number {
    return this.playerPos.z;
  }

  public getExitGatePhase(): 'approaching' | 'focus_wait' | 'unlocking' | 'opening' | 'passing' {
    return this.exitGatePhase;
  }

  public getExitGateOpenProgress(): number {
    return this.exitGateOpenProgress;
  }

  public isCombatLocked(): boolean {
    return (
      this.state === 'stage1_ending' ||
      this.state === 'stage2_ending' ||
      this.state === 'elevator_boarding' ||
      this.state === 'elevator_descent' ||
      this.state === 'elevator_exit' ||
      this.state === 'arena_exit_walk' ||
      this.state === 'ending_card'
    );
  }

  public isInLore(): boolean {
    return this.state === 'lore_inspect';
  }

  public canSkipElevator(): boolean {
    return this.state === 'elevator_descent' && this.sequenceTimer >= 1.5;
  }

  private emitElevatorEvent(event: ElevatorSequenceEvent, callbacks: AutoMovementCallbacks): void {
    if (this.emittedElevatorEvents.has(event)) return;
    this.emittedElevatorEvents.add(event);
    callbacks.onElevatorSequenceEvent?.(event);
  }

  public getEmittedElevatorEvents(): ElevatorSequenceEvent[] {
    return Array.from(this.emittedElevatorEvents);
  }

  public startForStage(stageIndex: number, cameraRig: CameraRig, callbacks: AutoMovementCallbacks): void {
    this.route = getStageRoute(stageIndex);
    this.triggeredStops.clear();
    this.emittedElevatorEvents.clear();
    this.activeStop = null;
    this.loreQueue = [];
    this.loreCursor = 0;
    this.sequenceTimer = 0;
    this.flagA = false;
    this.flagB = false;
    this.flagC = false;
    this.flagD = false;
    this.kingSequenceElapsed = 0;
    this.elevatorShakeCooldownSec = 0;
    this.arenaWorldSwapped = stageIndex === 3;

    this.playerPos.set(this.route.startPos.x, this.route.startPos.y, this.route.startPos.z);
    this.waypointIdx = 1;
    this.headingYaw = 0;
    this.footstepAccum = 0.2;

    callbacks.onCameraStateChange?.('NORMAL_FPS');

    cameraRig.setBasePosition(this.playerPos.x, this.playerPos.y, this.playerPos.z);
    cameraRig.setBaseHeadingYaw(0);
    cameraRig.setFreeLookRange(false);
    cameraRig.setWalkBobState(true, 0.72);
    callbacks.onSetWeaponVisible(true);

    this.state = 'walking';
    callbacks.onObjectiveBanner(
      stageIndex === 0
        ? 'Explore Abandoned Village'
        : stageIndex === 1
        ? 'Follow the Tracks into Cursed Forest'
        : stageIndex === 2
        ? 'Explore Underground Facility'
        : 'Enter The Arena of the Dead'
    );
  }

  /**
   * Used when transitioning seamlessly from Stage 1->2 or 2->3 without snapping player coordinates.
   */
  public continueToStageRoute(nextStageIndex: number, callbacks: AutoMovementCallbacks): void {
    this.route = getStageRoute(nextStageIndex);
    this.triggeredStops.clear();
    this.activeStop = null;
    this.waypointIdx = 1;
    this.state = 'walking';
    callbacks.onObjectiveBanner(
      nextStageIndex === 1 ? 'Explore Cursed Forest' : 'Infiltrate Underground Facility'
    );
  }

  public notifyCombatPointCleared(callbacks: AutoMovementCallbacks): void {
    if (this.state !== 'combat_stop') return;
    this.activeStop = null;
    this.state = 'walking';
    callbacks.onObjectiveBanner('Area Clear · Advancing');
  }

  public dismissLore(cameraRig: CameraRig, callbacks: AutoMovementCallbacks): void {
    if (this.state !== 'lore_inspect') return;
    this.advanceLore(cameraRig, callbacks);
  }

  private advanceLore(cameraRig: CameraRig, callbacks: AutoMovementCallbacks): void {
    this.loreCursor++;
    if (this.loreCursor < this.loreQueue.length) {
      const doc = this.loreQueue[this.loreCursor];
      this.loreTimer = doc.durationSec;
      callbacks.onLoreOpened(doc, this.loreCursor + 1, this.loreQueue.length);
      return;
    }

    // Finished reading documents at this stop
    callbacks.onLoreClosed();
    cameraRig.setFreeLookRange(false);
    this.loreQueue = [];
    if (this.activeStop?.loreDocIds?.includes('lab_05')) {
      callbacks.onSetKingElevatorSequence?.(false, 'gone', 1, this.kingSequenceElapsed);
      callbacks.onSetAlphaKingSilhouette(false, 1);
    }
    this.activeStop = null;
    this.state = 'walking';
    callbacks.onObjectiveBanner('Resume Path');
  }

  public skipElevator(cameraRig: CameraRig, callbacks: AutoMovementCallbacks): void {
    if (!this.canSkipElevator()) return;
    this.emitElevatorEvent('ELEVATOR_STOPPING', callbacks);
    if (!this.arenaWorldSwapped) {
      this.arenaWorldSwapped = true;
      callbacks.onSwitchToArenaWorld();
    }
    callbacks.onElevatorState(false, 1, -140, false, 'ELEVATOR STOPPED');
    this.enterArenaExitSequence(cameraRig, callbacks);
  }

  public startArenaExitWalk(
    cameraRig: CameraRig,
    callbacks: AutoMovementCallbacks,
    exitObstacles: Array<{ x: number; z: number; radius: number }> = []
  ): void {
    this.state = 'arena_exit_walk';
    this.sequenceTimer = 0;
    this.flagA = false;
    this.flagB = false;
    this.flagC = false;
    this.exitGatePhase = 'approaching';
    this.exitGateTimer = 0;
    this.exitGateOpenProgress = 0;
    callbacks.onSetArenaExitGateState?.(0, 0, 0);
    callbacks.onSetArenaExitGate(0);
    callbacks.onExitGateStateEvent?.('approaching', 0);

    this.exitGateWaitPosition = this.findSafeExitGatePosition(exitObstacles);
    this.exitGateHeadingYaw = Math.atan2(this.exitGateWaitPosition.x, 9.5);
    this.exitApproachWaypoints = this.buildExitWaypoints(
      new THREE.Vector2(0, -6),
      this.exitGateWaitPosition,
      exitObstacles
    );
    this.exitApproachWaypointIndex = 0;
    this.exitPassWaypoints = this.buildExitWaypoints(
      this.exitGateWaitPosition,
      new THREE.Vector2(0, -43.5),
      exitObstacles
    );
    this.exitPassWaypointIndex = 0;

    this.playerPos.set(0, 1.68, -6);
    cameraRig.setBasePosition(0, 1.68, -6);
    cameraRig.setBaseHeadingYaw(0);
    cameraRig.setChaseSprintState(false, 0);
    cameraRig.setWalkBobState(true, 0.65);
    cameraRig.setFreeLookRange(true);
    callbacks.onSetWeaponVisible(false);
    callbacks.onObjectiveBanner('Walk to the Arena Exit Gate');
    callbacks.onStoryBanner('THE KING HAS FALLEN', 'Approach the Giant Arena Exit Gate', 'ending');
  }

  public reset(cameraRig?: CameraRig): void {
    this.state = 'idle';
    this.activeStop = null;
    this.loreQueue = [];
    this.exitApproachWaypoints = [];
    this.exitApproachWaypointIndex = 0;
    this.exitPassWaypoints = [];
    this.exitPassWaypointIndex = 0;
    this.elevatorShakeCooldownSec = 0;
    if (cameraRig) {
      cameraRig.setWalkBobState(false, 0);
      cameraRig.setChaseSprintState(false, 0);
      cameraRig.setFreeLookRange(false);
    }
  }

  public update(
    dtSec: number,
    cameraRig: CameraRig,
    callbacks: AutoMovementCallbacks
  ): void {
    if (this.state === 'idle') return;

    if (this.state === 'combat_stop') {
      cameraRig.setWalkBobState(false, 0);
      cameraRig.setBasePosition(this.playerPos.x, this.playerPos.y, this.playerPos.z);
      return;
    }

    if (this.state === 'lore_inspect') {
      cameraRig.setWalkBobState(false, 0);
      cameraRig.setBasePosition(this.playerPos.x, this.playerPos.y, this.playerPos.z);
      this.loreTimer -= dtSec;
      if (this.activeStop?.loreDocIds?.includes('lab_05')) {
        // Sequential Wing E King Freight Elevator Animation!
        this.kingSequenceElapsed += dtSec;
        const total = this.loreQueue[0]?.durationSec ?? 8.5;
        const p = clamp(1 - this.loreTimer / total, 0, 1);
        if (p < 0.36) {
          this.emitElevatorEvent('KING_APPROACHING', callbacks);
          callbacks.onSetKingElevatorSequence?.(true, 'approaching', p / 0.36, this.kingSequenceElapsed);
        } else if (p < 0.56) {
          this.emitElevatorEvent('KING_ENTERING', callbacks);
          callbacks.onSetKingElevatorSequence?.(true, 'entering', (p - 0.36) / 0.20, this.kingSequenceElapsed);
        } else if (p < 0.69) {
          this.emitElevatorEvent('KING_POSITIONED', callbacks);
          callbacks.onSetKingElevatorSequence?.(true, 'positioned', (p - 0.56) / 0.13, this.kingSequenceElapsed);
        } else if (p < 0.82) {
          callbacks.onSetKingElevatorSequence?.(true, 'closing', (p - 0.69) / 0.13, this.kingSequenceElapsed);
        } else {
          callbacks.onSetKingElevatorSequence?.(true, 'descending', (p - 0.82) / 0.18, this.kingSequenceElapsed);
        }
        if (!callbacks.onSetKingElevatorSequence) {
          callbacks.onSetAlphaKingSilhouette(true, p);
        }
      }
      if (this.loreTimer <= 0) {
        this.advanceLore(cameraRig, callbacks);
      }
      return;
    }

    if (this.state === 'walking') {
      this.updateWaypointWalk(dtSec, cameraRig, callbacks);
      return;
    }

    if (this.state === 'stage1_ending') {
      this.updateStage1Ending(dtSec, cameraRig, callbacks);
      return;
    }

    if (this.state === 'stage2_ending') {
      this.updateStage2Ending(dtSec, cameraRig, callbacks);
      return;
    }

    if (this.state === 'elevator_boarding') {
      this.updateElevatorBoarding(dtSec, cameraRig, callbacks);
      return;
    }

    if (this.state === 'elevator_descent') {
      this.updateElevatorDescent(dtSec, cameraRig, callbacks);
      return;
    }

    if (this.state === 'elevator_exit') {
      this.updateElevatorExit(dtSec, cameraRig, callbacks);
      return;
    }

    if (this.state === 'arena_exit_walk') {
      this.updateArenaExitWalk(dtSec, cameraRig, callbacks);
      return;
    }

    if (this.state === 'ending_card') {
      this.sequenceTimer += dtSec;
      if (this.sequenceTimer >= 3.4 && !this.flagC) {
        this.flagC = true;
        callbacks.onCampaignEndingComplete();
      }
    }
  }

  private updateWaypointWalk(
    dtSec: number,
    cameraRig: CameraRig,
    callbacks: AutoMovementCallbacks
  ): void {
    cameraRig.setWalkBobState(true, 0.72);
    const target = this.route.waypoints[this.waypointIdx];
    if (!target) {
      // Stage 1 / 2 seamless end boundary reached
      if (this.route.stageIndex === 0) {
        callbacks.onSeamlessStageAdvance(1);
        this.continueToStageRoute(1, callbacks);
      } else if (this.route.stageIndex === 1) {
        callbacks.onSeamlessStageAdvance(2);
        this.continueToStageRoute(2, callbacks);
      }
      return;
    }

    const dx = target.x - this.playerPos.x;
    const dz = target.z - this.playerPos.z;
    const dist = Math.hypot(dx, dz);
    const step = this.route.walkSpeed * dtSec;

    if (dist <= step) {
      this.playerPos.x = target.x;
      this.playerPos.z = target.z;
      this.waypointIdx++;
    } else if (dist > 0.001) {
      this.playerPos.x += (dx / dist) * step;
      this.playerPos.z += (dz / dist) * step;
      this.headingYaw = Math.atan2(-dx, -dz);
    }

    cameraRig.setBasePosition(this.playerPos.x, this.playerPos.y, this.playerPos.z);
    cameraRig.setBaseHeadingYaw(this.headingYaw);

    // At the start of Stage 2 (z = -90 .. -104), smoothly complete the Creature's slow retreat from behind the forest tree
    if (this.route.stageIndex === 1 && this.playerPos.z > -106) {
      const finishRetreatP = 1.78 + clamp((-90 - this.playerPos.z) / 14, 0, 0.22);
      callbacks.onUpdateStage1Creature(finishRetreatP < 1.99, 1, finishRetreatP);
    }

    this.footstepAccum -= dtSec;
    if (this.footstepAccum <= 0) {
      this.footstepAccum = 0.48;
      callbacks.onFootstep();
    }

    // Check stops along current route
    for (const stop of this.route.stops) {
      if (this.triggeredStops.has(stop.id)) continue;
      if (this.playerPos.z <= stop.z + 0.35) {
        this.triggeredStops.add(stop.id);
        this.playerPos.x = stop.x;
        this.playerPos.z = stop.z;
        cameraRig.setBasePosition(stop.x, this.playerPos.y, stop.z);
        cameraRig.setBaseHeadingYaw(0);
        this.triggerRouteStop(stop, cameraRig, callbacks);
        return;
      }
    }
  }

  private triggerRouteStop(
    stop: RouteStopPoint,
    cameraRig: CameraRig,
    callbacks: AutoMovementCallbacks
  ): void {
    this.activeStop = stop;
    cameraRig.setWalkBobState(false, 0);

    if (stop.objectiveText) {
      callbacks.onObjectiveBanner(stop.objectiveText);
    }

    if (stop.kind === 'combat_point') {
      if (this.route.stageIndex === 3) {
        // Reached Stage 4 Arena floor center -> start 5-shot Boss Intro Cinematic!
        this.state = 'combat_stop';
        callbacks.onEnterArenaBossIntro();
        return;
      }
      this.state = 'combat_stop';
      callbacks.onEnterCombatPoint(stop);
      return;
    }

    if (stop.kind === 'lore_inspect') {
      const docs = (stop.loreDocIds ?? [])
        .map((id) => LORE_DOCUMENTS[id])
        .filter((d): d is LoreDocument => Boolean(d));
      if (docs.length === 0) {
        this.state = 'walking';
        return;
      }
      this.loreQueue = docs;
      this.loreCursor = 0;
      this.loreTimer = docs[0].durationSec;
      this.state = 'lore_inspect';
      cameraRig.setFreeLookRange(true);
      if (stop.loreDocIds?.includes('lab_05')) {
        this.kingSequenceElapsed = 0;
        callbacks.onSetFacilityAlarmVisual(true);
        callbacks.onFacilityAlarm();
        this.emitElevatorEvent('KING_APPROACHING', callbacks);
        callbacks.onSetKingElevatorSequence?.(true, 'approaching', 0, 0);
        callbacks.onSetAlphaKingSilhouette(true, 0);
      }
      callbacks.onLoreOpened(docs[0], 1, docs.length);
      return;
    }

    if (stop.kind === 'stage1_ending') {
      this.state = 'stage1_ending';
      this.sequenceTimer = 0;
      this.flagA = false;
      this.flagB = false;
      this.flagC = false;
      callbacks.onSiren();
      callbacks.onStoryBanner('QUARANTINE BREACH SIREN', 'Something is beyond the Village Iron Gate...', 'warning');
      return;
    }

    if (stop.kind === 'stage2_ending') {
      this.state = 'stage2_ending';
      this.sequenceTimer = 0;
      this.flagA = false;
      this.flagB = false;
      callbacks.onCreatureRoar();
      cameraRig.triggerImpactShake('high');
      callbacks.onStoryBanner('SEISMIC ROAR DETECTED', 'Follow the giant footprints into the Bunker!', 'danger');
      return;
    }

    if (stop.kind === 'stage3_elevator') {
      this.state = 'elevator_boarding';
      this.sequenceTimer = 0;
      this.flagA = false;
      this.flagB = false;
      this.flagC = false;
      this.flagD = false;
      this.emitElevatorEvent('PLAYER_APPROACHING', callbacks);
      callbacks.onCameraStateChange?.('ELEVATOR_ENTRY');
      callbacks.onElevatorChime();
      callbacks.onElevatorDoorOpen?.();
      callbacks.onStoryBanner('INDUSTRIAL ELEVATOR', 'Waiting for blast doors to open...', 'objective');
    }
  }

  private updateStage1Ending(
    dtSec: number,
    cameraRig: CameraRig,
    callbacks: AutoMovementCallbacks
  ): void {
    this.sequenceTimer += dtSec;
    const t = this.sequenceTimer;

    if (t < 1.5) {
      // Siren + Iron Gate swings open
      if (!this.flagA) {
        this.flagA = true;
        callbacks.onGateOpen('village');
      }
      const gateP = clamp(t / 1.4, 0, 1);
      callbacks.onSetVillageGate(gateP);
      callbacks.onUpdateStage1Creature(true, 0, 0);
    } else if (t < 3.8) {
      // Creature turns beyond gate and darts behind the left forest tree
      callbacks.onSetVillageGate(1);
      const u = clamp((t - 1.5) / 2.3, 0, 1);
      callbacks.onUpdateStage1Creature(
        true,
        clamp(u * 1.4, 0, 1),
        clamp((u - 0.25) / 0.75, 0, 1)
      );
      if (!this.flagB && t >= 2.1) {
        this.flagB = true;
        callbacks.onStoryBanner('FOLLOW THE CREATURE', 'It darted behind the forest trees...', 'danger');
      }
    } else {
      // Player walks through the open iron gate while the Creature silently peeks from behind the left tree and slowly backs away
      cameraRig.setWalkBobState(true, 0.78);
      this.playerPos.z -= 5.1 * dtSec;
      cameraRig.setBasePosition(0, this.playerPos.y, this.playerPos.z);

      const peekWalkP = 1.0 + clamp((-62 - this.playerPos.z) / 36, 0, 0.78);
      callbacks.onUpdateStage1Creature(true, 1, peekWalkP);

      const glanceWeight = Math.sin(clamp((-64 - this.playerPos.z) / 24, 0, 1) * Math.PI);
      cameraRig.setBaseHeadingYaw(glanceWeight * 0.16);

      this.footstepAccum -= dtSec;
      if (this.footstepAccum <= 0) {
        this.footstepAccum = 0.44;
        callbacks.onFootstep();
      }

      if (this.playerPos.z <= -90) {
        this.state = 'walking';
        callbacks.onSeamlessStageAdvance(1);
        this.continueToStageRoute(1, callbacks);
      }
    }
  }

  private updateStage2Ending(
    dtSec: number,
    cameraRig: CameraRig,
    callbacks: AutoMovementCallbacks
  ): void {
    this.sequenceTimer += dtSec;
    const t = this.sequenceTimer;

    if (t < 1.6) {
      // Ground tremor during roar
      cameraRig.setWalkBobState(false, 0);
    } else if (t < 3.4) {
      if (!this.flagA) {
        this.flagA = true;
        callbacks.onGateOpen('bunker');
      }
      const p = clamp((t - 1.6) / 1.7, 0, 1);
      callbacks.onSetBunkerDoor(p);
    } else {
      callbacks.onSetBunkerDoor(1);
      cameraRig.setWalkBobState(true, 0.78);
      this.playerPos.z -= 5.2 * dtSec;
      cameraRig.setBasePosition(0, this.playerPos.y, this.playerPos.z);

      this.footstepAccum -= dtSec;
      if (this.footstepAccum <= 0) {
        this.footstepAccum = 0.44;
        callbacks.onFootstep();
      }

      if (this.playerPos.z <= -236) {
        this.state = 'walking';
        callbacks.onSeamlessStageAdvance(2);
        this.continueToStageRoute(2, callbacks);
      }
    }
  }

  private updateElevatorBoarding(
    dtSec: number,
    cameraRig: CameraRig,
    callbacks: AutoMovementCallbacks
  ): void {
    this.sequenceTimer += dtSec;
    const t = this.sequenceTimer;

    if (t < 1.25) {
      // The player walks to the closed lift doors and comes to a full stop.
      const walkT = clamp(t / 1.25, 0, 1);
      const walkU = walkT * walkT * (3 - 2 * walkT);
      callbacks.onSetCorridorElevator(0, false, 0, 0);
      cameraRig.setWalkBobState(walkT < 1, walkT < 1 ? 0.55 : 0);
      this.playerPos.z = lerp(-376.2, -378.8, walkU);
      cameraRig.setBasePosition(0, this.playerPos.y, this.playerPos.z);
      if (walkT < 1) {
        this.footstepAccum -= dtSec;
        if (this.footstepAccum <= 0) {
          this.footstepAccum = 0.45;
          callbacks.onFootstep();
        }
      }
    } else if (t < 2.15) {
      // The player waits outside while the mechanical doors open.
      const doorT = clamp((t - 1.25) / 0.9, 0, 1);
      callbacks.onSetCorridorElevator(doorT * doorT * (3 - 2 * doorT), false, 0, 0);
      this.playerPos.z = -378.8;
      cameraRig.setBasePosition(0, this.playerPos.y, this.playerPos.z);
      cameraRig.setWalkBobState(false, 0);
    } else if (t < 3.55) {
      // Doors are fully open as the player crosses the threshold into the cabin.
      if (!this.flagA) {
        this.flagA = true;
        this.emitElevatorEvent('PLAYER_ENTERING', callbacks);
        callbacks.onStoryBanner('BOARDING ELEVATOR', 'Stepping into descent cage...', 'objective');
      }
      const enterT = clamp((t - 2.15) / 1.4, 0, 1);
      const enterU = enterT * enterT * (3 - 2 * enterT);
      callbacks.onSetCorridorElevator(1, false, 0, 0);
      cameraRig.setWalkBobState(enterT < 1, enterT < 1 ? 0.65 : 0);
      this.playerPos.z = lerp(-378.8, -384.4, enterU);
      cameraRig.setBasePosition(0, this.playerPos.y, this.playerPos.z);
      if (enterT < 1) {
        this.footstepAccum -= dtSec;
        if (this.footstepAccum <= 0) {
          this.footstepAccum = 0.44;
          callbacks.onFootstep();
        }
      }
    } else if (t < 4.05) {
      // Shot 3: Player stops centered in elevator interior
      if (!this.flagB) {
        this.flagB = true;
        this.emitElevatorEvent('PLAYER_POSITIONED', callbacks);
      }
      this.playerPos.z = -384.4;
      cameraRig.setBasePosition(0, this.playerPos.y, this.playerPos.z);
      cameraRig.setWalkBobState(false, 0);
      callbacks.onSetCorridorElevator(1, false, 0, 0);
    } else if (t < 5.05) {
      // Shot 4: Doors close smoothly AFTER player is positioned inside
      if (!this.flagC) {
        this.flagC = true;
        this.emitElevatorEvent('ELEVATOR_CLOSING', callbacks);
        callbacks.onElevatorDoorClose?.();
        cameraRig.setFreeLookRange(true);
        callbacks.onSetWeaponVisible(false);
      }
      const closeT = clamp((t - 4.05) / 1.0, 0, 1);
      const closeEase = closeT * closeT * (3 - 2 * closeT);
      const closeP = 1 - closeEase;
      callbacks.onSetCorridorElevator(closeP, false, 0, 0);
      if (closeP <= 0.02 && !this.flagD) {
        this.flagD = true;
        cameraRig.triggerImpactShake('low');
      }
    } else {
      // Shot 5: Descent begins smoothly
      this.state = 'elevator_descent';
      this.sequenceTimer = 0;
      this.elevatorShakeCooldownSec = 0;
      this.flagA = false;
      this.flagB = false;
      this.flagC = false;
      this.flagD = false;
      this.emitElevatorEvent('ELEVATOR_DESCENDING', callbacks);
      callbacks.onCameraStateChange?.('ELEVATOR_DESCENT');
      callbacks.onElevatorHum();
      callbacks.onElevatorState(true, 0, 0, false, 'DESCENDING');
    }
  }

  private updateElevatorDescent(
    dtSec: number,
    cameraRig: CameraRig,
    callbacks: AutoMovementCallbacks
  ): void {
    this.sequenceTimer += dtSec;
    const dur = DEFAULT_GAME_CONFIG.elevatorDurationSec;
    const progress = clamp(this.sequenceTimer / dur, 0, 1);
    const depthMeters = Math.round(-progress * 140);

    // Keep the camera and cabin in sync while adding an occasional mechanical jolt.
    const rattle = Math.sin(this.sequenceTimer * 18) * 0.008;
    const impactEnvelope = Math.pow(
      Math.max(0, Math.sin(this.sequenceTimer * 2.7 + 0.3)),
      20
    );
    const impactShake = impactEnvelope * Math.sin(this.sequenceTimer * 47) * 0.035;
    this.elevatorShakeCooldownSec = Math.max(0, this.elevatorShakeCooldownSec - dtSec);
    if (impactEnvelope > 0.7 && this.elevatorShakeCooldownSec === 0) {
      cameraRig.triggerDamageShake(0.035);
      this.elevatorShakeCooldownSec = 0.85;
    } else if (progress < 0.88 && Math.random() < dtSec * 1.0) {
      cameraRig.triggerDamageShake(0.01);
    }

    if (progress < 0.45) {
      const spd = clamp(progress / 0.25, 0.25, 1.0);
      const travel = clamp(progress / 0.45, 0, 1);
      const easedTravel = travel * travel * (3 - 2 * travel);
      const cageDrop = -easedTravel * 4.275 + rattle + impactShake;
      callbacks.onSetCorridorElevator(0, true, spd, cageDrop);
      cameraRig.setBasePosition(0, 1.68 + cageDrop, -384.4);
    } else if (!this.arenaWorldSwapped) {
      // Mid-descent with doors closed: cleanly swap Stage 1-3 corridor for Stage 4 Arena!
      this.arenaWorldSwapped = true;
      callbacks.onSwitchToArenaWorld();
      this.playerPos.set(0, 1.68, 4.5);
      cameraRig.setBasePosition(0, 1.68, 4.5);
      cameraRig.setBaseHeadingYaw(0);
    }

    if (!this.flagA && progress >= 0.7) {
      this.flagA = true;
      callbacks.onStoryBanner('DANGER BELOW', 'Distant horde roar echoes from the Colosseum...', 'danger');
    }

    let phaseLabel = 'DESCENDING';
    if (progress >= 0.86) {
      phaseLabel = 'BRAKING AT SUB-LEVEL 04';
      if (!this.flagB) {
        this.flagB = true;
        this.emitElevatorEvent('ELEVATOR_STOPPING', callbacks);
        callbacks.onElevatorBrake?.();
        cameraRig.triggerImpactShake('medium');
      }
    }

    callbacks.onElevatorState(true, progress, depthMeters, this.canSkipElevator(), phaseLabel);

    if (progress >= 1.0) {
      callbacks.onElevatorState(false, 1, -140, false, 'ARRIVED');
      this.enterArenaExitSequence(cameraRig, callbacks);
    }
  }

  private enterArenaExitSequence(cameraRig: CameraRig, callbacks: AutoMovementCallbacks): void {
    this.state = 'elevator_exit';
    this.sequenceTimer = 0;
    this.flagA = false;
    this.flagB = false;
    this.flagC = false;
    this.playerPos.set(0, 1.68, 4.5);
    cameraRig.setBasePosition(0, 1.68, 4.5);
    cameraRig.setBaseHeadingYaw(0);
    cameraRig.setFreeLookRange(false);
    callbacks.onSetWeaponVisible(true);
    this.emitElevatorEvent('ELEVATOR_ARRIVING', callbacks);
    callbacks.onCameraStateChange?.('ELEVATOR_REVEAL');
    callbacks.onElevatorChime();
    callbacks.onObjectiveBanner('Arrived at Sub-Level Arena');
  }

  private updateElevatorExit(
    dtSec: number,
    cameraRig: CameraRig,
    callbacks: AutoMovementCallbacks
  ): void {
    this.sequenceTimer += dtSec;
    const t = this.sequenceTimer;

    if (t < 0.45) {
      // Shot 6: Brief arrival settle before doors start sliding open
      callbacks.onSetArenaElevatorGate(0);
      cameraRig.setWalkBobState(false, 0);
      return;
    }

    if (!this.flagA) {
      this.flagA = true;
      this.emitElevatorEvent('ELEVATOR_OPENING', callbacks);
      callbacks.onElevatorDoorOpen?.();
      callbacks.onGateOpen('arena_elevator');
    }

    const gateP = clamp((t - 0.45) / 1.15, 0, 1);
    callbacks.onSetArenaElevatorGate(gateP);

    if (t >= 1.35) {
      if (!this.flagB) {
        this.flagB = true;
        this.emitElevatorEvent('SCENE_REVEAL', callbacks);
        callbacks.onObjectiveBanner('Enter The Arena of the Dead');
      }
      cameraRig.setWalkBobState(true, 0.72);
      this.playerPos.z = Math.max(-2.0, this.playerPos.z - 3.8 * dtSec);
      cameraRig.setBasePosition(0, this.playerPos.y, this.playerPos.z);
      this.footstepAccum -= dtSec;
      if (this.footstepAccum <= 0) {
        this.footstepAccum = 0.46;
        callbacks.onFootstep();
      }
    }

    if (this.playerPos.z <= -2.0) {
      cameraRig.setWalkBobState(false, 0);
      callbacks.onCameraStateChange?.('NORMAL_FPS');
      this.state = 'combat_stop';
      callbacks.onEnterArenaBossIntro();
    }
  }

  private updateArenaExitWalk(
    dtSec: number,
    cameraRig: CameraRig,
    callbacks: AutoMovementCallbacks
  ): void {
    this.sequenceTimer += dtSec;

    if (this.exitGatePhase === 'approaching') {
      const move = this.advanceExitWaypoints(
        dtSec,
        cameraRig,
        this.exitApproachWaypoints,
        this.exitApproachWaypointIndex,
        3.6
      );
      this.exitApproachWaypointIndex = move.nextIndex;
      if (!move.done) {
        cameraRig.setWalkBobState(true, 0.62);
        if (move.moved) {
          this.footstepAccum -= dtSec;
          if (this.footstepAccum <= 0) {
            this.footstepAccum = 0.52;
            callbacks.onFootstep();
          }
        }
        callbacks.onExitGateStateEvent?.('approaching', clamp((-6 - this.playerPos.z) / 25.5, 0, 1));
      } else {
        this.playerPos.set(this.exitGateWaitPosition.x, 1.68, this.exitGateWaitPosition.y);
        cameraRig.setBasePosition(this.exitGateWaitPosition.x, 1.68, this.exitGateWaitPosition.y);
        cameraRig.setBaseHeadingYaw(this.exitGateHeadingYaw);
        cameraRig.setWalkBobState(false, 0);
        cameraRig.setFreeLookRange(false);
        this.exitGatePhase = 'focus_wait';
        this.exitGateTimer = 0;
        callbacks.onObjectiveBanner('Wait for Exit Gate');
      }
      return;
    }

    // Player remains stationary at z = -31.5 until exitGateOpenProgress >= 0.99
    cameraRig.setWalkBobState(false, 0);
    cameraRig.setBasePosition(this.exitGateWaitPosition.x, 1.68, this.exitGateWaitPosition.y);
    cameraRig.setBaseHeadingYaw(this.exitGateHeadingYaw);

    if (this.exitGatePhase === 'focus_wait') {
      this.exitGateTimer += dtSec;
      cameraRig.setAimParallax(0, clamp(this.exitGateTimer / STORY_CINEMATIC_CONFIG.endingGateHoldSec, 0, 1) * 0.45);
      if (this.exitGateTimer >= STORY_CINEMATIC_CONFIG.endingGateHoldSec) {
        this.exitGatePhase = 'unlocking';
        this.exitGateTimer = 0;
        this.flagA = false;
      }
      return;
    }

    if (this.exitGatePhase === 'unlocking') {
      this.exitGateTimer += dtSec;
      if (!this.flagA) {
        this.flagA = true;
        callbacks.onGateOpen('arena_exit');
        cameraRig.triggerImpactShake('low');
        callbacks.onStoryBanner('EXIT LOCK DISENGAGED', 'Opening the Arena Exit Gate...', 'ending');
      }
      const lockU = clamp(this.exitGateTimer / STORY_CINEMATIC_CONFIG.endingGateUnlockSec, 0, 1);
      callbacks.onSetArenaExitGateState?.(lockU, 0, lockU * 0.45);
      callbacks.onExitGateStateEvent?.('unlocking', lockU);
      cameraRig.setAimParallax(0, 0.45);
      if (lockU >= 1) {
        this.exitGatePhase = 'opening';
        this.exitGateTimer = 0;
      }
      return;
    }

    if (this.exitGatePhase === 'opening') {
      this.exitGateTimer += dtSec;
      const rawU = clamp(this.exitGateTimer / STORY_CINEMATIC_CONFIG.endingGateOpenSec, 0, 1);
      const openU = rawU * rawU * (3 - 2 * rawU);
      const dustU = Math.sin(rawU * Math.PI);
      this.exitGateOpenProgress = openU;
      callbacks.onSetArenaExitGateState?.(1, openU, dustU);
      callbacks.onSetArenaExitGate(openU);
      callbacks.onExitGateStateEvent?.('opening', openU);
      if (rawU < 0.9 && Math.random() < dtSec * 3.0) {
        cameraRig.triggerDamageShake(0.016);
      }
      cameraRig.setAimParallax(0, lerp(0.45, 0.15, openU));

      if (openU >= 0.99) {
        this.exitGateOpenProgress = 1;
        callbacks.onSetArenaExitGateState?.(1, 1, 0);
        callbacks.onSetArenaExitGate(1);
        this.exitGatePhase = 'passing';
        this.exitGateTimer = 0;
        cameraRig.setFreeLookRange(true);
        callbacks.onObjectiveBanner('Walk Into Freedom');
      }
      return;
    }

    // passing: Only active after exitGateOpenProgress >= 0.99
    if (this.exitPassWaypointIndex < this.exitPassWaypoints.length) {
      const move = this.advanceExitWaypoints(
        dtSec,
        cameraRig,
        this.exitPassWaypoints,
        this.exitPassWaypointIndex,
        3.3
      );
      this.exitPassWaypointIndex = move.nextIndex;
      cameraRig.setWalkBobState(true, 0.65);
      if (move.moved) {
        this.footstepAccum -= dtSec;
        if (this.footstepAccum <= 0) {
          this.footstepAccum = 0.5;
          callbacks.onFootstep();
        }
      }
      callbacks.onExitGateStateEvent?.('passing', clamp((-31.5 - this.playerPos.z) / 10.5, 0, 1));
    }

    if (this.playerPos.z <= -41.2 && !this.flagB) {
      this.flagB = true;
      this.sequenceTimer = 0;
      cameraRig.setWalkBobState(false, 0);
      if (callbacks.onEnterGrandOutro) {
        this.state = 'idle';
        callbacks.onEnterGrandOutro();
      } else {
        this.state = 'ending_card';
        callbacks.onEndingOverlay(
          true,
          'THE KING HAS FALLEN',
          'THE OUTBREAK IS NOT FORGOTTEN',
          1
        );
      }
    }
  }

  private findSafeExitGatePosition(
    obstacles: Array<{ x: number; z: number; radius: number }>
  ): THREE.Vector2 {
    const candidates = [0, -3.2, 3.2, -4.1, 4.1];
    let bestX = 0;
    let bestClearance = Number.NEGATIVE_INFINITY;
    for (const x of candidates) {
      const clearance = obstacles.reduce(
        (min, obstacle) =>
          Math.min(
            min,
            Math.hypot(x - obstacle.x, -31.5 - obstacle.z) - obstacle.radius - 0.65
          ),
        Number.POSITIVE_INFINITY
      );
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestX = x;
      }
    }
    return new THREE.Vector2(bestX, -31.5);
  }

  private buildExitWaypoints(
    start: THREE.Vector2,
    end: THREE.Vector2,
    obstacles: Array<{ x: number; z: number; radius: number }>
  ): THREE.Vector2[] {
    const zSpan = start.y - end.y;
    if (zSpan <= 0) return [end.clone()];

    const relevant = obstacles
      .filter((obstacle) => {
        if (
          !Number.isFinite(obstacle.x) ||
          !Number.isFinite(obstacle.z) ||
          !Number.isFinite(obstacle.radius) ||
          obstacle.radius <= 0 ||
          obstacle.z >= start.y ||
          obstacle.z <= end.y
        ) {
          return false;
        }
        const t = (start.y - obstacle.z) / zSpan;
        const expectedX = start.x + (end.x - start.x) * t;
        return Math.abs(obstacle.x - expectedX) < obstacle.radius + 0.65;
      })
      .sort((a, b) => b.z - a.z);

    const waypoints: THREE.Vector2[] = [];
    let currentX = start.x;
    let currentZ = start.y;
    for (const obstacle of relevant) {
      const clearance = obstacle.radius + 0.9;
      const entryZ = Math.min(currentZ, obstacle.z + clearance);
      const exitZ = Math.max(end.y, obstacle.z - clearance);
      if (entryZ <= exitZ) continue;

      const sideX = this.chooseExitDetourSide(obstacle, entryZ, exitZ, currentX, obstacles);
      waypoints.push(new THREE.Vector2(sideX, entryZ), new THREE.Vector2(sideX, exitZ));
      currentX = sideX;
      currentZ = exitZ;
    }
    waypoints.push(end.clone());
    return waypoints;
  }

  private chooseExitDetourSide(
    obstacle: { x: number; z: number; radius: number },
    entryZ: number,
    exitZ: number,
    currentX: number,
    obstacles: Array<{ x: number; z: number; radius: number }>
  ): number {
    const clearance = obstacle.radius + 0.9;
    const candidates = [
      clamp(obstacle.x - clearance, -10, 10),
      clamp(obstacle.x + clearance, -10, 10),
    ];
    let bestX = candidates[0];
    let bestPenalty = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      let penalty = Math.abs(candidate - currentX) * 0.05;
      for (const other of obstacles) {
        if (other === obstacle || other.z > entryZ || other.z < exitZ) continue;
        penalty += Math.max(0, other.radius + 0.65 - Math.abs(candidate - other.x));
      }
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestX = candidate;
      }
    }
    return bestX;
  }

  private advanceExitWaypoints(
    dtSec: number,
    cameraRig: CameraRig,
    waypoints: THREE.Vector2[],
    startIndex: number,
    speed: number
  ): { nextIndex: number; done: boolean; moved: boolean } {
    let nextIndex = startIndex;
    if (nextIndex >= waypoints.length) return { nextIndex, done: true, moved: false };

    const target = waypoints[nextIndex];
    const dx = target.x - this.playerPos.x;
    const dz = target.y - this.playerPos.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= speed * dtSec) {
      this.playerPos.x = target.x;
      this.playerPos.z = target.y;
      nextIndex++;
    } else if (distance > 0.001) {
      const step = (speed * dtSec) / distance;
      this.playerPos.x += dx * step;
      this.playerPos.z += dz * step;
    }

    this.headingYaw = Math.atan2(-dx, -dz);
    cameraRig.setBasePosition(this.playerPos.x, this.playerPos.y, this.playerPos.z);
    cameraRig.setBaseHeadingYaw(this.headingYaw);
    return {
      nextIndex,
      done: nextIndex >= waypoints.length,
      moved: distance > 0.001,
    };
  }
}
