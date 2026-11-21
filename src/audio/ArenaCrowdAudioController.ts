import { clamp, lerp } from '../utils/math';

export type ArenaCrowdAudioState =
  | 'off'
  | 'intro'
  | 'phase1'
  | 'phase1_defeat_silence'
  | 'phase2_transform'
  | 'phase2_chase'
  | 'phase2_combat';

export type ArenaCrowdReactionKind =
  | 'royal_command'
  | 'boss_attack'
  | 'phase2_reveal'
  | 'jump_launch'
  | 'jump_land'
  | 'chase_roar';

interface CrowdStateMixProfile {
  bedGain: number;
  bedFreqHz: number;
  burstIntervalMinMs: number;
  burstIntervalMaxMs: number;
  burstGain: number;
  burstVoices: number;
}

const CROWD_PROFILES: Record<ArenaCrowdAudioState, CrowdStateMixProfile> = {
  off: {
    bedGain: 0,
    bedFreqHz: 320,
    burstIntervalMinMs: 999999,
    burstIntervalMaxMs: 999999,
    burstGain: 0,
    burstVoices: 0,
  },
  intro: {
    bedGain: 0.14,
    bedFreqHz: 520,
    burstIntervalMinMs: 1400,
    burstIntervalMaxMs: 2600,
    burstGain: 0.24,
    burstVoices: 2,
  },
  phase1: {
    bedGain: 0.11,
    bedFreqHz: 460,
    burstIntervalMinMs: 2200,
    burstIntervalMaxMs: 4200,
    burstGain: 0.18,
    burstVoices: 2,
  },
  phase1_defeat_silence: {
    bedGain: 0.012,
    bedFreqHz: 260,
    burstIntervalMinMs: 5200,
    burstIntervalMaxMs: 7800,
    burstGain: 0.04,
    burstVoices: 1,
  },
  phase2_transform: {
    bedGain: 0.13,
    bedFreqHz: 540,
    burstIntervalMinMs: 1500,
    burstIntervalMaxMs: 2900,
    burstGain: 0.22,
    burstVoices: 2,
  },
  phase2_chase: {
    bedGain: 0.22,
    bedFreqHz: 760,
    burstIntervalMinMs: 750,
    burstIntervalMaxMs: 1650,
    burstGain: 0.34,
    burstVoices: 3,
  },
  phase2_combat: {
    bedGain: 0.105,
    bedFreqHz: 490,
    burstIntervalMinMs: 2400,
    burstIntervalMaxMs: 4500,
    burstGain: 0.16,
    burstVoices: 2,
  },
};

/**
 * Spatialized multi-layer Stage 4 Zombie Arena Crowd Ambience & Reactive Audio Controller.
 * Routes all sound through the supplied ambient GainNode so user mute/ambient sliders work seamlessly.
 */
export class ArenaCrowdAudioController {
  private state: ArenaCrowdAudioState = 'off';
  private paused = false;

  private bedSource: AudioBufferSourceNode | null = null;
  private bedFilter: BiquadFilterNode | null = null;
  private bedGain: GainNode | null = null;
  private burstTimerId: number | null = null;

  constructor(
    private readonly getContext: () => AudioContext | null,
    private readonly getNoiseBuffer: () => AudioBuffer | null,
    private readonly getDestNode: () => AudioNode | null,
    private readonly isMuted: () => boolean
  ) {}

