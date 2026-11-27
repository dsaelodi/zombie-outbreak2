import * as THREE from 'three';
import { clamp, lerp } from '../../utils/math';
import type { CameraRig } from '../CameraRig';
import type { Zombie } from '../entities/Zombie';
import type { EffectsSystem } from './EffectsSystem';

export type Stage4CinematicMode =
  | 'none'
  | 'boss_intro'
  | 'phase1_to_phase2'
  | 'boss_final_death';

export interface Stage4CinematicFramePayload {
  mode: Exclude<Stage4CinematicMode, 'none'>;
  eyebrow: string;
  shotLabel: string;
  subtitle: string;
  canSkip: boolean;
  fadeAlpha: number;
  revealTitle?: string;
  revealSubtitle?: string;
}

export interface Stage4CinematicCallbacks {
  onFrameUI: (payload: Stage4CinematicFramePayload) => void;
  onRoyalCommand?: () => void;
  onKingRoar?: () => void;
  onBossHitImpact?: () => void;
  onImpactThud?: () => void;
  onSilenceHush?: () => void;
  onKingBreathing?: () => void;
  onResurrectionTwitch?: () => void;
  onMutationMorph?: () => void;
  onPhase2Reveal?: () => void;
  onRoarFade?: () => void;
  onVictoryCue?: () => void;
  onComplete: (mode: Exclude<Stage4CinematicMode, 'none'>) => void;
}

/**
 * Unified Stage 4 Cinematic Controller managing all three Stage 4 sequences:
 * 1) 'boss_intro': 4-shot Arena & The King introduction (~7.2s)
 * 2) 'phase1_to_phase2': 6-shot sequential Hit -> Fall -> Silence -> Ground Transform -> Push-up Rise -> Phase 2 Reveal (~15.6s)
 * 3) 'boss_final_death': 5-shot Phase 2 defeat & fade to Arena Exit Walk (~9.5s)
 */
export class Stage4CinematicController {
  public readonly introDurationSec = 7.2;
  public readonly phase1To2DurationSec = 15.6;
  public readonly finalDeathDurationSec = 9.5;
  public readonly skipUnlockSec = 1.5;

  private mode: Stage4CinematicMode = 'none';
  private elapsedSec = 0;
  private targetBoss: Zombie | null = null;

  private shakeTimer = 0;
  private commandFired = false;
  private roarFired = false;
  private hitImpactFired = false;
  private impactThudFired = false;
  private silenceFired = false;
  private breathingFired = false;
  private twitchFired = false;
  private morphFired = false;
  private revealFired = false;
  private victoryCueFired = false;

  private readonly bossAnchor = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();

  private dustPoints: THREE.Points | null = null;
  private dustVelocities: Float32Array | null = null;

  public isActive(): boolean {
    return this.mode !== 'none';
  }

  public getMode(): Stage4CinematicMode {
    return this.mode;
  }

  public canSkip(): boolean {
    return this.mode !== 'none' && this.elapsedSec >= this.skipUnlockSec;
  }

  public reset(cameraRig?: CameraRig, scene?: THREE.Scene): void {
    this.mode = 'none';
    this.elapsedSec = 0;
    this.targetBoss = null;
    this.shakeTimer = 0;
    this.commandFired = false;
    this.roarFired = false;
    this.hitImpactFired = false;
    this.impactThudFired = false;
    this.silenceFired = false;
    this.breathingFired = false;
    this.twitchFired = false;
    this.morphFired = false;
    this.revealFired = false;
    this.victoryCueFired = false;

    if (cameraRig) {
      cameraRig.setCinematicPose(false);
    }
    if (scene && this.dustPoints) {
      scene.remove(this.dustPoints);
      this.dustPoints.geometry.dispose();
      (this.dustPoints.material as THREE.Material).dispose();
      this.dustPoints = null;
      this.dustVelocities = null;
    } else if (this.dustPoints) {
      this.dustPoints.parent?.remove(this.dustPoints);
      this.dustPoints.geometry.dispose();
      (this.dustPoints.material as THREE.Material).dispose();
      this.dustPoints = null;
      this.dustVelocities = null;
    }
  }

