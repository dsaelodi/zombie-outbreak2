import type { EventBus } from '../../core/EventBus';
import { DEFAULT_GAME_CONFIG } from '../../data/gameConfig';
import {
  WEAPON_ORDER,
  WEAPONS,
  type WeaponDefinition,
  type WeaponId,
  type WeaponSlotRuntime,
} from '../../data/weapons';

export type ReloadAudioPhase = 'mag_out' | 'mag_in' | 'bolt_rack';

interface ReloadPhaseTracker {
  ammoCredited: boolean;
  magOutFired: boolean;
  magInFired: boolean;
  boltRackFired: boolean;
}

export class WeaponManager {
  private activeWeapon: WeaponId = 'ar';
  private slots: Record<WeaponId, WeaponSlotRuntime>;
  private phaseTrackers: Record<WeaponId, ReloadPhaseTracker>;

  constructor(private readonly events: EventBus) {
    this.slots = this.createInitialSlots();
    this.phaseTrackers = this.createPhaseTrackers();
  }

  private createPhaseTrackers(): Record<WeaponId, ReloadPhaseTracker> {
    return {
      ar: { ammoCredited: false, magOutFired: false, magInFired: false, boltRackFired: false },
      smg: { ammoCredited: false, magOutFired: false, magInFired: false, boltRackFired: false },
      flamethrower: { ammoCredited: false, magOutFired: false, magInFired: false, boltRackFired: false },
      grenade: { ammoCredited: false, magOutFired: false, magInFired: false, boltRackFired: false },
    };
  }

  private createInitialSlots(): Record<WeaponId, WeaponSlotRuntime> {
    return {
      ar: {
        ammo: WEAPONS.ar.magazineSize,
        magazineSize: WEAPONS.ar.magazineSize,
        isReloading: false,
        reloadRemainingMs: 0,
        cooldownRemainingMs: 0,
      },
      smg: {
        ammo: WEAPONS.smg.magazineSize,
        magazineSize: WEAPONS.smg.magazineSize,
        isReloading: false,
        reloadRemainingMs: 0,
        cooldownRemainingMs: 0,
      },
      flamethrower: {
        ammo: WEAPONS.flamethrower.magazineSize,
        magazineSize: WEAPONS.flamethrower.magazineSize,
        isReloading: false,
        reloadRemainingMs: 0,
        cooldownRemainingMs: 0,
      },
      grenade: {
        ammo: WEAPONS.grenade.magazineSize,
        magazineSize: WEAPONS.grenade.magazineSize,
        isReloading: false,
        reloadRemainingMs: 0,
        cooldownRemainingMs: 0,
      },
    };
  }

  public resetAll(): void {
    this.activeWeapon = 'ar';
    this.slots = this.createInitialSlots();
    this.phaseTrackers = this.createPhaseTrackers();
  }

  public prepareForNextStage(preserveAmmo: boolean, bonusGrenades: number): void {
    this.phaseTrackers = this.createPhaseTrackers();
    if (!preserveAmmo) {
      this.slots = this.createInitialSlots();
    } else {
      for (const id of WEAPON_ORDER) {
        const s = this.slots[id];
        s.isReloading = false;
        s.reloadRemainingMs = 0;
        s.cooldownRemainingMs = 0;
        if (id !== 'grenade') {
          s.ammo = Math.max(s.ammo, Math.ceil(s.magazineSize * 0.6));
        } else {
          s.ammo = Math.min(s.magazineSize, s.ammo + bonusGrenades);
        }
      }
    }
  }

  public getActiveWeaponId(): WeaponId {
    return this.activeWeapon;
  }

  public getActiveDefinition(): WeaponDefinition {
    return WEAPONS[this.activeWeapon];
  }

  public getSlot(id: WeaponId = this.activeWeapon): WeaponSlotRuntime {
    return this.slots[id];
  }

  public getAllSlots(): Record<WeaponId, WeaponSlotRuntime> {
    return this.slots;
  }