  public getState(): ArenaCrowdAudioState {
    return this.state;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public setState(nextState: ArenaCrowdAudioState): void {
    const prevState = this.state;
    this.state = nextState;

    if (nextState === 'off') {
      this.stop();
      return;
    }

    if (prevState === 'off') {
      this.paused = false;
    }

    this.ensureBedRunning();
    this.applyBedMix(nextState === 'phase1_defeat_silence' ? 0.22 : 0.7);

    if (prevState === 'off' || this.burstTimerId === null) {
      this.scheduleNextBurst();
    }
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    const ctx = this.getContext();
    if (!ctx || !this.bedGain) return;
    const now = ctx.currentTime;
    const target = paused || this.state === 'off' ? 0.0001 : CROWD_PROFILES[this.state].bedGain;
    this.bedGain.gain.cancelScheduledValues(now);
    this.bedGain.gain.setTargetAtTime(Math.max(0.0001, target), now, 0.12);
  }

  public triggerReaction(kind: ArenaCrowdReactionKind): void {
    if (this.state === 'off' || this.paused || this.isMuted()) return;
    const ctx = this.getContext();
    const dest = this.getDestNode();
    if (!ctx || ctx.state !== 'running' || !dest) return;

    if (kind === 'royal_command' || kind === 'phase2_reveal') {
      this.spawnSpatialCrowdVoices(dest, 4, 0.42, 0.95, 1.55);
    } else if (kind === 'jump_land') {
      this.spawnSpatialCrowdVoices(dest, 4, 0.38, 0.85, 1.35);
    } else if (kind === 'jump_launch' || kind === 'chase_roar') {
      this.spawnSpatialCrowdVoices(dest, 3, 0.32, 0.72, 1.15);
    } else {
      // boss_attack
      this.spawnSpatialCrowdVoices(dest, 2, 0.24, 0.55, 0.9);
    }
  }

  public stop(): void {
    this.state = 'off';
    this.paused = false;
    if (this.burstTimerId !== null) {
      clearTimeout(this.burstTimerId);
      this.burstTimerId = null;
    }
    this.teardownBed();
  }

  public dispose(): void {
    this.stop();
  }

  private ensureBedRunning(): void {
    if (this.bedSource && this.bedGain && this.bedFilter) return;
    const ctx = this.getContext();
    const noise = this.getNoiseBuffer();
    const dest = this.getDestNode();
    if (!ctx || !noise || !dest) return;

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.playbackRate.value = 0.62;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.85;
    filter.frequency.value = CROWD_PROFILES[this.state].bedFreqHz;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start();

    this.bedSource = src;
    this.bedFilter = filter;
    this.bedGain = gain;
  }

  private applyBedMix(rampSec: number): void {
    const ctx = this.getContext();
    if (!ctx || !this.bedGain || !this.bedFilter) return;
    const profile = CROWD_PROFILES[this.state];
    const now = ctx.currentTime;
    const targetGain = this.paused ? 0.0001 : Math.max(0.0001, profile.bedGain);

    this.bedGain.gain.cancelScheduledValues(now);
    this.bedGain.gain.setTargetAtTime(targetGain, now, Math.max(0.05, rampSec * 0.35));

    this.bedFilter.frequency.cancelScheduledValues(now);
    this.bedFilter.frequency.setTargetAtTime(profile.bedFreqHz, now, Math.max(0.05, rampSec * 0.35));
  }

  private scheduleNextBurst(): void {
    if (this.burstTimerId !== null) {
      clearTimeout(this.burstTimerId);
      this.burstTimerId = null;
    }
    if (this.state === 'off') return;

    const profile = CROWD_PROFILES[this.state];
    const delayMs = lerp(profile.burstIntervalMinMs, profile.burstIntervalMaxMs, Math.random());

    this.burstTimerId = window.setTimeout(() => {
      this.burstTimerId = null;
      if (this.state === 'off') return;

      const ctx = this.getContext();
      const dest = this.getDestNode();
      if (!this.paused && !this.isMuted() && ctx && ctx.state === 'running' && dest) {
        const cur = CROWD_PROFILES[this.state];
        this.spawnSpatialCrowdVoices(dest, cur.burstVoices, cur.burstGain, 0.65, 1.25);
      }
      this.scheduleNextBurst();
    }, delayMs);
  }

  private spawnSpatialCrowdVoices(
    dest: AudioNode,
    voiceCount: number,
    baseGain: number,
    minDurSec: number,
    maxDurSec: number
  ): void {
    const ctx = this.getContext();
    const noise = this.getNoiseBuffer();
    if (!ctx || !noise) return;

    for (let i = 0; i < voiceCount; i++) {
      const delaySec = i * (0.04 + Math.random() * 0.09);
      const durSec = lerp(minDurSec, maxDurSec, Math.random());
      const start = ctx.currentTime + delaySec;

      const panner = ctx.createStereoPanner();
      panner.pan.value = clamp((Math.random() * 2 - 1) * 0.85, -0.9, 0.9);
      panner.connect(dest);

      // Filtered zombie vocal roar noise burst
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = noise;
      nSrc.playbackRate.value = 0.72 + Math.random() * 0.45;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      const fStart = 380 + Math.random() * 560;
      const fEnd = Math.max(160, fStart * (0.55 + Math.random() * 0.25));
      filter.Q.setValueAtTime(1.15 + Math.random() * 1.1, start);
      filter.frequency.setValueAtTime(fStart, start);
      filter.frequency.exponentialRampToValueAtTime(fEnd, start + durSec);

      const nGain = ctx.createGain();
      const peak = baseGain * (0.55 + Math.random() * 0.45) / Math.max(1, voiceCount * 0.6);
      nGain.gain.setValueAtTime(0.0001, start);
      nGain.gain.linearRampToValueAtTime(peak, start + durSec * 0.22);
      nGain.gain.exponentialRampToValueAtTime(0.0001, start + durSec);

      nSrc.connect(filter);
      filter.connect(nGain);
      nGain.connect(panner);
      nSrc.start(start);
      nSrc.stop(start + durSec + 0.04);

      // Deep guttural undead crowd formant undertone
      if (i % 2 === 0) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const hz = 74 + Math.random() * 58;
        osc.frequency.setValueAtTime(hz, start);
        osc.frequency.exponentialRampToValueAtTime(Math.max(36, hz * 0.64), start + durSec);

        const oFilter = ctx.createBiquadFilter();
        oFilter.type = 'lowpass';
        oFilter.frequency.setValueAtTime(320, start);

        const oGain = ctx.createGain();
        oGain.gain.setValueAtTime(0.0001, start);
        oGain.gain.linearRampToValueAtTime(peak * 0.42, start + durSec * 0.2);
        oGain.gain.exponentialRampToValueAtTime(0.0001, start + durSec);

        osc.connect(oFilter);
        oFilter.connect(oGain);
        oGain.connect(panner);
        osc.start(start);
        osc.stop(start + durSec + 0.04);
      }
    }
  }

  private teardownBed(): void {
    try {
      this.bedSource?.stop();
      this.bedSource?.disconnect();
      this.bedFilter?.disconnect();
      this.bedGain?.disconnect();
    } catch {
      // Ignore already stopped nodes
    }
    this.bedSource = null;
    this.bedFilter = null;
    this.bedGain = null;
  }
}