  public startBossIntro(boss: Zombie, callbacks: Stage4CinematicCallbacks): void {
    if (this.mode !== 'none') return;
    this.mode = 'boss_intro';
    this.elapsedSec = 0;
    this.targetBoss = boss;
    this.commandFired = false;
    this.roarFired = false;
    this.shakeTimer = 0;

    boss.cinematicControlled = true;
    boss.setWeaknessVisible(false);
    boss.root.position.set(0, 0, -27);
    boss.root.rotation.y = -1.15;
    boss.setStage4IntroPose(0, 0);

    callbacks.onFrameUI({
      mode: 'boss_intro',
      eyebrow: 'Stage 4 · Subterranean Colosseum',
      shotLabel: 'THE ARENA OF THE DEAD',
      subtitle: 'Subject Alpha Territory',
      canSkip: false,
      fadeAlpha: 0,
    });
  }

  public startPhase1ToPhase2(
    boss: Zombie,
    scene: THREE.Scene,
    effectsSystem: EffectsSystem,
    callbacks: Stage4CinematicCallbacks
  ): void {
    if (this.mode !== 'none') return;
    this.mode = 'phase1_to_phase2';
    this.elapsedSec = 0;
    this.targetBoss = boss;
    this.shakeTimer = 0.42;
    this.hitImpactFired = false;
    this.impactThudFired = false;
    this.silenceFired = false;
    this.breathingFired = false;
    this.twitchFired = false;
    this.morphFired = false;
    this.revealFired = false;

    boss.cinematicControlled = true;
    boss.setWeaknessVisible(false);
    boss.setBossLifecycleState('PHASE_1_DEATH_ANIMATION');

    this.bossAnchor.copy(boss.root.position);
    this.bossAnchor.x = clamp(this.bossAnchor.x, -9.8, 9.8);
    this.bossAnchor.z = clamp(this.bossAnchor.z, -28.5, -9.0);
    boss.root.position.copy(this.bossAnchor);
    boss.root.position.y = 0;

    this.spawnDustCloud(scene, 0xb8a89d);
    this.hitImpactFired = true;
    effectsSystem.spawnExplosion(scene, this.bossAnchor, 3.8);
    callbacks.onBossHitImpact?.();

    callbacks.onFrameUI({
      mode: 'phase1_to_phase2',
      eyebrow: 'Phase 1 Broken',
      shotLabel: 'FINAL BLOW',
      subtitle: 'Subject Alpha staggers under heavy fire...',
      canSkip: false,
      fadeAlpha: 0,
    });
  }

  public startFinalDeath(
    boss: Zombie,
    scene: THREE.Scene,
    callbacks: Stage4CinematicCallbacks
  ): void {
    if (this.mode !== 'none') return;
    this.mode = 'boss_final_death';
    this.elapsedSec = 0;
    this.targetBoss = boss;
    this.shakeTimer = 0.35;
    this.impactThudFired = false;
    this.victoryCueFired = false;

    boss.cinematicControlled = true;
    boss.state = 'dead';
    boss.setWeaknessVisible(false);
    boss.setBossLifecycleState('BOSS_DEATH_CINEMATIC');
    boss.transitionBossState('VICTORY_CINEMATIC');

    this.bossAnchor.copy(boss.root.position);
    this.bossAnchor.x = clamp(this.bossAnchor.x, -10.2, 10.2);
    this.bossAnchor.z = clamp(this.bossAnchor.z, -29.0, -8.5);
    boss.root.position.copy(this.bossAnchor);
    boss.root.position.y = 0;

    this.spawnDustCloud(scene, 0xb8a89d);
    callbacks.onRoarFade?.();

    callbacks.onFrameUI({
      mode: 'boss_final_death',
      eyebrow: 'Campaign Finale',
      shotLabel: 'NIGHTMARE BREACHED',
      subtitle: 'Phase 2 containment core failing...',
      canSkip: false,
      fadeAlpha: 0,
    });
  }

