import type { WeaponId } from './weapons';

export type ZombieVariant =
  | 'basic'
  | 'runner'
  | 'armored'
  | 'mutated'
  | 'exploder'
  | 'crawler'
  | 'boss';

export type AnatomyVariant =
  | 'standard'
  | 'exposed_ribs'
  | 'missing_left_arm'
  | 'missing_right_arm'
  | 'missing_leg'
  | 'headless'
  | 'crawler_mutant';

export type DamageSourceType = WeaponId | 'burn' | 'blast';

export type WeaknessIconType =
  | 'none'
  | 'ar'
  | 'smg'
  | 'flamethrower'
  | 'grenade'
  | 'ar_red';

export type WeaknessCategoryColor = 'none' | 'blue' | 'red' | 'white' | 'white_red';

export function getWeaknessCategoryColor(icon: WeaknessIconType): WeaknessCategoryColor {
  switch (icon) {
    case 'smg':
      return 'blue';
    case 'flamethrower':
    case 'grenade':
      return 'red';
    case 'ar':
      return 'white';
    case 'ar_red':
      return 'white_red';
    default:
      return 'none';
  }
}

export interface ZombieStatsConfig {
  label: string;
  health: number;
  speed: number;
  attackDamage: number;
  scale: number;
  scoreBonus: number;
  weaknessIcon: WeaknessIconType;
  /**
   * When true, non-fire bullet damage (AR/SMG) cannot drop health below 1 HP.
   * Only Flamethrower / Burn damage can eliminate this zombie.
   */
  fireWeakOnlyKillable: boolean;
  multipliers: Record<DamageSourceType, number>;
  headshotMultipliers?: Partial<Record<DamageSourceType, number>>;
}

export const ZOMBIE_STATS: Record<ZombieVariant, ZombieStatsConfig> = {
  basic: {
    label: 'Walker',
    health: 75,
    speed: 2.2,
    attackDamage: 11,
    scale: 1.0,
    scoreBonus: 0,
    weaknessIcon: 'none',
    fireWeakOnlyKillable: false,
    multipliers: {
      ar: 1.0,
      smg: 1.0,
      flamethrower: 1.1,
      grenade: 1.2,
      burn: 1.0,
      blast: 1.0,
    },
  },
  runner: {
    label: 'Runner',
    health: 58,
    speed: 4.1,
    attackDamage: 9,
    scale: 0.94,
    scoreBonus: 45,
    weaknessIcon: 'smg',
    fireWeakOnlyKillable: false,
    multipliers: {
      ar: 0.85,
      smg: 1.85,
      flamethrower: 1.05,
      grenade: 1.25,
      burn: 1.0,
      blast: 1.0,
    },
  },
  armored: {
    label: 'Armored Riot',
    health: 165,
    speed: 1.8,
    attackDamage: 18,
    scale: 1.12,
    scoreBonus: 110,
    weaknessIcon: 'ar_red',
    fireWeakOnlyKillable: false,
    multipliers: {
      ar: 1.45,
      smg: 0.38,
      flamethrower: 0.55,
      grenade: 1.35,
      burn: 0.55,
      blast: 1.1,
    },
    headshotMultipliers: {
      ar: 2.1,
      smg: 0.65,
    },
  },
  mutated: {
    label: 'Bio-Mutant',
    health: 150,
    speed: 2.55,
    attackDamage: 20,
    scale: 1.18,
    scoreBonus: 150,
    weaknessIcon: 'flamethrower',
    fireWeakOnlyKillable: true,
    multipliers: {
      ar: 0.22,
      smg: 0.16,
      flamethrower: 2.35,
      grenade: 0.65,
      burn: 1.45,
      blast: 0.6,
    },
  },
  exploder: {
    label: 'Volatile Exploder',
    health: 88,
    speed: 3.15,
    attackDamage: 34,
    scale: 1.06,
    scoreBonus: 120,
    weaknessIcon: 'grenade',
    fireWeakOnlyKillable: false,
    multipliers: {
      ar: 1.15,
      smg: 1.05,
      flamethrower: 0.9,
      grenade: 2.1,
      burn: 0.95,
      blast: 1.5,
    },
  },
  crawler: {
    label: 'Ground Crawler',
    health: 52,
    speed: 2.75,
    attackDamage: 12,
    scale: 0.96,
    scoreBonus: 65,
    weaknessIcon: 'smg',
    fireWeakOnlyKillable: false,
    multipliers: {
      ar: 1.05,
      smg: 1.75,
      flamethrower: 1.35,
      grenade: 1.55,
      burn: 1.25,
      blast: 1.2,
    },
  },
  boss: {
    label: 'THE KING · SUBJECT ALPHA',
    health: 850,
    speed: 1.25,
    attackDamage: 24,
    scale: 2.85,
    scoreBonus: 3200,
    weaknessIcon: 'ar_red',
    fireWeakOnlyKillable: false,
    multipliers: {
      ar: 1.18,
      smg: 0.62,
      flamethrower: 0.92,
      grenade: 1.5,
      burn: 0.9,
      blast: 1.08,
    },
    headshotMultipliers: {
      ar: 1.7,
      smg: 0.8,
    },
  },
};

