import * as THREE from 'three';
import type { BossChaseState, EventBus } from '../../core/EventBus';
import { BOSS_PHASE2_CONFIG, BOSS_PHASE2_TRANSITION_CONFIG } from '../../data/zombies';
import { clamp, lerp } from '../../utils/math';
import type { CameraRig } from '../CameraRig';
import type { Zombie } from '../entities/Zombie';

export type ChaseSequencePhase = 'none' | 'pursuit' | 'vulnerability';

export interface BossChaseCallbacks {
  onPhase2Roar?: () => void;
  onCrowdHysterical?: () => void;
  onJumpPrep?: () => void;
  onJumpLaunch?: () => void;
  onJumpLand?: () => void;
  onBossStep?: () => void;
  onChaseStart?: () => void;
  onChaseCompleted?: () => void;
}

export interface ChaseUpdateResult {
  active: boolean;
  state: BossChaseState;
  phase: ChaseSequencePhase;
  playerPos: THREE.Vector3;
  footstepTriggered: boolean;
  thirdPersonCamera: boolean;
  waypointIndex: number;
  totalWaypoints: number;
}

interface SurvivorRunnerRig {
  root: THREE.Group;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

export interface Waypoint2D {
  readonly x: number;
  readonly z: number;
}

/**
 * Finite bounded arena pursuit path for Stage 4 Phase 2.
 * Starts right at the player's approach stance, curves once around the western/northern
 * arena rim, and terminates deterministically at the southern combat stance (0, -8.2).
 */
export const STAGE4_CHASE_WAYPOINTS: ReadonlyArray<Waypoint2D> = [
  { x: 0.0, z: -4.5 },
  { x: -6.8, z: -8.8 },
  { x: -9.4, z: -17.6 },
  { x: -4.2, z: -26.8 },
  { x: 6.2, z: -23.4 },
  { x: 0.0, z: -8.2 },
] as const;

/**
 * Coordinates the finite Stage 4 Phase 2 approach, jump & pursuit sequence:
 *  IDLE -> PHASE_2_APPROACH -> PHASE_2_INTIMIDATION -> PHASE_2_JUMP_PREPARATION
 *       -> PHASE_2_FIRST_JUMP -> PHASE_2_LANDING -> CHASE_START -> CHASE_ACTIVE
 *       -> CHASE_COMPLETION (emits chase:completed once) -> RETURN_TO_COMBAT
 *       -> PHASE_2_COMBAT_ACTIVE (releases control completely back to normal FPS combat!)
 */
export class BossChaseController {
  private active = false;
  private state: BossChaseState = 'IDLE';
  private phase: ChaseSequencePhase = 'none';
  private stateTimer = 0;

  private currentWaypointIndex = 0;
  private lateralOffset = 0;
  private footstepAccum = 0;

  private firstJumpTriggered = false;
  private jumpLandEmitted = false;
  private intimidationFired = false;
  private chaseCompletedEmitted = false;
  private chaseElapsedSec = 0;
  private thirdPersonCameraActive = false;

  private readonly playerPos = new THREE.Vector3(0, 1.68, -4.5);
  private readonly aheadTarget = new THREE.Vector3();
  private readonly _camPos = new THREE.Vector3();
  private readonly _lookAt = new THREE.Vector3();
  private readonly _survPos = new THREE.Vector3(0, 0, -4.5);
  private readonly _bossTarget = new THREE.Vector3();

  private survivor: SurvivorRunnerRig | null = null;
  private attachedScene: THREE.Scene | null = null;
  private callbacks: BossChaseCallbacks = {};

  constructor(private readonly events: EventBus) {}

  public isActive(): boolean {
    return this.active;
  }

  public isChaseOverriding(): boolean {
    return (
      this.active &&
      this.state !== 'IDLE' &&
      this.state !== 'PHASE_2_COMBAT_ACTIVE'
    );
  }

  public controlsPlayer(): boolean {
    return (
      this.active &&
      (this.state === 'CHASE_START' ||
        this.state === 'CHASE_ACTIVE' ||
        this.state === 'CHASE_COMPLETION' ||
        this.state === 'RETURN_TO_COMBAT')
    );
  }

  public getState(): BossChaseState {
    return this.state;
  }

  public getPhase(): ChaseSequencePhase {
    return this.phase;
  }