  private spawnDustCloud(scene: THREE.Scene, colorHex: number): void {
    if (this.dustPoints) {
      scene.remove(this.dustPoints);
      this.dustPoints.geometry.dispose();
      (this.dustPoints.material as THREE.Material).dispose();
      this.dustPoints = null;
      this.dustVelocities = null;
    }

    const count = 85;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 5.2;
      positions[i * 3] = this.bossAnchor.x + Math.cos(ang) * r;
      positions[i * 3 + 1] = 0.18 + Math.random() * 2.1;
      positions[i * 3 + 2] = this.bossAnchor.z + Math.sin(ang) * r;

      velocities[i * 3] = (Math.random() - 0.5) * 0.45;
      velocities[i * 3 + 1] = 0.24 + Math.random() * 0.62;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.45;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: colorHex,
      size: 0.24,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    this.dustPoints = pts;
    this.dustVelocities = velocities;
  }

  private clampCameraSafe(pos: THREE.Vector3, minBossDist: number): void {
    pos.y = Math.max(0.45, Math.min(9.5, pos.y));
    const relX = pos.x;
    const relZ = pos.z + 22;
    const arenaR = Math.hypot(relX, relZ);
    if (arenaR > 16.2) {
      const scale = 16.2 / arenaR;
      pos.x = relX * scale;
      pos.z = relZ * scale - 22;
    }
    pos.z = clamp(pos.z, -37.5, 1.5);

    const dx = pos.x - this.bossAnchor.x;
    const dz = pos.z - this.bossAnchor.z;
    const horizontalDist = Math.hypot(dx, dz);
    if (horizontalDist < minBossDist) {
      if (horizontalDist < 0.01) {
        pos.z = this.bossAnchor.z + minBossDist;
      } else {
        pos.x = this.bossAnchor.x + (dx / horizontalDist) * minBossDist;
        pos.z = this.bossAnchor.z + (dz / horizontalDist) * minBossDist;
      }
    }
  }

