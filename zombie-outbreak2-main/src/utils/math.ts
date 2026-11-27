export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

class LowPass1D {
  private initialized = false;
  private y = 0;
  private s = 0;

  public reset(val = 0): void {
    this.initialized = false;
    this.y = val;
    this.s = val;
  }

  public filter(value: number, alpha: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.y = value;
      this.s = value;
      return value;
    }
    this.y = value;
    this.s = alpha * value + (1 - alpha) * this.s;
    return this.s;
  }

  public lastRaw(): number {
    return this.y;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }
}

function smoothingAlpha(cutoffHz: number, dtSec: number): number {
  const safeDt = Math.max(1 / 120, dtSec);
  const tau = 1 / (2 * Math.PI * Math.max(0.05, cutoffHz));
  return 1 / (1 + tau / safeDt);
}

/**
 * 2D One-Euro velocity-adaptive filter with micro-deadzone and trigger-pull stabilization.
 * Eliminates idle hand jitter and trigger-curl shake while staying responsive for fast sweeps.
 */
export class StabilizedAimFilter {
  private readonly xFilter = new LowPass1D();
  private readonly dxFilter = new LowPass1D();
  private readonly yFilter = new LowPass1D();
  private readonly dyFilter = new LowPass1D();

  private outX = 0;
  private outY = 0;
  private anchorX = 0;
  private anchorY = 0;
  private hasAnchor = false;

  public reset(x = 0, y = 0): void {
    this.xFilter.reset(x);
    this.dxFilter.reset(0);
    this.yFilter.reset(y);
    this.dyFilter.reset(0);
    this.outX = x;
    this.outY = y;
    this.anchorX = x;
    this.anchorY = y;
    this.hasAnchor = false;
  }

  public filter(
    rawX: number,
    rawY: number,
    dtSec: number,
    smoothingStrength: number,
    triggerStabilizeFactor = 1.0
  ): Point2D {
    const s = clamp(smoothingStrength, 0.05, 0.95);
    const safeDt = clamp(dtSec, 1 / 120, 0.15);

    if (!this.hasAnchor) {
      this.hasAnchor = true;
      this.anchorX = rawX;
      this.anchorY = rawY;
      this.outX = this.xFilter.filter(rawX, 1);
      this.outY = this.yFilter.filter(rawY, 1);
      this.dxFilter.filter(0, 1);
      this.dyFilter.filter(0, 1);
      return { x: this.outX, y: this.outY };
    }

    // Soft micro-deadzone: ignore tiny tremor / trigger-squeeze wobble
    const deadzone = 0.004 + s * 0.014;
    const dxAnchor = rawX - this.anchorX;
    const dyAnchor = rawY - this.anchorY;
    const dist = Math.hypot(dxAnchor, dyAnchor);

    if (dist <= deadzone) {
      // Hold steady on anchor inside deadzone
      rawX = this.anchorX;
      rawY = this.anchorY;
    } else {
      const moveRatio = (dist - deadzone) / dist;
      const stepScale = clamp(triggerStabilizeFactor, 0.25, 1.0);
      this.anchorX += dxAnchor * moveRatio * stepScale;
      this.anchorY += dyAnchor * moveRatio * stepScale;
      rawX = this.anchorX;
      rawY = this.anchorY;
    }

    // One-Euro adaptive cutoff: calm at low velocity, responsive on deliberate swings
    const minCutoff = lerp(4.8, 0.85, s) * clamp(triggerStabilizeFactor, 0.35, 1.0);
    const beta = lerp(4.2, 1.35, s) * clamp(triggerStabilizeFactor, 0.4, 1.0);
    const dCutoff = 1.2;

    const velX = this.xFilter.isInitialized()
      ? (rawX - this.xFilter.lastRaw()) / safeDt
      : 0;
    const velY = this.yFilter.isInitialized()
      ? (rawY - this.yFilter.lastRaw()) / safeDt
      : 0;

    const edX = this.dxFilter.filter(velX, smoothingAlpha(dCutoff, safeDt));
    const edY = this.dyFilter.filter(velY, smoothingAlpha(dCutoff, safeDt));

    const speed = Math.hypot(edX, edY);
    const cutoff = minCutoff + beta * speed;
    const alpha = smoothingAlpha(cutoff, safeDt);

    this.outX = this.xFilter.filter(rawX, alpha);
    this.outY = this.yFilter.filter(rawY, alpha);

    return { x: this.outX, y: this.outY };
  }
}

/**
 * Computes interior angle in degrees at vertex B given 3D points A-B-C.
 */
export function calculateAngle3D(a: Point3D, b: Point3D, c: Point3D): number {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const baz = a.z - b.z;

  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const bcz = c.z - b.z;

  const magBA = Math.hypot(bax, bay, baz);
  const magBC = Math.hypot(bcx, bcy, bcz);
  if (magBA < 1e-6 || magBC < 1e-6) return 0;

  const dot = bax * bcx + bay * bcy + baz * bcz;
  const cosTheta = clamp(dot / (magBA * magBC), -1, 1);
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

/**
 * Computes interior angle in degrees at vertex B given 2D points A-B-C.
 */
export function calculateAngle2D(a: Point2D, b: Point2D, c: Point2D): number {
  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;

  const magBA = Math.hypot(bax, bay);
  const magBC = Math.hypot(bcx, bcy);
  if (magBA < 1e-6 || magBC < 1e-6) return 0;

  const dot = bax * bcx + bay * bcy;
  const cosTheta = clamp(dot / (magBA * magBC), -1, 1);
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