  public getWaypointProgress(): { currentIndex: number; total: number } {
    return {
      currentIndex: this.currentWaypointIndex,
      total: STAGE4_CHASE_WAYPOINTS.length,
    };
  }

  public hasCompletedChase(): boolean {
    return this.chaseCompletedEmitted;
  }

  public controlsBossPose(): boolean {
    return (
      this.active &&
      this.state !== 'IDLE' &&
      this.state !== 'PHASE_2_COMBAT_ACTIVE'
    );
  }

  public isInCombatFpsWindow(): boolean {
    if (!this.active) return this.state === 'PHASE_2_COMBAT_ACTIVE';
    return (
      this.state === 'PHASE_2_APPROACH' ||
      this.state === 'PHASE_2_INTIMIDATION' ||
      (this.state === 'CHASE_ACTIVE' && !this.thirdPersonCameraActive)
    );
  }

  public isThirdPersonChaseCamera(): boolean {
    if (!this.active) return false;
    return (
      this.state === 'PHASE_2_JUMP_PREPARATION' ||
      this.state === 'PHASE_2_FIRST_JUMP' ||
      this.state === 'PHASE_2_LANDING' ||
      ((this.state === 'CHASE_START' || this.state === 'CHASE_ACTIVE') &&
        this.thirdPersonCameraActive)
    );
  }

  public hasVisibleRunner(): boolean {
    return Boolean(this.survivor && this.survivor.root.visible);
  }

  public nudgeLateral(delta: number): void {
    this.lateralOffset = clamp(this.lateralOffset + delta, -2.0, 2.0);
  }

  public start(
    cameraRig: CameraRig,
    boss?: Zombie | null,
    scene?: THREE.Scene,
    callbacks?: BossChaseCallbacks
  ): void {
    this.active = true;
    this.state = 'PHASE_2_APPROACH';
    this.phase = 'pursuit';
    this.stateTimer = 0;
    this.chaseElapsedSec = 0;
    this.currentWaypointIndex = 0;
    this.lateralOffset = 0;
    this.footstepAccum = 0.2;
    this.firstJumpTriggered = false;
    this.jumpLandEmitted = false;
    this.intimidationFired = false;
    this.chaseCompletedEmitted = false;
    this.thirdPersonCameraActive = false;
    this.callbacks = callbacks ?? {};

    if (scene) {
      this.attachedScene = scene;
      this.ensureSurvivorRig(scene);
      if (this.survivor) this.survivor.root.visible = false;
    }

    // Player starts interactive at south arena floor facing North toward King
    this.playerPos.set(0, 1.68, -4.5);
    this._survPos.set(0, 0, -4.5);
    cameraRig.setCinematicPose(false);
    cameraRig.setWalkBobState(false, 0);
    cameraRig.setChaseSprintState(false, 0);
    cameraRig.setFreeLookRange(false);
    cameraRig.setBasePosition(0, 1.68, -4.5);
    cameraRig.setBaseHeadingYaw(0);
    cameraRig.setTargetFov(58);
    cameraRig.setCameraState('BOSS_APPROACH', this.events);

    if (boss) {
      boss.bossAllowAutoJump = false;
      boss.cinematicControlled = false;
      if (boss.root.position.z > -15.5) {
        boss.root.position.set(0, 0, -21.5);
      }
      boss.root.position.y = 0;
      boss.root.rotation.y = Math.atan2(
        this.playerPos.x - boss.root.position.x,
        this.playerPos.z - boss.root.position.z
      );
    }

    this.events.emit('boss:approach_state', {
      phase: 'approach',
      label: 'THE KING APPROACHES — AIM & FIRE!',
    });
    this.events.emit('chase:state_changed', {
      active: true,
      phase: 'pursuit',
      state: this.state,
      label: 'THE KING APPROACHES — STAND YOUR GROUND!',
    });
  }

  public skipToChaseCombat(cameraRig: CameraRig, boss?: Zombie | null): void {
    if (!this.active && this.state === 'PHASE_2_COMBAT_ACTIVE') return;
    this.completeChaseAndReturnToCombat(cameraRig, boss ?? null);
  }