export const BOSS_PHASE2_CONFIG = {
  name: 'THE KING · SUBJECT ALPHA',
  health: 1100,
  phaseHealthPools: {
    1: 850,
    2: 1100,
  } as Record<1 | 2, number>,
  speed: 1.38,
  chaseSpeed: 6.35,
  attackDamage: 28,
  scale: 3.1,
  scoreBonus: 3200,
  slamDamage: 25,
  chargeDamage: 22,
  shockwaveDamage: 18,
  tendrilSpikeDamage: 14,
  jumpDamage: 22,
  jumpImpactRadius: 7.4,
  jumpMinCooldownSec: 5.5,
  jumpMaxCooldownSec: 8.2,
  jumpAnticipationSec: 0.85,
  jumpFlightSec: 1.05,
  jumpArcHeight: 6.4,
  jumpRecoverySec: 1.35,
  chaseSprintSpeed: 7.1,
  chaseLegDurationSec: 14.0,
  chaseVulnerabilitySec: 5.0,
} as const;

export const BOSS_PHASE2_TRANSITION_CONFIG = {
  approachDurationSec: 1.75,
  approachSpeed: 6.4,
  intimidationDurationSec: 0.65,
  jumpPrepDurationSec: 0.55,
  firstJumpDurationSec: 0.95,
  landingRecoveryDurationSec: 0.38,
  chaseSpeed: 7.35,
  chaseWaypointArrivalRadius: 0.65,
} as const;

export interface DamageCalculationResult {
  finalDamage: number;
  effectiveness: 'weak' | 'normal' | 'resisted';
  clampedByFireRule: boolean;
}

/**
 * Centralized damage effectiveness & resistance calculation.
 * Ensures UI weakness badges match actual gameplay math.
 */
export function calculateZombieDamage(
  variant: ZombieVariant,
  baseDamage: number,
  source: DamageSourceType,
  isHeadshot: boolean,
  currentHealth: number,
  options?: { bossCarapaceShielded?: boolean; bossExposed?: boolean }
): DamageCalculationResult {
  const cfg = ZOMBIE_STATS[variant];
  let mult = cfg.multipliers[source] ?? 1.0;

  if (isHeadshot && cfg.headshotMultipliers && cfg.headshotMultipliers[source] !== undefined) {
    mult = cfg.headshotMultipliers[source]!;
  }

  // Boss Phase 2/3 bio-carapace: flames & grenades melt the shield rapidly; bullets are reduced
  if (variant === 'boss' && options?.bossCarapaceShielded) {
    if (source === 'flamethrower' || source === 'burn') {
      mult *= 2.1;
    } else if (source === 'grenade') {
      mult *= 1.65;
    } else {
      mult *= 0.35;
    }
  } else if (variant === 'boss' && options?.bossExposed) {
    // Post-slam / post-charge recovery window exposes the Titan Bio-Core
    mult *= 1.25;
  }

  const rawDamage = Math.max(1, Math.round(baseDamage * mult));
  let finalDamage = rawDamage;
  let clampedByFireRule = false;

  // Fire-weak mutated zombies cannot be killed by ordinary ballistic or non-fire hits
  if (cfg.fireWeakOnlyKillable && source !== 'flamethrower' && source !== 'burn') {
    if (currentHealth <= 1) {
      finalDamage = 0;
      clampedByFireRule = true;
    } else if (currentHealth - finalDamage < 1) {
      finalDamage = currentHealth - 1;
      clampedByFireRule = true;
    }
  }

  const effectiveness: 'weak' | 'normal' | 'resisted' =
    mult >= 1.35 ? 'weak' : mult <= 0.65 || clampedByFireRule ? 'resisted' : 'normal';

  return {
    finalDamage,
    effectiveness,
    clampedByFireRule,
  };
}
