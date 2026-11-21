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
    delaySec = 0
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const start = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), start + durationSec);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(Math.max(0.002, volume), start + Math.min(0.025, durationSec * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.001, start + durationSec);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + durationSec + 0.03);
  }

  public playSfx(id: SoundId, dest: AudioNode, volume: number): void {
    // 1. Layered Weapon Sounds
    if (id === 'ar_fire' || id.startsWith('gunshot')) {
      // Transient snap + body thump + crisp bolt/shell tail
      this.spawnNoise(dest, volume * 0.78, 0.09, 'bandpass', 2400, 420, 0, 1.1);
      this.spawnTone(dest, 'sawtooth', 185 + Math.random() * 18, 42, volume * 0.62, 0.14);
      this.spawnNoise(dest, volume * 0.22, 0.24, 'lowpass', 720, 160, 0.05);
      // Tiny brass shell ping
      this.spawnTone(dest, 'triangle', 3100 + Math.random() * 420, 2600, volume * 0.08, 0.045, 0.09);
      return;
    }

    if (id === 'smg_fire') {
      this.spawnNoise(dest, volume * 0.56, 0.065, 'highpass', 1550, 520, 0, 1.4);
      this.spawnTone(dest, 'square', 255 + Math.random() * 30, 74, volume * 0.42, 0.075);
      this.spawnTone(dest, 'triangle', 3600 + Math.random() * 350, 3100, volume * 0.06, 0.035, 0.055);
      return;
    }

    if (id === 'flamethrower_burst') {
      // Pressurized gas hiss + turbulent low fire roar
      this.spawnNoise(dest, volume * 0.48, 0.17, 'bandpass', 1450 + Math.random() * 200, 780, 0, 2.2);
      this.spawnNoise(dest, volume * 0.52, 0.19, 'lowpass', 420, 140);
      return;
    }

    if (id === 'grenade_throw') {
      // Pin ring metallic click + air whoosh
      this.spawnTone(dest, 'sine', 2400, 2100, volume * 0.16, 0.04);
      this.spawnNoise(dest, volume * 0.4, 0.18, 'bandpass', 1050, 320, 0.03);
      return;
    }

    if (id === 'explosion') {
      this.spawnNoise(dest, volume * 0.96, 0.95, 'lowpass', 980, 80);
      this.spawnTone(dest, 'sine', 120, 24, volume * 0.92, 0.78);
      // Scatter debris crackles
      this.spawnNoise(dest, volume * 0.34, 0.45, 'highpass', 1200, 420, 0.14);
      return;
    }

    // 2. Physical Reload Mechanical Foley
    if (id === 'reload_mag_out') {
      this.spawnTone(dest, 'triangle', 640, 280, volume * 0.4, 0.07);
      this.spawnNoise(dest, volume * 0.42, 0.09, 'bandpass', 1800, 700, 0.02);
      return;
    }
    if (id === 'reload_mag_in') {
      this.spawnTone(dest, 'square', 220, 480, volume * 0.42, 0.06);
      this.spawnTone(dest, 'triangle', 980, 520, volume * 0.35, 0.05, 0.04);
      this.spawnNoise(dest, volume * 0.38, 0.08, 'highpass', 1400, 900, 0.02);
      return;
    }
    if (id === 'reload_bolt') {
      this.spawnNoise(dest, volume * 0.48, 0.06, 'bandpass', 2600, 1400);
      this.spawnTone(dest, 'sawtooth', 720, 440, volume * 0.32, 0.05);
      this.spawnNoise(dest, volume * 0.52, 0.065, 'highpass', 1900, 1200, 0.085);
      return;
    }
    if (id === 'reload_fuel') {
      // Pressurized valve hiss + heavy tank clunk
      this.spawnNoise(dest, volume * 0.44, 0.22, 'bandpass', 2800, 1600);
      this.spawnTone(dest, 'triangle', 160, 95, volume * 0.48, 0.11, 0.04);
      return;
    }

    // 3. Responsive Hit Impact Audio (randomized variations)
    if (id === 'impact_flesh') {
      const pitchShift = 0.88 + Math.random() * 0.28;
      this.spawnNoise(dest, volume * 0.62, 0.085, 'bandpass', 920 * pitchShift, 280, 0, 1.8);
      this.spawnTone(dest, 'triangle', 155 * pitchShift, 52, volume * 0.56, 0.09);
      return;
    }
    if (id === 'impact_heavy') {
      const pitchShift = 0.85 + Math.random() * 0.25;
      this.spawnNoise(dest, volume * 0.78, 0.12, 'bandpass', 1240 * pitchShift, 220, 0, 1.5);
      this.spawnTone(dest, 'sawtooth', 190 * pitchShift, 46, volume * 0.64, 0.13);
      return;
    }
    if (id === 'impact_armor') {
      const pitchShift = 0.9 + Math.random() * 0.22;
      this.spawnTone(dest, 'triangle', 1280 * pitchShift, 740, volume * 0.44, 0.09);
      this.spawnNoise(dest, volume * 0.48, 0.075, 'highpass', 1900 * pitchShift, 820);
      return;
    }
    if (id === 'impact_mutated') {
      const pitchShift = 0.86 + Math.random() * 0.28;
      this.spawnNoise(dest, volume * 0.64, 0.11, 'bandpass', 640 * pitchShift, 190, 0, 3.2);
      this.spawnTone(dest, 'sawtooth', 128 * pitchShift, 64, volume * 0.52, 0.11);
      return;
    }

    // 4. Category-Distinct Zombie Vocals & Footsteps
    if (id === 'zombie_groan_basic' || id === 'zombie_groan') {
      const pitch = 95 + Math.random() * 25;
      this.spawnTone(dest, 'sawtooth', pitch, pitch * 0.62, volume * 0.36, 0.52);
      this.spawnNoise(dest, volume * 0.26, 0.48, 'bandpass', 480, 220, 0.04, 3.2);
      return;
    }
    if (id === 'zombie_runner_shriek') {
      const pitch = 390 + Math.random() * 80;
      this.spawnTone(dest, 'sawtooth', pitch, pitch * 1.38, volume * 0.35, 0.24);
      this.spawnNoise(dest, volume * 0.32, 0.26, 'bandpass', 1450, 820, 0, 2.5);
      return;
    }
    if (id === 'zombie_armored_clank') {
      this.spawnTone(dest, 'square', 460, 290, volume * 0.28, 0.09);
      this.spawnTone(dest, 'triangle', 92, 48, volume * 0.45, 0.12);
      this.spawnNoise(dest, volume * 0.25, 0.1, 'bandpass', 1200, 420);
      return;
    }
    if (id === 'zombie_mutated_gurgle') {
      this.spawnTone(dest, 'sawtooth', 140, 210, volume * 0.3, 0.18);
      this.spawnTone(dest, 'sawtooth', 195, 110, volume * 0.28, 0.22, 0.14);
      this.spawnNoise(dest, volume * 0.28, 0.34, 'bandpass', 950, 380, 0.02, 4.0);
      return;
    }
    if (id === 'crawler_screech') {
      const pitch = 290 + Math.random() * 75;
      this.spawnTone(dest, 'sawtooth', pitch, pitch * 0.68, volume * 0.34, 0.26);
      this.spawnNoise(dest, volume * 0.3, 0.22, 'bandpass', 1650, 640, 0.01, 2.8);
      return;
    }

    // 5. Boss Audio
    if (id === 'boss_roar' || id === 'boss_death') {
      const dur = id === 'boss_death' ? 1.55 : 0.85;
      this.spawnNoise(dest, volume * 0.56, dur, 'bandpass', 420, 95, 0, 1.8);
      this.spawnTone(dest, 'sawtooth', id === 'boss_death' ? 118 : 88, 28, volume * 0.72, dur);
      this.spawnTone(dest, 'triangle', 58, 24, volume * 0.62, dur, 0.04);
      return;
    }
    if (id === 'boss_slam_impact') {
      this.spawnTone(dest, 'sine', 95, 22, volume * 0.95, 0.88);
      this.spawnNoise(dest, volume * 0.78, 0.75, 'lowpass', 620, 75);
      return;
    }
    if (id === 'boss_jump_prep') {
      this.spawnTone(dest, 'sawtooth', 62, 138, volume * 0.72, 0.65);
      this.spawnNoise(dest, volume * 0.48, 0.55, 'bandpass', 280, 720, 0, 2.0);
      return;
    }
    if (id === 'boss_jump_air') {
      this.spawnNoise(dest, volume * 0.72, 0.78, 'bandpass', 920, 240, 0, 1.3);
      this.spawnTone(dest, 'triangle', 148, 68, volume * 0.45, 0.65);
      return;
    }
    if (id === 'boss_jump_land') {
      this.spawnTone(dest, 'sine', 112, 20, volume * 0.98, 0.95);
      this.spawnNoise(dest, volume * 0.88, 0.85, 'lowpass', 720, 65);
      this.spawnNoise(dest, volume * 0.45, 0.45, 'highpass', 1100, 320, 0.08);
      return;
    }
    if (id === 'boss_hit') {
      this.spawnTone(dest, 'triangle', 145, 52, volume * 0.58, 0.14);
      this.spawnNoise(dest, volume * 0.28, 0.09, 'bandpass', 900, 350);
      return;
    }
    if (id === 'boss_resurrection_twitch') {
      // Wet bone snaps + ragged metallic exhale
      this.spawnNoise(dest, volume * 0.65, 0.08, 'bandpass', 1800, 650, 0, 2.8);
      this.spawnNoise(dest, volume * 0.58, 0.07, 'bandpass', 2200, 900, 0.22, 3.0);
      this.spawnTone(dest, 'sawtooth', 72, 48, volume * 0.45, 0.55, 0.05);
      this.spawnNoise(dest, volume * 0.42, 0.65, 'lowpass', 420, 140, 0.12);
      return;
    }
    if (id === 'boss_mutation_morph') {
      // Deep tearing flesh + rising sub-bass biological swell
      this.spawnNoise(dest, volume * 0.68, 1.5, 'bandpass', 320, 1400, 0, 1.4);
      this.spawnTone(dest, 'sawtooth', 38, 118, volume * 0.65, 1.6);
      this.spawnTone(dest, 'triangle', 54, 24, volume * 0.72, 1.4, 0.2);
      this.spawnNoise(dest, volume * 0.52, 0.45, 'highpass', 1500, 720, 0.65);
      return;
    }
    if (id === 'boss_phase2_roar') {
      // Layered abyssal nightmare double-roar
      this.spawnNoise(dest, volume * 0.75, 1.45, 'bandpass', 620, 120, 0, 1.4);
      this.spawnTone(dest, 'sawtooth', 124, 34, volume * 0.82, 1.4);
      this.spawnTone(dest, 'sawtooth', 78, 22, volume * 0.75, 1.5, 0.06);
      this.spawnTone(dest, 'square', 196, 62, volume * 0.35, 0.85, 0.08);
      return;
    }
    if (id === 'boss_shockwave') {
      this.spawnTone(dest, 'sine', 130, 24, volume * 0.92, 0.72);
      this.spawnNoise(dest, volume * 0.74, 0.58, 'lowpass', 780, 95);
      return;
    }
    if (id === 'boss_tendril_fire') {
      this.spawnNoise(dest, volume * 0.58, 0.18, 'bandpass', 2100, 520, 0, 2.1);
      this.spawnTone(dest, 'sawtooth', 290, 95, volume * 0.48, 0.16);
      return;
    }

    if (id === 'distant_siren') {
      // Eerie warbling air-raid evacuation siren in distant mist
      this.spawnTone(dest, 'sine', 390, 560, volume * 0.28, 1.3);
      this.spawnTone(dest, 'sine', 560, 340, volume * 0.25, 1.5, 1.3);
      return;
    }
    if (id === 'gate_open' || id === 'bunker_open' || id === 'exit_gate_open') {
      // Heavy iron/stone scraping groan + mechanical latch clank
      this.spawnTone(dest, 'sawtooth', 95, 58, volume * 0.45, 1.5);
      this.spawnNoise(dest, volume * 0.42, 1.4, 'bandpass', 420, 180, 0.05, 2.2);
      this.spawnTone(dest, 'square', 180, 72, volume * 0.32, 0.18, 0.02);
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
      // Pneumatic latch unlock + heavy steel slide open
      this.spawnTone(dest, 'square', 220, 140, volume * 0.35, 0.08);
      this.spawnNoise(dest, volume * 0.48, 0.82, 'bandpass', 540, 260, 0.04, 1.8);
      this.spawnTone(dest, 'triangle', 120, 185, volume * 0.3, 0.55, 0.06);
      return;
    }
    if (id === 'elevator_door_close') {
      // Rolling door slide + heavy magnetic lock thud
      this.spawnNoise(dest, volume * 0.48, 0.75, 'bandpass', 380, 190, 0, 1.6);
      this.spawnTone(dest, 'triangle', 145, 78, volume * 0.38, 0.45, 0.05);
      this.spawnTone(dest, 'sine', 110, 32, volume * 0.72, 0.26, 0.68);
      this.spawnNoise(dest, volume * 0.45, 0.12, 'lowpass', 480, 120, 0.68);
      return;
    }
    if (id === 'elevator_brake') {
      // Hydraulic arrestor screech + heavy cabin stop thump
      this.spawnNoise(dest, volume * 0.42, 0.42, 'bandpass', 1450, 520, 0, 3.0);
      this.spawnTone(dest, 'sine', 92, 28, volume * 0.75, 0.34, 0.14);
      this.spawnTone(dest, 'triangle', 180, 88, volume * 0.4, 0.22, 0.16);
      return;
    }
    if (id === 'crowd_cheer_celebration') {
      // Warm sunlit outdoor crowd cheering + multiple uplifting voice swells
      this.spawnNoise(dest, volume * 0.48, 1.6, 'bandpass', 1050, 740, 0, 0.9);
      this.spawnNoise(dest, volume * 0.36, 1.4, 'bandpass', 1950, 1380, 0.08, 1.2);
      this.spawnTone(dest, 'triangle', 261.63, 329.63, volume * 0.18, 0.65, 0.04);
      this.spawnTone(dest, 'triangle', 392.0, 523.25, volume * 0.16, 0.75, 0.12);
      return;
    }
    if (id === 'crowd_clap') {
      // Burst of staggered audience handclaps
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
      // Deep ragged predatory inhale + guttural exhale in the silence
      this.spawnNoise(dest, volume * 0.45, 0.85, 'bandpass', 240, 420, 0, 2.6);
      this.spawnTone(dest, 'sawtooth', 54, 42, volume * 0.35, 0.9, 0.05);
      this.spawnNoise(dest, volume * 0.52, 1.05, 'bandpass', 360, 150, 0.95, 2.2);
      this.spawnTone(dest, 'sawtooth', 48, 28, volume * 0.42, 1.0, 0.95);
      return;
    }
    if (id === 'arena_crowd_cheer') {
      // Layered echoing colosseum horde roar
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
      return;
    }
    if (id === 'chase_footstep') {
      const pitch = 0.9 + Math.random() * 0.2;
      this.spawnNoise(dest, volume * 0.58, 0.085, 'lowpass', 340 * pitch, 95);
      this.spawnTone(dest, 'sine', 85 * pitch, 34, volume * 0.38, 0.07);
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

    // Sustained atmospheric horror sub-drone (or warm major pad for outro celebration)
    const droneOsc = ctx.createOscillator();
    const droneSub = ctx.createOscillator();
    const droneFilter = ctx.createBiquadFilter();
    const droneGain = ctx.createGain();

    const rootHz =
      trackId === 'music_menu'
        ? 46.25 // F#1 eerie menu drone
        : trackId === 'music_stage1'
        ? 55.0 // A1
        : trackId === 'music_stage2'
        ? 49.0 // G1 industrial
        : trackId === 'music_stage3'
        ? 43.65 // F1 lab dread
        : trackId === 'music_victory' || trackId === 'music_outro_celebration'
        ? 130.81 // C3 bright triumphant pad
        : trackId === 'music_boss_phase2'
        ? 36.71 // D1 abyssal phase 2
        : 41.2; // E1 boss

    droneOsc.type =
      trackId === 'music_victory' || trackId === 'music_outro_celebration'
        ? 'triangle'
        : 'sawtooth';
    droneOsc.frequency.value = rootHz;
    droneSub.type = 'sine';
    droneSub.frequency.value = rootHz * 0.5;

    droneFilter.type = 'lowpass';
    droneFilter.frequency.value =
      trackId === 'music_menu'
        ? 160
        : trackId === 'music_outro_celebration'
        ? 520
        : trackId === 'music_boss_phase2'
        ? 380
        : trackId === 'music_boss'
        ? 290
        : 210;

    droneGain.gain.setValueAtTime(0.001, ctx.currentTime);
    droneGain.gain.linearRampToValueAtTime(baseVolume * 0.3, ctx.currentTime + 0.8);

    droneOsc.connect(droneFilter);
    droneSub.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(dest);
    droneOsc.start();
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
          this.spawnTone(dest, 'sine', n, n * 0.99, baseVolume * 0.14, 1.4);
        }
        if (idx % 6 === 2) {
          this.spawnNoise(dest, baseVolume * 0.08, 0.9, 'bandpass', 260, 140);
        }
        return;
      }

      if (trackId === 'music_outro_celebration') {
        // Uplifting C major / F major / G major hopeful anthem arpeggio
        const prog = [
          [261.63, 329.63, 392.0, 523.25], // C
          [220.0, 261.63, 329.63, 440.0], // Am
          [174.61, 220.0, 261.63, 349.23], // F
          [196.0, 246.94, 293.66, 392.0], // G
        ];
        const bar = Math.floor(idx / 4) % prog.length;
        const chord = prog[bar];
        const note = chord[idx % chord.length];
        this.spawnTone(dest, 'triangle', note, note, baseVolume * 0.24, 0.72);
        if (idx % 4 === 0) {
          this.spawnTone(dest, 'sine', chord[0] * 0.5, chord[0] * 0.5, baseVolume * 0.28, 1.35);
        }
        if (idx % 2 === 0) {
          this.spawnNoise(dest, baseVolume * 0.06, 0.05, 'highpass', 3400, 1800);
        }
        return;
      }

      if (trackId === 'music_victory') {
        const chord = [130.81, 164.81, 196.0, 261.63];
        const note = chord[idx % chord.length];
        this.spawnTone(dest, 'triangle', note, note, baseVolume * 0.2, 0.95);
        if (idx % 4 === 0) {
          this.spawnTone(dest, 'sine', 65.41, 65.41, baseVolume * 0.25, 1.3);
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
        // Dark horror bass pulse
        this.spawnTone(
          dest,
          isBossAny ? 'sawtooth' : 'triangle',
          rootHz * 2 * mult,
          rootHz * 1.96 * mult,
          baseVolume * (trackId === 'music_boss_phase2' ? 0.34 : isBossAny ? 0.28 : 0.22),
          stepMs / 1150
        );
      }

      // Industrial / metallic percussion hits
      const kickModulo =
        trackId === 'music_boss_phase2' ? 2 : isBossAny ? 3 : 4;
      if (idx % kickModulo === 0) {
        this.spawnTone(dest, 'sine', 120, 30, baseVolume * (trackId === 'music_boss_phase2' ? 0.42 : 0.34), 0.16);
        this.spawnNoise(dest, baseVolume * 0.16, 0.08, 'bandpass', 950, 320);
      }
      if (trackId === 'music_stage2' && idx % 4 === 2) {
        this.spawnTone(dest, 'square', 440, 280, baseVolume * 0.07, 0.08);
      }
      if ((trackId === 'music_stage3' || isBossAny) && idx % 2 === 1) {
        this.spawnNoise(
          dest,
          baseVolume * (trackId === 'music_boss_phase2' ? 0.2 : bossPhase === 2 ? 0.16 : 0.1),
          0.05,
          'highpass',
          3200,
          1800
        );
      }
      if (trackId === 'music_boss_phase2' && idx % 8 === 4) {
        this.spawnTone(dest, 'square', 220 * mult, 180 * mult, baseVolume * 0.12, 0.14);
      }
    }, stepMs);

    return {
      setBossPhase: (phase) => {
        bossPhase = phase;
        const cur = this.getContext();
        if (cur && !stopped) {
          droneFilter.frequency.setTargetAtTime(
            phase === 2 ? 340 : 290,
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
          droneSub.stop();
          droneOsc.disconnect();
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
      this.spawnNoise(dest, volume * 0.32, 1.3, 'bandpass', 420, 180);
    } else if (env === 'industrial') {
      this.spawnTone(dest, 'triangle', 190, 88, volume * 0.24, 0.25);
      this.spawnNoise(dest, volume * 0.22, 0.18, 'bandpass', 1400, 620, 0.03);
    } else if (env === 'research') {
      // Electrical crackle or drip
      if (Math.random() < 0.5) {
        this.spawnTone(dest, 'sine', 960, 1480, volume * 0.2, 0.09);
      } else {
        this.spawnNoise(dest, volume * 0.24, 0.14, 'highpass', 2400, 1200);
      }
    } else {
      // Boss Arena deep subterranean shudder
      this.spawnTone(dest, 'sine', 52, 26, volume * 0.38, 1.2);
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