  public reset(cameraRig?: CameraRig): void {
    const wasActive = this.active || this.state !== 'IDLE';
    this.active = false;
    this.state = 'IDLE';
    this.phase = 'none';
    this.stateTimer = 0;
    this.chaseElapsedSec = 0;
    this.currentWaypointIndex = 0;
    this.lateralOffset = 0;
    this.firstJumpTriggered = false;
    this.jumpLandEmitted = false;
    this.intimidationFired = false;
    this.chaseCompletedEmitted = false;
    this.thirdPersonCameraActive = false;

    this.disposeSurvivorRig();

    if (cameraRig) {
      cameraRig.setCinematicPose(false);
      cameraRig.setTargetFov(null);
      cameraRig.setChaseSprintState(false, 0);
      cameraRig.setWalkBobState(false, 0);
      cameraRig.setFreeLookRange(false);
      cameraRig.setBasePosition(0, 1.68, 0);
      cameraRig.setBaseHeadingYaw(0);
      cameraRig.setCameraState('NORMAL_FPS', this.events);
    }
    if (wasActive) {
      this.events.emit('boss:approach_state', { phase: 'done', label: '' });
      this.events.emit('chase:state_changed', {
        active: false,
        phase: 'none',
        state: 'IDLE',
        label: '',
      });
    }
  }

  public getBossJumpInterceptPoint(boss?: Zombie | null): THREE.Vector3 {
    const px = this.playerPos.x;
    const pz = this.playerPos.z;
    if (boss) {
      const dx = px - boss.root.position.x;
      const dz = pz - boss.root.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      const travel = Math.max(2.0, Math.min(14.0, dist - 5.2));
      return this.aheadTarget.set(
        clamp(boss.root.position.x + (dx / dist) * travel, -12.5, 12.5),
        0,
        clamp(boss.root.position.z + (dz / dist) * travel, -33.0, -5.5)
      );
    }
    return this.aheadTarget.set(clamp(px * 0.7, -10, 10), 0, clamp(pz - 5.2, -32, -6));
  }

