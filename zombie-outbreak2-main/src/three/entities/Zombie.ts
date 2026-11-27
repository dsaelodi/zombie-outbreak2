import * as THREE from 'three';
import {
  BOSS_PHASE2_CONFIG,
  calculateZombieDamage,
  ZOMBIE_STATS,
  type AnatomyVariant,
  type DamageSourceType,
  type WeaknessIconType,
  type ZombieVariant,
} from '../../data/zombies';
import { clamp, damp, lerp } from '../../utils/math';
import type { AssetManager } from '../AssetManager';
import { createWeaknessSprite, getWeaknessBaseScale, getWeaknessTexture } from './WeaknessBadge';

export type ZombieState = 'spawn' | 'walk' | 'attack' | 'hit' | 'dead';

export type BossJumpPhase = 'none' | 'anticipation' | 'airborne' | 'landing' | 'recovery';

export type GaitArchetype = 'limp_left' | 'limp_right' | 'drag_foot' | 'stumble' | 'crawl';

export type BossPhaseLifecycleState =
  | 'PHASE_1_ACTIVE'
  | 'PHASE_1_DEFEATED'
  | 'PHASE_1_DEATH_ANIMATION'
  | 'PHASE_2_TRANSFORMATION'
  | 'PHASE_2_RISING'
  | 'PHASE_2_ACTIVE'
  | 'BOSS_DEFEATED'
  | 'BOSS_DEATH_CINEMATIC';

export type BossState =
  | 'PHASE_1_IDLE'
  | 'PHASE_1_ATTACKING'
  | 'PHASE_1_DAMAGED'
  | 'PHASE_1_DEATH'
  | 'APPARENT_DEATH'
  | 'RESURRECTION_START'
  | 'MUTATION_ANIMATION'
  | 'FINAL_FORM_REVEAL'
  | 'PHASE_2_IDLE'
  | 'PHASE_2_ATTACKING'
  | 'PHASE_2_DAMAGED'
  | 'FINAL_DEATH'
  | 'VICTORY_CINEMATIC';

let nextZombieUid = 1;

let sharedShadowTexture: THREE.CanvasTexture | null = null;
function getContactShadowTexture(): THREE.CanvasTexture | null {
  if (sharedShadowTexture) return sharedShadowTexture;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.68)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  sharedShadowTexture = new THREE.CanvasTexture(c);
  return sharedShadowTexture;
}

