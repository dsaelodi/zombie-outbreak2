import * as THREE from 'three';
import type { EventBus, ShowcaseState } from '../../core/EventBus';
import { Zombie, type ZombieUpdateCallbacks } from '../entities/Zombie';
import type { AssetManager } from '../AssetManager';
import type { CameraRig } from '../CameraRig';
import type { Weapon } from '../entities/Weapon';
import type { EffectsSystem } from './EffectsSystem';
import type { CrowdBehaviorState } from '../world/ZombieCrowdManager';
import { clamp, lerp } from '../../utils/math';

export interface ShowcaseAudioHooks {
  onArFire?: () => void;
  onSmgFire?: () => void;
  onZombieHit?: () => void;
  onZombieDeath?: () => void;
  onZombieGroan?: (x: number, z: number, variant: Zombie['variant']) => void;
  onBossMutation?: () => void;
  onBossRoar?: () => void;
  onBossJumpPrep?: () => void;
  onBossJumpLand?: () => void;
  onFadeOutDemoAudio?: () => void;
  onRestoreMenuAudio?: () => void;
  onSetExposure?: (exposure: number) => void;
  onCrowdState?: (state: CrowdBehaviorState, excitement01: number) => void;
}

interface ShowcaseSurvivorRig {
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

const CYCLE_DURATION_SEC = 24.0;
const ARENA_CENTER_X = 0;
const ARENA_CENTER_Z = -21.5;
const TRACK_RADIUS_X = 9.4;
const TRACK_RADIUS_Z = 10.6;

/**
 * Isolated Home Screen Background Showcase:
 * Continuously loops Boss Phase 2 ("The King — Awakened") aggressively chasing an
 * isolated Survivor runner around the Stage 4 Arena while Zombie Spectators cheer
 * and surge from the surrounding colosseum stands.
 * Never touches campaign GameSession state and keeps menu UI fully visible & clickable.
 */
export class HomeScreenShowcaseController {
  private state: ShowcaseState = 'SHOWCASE_GAMEPLAY';
  private cycleTimeSec = 0;
  private enabled = true;
  private modalPaused = false;
  private readonly activeMode: 'boss_phase2' = 'boss_phase2';

  private bossPhase2: Zombie | null = null;
  private survivor: ShowcaseSurvivorRig | null = null;
  private readonly showcaseActors: Zombie[] = [];

  private jumpPrepFired = false;
  private jumpLandFired = false;
  private roarShot2Fired = false;
  private roarShot5Fired = false;
  private jumpActive = false;
  private jumpStartPos = new THREE.Vector3();
  private jumpTargetPos = new THREE.Vector3();
  private lastSurvivorAngle = 0;
  private currentExcitement = 0.25;

  private readonly _survivorPos = new THREE.Vector3();
  private readonly _survivorLook = new THREE.Vector3();
  private readonly _bossPos = new THREE.Vector3();
  private readonly _camPos = new THREE.Vector3();
  private readonly _lookAt = new THREE.Vector3();

  private readonly _shotCamA = new THREE.Vector3();
  private readonly _shotLookA = new THREE.Vector3();
  private readonly _shotCamB = new THREE.Vector3();
  private readonly _shotLookB = new THREE.Vector3();

  public readonly _unusedCallbacks: ZombieUpdateCallbacks = {
    onAttackHit: () => {},
  };

  constructor(private readonly events: EventBus) {}

  public getState(): ShowcaseState {
    return this.state;
  }

  public getActiveMode(): 'combat' | 'boss_phase2' {
    return this.activeMode;
  }

  public isGameplaySequenceActive(): boolean {
    return this.enabled;
  }

  public getShowcaseBossCount(): number {
    return this.showcaseActors.length;
  }

  public hasSinglePhase2Boss(): boolean {
    return (
      this.showcaseActors.length === 1 &&
      this.bossPhase2 !== null &&
      this.bossPhase2.bossSuperPhase === 2
    );
  }

  public getShowcaseBoss(): Zombie | null {
    return this.bossPhase2;
  }