  public update(
    dtSec: number,
    cameraRig: CameraRig,
    boss: Zombie | null,
    aimX: number
  ): ChaseUpdateResult {
    if (!this.active || !boss || boss.state === 'dead' || boss.cinematicControlled) {
      if (this.survivor) this.survivor.root.visible = false;
      return {
        active: false,
        state: this.state,
        phase: 'none',
        playerPos: cameraRig.getPlayerFeetPosition(),
        footstepTriggered: false,
        thirdPersonCamera: false,
        waypointIndex: this.currentWaypointIndex,
        totalWaypoints: STAGE4_CHASE_WAYPOINTS.length,
      };
    }

    this.stateTimer += dtSec;
    let footstepTriggered = false;
    const cfg = BOSS_PHASE2_TRANSITION_CONFIG;

    // ------------------------------------------------------------------
    // 1. PHASE_2_APPROACH (Fast 1.75s aggressive stalk from -21.5 -> -10.3)
    // ------------------------------------------------------------------
    if (this.state === 'PHASE_2_APPROACH') {
      cameraRig.setBasePosition(this.playerPos.x, this.playerPos.y, this.playerPos.z);
      cameraRig.setBaseHeadingYaw(0);
      cameraRig.setTargetFov(lerp(58, 53.5, clamp(this.stateTimer / cfg.approachDurationSec, 0, 1)));

      const stepRes = boss.setBossApproachLocomotion(dtSec, cfg.approachSpeed, 0, -10.3);
      if (stepRes.footstepTriggered) {
        this.callbacks.onBossStep?.();
        cameraRig.triggerImpactShake('low');
      }

      if (stepRes.distanceRemaining <= 0.25 || this.stateTimer >= cfg.approachDurationSec) {
        this.state = 'PHASE_2_INTIMIDATION';
        this.stateTimer = 0;
        boss.root.position.set(0, 0, -10.3);
      }

      return this.buildResult(cameraRig.getPlayerFeetPosition(), false, false);
    }

    // ------------------------------------------------------------------
    // 2. PHASE_2_INTIMIDATION (0.65s stop & snappy roar telegraph)
    // ------------------------------------------------------------------
    if (this.state === 'PHASE_2_INTIMIDATION') {
      cameraRig.setBasePosition(this.playerPos.x, this.playerPos.y, this.playerPos.z);
      cameraRig.setBaseHeadingYaw(0);
      boss.root.rotation.y = Math.atan2(
        this.playerPos.x - boss.root.position.x,
        this.playerPos.z - boss.root.position.z
      );
      boss.setBossConfrontationStance(clamp(this.stateTimer / (cfg.intimidationDurationSec * 0.8), 0, 1));

      if (!this.intimidationFired) {
        this.intimidationFired = true;
        this.callbacks.onPhase2Roar?.();
        this.callbacks.onCrowdHysterical?.();
        cameraRig.triggerImpactShake('medium');
        this.events.emit('boss:approach_state', {
          phase: 'confrontation',
          label: 'THE KING ROARS — BRACE FOR IMPACT!',
        });
      }

      if (this.stateTimer >= cfg.intimidationDurationSec) {
        this.state = 'PHASE_2_JUMP_PREPARATION';
        this.stateTimer = 0;
        this.firstJumpTriggered = false;
        this.jumpLandEmitted = false;
        this.thirdPersonCameraActive = true;
        cameraRig.setTargetFov(null);
        cameraRig.setCameraState('BOSS_JUMP_CINEMATIC', this.events);
        this.events.emit('boss:approach_state', {
          phase: 'jump_prep',
          label: 'TITAN LEAP INCOMING!',
        });
      }

      return this.buildResult(cameraRig.getPlayerFeetPosition(), false, false);
    }

    // ------------------------------------------------------------------
    // 3. PHASE_2_JUMP_PREPARATION -> PHASE_2_FIRST_JUMP -> PHASE_2_LANDING
    // ------------------------------------------------------------------
    if (
      this.state === 'PHASE_2_JUMP_PREPARATION' ||
      this.state === 'PHASE_2_FIRST_JUMP' ||
      this.state === 'PHASE_2_LANDING'
    ) {
      if (!this.firstJumpTriggered) {
        this.firstJumpTriggered = true;
        boss.triggerBossJump(
          new THREE.Vector3(0.35, 0, -8.8),
          {
            onBossJumpPrep: () => this.callbacks.onJumpPrep?.(),
          },
          {
            anticipationSec: cfg.jumpPrepDurationSec,
            flightSec: cfg.firstJumpDurationSec,
            landingSec: cfg.landingRecoveryDurationSec,
          }
        );
      }

      if (this.state === 'PHASE_2_JUMP_PREPARATION' && boss.bossJumpPhase === 'airborne') {
        this.state = 'PHASE_2_FIRST_JUMP';
        this.stateTimer = 0;
        this.callbacks.onJumpLaunch?.();
        this.events.emit('boss:approach_state', {
          phase: 'first_jump',
          label: 'THE KING TAKES FLIGHT!',
        });
      }

      if (this.state === 'PHASE_2_FIRST_JUMP' && boss.bossJumpPhase === 'landing') {
        this.state = 'PHASE_2_LANDING';
        this.stateTimer = 0;
        if (!this.jumpLandEmitted) {
          this.jumpLandEmitted = true;
          this.callbacks.onJumpLand?.();
          cameraRig.triggerImpactShake('very_high');
          this.events.emit('boss:approach_state', {
            phase: 'landed',
            label: 'CRATER IMPACT — RUN!',
          });
        }
      }

      // Dynamic side-low framing keeping full Boss leap centered
      this._camPos.set(-4.6, 2.0 + boss.root.position.y * 0.35, -3.1);
      this._lookAt.set(
        boss.root.position.x,
        2.35 + boss.root.position.y * 0.85,
        boss.root.position.z
      );
      cameraRig.setCinematicPose(true, this._camPos, this._lookAt, 58, 0.04, 8.5);

      const maxJumpTotalSec =
        cfg.jumpPrepDurationSec + cfg.firstJumpDurationSec + cfg.landingRecoveryDurationSec + 0.4;
      const landingComplete =
        (this.state === 'PHASE_2_LANDING' &&
          (boss.bossJumpPhase === 'none' || this.stateTimer >= cfg.landingRecoveryDurationSec)) ||
        this.stateTimer >= maxJumpTotalSec;

      if (landingComplete) {
        if (!this.jumpLandEmitted) {
          this.jumpLandEmitted = true;
          this.callbacks.onJumpLand?.();
          cameraRig.triggerImpactShake('very_high');
        }
        // Clear any remaining jump phase state cleanly before starting chase
        boss.bossJumpPhase = 'none';
        boss.root.position.y = 0;
        this.enterChaseStart(cameraRig, boss);
      }

      return this.buildResult(cameraRig.getPlayerFeetPosition(), false, true);
    }

    // ------------------------------------------------------------------
    // 4. CHASE_START -> CHASE_ACTIVE (Finite Waypoint Pursuit Route!)
    // ------------------------------------------------------------------
    if (this.state === 'CHASE_START') {
      this.state = 'CHASE_ACTIVE';
      this.stateTimer = 0;
    }

    if (this.state === 'CHASE_ACTIVE') {
      this.chaseElapsedSec += dtSec;

      // Advance monotonically along STAGE4_CHASE_WAYPOINTS (zero circular infinite loops!)
      const reachedEnd = this.advanceAlongFiniteWaypoints(dtSec, aimX);

      // Keep Boss trailing menacingly behind or flanking along the path (never blocking final view)
      this.advanceBossInPursuit(dtSec, boss, cfg.chaseSpeed * 0.94);

      // Camera choreography:
      // Waypoints 0..1 -> Third-person escape chase view (visible fleeing survivor + roaring Boss)
      // Waypoints 2..4 -> First-person sprint & shoot burst!
      const inThirdPersonBeat = this.currentWaypointIndex < 2;

      if (inThirdPersonBeat !== this.thirdPersonCameraActive) {
        this.thirdPersonCameraActive = inThirdPersonBeat;
        if (inThirdPersonBeat) {
          cameraRig.setChaseSprintState(false, 0);
          cameraRig.setCameraState('BOSS_CHASE_CAMERA', this.events);
        } else {
          if (this.survivor) this.survivor.root.visible = false;
          cameraRig.setCinematicPose(false);
          cameraRig.setChaseSprintState(true, 1.0);
          cameraRig.setCameraState('BOSS_COMBAT_FPS', this.events);
          this.events.emit('chase:state_changed', {
            active: true,
            phase: 'pursuit',
            state: this.state,
            label: 'SPRINTING · AIM & FIRE AT THE KING!',
          });
        }
      }

      if (inThirdPersonBeat) {
        if (this.survivor) {
          this.survivor.root.visible = true;
          this.animateRunnerPose(this.chaseElapsedSec);
        }
        // Position camera ahead/beside survivor looking back to show BOTH runner & upright Boss
        const fwd = this.getCurrentSegmentForward();
        const rightX = -fwd.z;
        const rightZ = fwd.x;
        this._camPos.set(
          this._survPos.x + fwd.x * 2.8 + rightX * 3.8,
          2.35,
          this._survPos.z + fwd.z * 2.8 + rightZ * 3.8
        );
        this._lookAt.set(
          lerp(boss.root.position.x, this._survPos.x, 0.45),
          1.85,
          lerp(boss.root.position.z, this._survPos.z, 0.45)
        );
        cameraRig.setCinematicPose(true, this._camPos, this._lookAt, 60, 0.04, 7.5);
      } else {
        if (this.survivor) this.survivor.root.visible = false;
        cameraRig.setCinematicPose(false);
        cameraRig.setBasePosition(this.playerPos.x, 1.68, this.playerPos.z);
        cameraRig.setChaseSprintState(true, 1.0);

        const segFwd = this.getCurrentSegmentForward();
        const sprintYaw = Math.atan2(-segFwd.x, -segFwd.z);
        const bossDx = boss.root.position.x - this.playerPos.x;
        const bossDz = boss.root.position.z - this.playerPos.z;
        const bossYaw = Math.atan2(-bossDx, -bossDz);

        let diff = bossYaw - sprintYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        cameraRig.setBaseHeadingYaw(sprintYaw + diff * 0.72);

        this.footstepAccum -= dtSec;
        if (this.footstepAccum <= 0) {
          this.footstepAccum = 0.29;
          footstepTriggered = true;
        }
      }

      if (reachedEnd) {
        this.completeChaseAndReturnToCombat(cameraRig, boss);
        return this.buildResult(cameraRig.getPlayerFeetPosition(), footstepTriggered, false);
      }

      return this.buildResult(
        inThirdPersonBeat ? this._survPos.clone() : cameraRig.getPlayerFeetPosition(),
        footstepTriggered,
        inThirdPersonBeat
      );
    }

    return this.buildResult(cameraRig.getPlayerFeetPosition(), false, false);
  }