const horrorTextureCache = new Map<string, THREE.CanvasTexture>();
function getHorrorSurfaceTexture(
  key: string,
  baseRgb: [number, number, number],
  stainStrength: number
): THREE.CanvasTexture | null {
  const cached = horrorTextureCache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = `rgb(${baseRgb[0]},${baseRgb[1]},${baseRgb[2]})`;
  ctx.fillRect(0, 0, 128, 128);

  // Subtle deterministic mottled decay & grime
  let seed = 0;
  for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) >>> 0;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < 420; i++) {
    const shade = (rand() - 0.5) * 34;
    const r = Math.max(0, Math.min(255, Math.round(baseRgb[0] + shade)));
    const g = Math.max(0, Math.min(255, Math.round(baseRgb[1] + shade)));
    const b = Math.max(0, Math.min(255, Math.round(baseRgb[2] + shade)));
    ctx.fillStyle = `rgba(${r},${g},${b},0.45)`;
    ctx.fillRect(rand() * 124, rand() * 124, 3 + rand() * 7, 3 + rand() * 7);
  }

  // Dried blood streaks & necrotic sores
  const blotches = Math.round(5 + stainStrength * 10);
  for (let i = 0; i < blotches; i++) {
    const bx = rand() * 116;
    const by = rand() * 116;
    const rad = 5 + rand() * 14;
    const grad = ctx.createRadialGradient(bx, by, 1, bx, by, rad);
    grad.addColorStop(0, `rgba(74, 8, 8, ${0.42 + stainStrength * 0.35})`);
    grad.addColorStop(1, 'rgba(74, 8, 8, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  horrorTextureCache.set(key, tex);
  return tex;
}

function chooseAnatomyVariant(variant: ZombieVariant, uid: number): AnatomyVariant {
  if (variant === 'crawler') return 'crawler_mutant';
  if (variant === 'boss') return 'standard';
  if (variant === 'armored') {
    const pool: AnatomyVariant[] = ['standard', 'exposed_ribs', 'missing_left_arm'];
    return pool[uid % pool.length];
  }
  const pool: AnatomyVariant[] = [
    'exposed_ribs',
    'missing_left_arm',
    'missing_right_arm',
    'missing_leg',
    'headless',
    'standard',
  ];
  return pool[(uid + variant.length) % pool.length];
}

export interface ZombieDamageApplied {
  finalDamage: number;
  killed: boolean;
  effectiveness: 'weak' | 'normal' | 'resisted';
  clampedByFireRule: boolean;
}

export interface ZombieUpdateCallbacks {
  onAttackHit: (damage: number) => void;
  onExploderDetonate?: (pos: THREE.Vector3, sourceZombie: Zombie) => void;
  onBurnTickDamage?: (zombie: Zombie, damage: number, killed: boolean) => void;
  onBossPhaseChanged?: (phase: 1 | 2, shielded: boolean, transitionStarted?: boolean) => void;
  onBossTelegraph?: (attackName: string) => void;
  onBossSlamHit?: (damage: number, center: THREE.Vector3) => void;
  onBossJumpPrep?: () => void;
  onBossJumpLaunch?: () => void;
  onBossJumpLand?: (damage: number, center: THREE.Vector3) => void;
  onBossProjectile?: (origin: THREE.Vector3, damage: number) => void;
  onBossShockwave?: (origin: THREE.Vector3, damage: number) => void;
  onBossTendrilAttack?: (origin: THREE.Vector3, damage: number, count: number) => void;
}

export interface ZombieUpdateOptions {
  bossSpeedOverride?: number;
  bossJumpTargetOverride?: THREE.Vector3;
  bossExternalMoveHandled?: boolean;
  bossAllowAutoJump?: boolean;
}

export class Zombie {
  public readonly id: string;
  public readonly variant: ZombieVariant;
  public readonly anatomy: AnatomyVariant;
  public readonly isHeadless: boolean;
  public readonly gait: GaitArchetype;
  public readonly root = new THREE.Group();

  public readonly bodyHitbox: THREE.Mesh;
  public readonly headHitbox: THREE.Mesh;

  public state: ZombieState = 'walk';
  public health: number;
  public maxHealth: number;
  public speed: number;
  public attackDamage: number;
  public markedForRemoval = false;
  public cinematicControlled = false;
  public showcaseOnly = false;

  // Burn DoT state
  private burnRemainingSec = 0;
  private burnDps = 0;
  private burnTickAccum = 0;

  // Boss Phase, Jump & Telegraphed Attack State (Strictly 2 Phases)
  public bossSuperPhase: 1 | 2 = 1;
  public bossState: BossState = 'PHASE_1_IDLE';
  public bossPhase: 1 | 2 = 1;
  public bossPhaseState: BossPhaseLifecycleState = 'PHASE_1_ACTIVE';
  public bossShielded = false;
  public bossRecoveryTimer = 0;
  public bossJumpPhase: BossJumpPhase = 'none';
  public bossAllowAutoJump = true;
  private bossJumpCooldown = 5.6;
  private bossJumpTimer = 0;
  private bossJumpAnticipationDur: number = BOSS_PHASE2_CONFIG.jumpAnticipationSec;
  private bossJumpFlightDur: number = BOSS_PHASE2_CONFIG.jumpFlightSec;
  private bossJumpLandingDur = 0.34;
  private readonly bossJumpStart = new THREE.Vector3();
  private readonly bossJumpTarget = new THREE.Vector3();
  private bossHealthMult = 1;

  private bossShieldHp = 0;
  private bossSlamCooldown = 6.5;
  private bossSlamTelegraphTimer = 0;
  private bossChargeCooldown = 9.5;
  private bossChargeWindupTimer = 0;
  private bossChargeDashTimer = 0;
  private bossSpitCooldown = 4.8;
  private bossShockwaveCooldown = 7.5;
  private bossShockwaveWindupTimer = 0;
  private bossTendrilCooldown = 4.2;
  private bossShieldMesh: THREE.Mesh | null = null;
  private bossCoreMesh: THREE.Mesh | null = null;
  private bossSlamRing: THREE.Mesh | null = null;
  private bossPustules: THREE.Mesh[] = [];
  private phase2MutationPivots: THREE.Object3D[] = [];
  private phase2GlowMats: THREE.MeshStandardMaterial[] = [];
  private phase2FleshMats: THREE.MeshStandardMaterial[] = [];

  // Exploder state
  private hasDetonated = false;
  private exploderSacMeshes: THREE.Mesh[] = [];

  // Per-instance visual & animation variation seeds (zero per-frame alloc)
  private readonly uidNum: number;
  private readonly animVariant: number;
  private readonly deathRollDir: number;
  private readonly strideScale: number;
  private readonly baseHunch: number;
  private readonly neckRestZ: number;
  private readonly hasLeftArm: boolean;
  private readonly hasRightArm: boolean;
  private readonly hasMissingLeg: boolean;
  private lastHitZone: 'head' | 'body' = 'body';

  private readonly visualGroup = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private gltfActions: Partial<
    Record<'idle' | 'walk' | 'attack' | 'hit' | 'death', THREE.AnimationAction>
  > = {};

  private torsoPivot = new THREE.Group();
  private headPivot = new THREE.Group();
  private leftArmPivot = new THREE.Group();
  private rightArmPivot = new THREE.Group();
  private leftLegPivot = new THREE.Group();
  private rightLegPivot = new THREE.Group();
  private proceduralMeshes: THREE.Mesh[] = [];
  private weaknessSprite: THREE.Sprite | null = null;
  private activeBadgeType: WeaknessIconType = 'none';

  private animTime = Math.random() * 10;
  private stridePhase = Math.random() * Math.PI * 2;
  private hitFlashTimer = 0;
  private hitStaggerTimer = 0;
  private attackCooldownTimer = 0;
  private attackAnimTimer = 0;
  private deathTimer = 0;

  private disposableGeometries: THREE.BufferGeometry[] = [];
  private disposableMaterials: THREE.Material[] = [];

  constructor(
    variant: ZombieVariant,
    spawnX: number,
    spawnZ: number,
    speedMult: number,
    healthMult: number,
    assetManager: AssetManager,
    forcedAnatomy?: AnatomyVariant
  ) {
    this.uidNum = nextZombieUid++;
    this.id = `zombie_${this.uidNum}`;
    this.variant = variant;
    this.anatomy = forcedAnatomy ?? chooseAnatomyVariant(variant, this.uidNum);
    this.isHeadless = this.anatomy === 'headless';
    this.hasLeftArm = this.anatomy !== 'missing_left_arm';
    this.hasRightArm = this.anatomy !== 'missing_right_arm';
    this.hasMissingLeg = this.anatomy === 'missing_leg';

    this.animVariant = this.uidNum % 4;
    this.deathRollDir = this.uidNum % 2 === 0 ? 1 : -1;
    this.strideScale = 0.88 + ((this.uidNum * 7) % 5) * 0.06;
    this.baseHunch =
      variant === 'runner'
        ? 0.34
        : variant === 'boss'
        ? 0.24
        : variant === 'crawler'
        ? 1.28
        : 0.16 + this.animVariant * 0.045;
    this.neckRestZ = variant === 'boss' ? 0.14 : this.uidNum % 2 === 0 ? 0.14 : -0.15;

    if (variant === 'crawler') {
      this.gait = 'crawl';
    } else if (this.hasMissingLeg || this.uidNum % 4 === 1) {
      this.gait = this.uidNum % 2 === 0 ? 'limp_left' : 'limp_right';
    } else if (this.uidNum % 4 === 2) {
      this.gait = 'drag_foot';
    } else {
      this.gait = 'stumble';
    }

    const stats = ZOMBIE_STATS[variant];
    this.bossHealthMult = variant === 'boss' ? healthMult : 1;
    this.maxHealth =
      variant === 'boss'
        ? Math.round(BOSS_PHASE2_CONFIG.phaseHealthPools[1] * healthMult)
        : Math.round(stats.health * healthMult);
    this.health = this.maxHealth;
    this.speed = stats.speed * speedMult * (this.hasMissingLeg ? 0.84 : 1.0);
    this.attackDamage = stats.attackDamage;

    this.root.position.set(spawnX, 0, spawnZ);
    this.root.scale.setScalar(stats.scale);
    this.root.add(this.visualGroup);

    // Contact shadow
    const shadowSize =
      variant === 'boss' ? 1.55 : variant === 'crawler' ? 1.3 : 1.15;
    const shadowGeo = new THREE.PlaneGeometry(shadowSize, shadowSize);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: getContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      opacity: variant === 'boss' ? 0.85 : 0.72,
    });
    this.disposableGeometries.push(shadowGeo);
    this.disposableMaterials.push(shadowMat);
    const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.025;
    this.root.add(shadowDisc);

    // Use GLTF only for standard anatomy non-boss/non-crawler zombies when available
    const allowGltf =
      variant !== 'boss' && variant !== 'crawler' && this.anatomy === 'standard';
    const gltfRig = allowGltf ? assetManager.instantiateZombieGLTF(variant) : null;
    if (gltfRig) {
      this.visualGroup.add(gltfRig.root);
      this.mixer = gltfRig.mixer;
      this.gltfActions = gltfRig.actions;
      this.gltfActions.walk?.play();
    } else if (variant === 'boss') {
      this.buildProceduralBoss();
    } else if (variant === 'crawler') {
      this.buildProceduralCrawler();
    } else {
      this.buildProceduralZombie(variant);
    }

    // 3D Head weakness indicator badge
    this.activeBadgeType = stats.weaknessIcon;
    const badge = createWeaknessSprite(stats.weaknessIcon, variant === 'boss');
    if (badge) {
      if (variant === 'crawler') {
        badge.sprite.position.set(0, 1.32, 0.15);
      } else if (this.isHeadless) {
        badge.sprite.position.set(0, 2.25, 0);
      }
      this.weaknessSprite = badge.sprite;
      this.disposableMaterials.push(badge.material);
      this.root.add(badge.sprite);
    }

    // Simplified invisible raycast hitboxes on Layer 1
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
    this.disposableMaterials.push(hitboxMat);

    const isBoss = variant === 'boss';
    const isCrawler = variant === 'crawler';
    const bodyGeo = new THREE.BoxGeometry(
      isBoss ? 1.12 : isCrawler ? 0.92 : 0.84,
      isBoss ? 1.35 : isCrawler ? 0.56 : 1.25,
      isBoss ? 0.78 : isCrawler ? 1.12 : 0.58
    );
    this.disposableGeometries.push(bodyGeo);
    this.bodyHitbox = new THREE.Mesh(bodyGeo, hitboxMat);
    this.bodyHitbox.position.set(0, isBoss ? 0.92 : isCrawler ? 0.34 : 0.85, 0);
    this.bodyHitbox.layers.set(1);
    this.bodyHitbox.userData = { zombie: this, zone: 'body' };
    this.root.add(this.bodyHitbox);

    const headGeo = new THREE.BoxGeometry(
      isBoss ? 0.58 : isCrawler ? 0.48 : 0.48,
      isBoss ? 0.52 : isCrawler ? 0.44 : 0.46,
      isBoss ? 0.58 : isCrawler ? 0.5 : 0.48
    );
    this.disposableGeometries.push(headGeo);
    this.headHitbox = new THREE.Mesh(headGeo, hitboxMat);
    this.headHitbox.position.set(
      0,
      isBoss ? 1.84 : isCrawler ? 0.42 : 1.72,
      isBoss ? 0.14 : isCrawler ? 0.48 : 0.05
    );
    this.headHitbox.layers.set(1);
    this.headHitbox.userData = { zombie: this, zone: 'head' };
    this.headHitbox.visible = !this.isHeadless;
    if (!this.isHeadless) {
      this.root.add(this.headHitbox);
    }
  }

  private buildProceduralCrawler(): void {
    const skinTex = getHorrorSurfaceTexture('crawler_skin', [86, 98, 82], 0.78);
    const ragTex = getHorrorSurfaceTexture('crawler_rag', [48, 34, 32], 0.65);

    const skinMat = new THREE.MeshStandardMaterial({
      color: 0x7b8874,
      map: skinTex,
      roughness: 0.78,
      metalness: 0.05,
    });
    const ragMat = new THREE.MeshStandardMaterial({
      color: 0x452d2a,
      map: ragTex,
      roughness: 0.92,
      metalness: 0.04,
    });
    const woundMat = new THREE.MeshStandardMaterial({
      color: 0x621114,
      roughness: 0.32,
      metalness: 0.08,
    });
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0xc8bca6,
      roughness: 0.58,
      metalness: 0.05,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 1.9,
      roughness: 0.2,
    });
    this.disposableMaterials.push(skinMat, ragMat, woundMat, boneMat, eyeMat);

    const reg = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial) => {
      this.disposableGeometries.push(geo);
      if (mat.userData.baseEmissiveHex === undefined) {
        mat.userData.baseEmissiveHex = mat.emissive.getHex();
        mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
      }
      const m = new THREE.Mesh(geo, mat);
      m.userData.baseEmissiveHex = mat.userData.baseEmissiveHex;
      m.userData.baseEmissiveIntensity = mat.userData.baseEmissiveIntensity;
      m.castShadow = true;
      m.receiveShadow = false;
      this.proceduralMeshes.push(m);
      return m;
    };

    // Prone torso suspended ~0.3m off the floor
    this.torsoPivot.position.set(0, 0.32, 0.08);
    this.torsoPivot.rotation.x = 1.28;

    const pelvis = reg(new THREE.BoxGeometry(0.42, 0.24, 0.24), ragMat);
    pelvis.position.set(0, -0.02, 0);
    const chest = reg(new THREE.BoxGeometry(0.48, 0.42, 0.27), ragMat);
    chest.position.set(0, 0.3, 0.02);
    const spineWound = reg(new THREE.BoxGeometry(0.22, 0.3, 0.08), woundMat);
    spineWound.position.set(0, 0.28, -0.13);
    for (let v = 0; v < 4; v++) {
      const vertebra = reg(new THREE.BoxGeometry(0.08, 0.055, 0.08), boneMat);
      vertebra.position.set(0, 0.14 + v * 0.09, -0.16);
      this.torsoPivot.add(vertebra);
    }
    this.torsoPivot.add(pelvis, chest, spineWound);

    // Snapping low-slung skull angled forward toward the player
    this.headPivot.position.set(0, 0.54, 0.07);
    this.headPivot.rotation.x = -1.05;
    const cranium = reg(new THREE.BoxGeometry(0.28, 0.27, 0.29), skinMat);
    cranium.position.set(0, 0.16, 0.02);
    const jaw = reg(new THREE.BoxGeometry(0.21, 0.09, 0.23), skinMat);
    jaw.position.set(0, 0.02, 0.08);
    jaw.rotation.x = 0.32;
    const teeth = reg(new THREE.BoxGeometry(0.15, 0.03, 0.03), boneMat);
    teeth.position.set(0, 0.08, 0.17);
    const lEye = reg(new THREE.BoxGeometry(0.06, 0.045, 0.04), eyeMat);
    lEye.position.set(-0.07, 0.18, 0.165);
    const rEye = reg(new THREE.BoxGeometry(0.05, 0.04, 0.04), eyeMat);
    rEye.position.set(0.07, 0.17, 0.165);
    this.headPivot.add(cranium, jaw, teeth, lEye, rEye);
    this.torsoPivot.add(this.headPivot);

    // Muscular elongated dragging arms reaching forward to pull torso along floor
    this.leftArmPivot.position.set(-0.31, 0.44, 0.04);
    this.rightArmPivot.position.set(0.31, 0.44, 0.04);
    for (const [pivot, sign] of [
      [this.leftArmPivot, -1],
      [this.rightArmPivot, 1],
    ] as const) {
      const upper = reg(new THREE.BoxGeometry(0.14, 0.36, 0.14), skinMat);
      upper.position.set(0, -0.17, 0);
      const fore = reg(new THREE.BoxGeometry(0.13, 0.38, 0.13), skinMat);
      fore.position.set(0, -0.49, 0.09);
      fore.rotation.x = -0.42;
      const claw = reg(new THREE.BoxGeometry(0.11, 0.13, 0.12), woundMat);
      claw.position.set(sign * 0.01, -0.68, 0.17);
      pivot.add(upper, fore, claw);
    }
    this.torsoPivot.add(this.leftArmPivot, this.rightArmPivot);

    // Mangled trailing lower limbs dragging behind
    this.leftLegPivot.position.set(-0.14, 0.2, -0.14);
    this.rightLegPivot.position.set(0.14, 0.18, -0.14);
    const lThigh = reg(new THREE.BoxGeometry(0.17, 0.38, 0.18), ragMat);
    lThigh.position.set(0, -0.16, 0);
    lThigh.rotation.x = 1.48;
    const lStump = reg(new THREE.BoxGeometry(0.12, 0.18, 0.13), woundMat);
    lStump.position.set(0, -0.19, -0.35);
    lStump.rotation.x = 1.48;
    this.leftLegPivot.add(lThigh, lStump);

    const rThigh = reg(new THREE.BoxGeometry(0.16, 0.44, 0.17), ragMat);
    rThigh.position.set(0, -0.17, 0);
    rThigh.rotation.x = 1.52;
    const rFoot = reg(new THREE.BoxGeometry(0.13, 0.28, 0.14), skinMat);
    rFoot.position.set(0.02, -0.18, -0.45);
    rFoot.rotation.x = 1.52;
    this.rightLegPivot.add(rThigh, rFoot);

    this.visualGroup.add(this.leftLegPivot, this.rightLegPivot, this.torsoPivot);
  }

  private buildProceduralZombie(variant: ZombieVariant): void {
    const palettes: Record<
      ZombieVariant,
      { skins: number[]; coat: number[]; pants: number; eye: number; skinRgb: [number, number, number] }
    > = {
      basic: {
        skins: [0x6f7f67, 0x5c685a, 0x80796a, 0x4f5a4c],
        coat: [0x353c34, 0x443530, 0x2c343d, 0x3b382f],
        pants: 0x202328,
        eye: 0xe6e073,
        skinRgb: [108, 120, 98],
      },
      runner: {
        skins: [0x64725e, 0x584d4a, 0x717d6c, 0x4e584a],
        coat: [0x591e1e, 0x431818, 0x522923, 0x381c20],
        pants: 0x191a1e,
        eye: 0xff3b3b,
        skinRgb: [102, 92, 86],
      },
      armored: {
        skins: [0x566253, 0x4b5349, 0x626b5c, 0x444c42],
        coat: [0x262d36, 0x2f3640, 0x21272e, 0x2b3036],
        pants: 0x1a1e24,
        eye: 0xfbbf24,
        skinRgb: [86, 98, 82],
      },
      mutated: {
        skins: [0x445a3d, 0x394d34, 0x526444, 0x364331],
        coat: [0x283422, 0x222c1d, 0x313c28, 0x1e261a],
        pants: 0x1a2018,
        eye: 0x84cc16,
        skinRgb: [72, 94, 62],
      },
      exploder: {
        skins: [0x6f5a4a, 0x604c41, 0x796454, 0x554339],
        coat: [0x3a241d, 0x2f1d17, 0x452820, 0x331f1a],
        pants: 0x1f1917,
        eye: 0xff6b1a,
        skinRgb: [110, 88, 72],
      },
      crawler: {
        skins: [0x626f5a],
        coat: [0x3b2a26],
        pants: 0x1b1918,
        eye: 0xef4444,
        skinRgb: [96, 108, 88],
      },
      boss: {
        skins: [0x454f43],
        coat: [0x1f2428],
        pants: 0x15171a,
        eye: 0xff3b3b,
        skinRgb: [70, 78, 68],
      },
    };

    const palette = palettes[variant];
    const skinHex = palette.skins[this.uidNum % palette.skins.length];
    const coatHex = palette.coat[(this.uidNum + 1) % palette.coat.length];

    const skinTex = getHorrorSurfaceTexture(`skin_${variant}_${this.uidNum % 3}`, palette.skinRgb, 0.55);
    const coatTex = getHorrorSurfaceTexture(`coat_${variant}_${this.uidNum % 3}`, [54, 54, 58], 0.72);

    const skinMat = new THREE.MeshStandardMaterial({
      color: skinHex,
      map: skinTex,
      roughness: 0.84,
      metalness: 0.04,
    });
    const coatMat = new THREE.MeshStandardMaterial({
      color: coatHex,
      map: coatTex,
      roughness: 0.9,
      metalness: 0.06,
    });
    const pantsMat = new THREE.MeshStandardMaterial({ color: palette.pants, roughness: 0.92, metalness: 0.04 });
    const woundMat = new THREE.MeshStandardMaterial({ color: 0x5f1114, roughness: 0.34, metalness: 0.08 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xc6b9a2, roughness: 0.6, metalness: 0.05 });
    const milkyEyeMat = new THREE.MeshStandardMaterial({ color: 0xd9dcc8, roughness: 0.3 });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: palette.eye,
      emissive: palette.eye,
      emissiveIntensity: 1.7,
      roughness: 0.25,
    });
    this.disposableMaterials.push(skinMat, coatMat, pantsMat, woundMat, boneMat, milkyEyeMat, eyeMat);

    const registerMesh = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial) => {
      this.disposableGeometries.push(geo);
      if (mat.userData.baseEmissiveHex === undefined) {
        mat.userData.baseEmissiveHex = mat.emissive.getHex();
        mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
      }
      const m = new THREE.Mesh(geo, mat);
      m.userData.baseEmissiveHex = mat.userData.baseEmissiveHex;
      m.userData.baseEmissiveIntensity = mat.userData.baseEmissiveIntensity;
      m.castShadow = true;
      m.receiveShadow = false;
      this.proceduralMeshes.push(m);
      return m;
    };

    const asymSign = this.uidNum % 2 === 0 ? 1 : -1;

    // 1. Uneven Legs (supports missing_leg severed stump anatomy)
    this.leftLegPivot.position.set(-0.145, 0.82, 0);
    this.rightLegPivot.position.set(0.145, 0.82, 0);
    const lThigh = registerMesh(new THREE.BoxGeometry(0.19, 0.42, 0.21), pantsMat);
    lThigh.position.y = -0.2;
    const lKnee = registerMesh(new THREE.BoxGeometry(0.17, 0.09, 0.19), variant === 'armored' ? coatMat : woundMat);
    lKnee.position.set(0, -0.39, 0.03);
    const lShin = registerMesh(new THREE.BoxGeometry(0.16, 0.4, 0.18), this.uidNum % 3 === 0 ? skinMat : pantsMat);
    lShin.position.set(-0.01, -0.58, 0.02);
    lShin.rotation.z = asymSign * 0.05;
    const lBoot = registerMesh(new THREE.BoxGeometry(0.175, 0.11, 0.25), pantsMat);
    lBoot.position.set(-0.01, -0.78, 0.05);
    this.leftLegPivot.add(lThigh, lKnee, lShin, lBoot);

    if (this.hasMissingLeg) {
      // Severed right thigh stump + exposed femur tip + blood clot
      const rStumpThigh = registerMesh(new THREE.BoxGeometry(0.18, 0.28, 0.19), pantsMat);
      rStumpThigh.position.set(0, -0.14, 0);
      const rBloodTip = registerMesh(new THREE.BoxGeometry(0.16, 0.11, 0.17), woundMat);
      rBloodTip.position.set(0, -0.31, 0);
      const rBoneTip = registerMesh(new THREE.CylinderGeometry(0.032, 0.04, 0.14, 6), boneMat);
      rBoneTip.position.set(0.01, -0.39, 0.01);
      this.rightLegPivot.add(rStumpThigh, rBloodTip, rBoneTip);
    } else {
      const rThigh = registerMesh(new THREE.BoxGeometry(0.185, 0.42, 0.2), pantsMat);
      rThigh.position.y = -0.2;
      const rShin = registerMesh(new THREE.BoxGeometry(0.155, 0.4, 0.175), pantsMat);
      rShin.position.set(0.01, -0.58, -0.01);
      const legWound = registerMesh(new THREE.BoxGeometry(0.12, 0.16, 0.19), woundMat);
      legWound.position.set(0.02, -0.44, 0.02);
      this.rightLegPivot.add(rThigh, rShin, legWound);
    }
    this.visualGroup.add(this.leftLegPivot, this.rightLegPivot);

    // 2. Crooked Hunched Torso + Blood Stains, Exposed Ribs & Tattered Hem
    this.torsoPivot.position.set(0, 0.84, 0);
    const torsoW = variant === 'armored' ? 0.56 : variant === 'mutated' ? 0.58 : 0.47;
    const lowerTorso = registerMesh(new THREE.BoxGeometry(torsoW * 0.88, 0.3, 0.28), coatMat);
    lowerTorso.position.set(0, 0.16, 0);

    const upperTorso = registerMesh(new THREE.BoxGeometry(torsoW, 0.42, 0.31), coatMat);
    upperTorso.position.set(asymSign * 0.02, 0.48, 0.02);
    upperTorso.rotation.z = asymSign * 0.08;
    upperTorso.rotation.x = 0.09;

    const isExposedRibs = this.anatomy === 'exposed_ribs';
    const chestTear = registerMesh(
      new THREE.BoxGeometry(isExposedRibs ? 0.33 : 0.24, isExposedRibs ? 0.36 : 0.28, 0.09),
      woundMat
    );
    chestTear.position.set(isExposedRibs ? 0 : asymSign * 0.06, 0.43, 0.15);
    chestTear.rotation.z = isExposedRibs ? 0.04 : asymSign * 0.16;
    this.torsoPivot.add(lowerTorso, upperTorso, chestTear);

    if (isExposedRibs || variant === 'basic' || variant === 'runner' || variant === 'mutated') {
      const ribCount = isExposedRibs ? 4 : 2;
      for (let r = 0; r < ribCount; r++) {
        const rib = registerMesh(
          new THREE.BoxGeometry(isExposedRibs ? 0.24 : 0.17, 0.038, 0.07),
          boneMat
        );
        rib.position.set(isExposedRibs ? 0 : asymSign * 0.06, 0.31 + r * 0.078, 0.185);
        rib.rotation.z = isExposedRibs ? (r % 2 === 0 ? 0.08 : -0.08) : asymSign * -0.18;
        this.torsoPivot.add(rib);
      }
      if (isExposedRibs) {
        const sternum = registerMesh(new THREE.BoxGeometry(0.055, 0.28, 0.06), boneMat);
        sternum.position.set(0, 0.43, 0.185);
        this.torsoPivot.add(sternum);
      }
      const rag = registerMesh(new THREE.BoxGeometry(0.22, 0.22, 0.06), coatMat);
      rag.position.set(-asymSign * 0.14, 0.01, 0.13);
      rag.rotation.x = -0.14;
      rag.rotation.z = asymSign * 0.2;
      this.torsoPivot.add(rag);
    }

    // 3. Head OR Jagged Headless Neck Stump
    this.headPivot.position.set(asymSign * 0.03, 0.71, 0.07);
    const neck = registerMesh(new THREE.BoxGeometry(0.15, 0.12, 0.15), skinMat);
    neck.position.set(0, 0.02, -0.01);
    neck.rotation.z = asymSign * 0.15;

    if (this.isHeadless) {
      // Torn crimson neck stump with protruding cervical vertebrae & blood pool
      const stump = registerMesh(new THREE.CylinderGeometry(0.085, 0.11, 0.09, 7), woundMat);
      stump.position.set(0, 0.08, 0);
      const cervicalBone = registerMesh(new THREE.CylinderGeometry(0.032, 0.04, 0.09, 6), boneMat);
      cervicalBone.position.set(0, 0.13, -0.01);
      const collarBlood = registerMesh(new THREE.BoxGeometry(0.32, 0.07, 0.22), woundMat);
      collarBlood.position.set(0, -0.02, 0.04);
      this.headPivot.add(neck, stump, cervicalBone, collarBlood);
    } else {
      const cranium = registerMesh(new THREE.BoxGeometry(0.29, 0.28, 0.3), skinMat);
      cranium.position.set(0, 0.2, 0.01);
      cranium.rotation.z = asymSign * 0.07;

      const browRidge = registerMesh(new THREE.BoxGeometry(0.295, 0.05, 0.06), skinMat);
      browRidge.position.set(0, 0.255, 0.145);
      browRidge.rotation.z = asymSign * 0.07;
      this.headPivot.add(browRidge);

      const jaw = registerMesh(new THREE.BoxGeometry(0.21, 0.09, 0.23), skinMat);
      jaw.position.set(-asymSign * 0.015, 0.04, 0.06);
      jaw.rotation.x = 0.26;
      jaw.rotation.z = -asymSign * 0.08;

      const mouthVoid = registerMesh(new THREE.BoxGeometry(0.16, 0.055, 0.05), woundMat);
      mouthVoid.position.set(0, 0.085, 0.145);
      const teeth = registerMesh(new THREE.BoxGeometry(0.14, 0.024, 0.03), boneMat);
      teeth.position.set(0, 0.105, 0.165);

      const lEye = registerMesh(
        new THREE.BoxGeometry(0.068, 0.048, 0.04),
        asymSign > 0 ? eyeMat : milkyEyeMat
      );
      lEye.position.set(-0.072, 0.21, 0.16);
      lEye.rotation.z = 0.14;
      const rEye = registerMesh(
        new THREE.BoxGeometry(0.052, 0.036, 0.04),
        asymSign > 0 ? milkyEyeMat : eyeMat
      );
      rEye.position.set(0.072, 0.19, 0.16);
      rEye.rotation.z = -0.18;

      this.headPivot.add(neck, cranium, jaw, mouthVoid, teeth, lEye, rEye);
    }
    this.torsoPivot.add(this.headPivot);

    // Variant-specific distinct low-poly silhouettes
    if (variant === 'armored') {
      const armorMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.36, metalness: 0.78 });
      const visorMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.9 });
      this.disposableMaterials.push(armorMat, visorMat);

      if (!this.isHeadless) {
        const helmet = registerMesh(new THREE.BoxGeometry(0.36, 0.22, 0.36), armorMat);
        helmet.position.set(0, 0.26, 0.01);
        helmet.rotation.z = -0.08;
        const visor = registerMesh(new THREE.BoxGeometry(0.28, 0.08, 0.06), visorMat);
        visor.position.set(0.01, 0.2, 0.175);
        visor.rotation.z = -0.12;
        this.headPivot.add(helmet, visor);
      }

      const chestPlate = registerMesh(new THREE.BoxGeometry(torsoW + 0.07, 0.4, 0.36), armorMat);
      chestPlate.position.set(0, 0.45, 0.01);
      const padGeo = new THREE.BoxGeometry(0.22, 0.18, 0.32);
      const lPad = registerMesh(padGeo, armorMat);
      lPad.position.set(-(torsoW * 0.5 + 0.1), 0.63, 0);
      lPad.rotation.z = 0.15;
      const rPad = registerMesh(padGeo, armorMat);
      rPad.position.set(torsoW * 0.5 + 0.1, 0.59, 0);
      rPad.rotation.z = -0.12;
      this.torsoPivot.add(chestPlate, lPad, rPad);
    }

    if (variant === 'mutated') {
      const bioMat = new THREE.MeshStandardMaterial({
        color: 0x84cc16,
        emissive: 0x65a30d,
        emissiveIntensity: 1.4,
        roughness: 0.35,
      });
      this.disposableMaterials.push(bioMat);

      for (let s = 0; s < 3; s++) {
        const spine = registerMesh(new THREE.ConeGeometry(0.08, 0.3, 5), bioMat);
        spine.position.set(s % 2 === 0 ? -0.05 : 0.05, 0.58 - s * 0.15, -0.2);
        spine.rotation.x = -0.82;
        this.torsoPivot.add(spine);
      }
      const core = registerMesh(new THREE.DodecahedronGeometry(0.12), bioMat);
      core.position.set(0.04, 0.44, 0.2);
      this.torsoPivot.add(core);
    }

    if (variant === 'exploder') {
      const sacMat = new THREE.MeshStandardMaterial({
        color: 0xff5a1f,
        emissive: 0xff4500,
        emissiveIntensity: 1.8,
        roughness: 0.28,
      });
      this.disposableMaterials.push(sacMat);
      const chestSac = registerMesh(new THREE.SphereGeometry(0.22, 8, 8), sacMat);
      chestSac.position.set(0, 0.4, 0.16);
      const bellySac = registerMesh(new THREE.SphereGeometry(0.18, 8, 8), sacMat);
      bellySac.position.set(0.12, 0.22, 0.13);
      this.torsoPivot.add(chestSac, bellySac);
      this.exploderSacMeshes.push(chestSac, bellySac);
    }

    // 4. Uneven Shoulders & Arms (supports missing_left_arm / missing_right_arm severed stumps)
    const armOffsetX = variant === 'armored' ? 0.37 : 0.31;
    const dropOffset = asymSign * 0.045;
    this.leftArmPivot.position.set(-armOffsetX, 0.6 + dropOffset, 0.02);
    this.rightArmPivot.position.set(armOffsetX, 0.6 - dropOffset, 0.02);

    const upperArmGeo = new THREE.BoxGeometry(0.145, 0.34, 0.145);
    const lForeGeo = new THREE.BoxGeometry(variant === 'mutated' ? 0.19 : 0.125, 0.38, 0.125);
    const rForeGeo = new THREE.BoxGeometry(0.12, 0.36, 0.12);

    if (this.hasLeftArm) {
      const lUpper = registerMesh(upperArmGeo, coatMat);
      lUpper.position.set(0, -0.15, 0);
      const lFore = registerMesh(lForeGeo, skinMat);
      lFore.position.set(0, -0.45, 0.06);
      lFore.rotation.x = -0.38;
      const lHandWound = registerMesh(new THREE.BoxGeometry(0.1, 0.11, 0.1), woundMat);
      lHandWound.position.set(0, -0.63, 0.13);
      this.leftArmPivot.add(lUpper, lFore, lHandWound);
    } else {
      const lStump = registerMesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), coatMat);
      lStump.position.set(0, -0.09, 0);
      const lRaw = registerMesh(new THREE.BoxGeometry(0.11, 0.09, 0.11), woundMat);
      lRaw.position.set(0, -0.21, 0);
      const lBone = registerMesh(new THREE.CylinderGeometry(0.025, 0.032, 0.11, 5), boneMat);
      lBone.position.set(0, -0.28, 0.01);
      this.leftArmPivot.add(lStump, lRaw, lBone);
    }

    if (this.hasRightArm) {
      const rUpper = registerMesh(upperArmGeo, coatMat);
      rUpper.position.set(0, -0.15, 0);
      const rFore = registerMesh(rForeGeo, skinMat);
      rFore.position.set(0, -0.44, 0.07);
      rFore.rotation.x = -0.44;
      this.rightArmPivot.add(rUpper, rFore);
    } else {
      const rStump = registerMesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), coatMat);
      rStump.position.set(0, -0.09, 0);
      const rRaw = registerMesh(new THREE.BoxGeometry(0.11, 0.09, 0.11), woundMat);
      rRaw.position.set(0, -0.21, 0);
      const rBone = registerMesh(new THREE.CylinderGeometry(0.025, 0.032, 0.11, 5), boneMat);
      rBone.position.set(0, -0.28, 0.01);
      this.rightArmPivot.add(rStump, rRaw, rBone);
    }

    this.torsoPivot.add(this.leftArmPivot, this.rightArmPivot);
    this.visualGroup.add(this.torsoPivot);
  }

  private buildProceduralBoss(): void {
    const fleshMat = new THREE.MeshStandardMaterial({ color: 0x2d2424, roughness: 0.88, metalness: 0.06 });
    const muscleMat = new THREE.MeshStandardMaterial({ color: 0x6b1d1d, roughness: 0.36, metalness: 0.08 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xb9aa96, roughness: 0.58, metalness: 0.05 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.34, metalness: 0.82 });
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xff5a1f,
      emissive: 0xea3800,
      emissiveIntensity: 1.85,
      roughness: 0.25,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xff2a2a,
      emissive: 0xff1e00,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });
    this.disposableMaterials.push(fleshMat, muscleMat, boneMat, metalMat, coreMat, eyeMat);

    const reg = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial) => {
      this.disposableGeometries.push(geo);
      if (mat.userData.baseEmissiveHex === undefined) {
        mat.userData.baseEmissiveHex = mat.emissive.getHex();
        mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
      }
      const m = new THREE.Mesh(geo, mat);
      m.userData.baseEmissiveHex = mat.userData.baseEmissiveHex;
      m.userData.baseEmissiveIntensity = mat.userData.baseEmissiveIntensity;
      m.castShadow = true;
      m.receiveShadow = false;
      this.proceduralMeshes.push(m);
      return m;
    };

    // 1. Asymmetric Legs
    this.leftLegPivot.position.set(-0.24, 0.86, 0);
    const lThigh = reg(new THREE.BoxGeometry(0.29, 0.48, 0.3), fleshMat);
    lThigh.position.y = -0.22;
    const lShin = reg(new THREE.BoxGeometry(0.32, 0.44, 0.33), metalMat);
    lShin.position.y = -0.62;
    const lFoot = reg(new THREE.BoxGeometry(0.34, 0.14, 0.42), metalMat);
    lFoot.position.set(0, -0.82, 0.06);
    this.leftLegPivot.add(lThigh, lShin, lFoot);

    this.rightLegPivot.position.set(0.23, 0.86, 0.04);
    const rThigh = reg(new THREE.BoxGeometry(0.23, 0.46, 0.24), muscleMat);
    rThigh.position.set(0.02, -0.22, 0);
    rThigh.rotation.z = -0.08;
    const rShin = reg(new THREE.BoxGeometry(0.2, 0.44, 0.22), fleshMat);
    rShin.position.set(0.04, -0.62, -0.03);
    const rSpur = reg(new THREE.ConeGeometry(0.07, 0.26, 5), boneMat);
    rSpur.position.set(0.14, -0.45, -0.08);
    rSpur.rotation.z = -0.9;
    this.rightLegPivot.add(rThigh, rShin, rSpur);
    this.visualGroup.add(this.leftLegPivot, this.rightLegPivot);

    // 2. Deformed Hunched Torso + Exposed Ribcage & Pulsing Bio-Core
    this.torsoPivot.position.set(0, 0.88, 0);
    this.torsoPivot.rotation.x = 0.22;

    const lowerWaist = reg(new THREE.BoxGeometry(0.66, 0.3, 0.42), fleshMat);
    lowerWaist.position.y = 0.15;
    const upperHull = reg(new THREE.BoxGeometry(0.92, 0.56, 0.54), fleshMat);
    upperHull.position.set(-0.04, 0.54, 0.02);
    upperHull.rotation.z = 0.09;

    const shoulderTumor = reg(new THREE.DodecahedronGeometry(0.31, 0), muscleMat);
    shoulderTumor.position.set(-0.42, 0.78, -0.02);
    const pustule1 = reg(new THREE.SphereGeometry(0.11, 7, 7), coreMat);
    pustule1.position.set(-0.5, 0.94, 0.08);
    const pustule2 = reg(new THREE.SphereGeometry(0.09, 7, 7), coreMat);
    pustule2.position.set(-0.28, 0.88, -0.18);
    this.bossPustules.push(pustule1, pustule2);

    const rightPauldron = reg(new THREE.BoxGeometry(0.32, 0.24, 0.44), metalMat);
    rightPauldron.position.set(0.42, 0.72, 0);
    rightPauldron.rotation.z = -0.22;
    const collar = reg(new THREE.BoxGeometry(0.56, 0.11, 0.44), metalMat);
    collar.position.set(0.02, 0.84, 0.04);

    for (let r = 0; r < 3; r++) {
      const y = 0.36 + r * 0.13;
      const ribL = reg(new THREE.BoxGeometry(0.24, 0.055, 0.12), boneMat);
      ribL.position.set(-0.18, y, 0.26);
      ribL.rotation.y = 0.36;
      ribL.rotation.z = -0.15;
      const ribR = reg(new THREE.BoxGeometry(0.22, 0.055, 0.12), boneMat);
      ribR.position.set(0.18, y, 0.25);
      ribR.rotation.y = -0.36;
      ribR.rotation.z = 0.18;
      this.torsoPivot.add(ribL, ribR);
    }

    const coreCavity = reg(new THREE.BoxGeometry(0.34, 0.38, 0.16), muscleMat);
    coreCavity.position.set(0.01, 0.48, 0.22);
    const core = reg(new THREE.DodecahedronGeometry(0.21, 0), coreMat);
    core.position.set(0.01, 0.48, 0.3);
    this.bossCoreMesh = core;

    for (let s = 0; s < 4; s++) {
      const spine = reg(new THREE.ConeGeometry(0.085 - s * 0.01, 0.38 - s * 0.04, 5), boneMat);
      spine.position.set(s % 2 === 0 ? -0.05 : 0.06, 0.78 - s * 0.16, -0.28);
      spine.rotation.x = -0.92;
      spine.rotation.z = s % 2 === 0 ? 0.16 : -0.18;
      this.torsoPivot.add(spine);
    }

    this.torsoPivot.add(
      lowerWaist,
      upperHull,
      shoulderTumor,
      pustule1,
      pustule2,
      rightPauldron,
      collar,
      coreCavity,
      core
    );

    // 3. Asymmetric Skull, Split Jaw & Uneven Glowing Eyes
    this.headPivot.position.set(0.03, 0.9, 0.14);
    this.headPivot.rotation.z = 0.14;

    const cranium = reg(new THREE.DodecahedronGeometry(0.23, 0), fleshMat);
    cranium.position.set(0, 0.18, 0);
    cranium.scale.set(1.0, 1.15, 1.12);

    const horn = reg(new THREE.ConeGeometry(0.065, 0.32, 5), boneMat);
    horn.position.set(0.14, 0.38, -0.02);
    horn.rotation.z = -0.35;
    horn.rotation.x = 0.22;

    const splitJaw = reg(new THREE.BoxGeometry(0.24, 0.12, 0.28), boneMat);
    splitJaw.position.set(-0.02, 0.01, 0.09);
    splitJaw.rotation.x = 0.24;

    const eyeBig = reg(new THREE.BoxGeometry(0.075, 0.055, 0.05), eyeMat);
    eyeBig.position.set(0.08, 0.2, 0.2);
    const eyeMid = reg(new THREE.BoxGeometry(0.055, 0.042, 0.05), eyeMat);
    eyeMid.position.set(-0.075, 0.22, 0.19);
    const eyeSmall = reg(new THREE.BoxGeometry(0.04, 0.035, 0.05), eyeMat);
    eyeSmall.position.set(-0.11, 0.15, 0.18);

    this.headPivot.add(cranium, horn, splitJaw, eyeBig, eyeMid, eyeSmall);
    this.torsoPivot.add(this.headPivot);

    // 4. Left Crusher Arm vs Withered Right Arm
    this.leftArmPivot.position.set(-0.56, 0.72, 0.05);
    const lUpper = reg(new THREE.BoxGeometry(0.24, 0.44, 0.25), muscleMat);
    lUpper.position.set(-0.02, -0.2, 0);
    const lFore = reg(new THREE.BoxGeometry(0.28, 0.5, 0.28), fleshMat);
    lFore.position.set(-0.02, -0.58, 0.12);
    lFore.rotation.x = -0.45;
    const lShackle = reg(new THREE.BoxGeometry(0.32, 0.12, 0.32), metalMat);
    lShackle.position.set(-0.02, -0.48, 0.07);
    lShackle.rotation.x = -0.45;
    for (let t = -1; t <= 1; t++) {
      const talon = reg(new THREE.ConeGeometry(0.045, 0.38, 4), boneMat);
      talon.position.set(-0.02 + t * 0.08, -0.92, 0.26);
      talon.rotation.x = Math.PI + 0.35;
      this.leftArmPivot.add(talon);
    }
    this.leftArmPivot.add(lUpper, lFore, lShackle);

    this.rightArmPivot.position.set(0.49, 0.58, -0.02);
    const rUpper = reg(new THREE.BoxGeometry(0.14, 0.38, 0.14), fleshMat);
    rUpper.position.set(0.03, -0.18, 0);
    rUpper.rotation.z = 0.16;
    const rFore = reg(new THREE.BoxGeometry(0.11, 0.42, 0.12), muscleMat);
    rFore.position.set(0.07, -0.5, 0.12);
    rFore.rotation.x = -0.55;
    const rSpike = reg(new THREE.ConeGeometry(0.05, 0.3, 4), boneMat);
    rSpike.position.set(0.08, -0.76, 0.24);
    rSpike.rotation.x = Math.PI + 0.5;
    const rSac = reg(new THREE.SphereGeometry(0.09, 6, 6), coreMat);
    rSac.position.set(0.06, -0.58, 0.18);
    this.bossPustules.push(rSac);
    this.rightArmPivot.add(rUpper, rFore, rSpike, rSac);

    this.torsoPivot.add(this.leftArmPivot, this.rightArmPivot);
    this.visualGroup.add(this.torsoPivot);

    // 5. Bio-Carapace Shield Energy Cage
    const shieldGeo = new THREE.DodecahedronGeometry(1.26, 1);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0xff4500,
      wireframe: true,
      transparent: true,
      opacity: 0.58,
    });
    this.disposableGeometries.push(shieldGeo);
    this.disposableMaterials.push(shieldMat);
    this.bossShieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    this.bossShieldMesh.position.set(0, 1.12, 0);
    this.bossShieldMesh.visible = false;
    this.root.add(this.bossShieldMesh);

    // 6. Telegraphed Ground Slam Warning Ring
    const ringGeo = new THREE.RingGeometry(1.4, 2.05, 28);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff2e2e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    this.disposableGeometries.push(ringGeo);
    this.disposableMaterials.push(ringMat);
    this.bossSlamRing = new THREE.Mesh(ringGeo, ringMat);
    this.bossSlamRing.rotation.x = -Math.PI / 2;
    this.bossSlamRing.position.set(0, 0.05, 0.85);
    this.bossSlamRing.visible = false;
    this.root.add(this.bossSlamRing);

    // 7. Phase 2 Hidden Mutation Structures
    const mutChitinMat = new THREE.MeshStandardMaterial({ color: 0x240b0e, roughness: 0.55, metalness: 0.25 });
    const mutVeinMat = new THREE.MeshStandardMaterial({
      color: 0xff1e2d,
      emissive: 0xdc2626,
      emissiveIntensity: 2.3,
      roughness: 0.22,
    });
    const mutHornMat = new THREE.MeshStandardMaterial({ color: 0xd6c7b2, roughness: 0.45, metalness: 0.1 });
    this.disposableMaterials.push(mutChitinMat, mutVeinMat, mutHornMat);

    for (const m of this.proceduralMeshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.color.getHex() === 0x2d2424 || mat.color.getHex() === 0x6b1d1d) {
        this.phase2FleshMats.push(mat);
      }
    }

    const regMut = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial, parent: THREE.Object3D) => {
      this.disposableGeometries.push(geo);
      const m = new THREE.Mesh(geo, mat.clone());
      this.disposableMaterials.push(m.material as THREE.Material);
      m.castShadow = true;
      m.receiveShadow = true;
      m.visible = false;
      m.scale.setScalar(0.001);
      if (mat === mutVeinMat) {
        this.phase2GlowMats.push(m.material as THREE.MeshStandardMaterial);
      }
      this.phase2MutationPivots.push(m);
      parent.add(m);
      return m;
    };

    for (let s = 0; s < 5; s++) {
      const spire = regMut(new THREE.ConeGeometry(0.11 - s * 0.012, 0.62 - s * 0.05, 5), mutChitinMat, this.torsoPivot);
      spire.position.set(s % 2 === 0 ? -0.14 : 0.14, 0.88 - s * 0.14, -0.34);
      spire.rotation.x = -0.82;
      spire.rotation.z = s % 2 === 0 ? 0.25 : -0.25;
    }
    for (const side of [-1, 1]) {
      const sRidge = regMut(new THREE.DodecahedronGeometry(0.28, 0), mutChitinMat, this.torsoPivot);
      sRidge.position.set(side * 0.56, 0.84, 0.02);
      const sVein = regMut(new THREE.SphereGeometry(0.14, 7, 7), mutVeinMat, this.torsoPivot);
      sVein.position.set(side * 0.58, 0.94, 0.12);
      this.bossPustules.push(sVein);
    }

    const chestFissure = regMut(new THREE.BoxGeometry(0.42, 0.48, 0.18), mutVeinMat, this.torsoPivot);
    chestFissure.position.set(0.0, 0.48, 0.27);

    for (const [hx, hy, hz, rz] of [
      [-0.2, 0.44, -0.02, 0.45],
      [0.2, 0.46, -0.02, -0.45],
      [0.0, 0.48, -0.08, 0.05],
    ]) {
      const crownHorn = regMut(new THREE.ConeGeometry(0.075, 0.46, 5), mutHornMat, this.headPivot);
      crownHorn.position.set(hx, hy, hz);
      crownHorn.rotation.z = rz;
      crownHorn.rotation.x = 0.28;
    }
    const crownEye = regMut(new THREE.BoxGeometry(0.085, 0.06, 0.06), mutVeinMat, this.headPivot);
    crownEye.position.set(0, 0.31, 0.22);

    for (let t = -1; t <= 1; t++) {
      const megaTalon = regMut(new THREE.ConeGeometry(0.065, 0.68, 4), mutHornMat, this.leftArmPivot);
      megaTalon.position.set(-0.02 + t * 0.11, -1.04, 0.34);
      megaTalon.rotation.x = Math.PI + 0.42;
    }
    const armChitin = regMut(new THREE.BoxGeometry(0.34, 0.54, 0.34), mutChitinMat, this.leftArmPivot);
    armChitin.position.set(-0.04, -0.58, 0.12);
    armChitin.rotation.x = -0.45;

    const tendrilWhip = regMut(new THREE.CylinderGeometry(0.055, 0.13, 0.95, 6), mutVeinMat, this.rightArmPivot);
    tendrilWhip.position.set(0.11, -0.78, 0.28);
    tendrilWhip.rotation.x = -0.68;
    const tendrilBarb = regMut(new THREE.ConeGeometry(0.085, 0.48, 5), mutHornMat, this.rightArmPivot);
    tendrilBarb.position.set(0.13, -1.16, 0.56);
    tendrilBarb.rotation.x = Math.PI + 0.65;
  }

  public setWeaknessVisible(visible: boolean): void {
    if (this.weaknessSprite) {
      this.weaknessSprite.visible = visible;
    }
  }

  public getHitboxes(): THREE.Object3D[] {
    if (
      this.state === 'dead' ||
      this.showcaseOnly ||
      this.cinematicControlled ||
      !this.isBossDamageable()
    ) {
      return [];
    }
    return this.isHeadless ? [this.bodyHitbox] : [this.headHitbox, this.bodyHitbox];
  }

  public isBurning(): boolean {
    return this.burnRemainingSec > 0;
  }

  public applyBurn(dps: number, durationSec: number): void {
    if (this.state === 'dead' || this.cinematicControlled || !this.isBossDamageable()) return;
    this.burnDps = Math.max(this.burnDps, dps);
    this.burnRemainingSec = Math.max(this.burnRemainingSec, durationSec);
  }

  private syncBossWeaknessBadge(): void {
    if (this.variant !== 'boss' || !this.weaknessSprite) return;
    const nextType: WeaknessIconType = this.bossRecoveryTimer > 0 ? 'ar' : 'ar_red';
    if (nextType === this.activeBadgeType) return;
    this.activeBadgeType = nextType;
    const mat = this.weaknessSprite.material as THREE.SpriteMaterial;
    mat.map = getWeaknessTexture(nextType);
    mat.needsUpdate = true;
  }

  public isBossDamageable(): boolean {
    if (this.variant !== 'boss') return this.state !== 'dead';
    return (
      this.bossPhaseState === 'PHASE_1_ACTIVE' ||
      this.bossPhaseState === 'PHASE_2_ACTIVE'
    );
  }

  public isBossTransitioning(): boolean {
    if (this.variant !== 'boss') return false;
    return !this.isBossDamageable();
  }

  public isAwaitingResurrection(): boolean {
    return (
      this.variant === 'boss' &&
      (this.bossPhaseState === 'PHASE_1_DEFEATED' ||
        this.bossPhaseState === 'PHASE_1_DEATH_ANIMATION' ||
        this.bossPhaseState === 'PHASE_2_TRANSFORMATION' ||
        this.bossPhaseState === 'PHASE_2_RISING')
    );
  }

  public setBossLifecycleState(next: BossPhaseLifecycleState): boolean {
    if (this.variant !== 'boss' || this.bossPhaseState === next) return false;
    const allowed: Record<BossPhaseLifecycleState, BossPhaseLifecycleState[]> = {
      PHASE_1_ACTIVE: ['PHASE_1_DEFEATED'],
      PHASE_1_DEFEATED: ['PHASE_1_DEATH_ANIMATION'],
      PHASE_1_DEATH_ANIMATION: ['PHASE_2_TRANSFORMATION'],
      PHASE_2_TRANSFORMATION: ['PHASE_2_RISING'],
      PHASE_2_RISING: ['PHASE_2_ACTIVE'],
      PHASE_2_ACTIVE: ['BOSS_DEFEATED'],
      BOSS_DEFEATED: ['BOSS_DEATH_CINEMATIC'],
      BOSS_DEATH_CINEMATIC: [],
    };
    if (!allowed[this.bossPhaseState].includes(next)) {
      return false;
    }
    this.bossPhaseState = next;
    return true;
  }

  public transitionBossState(next: BossState): boolean {
    if (this.variant !== 'boss' || this.bossState === next) return false;
    this.bossState = next;
    return true;
  }

  public forceShowcasePhase2Visuals(): void {
    if (this.variant !== 'boss') return;
    this.bossSuperPhase = 2;
    this.bossPhase = 2;
    this.bossPhaseState = 'PHASE_2_ACTIVE';
    this.bossState = 'PHASE_2_IDLE';
    this.root.scale.setScalar(BOSS_PHASE2_CONFIG.scale);
    for (const m of this.phase2MutationPivots) {
      m.visible = true;
      m.scale.setScalar(1);
    }
    for (const fm of this.phase2FleshMats) {
      fm.color.setHex(0x3a0e12);
    }
    for (const gm of this.phase2GlowMats) {
      gm.emissiveIntensity = 2.4;
    }
  }

  public activatePhase2Combat(): void {
    if (this.variant !== 'boss') return;
    // Ensure sequential state machine catches up safely even if skipped mid-cinematic
    if (this.bossPhaseState === 'PHASE_1_DEFEATED') {
      this.setBossLifecycleState('PHASE_1_DEATH_ANIMATION');
    }
    if (this.bossPhaseState === 'PHASE_1_DEATH_ANIMATION') {
      this.setBossLifecycleState('PHASE_2_TRANSFORMATION');
    }
    if (this.bossPhaseState === 'PHASE_2_TRANSFORMATION') {
      this.setBossLifecycleState('PHASE_2_RISING');
    }
    if (this.bossPhaseState === 'PHASE_2_RISING') {
      this.setBossLifecycleState('PHASE_2_ACTIVE');
    } else {
      this.bossPhaseState = 'PHASE_2_ACTIVE';
    }

    this.bossSuperPhase = 2;
    this.bossPhase = 2;
    this.bossState = 'PHASE_2_IDLE';
    this.state = 'walk';
    this.cinematicControlled = false;
    this.burnRemainingSec = 0;

    // Independent Phase 2 HP Pool initialized at 100% (no carryover from Phase 1)
    const pool = Math.round(BOSS_PHASE2_CONFIG.phaseHealthPools[2] * this.bossHealthMult);
    this.maxHealth = pool;
    this.health = pool;
    this.speed = BOSS_PHASE2_CONFIG.speed;
    this.attackDamage = BOSS_PHASE2_CONFIG.attackDamage;
    this.bossShielded = false;
    this.bossShieldHp = 0;
    if (this.bossShieldMesh) this.bossShieldMesh.visible = false;
    this.bossRecoveryTimer = 0;
    this.bossJumpPhase = 'none';
    this.bossJumpTimer = 0;
    this.bossJumpCooldown = 3.2;
    this.bossSlamTelegraphTimer = 0;
    this.bossChargeWindupTimer = 0;
    this.bossChargeDashTimer = 0;
    this.bossShockwaveWindupTimer = 0;
    this.bossSlamCooldown = 5.4;
    this.bossChargeCooldown = 7.4;
    this.bossShockwaveCooldown = 6.2;
    this.bossTendrilCooldown = 3.6;

    this.root.position.y = 0;
    this.root.scale.setScalar(BOSS_PHASE2_CONFIG.scale);
    this.visualGroup.position.set(0, 0, 0);
    this.visualGroup.rotation.set(0, 0, 0);
    this.torsoPivot.rotation.set(0.24, 0, 0);
    this.headPivot.rotation.set(0, 0, 0.14);
    this.leftArmPivot.rotation.set(-1.1, 0, 0);
    this.rightArmPivot.rotation.set(-0.9, 0, 0);
    this.leftLegPivot.rotation.set(0, 0, 0);
    this.rightLegPivot.rotation.set(0, 0, 0);

    for (const m of this.phase2MutationPivots) {
      m.visible = true;
      m.scale.setScalar(1);
    }
    for (const fm of this.phase2FleshMats) {
      fm.color.setHex(0x3a0e12);
    }
    for (const gm of this.phase2GlowMats) {
      gm.emissiveIntensity = 2.4;
    }
    if (this.weaknessSprite) this.weaknessSprite.visible = true;
    this.syncBossWeaknessBadge();
  }

  public triggerBossJump(
    targetWorld: THREE.Vector3,
    callbacks?: Pick<ZombieUpdateCallbacks, 'onBossJumpPrep' | 'onBossTelegraph'>,
    timing?: { anticipationSec?: number; flightSec?: number; landingSec?: number }
  ): void {
    if (this.variant !== 'boss' || this.bossSuperPhase !== 2) return;
    if (this.bossJumpPhase !== 'none' || this.state === 'dead') return;
    this.bossJumpAnticipationDur = timing?.anticipationSec ?? BOSS_PHASE2_CONFIG.jumpAnticipationSec;
    this.bossJumpFlightDur = timing?.flightSec ?? BOSS_PHASE2_CONFIG.jumpFlightSec;
    this.bossJumpLandingDur = timing?.landingSec ?? 0.34;
    this.bossJumpPhase = 'anticipation';
    this.bossJumpTimer = this.bossJumpAnticipationDur;
    this.bossJumpStart.copy(this.root.position);
    this.bossJumpStart.y = 0;
    this.bossJumpTarget.copy(targetWorld);
    this.bossJumpTarget.y = 0;
    this.bossState = 'PHASE_2_ATTACKING';
    callbacks?.onBossJumpPrep?.();
    callbacks?.onBossTelegraph?.('NIGHTMARE LEAP INCOMING');
  }

  public setRoyalCommandPose(u: number): void {
    if (this.variant !== 'boss') return;
    const t = clamp(u, 0, 1);
    this.torsoPivot.rotation.set(lerp(0.24, -0.14, t), 0, 0);
    this.headPivot.rotation.set(lerp(0, -0.28, t), 0, 0.14);
    this.leftArmPivot.rotation.set(lerp(-1.15, -2.85, t), 0, lerp(0, -0.42, t));
    this.rightArmPivot.rotation.set(lerp(-0.92, -0.45, t), 0, 0.2);
  }

  private clearBossAttackTimers(): void {
    this.bossJumpPhase = 'none';
    this.bossJumpTimer = 0;
    this.bossSlamTelegraphTimer = 0;
    this.bossChargeWindupTimer = 0;
    this.bossChargeDashTimer = 0;
    this.bossShockwaveWindupTimer = 0;
    this.bossRecoveryTimer = 0;
    this.burnRemainingSec = 0;
    this.root.position.y = 0;
    this.visualGroup.position.y = 0;
    if (this.bossSlamRing) this.bossSlamRing.visible = false;
  }

  public applyDamage(
    baseAmount: number,
    source: DamageSourceType,
    isHeadshot: boolean,
    onBossPhaseChanged?: (phase: 1 | 2, shielded: boolean, transitionStarted?: boolean) => void
  ): ZombieDamageApplied {
    if (
      this.state === 'dead' ||
      this.cinematicControlled ||
      !this.isBossDamageable() ||
      this.isAwaitingResurrection() ||
      this.isBossTransitioning()
    ) {
      return { finalDamage: 0, killed: false, effectiveness: 'normal', clampedByFireRule: false };
    }

    const effectiveHeadshot = this.isHeadless ? false : isHeadshot;
    this.lastHitZone = effectiveHeadshot ? 'head' : 'body';

    const calc = calculateZombieDamage(
      this.variant,
      baseAmount,
      source,
      effectiveHeadshot,
      this.health,
      {
        bossCarapaceShielded: false,
        bossExposed: this.variant === 'boss' && this.bossRecoveryTimer > 0,
      }
    );

    if (
      this.variant === 'boss' &&
      this.bossSuperPhase === 2 &&
      (this.bossSlamTelegraphTimer > 0 ||
        this.bossShockwaveWindupTimer > 0 ||
        this.bossJumpPhase === 'anticipation' ||
        this.bossJumpPhase === 'recovery') &&
      effectiveHeadshot
    ) {
      calc.finalDamage = Math.round(calc.finalDamage * 1.25);
    }

    // Clamp applied damage to remaining phase HP (zero overflow across phases)
    const appliedDamage = Math.min(this.health, calc.finalDamage);
    this.health = Math.max(0, this.health - appliedDamage);
    this.hitFlashTimer = calc.clampedByFireRule ? 0.08 : 0.13;

    // Strictly Two-Phase Sequential State Machine (Phase 1 -> Phase 1->2 Cinematic -> Phase 2 -> Defeat)
    if (this.variant === 'boss' && this.health <= 0) {
      this.clearBossAttackTimers();
      this.hitFlashTimer = 0;

      if (this.bossPhaseState === 'PHASE_1_ACTIVE') {
        this.setBossLifecycleState('PHASE_1_DEFEATED');
        this.bossState = 'PHASE_1_DEATH';
        if (this.weaknessSprite) this.weaknessSprite.visible = false;
        onBossPhaseChanged?.(1, false, true);
        return {
          finalDamage: appliedDamage,
          killed: false,
          effectiveness: calc.effectiveness,
          clampedByFireRule: calc.clampedByFireRule,
        };
      }

      if (this.bossPhaseState === 'PHASE_2_ACTIVE') {
        this.setBossLifecycleState('BOSS_DEFEATED');
        this.state = 'dead';
        this.deathTimer = 0;
        this.burnRemainingSec = 0;
        this.bossState = 'FINAL_DEATH';
        if (this.weaknessSprite) this.weaknessSprite.visible = false;
        if (this.bossShieldMesh) this.bossShieldMesh.visible = false;
        if (this.bossSlamRing) this.bossSlamRing.visible = false;
        return {
          finalDamage: appliedDamage,
          killed: true,
          effectiveness: calc.effectiveness,
          clampedByFireRule: calc.clampedByFireRule,
        };
      }
    }

    if (this.health <= 0) {
      this.state = 'dead';
      this.deathTimer = 0;
      this.burnRemainingSec = 0;
      this.root.position.y = 0;
      if (this.weaknessSprite) this.weaknessSprite.visible = false;
      if (this.gltfActions.death) {
        this.gltfActions.walk?.fadeOut(0.15);
        this.gltfActions.attack?.fadeOut(0.15);
        this.gltfActions.death.reset().play();
      }
      return {
        finalDamage: appliedDamage,
        killed: true,
        effectiveness: calc.effectiveness,
        clampedByFireRule: calc.clampedByFireRule,
      };
    }

    if (this.variant !== 'boss' && !calc.clampedByFireRule) {
      this.state = 'hit';
      this.hitStaggerTimer = effectiveHeadshot ? 0.21 : 0.16;
      if (this.gltfActions.hit) {
        this.gltfActions.hit.reset().play();
      }
    }

    return {
      finalDamage: appliedDamage,
      killed: false,
      effectiveness: calc.effectiveness,
      clampedByFireRule: calc.clampedByFireRule,
    };
  }

  public update(
    dtSec: number,
    targetPos: THREE.Vector3,
    attackDistance: number,
    attackCooldownSec: number,
    callbacks: ZombieUpdateCallbacks,
    options?: ZombieUpdateOptions
  ): void {
    this.animTime += dtSec;
    if (this.mixer) {
      this.mixer.update(dtSec);
    }

    if (this.state !== 'dead' && this.burnRemainingSec > 0) {
      this.burnRemainingSec = Math.max(0, this.burnRemainingSec - dtSec);
      this.burnTickAccum += dtSec;
      if (this.burnTickAccum >= 0.35) {
        const tickDt = this.burnTickAccum;
        this.burnTickAccum = 0;
        const dmgRes = this.applyDamage(
          this.burnDps * tickDt,
          'burn',
          false,
          callbacks.onBossPhaseChanged
        );
        callbacks.onBurnTickDamage?.(this, dmgRes.finalDamage, dmgRes.killed);
      }
    }

    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= dtSec;
      for (const m of this.proceduralMeshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x991b1b);
        mat.emissiveIntensity = 1.35;
      }
    } else if (this.burnRemainingSec > 0) {
      const flicker = 0.6 + 0.4 * Math.sin(this.animTime * 24);
      for (const m of this.proceduralMeshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.emissive.setRGB(0.65 * flicker, 0.22 * flicker, 0.02);
        mat.emissiveIntensity = 1.25;
      }
    } else {
      for (const m of this.proceduralMeshes) {
        const mat = m.material as THREE.MeshStandardMaterial;
        const baseHex = (m.userData.baseEmissiveHex as number | undefined) ?? 0x000000;
        const baseInt = (m.userData.baseEmissiveIntensity as number | undefined) ?? 1.0;
        if (mat.emissive.getHex() !== baseHex) {
          mat.emissive.setHex(baseHex);
        }
        mat.emissiveIntensity = baseInt;
      }
    }

    if (this.exploderSacMeshes.length > 0 && this.state !== 'dead') {
      const pulse = 1 + 0.14 * Math.sin(this.animTime * 9.5);
      for (const sac of this.exploderSacMeshes) {
        sac.scale.setScalar(pulse);
      }
    }

    if (this.bossShieldMesh && this.bossShielded) {
      this.bossShieldMesh.rotation.y += dtSec * 1.35;
      this.bossShieldMesh.rotation.x += dtSec * 0.65;
    }
    if (this.bossCoreMesh) {
      const exposedMult = this.bossRecoveryTimer > 0 ? 1.24 : 1.0;
      const glowPulse =
        exposedMult * (1 + 0.16 * Math.sin(this.animTime * (this.bossPhase * 3.8)));
      this.bossCoreMesh.scale.setScalar(glowPulse);
    }
    if (this.bossPustules.length > 0) {
      const pPulse = 1 + 0.12 * Math.sin(this.animTime * 5.2);
      for (const p of this.bossPustules) p.scale.setScalar(pPulse);
    }

    if (this.state === 'dead') {
      if (this.variant === 'exploder' && !this.hasDetonated) {
        this.hasDetonated = true;
        callbacks.onExploderDetonate?.(this.root.position.clone(), this);
      }
      if (this.cinematicControlled) {
        return;
      }
      this.deathTimer += dtSec;
      if (!this.mixer) {
        this.visualGroup.rotation.x = damp(this.visualGroup.rotation.x, -Math.PI / 2, 8, dtSec);
        this.visualGroup.rotation.z = damp(this.visualGroup.rotation.z, this.deathRollDir * 0.22, 7, dtSec);
        this.visualGroup.position.y = damp(
          this.visualGroup.position.y,
          this.variant === 'crawler' ? 0.08 : 0.16,
          8,
          dtSec
        );
      }
      const corpseDur = this.variant === 'boss' ? 2.4 : 1.4;
      if (this.deathTimer >= corpseDur) {
        this.markedForRemoval = true;
      }
      return;
    }

    if (this.attackCooldownTimer > 0) {
      this.attackCooldownTimer -= dtSec;
    }

    const dx = targetPos.x - this.root.position.x;
    const dz = targetPos.z - this.root.position.z;
    const dist = Math.hypot(dx, dz);

    if (this.weaknessSprite && this.weaknessSprite.visible) {
      const base = getWeaknessBaseScale(this.activeBadgeType, this.variant === 'boss');
      const distBoost = Math.min(1.42, Math.max(0.98, 0.96 + dist * 0.017));
      const pulse = 1 + 0.045 * Math.sin(this.animTime * 3.5);
      this.weaknessSprite.scale.set(base.x * distBoost * pulse, base.y * distBoost * pulse, 1);
    }

    if (this.state === 'hit') {
      this.hitStaggerTimer -= dtSec;
      if (!this.mixer) {
        if (this.variant === 'crawler') {
          this.torsoPivot.rotation.x = damp(this.torsoPivot.rotation.x, 0.92, 14, dtSec);
        } else if (this.lastHitZone === 'head') {
          this.torsoPivot.rotation.x = damp(this.torsoPivot.rotation.x, -0.32, 16, dtSec);
          this.headPivot.rotation.x = damp(this.headPivot.rotation.x, -0.58, 18, dtSec);
        } else {
          this.torsoPivot.rotation.x = damp(this.torsoPivot.rotation.x, -0.44, 16, dtSec);
          this.torsoPivot.rotation.z = damp(this.torsoPivot.rotation.z, this.deathRollDir * 0.24, 14, dtSec);
        }
      }
      if (this.hitStaggerTimer <= 0) {
        this.state = 'walk';
      }
      return;
    }

    // Face player
    this.root.rotation.y = Math.atan2(dx, dz);

    // Block AI & attacks when Boss is in a cinematic / transition / defeated state
    if (this.variant === 'boss' && (this.cinematicControlled || !this.isBossDamageable())) {
      this.burnRemainingSec = 0;
      return;
    }

    // Boss Phase 1 & Phase 2 Combat Abilities
    if (this.variant === 'boss') {
      if (this.bossJumpPhase !== 'none') {
        this.updateBossJump(dtSec, callbacks);
        return;
      }

      if (options?.bossExternalMoveHandled) {
        return;
      }

      if (this.bossRecoveryTimer > 0) {
        this.bossRecoveryTimer -= dtSec;
        if (this.bossRecoveryTimer <= 0) {
          this.syncBossWeaknessBadge();
          if (this.bossSuperPhase === 2) {
            this.bossState = 'PHASE_2_IDLE';
          }
        }
        this.torsoPivot.rotation.x = damp(this.torsoPivot.rotation.x, 0.48, 9, dtSec);
        this.headPivot.rotation.x = damp(this.headPivot.rotation.x, 0.28, 9, dtSec);
        this.leftArmPivot.rotation.x = damp(this.leftArmPivot.rotation.x, -0.35, 8, dtSec);
        this.rightArmPivot.rotation.x = damp(this.rightArmPivot.rotation.x, -0.45, 8, dtSec);
        return;
      }

      if (this.bossSlamTelegraphTimer > 0) {
        this.bossSlamTelegraphTimer -= dtSec;
        if (this.bossSlamRing) {
          this.bossSlamRing.visible = true;
          const s = 1 + (1 - Math.max(0, this.bossSlamTelegraphTimer) / 1.45) * 1.65;
          this.bossSlamRing.scale.setScalar(s);
        }
        this.leftArmPivot.rotation.x = damp(this.leftArmPivot.rotation.x, -2.75, 12, dtSec);
        this.rightArmPivot.rotation.x = damp(this.rightArmPivot.rotation.x, -2.25, 12, dtSec);
        this.torsoPivot.rotation.x = damp(this.torsoPivot.rotation.x, -0.15, 10, dtSec);
        if (this.bossSlamTelegraphTimer <= 0) {
          if (this.bossSlamRing) this.bossSlamRing.visible = false;
          this.attackAnimTimer = 0.48;
          this.bossRecoveryTimer = 1.45;
          this.syncBossWeaknessBadge();
          const slamDmg =
            this.bossSuperPhase === 2 ? BOSS_PHASE2_CONFIG.slamDamage : 22;
          callbacks.onBossSlamHit?.(slamDmg, this.root.position.clone());
        }
        return;
      }

      if (this.bossShockwaveWindupTimer > 0) {
        this.bossShockwaveWindupTimer -= dtSec;
        this.torsoPivot.rotation.x = damp(this.torsoPivot.rotation.x, -0.28, 10, dtSec);
        this.leftArmPivot.rotation.x = damp(this.leftArmPivot.rotation.x, -2.55, 11, dtSec);
        this.rightArmPivot.rotation.x = damp(this.rightArmPivot.rotation.x, -2.4, 11, dtSec);
        if (this.bossShockwaveWindupTimer <= 0) {
          this.attackAnimTimer = 0.45;
          this.bossRecoveryTimer = 1.2;
          this.syncBossWeaknessBadge();
          const origin = this.root.position.clone().add(new THREE.Vector3(0, 0.25, 0.9));
          callbacks.onBossShockwave?.(origin, BOSS_PHASE2_CONFIG.shockwaveDamage);
        }
        return;
      }

      if (this.bossChargeWindupTimer > 0) {
        this.bossChargeWindupTimer -= dtSec;
        this.torsoPivot.rotation.x = damp(this.torsoPivot.rotation.x, -0.22, 10, dtSec);
        this.headPivot.rotation.x = damp(this.headPivot.rotation.x, -0.25, 10, dtSec);
        if (this.bossChargeWindupTimer <= 0) {
          this.bossChargeDashTimer = this.bossSuperPhase === 2 ? 1.3 : 1.15;
        }
        return;
      }

      this.bossSlamCooldown -= dtSec;
      this.bossChargeCooldown -= dtSec;
      this.bossSpitCooldown -= dtSec;
      this.bossShockwaveCooldown -= dtSec;
      this.bossTendrilCooldown -= dtSec;
      if (this.bossSuperPhase === 2) {
        this.bossJumpCooldown -= dtSec;
      }

      // Phase 2 Parabolic Jump Attack trigger
      const canAutoJump =
        (options?.bossAllowAutoJump ?? this.bossAllowAutoJump) && this.bossSuperPhase === 2;
      if (
        canAutoJump &&
        this.bossChargeDashTimer <= 0 &&
        this.bossJumpCooldown <= 0 &&
        dist >= 4.5
      ) {
        this.bossJumpCooldown = lerp(
          BOSS_PHASE2_CONFIG.jumpMinCooldownSec,
          BOSS_PHASE2_CONFIG.jumpMaxCooldownSec,
          Math.random()
        );
        const jumpDest = options?.bossJumpTargetOverride
          ? options.bossJumpTargetOverride.clone()
          : this.computeSafeJumpLandingNear(targetPos);
        this.triggerBossJump(jumpDest, callbacks);
        return;
      }

      if (this.bossChargeDashTimer <= 0 && this.bossSlamCooldown <= 0 && dist < 12.5) {
        this.bossSlamCooldown = this.bossSuperPhase === 2 ? 6.2 : 8.0;
        this.bossSlamTelegraphTimer = 1.45;
        if (this.bossSuperPhase === 2) this.bossState = 'PHASE_2_ATTACKING';
        callbacks.onBossTelegraph?.(
          this.bossSuperPhase === 2 ? 'HEAVY MUTATED SLAM' : 'SEISMIC TITAN SLAM'
        );
        return;
      }

      if (
        this.bossSuperPhase === 2 &&
        this.bossChargeDashTimer <= 0 &&
        this.bossShockwaveCooldown <= 0 &&
        dist >= 6.0
      ) {
        this.bossShockwaveCooldown = 7.4;
        this.bossShockwaveWindupTimer = 1.25;
        this.bossState = 'PHASE_2_ATTACKING';
        callbacks.onBossTelegraph?.('GROUND SHOCKWAVE');
        return;
      }

      if (
        this.bossChargeDashTimer <= 0 &&
        this.bossChargeCooldown <= 0 &&
        dist >= 7.0 &&
        dist <= 23.0
      ) {
        this.bossChargeCooldown = this.bossSuperPhase === 2 ? 8.4 : 10.2;
        this.bossChargeWindupTimer = 0.9;
        if (this.bossSuperPhase === 2) this.bossState = 'PHASE_2_ATTACKING';
        callbacks.onBossTelegraph?.(
          this.bossSuperPhase === 2 ? 'MUTATED NIGHTMARE CHARGE' : 'HEAVY TITAN CHARGE'
        );
        return;
      }

      if (this.bossSuperPhase === 2 && this.bossChargeDashTimer <= 0 && this.bossTendrilCooldown <= 0 && dist > 5.0) {
        this.bossTendrilCooldown = 4.0;
        const origin = this.root.position.clone().add(new THREE.Vector3(0.45, 2.75, 0.35));
        callbacks.onBossTendrilAttack?.(origin, BOSS_PHASE2_CONFIG.tendrilSpikeDamage, 2);
      } else if (this.bossSuperPhase === 1 && this.bossChargeDashTimer <= 0 && this.bossSpitCooldown <= 0 && dist > 6.5) {
        this.bossSpitCooldown = 4.6;
        const origin = this.root.position.clone().add(new THREE.Vector3(0, 3.05, 0));
        callbacks.onBossProjectile?.(origin, 12);
      }
    }

    const effectiveAttackDist =
      this.variant === 'boss'
        ? attackDistance + 1.55
        : this.variant === 'crawler'
        ? attackDistance * 0.88
        : attackDistance;

    let actualMoveSpeed = 0;

    if (dist <= effectiveAttackDist) {
      if (this.variant === 'boss' && this.bossChargeDashTimer > 0) {
        this.bossChargeDashTimer = 0;
        this.bossRecoveryTimer = 1.25;
        this.syncBossWeaknessBadge();
      }
      if (this.variant === 'exploder' && !this.hasDetonated) {
        this.hasDetonated = true;
        this.health = 0;
        this.state = 'dead';
        if (this.weaknessSprite) this.weaknessSprite.visible = false;
        callbacks.onExploderDetonate?.(this.root.position.clone(), this);
        return;
      }

      this.state = 'attack';
      if (this.attackCooldownTimer <= 0) {
        this.attackCooldownTimer =
          this.variant === 'boss' ? attackCooldownSec * 1.1 : attackCooldownSec;
        this.attackAnimTimer = 0.35;
        if (this.gltfActions.attack) {
          this.gltfActions.attack.reset().play();
        }
        callbacks.onAttackHit(this.attackDamage);
      }
    } else {
      this.state = 'walk';
      let activeMoveSpeed =
        this.variant === 'boss' && options?.bossSpeedOverride
          ? options.bossSpeedOverride
          : this.speed;
      if (this.variant === 'boss' && this.bossChargeDashTimer > 0) {
        this.bossChargeDashTimer -= dtSec;
        activeMoveSpeed = activeMoveSpeed * 1.85;
        if (this.bossChargeDashTimer <= 0) {
          this.bossRecoveryTimer = 1.25;
          this.syncBossWeaknessBadge();
        }
      }
      const moveStep = Math.min(dist - effectiveAttackDist * 0.9, activeMoveSpeed * dtSec);
      actualMoveSpeed = dtSec > 0 ? moveStep / dtSec : activeMoveSpeed;
      if (dist > 0.01) {
        this.root.position.x += (dx / dist) * moveStep;
        this.root.position.z += (dz / dist) * moveStep;
      }
    }

    if (!this.mixer) {
      this.animateProceduralLocomotion(dtSec, actualMoveSpeed);
    }
  }

  private computeSafeJumpLandingNear(targetPos: THREE.Vector3): THREE.Vector3 {
    const dx = targetPos.x - this.root.position.x;
    const dz = targetPos.z - this.root.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    // Land menacingly ~4.8m from target rather than overlapping camera
    const travel = Math.max(2.5, Math.min(16, dist - 4.8));
    return new THREE.Vector3(
      clamp(this.root.position.x + (dx / dist) * travel, -13.5, 13.5),
      0,
      clamp(this.root.position.z + (dz / dist) * travel, -34.5, -5.5)
    );
  }

  private updateBossJump(dtSec: number, callbacks: ZombieUpdateCallbacks): void {
    this.bossJumpTimer -= dtSec;

    if (this.bossJumpPhase === 'anticipation') {
      const dur = Math.max(0.05, this.bossJumpAnticipationDur);
      const u = clamp(1 - this.bossJumpTimer / dur, 0, 1);
      // Crisp predator crouch & coil before launch
      this.visualGroup.position.y = lerp(0, -0.24, u);
      this.torsoPivot.rotation.x = lerp(0.18, 0.52, u);
      this.leftLegPivot.rotation.x = lerp(0, -0.45, u);
      this.rightLegPivot.rotation.x = lerp(0, -0.42, u);
      this.leftArmPivot.rotation.x = lerp(-1.1, 0.45, u);
      this.rightArmPivot.rotation.x = lerp(-0.9, 0.35, u);

      const jDx = this.bossJumpTarget.x - this.root.position.x;
      const jDz = this.bossJumpTarget.z - this.root.position.z;
      this.root.rotation.y = Math.atan2(jDx, jDz);

      if (this.bossJumpTimer <= 0) {
        this.bossJumpPhase = 'airborne';
        this.bossJumpTimer = this.bossJumpFlightDur;
        this.visualGroup.position.y = 0;
        callbacks.onBossJumpLaunch?.();
      }
      return;
    }

    if (this.bossJumpPhase === 'airborne') {
      const dur = Math.max(0.05, this.bossJumpFlightDur);
      const u = clamp(1 - this.bossJumpTimer / dur, 0, 1);
      // True horizontal travel + parabolic vertical apex (NO teleportation)
      this.root.position.x = lerp(this.bossJumpStart.x, this.bossJumpTarget.x, u);
      this.root.position.z = lerp(this.bossJumpStart.z, this.bossJumpTarget.z, u);
      this.root.position.y = 4 * BOSS_PHASE2_CONFIG.jumpArcHeight * u * (1 - u);

      // Predatory airborne claw spread
      this.torsoPivot.rotation.x = lerp(0.15, 0.48, u);
      this.leftArmPivot.rotation.x = lerp(-2.45, -1.75, u);
      this.rightArmPivot.rotation.x = lerp(-2.15, -1.65, u);
      this.leftLegPivot.rotation.x = -0.35 + Math.sin(u * Math.PI) * 0.45;
      this.rightLegPivot.rotation.x = 0.25 - Math.sin(u * Math.PI) * 0.45;

      if (this.bossJumpTimer <= 0) {
        this.root.position.copy(this.bossJumpTarget);
        this.root.position.y = 0;
        this.bossJumpPhase = 'landing';
        this.bossJumpTimer = this.bossJumpLandingDur;
        callbacks.onBossJumpLand?.(BOSS_PHASE2_CONFIG.jumpDamage, this.root.position.clone());
      }
      return;
    }

    if (this.bossJumpPhase === 'landing') {
      const dur = Math.max(0.05, this.bossJumpLandingDur);
      const u = clamp(1 - this.bossJumpTimer / dur, 0, 1);
      // Crushing impact crouch settle & clean upright recovery
      this.visualGroup.position.y = -Math.sin(u * Math.PI) * 0.24;
      this.torsoPivot.rotation.x = lerp(0.54, 0.16, u);
      this.leftArmPivot.rotation.x = lerp(-0.55, -0.95, u);
      this.rightArmPivot.rotation.x = lerp(-0.5, -0.85, u);
      if (this.bossJumpTimer <= 0) {
        this.visualGroup.position.y = 0;
        this.visualGroup.rotation.set(0, 0, 0);
        this.torsoPivot.rotation.set(0.16, 0, 0);
        this.bossJumpPhase = 'none';
        this.bossRecoveryTimer = BOSS_PHASE2_CONFIG.jumpRecoverySec;
        this.syncBossWeaknessBadge();
      }
    }
  }

  private animateProceduralLocomotion(dtSec: number, actualMoveSpeed: number): void {
    // 1. Dedicated Ground Crawler Locomotion (arm-pull crawl synchronized strictly to speed)
    if (this.variant === 'crawler') {
      const crawlRate = this.state === 'walk' ? Math.max(1.2, actualMoveSpeed * 2.35) : 0.8;
      this.stridePhase += dtSec * crawlRate;
      const pull = this.state === 'walk' ? Math.sin(this.stridePhase) : 0;
      const oppPull = this.state === 'walk' ? Math.cos(this.stridePhase) : 0;

      // Hand-over-hand ground pull + body drag twist
      this.torsoPivot.rotation.x = 1.28 + Math.abs(pull) * 0.08;
      this.torsoPivot.rotation.z = pull * 0.22;
      this.visualGroup.position.y = Math.abs(pull) * 0.045;

      if (this.attackAnimTimer > 0) {
        this.attackAnimTimer -= dtSec;
        const lunge = Math.sin((this.attackAnimTimer / 0.35) * Math.PI);
        this.torsoPivot.rotation.x = 1.28 - lunge * 0.42;
        this.visualGroup.position.y = lunge * 0.24;
        this.leftArmPivot.rotation.x = -1.9 - lunge * 0.7;
        this.rightArmPivot.rotation.x = -1.9 - lunge * 0.7;
      } else {
        this.leftArmPivot.rotation.x = -1.35 + pull * 0.75;
        this.rightArmPivot.rotation.x = -1.35 - pull * 0.75;
        this.leftArmPivot.rotation.z = -0.18 + oppPull * 0.14;
        this.rightArmPivot.rotation.z = 0.18 - oppPull * 0.14;
      }

      // Trailing mangled legs drag asynchronously behind
      this.leftLegPivot.rotation.z = pull * 0.16;
      this.rightLegPivot.rotation.z = -pull * 0.12;
      this.headPivot.rotation.x = -1.05 + Math.sin(this.animTime * 4.2) * 0.08;
      this.headPivot.rotation.z = Math.cos(this.animTime * 3.1) * 0.15;
      return;
    }

    // 2. Biped Asymmetric Limps & Abnormal Horror Gaits
    const isBoss = this.variant === 'boss';
    const isBossCharging = isBoss && this.bossChargeDashTimer > 0;
    const speedRatio =
      this.state === 'walk'
        ? Math.max(0.45, actualMoveSpeed / Math.max(0.4, ZOMBIE_STATS[this.variant].speed))
        : 0;

    const baseFreq = isBoss
      ? isBossCharging
        ? 4.6
        : 2.3 * Math.max(1, speedRatio * 0.55)
      : (this.variant === 'runner' ? 8.2 : 4.6 * this.strideScale) * (this.state === 'walk' ? speedRatio : 0);

    this.stridePhase += dtSec * baseFreq;
    const stride = this.state === 'walk' ? Math.sin(this.stridePhase) : 0;

    let leftLegMult = 1.0;
    let rightLegMult = 1.0;
    let torsoRollBias = 0;
    let hipDrop = 0;

    if (this.gait === 'limp_left') {
      leftLegMult = 0.42;
      torsoRollBias = -0.14;
      hipDrop = Math.max(0, -stride) * 0.075;
    } else if (this.gait === 'limp_right' || this.hasMissingLeg) {
      rightLegMult = this.hasMissingLeg ? 0.34 : 0.44;
      torsoRollBias = this.hasMissingLeg ? 0.2 : 0.13;
      hipDrop = Math.max(0, stride) * (this.hasMissingLeg ? 0.11 : 0.075);
    } else if (this.gait === 'drag_foot') {
      rightLegMult = 0.28;
      torsoRollBias = 0.11;
      hipDrop = Math.abs(stride) * 0.04;
    } else if (this.gait === 'stumble') {
      const stumblePulse = Math.max(0, Math.sin(this.animTime * 1.45 + this.uidNum) - 0.65) * 2.8;
      torsoRollBias = Math.sin(this.animTime * 9.0) * 0.12 * stumblePulse;
      hipDrop = stumblePulse * 0.05;
    }

    this.visualGroup.position.y = -hipDrop;
    this.leftLegPivot.rotation.x = stride * (isBoss ? 0.44 : 0.58) * leftLegMult;
    this.rightLegPivot.rotation.x = -stride * (isBoss ? 0.38 : 0.56) * rightLegMult;
    this.torsoPivot.rotation.z =
      Math.cos(this.stridePhase * 0.5) * (isBoss ? 0.12 : 0.1) + torsoRollBias;

    if (this.attackAnimTimer > 0) {
      this.attackAnimTimer -= dtSec;
      const lunge = Math.sin((this.attackAnimTimer / 0.35) * Math.PI);
      this.torsoPivot.rotation.x = 0.25 + lunge * 0.35;
      if (this.hasLeftArm) {
        this.leftArmPivot.rotation.x = -1.65 - lunge * (this.hasRightArm ? 0.65 : 0.92);
      }
      if (this.hasRightArm) {
        this.rightArmPivot.rotation.x = -1.65 - lunge * (this.hasLeftArm ? 0.52 : 0.92);
      }
    } else {
      this.torsoPivot.rotation.x = damp(this.torsoPivot.rotation.x, this.baseHunch, 8, dtSec);
      const lArmReach = this.animVariant === 3 ? -1.52 : isBoss ? -1.15 : -1.32;
      const rArmReach =
        this.animVariant === 2 ? -0.32 : isBoss ? -0.92 : -1.38; // animVariant 2 = dead hanging right arm
      if (this.hasLeftArm) {
        this.leftArmPivot.rotation.x =
          lArmReach + Math.sin(this.animTime * (isBoss ? 1.8 : 3.2)) * 0.15;
      } else {
        this.leftArmPivot.rotation.x = -0.18 + Math.sin(this.animTime * 2.1) * 0.06;
      }
      if (this.hasRightArm) {
        this.rightArmPivot.rotation.x =
          rArmReach + Math.cos(this.animTime * (isBoss ? 2.1 : 2.8)) * (this.animVariant === 2 ? 0.06 : 0.16);
      } else {
        this.rightArmPivot.rotation.x = -0.16 + Math.cos(this.animTime * 2.1) * 0.06;
      }
    }

    if (!this.isHeadless) {
      const twitchGate = Math.max(0, Math.sin(this.animTime * 1.15 + this.uidNum) - 0.72) * 3.5;
      const headTwitch = Math.sin(this.animTime * 19.0) * 0.11 * twitchGate;
      this.headPivot.rotation.z =
        this.neckRestZ + Math.sin(this.animTime * 2.1) * 0.08 + headTwitch;
      this.headPivot.rotation.y = Math.cos(this.animTime * 1.65) * 0.11;
    }
  }

  /**
   * Drives menacing slow heavy approach walk toward target coordinates (used before Boss Confrontation).
   */
  public setBossApproachLocomotion(
    dtSec: number,
    speed: number,
    targetX: number,
    targetZ: number
  ): { distanceRemaining: number; footstepTriggered: boolean } {
    const dx = targetX - this.root.position.x;
    const dz = targetZ - this.root.position.z;
    const dist = Math.hypot(dx, dz);
    this.root.rotation.y = Math.atan2(dx, dz);
    this.state = dist > 0.12 ? 'walk' : 'attack';

    const prevPhase = this.stridePhase;
    const step = Math.min(dist, speed * dtSec);
    if (dist > 0.01) {
      this.root.position.x += (dx / dist) * step;
      this.root.position.z += (dz / dist) * step;
    }

    this.stridePhase += dtSec * 3.1;
    const stride = Math.sin(this.stridePhase);
    const footstepTriggered =
      Math.floor(prevPhase / Math.PI) !== Math.floor(this.stridePhase / Math.PI) && dist > 0.15;

    this.visualGroup.position.y = -Math.abs(stride) * 0.09;
    this.leftLegPivot.rotation.x = stride * 0.44;
    this.rightLegPivot.rotation.x = -stride * 0.4;
    this.torsoPivot.rotation.set(0.2 + Math.abs(stride) * 0.06, 0, Math.cos(this.stridePhase * 0.5) * 0.09);
    this.headPivot.rotation.set(-0.08, Math.sin(this.animTime * 1.4) * 0.06, 0.14);
    this.leftArmPivot.rotation.x = -1.05 - stride * 0.25;
    this.rightArmPivot.rotation.x = -0.88 + stride * 0.25;
    return { distanceRemaining: Math.max(0, dist - step), footstepTriggered };
  }

  /**
   * Dramatic pre-chase confrontation pose: stops, arches back, raises mutated claws & roars.
   */
  public setBossConfrontationStance(u: number): void {
    const t = clamp(u, 0, 1);
    const ease = t * t * (3 - 2 * t);
    this.visualGroup.position.y = 0;
    this.leftLegPivot.rotation.x = 0.08 * ease;
    this.rightLegPivot.rotation.x = -0.1 * ease;
    this.torsoPivot.rotation.set(lerp(0.24, -0.26, ease), Math.sin(t * 14) * 0.04, 0);
    this.headPivot.rotation.set(lerp(0, -0.45, ease), 0, 0.14);
    this.leftArmPivot.rotation.set(lerp(-1.05, -2.85, ease), 0, lerp(0, -0.52, ease));
    this.rightArmPivot.rotation.set(lerp(-0.88, -2.55, ease), 0, lerp(0, 0.48, ease));
  }

  /**
   * Beat 4 near-capture terrifying forward lunge & reaching mutated claws behind fleeing survivor.
   */
  public setBossChaseLungePose(u: number): void {
    const t = clamp(u, 0, 1);
    const swipe = Math.sin(t * Math.PI * 2.2);
    this.visualGroup.position.y = -0.1;
    this.torsoPivot.rotation.set(0.36, swipe * 0.18, swipe * 0.1);
    this.headPivot.rotation.set(-0.18, 0, 0.16);
    this.leftArmPivot.rotation.set(-2.25 - swipe * 0.55, 0, -0.35);
    this.rightArmPivot.rotation.set(-2.05 + swipe * 0.5, 0, 0.35);
    this.leftLegPivot.rotation.x = Math.sin(t * 10) * 0.42;
    this.rightLegPivot.rotation.x = -Math.sin(t * 10) * 0.42;
  }

  /**
   * Home Screen Boss Phase 2 Showcase Shot 4:
   * Continuous jump arc + airborne claw flare + landing crouch.
   */
  public setShowcaseJumpProgress(
    p: number,
    startPos: THREE.Vector3,
    targetPos: THREE.Vector3
  ): void {
    const t = clamp(p, 0, 1);
    this.visualGroup.rotation.set(0, 0, 0);
    if (t < 0.25) {
      const u = t / 0.25;
      this.root.position.copy(startPos);
      this.visualGroup.position.y = lerp(0, -0.22, u);
      this.torsoPivot.rotation.set(lerp(0.12, 0.42, u), 0, 0);
      this.leftArmPivot.rotation.set(lerp(-0.95, 0.45, u), 0, -0.24);
      this.rightArmPivot.rotation.set(lerp(-0.85, 0.35, u), 0, 0.24);
    } else if (t < 0.82) {
      const u = (t - 0.25) / 0.57;
      this.visualGroup.position.y = 0;
      this.root.position.x = lerp(startPos.x, targetPos.x, u);
      this.root.position.z = lerp(startPos.z, targetPos.z, u);
      this.root.position.y = 4 * 5.2 * u * (1 - u);
      this.torsoPivot.rotation.set(lerp(0.12, 0.34, u), 0, 0);
      this.leftArmPivot.rotation.set(-2.25, 0, -0.42);
      this.rightArmPivot.rotation.set(-1.95, 0, 0.4);
      this.leftLegPivot.rotation.x = -0.32;
      this.rightLegPivot.rotation.x = 0.28;
    } else {
      const u = (t - 0.82) / 0.18;
      this.root.position.copy(targetPos);
      this.root.position.y = 0;
      this.visualGroup.position.y = -Math.sin(u * Math.PI) * 0.22;
      this.torsoPivot.rotation.set(lerp(0.36, 0.10, u), 0, 0);
      this.leftArmPivot.rotation.set(lerp(-0.65, -0.95, u), 0, -0.24);
      this.rightArmPivot.rotation.set(lerp(-0.58, -0.85, u), 0, 0.24);
    }
  }

  public setCinematicDeathProgress(p: number): void {
    const t = Math.max(0, Math.min(1, p));
    this.root.position.y = 0;
    if (this.weaknessSprite) this.weaknessSprite.visible = false;
    if (this.bossShieldMesh) this.bossShieldMesh.visible = false;
    if (this.bossSlamRing) this.bossSlamRing.visible = false;

    for (const m of this.proceduralMeshes) {
      (m.material as THREE.MeshStandardMaterial).emissive.setHex(0x000000);
    }

    if (this.bossCoreMesh) {
      const flicker =
        t < 0.65
          ? 0.9 + 0.35 * Math.abs(Math.sin(t * 48))
          : Math.max(0.05, 1 - (t - 0.65) * 3.2);
      this.bossCoreMesh.scale.setScalar(flicker);
    }

    if (t < 0.18) {
      const u = t / 0.18;
      this.visualGroup.position.set(0, 0, 0);
      this.visualGroup.rotation.set(0, 0, 0);
      this.torsoPivot.rotation.set(-0.28 * Math.sin(u * Math.PI * 0.7), 0, 0.12 * u);
      this.headPivot.rotation.set(-0.42 * u, 0.24 * Math.sin(u * 12), 0.26);
      this.leftArmPivot.rotation.set(-2.1 * u, 0, -0.45 * u);
      this.rightArmPivot.rotation.set(-1.5 * u, 0, 0.38 * u);
      this.leftLegPivot.rotation.x = 0.08 * u;
      this.rightLegPivot.rotation.x = -0.1 * u;
    } else if (t < 0.38) {
      const u = (t - 0.18) / 0.2;
      this.torsoPivot.rotation.set(0.18 + u * 0.16, Math.sin(u * 6) * 0.14, 0.14 - u * 0.24);
      this.headPivot.rotation.set(0.18, Math.sin(u * 9) * 0.2, -0.18 + u * 0.32);
      this.leftArmPivot.rotation.set(-0.85, 0.45, 0.35);
      this.rightArmPivot.rotation.set(-1.1, -0.35, -0.2);
      this.leftLegPivot.rotation.x = 0.22 * u;
      this.rightLegPivot.rotation.x = -0.25 * u;
    } else if (t < 0.56) {
      const u = (t - 0.38) / 0.18;
      this.visualGroup.position.set(0, -0.34 * u, 0);
      this.visualGroup.rotation.set(0.16 * u, 0, 0.08 * u);
      this.torsoPivot.rotation.set(0.45 + 0.15 * u, 0, -0.12);
      this.leftLegPivot.rotation.x = 0.65 * u;
      this.rightLegPivot.rotation.x = 0.55 * u;
      this.leftArmPivot.rotation.set(-0.55, 0, -0.32);
      this.rightArmPivot.rotation.set(-0.65, 0, 0.25);
    } else if (t < 0.70) {
      const u = (t - 0.56) / 0.14;
      const easeIn = u * u;
      this.visualGroup.position.set(0, -0.34 + 0.5 * easeIn, 0.35 * easeIn);
      this.visualGroup.rotation.set(0.16 - 1.72 * easeIn, 0, 0.08 + 0.14 * easeIn);
      this.torsoPivot.rotation.set(0.6 * (1 - easeIn * 0.6), 0, -0.1);
      this.leftArmPivot.rotation.set(-1.35 * easeIn, 0, -0.4);
      this.rightArmPivot.rotation.set(-0.95 * easeIn, 0, 0.35);
    } else if (t < 0.82) {
      const u = (t - 0.7) / 0.12;
      const bounce = Math.sin(u * Math.PI) * 0.06 * (1 - u);
      this.visualGroup.position.set(0, 0.18 + bounce, 0.35);
      this.visualGroup.rotation.set(-Math.PI / 2 - 0.04, 0, 0.22);
      this.torsoPivot.rotation.set(0.22, 0, -0.08);
      this.leftArmPivot.rotation.set(-1.35 + bounce * 3, 0, -0.45);
      this.rightArmPivot.rotation.set(-0.95, 0, 0.38);
      this.headPivot.rotation.set(0.15, 0.12, 0.2);
    } else if (t < 0.91) {
      const u = (t - 0.82) / 0.09;
      const twitch = Math.sin(u * Math.PI * 2) * 0.18 * (1 - u);
      this.visualGroup.position.set(0, 0.18, 0.35);
      this.visualGroup.rotation.set(-Math.PI / 2 - 0.04, 0, 0.22);
      this.leftArmPivot.rotation.set(-1.35 + twitch, 0, -0.45 - twitch * 0.4);
      this.headPivot.rotation.set(0.15 + twitch * 0.4, 0.12, 0.2 + twitch * 0.5);
    } else {
      this.visualGroup.position.set(0, 0.18, 0.35);
      this.visualGroup.rotation.set(-Math.PI / 2 - 0.04, 0, 0.22);
      this.leftArmPivot.rotation.set(-1.35, 0, -0.45);
      this.rightArmPivot.rotation.set(-0.95, 0, 0.38);
      this.headPivot.rotation.set(0.15, 0.12, 0.2);
    }
  }

  public setStage4IntroPose(turnU: number, commandU: number): void {
    if (this.variant !== 'boss') return;
    const t = clamp(turnU, 0, 1);
    const c = clamp(commandU, 0, 1);
    // Slowly turns from angled throne stance toward player, then raises in intimidating command
    this.root.rotation.y = lerp(-1.15, 0, t * t * (3 - 2 * t));
    this.torsoPivot.rotation.set(lerp(0.24, -0.14, c), 0, 0);
    this.headPivot.rotation.set(lerp(0.08, -0.26, c), lerp(0.18, 0, t), 0.14);
    this.leftArmPivot.rotation.set(lerp(-0.95, -2.65, c), 0, lerp(0, -0.42, c));
    this.rightArmPivot.rotation.set(lerp(-0.82, -0.48, c), 0, 0.22);
  }

  public setPhase1HitReactionPose(u: number): void {
    const t = clamp(u, 0, 1);
    const snap = Math.sin(t * Math.PI);
    this.root.position.y = 0;
    this.root.scale.setScalar(ZOMBIE_STATS.boss.scale);
    if (this.weaknessSprite) this.weaknessSprite.visible = false;
    this.visualGroup.position.set(0, 0, -snap * 0.14);
    this.visualGroup.rotation.set(0, 0, snap * 0.08);
    this.torsoPivot.rotation.set(0.24 - snap * 0.44, Math.sin(t * 20) * 0.08, 0.12 * snap);
    this.headPivot.rotation.set(-0.46 * snap, Math.sin(t * 16) * 0.24, 0.14 + snap * 0.18);
    this.leftArmPivot.rotation.set(-1.1 - snap * 1.15, 0, -0.42 * snap);
    this.rightArmPivot.rotation.set(-0.9 - snap * 0.95, 0, 0.36 * snap);
    this.leftLegPivot.rotation.x = 0.12 * snap;
    this.rightLegPivot.rotation.x = -0.14 * snap;
  }

  public setPhase1FallPose(u: number): void {
    const t = clamp(u, 0, 1);
    this.root.position.y = 0;
    this.root.scale.setScalar(ZOMBIE_STATS.boss.scale);
    if (this.weaknessSprite) this.weaknessSprite.visible = false;
    if (this.bossShieldMesh) this.bossShieldMesh.visible = false;
    if (this.bossSlamRing) this.bossSlamRing.visible = false;
    if (this.bossCoreMesh) this.bossCoreMesh.scale.setScalar(lerp(0.9, 0.08, t));

    if (t < 0.35) {
      // Lean forward & knees buckle
      const p = t / 0.35;
      const ease = p * p * (3 - 2 * p);
      this.visualGroup.position.set(0, -0.34 * ease, 0);
      this.visualGroup.rotation.set(0.14 * ease, 0, 0.08 * ease);
      this.torsoPivot.rotation.set(lerp(0.24, 0.62, ease), 0, -0.08 * ease);
      this.headPivot.rotation.set(lerp(-0.1, 0.32, ease), 0, 0.16);
      this.leftLegPivot.rotation.x = 0.65 * ease;
      this.rightLegPivot.rotation.x = 0.56 * ease;
      this.leftArmPivot.rotation.set(lerp(-1.1, -0.55, ease), 0, -0.25);
      this.rightArmPivot.rotation.set(lerp(-0.9, -0.62, ease), 0, 0.25);
    } else if (t < 0.72) {
      // Arms drop & heavy body crashes onto the arena floor
      const p = (t - 0.35) / 0.37;
      const easeIn = p * p;
      this.visualGroup.position.set(0, lerp(-0.34, 0.18, easeIn), 0.35 * easeIn);
      this.visualGroup.rotation.set(lerp(0.14, -Math.PI / 2 - 0.04, easeIn), 0, lerp(0.08, 0.22, easeIn));
      this.torsoPivot.rotation.set(lerp(0.62, 0.22, easeIn), 0, -0.08);
      this.headPivot.rotation.set(0.18, 0.12, 0.2);
      this.leftArmPivot.rotation.set(lerp(-0.55, -1.35, easeIn), 0, -0.45);
      this.rightArmPivot.rotation.set(lerp(-0.62, -0.95, easeIn), 0, 0.38);
      this.leftLegPivot.rotation.x = lerp(0.65, 0.08, easeIn);
      this.rightLegPivot.rotation.x = lerp(0.56, -0.08, easeIn);
    } else {
      // Heavy ground impact settle — visibly fallen on floor
      const p = (t - 0.72) / 0.28;
      const bounce = Math.sin(p * Math.PI) * 0.07 * (1 - p);
      this.visualGroup.position.set(0, 0.18 + bounce, 0.35);
      this.visualGroup.rotation.set(-Math.PI / 2 - 0.04, 0, 0.22);
      this.torsoPivot.rotation.set(0.22, 0, -0.08);
      this.headPivot.rotation.set(0.16, 0.12, 0.2);
      this.leftArmPivot.rotation.set(-1.35 + bounce * 2.5, 0, -0.45);
      this.rightArmPivot.rotation.set(-0.95 + bounce * 2.0, 0, 0.38);
      this.leftLegPivot.rotation.x = 0.06;
      this.rightLegPivot.rotation.x = -0.06;
    }
  }

  public setPhase2GroundTransformPose(u: number): void {
    const t = clamp(u, 0, 1);
    const ease = t * t * (3 - 2 * t);
    this.bossState = 'MUTATION_ANIMATION';
    this.root.position.y = 0;
    this.root.scale.setScalar(lerp(ZOMBIE_STATS.boss.scale, 2.96, ease));
    if (this.weaknessSprite) this.weaknessSprite.visible = false;

    // Remain lying flat on the arena floor while body violently mutates
    const spasm = Math.sin(t * 38) * 0.14 * clamp(t * 1.8, 0, 1);
    const heave = Math.abs(Math.sin(t * 14)) * 0.09;
    this.visualGroup.position.set(0, 0.18 + heave * 0.6, 0.35);
    this.visualGroup.rotation.set(-Math.PI / 2 - 0.04 + ease * 0.12, 0, 0.22 + spasm * 0.16);
    this.torsoPivot.rotation.set(0.22 + heave * 1.4, 0, -0.08 + spasm * 0.7);
    this.headPivot.rotation.set(0.16 - ease * 0.55, Math.sin(t * 24) * 0.28, 0.2 + spasm);
    this.leftArmPivot.rotation.set(-1.35 + Math.sin(t * 30) * 0.35, 0, -0.45 - ease * 0.2);
    this.rightArmPivot.rotation.set(-0.95 + Math.cos(t * 27) * 0.32, 0, 0.38 + ease * 0.2);

    const mutScale = clamp(lerp(0.02, 0.62, ease), 0.01, 1);
    for (const m of this.phase2MutationPivots) {
      m.visible = true;
      m.scale.setScalar(mutScale);
    }
    for (const fm of this.phase2FleshMats) {
      fm.color.setRGB(lerp(0.18, 0.23, ease), lerp(0.14, 0.06, ease), lerp(0.14, 0.08, ease));
    }
    for (const gm of this.phase2GlowMats) {
      gm.emissiveIntensity = lerp(0.4, 1.95, ease);
    }
    if (this.bossCoreMesh) {
      this.bossCoreMesh.scale.setScalar(lerp(0.12, 1.05, ease) + Math.abs(spasm) * 0.35);
    }
  }

  public setPhase2RisingPose(u: number): void {
    const t = clamp(u, 0, 1);
    this.bossState = 'FINAL_FORM_REVEAL';
    this.root.position.y = 0;
    this.root.scale.setScalar(lerp(2.96, BOSS_PHASE2_CONFIG.scale, t));
    if (this.weaknessSprite) this.weaknessSprite.visible = false;

    const mutScale = clamp(lerp(0.62, 1.0, t), 0.1, 1);
    for (const m of this.phase2MutationPivots) {
      m.visible = true;
      m.scale.setScalar(mutScale);
    }
    for (const fm of this.phase2FleshMats) {
      fm.color.setHex(0x3a0e12);
    }
    for (const gm of this.phase2GlowMats) {
      gm.emissiveIntensity = lerp(1.95, 2.55, t);
    }

    if (t < 0.38) {
      // Hands brace against the floor and push upper torso upward
      const p = t / 0.38;
      const ease = p * p * (3 - 2 * p);
      this.visualGroup.position.set(0, lerp(0.18, 0.06, ease), lerp(0.35, 0.14, ease));
      this.visualGroup.rotation.set(lerp(-Math.PI / 2 + 0.08, -0.78, ease), 0, lerp(0.22, 0.08, ease));
      this.torsoPivot.rotation.set(lerp(0.28, 0.56, ease), 0, 0);
      this.headPivot.rotation.set(lerp(-0.32, 0.18, ease), 0, 0.14);
      this.leftArmPivot.rotation.set(lerp(-1.45, -0.82, ease), 0, -0.35);
      this.rightArmPivot.rotation.set(lerp(-1.25, -0.78, ease), 0, 0.35);
      this.leftLegPivot.rotation.x = lerp(0.08, 0.38, ease);
      this.rightLegPivot.rotation.x = lerp(-0.08, 0.25, ease);
    } else if (t < 0.78) {
      // Push up into full standing mutated posture, shoulders expanding & head lifting
      const p = (t - 0.38) / 0.4;
      const ease = p * p * (3 - 2 * p);
      this.visualGroup.position.set(0, lerp(0.06, 0, ease), lerp(0.14, 0, ease));
      this.visualGroup.rotation.set(lerp(-0.78, 0, ease), 0, lerp(0.08, 0, ease));
      this.torsoPivot.rotation.set(lerp(0.56, 0.2, ease), 0, Math.sin(t * 22) * 0.05);
      this.headPivot.rotation.set(lerp(0.18, -0.24, ease), 0, 0.14);
      this.leftArmPivot.rotation.set(lerp(-0.82, -1.85, ease), 0, lerp(-0.35, -0.48, ease));
      this.rightArmPivot.rotation.set(lerp(-0.78, -1.65, ease), 0, lerp(0.35, 0.44, ease));
      this.leftLegPivot.rotation.x = lerp(0.38, 0, ease);
      this.rightLegPivot.rotation.x = lerp(0.25, 0, ease);
    } else {
      // Towering roar stance
      const p = (t - 0.78) / 0.22;
      const roar = Math.sin(p * Math.PI * 0.65);
      this.visualGroup.position.set(0, 0, 0);
      this.visualGroup.rotation.set(0, 0, 0);
      this.torsoPivot.rotation.set(0.2 - roar * 0.38, 0, Math.sin(t * 28) * 0.04);
      this.headPivot.rotation.set(-0.24 - roar * 0.25, 0, 0.14);
      this.leftArmPivot.rotation.set(-1.85 - roar * 0.55, 0, -0.52);
      this.rightArmPivot.rotation.set(-1.65 - roar * 0.5, 0, 0.48);
    }
    if (this.bossCoreMesh) {
      this.bossCoreMesh.scale.setScalar(1.15 + 0.2 * Math.sin(t * 20));
    }
  }

  public setPhase2RevealPose(u: number): void {
    const t = clamp(u, 0, 1);
    this.bossState = 'FINAL_FORM_REVEAL';
    this.root.position.y = 0;
    this.root.scale.setScalar(BOSS_PHASE2_CONFIG.scale);
    this.visualGroup.position.set(0, 0, 0);
    this.visualGroup.rotation.set(0, 0, 0);
    for (const m of this.phase2MutationPivots) {
      m.visible = true;
      m.scale.setScalar(1);
    }
    for (const fm of this.phase2FleshMats) {
      fm.color.setHex(0x3a0e12);
    }
    for (const gm of this.phase2GlowMats) {
      gm.emissiveIntensity = 2.4 + 0.4 * Math.sin(t * 16);
    }
    const roarArch = Math.sin(clamp(t * 1.15, 0, 1) * Math.PI);
    this.torsoPivot.rotation.set(0.22 - roarArch * 0.34, 0, Math.sin(t * 20) * 0.04);
    this.headPivot.rotation.set(-0.36 * roarArch, Math.sin(t * 5) * 0.12, 0.14);
    this.leftArmPivot.rotation.set(-2.15 - roarArch * 0.35, 0, -0.48);
    this.rightArmPivot.rotation.set(-1.95 - roarArch * 0.32, 0, 0.45);
    this.leftLegPivot.rotation.x = 0.08;
    this.rightLegPivot.rotation.x = -0.08;
    if (this.bossCoreMesh) {
      this.bossCoreMesh.scale.setScalar(1.22 + 0.18 * Math.sin(t * 24));
    }
  }

  public setResurrectionPhaseProgress(
    stage: 'apparent' | 'twitch' | 'mutate' | 'reveal',
    u: number
  ): void {
    if (stage === 'apparent') {
      this.bossState = 'APPARENT_DEATH';
      this.setPhase1FallPose(1);
    } else if (stage === 'twitch') {
      this.bossState = 'RESURRECTION_START';
      this.setPhase2GroundTransformPose(u * 0.55);
    } else if (stage === 'mutate') {
      this.setPhase2RisingPose(u);
    } else {
      this.setPhase2RevealPose(u);
    }
  }

  public getDebugPosture(): {
    torsoPitchRad: number;
    visualPitchRad: number;
    visualY: number;
    worldY: number;
    leftLegPitchRad: number;
    rightLegPitchRad: number;
  } {
    return {
      torsoPitchRad: this.torsoPivot.rotation.x,
      visualPitchRad: this.visualGroup.rotation.x,
      visualY: this.visualGroup.position.y,
      worldY: this.root.position.y,
      leftLegPitchRad: this.leftLegPivot.rotation.x,
      rightLegPitchRad: this.rightLegPivot.rotation.x,
    };
  }

  /**
   * Dedicated upright predator sprint animation for the isolated Home Screen Showcase
   * and Stage 4 Chase runner. Keeps torso upright & anatomical without per-frame pitch wind-up.
   * Does NOT affect standard Stage 4 Boss combat locomotion (animateProceduralLocomotion).
   */
  public animateShowcaseUprightRun(
    dtSec: number,
    moveSpeed: number,
    roarPulse01 = 0,
    reachPulse01 = 0
  ): void {
    this.animTime += dtSec;
    this.state = 'walk';
    const strideRate = Math.max(4.4, moveSpeed * 1.95);
    this.stridePhase += dtSec * strideRate;
    const stride = Math.sin(this.stridePhase);
    const stepLift = Math.abs(stride);

    // Strictly upright body frame: slight forward athletic predator lean, zero cumulative pitch!
    this.root.position.y = 0;
    this.visualGroup.rotation.set(0, 0, 0);
    this.visualGroup.position.set(0, stepLift * 0.08, 0);

    this.torsoPivot.rotation.x = lerp(0.10, -0.14, clamp(roarPulse01, 0, 1));
    this.torsoPivot.rotation.y = -stride * 0.14;
    this.torsoPivot.rotation.z = Math.cos(this.stridePhase * 0.5) * 0.045;

    // Strong counter-driven leg stride synced to world movement speed
    this.leftLegPivot.rotation.set(stride * 0.72, 0, 0);
    this.rightLegPivot.rotation.set(-stride * 0.72, 0, 0);

    // Natural counter-swinging shoulders + claw reach & mid-pursuit roars
    const reach = clamp(reachPulse01, 0, 1);
    const roar = clamp(roarPulse01, 0, 1);
    this.headPivot.rotation.set(lerp(-0.08, -0.34, roar), Math.sin(this.animTime * 2.2) * 0.07, 0.05);
    this.leftArmPivot.rotation.set(lerp(-0.92 - reach * 0.45 - stride * 0.65, -2.05, roar), 0, -0.22);
    this.rightArmPivot.rotation.set(lerp(-0.82 - reach * 0.4 + stride * 0.65, -1.95, roar), 0, 0.22);

    if (this.bossCoreMesh) {
      this.bossCoreMesh.scale.setScalar(1.15 + 0.18 * Math.sin(this.animTime * 4.5));
    }
    if (this.bossPustules.length > 0) {
      const pPulse = 1 + 0.14 * Math.sin(this.animTime * 5.6);
      for (const p of this.bossPustules) p.scale.setScalar(pPulse);
    }
    for (const gm of this.phase2GlowMats) {
      gm.emissiveIntensity = 2.0 + 0.65 * Math.sin(this.animTime * 5.2);
    }
  }

  public animateShowcasePursuit(
    dtSec: number,
    moveSpeed: number,
    roarPulse01 = 0,
    reachPulse01 = 0
  ): void {
    this.animateShowcaseUprightRun(dtSec, moveSpeed, roarPulse01, reachPulse01);
  }

  public updateShowcase(dtSec: number, baseYaw = 0): void {
    this.animTime += dtSec;
    this.root.rotation.y = baseYaw + Math.sin(this.animTime * 0.35 + this.uidNum) * 0.08;

    if (this.bossCoreMesh) {
      this.bossCoreMesh.scale.setScalar(1 + 0.14 * Math.sin(this.animTime * 3.4));
    }
    if (this.bossPustules.length > 0) {
      const pPulse = 1 + 0.12 * Math.sin(this.animTime * 4.5);
      for (const p of this.bossPustules) p.scale.setScalar(pPulse);
    }
    if (this.exploderSacMeshes.length > 0) {
      const pulse = 1 + 0.12 * Math.sin(this.animTime * 6.5);
      for (const sac of this.exploderSacMeshes) sac.scale.setScalar(pulse);
    }

    if (this.variant === 'crawler') {
      const pulse = Math.sin(this.animTime * 3.2 + this.uidNum);
      this.torsoPivot.rotation.x = 1.28 + pulse * 0.05;
      this.leftArmPivot.rotation.x = -1.35 + pulse * 0.18;
      this.rightArmPivot.rotation.x = -1.35 - pulse * 0.18;
      this.headPivot.rotation.x = -1.05 + Math.cos(this.animTime * 2.1) * 0.08;
      return;
    }

    if (this.variant === 'boss') {
      const isPhase2 = this.bossSuperPhase === 2;
      const breath = Math.sin(this.animTime * (isPhase2 ? 2.6 : 1.75) + this.uidNum);
      if (!isPhase2) {
        // Phase 1 King: Aggressive impatient breathing, periodic stomp + crusher slam warning
        const stompCycle = (this.animTime * 0.48) % 1;
        const stompLift =
          stompCycle > 0.72 && stompCycle < 0.88
            ? Math.sin(((stompCycle - 0.72) / 0.16) * Math.PI)
            : 0;
        const slamWave =
          stompCycle >= 0.86
            ? Math.sin(((stompCycle - 0.86) / 0.14) * Math.PI)
            : 0;
        this.torsoPivot.rotation.x = 0.22 + breath * 0.065 - stompLift * 0.18 + slamWave * 0.28;
        this.torsoPivot.rotation.z = Math.cos(this.animTime * 1.1) * 0.05;
        this.headPivot.rotation.z = 0.14 + Math.sin(this.animTime * 1.9) * 0.08;
        this.headPivot.rotation.y = Math.sin(this.animTime * 0.85) * 0.28;
        this.headPivot.rotation.x = -stompLift * 0.22 + slamWave * 0.18;
        this.leftArmPivot.rotation.x = -0.68 - stompLift * 1.45 + slamWave * 0.7 + breath * 0.1;
        this.rightArmPivot.rotation.x = -0.48 + breath * 0.08 - stompLift * 0.4;
        this.leftLegPivot.rotation.x = -stompLift * 0.65;
        this.rightLegPivot.rotation.x = 0.06;
        this.visualGroup.position.y = -slamWave * 0.08;
      } else {
        // Phase 2 Mutated King: Deep predator crouch, claw slash swipes & impatient forward lunge
        const slashCycle = (this.animTime * 0.56 + 0.35) % 1;
        const slashSwing =
          slashCycle > 0.65 ? Math.sin(((slashCycle - 0.65) / 0.35) * Math.PI) : 0;
        for (const gm of this.phase2GlowMats) {
          gm.emissiveIntensity = 1.9 + 0.7 * Math.sin(this.animTime * 4.8);
        }
        this.torsoPivot.rotation.x = 0.38 + breath * 0.075 - slashSwing * 0.35;
        this.torsoPivot.rotation.y = Math.sin(slashSwing * Math.PI) * 0.28;
        this.torsoPivot.rotation.z = Math.sin(this.animTime * 1.5) * 0.08;
        this.headPivot.rotation.z = 0.14 + Math.sin(this.animTime * 2.4) * 0.1;
        this.headPivot.rotation.y = Math.cos(this.animTime * 1.15) * 0.32;
        this.headPivot.rotation.x = -0.18 + breath * 0.08;
        this.leftArmPivot.rotation.x = -1.15 - slashSwing * 1.15 + breath * 0.12;
        this.leftArmPivot.rotation.z = -0.22 - slashSwing * 0.35;
        this.rightArmPivot.rotation.x = -0.95 - slashSwing * 0.75 - breath * 0.1;
        this.rightArmPivot.rotation.z = 0.2 + slashSwing * 0.3;
        this.leftLegPivot.rotation.x = 0.22;
        this.rightLegPivot.rotation.x = -0.24;
        this.visualGroup.position.z = slashSwing * 0.45;
        this.visualGroup.position.y = -0.1 + Math.abs(breath) * 0.03;
      }
      return;
    }

    const breathFreq = this.variant === 'runner' ? 3.2 : 2.0;
    const breath = Math.sin(this.animTime * breathFreq + this.uidNum);
    const twitchWindow = Math.max(0, Math.sin(this.animTime * 0.85 + this.uidNum * 1.7) - 0.78) * 4.5;
    const twitch = Math.sin(this.animTime * 22) * 0.13 * twitchWindow;

    this.torsoPivot.rotation.x = this.baseHunch + breath * 0.055;
    this.torsoPivot.rotation.z = Math.cos(this.animTime * 0.9 + this.uidNum) * 0.06;

    if (!this.isHeadless) {
      this.headPivot.rotation.z = this.neckRestZ + Math.sin(this.animTime * 1.4 + this.uidNum) * 0.09 + twitch;
      this.headPivot.rotation.y = Math.sin(this.animTime * 0.7 + this.uidNum) * 0.18;
      this.headPivot.rotation.x = Math.cos(this.animTime * 1.1) * 0.06;
    }

    if (this.hasLeftArm) {
      this.leftArmPivot.rotation.x = -0.52 + breath * 0.08 + twitch * 0.4;
    }
    if (this.hasRightArm) {
      this.rightArmPivot.rotation.x = -0.38 - breath * 0.07;
    }
    this.leftLegPivot.rotation.x = 0.06;
    this.rightLegPivot.rotation.x = -0.06;
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.root);
    for (const g of this.disposableGeometries) g.dispose();
    for (const m of this.disposableMaterials) m.dispose();
  }
}
