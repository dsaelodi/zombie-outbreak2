import * as THREE from 'three';
import { STORY_CINEMATIC_CONFIG } from '../../data/gameConfig';
import {
  getStagePreInvasionIntro,
  OPENING_STORY_SHOTS,
  type OpeningShotConfig,
  type StagePreInvasionConfig,
} from '../../data/storyCinematics';
import { clamp, lerp } from '../../utils/math';
import type { CameraRig } from '../CameraRig';

export type StoryCinematicKind = 'opening' | 'stage_intro';

export interface StoryCinematicCallbacks {
  onStart: (payload: {
    kind: StoryCinematicKind;
    stageNumber?: number;
    title: string;
    subtitle: string;
    description?: string;
    objective?: string;
  }) => void;
  onFrame: (payload: {
    eyebrow: string;
    title: string;
    subtitleText: string;
    description?: string;
    objective?: string;
    showStageCard: boolean;
    canSkip: boolean;
    fadeAlpha: number;
  }) => void;
  onEnd: (kind: StoryCinematicKind) => void;
  onPlaySfx?: (
    sfx: 'distant_siren' | 'facility_alarm' | 'boss_roar' | 'footstep' | 'arena_crowd_cheer'
  ) => void;
  onSetCrowdState?: (state: 'idle' | 'cheering') => void;
  onSetFacilityAlarm?: (active: boolean) => void;
  onSetExposure?: (exposure: number) => void;
}

interface TempVillagerActor {
  group: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  baseX: number;
  baseZ: number;
  dirZ: number;
  speed: number;
  phaseOffset: number;
}

/**
 * Self-contained Pre-Invasion & Campaign Opening Story Cinematic Controller.
 * Spawns temporary pre-outbreak civilians/scientists/vehicles inside an isolated THREE.Group
 * and guarantees complete geometry/material disposal on finish, skip, or reset.
 */
export class StoryCinematicController {
  private activeKind: StoryCinematicKind | null = null;
  private stageIndex = 0;
  private elapsedSec = 0;
  private totalDurationSec = 0;