  private buildResult(
    playerPos: THREE.Vector3,
    footstepTriggered: boolean,
    thirdPersonCamera: boolean
  ): ChaseUpdateResult {
    return {
      active: this.active,
      state: this.state,
      phase: this.phase,
      playerPos,
      footstepTriggered,
      thirdPersonCamera,
      waypointIndex: this.currentWaypointIndex,
      totalWaypoints: STAGE4_CHASE_WAYPOINTS.length,
    };
  }

  private enterChaseStart(cameraRig: CameraRig, boss: Zombie): void {
    this.state = 'CHASE_START';
    this.stateTimer = 0;
    this.chaseElapsedSec = 0;
    this.currentWaypointIndex = 0;
    this.lateralOffset = 0;
    this.thirdPersonCameraActive = true;

    const p0 = STAGE4_CHASE_WAYPOINTS[0];
    this.playerPos.set(p0.x, 1.68, p0.z);
    this._survPos.set(p0.x, 0, p0.z);

    if (this.attachedScene) {
      this.ensureSurvivorRig(this.attachedScene);
    }
    if (this.survivor) {
      this.survivor.root.visible = true;
      this.survivor.root.position.copy(this._survPos);
    }

    // Place Boss cleanly behind starting waypoint so pursuit reads immediately
    boss.root.position.set(1.2, 0, -9.8);
    boss.root.position.y = 0;

    cameraRig.setCameraState('BOSS_CHASE_CAMERA', this.events);
    this.callbacks.onChaseStart?.();
    this.events.emit('chase:state_changed', {
      active: true,
      phase: 'pursuit',
      state: 'CHASE_ACTIVE',
      label: 'OUTRUN THE AWAKENED KING!',
    });
  }

