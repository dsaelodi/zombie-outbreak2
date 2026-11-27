import type { StageEnvironmentId } from '../data/stages';
import { clamp } from '../utils/math';
import type { SoundId } from './AudioManifest';

export interface ProceduralMusicController {
  stop: () => void;
  setBossPhase: (phase: 1 | 2) => void;
}

export class ProceduralAudioEngine {
  constructor(
    private readonly getContext: () => AudioContext | null,
    private readonly getNoiseBuffer: () => AudioBuffer | null
  ) {}

  private spawnNoise(
    dest: AudioNode,
    volume: number,
    durationSec: number,
    filterType: BiquadFilterType,
    freqStart: number,
    freqEnd: number,
    delaySec = 0,
    q = 1.2
  ): void {
    const ctx = this.getContext();
    const noise = this.getNoiseBuffer();
    if (!ctx || !noise) return;

    const start = ctx.currentTime + delaySec;
    const src = ctx.createBufferSource();
    src.buffer = noise;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.setValueAtTime(q, start);
    filter.frequency.setValueAtTime(Math.max(30, freqStart), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), start + durationSec);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.001, volume), start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + durationSec);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(start);
    src.stop(start + durationSec + 0.03);
  }

  private spawnTone(
    dest: AudioNode,
    type: OscillatorType,
    freqStart: number,
    freqEnd: number,
    volume: number,
    durationSec: number,
    delaySec = 0,
    detuneCents = 0
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const start = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.detune.setValueAtTime(detuneCents, start);
    osc.frequency.setValueAtTime(Math.max(20, freqStart), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + durationSec);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(Math.max(0.002, volume), start + Math.min(0.018, durationSec * 0.2));
    gain.gain.exponentialRampToValueAtTime(0.001, start + durationSec);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + durationSec + 0.03);
  }

  public playSfx(id: SoundId, dest: AudioNode, volume: number): void {
    // 1. High-Impact Layered Weapon Sounds
    if (id === 'ar_fire' || id.startsWith('gunshot')) {
      const jitter = (Math.random() - 0.5) * 18;
      // Supersonic crack + muzzle blast + deep sub-bass punch + metallic bolt & brass casing
      this.spawnNoise(dest, volume * 0.85, 0.085, 'bandpass', 2600 + jitter * 15, 440, 0, 1.0);
      this.spawnTone(dest, 'sawtooth', 195 + jitter, 44, volume * 0.65, 0.14);
      this.spawnTone(dest, 'sine', 125, 32, volume * 0.72, 0.12);
      this.spawnNoise(dest, volume * 0.28, 0.26, 'lowpass', 780, 145, 0.04);
      this.spawnTone(dest, 'triangle', 3250 + Math.random() * 450, 2650, volume * 0.09, 0.05, 0.085);
      return;
    }

    if (id === 'smg_fire') {
      const jitter = (Math.random() - 0.5) * 28;
      this.spawnNoise(dest, volume * 0.62, 0.065, 'highpass', 1650 + jitter * 12, 540, 0, 1.3);
      this.spawnTone(dest, 'square', 265 + jitter, 76, volume * 0.45, 0.075);
      this.spawnTone(dest, 'sine', 145, 45, volume * 0.52, 0.08);
      this.spawnTone(dest, 'triangle', 3700 + Math.random() * 380, 3150, volume * 0.07, 0.038, 0.052);
      return;
    }

    if (id === 'flamethrower_burst') {
      this.spawnNoise(dest, volume * 0.52, 0.18, 'bandpass', 1500 + Math.random() * 240, 760, 0, 2.0);
      this.spawnNoise(dest, volume * 0.58, 0.21, 'lowpass', 460, 130);
      this.spawnTone(dest, 'sawtooth', 82 + Math.random() * 15, 48, volume * 0.24, 0.16);
      return;
    }

    if (id === 'grenade_throw') {
      this.spawnTone(dest, 'sine', 2650, 2150, volume * 0.2, 0.045);
      this.spawnTone(dest, 'triangle', 3400, 2900, volume * 0.14, 0.035, 0.015);
      this.spawnNoise(dest, volume * 0.44, 0.19, 'bandpass', 1100, 310, 0.03);
      return;
    }

    if (id === 'explosion') {
      this.spawnNoise(dest, volume * 0.98, 1.05, 'lowpass', 1050, 72);
      this.spawnTone(dest, 'sine', 135, 22, volume * 0.96, 0.85);
      this.spawnTone(dest, 'sawtooth', 92, 26, volume * 0.58, 0.65, 0.02);
      this.spawnNoise(dest, volume * 0.38, 0.52, 'highpass', 1250, 380, 0.12);
      return;
    }

    // 2. Physical Reload Mechanical Foley
    if (id === 'reload_mag_out') {
      this.spawnTone(dest, 'triangle', 660, 270, volume * 0.44, 0.075);
      this.spawnNoise(dest, volume * 0.46, 0.095, 'bandpass', 1850, 680, 0.018);
      return;
    }
    if (id === 'reload_mag_in') {
      this.spawnTone(dest, 'square', 210, 495, volume * 0.46, 0.065);
      this.spawnTone(dest, 'triangle', 1020, 540, volume * 0.38, 0.055, 0.038);
      this.spawnNoise(dest, volume * 0.42, 0.085, 'highpass', 1450, 880, 0.02);
      return;
    }
    if (id === 'reload_bolt') {
      this.spawnNoise(dest, volume * 0.52, 0.065, 'bandpass', 2700, 1450);
      this.spawnTone(dest, 'sawtooth', 760, 430, volume * 0.36, 0.055);
      this.spawnNoise(dest, volume * 0.56, 0.07, 'highpass', 1950, 1180, 0.082);
      return;
    }
    if (id === 'reload_fuel') {
      this.spawnNoise(dest, volume * 0.48, 0.24, 'bandpass', 2850, 1550);
      this.spawnTone(dest, 'triangle', 168, 92, volume * 0.52, 0.12, 0.04);
      return;
    }

    // 3. Responsive Hit Impact Audio
    if (id === 'impact_flesh') {
      const pitchShift = 0.88 + Math.random() * 0.28;
      this.spawnNoise(dest, volume * 0.66, 0.09, 'bandpass', 940 * pitchShift, 260, 0, 1.7);
      this.spawnTone(dest, 'triangle', 165 * pitchShift, 48, volume * 0.6, 0.095);
      return;
    }
    if (id === 'impact_heavy') {
      const pitchShift = 0.85 + Math.random() * 0.25;
      this.spawnNoise(dest, volume * 0.82, 0.13, 'bandpass', 1280 * pitchShift, 210, 0, 1.4);
      this.spawnTone(dest, 'sawtooth', 198 * pitchShift, 42, volume * 0.68, 0.14);
      this.spawnTone(dest, 'sine', 110, 36, volume * 0.55, 0.11);
      return;
    }
    if (id === 'impact_armor') {
      const pitchShift = 0.9 + Math.random() * 0.22;
      this.spawnTone(dest, 'triangle', 1350 * pitchShift, 760, volume * 0.48, 0.095);
      this.spawnTone(dest, 'sine', 2450 * pitchShift, 1680, volume * 0.26, 0.07, 0.01);
      this.spawnNoise(dest, volume * 0.5, 0.08, 'highpass', 1950 * pitchShift, 840);
      return;
    }
    if (id === 'impact_mutated') {
      const pitchShift = 0.86 + Math.random() * 0.28;
      this.spawnNoise(dest, volume * 0.68, 0.12, 'bandpass', 660 * pitchShift, 185, 0, 3.0);
      this.spawnTone(dest, 'sawtooth', 135 * pitchShift, 62, volume * 0.56, 0.12);
      return;
    }

    // 4. Category-Distinct Zombie Vocals & Footsteps
    if (id === 'zombie_groan_basic' || id === 'zombie_groan') {
      const pitch = 92 + Math.random() * 26;
      this.spawnTone(dest, 'sawtooth', pitch, pitch * 0.6, volume * 0.36, 0.56, 0, -12);
      this.spawnTone(dest, 'sawtooth', pitch * 1.02, pitch * 0.58, volume * 0.28, 0.54, 0.02, 14);
      this.spawnNoise(dest, volume * 0.3, 0.5, 'bandpass', 510, 210, 0.03, 3.0);
      return;
    }
    if (id === 'zombie_runner_shriek') {
      const pitch = 395 + Math.random() * 85;
      this.spawnTone(dest, 'sawtooth', pitch, pitch * 1.4, volume * 0.36, 0.25, 0, -10);
      this.spawnTone(dest, 'triangle', pitch * 1.5, pitch * 1.15, volume * 0.22, 0.22, 0.02, 12);
      this.spawnNoise(dest, volume * 0.34, 0.27, 'bandpass', 1500, 840, 0, 2.4);
      return;
    }
    if (id === 'zombie_armored_clank') {
      this.spawnTone(dest, 'square', 470, 285, volume * 0.3, 0.095);
      this.spawnTone(dest, 'triangle', 95, 46, volume * 0.48, 0.13);
      this.spawnNoise(dest, volume * 0.28, 0.11, 'bandpass', 1250, 410);
      return;
    }
    if (id === 'zombie_mutated_gurgle') {
      this.spawnTone(dest, 'sawtooth', 138, 215, volume * 0.32, 0.19);
      this.spawnTone(dest, 'sawtooth', 198, 106, volume * 0.3, 0.24, 0.14);
      this.spawnNoise(dest, volume * 0.32, 0.36, 'bandpass', 980, 360, 0.02, 3.8);
      return;
    }
    if (id === 'crawler_screech') {
      const pitch = 295 + Math.random() * 75;
      this.spawnTone(dest, 'sawtooth', pitch, pitch * 0.66, volume * 0.36, 0.27);
      this.spawnNoise(dest, volume * 0.32, 0.23, 'bandpass', 1680, 620, 0.01, 2.6);
      return;
    }

    // 5. Boss Audio
    if (id === 'boss_roar' || id === 'boss_death') {
      const dur = id === 'boss_death' ? 1.65 : 0.92;
      this.spawnNoise(dest, volume * 0.6, dur, 'bandpass', 440, 90, 0, 1.6);
      this.spawnTone(dest, 'sawtooth', id === 'boss_death' ? 122 : 90, 27, volume * 0.74, dur, 0, -14);
      this.spawnTone(dest, 'sawtooth', id === 'boss_death' ? 124 : 92, 26, volume * 0.55, dur, 0.02, 14);
      this.spawnTone(dest, 'triangle', 58, 22, volume * 0.68, dur, 0.04);
      return;
    }
    if (id === 'boss_slam_impact') {
      this.spawnTone(dest, 'sine', 98, 20, volume * 0.98, 0.92);
      this.spawnNoise(dest, volume * 0.82, 0.78, 'lowpass', 640, 70);
      return;
    }
    if (id === 'boss_jump_prep') {
      this.spawnTone(dest, 'sawtooth', 62, 142, volume * 0.74, 0.65);
      this.spawnNoise(dest, volume * 0.5, 0.56, 'bandpass', 280, 740, 0, 2.0);
      return;
    }
    if (id === 'boss_jump_air') {
      this.spawnNoise(dest, volume * 0.74, 0.8, 'bandpass', 940, 235, 0, 1.3);
      this.spawnTone(dest, 'triangle', 152, 66, volume * 0.48, 0.66);
      return;
    }
    if (id === 'boss_jump_land') {
      this.spawnTone(dest, 'sine', 116, 19, volume * 0.99, 0.98);
      this.spawnNoise(dest, volume * 0.9, 0.88, 'lowpass', 740, 62);
      this.spawnNoise(dest, volume * 0.48, 0.46, 'highpass', 1150, 310, 0.08);
      return;
    }
    if (id === 'boss_hit') {
      this.spawnTone(dest, 'triangle', 148, 50, volume * 0.62, 0.15);
      this.spawnNoise(dest, volume * 0.32, 0.1, 'bandpass', 920, 340);
      return;
    }
    if (id === 'boss_resurrection_twitch') {
      this.spawnNoise(dest, volume * 0.68, 0.085, 'bandpass', 1850, 640, 0, 2.8);
      this.spawnNoise(dest, volume * 0.6, 0.075, 'bandpass', 2250, 880, 0.22, 3.0);
      this.spawnTone(dest, 'sawtooth', 74, 46, volume * 0.48, 0.56, 0.05);
      this.spawnNoise(dest, volume * 0.44, 0.66, 'lowpass', 430, 135, 0.12);
      return;
    }
    if (id === 'boss_mutation_morph') {
      this.spawnNoise(dest, volume * 0.72, 1.55, 'bandpass', 320, 1420, 0, 1.4);
      this.spawnTone(dest, 'sawtooth', 38, 120, volume * 0.68, 1.62);
      this.spawnTone(dest, 'triangle', 55, 23, volume * 0.75, 1.42, 0.2);
      this.spawnNoise(dest, volume * 0.54, 0.46, 'highpass', 1520, 710, 0.65);
      return;
    }
    if (id === 'boss_phase2_roar') {
      this.spawnNoise(dest, volume * 0.78, 1.5, 'bandpass', 640, 115, 0, 1.4);
      this.spawnTone(dest, 'sawtooth', 126, 33, volume * 0.84, 1.45, 0, -15);
      this.spawnTone(dest, 'sawtooth', 79, 21, volume * 0.78, 1.52, 0.05, 15);
      this.spawnTone(dest, 'square', 198, 60, volume * 0.38, 0.88, 0.08);
      return;
    }
    if (id === 'boss_shockwave') {
      this.spawnTone(dest, 'sine', 134, 23, volume * 0.94, 0.75);
      this.spawnNoise(dest, volume * 0.76, 0.6, 'lowpass', 800, 92);
      return;
    }
    if (id === 'boss_tendril_fire') {
      this.spawnNoise(dest, volume * 0.6, 0.19, 'bandpass', 2150, 510, 0, 2.1);
      this.spawnTone(dest, 'sawtooth', 295, 92, volume * 0.5, 0.17);
      return;
    }

    if (id === 'distant_siren') {
      this.spawnTone(dest, 'sine', 390, 560, volume * 0.28, 1.3);
      this.spawnTone(dest, 'sine', 560, 340, volume * 0.25, 1.5, 1.3);
      return;
    }
    if (id === 'gate_open' || id === 'bunker_open' || id === 'exit_gate_open') {
      this.spawnTone(dest, 'sawtooth', 95, 58, volume * 0.46, 1.5);
      this.spawnNoise(dest, volume * 0.44, 1.42, 'bandpass', 420, 180, 0.05, 2.2);
      this.spawnTone(dest, 'square', 182, 72, volume * 0.34, 0.19, 0.02);
      return;
    }
    if (id === 'facility_alarm') {
      this.spawnTone(dest, 'sawtooth', 720, 520, volume * 0.36, 0.38);
      this.spawnTone(dest, 'sawtooth', 720, 520, volume * 0.32, 0.38, 0.55);
      return;
    }
    if (id === 'elevator_hum') {
      this.spawnTone(dest, 'sine', 64, 58, volume * 0.42, 1.2);
      this.spawnNoise(dest, volume * 0.24, 1.1, 'lowpass', 260, 140);
      this.spawnTone(dest, 'triangle', 145, 110, volume * 0.18, 0.14, 0.45);
      return;
    }
    if (id === 'elevator_chime') {
      this.spawnTone(dest, 'sine', 523.25, 520, volume * 0.45, 0.55);
      this.spawnTone(dest, 'sine', 659.25, 656, volume * 0.38, 0.75, 0.2);
      return;
    }
    if (id === 'elevator_door_open') {
      this.spawnTone(dest, 'square', 220, 140, volume * 0.35, 0.08);
      this.spawnNoise(dest, volume * 0.48, 0.82, 'bandpass', 540, 260, 0.04, 1.8);
      this.spawnTone(dest, 'triangle', 120, 185, volume * 0.3, 0.55, 0.06);
      return;
    }
    if (id === 'elevator_door_close') {
      this.spawnNoise(dest, volume * 0.48, 0.75, 'bandpass', 380, 190, 0, 1.6);
      this.spawnTone(dest, 'triangle', 145, 78, volume * 0.38, 0.45, 0.05);
      this.spawnTone(dest, 'sine', 110, 32, volume * 0.72, 0.26, 0.68);
      this.spawnNoise(dest, volume * 0.45, 0.12, 'lowpass', 480, 120, 0.68);
      return;
    }
    if (id === 'elevator_brake') {
      this.spawnNoise(dest, volume * 0.42, 0.42, 'bandpass', 1450, 520, 0, 3.0);
      this.spawnTone(dest, 'sine', 92, 28, volume * 0.75, 0.34, 0.14);
      this.spawnTone(dest, 'triangle', 180, 88, volume * 0.4, 0.22, 0.16);
      return;
    }
    if (id === 'crowd_cheer_celebration') {
      this.spawnNoise(dest, volume * 0.48, 1.6, 'bandpass', 1050, 740, 0, 0.9);
      this.spawnNoise(dest, volume * 0.36, 1.4, 'bandpass', 1950, 1380, 0.08, 1.2);
      this.spawnTone(dest, 'triangle', 261.63, 329.63, volume * 0.18, 0.65, 0.04);
      this.spawnTone(dest, 'triangle', 392.0, 523.25, volume * 0.16, 0.75, 0.12);
      return;
    }
    if (id === 'crowd_clap') {
      for (let i = 0; i < 4; i++) {
        const d = i * 0.075 + Math.random() * 0.03;
        this.spawnNoise(dest, volume * 0.42, 0.06, 'bandpass', 2200 + Math.random() * 700, 1100, d, 1.6);
      }
      return;
    }
    if (id === 'lore_paper') {
      this.spawnNoise(dest, volume * 0.46, 0.14, 'highpass', 1800, 3400);
      return;
    }
    if (id === 'king_breathing') {
      this.spawnNoise(dest, volume * 0.45, 0.85, 'bandpass', 240, 420, 0, 2.6);
      this.spawnTone(dest, 'sawtooth', 54, 42, volume * 0.35, 0.9, 0.05);
      this.spawnNoise(dest, volume * 0.52, 1.05, 'bandpass', 360, 150, 0.95, 2.2);
      this.spawnTone(dest, 'sawtooth', 48, 28, volume * 0.42, 1.0, 0.95);
      return;
    }
    if (id === 'arena_crowd_cheer') {
      this.spawnNoise(dest, volume * 0.46, 1.4, 'bandpass', 680, 440, 0, 1.1);
      this.spawnNoise(dest, volume * 0.32, 1.3, 'bandpass', 1240, 820, 0.1, 1.6);
      this.spawnTone(dest, 'sawtooth', 110, 74, volume * 0.22, 1.1, 0.08);
      return;
    }

    // 6. Wheel & Movement cues
    if (id === 'wheel_open' || id === 'wheel_close' || id === 'weapon_switch') {
      const f1 = id === 'wheel_open' ? 280 : id === 'wheel_close' ? 440 : 420;
      const f2 = id === 'wheel_open' ? 520 : id === 'wheel_close' ? 210 : 660;
      this.spawnTone(dest, id === 'weapon_switch' ? 'triangle' : 'sine', f1, f2, volume * 0.44, 0.12);
      return;
    }
    if (id === 'footstep') {
      this.spawnNoise(dest, volume * 0.45, 0.09, 'lowpass', 240, 90);
      this.spawnTone(dest, 'sine', 75, 32, volume * 0.26, 0.065);
      return;
    }
    if (id === 'chase_footstep') {
      const pitch = 0.9 + Math.random() * 0.2;
      this.spawnNoise(dest, volume * 0.58, 0.085, 'lowpass', 340 * pitch, 95);
      this.spawnTone(dest, 'sine', 85 * pitch, 34, volume * 0.42, 0.07);
      return;
    }

    this.spawnTone(dest, 'triangle', id.startsWith('ui') ? 680 : 320, 220, volume * 0.36, 0.12);
  }

  /**
   * Procedural dynamic horror soundtrack engine supporting stage tension + boss phase escalation.
   */
  public startMusicLoop(
    trackId:
      | 'music_menu'
      | 'music_stage1'
      | 'music_stage2'
      | 'music_stage3'
      | 'music_boss'
      | 'music_boss_phase2'
      | 'music_victory'
      | 'music_outro_celebration',
    dest: AudioNode,
    baseVolume: number
  ): ProceduralMusicController | null {
    const ctx = this.getContext();
    if (!ctx) return null;

    let stopped = false;
    let bossPhase: 1 | 2 = 1;
    let step = 0;

    const droneOsc = ctx.createOscillator();
    const droneOscDetuned = ctx.createOscillator();
    const droneSub = ctx.createOscillator();
    const droneFilter = ctx.createBiquadFilter();
    const droneGain = ctx.createGain();

    const rootHz =
      trackId === 'music_menu'
        ? 46.25
        : trackId === 'music_stage1'
        ? 55.0
        : trackId === 'music_stage2'
        ? 49.0
        : trackId === 'music_stage3'
        ? 43.65
        : trackId === 'music_victory' || trackId === 'music_outro_celebration'
        ? 130.81
        : trackId === 'music_boss_phase2'
        ? 36.71
        : 41.2;

    const oscType =
      trackId === 'music_victory' || trackId === 'music_outro_celebration'
        ? 'triangle'
        : 'sawtooth';
    droneOsc.type = oscType;
    droneOsc.frequency.value = rootHz;
    droneOsc.detune.value = -8;

    droneOscDetuned.type = oscType;
    droneOscDetuned.frequency.value = rootHz;
    droneOscDetuned.detune.value = 8;

    droneSub.type = 'sine';
    droneSub.frequency.value = rootHz * 0.5;

    droneFilter.type = 'lowpass';
    droneFilter.Q.value = 1.6;
    droneFilter.frequency.value =
      trackId === 'music_menu'
        ? 175
        : trackId === 'music_outro_celebration'
        ? 560
        : trackId === 'music_boss_phase2'
        ? 410
        : trackId === 'music_boss'
        ? 310
        : 225;

    droneGain.gain.setValueAtTime(0.001, ctx.currentTime);
    droneGain.gain.linearRampToValueAtTime(baseVolume * 0.28, ctx.currentTime + 0.85);

    droneOsc.connect(droneFilter);
    droneOscDetuned.connect(droneFilter);
    droneSub.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(dest);
    droneOsc.start();
    droneOscDetuned.start();
    droneSub.start();

    const stepMs =
      trackId === 'music_menu'
        ? 950
        : trackId === 'music_stage1'
        ? 520
        : trackId === 'music_stage2'
        ? 400
        : trackId === 'music_stage3'
        ? 320
        : trackId === 'music_victory'
        ? 680
        : trackId === 'music_outro_celebration'
        ? 420
        : trackId === 'music_boss_phase2'
        ? 185
        : 240;

    const timerId = window.setInterval(() => {
      if (stopped) return;
      const cur = this.getContext();
      if (!cur || cur.state !== 'running') return;

      const idx = step++;
      if (trackId === 'music_menu') {
        if (idx % 3 === 0) {
          const chimeNotes = [277.18, 293.66, 369.99, 246.94];
          const n = chimeNotes[(idx / 3) % chimeNotes.length];
          this.spawnTone(dest, 'sine', n, n * 0.992, baseVolume * 0.15, 1.55);
          this.spawnTone(dest, 'triangle', n * 0.5, n * 0.498, baseVolume * 0.08, 1.7);
        }
        if (idx % 6 === 2) {
          this.spawnNoise(dest, baseVolume * 0.08, 0.95, 'bandpass', 270, 140);
        }
        return;
      }

      if (trackId === 'music_outro_celebration') {
        const prog = [
          [261.63, 329.63, 392.0, 523.25],
          [220.0, 261.63, 329.63, 440.0],
          [174.61, 220.0, 261.63, 349.23],
          [196.0, 246.94, 293.66, 392.0],
        ];
        const bar = Math.floor(idx / 4) % prog.length;
        const chord = prog[bar];
        const note = chord[idx % chord.length];
        this.spawnTone(dest, 'triangle', note, note, baseVolume * 0.25, 0.76, 0, -5);
        this.spawnTone(dest, 'sine', note * 2, note * 2, baseVolume * 0.07, 0.55, 0, 5);
        if (idx % 4 === 0) {
          this.spawnTone(dest, 'sine', chord[0] * 0.5, chord[0] * 0.5, baseVolume * 0.3, 1.38);
        }
        if (idx % 2 === 0) {
          this.spawnNoise(dest, baseVolume * 0.06, 0.05, 'highpass', 3400, 1800);
        }
        return;
      }

      if (trackId === 'music_victory') {
        const chord = [130.81, 164.81, 196.0, 261.63];
        const note = chord[idx % chord.length];
        this.spawnTone(dest, 'triangle', note, note, baseVolume * 0.22, 0.98);
        if (idx % 4 === 0) {
          this.spawnTone(dest, 'sine', 65.41, 65.41, baseVolume * 0.26, 1.35);
        }
        return;
      }

      const isBossAny = trackId === 'music_boss' || trackId === 'music_boss_phase2';
      const minorOffsets =
        trackId === 'music_boss_phase2'
          ? [1, 1.059, 1, 1.334, 1.498, 1.189, 1.059, 0.944]
          : [1, 1, 1.189, 1, 1.334, 1.26, 1.059, 1];
      const mult = minorOffsets[idx % minorOffsets.length];
      if (idx % 2 === 0 || trackId === 'music_boss_phase2') {
        this.spawnTone(
          dest,
          isBossAny ? 'sawtooth' : 'triangle',
          rootHz * 2 * mult,
          rootHz * 1.96 * mult,
          baseVolume * (trackId === 'music_boss_phase2' ? 0.35 : isBossAny ? 0.29 : 0.23),
          stepMs / 1100
        );
      }

      const kickModulo =
        trackId === 'music_boss_phase2' ? 2 : isBossAny ? 3 : 4;
      if (idx % kickModulo === 0) {
        this.spawnTone(dest, 'sine', 125, 29, baseVolume * (trackId === 'music_boss_phase2' ? 0.44 : 0.36), 0.17);
        this.spawnNoise(dest, baseVolume * 0.17, 0.08, 'bandpass', 960, 320);
      }
      if (trackId === 'music_stage2' && idx % 4 === 2) {
        this.spawnTone(dest, 'square', 440, 280, baseVolume * 0.075, 0.085);
      }
      if ((trackId === 'music_stage3' || isBossAny) && idx % 2 === 1) {
        this.spawnNoise(
          dest,
          baseVolume * (trackId === 'music_boss_phase2' ? 0.21 : bossPhase === 2 ? 0.17 : 0.11),
          0.055,
          'highpass',
          3300,
          1850
        );
      }
      if (trackId === 'music_boss_phase2' && idx % 8 === 4) {
        this.spawnTone(dest, 'square', 220 * mult, 180 * mult, baseVolume * 0.13, 0.15);
      }
    }, stepMs);

    return {
      setBossPhase: (phase) => {
        bossPhase = phase;
        const cur = this.getContext();
        if (cur && !stopped) {
          droneFilter.frequency.setTargetAtTime(
            phase === 2 ? 360 : 300,
            cur.currentTime,
            0.3
          );
        }
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timerId);
        try {
          droneOsc.stop();
          droneOscDetuned.stop();
          droneSub.stop();
          droneOsc.disconnect();
          droneOscDetuned.disconnect();
          droneSub.disconnect();
          droneFilter.disconnect();
          droneGain.disconnect();
        } catch {
          // Ignore
        }
      },
    };
  }

  public triggerEnvironmentPulse(env: StageEnvironmentId, dest: AudioNode, volume: number): void {
    if (env === 'urban') {
      this.spawnNoise(dest, volume * 0.34, 1.35, 'bandpass', 430, 175);
    } else if (env === 'industrial') {
      this.spawnTone(dest, 'triangle', 195, 86, volume * 0.25, 0.26);
      this.spawnNoise(dest, volume * 0.24, 0.19, 'bandpass', 1420, 610, 0.03);
    } else if (env === 'research') {
      if (Math.random() < 0.5) {
        this.spawnTone(dest, 'sine', 960, 1490, volume * 0.21, 0.095);
      } else {
        this.spawnNoise(dest, volume * 0.25, 0.15, 'highpass', 2450, 1180);
      }
    } else {
      this.spawnTone(dest, 'sine', 54, 25, volume * 0.4, 1.25);
    }
  }
}

export function computeSpatialPanAndGain(
  sourceX: number,
  sourceZ: number,
  listenerX: number,
  listenerZ: number,
  listenerYaw: number,
  maxDistance = 42
): { pan: number; gainMult: number } {
  const dx = sourceX - listenerX;
  const dz = sourceZ - listenerZ;
  const dist = Math.hypot(dx, dz);
  const cos = Math.cos(listenerYaw);
  const sin = Math.sin(listenerYaw);
  const localX = dx * cos - dz * sin;
  const pan = clamp(localX / 13, -0.9, 0.9);
  const gainMult = clamp(1 - dist / maxDistance, 0.14, 1.0);
  return { pan, gainMult };
}