  public hasShowcaseSurvivor(): boolean {
    return this.survivor !== null;
  }

  public getCycleDurationSec(): number {
    return CYCLE_DURATION_SEC;
  }

  public getCycleTimeSec(): number {
    return this.cycleTimeSec;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public setModalPaused(paused: boolean): void {
    this.modalPaused = paused;
  }

  public enterHomeIdle(
    scene: THREE.Scene,
    assetManager: AssetManager,
    weapon: Weapon,
    cameraRig: CameraRig,
    effectsSystem: EffectsSystem
  ): void {
    this.clearShowcaseActors(scene);
    effectsSystem.clear(scene);
    weapon.root.visible = false;
    weapon.setActiveWeapon('ar');
    cameraRig.setCinematicPose(false);
    cameraRig.resetForGameplay();

    this.cycleTimeSec = 0;
    this.jumpPrepFired = false;
    this.jumpLandFired = false;
    this.roarShot2Fired = false;
    this.roarShot5Fired = false;
    this.jumpActive = false;
    this.currentExcitement = 0.25;

    this.spawnChaseActors(scene, assetManager);
    this.events.emit('showcase:fade', { curtainAlpha: 0, titleOpacity: 1, menuOpacity: 1 });
    this.transitionTo('SHOWCASE_GAMEPLAY');
  }

  public abortImmediate(
    scene: THREE.Scene,
    weapon: Weapon,
    cameraRig: CameraRig,
    effectsSystem: EffectsSystem
  ): void {
    this.clearShowcaseActors(scene);
    effectsSystem.clear(scene);
    weapon.root.visible = false;
    weapon.setActiveWeapon('ar');
    cameraRig.setCinematicPose(false);
    cameraRig.resetForGameplay();
    this.events.emit('showcase:fade', { curtainAlpha: 0, titleOpacity: 1, menuOpacity: 1 });
    this.transitionTo('HOME_IDLE');
  }

  private sampleTrack(angleRad: number, radialBias: number, out: THREE.Vector3): THREE.Vector3 {
    const rx = TRACK_RADIUS_X + radialBias;
    const rz = TRACK_RADIUS_Z + radialBias;
    return out.set(
      ARENA_CENTER_X + Math.cos(angleRad) * rx,
      0,
      ARENA_CENTER_Z + Math.sin(angleRad) * rz
    );
  }

  public update(
    dtSec: number,
    _elapsedSec: number,
    scene: THREE.Scene,
    cameraRig: CameraRig,
    weapon: Weapon,
    assetManager: AssetManager,
    effectsSystem: EffectsSystem,
    audioHooks: ShowcaseAudioHooks
  ): void {
    weapon.root.visible = false;
    if (!this.bossPhase2 || !this.survivor) {
      this.spawnChaseActors(scene, assetManager);
    }
    if (!this.bossPhase2 || !this.survivor) return;

    if (this.modalPaused) {
      return;
    }

    if (!this.enabled) {
      // Static calm framing if user turned showcase animation off in settings
      this.bossPhase2.updateShowcase(dtSec, -0.35);
      this._camPos.set(1.2, 2.75, -2.5);
      this._lookAt.set(0, 2.0, -18.5);
      cameraRig.setCinematicPose(true, this._camPos, this._lookAt, 56, 0);
      cameraRig.update(dtSec);
      audioHooks.onCrowdState?.('idle', 0);
      return;
    }

    const prevCycleT = this.cycleTimeSec;
    this.cycleTimeSec = (this.cycleTimeSec + dtSec) % CYCLE_DURATION_SEC;
    if (this.cycleTimeSec < prevCycleT) {
      // Clean modulo cycle wrap: reset one-shot audio triggers with zero teleportation
      this.jumpPrepFired = false;
      this.jumpLandFired = false;
      this.roarShot2Fired = false;
      this.roarShot5Fired = false;
      this.jumpActive = false;
    }

    const t = this.cycleTimeSec;
    const norm = t / CYCLE_DURATION_SEC;

    // 1. Survivor runs continuously along elliptical Stage 4 Arena track (1 full lap per 24s)
    const survivorAngle = norm * Math.PI * 2;
    this.lastSurvivorAngle = survivorAngle;
    const radialWeave = Math.sin(norm * Math.PI * 4) * 0.65;
    this.sampleTrack(survivorAngle, radialWeave, this._survivorPos);
    this.sampleTrack(survivorAngle + 0.14, radialWeave, this._survivorLook);

    this.survivor.root.position.copy(this._survivorPos);
    const survDx = this._survivorLook.x - this._survivorPos.x;
    const survDz = this._survivorLook.z - this._survivorPos.z;
    this.survivor.root.rotation.y = Math.atan2(survDx, survDz);

    // Occasional frantic glance back at The King without slowing down
    const glanceWindow =
      (t > 4.5 && t < 6.8) || (t > 14.5 && t < 17.5)
        ? Math.sin(clamp((t > 14 ? t - 14.5 : t - 4.5) / 2.3, 0, 1) * Math.PI)
        : 0;
    this.animateSurvivorSprint(this.survivor, t, glanceWindow);

    // 2. Boss Phase 2 pursues ~0.52 rad behind with roaring surges and Shot 3 Parabolic Jump Attack
    const isJumpWindow = t >= 8.0 && t <= 11.3;
    const closeSurge = t >= 3.8 && t <= 7.8 ? Math.sin(((t - 3.8) / 4.0) * Math.PI) : 0;
    const followGapRad = lerp(0.56, 0.38, closeSurge);
    const bossAngle = survivorAngle - followGapRad;

    if (isJumpWindow) {
      if (!this.jumpActive) {
        this.jumpActive = true;
        this.jumpStartPos.copy(this.bossPhase2.root.position);
        this.jumpStartPos.y = 0;
        // Aim landing safely ~0.34 rad behind the moving survivor at t=10.7s so Boss never catches/overlaps
        const futureSurvivorAngle = (10.7 / CYCLE_DURATION_SEC) * Math.PI * 2;
        this.sampleTrack(futureSurvivorAngle - 0.34, 0.25, this.jumpTargetPos);
      }

      const jumpU = clamp((t - 8.0) / 3.3, 0, 1);
      if (!this.jumpPrepFired && jumpU >= 0.04) {
        this.jumpPrepFired = true;
        audioHooks.onBossJumpPrep?.();
      }
      if (!this.jumpLandFired && jumpU >= 0.81) {
        this.jumpLandFired = true;
        audioHooks.onBossJumpLand?.();
        audioHooks.onBossRoar?.();
        effectsSystem.spawnBossLandingDebris(scene, this.jumpTargetPos, 5.2);
        cameraRig.triggerImpactShake('high');
      }

      this.bossPhase2.setShowcaseJumpProgress(jumpU, this.jumpStartPos, this.jumpTargetPos);
      const jDx = this._survivorPos.x - this.bossPhase2.root.position.x;
      const jDz = this._survivorPos.z - this.bossPhase2.root.position.z;
      this.bossPhase2.root.rotation.y = Math.atan2(jDx, jDz);
    } else {
      this.jumpActive = false;
      this.sampleTrack(bossAngle, -0.35, this._bossPos);

      // Measure actual horizontal ground displacement speed to keep footwork synced with zero sliding
      const prevBx = this.bossPhase2.root.position.x;
      const prevBz = this.bossPhase2.root.position.z;
      this.bossPhase2.root.position.lerp(this._bossPos, clamp(dtSec * 7.5, 0, 1));
      this.bossPhase2.root.position.y = 0;
      const movedDist = Math.hypot(
        this.bossPhase2.root.position.x - prevBx,
        this.bossPhase2.root.position.z - prevBz
      );
      const actualGroundSpeed = dtSec > 0.0001 ? clamp(movedDist / dtSec, 3.0, 6.8) : 4.2;

      const bDx = this._survivorPos.x - this.bossPhase2.root.position.x;
      const bDz = this._survivorPos.z - this.bossPhase2.root.position.z;
      this.bossPhase2.root.rotation.y = Math.atan2(bDx, bDz);

      const roarPulse =
        (t > 4.2 && t < 6.4 ? Math.sin(((t - 4.2) / 2.2) * Math.PI) : 0) +
        (t > 16.5 && t < 18.8 ? Math.sin(((t - 16.5) / 2.3) * Math.PI) : 0);
      const reachPulse = closeSurge * 0.9 + 0.25;
      this.bossPhase2.animateShowcaseUprightRun(
        dtSec,
        actualGroundSpeed,
        clamp(roarPulse, 0, 1),
        clamp(reachPulse, 0, 1)
      );
    }

    if (!this.roarShot2Fired && t >= 4.4) {
      this.roarShot2Fired = true;
      audioHooks.onBossRoar?.();
    }
    if (!this.roarShot5Fired && t >= 16.8) {
      this.roarShot5Fired = true;
      audioHooks.onBossRoar?.();
    }

    // 3. Dynamic Zombie Crowd Excitement — surges violently during Jump Attack & close chase
    const targetExcitement =
      isJumpWindow
        ? 1.0
        : t >= 11.3 && t <= 15.6
        ? 0.92
        : t >= 3.8 && t <= 8.0
        ? 0.72
        : 0.34;
    this.currentExcitement = lerp(this.currentExcitement, targetExcitement, clamp(dtSec * 3.5, 0, 1));
    const crowdBehavior: CrowdBehaviorState =
      this.currentExcitement > 0.68 ? 'hysterical' : 'cheering';
    audioHooks.onCrowdState?.(crowdBehavior, this.currentExcitement);

    // 4. Seamless 6-Shot Cyclic Camera Rig (Shot 1 & Shot 6 wrap smoothly with zero teleports)
    this.computeCyclicCamera(t, this._camPos, this._lookAt);
    const fov = this.computeCyclicFov(t);
    cameraRig.setCinematicPose(true, this._camPos, this._lookAt, fov, 0);
    cameraRig.update(dtSec);
    effectsSystem.update(scene, dtSec);
  }

  private sampleShotPose(
    shotIndex: number,
    outCam: THREE.Vector3,
    outLook: THREE.Vector3
  ): void {
    const bossX = this.bossPhase2 ? this.bossPhase2.root.position.x : 0;
    const bossY = this.bossPhase2 ? this.bossPhase2.root.position.y : 0;
    const bossZ = this.bossPhase2 ? this.bossPhase2.root.position.z : -21.5;
    const survX = this._survivorPos.x;
    const survZ = this._survivorPos.z;
    const midX = (bossX + survX) * 0.5;
    const midZ = (bossZ + survZ) * 0.5;

    // Outward radial normal away from arena center for crisp side/3-quarter framing
    const radAngle = this.lastSurvivorAngle - 0.25;
    const outX = Math.cos(radAngle);
    const outZ = Math.sin(radAngle);

    switch (shotIndex % 6) {
      case 0:
        // Shot 1: Wide Arena Establishing — Boss Phase 2 chasing Survivor across glowing colosseum
        outCam.set(ARENA_CENTER_X + 2.6, 5.4, -4.8);
        outLook.set(midX, 1.85, midZ);
        break;
      case 1:
        // Shot 2: The Hunt — Low-angle tracking alongside & slightly behind Survivor looking back at roaring Boss
        outCam.set(survX + outX * 3.4, 1.55, survZ + outZ * 3.4);
        outLook.set(lerp(bossX, survX, 0.28), 2.15, lerp(bossZ, survZ, 0.28));
        break;
      case 2:
        // Shot 3: Boss Jump Attack — Dramatic side-low frame capturing full airborne parabola
        outCam.set(midX - outX * 7.8, 1.85, midZ - outZ * 7.8);
        outLook.set(bossX, 2.0 + bossY * 0.72, bossZ);
        break;
      case 3:
        // Shot 4: Crowd Reaction — Sweeps upward toward cheering/jumping Zombie Spectators on stands
        outCam.set(midX * 0.35, 2.35, -14.5);
        outLook.set(bossX * 0.55, 4.9, -28.5);
        break;
      case 4:
        // Shot 5: Continued Pursuit — Tight dynamic chase behind Boss claws reaching for Survivor
        outCam.set(bossX - outX * 5.2, 2.15, bossZ - outZ * 5.2);
        outLook.set(survX, 1.7, survZ);
        break;
      default:
        // Shot 6: Cinematic Wide View — Pulls back cleanly toward Shot 1 position for seamless loop wrap
        outCam.set(ARENA_CENTER_X + 1.8, 5.2, -5.4);
        outLook.set(midX, 1.85, midZ);
        break;
    }
  }

  private computeCyclicCamera(
    t: number,
    outCam: THREE.Vector3,
    outLook: THREE.Vector3
  ): void {
    // 6 equal 4.0-second shots; blend smoothly over the final 1.2s of each shot
    const shotDuration = CYCLE_DURATION_SEC / 6; // 4.0s
    const rawIdx = Math.floor(t / shotDuration) % 6;
    const localT = t - rawIdx * shotDuration;
    const blendWindow = 1.25;
    const nextIdx = (rawIdx + 1) % 6;

    this.sampleShotPose(rawIdx, this._shotCamA, this._shotLookA);
    if (localT < shotDuration - blendWindow) {
      outCam.copy(this._shotCamA);
      outLook.copy(this._shotLookA);
      return;
    }

    this.sampleShotPose(nextIdx, this._shotCamB, this._shotLookB);
    const u = clamp((localT - (shotDuration - blendWindow)) / blendWindow, 0, 1);
    const ease = 0.5 - 0.5 * Math.cos(u * Math.PI);
    outCam.lerpVectors(this._shotCamA, this._shotCamB, ease);
    outLook.lerpVectors(this._shotLookA, this._shotLookB, ease);
  }

  private computeCyclicFov(t: number): number {
    // Subtle breathing FOV changes aligned with jump & hunt shots
    if (t >= 8.0 && t <= 11.3) return 60;
    if (t >= 12.0 && t <= 16.0) return 58;
    if (t >= 4.0 && t < 8.0) return 52;
    return 56;
  }

  private animateSurvivorSprint(
    rig: ShowcaseSurvivorRig,
    t: number,
    glance01: number
  ): void {
    const stride = t * 12.5;
    const swing = Math.sin(stride);
    const bounce = Math.abs(Math.cos(stride)) * 0.08;

    rig.root.position.y = bounce;
    rig.torsoPivot.rotation.set(0.28, glance01 * -0.35, Math.sin(stride) * 0.05);
    rig.headPivot.rotation.set(-0.12, glance01 * -1.35, 0);
    rig.leftLegPivot.rotation.x = swing * 0.88;
    rig.rightLegPivot.rotation.x = -swing * 0.88;
    rig.leftArmPivot.rotation.x = -swing * 0.72 - 0.35;
    rig.rightArmPivot.rotation.x = swing * 0.45 - 0.75;
  }

  private createSurvivorRig(): ShowcaseSurvivorRig {
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      geometries.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      materials.push(m);
      return m;
    };

    const root = new THREE.Group();
    const torsoPivot = new THREE.Group();
    torsoPivot.position.set(0, 0.92, 0);
    root.add(torsoPivot);

    const armorMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x26313d, roughness: 0.65, metalness: 0.25 })
    );
    const pantsMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.8 })
    );
    const skinMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0xc29578, roughness: 0.75 })
    );
    const bootMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.88 })
    );
    const packMat = trackMat(
      new THREE.MeshStandardMaterial({ color: 0x3b3528, roughness: 0.82 })
    );
    const visorMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.85,
        roughness: 0.2,
      })
    );
    const flashMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfef3c7,
        emissive: 0xfde68a,
        emissiveIntensity: 1.6,
      })
    );

    const torso = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.48, 0.62, 0.28)), armorMat);
    torso.position.y = 0.31;
    torso.castShadow = true;
    torsoPivot.add(torso);

    const pack = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.36, 0.44, 0.18)), packMat);
    pack.position.set(0, 0.34, -0.22);
    torsoPivot.add(pack);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.66, 0);
    torsoPivot.add(headPivot);

    const head = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.28, 0.3, 0.28)), skinMat);
    head.position.y = 0.16;
    const helmet = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.32, 0.16, 0.32)), armorMat);
    helmet.position.y = 0.26;
    const visor = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.24, 0.08, 0.06)), visorMat);
    visor.position.set(0, 0.18, 0.14);
    headPivot.add(head, helmet, visor);

    const armGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.52, 0.14));
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.32, 0.56, 0);
    const leftArm = new THREE.Mesh(armGeo, armorMat);
    leftArm.position.y = -0.22;
    leftArmPivot.add(leftArm);
    torsoPivot.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.32, 0.56, 0);
    const rightArm = new THREE.Mesh(armGeo, armorMat);
    rightArm.position.y = -0.22;
    const rifle = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.08, 0.1, 0.56)), bootMat);
    rifle.position.set(0, -0.44, 0.22);
    const torchTip = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(0.06, 0.06, 0.06)), flashMat);
    torchTip.position.set(0, -0.42, 0.5);
    rightArmPivot.add(rightArm, rifle, torchTip);
    torsoPivot.add(rightArmPivot);

    const legGeo = trackGeo(new THREE.BoxGeometry(0.17, 0.54, 0.18));
    const bootGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.24, 0.26));

    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.13, 0.9, 0);
    const leftLeg = new THREE.Mesh(legGeo, pantsMat);
    leftLeg.position.y = -0.28;
    const leftBoot = new THREE.Mesh(bootGeo, bootMat);
    leftBoot.position.set(0, -0.76, 0.04);
    leftLegPivot.add(leftLeg, leftBoot);
    root.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.13, 0.9, 0);
    const rightLeg = new THREE.Mesh(legGeo, pantsMat);
    rightLeg.position.y = -0.28;
    const rightBoot = new THREE.Mesh(bootGeo, bootMat);
    rightBoot.position.set(0, -0.76, 0.04);
    rightLegPivot.add(rightLeg, rightBoot);
    root.add(rightLegPivot);

    return {
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

  private spawnChaseActors(scene: THREE.Scene, assetManager: AssetManager): void {
    this.clearShowcaseActors(scene);

    // 1. Isolated Survivor Runner
    const surv = this.createSurvivorRig();
    this.sampleTrack(0, 0, surv.root.position);
    scene.add(surv.root);
    this.survivor = surv;

    // 2. Single Isolated Boss Phase 2 ("The King — Awakened")
    this.sampleTrack(-0.56, -0.35, this._bossPos);
    const boss = new Zombie('boss', this._bossPos.x, this._bossPos.z, 1, 1, assetManager);
    boss.showcaseOnly = true;
    boss.cinematicControlled = true;
    boss.forceShowcasePhase2Visuals();
    boss.setWeaknessVisible(false);
    scene.add(boss.root);
    this.bossPhase2 = boss;
    this.showcaseActors.push(boss);
  }

  private clearShowcaseActors(scene: THREE.Scene): void {
    for (const z of this.showcaseActors) {
      z.dispose(scene);
    }
    this.showcaseActors.length = 0;
    this.bossPhase2 = null;

    if (this.survivor) {
      scene.remove(this.survivor.root);
      for (const g of this.survivor.geometries) g.dispose();
      for (const m of this.survivor.materials) m.dispose();
      this.survivor = null;
    }
  }

  private transitionTo(next: ShowcaseState): void {
    if (this.state === next) return;
    this.state = next;
    this.events.emit('showcase:state_changed', { state: next, mode: this.activeMode });
  }

  public dispose(scene: THREE.Scene): void {
    this.clearShowcaseActors(scene);
  }
}