  private advanceAlongFiniteWaypoints(dtSec: number, aimX: number): boolean {
    const lastIdx = STAGE4_CHASE_WAYPOINTS.length - 1;
    if (this.currentWaypointIndex >= lastIdx) {
      return true;
    }

    this.lateralOffset = clamp(
      this.lateralOffset + (-aimX * 0.65 - this.lateralOffset * 1.5) * dtSec,
      -1.6,
      1.6
    );

    let remainingDist = BOSS_PHASE2_TRANSITION_CONFIG.chaseSpeed * dtSec;
    const arrivalRadius = BOSS_PHASE2_TRANSITION_CONFIG.chaseWaypointArrivalRadius;

    while (remainingDist > 0 && this.currentWaypointIndex < lastIdx) {
      const target = STAGE4_CHASE_WAYPOINTS[this.currentWaypointIndex + 1];
      const dx = target.x - this._survPos.x;
      const dz = target.z - this._survPos.z;
      const dist = Math.hypot(dx, dz);

      if (dist <= arrivalRadius || dist <= remainingDist) {
        this._survPos.set(target.x, 0, target.z);
        remainingDist = Math.max(0, remainingDist - dist);
        this.currentWaypointIndex++;
      } else {
        this._survPos.x += (dx / dist) * remainingDist;
        this._survPos.z += (dz / dist) * remainingDist;
        remainingDist = 0;
      }
    }

    const fwd = this.getCurrentSegmentForward();
    const rightX = -fwd.z;
    const rightZ = fwd.x;

    this.playerPos.set(
      this._survPos.x + rightX * this.lateralOffset,
      1.68,
      this._survPos.z + rightZ * this.lateralOffset
    );

    if (this.survivor) {
      this.survivor.root.position.copy(this._survPos);
      this.survivor.root.rotation.y = Math.atan2(fwd.x, fwd.z);
    }

    return this.currentWaypointIndex >= lastIdx;
  }

  private getCurrentSegmentForward(): { x: number; z: number } {
    const lastIdx = STAGE4_CHASE_WAYPOINTS.length - 1;
    const aIdx = Math.min(this.currentWaypointIndex, lastIdx - 1);
    const bIdx = aIdx + 1;
    const a = STAGE4_CHASE_WAYPOINTS[aIdx];
    const b = STAGE4_CHASE_WAYPOINTS[bIdx];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  private advanceBossInPursuit(dtSec: number, boss: Zombie, speed: number): void {
    // Target ~4.6m behind the survivor along the current segment forward vector
    const fwd = this.getCurrentSegmentForward();
    this._bossTarget.set(
      clamp(this._survPos.x - fwd.x * 4.6, -13.0, 13.0),
      0,
      clamp(this._survPos.z - fwd.z * 4.6, -33.5, -5.0)
    );

    const dx = this._bossTarget.x - boss.root.position.x;
    const dz = this._bossTarget.z - boss.root.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05) {
      const step = Math.min(dist, speed * dtSec);
      boss.root.position.x += (dx / dist) * step;
      boss.root.position.z += (dz / dist) * step;
    }

    // Prevent Boss overlapping player camera closely during sprint
    const pDx = boss.root.position.x - this.playerPos.x;
    const pDz = boss.root.position.z - this.playerPos.z;
    const pDist = Math.hypot(pDx, pDz);
    if (pDist < 4.2 && pDist > 0.01) {
      const push = 4.2 - pDist;
      boss.root.position.x += (pDx / pDist) * push;
      boss.root.position.z += (pDz / pDist) * push;
    }

    const lookDx = this._survPos.x - boss.root.position.x;
    const lookDz = this._survPos.z - boss.root.position.z;
    boss.root.rotation.y = Math.atan2(lookDx || dx, lookDz || dz);
    boss.animateShowcaseUprightRun(dtSec, speed, 0.2, 0.55);
  }