  public getReloadProgress(id: WeaponId = this.activeWeapon): number {
    const slot = this.slots[id];
    if (!slot.isReloading) return 0;
    const total = Math.max(1, WEAPONS[id].reloadDurationMs);
    return Math.max(0, Math.min(1, 1 - slot.reloadRemainingMs / total));
  }

  public switchWeapon(next: WeaponId): boolean {
    if (this.activeWeapon === next) return false;
    this.activeWeapon = next;
    this.events.emit('weapon:switched', { weaponId: next });
    return true;
  }

  public startReload(onReloadStart?: () => void): boolean {
    if (this.activeWeapon === 'grenade') return false;
    const slot = this.slots[this.activeWeapon];
    if (slot.isReloading || slot.ammo >= slot.magazineSize) return false;
    slot.isReloading = true;
    slot.reloadRemainingMs = WEAPONS[this.activeWeapon].reloadDurationMs;
    this.phaseTrackers[this.activeWeapon] = {
      ammoCredited: false,
      magOutFired: false,
      magInFired: false,
      boltRackFired: false,
    };
    this.events.emit('weapon:reload_start', { weaponId: this.activeWeapon });
    onReloadStart?.();
    return true;
  }

  public update(
    dtSec: number,
    onReloadComplete?: () => void,
    onReloadPhase?: (weaponId: WeaponId, phase: ReloadAudioPhase) => void
  ): void {
    const dtMs = dtSec * 1000;
    for (const id of WEAPON_ORDER) {
      const slot = this.slots[id];
      if (slot.cooldownRemainingMs > 0) {
        slot.cooldownRemainingMs = Math.max(0, slot.cooldownRemainingMs - dtMs);
      }
      if (slot.isReloading) {
        slot.reloadRemainingMs -= dtMs;
        const total = Math.max(1, WEAPONS[id].reloadDurationMs);
        const progress = Math.max(0, Math.min(1, 1 - slot.reloadRemainingMs / total));
        const tracker = this.phaseTrackers[id];

        if (!tracker.magOutFired && progress >= 0.14) {
          tracker.magOutFired = true;
          if (id === this.activeWeapon) onReloadPhase?.(id, 'mag_out');
        }
        if (!tracker.magInFired && progress >= 0.62) {
          tracker.magInFired = true;
          if (id === this.activeWeapon) onReloadPhase?.(id, 'mag_in');
        }
        // Synchronized ammo credit right when magazine/canister locks in (~72%)
        if (!tracker.ammoCredited && progress >= 0.72) {
          tracker.ammoCredited = true;
          slot.ammo = slot.magazineSize;
        }
        if (!tracker.boltRackFired && progress >= 0.84) {
          tracker.boltRackFired = true;
          if (id === this.activeWeapon) onReloadPhase?.(id, 'bolt_rack');
        }

        if (slot.reloadRemainingMs <= 0) {
          slot.isReloading = false;
          slot.reloadRemainingMs = 0;
          slot.ammo = slot.magazineSize;
          this.events.emit('weapon:reload_complete', { weaponId: id, ammo: slot.ammo });
          if (id === this.activeWeapon) {
            onReloadComplete?.();
          }
        }
      }
    }
  }

  public canFire(): boolean {
    const slot = this.slots[this.activeWeapon];
    return !slot.isReloading && slot.cooldownRemainingMs <= 0 && slot.ammo > 0;
  }

  public consumeAmmo(onReloadStart?: () => void): boolean {
    const def = WEAPONS[this.activeWeapon];
    const slot = this.slots[this.activeWeapon];
    if (slot.isReloading || slot.cooldownRemainingMs > 0 || slot.ammo <= 0) {
      return false;
    }

    slot.ammo = Math.max(0, slot.ammo - 1);
    slot.cooldownRemainingMs =
      this.activeWeapon === 'grenade' ? def.cooldownMs ?? 3000 : def.fireRateMs;

    if (
      this.activeWeapon !== 'grenade' &&
      slot.ammo === 0 &&
      DEFAULT_GAME_CONFIG.autoReloadOnEmpty
    ) {
      this.startReload(onReloadStart);
    }

    return true;
  }
}
