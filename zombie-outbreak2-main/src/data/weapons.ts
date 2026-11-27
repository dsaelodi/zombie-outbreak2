export type WeaponId = 'ar' | 'smg' | 'flamethrower' | 'grenade';

export type WeaponFireMode = 'auto' | 'stream' | 'throw';

export interface WeaponDefinition {
  id: WeaponId;
  slot: 1 | 2 | 3 | 4;
  name: string;
  shortName: string;
  role: string;
  fireMode: WeaponFireMode;
  damage: number;
  headshotMultiplier: number;
  fireRateMs: number;
  magazineSize: number;
  reloadDurationMs: number;
  effectiveRange: number;
  burnDps?: number;
  burnDurationSec?: number;
  explosionRadius?: number;
  cooldownMs?: number;
  fuseSec?: number;
  accentColor: string;
}

export const WEAPON_ORDER: WeaponId[] = ['ar', 'smg', 'flamethrower', 'grenade'];

export const WEAPONS: Record<WeaponId, WeaponDefinition> = {
  ar: {
    id: 'ar',
    slot: 1,
    name: 'Assault Rifle',
    shortName: 'M4A1 AR',
    role: 'Balanced / Armor-Piercing',
    fireMode: 'auto',
    damage: 34,
    headshotMultiplier: 1.8,
    fireRateMs: 175,
    magazineSize: 28,
    reloadDurationMs: 1450,
    effectiveRange: 110,
    accentColor: '#d97706',
  },
  smg: {
    id: 'smg',
    slot: 2,
    name: 'SMG',
    shortName: 'MP5 SMG',
    role: 'High RPM / Anti-Runner',
    fireMode: 'auto',
    damage: 18,
    headshotMultiplier: 1.45,
    fireRateMs: 95,
    magazineSize: 30,
    reloadDurationMs: 1200,
    effectiveRange: 72,
    accentColor: '#38bdf8',
  },
  flamethrower: {
    id: 'flamethrower',
    slot: 3,
    name: 'Flamethrower',
    shortName: 'M2 FLAMER',
    role: 'Fire Stream / Anti-Mutant',
    fireMode: 'stream',
    damage: 13,
    headshotMultiplier: 1.15,
    fireRateMs: 105,
    magazineSize: 100,
    reloadDurationMs: 1650,
    effectiveRange: 15,
    burnDps: 20,
    burnDurationSec: 3.5,
    accentColor: '#f97316',
  },
  grenade: {
    id: 'grenade',
    slot: 4,
    name: 'Frag Grenade',
    shortName: 'M67 FRAG',
    role: 'AOE Explosive',
    fireMode: 'throw',
    damage: 210,
    headshotMultiplier: 1.0,
    fireRateMs: 350,
    magazineSize: 5,
    reloadDurationMs: 0,
    effectiveRange: 30,
    explosionRadius: 6.8,
    cooldownMs: 3000,
    fuseSec: 1.15,
    accentColor: '#ef4444',
  },
};

export interface WeaponSlotRuntime {
  ammo: number;
  magazineSize: number;
  isReloading: boolean;
  reloadRemainingMs: number;
  cooldownRemainingMs: number;
}