  private propGroup: THREE.Group | null = null;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];

  private villagers: TempVillagerActor[] = [];
  private passingCar: THREE.Group | null = null;
  private heroTubeGroup: THREE.Group | null = null;
  private heroTubeGlassMat: THREE.MeshStandardMaterial | null = null;
  private heroTubeGlowLight: THREE.PointLight | null = null;
  private breachRedLight: THREE.PointLight | null = null;
  private beforeWarmLight: THREE.HemisphereLight | null = null;

  private savedBgColor: THREE.Color | null = null;
  private savedFogColor: THREE.Color | null = null;
  private savedFogDensity: number | null = null;

  private cueFlags = new Set<string>();
  private readonly camPos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();

  public isActive(): boolean {
    return this.activeKind !== null;
  }

  public getKind(): StoryCinematicKind | null {
    return this.activeKind;
  }

  public canSkip(): boolean {
    return this.activeKind !== null && this.elapsedSec >= STORY_CINEMATIC_CONFIG.skipDelaySec;
  }

  public startOpening(
    scene: THREE.Scene,
    cameraRig: CameraRig,
    callbacks: StoryCinematicCallbacks
  ): void {
    this.cleanup(scene, cameraRig, callbacks);
    this.activeKind = 'opening';
    this.stageIndex = 0;
    this.elapsedSec = 0;
    this.cueFlags.clear();
    this.totalDurationSec = OPENING_STORY_SHOTS.reduce((acc, s) => acc + s.durationSec, 0);

    this.captureSceneAtmosphere(scene);
    this.buildTemporaryOpeningProps(scene);

    const first = OPENING_STORY_SHOTS[0];
    callbacks.onStart({
      kind: 'opening',
      title: first.title,
      subtitle: first.subtitleText,
    });
    this.updateOpening(0.016, scene, cameraRig, callbacks);
  }

  public startStageIntro(
    stageIndex: number,
    scene: THREE.Scene,
    cameraRig: CameraRig,
    callbacks: StoryCinematicCallbacks
  ): void {
    this.cleanup(scene, cameraRig, callbacks);
    const intro = getStagePreInvasionIntro(stageIndex);
    this.activeKind = 'stage_intro';
    this.stageIndex = stageIndex;
    this.elapsedSec = 0;
    this.cueFlags.clear();
    this.totalDurationSec = intro.durationSec;

    this.captureSceneAtmosphere(scene);
    this.buildTemporaryStageProps(stageIndex, scene, callbacks);

    callbacks.onStart({
      kind: 'stage_intro',
      stageNumber: intro.stageNumber,
      title: intro.stageName,
      subtitle: intro.beforeSubtitle,
      description: intro.quote,
      objective: intro.objective,
    });
    this.updateStageIntro(0.016, intro, scene, cameraRig, callbacks);
  }

  public update(
    dtSec: number,
    scene: THREE.Scene,
    cameraRig: CameraRig,
    callbacks: StoryCinematicCallbacks
  ): void {
    if (!this.activeKind) return;
    this.elapsedSec += dtSec;

    if (this.activeKind === 'opening') {
      this.updateOpening(dtSec, scene, cameraRig, callbacks);
    } else {
      const intro = getStagePreInvasionIntro(this.stageIndex);
      this.updateStageIntro(dtSec, intro, scene, cameraRig, callbacks);
    }
  }

  public skip(
    scene: THREE.Scene,
    cameraRig: CameraRig,
    callbacks: StoryCinematicCallbacks
  ): void {
    if (!this.canSkip()) return;
    const finishedKind = this.activeKind;
    this.cleanup(scene, cameraRig, callbacks);
    if (finishedKind) {
      callbacks.onEnd(finishedKind);
    }
  }

  public reset(scene: THREE.Scene, cameraRig?: CameraRig): void {
    this.cleanup(scene, cameraRig);
  }

  private captureSceneAtmosphere(scene: THREE.Scene): void {
    if (scene.background instanceof THREE.Color) {
      this.savedBgColor = scene.background.clone();
    }
    if (scene.fog instanceof THREE.FogExp2) {
      this.savedFogColor = scene.fog.color.clone();
      this.savedFogDensity = scene.fog.density;
    }
  }

  private restoreSceneAtmosphere(scene: THREE.Scene): void {
    if (this.savedBgColor) {
      scene.background = this.savedBgColor.clone();
    }
    if (this.savedFogColor && this.savedFogDensity !== null) {
      scene.fog = new THREE.FogExp2(this.savedFogColor.getHex(), this.savedFogDensity);
    }
    this.savedBgColor = null;
    this.savedFogColor = null;
    this.savedFogDensity = null;
  }

  private tGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private tMat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private createTempHuman(
    coatColor: number,
    skinColor: number,
    x: number,
    z: number,
    yaw = 0
  ): TempVillagerActor {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = yaw;

    const coatMat = this.tMat(new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.85 }));
    const skinMat = this.tMat(new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.8 }));
    const pantMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 }));

    const torso = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(0.44, 0.62, 0.24)), coatMat);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(0.24, 0.25, 0.24)), skinMat);
    head.position.y = 1.62;
    const leftArm = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(0.12, 0.54, 0.12)), coatMat);
    leftArm.position.set(-0.29, 1.14, 0);
    const rightArm = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(0.12, 0.54, 0.12)), coatMat);
    rightArm.position.set(0.29, 1.14, 0);
    const leftLeg = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(0.16, 0.68, 0.18)), pantMat);
    leftLeg.position.set(-0.11, 0.45, 0);
    const rightLeg = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(0.16, 0.68, 0.18)), pantMat);
    rightLeg.position.set(0.11, 0.45, 0);

    group.add(torso, head, leftArm, rightArm, leftLeg, rightLeg);
    this.propGroup?.add(group);

    return {
      group,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      baseX: x,
      baseZ: z,
      dirZ: yaw === 0 ? 1 : -1,
      speed: 1.15,
      phaseOffset: Math.abs(x * 1.7 + z * 0.3),
    };
  }

  private animateHumanActor(actor: TempVillagerActor, dtSec: number, t: number, speedMult = 1): void {
    actor.group.position.z += actor.dirZ * actor.speed * speedMult * dtSec;
    if (actor.group.position.z > actor.baseZ + 12) actor.group.position.z = actor.baseZ - 8;
    if (actor.group.position.z < actor.baseZ - 14) actor.group.position.z = actor.baseZ + 8;
    const swing = Math.sin(t * 5.8 * speedMult + actor.phaseOffset) * 0.42;
    actor.leftLeg.rotation.x = swing;
    actor.rightLeg.rotation.x = -swing;
    actor.leftArm.rotation.x = -swing * 0.6;
    actor.rightArm.rotation.x = swing * 0.6;
  }

  private buildTemporaryOpeningProps(scene: THREE.Scene): void {
    this.propGroup = new THREE.Group();
    scene.add(this.propGroup);

    this.beforeWarmLight = new THREE.HemisphereLight(0xfde68a, 0x3f2e21, 0.85);
    this.propGroup.add(this.beforeWarmLight);

    // Normal-world village civilians & passing intact car (Shot 1)
    this.villagers = [
      this.createTempHuman(0x475569, 0xd6b092, -2.4, -20, 0),
      this.createTempHuman(0x7c2d12, 0xc89d7c, 2.2, -26, Math.PI),
      this.createTempHuman(0x334155, 0xd9b394, -1.8, -32, 0),
      // Scientists in Wing C Lab (Shots 2-4)
      this.createTempHuman(0xe2e8f0, 0xd6b092, -2.6, -296, -0.4),
      this.createTempHuman(0xf8fafc, 0xc89d7c, 2.5, -298, 0.4),
    ];
    this.villagers[3].speed = 0.32;
    this.villagers[4].speed = 0.25;

    // Clean driving sedan for Normal World shot
    const car = new THREE.Group();
    const carMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4, metalness: 0.5 }));
    const cabMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.25, metalness: 0.8 }));
    const body = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(1.9, 0.72, 4.1)), carMat);
    body.position.y = 0.55;
    const cab = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(1.6, 0.56, 2.1)), cabMat);
    cab.position.set(0, 1.15, -0.15);
    car.add(body, cab);
    car.position.set(1.3, 0, -48);
    this.propGroup.add(car);
    this.passingCar = car;

    // Hero Subject Alpha Containment Cylinder at Wing C center (z = -302) — shadowed silhouette only
    const tube = new THREE.Group();
    tube.position.set(0, 0, -302);
    const capMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 }));
    const baseCap = new THREE.Mesh(this.tGeo(new THREE.CylinderGeometry(1.35, 1.45, 0.45, 14)), capMat);
    baseCap.position.y = 0.22;
    const topCap = new THREE.Mesh(this.tGeo(new THREE.CylinderGeometry(1.35, 1.35, 0.45, 14)), capMat);
    topCap.position.y = 3.95;

    this.heroTubeGlassMat = this.tMat(
      new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: 0x16a34a,
        emissiveIntensity: 0.75,
        transparent: true,
        opacity: 0.42,
        roughness: 0.12,
      })
    );
    const glass = new THREE.Mesh(
      this.tGeo(new THREE.CylinderGeometry(1.18, 1.18, 3.35, 14)),
      this.heroTubeGlassMat
    );
    glass.position.y = 2.08;

    // Shrouded Subject Alpha Silhouette (never reveals King final phase armor/horns)
    const silMat = this.tMat(
      new THREE.MeshStandardMaterial({ color: 0x050908, roughness: 0.9, emissive: 0x021208, emissiveIntensity: 0.35 })
    );
    const silTorso = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(0.9, 1.45, 0.6)), silMat);
    silTorso.position.y = 2.05;
    const silHead = new THREE.Mesh(this.tGeo(new THREE.DodecahedronGeometry(0.32, 0)), silMat);
    silHead.position.y = 2.95;

    this.heroTubeGlowLight = new THREE.PointLight(0x22c55e, 14, 22, 1.5);
    this.heroTubeGlowLight.position.set(0, 2.3, 1.2);

    this.breachRedLight = new THREE.PointLight(0xef4444, 0, 28, 1.4);
    this.breachRedLight.position.set(0, 3.8, -298);

    tube.add(baseCap, topCap, glass, silTorso, silHead, this.heroTubeGlowLight);
    this.propGroup.add(tube, this.breachRedLight);
    this.heroTubeGroup = tube;
  }

  private buildTemporaryStageProps(
    stageIndex: number,
    scene: THREE.Scene,
    callbacks: StoryCinematicCallbacks
  ): void {
    this.propGroup = new THREE.Group();
    scene.add(this.propGroup);
    this.villagers = [];

    if (stageIndex === 0) {
      // Village before outbreak: warm evening glow + strolling civilians
      this.beforeWarmLight = new THREE.HemisphereLight(0xfef08a, 0x3b2f24, 0.88);
      this.propGroup.add(this.beforeWarmLight);
      this.villagers.push(
        this.createTempHuman(0x475569, 0xd6b092, -2.2, -16, 0),
        this.createTempHuman(0x9a3412, 0xc89d7c, 2.0, -24, Math.PI),
        this.createTempHuman(0x3f6212, 0xd9b394, 0.4, -30, 0)
      );
    } else if (stageIndex === 1) {
      // Cursed Forest before outbreak: clean twilight field inspection
      this.beforeWarmLight = new THREE.HemisphereLight(0xbae6fd, 0x1e3a2b, 0.72);
      this.propGroup.add(this.beforeWarmLight);
      this.villagers.push(
        this.createTempHuman(0xf8fafc, 0xd6b092, -1.6, -152, 0),
        this.createTempHuman(0x1e3a8a, 0xc89d7c, 1.9, -162, Math.PI)
      );
    } else if (stageIndex === 2) {
      // Underground Lab before outbreak: bright cyan research shift
      this.beforeWarmLight = new THREE.HemisphereLight(0x67e8f9, 0x0f172a, 0.8);
      this.propGroup.add(this.beforeWarmLight);
      this.villagers.push(
        this.createTempHuman(0xf1f5f9, 0xd6b092, -2.0, -288, -0.35),
        this.createTempHuman(0xf8fafc, 0xc89d7c, 2.2, -296, 0.4)
      );
    } else {
      // Stage 4 Arena before outbreak: cold maintenance pit -> roaring horde tiers
      this.beforeWarmLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.75);
      this.propGroup.add(this.beforeWarmLight);
      callbacks.onSetCrowdState?.('idle');
      this.villagers.push(
        this.createTempHuman(0xf59e0b, 0xd6b092, -2.5, -18, 0.4),
        this.createTempHuman(0xf59e0b, 0xc89d7c, 2.5, -20, -0.4)
      );
    }
  }

  private findCurrentShot(elapsed: number): { shot: OpeningShotConfig; localU: number } {
    let acc = 0;
    for (const shot of OPENING_STORY_SHOTS) {
      const end = acc + shot.durationSec;
      if (elapsed <= end) {
        return { shot, localU: clamp((elapsed - acc) / shot.durationSec, 0, 1) };
      }
      acc = end;
    }
    const last = OPENING_STORY_SHOTS[OPENING_STORY_SHOTS.length - 1];
    return { shot: last, localU: 1 };
  }

  private updateOpening(
    dtSec: number,
    scene: THREE.Scene,
    cameraRig: CameraRig,
    callbacks: StoryCinematicCallbacks
  ): void {
    const t = this.elapsedSec;
    const { shot, localU } = this.findCurrentShot(t);

    if (shot.id === 'normalWorld') {
      scene.background = new THREE.Color(0x1f2b3a);
      scene.fog = new THREE.FogExp2(0x1f2b3a, 0.012);
      if (this.passingCar) {
        this.passingCar.position.z = lerp(-48, -10, localU);
      }
      for (let i = 0; i < 3; i++) {
        this.animateHumanActor(this.villagers[i], dtSec, t, 1.0);
      }
      this.camPos.set(lerp(-2.5, 1.8, localU), 2.35, lerp(-12, -24, localU));
      this.lookAt.set(0, 1.4, -36);
      cameraRig.setCinematicPose(true, this.camPos, this.lookAt, lerp(58, 52, localU), 0);
    } else if (shot.id === 'secretExperiment') {
      scene.background = new THREE.Color(0x061016);
      scene.fog = new THREE.FogExp2(0x061016, 0.022);
      if (this.beforeWarmLight) this.beforeWarmLight.intensity = 0.25;
      for (let i = 3; i < 5; i++) {
        this.animateHumanActor(this.villagers[i], dtSec, t, 0.7);
      }
      const orb = lerp(-0.55, 0.55, localU);
      this.camPos.set(Math.sin(orb) * 4.8, lerp(2.1, 1.85, localU), -302 + Math.cos(orb) * 4.8);
      this.lookAt.set(0, 2.1, -302);
      cameraRig.setCinematicPose(true, this.camPos, this.lookAt, 52, 0);
    } else if (shot.id === 'firstFailure') {
      if (!this.cueFlags.has('open_alarm')) {
        this.cueFlags.add('open_alarm');
        callbacks.onSetFacilityAlarm?.(true);
        callbacks.onPlaySfx?.('facility_alarm');
      }
      const pulse = 0.5 + 0.5 * Math.sin(t * 16);
      if (this.heroTubeGlassMat) {
        this.heroTubeGlassMat.color.setHex(pulse > 0.5 ? 0xef4444 : 0x22c55e);
        this.heroTubeGlassMat.emissive.setHex(pulse > 0.5 ? 0xdc2626 : 0x16a34a);
        this.heroTubeGlassMat.opacity = lerp(0.45, 0.16, localU);
      }
      if (this.heroTubeGlowLight) {
        this.heroTubeGlowLight.color.setHex(0xef4444);
        this.heroTubeGlowLight.intensity = 18 * pulse;
      }
      this.camPos.set(lerp(1.4, 0.4, localU), lerp(1.9, 2.05, localU), lerp(-295, -298.8, localU));
      this.lookAt.set(0, 2.2, -302);
      cameraRig.setCinematicPose(true, this.camPos, this.lookAt, lerp(52, 62, localU), 0.045);
    } else if (shot.id === 'outbreakBegins') {
      if (!this.cueFlags.has('open_roar')) {
        this.cueFlags.add('open_roar');
        callbacks.onPlaySfx?.('boss_roar');
        scene.background = new THREE.Color(0x160406);
        scene.fog = new THREE.FogExp2(0x160406, 0.032);
      }
      if (this.breachRedLight) {
        this.breachRedLight.intensity = 22 + 12 * Math.sin(t * 14);
      }
      for (let i = 3; i < 5; i++) {
        this.villagers[i].dirZ = 1;
        this.animateHumanActor(this.villagers[i], dtSec, t, 2.8);
      }
      this.camPos.set(lerp(-1.2, -2.8, localU), lerp(1.65, 2.2, localU), lerp(-294, -285, localU));
      this.lookAt.set(0, 2.0, -302);
      cameraRig.setCinematicPose(true, this.camPos, this.lookAt, 64, 0.055);
    } else if (shot.id === 'worldChanging') {
      if (!this.cueFlags.has('open_siren')) {
        this.cueFlags.add('open_siren');
        callbacks.onSetFacilityAlarm?.(false);
        callbacks.onPlaySfx?.('distant_siren');
        for (const v of this.villagers) v.group.visible = false;
        if (this.passingCar) this.passingCar.visible = false;
      }
      scene.background = new THREE.Color(0x0c080a);
      scene.fog = new THREE.FogExp2(0x0c080a, 0.028);
      this.camPos.set(lerp(2.4, -2.0, localU), lerp(3.4, 2.1, localU), lerp(-22, -46, localU));
      this.lookAt.set(0, 1.5, -72);
      cameraRig.setCinematicPose(true, this.camPos, this.lookAt, 58, 0.01);
    } else {
      // Title reveal rising shot over quarantine gate
      this.camPos.set(0, lerp(2.2, 6.2, localU), lerp(-60, -68, localU));
      this.lookAt.set(0, 1.8, -88);
      cameraRig.setCinematicPose(true, this.camPos, this.lookAt, 56, 0);
    }

    cameraRig.update(dtSec);

    const fadeOut =
      this.elapsedSec >= this.totalDurationSec - 0.65
        ? clamp((this.elapsedSec - (this.totalDurationSec - 0.65)) / 0.65, 0, 1)
        : this.elapsedSec < 0.45
        ? 1 - clamp(this.elapsedSec / 0.45, 0, 1)
        : 0;

    callbacks.onFrame({
      eyebrow: shot.eyebrow,
      title: shot.title,
      subtitleText: shot.subtitleText,
      showStageCard: shot.showTitleCard,
      canSkip: this.canSkip(),
      fadeAlpha: fadeOut,
    });

    if (this.elapsedSec >= this.totalDurationSec) {
      this.cleanup(scene, cameraRig, callbacks);
      callbacks.onEnd('opening');
    }
  }

  private updateStageIntro(
    dtSec: number,
    intro: StagePreInvasionConfig,
    scene: THREE.Scene,
    cameraRig: CameraRig,
    callbacks: StoryCinematicCallbacks
  ): void {
    const p = clamp(this.elapsedSec / intro.durationSec, 0, 1);
    const isAfter = p >= intro.transitionPoint;
    const showCard = p >= intro.cardStartPoint;

    if (isAfter && !this.cueFlags.has('stage_shift')) {
      this.cueFlags.add('stage_shift');
      for (const v of this.villagers) {
        v.group.visible = false;
      }
      if (this.beforeWarmLight) {
        this.beforeWarmLight.intensity = 0;
      }
      if (this.stageIndex === 0) {
        callbacks.onPlaySfx?.('distant_siren');
        scene.background = new THREE.Color(0x0a0d11);
        scene.fog = new THREE.FogExp2(0x0a0d11, 0.028);
      } else if (this.stageIndex === 1) {
        callbacks.onPlaySfx?.('boss_roar');
        scene.background = new THREE.Color(0x080c0d);
        scene.fog = new THREE.FogExp2(0x080c0d, 0.032);
      } else if (this.stageIndex === 2) {
        callbacks.onPlaySfx?.('facility_alarm');
        callbacks.onSetFacilityAlarm?.(true);
        scene.background = new THREE.Color(0x0e0608);
        scene.fog = new THREE.FogExp2(0x0e0608, 0.028);
      } else {
        callbacks.onSetCrowdState?.('cheering');
        callbacks.onPlaySfx?.('arena_crowd_cheer');
        scene.background = new THREE.Color(0x0c0507);
        scene.fog = new THREE.FogExp2(0x0c0507, 0.022);
      }
    }

    if (!isAfter) {
      if (this.stageIndex === 0) {
        scene.background = new THREE.Color(0x1f2937);
        scene.fog = new THREE.FogExp2(0x1f2937, 0.013);
      } else if (this.stageIndex === 1) {
        scene.background = new THREE.Color(0x122229);
        scene.fog = new THREE.FogExp2(0x122229, 0.015);
      } else if (this.stageIndex === 2) {
        scene.background = new THREE.Color(0x0a1c26);
        scene.fog = new THREE.FogExp2(0x0a1c26, 0.014);
      } else {
        scene.background = new THREE.Color(0x141d26);
        scene.fog = new THREE.FogExp2(0x141d26, 0.014);
      }
      for (const v of this.villagers) {
        this.animateHumanActor(v, dtSec, this.elapsedSec, 0.9);
      }
    }

    // Smooth camera sweep tailored per stage location
    if (this.stageIndex === 0) {
      this.camPos.set(lerp(-2.5, 0, p), lerp(3.1, 1.85, p), lerp(-8, -32, p));
      this.lookAt.set(0, 1.6, -54);
    } else if (this.stageIndex === 1) {
      this.camPos.set(lerp(2.4, 0, p), lerp(3.4, 1.9, p), lerp(-132, -162, p));
      this.lookAt.set(0, 1.5, -182);
    } else if (this.stageIndex === 2) {
      this.camPos.set(lerp(-2.0, 0, p), lerp(2.5, 1.8, p), lerp(-276, -304, p));
      this.lookAt.set(0, 1.8, -324);
    } else {
      const ang = lerp(-0.55, 0.12, p);
      this.camPos.set(Math.sin(ang) * 9, lerp(5.8, 2.2, p), -22 + Math.cos(ang) * 14);
      this.lookAt.set(0, 2.4, -22);
    }

    cameraRig.setCinematicPose(true, this.camPos, this.lookAt, lerp(54, 60, p), 0);
    cameraRig.update(dtSec);

    const flashDip =
      Math.abs(p - intro.transitionPoint) < 0.045
        ? clamp(1 - Math.abs(p - intro.transitionPoint) / 0.045, 0, 1) * 0.72
        : 0;
    const endFade = p > 0.93 ? clamp((p - 0.93) / 0.07, 0, 1) : 0;

    callbacks.onFrame({
      eyebrow: `STAGE ${intro.stageNumber}`,
      title: intro.stageName,
      subtitleText: isAfter ? intro.afterSubtitle : intro.beforeSubtitle,
      description: intro.quote,
      objective: intro.objective,
      showStageCard: showCard,
      canSkip: this.canSkip(),
      fadeAlpha: Math.max(flashDip, endFade),
    });

    if (this.elapsedSec >= intro.durationSec) {
      this.cleanup(scene, cameraRig, callbacks);
      callbacks.onEnd('stage_intro');
    }
  }

  private cleanup(
    scene: THREE.Scene,
    cameraRig?: CameraRig,
    callbacks?: StoryCinematicCallbacks
  ): void {
    this.activeKind = null;
    this.villagers = [];
    this.passingCar = null;
    this.heroTubeGroup = null;
    this.heroTubeGlassMat = null;
    this.heroTubeGlowLight = null;
    this.breachRedLight = null;
    this.beforeWarmLight = null;

    if (this.propGroup) {
      scene.remove(this.propGroup);
      this.propGroup = null;
    }
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos.length = 0;
    this.mats.length = 0;

    this.restoreSceneAtmosphere(scene);
    callbacks?.onSetFacilityAlarm?.(false);
    callbacks?.onSetExposure?.(1.15);
    cameraRig?.setCinematicPose(false);
  }
}