  /**
   * Emits CHASE_COMPLETED once, clears every chase override/runner/sprint bob,
   * and returns the player cleanly to free-aim NORMAL_FPS Phase 2 combat.
   */
  private completeChaseAndReturnToCombat(cameraRig: CameraRig, boss: Zombie | null): void {
    this.state = 'CHASE_COMPLETION';
    const finalPt = STAGE4_CHASE_WAYPOINTS[STAGE4_CHASE_WAYPOINTS.length - 1];
    this.playerPos.set(finalPt.x, 1.68, finalPt.z);

    if (!this.chaseCompletedEmitted) {
      this.chaseCompletedEmitted = true;
      this.events.emit('chase:completed', {
        finalPosition: { x: finalPt.x, y: 1.68, z: finalPt.z },
        bossRemainingHealth: boss ? boss.health : 0,
      });
    }

    this.state = 'RETURN_TO_COMBAT';
    this.disposeSurvivorRig();
    this.thirdPersonCameraActive = false;

    // Position Boss safely in front (north) of the player's final combat stance so they face off cleanly
    let facingBossYaw = 0;
    if (boss) {
      const bDx = boss.root.position.x - finalPt.x;
      const bDz = boss.root.position.z - finalPt.z;
      const bDist = Math.hypot(bDx, bDz);
      if (bDist < 9.5 || boss.root.position.z > finalPt.z - 5.5) {
        boss.root.position.set(0, 0, -20.5);
      }
      boss.root.position.y = 0;
      boss.bossAllowAutoJump = true;
      boss.cinematicControlled = false;
      boss.bossState = 'PHASE_2_IDLE';
      boss.root.rotation.y = Math.atan2(
        finalPt.x - boss.root.position.x,
        finalPt.z - boss.root.position.z
      );
      facingBossYaw = Math.atan2(
        -(boss.root.position.x - finalPt.x),
        -(boss.root.position.z - finalPt.z)
      );
    }

    // Restore standard FPS camera completely (clear chase sprint, FOV override, cinematic pose)
    cameraRig.setCinematicPose(false);
    cameraRig.setTargetFov(null);
    cameraRig.setChaseSprintState(false, 0);
    cameraRig.setWalkBobState(false, 0);
    cameraRig.setFreeLookRange(false);
    cameraRig.setBasePosition(finalPt.x, 1.68, finalPt.z);
    cameraRig.setBaseHeadingYaw(facingBossYaw);
    cameraRig.setCameraState('NORMAL_FPS', this.events);

    this.active = false;
    this.phase = 'none';
    this.state = 'PHASE_2_COMBAT_ACTIVE';

    this.events.emit('boss:approach_state', { phase: 'done', label: '' });
    this.events.emit('chase:state_changed', {
      active: false,
      phase: 'none',
      state: 'PHASE_2_COMBAT_ACTIVE',
      label: '',
    });
    this.callbacks.onChaseCompleted?.();
  }

  private animateRunnerPose(t: number): void {
    if (!this.survivor) return;
    const stride = Math.sin(t * 14.5);
    const bounce = Math.abs(stride) * 0.09;
    this.survivor.torsoPivot.position.y = 0.92 + bounce;
    this.survivor.torsoPivot.rotation.set(0.28, -stride * 0.1, 0);
    this.survivor.headPivot.rotation.set(-0.1, Math.sin(t * 3.1) * 0.45, 0);
    this.survivor.leftLegPivot.rotation.x = stride * 0.95;
    this.survivor.rightLegPivot.rotation.x = -stride * 0.95;
    this.survivor.leftArmPivot.rotation.x = -0.55 - stride * 0.85;
    this.survivor.rightArmPivot.rotation.x = -0.82 + stride * 0.45;
  }

