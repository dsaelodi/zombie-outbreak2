import type { CalibrationData } from './types';

export class PoseCalibration {
  private data: CalibrationData = {
    isCalibrated: false,
    baselineOffsetX: 0.02,
    baselineOffsetY: 0.04,
    readyIndexAngleDeg: 165,
    curledIndexAngleDeg: 110,
  };

  private offsetSamplesX: number[] = [];
  private offsetSamplesY: number[] = [];
  private readyAngles: number[] = [];
  private curledAngles: number[] = [];

  public getData(): CalibrationData {
    return { ...this.data };
  }

  public reset(): void {
    this.data = {
      isCalibrated: false,
      baselineOffsetX: 0.02,
      baselineOffsetY: 0.04,
      readyIndexAngleDeg: 165,
      curledIndexAngleDeg: 110,
    };
    this.offsetSamplesX = [];
    this.offsetSamplesY = [];
    this.readyAngles = [];
    this.curledAngles = [];
  }

  public recordReadySample(dx: number, dy: number, indexAngleDeg: number): void {
    this.offsetSamplesX.push(dx);
    this.offsetSamplesY.push(dy);
    this.readyAngles.push(indexAngleDeg);
    if (this.offsetSamplesX.length > 30) {
      this.offsetSamplesX.shift();
      this.offsetSamplesY.shift();
      this.readyAngles.shift();
    }
  }

  public recordCurledSample(indexAngleDeg: number): void {
    this.curledAngles.push(indexAngleDeg);
    if (this.curledAngles.length > 20) {
      this.curledAngles.shift();
    }
  }

  public finalize(): CalibrationData {
    const avg = (arr: number[], fallback: number) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : fallback;

    this.data = {
      isCalibrated: true,
      baselineOffsetX: avg(this.offsetSamplesX, 0.02),
      baselineOffsetY: avg(this.offsetSamplesY, 0.04),
      readyIndexAngleDeg: avg(this.readyAngles, 165),
      curledIndexAngleDeg: avg(this.curledAngles, 110),
    };
    return this.getData();
  }

  public markCalibratedWithCurrent(dx: number, dy: number): CalibrationData {
    this.data = {
      ...this.data,
      isCalibrated: true,
      baselineOffsetX: dx,
      baselineOffsetY: dy,
    };
    return this.getData();
  }
}
