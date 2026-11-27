import * as THREE from 'three';
import type { GameRenderer } from '../three/Renderer';

export class GameLoop {
  private readonly clock = new THREE.Clock();
  private running = false;
  private rafId = 0;
  private timeoutId = 0;
  private fpsWindowFrames = 0;
  private fpsWindowStart = 0;
  private currentFps = 60;

  constructor(
    private readonly renderer: GameRenderer,
    private readonly onTick: (dtSec: number, elapsedSec: number, nowMs: number) => void
  ) {}

  public getFps(): number {
    return this.currentFps;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.fpsWindowFrames = 0;
    this.fpsWindowStart = performance.now();
    this.scheduleNext();
  }

  public stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = 0;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    if (this.renderer.isSoftwareGl) {
      this.timeoutId = this.renderer.afterSoftwareDraw(() => this.step());
    } else {
      this.rafId = requestAnimationFrame(() => this.step());
    }
  }

  private step(): void {
    if (!this.running) return;
    const nowMs = performance.now();
    const rawDelta = this.clock.getDelta();
    const dtSec = Math.min(rawDelta, 0.1);
    const elapsedSec = this.clock.elapsedTime;

    this.fpsWindowFrames++;
    if (nowMs - this.fpsWindowStart >= 1000) {
      this.currentFps = this.fpsWindowFrames;
      this.fpsWindowFrames = 0;
      this.fpsWindowStart = nowMs;
    }

    this.onTick(dtSec, elapsedSec, nowMs);
    this.scheduleNext();
  }
}
