import type { PoseController } from '../cv/PoseController';
import type { WeaponId } from '../data/weapons';
import type { IInputProvider, PlayerInputState } from './PlayerInput';

export class PoseInputProvider implements IInputProvider {
  public readonly mode = 'pose' as const;
  private enabled = false;
  private reloadQueued = false;
  private pauseQueued = false;
  private wheelToggleQueued = false;
  private wheelCancelQueued = false;
  private directWeaponQueued: WeaponId | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (e.code === 'KeyR') {
      this.reloadQueued = true;
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      this.pauseQueued = true;
    } else if (e.code === 'Tab' || e.code === 'KeyQ') {
      e.preventDefault();
      this.wheelToggleQueued = true;
    } else if (e.code === 'Digit1') {
      this.directWeaponQueued = 'ar';
    } else if (e.code === 'Digit2') {
      this.directWeaponQueued = 'smg';
    } else if (e.code === 'Digit3') {
      this.directWeaponQueued = 'flamethrower';
    } else if (e.code === 'Digit4') {
      this.directWeaponQueued = 'grenade';
    } else if (e.code === 'Digit5') {
      this.wheelCancelQueued = true;
    }
  };

  constructor(private readonly poseController: PoseController) {}

  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.reloadQueued = false;
    this.pauseQueued = false;
    this.wheelToggleQueued = false;
    this.wheelCancelQueued = false;
    this.directWeaponQueued = null;
    window.addEventListener('keydown', this.onKeyDown);
  }

  public disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    window.removeEventListener('keydown', this.onKeyDown);
  }

  public poll(nowMs: number, dtSec: number): PlayerInputState {
    const out = this.poseController.update(nowMs, dtSec);
    const reloadTriggered = this.reloadQueued;
    const pauseTriggered = out.pauseTriggered || this.pauseQueued;
    const wheelTogglePressed = this.wheelToggleQueued;
    const wheelCancelPressed = this.wheelCancelQueued;
    const directWeaponSelect = this.directWeaponQueued;

    this.reloadQueued = false;
    this.pauseQueued = false;
    this.wheelToggleQueued = false;
    this.wheelCancelQueued = false;
    this.directWeaponQueued = null;

    return {
      aimX: out.aimX,
      aimY: out.aimY,
      fireHeld: out.fireHeld,
      reloadTriggered,
      pauseTriggered,
      wheelTogglePressed,
      wheelCancelPressed,
      directWeaponSelect,
      wheelGesture: out.wheel,
      mode: 'pose',
      trackingActive: this.poseController.isTrackingActive(),
      poseDebug: out.debug,
    };
  }

  public dispose(): void {
    this.disable();
  }
}
