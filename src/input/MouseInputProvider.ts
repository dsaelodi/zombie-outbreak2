import type { WeaponId } from '../data/weapons';
import { clamp, damp } from '../utils/math';
import type { IInputProvider, PlayerInputState } from './PlayerInput';

export class MouseInputProvider implements IInputProvider {
  public readonly mode = 'mouse' as const;
  private enabled = false;
  private targetX = 0;
  private targetY = 0;
  private smoothX = 0;
  private smoothY = 0;

  private mouseDown = false;
  private spaceDown = false;
  private fireQueued = false;
  private reloadQueued = false;
  private pauseQueued = false;
  private wheelToggleQueued = false;
  private wheelCancelQueued = false;
  private directWeaponQueued: WeaponId | null = null;
  private sensitivity = 1.0;

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const nx = ((e.clientX / w) * 2 - 1) * this.sensitivity;
    const ny = (-(e.clientY / h) * 2 + 1) * this.sensitivity;
    this.targetX = clamp(nx, -0.95, 0.95);
    this.targetY = clamp(ny, -0.92, 0.92);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled || e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target && target.closest('button, input, select, a, [data-ui-interactive]')) {
      return;
    }
    this.mouseDown = true;
    this.fireQueued = true;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseDown = false;
    }
  };

  private readonly onBlur = (): void => {
    this.mouseDown = false;
    this.spaceDown = false;
  };

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
    } else if (e.code === 'Space') {
      this.spaceDown = true;
      this.fireQueued = true;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spaceDown = false;
    }
  };

  public setSensitivity(sensitivity: number): void {
    this.sensitivity = clamp(sensitivity, 0.5, 2.5);
  }

  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.mouseDown = false;
    this.spaceDown = false;
    this.fireQueued = false;
    this.reloadQueued = false;
    this.pauseQueued = false;
    this.wheelToggleQueued = false;
    this.wheelCancelQueued = false;
    this.directWeaponQueued = null;
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  public disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.mouseDown = false;
    this.spaceDown = false;
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  public poll(_nowMs: number, dtSec: number): PlayerInputState {
    this.smoothX = damp(this.smoothX, this.targetX, 28, dtSec);
    this.smoothY = damp(this.smoothY, this.targetY, 28, dtSec);

    const state: PlayerInputState = {
      aimX: this.smoothX,
      aimY: this.smoothY,
      fireHeld: this.mouseDown || this.spaceDown || this.fireQueued,
      reloadTriggered: this.reloadQueued,
      pauseTriggered: this.pauseQueued,
      wheelTogglePressed: this.wheelToggleQueued,
      wheelCancelPressed: this.wheelCancelQueued,
      directWeaponSelect: this.directWeaponQueued,
      mode: 'mouse',
      trackingActive: true,
    };

    this.fireQueued = false;
    this.reloadQueued = false;
    this.pauseQueued = false;
    this.wheelToggleQueued = false;
    this.wheelCancelQueued = false;
    this.directWeaponQueued = null;
    return state;
  }

  public dispose(): void {
    this.disable();
  }
}