  private ensureSurvivorRig(scene: THREE.Scene): void {
    if (this.survivor) return;
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const tGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      geometries.push(g);
      return g;
    };
    const tMat = <T extends THREE.Material>(m: T): T => {
      materials.push(m);
      return m;
    };

    const root = new THREE.Group();
    const torsoPivot = new THREE.Group();
    torsoPivot.position.set(0, 0.92, 0);
    root.add(torsoPivot);

    const armorMat = tMat(new THREE.MeshStandardMaterial({ color: 0x26313d, roughness: 0.65, metalness: 0.25 }));
    const pantsMat = tMat(new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.8 }));
    const skinMat = tMat(new THREE.MeshStandardMaterial({ color: 0xc29578, roughness: 0.75 }));
    const bootMat = tMat(new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.88 }));
    const packMat = tMat(new THREE.MeshStandardMaterial({ color: 0x3b3528, roughness: 0.82 }));
    const visorMat = tMat(
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.9 })
    );

    const torso = new THREE.Mesh(tGeo(new THREE.BoxGeometry(0.48, 0.62, 0.28)), armorMat);
    torso.position.y = 0.31;
    torso.castShadow = true;
    const pack = new THREE.Mesh(tGeo(new THREE.BoxGeometry(0.36, 0.44, 0.18)), packMat);
    pack.position.set(0, 0.34, -0.22);
    torsoPivot.add(torso, pack);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.66, 0);
    const head = new THREE.Mesh(tGeo(new THREE.BoxGeometry(0.28, 0.3, 0.28)), skinMat);
    head.position.y = 0.16;
    const helmet = new THREE.Mesh(tGeo(new THREE.BoxGeometry(0.32, 0.16, 0.32)), armorMat);
    helmet.position.y = 0.26;
    const visor = new THREE.Mesh(tGeo(new THREE.BoxGeometry(0.24, 0.08, 0.06)), visorMat);
    visor.position.set(0, 0.18, 0.14);
    headPivot.add(head, helmet, visor);
    torsoPivot.add(headPivot);

    const armGeo = tGeo(new THREE.BoxGeometry(0.14, 0.52, 0.14));
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.32, 0.56, 0);
    const lArm = new THREE.Mesh(armGeo, armorMat);
    lArm.position.y = -0.22;
    leftArmPivot.add(lArm);
    torsoPivot.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.32, 0.56, 0);
    const rArm = new THREE.Mesh(armGeo, armorMat);
    rArm.position.y = -0.22;
    const rifle = new THREE.Mesh(tGeo(new THREE.BoxGeometry(0.08, 0.1, 0.56)), bootMat);
    rifle.position.set(0, -0.44, 0.22);
    rightArmPivot.add(rArm, rifle);
    torsoPivot.add(rightArmPivot);

    const legGeo = tGeo(new THREE.BoxGeometry(0.17, 0.54, 0.18));
    const bootGeo = tGeo(new THREE.BoxGeometry(0.18, 0.24, 0.26));

    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.13, 0.9, 0);
    const lLeg = new THREE.Mesh(legGeo, pantsMat);
    lLeg.position.y = -0.28;
    const lBoot = new THREE.Mesh(bootGeo, bootMat);
    lBoot.position.set(0, -0.76, 0.04);
    leftLegPivot.add(lLeg, lBoot);
    root.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.13, 0.9, 0);
    const rLeg = new THREE.Mesh(legGeo, pantsMat);
    rLeg.position.y = -0.28;
    const rBoot = new THREE.Mesh(bootGeo, bootMat);
    rBoot.position.set(0, -0.76, 0.04);
    rightLegPivot.add(rLeg, rBoot);
    root.add(rightLegPivot);

    root.visible = false;
    scene.add(root);
    this.survivor = {
      root,
      torsoPivot,
      headPivot,
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      geometries,
      materials,
    };
  }

  private disposeSurvivorRig(): void {
    if (!this.survivor) return;
    if (this.survivor.root.parent) {
      this.survivor.root.parent.remove(this.survivor.root);
    }
    for (const g of this.survivor.geometries) g.dispose();
    for (const m of this.survivor.materials) m.dispose();
    this.survivor = null;
  }
}