  public update(
    dtSec: number,
    cameraRig: CameraRig,
    scene: THREE.Scene,
    effectsSystem: EffectsSystem,
    callbacks: Stage4CinematicCallbacks
  ): void {
    if (this.mode === 'none' || !this.targetBoss) return;
    this.elapsedSec += dtSec;

    if (this.dustPoints && this.dustVelocities) {
      const attr = this.dustPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] += this.dustVelocities[i] * dtSec;
        arr[i + 1] += this.dustVelocities[i + 1] * dtSec;
        arr[i + 2] += this.dustVelocities[i + 2] * dtSec;
        if (arr[i + 1] > 4.6) arr[i + 1] = 0.15;
      }
      attr.needsUpdate = true;
    }

    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dtSec);
    }

    if (this.mode === 'boss_intro') {
      this.updateBossIntro(cameraRig, scene, callbacks);
    } else if (this.mode === 'phase1_to_phase2') {
      this.updatePhase1ToPhase2(cameraRig, scene, effectsSystem, callbacks);
    } else if (this.mode === 'boss_final_death') {
      this.updateFinalDeath(cameraRig, scene, effectsSystem, callbacks);
    }
  }

  private updateBossIntro(
    cameraRig: CameraRig,
    scene: THREE.Scene,
    callbacks: Stage4CinematicCallbacks
  ): void {
    const boss = this.targetBoss!;
    const t = this.elapsedSec;
    const bx = boss.root.position.x;
    const bz = boss.root.position.z;

    let fov = 58;
    let eyebrow = 'Stage 4 · Subterranean Colosseum';
    let shotLabel = 'THE ARENA OF THE DEAD';
    let subtitle = 'Over a thousand infected pack the stands';
    let shake = 0;

    if (t < 1.8) {
      // Shot 1: Wide Arena Establishing Sweep
      const u = t / 1.8;
      shotLabel = 'THE ARENA OF THE DEAD';
      subtitle = 'Subject Alpha Territory';
      fov = lerp(64, 58, u);
      this.camPos.set(lerp(-6.2, 4.8, u), lerp(7.8, 5.8, u), lerp(-3.0, -8.5, u));
      this.lookAt.set(0, 2.7, -24);
      boss.setStage4IntroPose(0, 0);
    } else if (t < 3.6) {
      // Shot 2: Low-Angle Push on The King
      const u = (t - 1.8) / 1.8;
      shotLabel = 'SUBJECT ALPHA — THE KING';
      subtitle = 'Original Form · Crown Strain-X';
      fov = lerp(48, 42, u);
      boss.setStage4IntroPose(u * 0.45, 0);
      this.camPos.set(bx + lerp(-2.6, 1.4, u), lerp(1.15, 1.9, u), bz + lerp(8.0, 6.4, u));
      this.lookAt.set(bx, lerp(1.8, 3.2, u), bz);
    } else if (t < 5.3) {
      // Shot 3: Crowd Cheering + King Turns Slowly & Raises Arm
      const u = (t - 3.6) / 1.7;
      if (!this.commandFired) {
        this.commandFired = true;
        callbacks.onRoyalCommand?.();
      }
      boss.setStage4IntroPose(0.45 + u * 0.55, u);
      eyebrow = 'The Horde Screams';
      shotLabel = 'ROYAL COMMAND';
      subtitle = 'The arena erupts at his command';
      fov = lerp(54, 48, u);
      const ang = lerp(-0.5, 0.45, u);
      this.camPos.set(bx + Math.sin(ang) * 8.4, 2.2, bz + Math.cos(ang) * 7.8);
      this.lookAt.set(bx, 3.0, bz);
    } else {
      // Shot 4: Face Reveal & Smooth Blend Back Into FPS Combat View
      const u = clamp((t - 5.3) / (this.introDurationSec - 5.3), 0, 1);
      if (!this.roarFired && u > 0.08) {
        this.roarFired = true;
        callbacks.onKingRoar?.();
      }
      if (u < 0.48) {
        const faceU = u / 0.48;
        boss.setStage4IntroPose(1, 1 - faceU * 0.35);
        eyebrow = 'Phase 1 Encounter';
        shotLabel = 'THE KING';
        subtitle = 'Survive Phase 1 — Aim for the Bio-Core';
        fov = lerp(42, 46, faceU);
        shake = 0.14;
        this.camPos.set(bx + lerp(1.8, 0.8, faceU), lerp(2.5, 2.9, faceU), bz + lerp(5.4, 4.8, faceU));
        this.lookAt.set(bx, 3.35, bz);
      } else {
        const blendU = (u - 0.48) / 0.52;
        const ease = blendU * blendU * (3 - 2 * blendU);
        boss.setStage4IntroPose(1, lerp(0.65, 0, ease));
        eyebrow = 'Phase 1 Encounter';
        shotLabel = 'THE KING';
        subtitle = 'Engage at will';
        fov = lerp(46, 62, ease);
        this.camPos.set(lerp(bx + 0.8, 0, ease), lerp(2.9, 1.68, ease), lerp(bz + 4.8, -2.0, ease));
        this.lookAt.set(0, lerp(3.35, 1.85, ease), bz);
      }
    }

    cameraRig.setCinematicPose(true, this.camPos, this.lookAt, fov, shake);
    callbacks.onFrameUI({
      mode: 'boss_intro',
      eyebrow,
      shotLabel,
      subtitle,
      canSkip: this.canSkip(),
      fadeAlpha: 0,
    });

    if (this.elapsedSec >= this.introDurationSec) {
      this.finish(cameraRig, scene, callbacks.onComplete);
    }
  }

  private updatePhase1ToPhase2(
    cameraRig: CameraRig,
    scene: THREE.Scene,
    effectsSystem: EffectsSystem,
    callbacks: Stage4CinematicCallbacks
  ): void {
    const boss = this.targetBoss!;
    const t = this.elapsedSec;
    const yaw = boss.root.rotation.y;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    let fov = 56;
    let eyebrow = 'Phase 1 → Phase 2 Transition';
    let shotLabel = 'FINAL BLOW';
    let subtitle = '';
    let revealTitle: string | undefined;
    let revealSubtitle: string | undefined;

    if (t < 1.4) {
      // Shot 1: Final Hit Reaction
      const u = t / 1.4;
      boss.setPhase1HitReactionPose(u);
      shotLabel = 'FINAL BLOW';
      subtitle = 'Phase 1 armor shattered!';
      fov = lerp(56, 48, u);
      this.camPos.set(
        this.bossAnchor.x + fwdX * lerp(6.8, 5.4, u) + rightX * 1.2,
        lerp(1.45, 1.35, u),
        this.bossAnchor.z + fwdZ * lerp(6.8, 5.4, u) + rightZ * 1.2
      );
      this.lookAt.set(this.bossAnchor.x, 2.0, this.bossAnchor.z);
      this.clampCameraSafe(this.camPos, 3.4);
    } else if (t < 4.8) {
      // Shot 2: The Fall — Boss collapses heavily onto the arena floor
      const u = (t - 1.4) / 3.4;
      boss.setPhase1FallPose(u);

      if (!this.impactThudFired && u >= 0.69) {
        this.impactThudFired = true;
        this.shakeTimer = 0.62;
        effectsSystem.spawnBossLandingDebris(scene, this.bossAnchor, 5.2);
        callbacks.onImpactThud?.();
      }

      eyebrow = 'Subject Alpha Down';
      shotLabel = 'THE FALL';
      subtitle = u > 0.72 ? 'The King crashes onto the arena floor' : 'System failure across cranial core...';
      fov = lerp(50, 56, u);
      const orbit = lerp(0.55, 1.35, u);
      const rad = lerp(5.4, 4.7, u);
      this.camPos.set(
        this.bossAnchor.x + Math.sin(yaw + orbit) * rad,
        lerp(1.85, 0.85, u),
        this.bossAnchor.z + Math.cos(yaw + orbit) * rad
      );
      this.lookAt.set(this.bossAnchor.x, lerp(1.75, 0.52, u), this.bossAnchor.z);
      this.clampCameraSafe(this.camPos, 3.0);
    } else if (t < 6.6) {
      // Shot 3: The Silence — Crowd freezes, music cuts, camera closes in on fallen corpse
      const u = (t - 4.8) / 1.8;
      if (!this.silenceFired) {
        this.silenceFired = true;
        callbacks.onSilenceHush?.();
      }
      if (!this.breathingFired && u >= 0.45) {
        this.breathingFired = true;
        callbacks.onKingBreathing?.();
      }
      boss.setPhase1FallPose(1);
      eyebrow = 'Arena Silence';
      shotLabel = 'STILLNESS';
      subtitle = 'Something is still breathing beneath the floor...';
      fov = lerp(52, 41, u);
      this.camPos.set(
        this.bossAnchor.x + fwdX * lerp(4.8, 3.6, u) - rightX * 1.15,
        lerp(0.88, 0.68, u),
        this.bossAnchor.z + fwdZ * lerp(4.8, 3.6, u) - rightZ * 1.15
      );
      this.lookAt.set(this.bossAnchor.x, 0.45, this.bossAnchor.z);
      this.clampCameraSafe(this.camPos, 2.7);
    } else if (t < 9.8) {
      // Shot 4: Ground Transformation — Boss stays lying on floor while violently mutating
      const u = (t - 6.6) / 3.2;
      if (!this.twitchFired) {
        this.twitchFired = true;
        boss.setBossLifecycleState('PHASE_2_TRANSFORMATION');
        this.shakeTimer = 0.35;
        callbacks.onResurrectionTwitch?.();
      }
      if (!this.morphFired && u >= 0.25) {
        this.morphFired = true;
        this.shakeTimer = 1.1;
        effectsSystem.spawnExplosion(scene, this.bossAnchor, 4.6);
        effectsSystem.spawnBossLandingDebris(scene, this.bossAnchor, 4.8);
        callbacks.onMutationMorph?.();
      }
      boss.setPhase2GroundTransformPose(u);
      eyebrow = 'Bio-Mutation Surge';
      shotLabel = 'AWAKENING ON THE FLOOR';
      subtitle = 'Chitin plates and tendrils erupt from the fallen body!';
      fov = lerp(42, 54, u);
      const orbit = lerp(-0.35, 0.42, u);
      const rad = lerp(3.7, 5.2, u);
      this.camPos.set(
        this.bossAnchor.x + Math.sin(yaw + orbit) * rad,
        lerp(0.75, 1.35, u),
        this.bossAnchor.z + Math.cos(yaw + orbit) * rad
      );
      this.lookAt.set(this.bossAnchor.x, lerp(0.5, 0.95, u), this.bossAnchor.z);
      this.clampCameraSafe(this.camPos, 2.9);
    } else if (t < 13.0) {
      // Shot 5: Rising Into Phase 2 — Hands brace floor and towering body pushes upright
      const u = (t - 9.8) / 3.2;
      if (boss.bossPhaseState !== 'PHASE_2_RISING') {
        boss.setBossLifecycleState('PHASE_2_RISING');
        this.shakeTimer = 0.85;
      }
      boss.setPhase2RisingPose(u);
      eyebrow = 'Phase 2 Ascending';
      shotLabel = 'HE RISES';
      subtitle = 'The King forces himself up — larger, faster, deadlier';
      fov = lerp(52, 58, u);
      const orbit = lerp(0.42, -0.15, u);
      const rad = lerp(5.2, 6.8, u);
      this.camPos.set(
        this.bossAnchor.x + Math.sin(yaw + orbit) * rad,
        lerp(1.2, 1.45, u),
        this.bossAnchor.z + Math.cos(yaw + orbit) * rad
      );
      this.lookAt.set(this.bossAnchor.x, lerp(1.1, 2.55, u), this.bossAnchor.z);
      this.clampCameraSafe(this.camPos, 3.6);
    } else {
      // Shot 6: Phase 2 Towering Orbit Reveal + Title + Smooth Blend to Chase Stance
      const u = clamp((t - 13.0) / (this.phase1To2DurationSec - 13.0), 0, 1);
      if (!this.revealFired) {
        this.revealFired = true;
        this.shakeTimer = 0.95;
        callbacks.onPhase2Reveal?.();
      }
      boss.setPhase2RevealPose(u);
      eyebrow = 'Phase 2 · Maximum Threat';
      shotLabel = 'THE KING — AWAKENED';
      subtitle = 'Pursuit initiated — Keep moving and aim for the chest core!';
      revealTitle = 'THE KING';
      revealSubtitle = 'PHASE 2 — AWAKENED';

      if (u < 0.65) {
        const revU = u / 0.65;
        fov = lerp(56, 62, revU);
        const orbit = lerp(-0.15, 0.38, revU);
        const rad = lerp(6.8, 8.2, revU);
        this.camPos.set(
          this.bossAnchor.x + Math.sin(yaw + orbit) * rad,
          lerp(1.4, 1.75, revU),
          this.bossAnchor.z + Math.cos(yaw + orbit) * rad
        );
        this.lookAt.set(this.bossAnchor.x, 2.75, this.bossAnchor.z);
        this.clampCameraSafe(this.camPos, 4.0);
      } else {
        const blendU = (u - 0.65) / 0.35;
        const ease = blendU * blendU * (3 - 2 * blendU);
        fov = lerp(62, 65, ease);
        const startPosX = this.bossAnchor.x + Math.sin(yaw + 0.38) * 8.2;
        const startPosZ = this.bossAnchor.z + Math.cos(yaw + 0.38) * 8.2;
        this.camPos.set(lerp(startPosX, 0, ease), lerp(1.75, 1.68, ease), lerp(startPosZ, -7.2, ease));
        this.lookAt.set(this.bossAnchor.x, lerp(2.75, 2.1, ease), this.bossAnchor.z);
      }
    }

    const shakeAmt = this.shakeTimer > 0 ? this.shakeTimer * 0.32 : 0;
    cameraRig.setCinematicPose(true, this.camPos, this.lookAt, fov, shakeAmt);
    callbacks.onFrameUI({
      mode: 'phase1_to_phase2',
      eyebrow,
      shotLabel,
      subtitle,
      canSkip: this.canSkip(),
      fadeAlpha: 0,
      revealTitle,
      revealSubtitle,
    });

    if (this.elapsedSec >= this.phase1To2DurationSec) {
      this.finish(cameraRig, scene, callbacks.onComplete);
    }
  }

  private updateFinalDeath(
    cameraRig: CameraRig,
    scene: THREE.Scene,
    effectsSystem: EffectsSystem,
    callbacks: Stage4CinematicCallbacks
  ): void {
    const p = clamp(this.elapsedSec / this.finalDeathDurationSec, 0, 1);
    this.targetBoss!.setCinematicDeathProgress(p);

    if (!this.impactThudFired && this.elapsedSec >= 6.45) {
      this.impactThudFired = true;
      this.shakeTimer = 0.56;
      effectsSystem.spawnExplosion(scene, this.bossAnchor, 4.4);
      effectsSystem.spawnBossLandingDebris(scene, this.bossAnchor, 5.8);
      callbacks.onImpactThud?.();
    }

    if (!this.victoryCueFired && this.elapsedSec >= 7.1) {
      this.victoryCueFired = true;
      callbacks.onVictoryCue?.();
    }

    const yaw = this.targetBoss!.root.rotation.y;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);

    let fov = 56;
    let shotLabel = 'NIGHTMARE BREACHED';
    let subtitle = 'Phase 2 bio-core destabilizing';

    if (this.elapsedSec < 1.9) {
      const t = this.elapsedSec / 1.9;
      shotLabel = 'NIGHTMARE BREACHED';
      subtitle = 'Phase 2 bio-core rupturing';
      fov = lerp(58, 54, t);
      this.camPos.set(
        this.bossAnchor.x + fwdX * lerp(7.4, 6.4, t) + rightX * 1.1,
        lerp(1.3, 1.55, t),
        this.bossAnchor.z + fwdZ * lerp(7.4, 6.4, t) + rightZ * 1.1
      );
      this.lookAt.set(this.bossAnchor.x, 2.35, this.bossAnchor.z);
      this.clampCameraSafe(this.camPos, 3.8);
    } else if (this.elapsedSec < 3.7) {
      const t = (this.elapsedSec - 1.9) / 1.8;
      shotLabel = 'CARAPACE COLLAPSE';
      subtitle = 'Mutated spine shattering under pressure';
      fov = 52;
      const orbitAngle = lerp(0.85, 1.75, t);
      const radius = lerp(5.9, 5.1, t);
      this.camPos.set(
        this.bossAnchor.x + Math.sin(yaw + orbitAngle) * radius,
        lerp(1.9, 1.5, t),
        this.bossAnchor.z + Math.cos(yaw + orbitAngle) * radius
      );
      this.lookAt.set(this.bossAnchor.x, lerp(2.05, 1.65, t), this.bossAnchor.z);
      this.clampCameraSafe(this.camPos, 3.4);
    } else if (this.elapsedSec < 5.4) {
      const t = (this.elapsedSec - 3.7) / 1.7;
      shotLabel = 'BIO-CORE CRITICAL';
      subtitle = 'Subject Alpha collapses to his knees';
      fov = lerp(42, 38, t);
      this.camPos.set(
        this.bossAnchor.x + fwdX * 3.8 - rightX * lerp(0.95, 0.55, t),
        lerp(2.5, 2.1, t),
        this.bossAnchor.z + fwdZ * 3.8 - rightZ * lerp(0.95, 0.55, t)
      );
      this.lookAt.set(
        this.bossAnchor.x + fwdX * 0.2,
        lerp(2.4, 1.95, t),
        this.bossAnchor.z + fwdZ * 0.2
      );
      this.clampCameraSafe(this.camPos, 2.8);
    } else if (this.elapsedSec < 7.4) {
      const t = (this.elapsedSec - 5.4) / 2.0;
      shotLabel = 'FINAL IMPACT';
      subtitle = 'The King falls for the last time';
      fov = lerp(55, 62, t);
      this.camPos.set(
        this.bossAnchor.x + fwdX * 4.9 + rightX * lerp(-1.8, -2.4, t),
        0.65,
        this.bossAnchor.z + fwdZ * 4.9 + rightZ * lerp(-1.8, -2.4, t)
      );
      this.lookAt.set(
        this.bossAnchor.x + fwdX * 0.6,
        lerp(1.6, 0.55, clamp(t * 1.4, 0, 1)),
        this.bossAnchor.z + fwdZ * 0.6
      );
      this.clampCameraSafe(this.camPos, 3.2);
    } else {
      const t = clamp((this.elapsedSec - 7.4) / (this.finalDeathDurationSec - 7.4), 0, 1);
      shotLabel = 'THREAT NEUTRALIZED';
      subtitle = 'The Arena exit gate unlocks';
      fov = lerp(58, 66, t);
      this.camPos.set(
        this.bossAnchor.x + fwdX * lerp(5.9, 9.2, t) + rightX * lerp(1.6, 3.0, t),
        lerp(1.9, 3.9, t),
        this.bossAnchor.z + fwdZ * lerp(5.9, 9.2, t) + rightZ * lerp(1.6, 3.0, t)
      );
      this.lookAt.set(this.bossAnchor.x, 0.65, this.bossAnchor.z);
      this.clampCameraSafe(this.camPos, 3.8);
    }

    const shakeAmt = this.shakeTimer > 0 ? this.shakeTimer * 0.34 : 0;
    cameraRig.setCinematicPose(true, this.camPos, this.lookAt, fov, shakeAmt);

    const fadeAlpha =
      this.elapsedSec >= this.finalDeathDurationSec - 0.9
        ? clamp((this.elapsedSec - (this.finalDeathDurationSec - 0.9)) / 0.9, 0, 1)
        : 0;

    callbacks.onFrameUI({
      mode: 'boss_final_death',
      eyebrow: 'Campaign Finale',
      shotLabel,
      subtitle,
      canSkip: this.canSkip(),
      fadeAlpha,
    });

    if (this.elapsedSec >= this.finalDeathDurationSec) {
      this.finish(cameraRig, scene, callbacks.onComplete);
    }
  }

  public skip(
    cameraRig: CameraRig,
    scene: THREE.Scene,
    onComplete: (mode: Exclude<Stage4CinematicMode, 'none'>) => void
  ): void {
    if (!this.canSkip()) return;
    if (this.targetBoss) {
      if (this.mode === 'boss_intro') {
        this.targetBoss.cinematicControlled = false;
        this.targetBoss.setStage4IntroPose(1, 0);
      } else if (this.mode === 'phase1_to_phase2') {
        this.targetBoss.activatePhase2Combat();
      } else if (this.mode === 'boss_final_death') {
        this.targetBoss.setCinematicDeathProgress(1);
      }
    }
    this.finish(cameraRig, scene, onComplete);
  }

  private finish(
    cameraRig: CameraRig,
    scene: THREE.Scene,
    onComplete: (mode: Exclude<Stage4CinematicMode, 'none'>) => void
  ): void {
    if (this.mode === 'none') return;
    const finishedMode = this.mode;
    if (finishedMode === 'boss_intro' && this.targetBoss) {
      this.targetBoss.cinematicControlled = false;
      this.targetBoss.setStage4IntroPose(1, 0);
    }
    this.reset(cameraRig, scene);
    onComplete(finishedMode);
  }
}
