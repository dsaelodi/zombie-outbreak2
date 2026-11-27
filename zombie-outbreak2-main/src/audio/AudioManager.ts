import {
  AUDIO_MANIFEST,
  type AudioCategory,
  type SoundId,
} from './AudioManifest';
import {
  cloneAudioSettings,
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from './AudioConfig';
import type { StageEnvironmentId } from '../data/stages';
import { logger } from '../utils/logger';
import {
  computeSpatialPanAndGain,
  ProceduralAudioEngine,
  type ProceduralMusicController,
} from './ProceduralAudio';
import {
  ArenaCrowdAudioController,
  type ArenaCrowdAudioState,
  type ArenaCrowdReactionKind,
} from './ArenaCrowdAudioController';

interface ActiveLoop {
  id: SoundId;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbSendGain: GainNode | null = null;
  private categoryGains: Partial<Record<AudioCategory, GainNode>> = {};
  private buffers = new Map<SoundId, AudioBuffer>();
  private loadingPromises = new Map<SoundId, Promise<AudioBuffer | null>>();
  private failedIds = new Set<SoundId>();
  private lastPlayedMs = new Map<SoundId, number>();

  private activeMusic: ActiveLoop | null = null;
  private activeProceduralMusic: { id: SoundId; ctrl: ProceduralMusicController } | null = null;
  private currentMusicId: SoundId | null = null;

  private activeAmbience: ActiveLoop[] = [];
  private activeAmbienceEnv: StageEnvironmentId = 'urban';
  private distantTimerId: number | null = null;
  private envPulseTimerId: number | null = null;
  private settings: AudioSettings;
  private preloaded = false;
  private noiseBuffer: AudioBuffer | null = null;

  private readonly procedural = new ProceduralAudioEngine(
    () => this.ctx,
    () => this.noiseBuffer
  );

  private readonly arenaCrowd = new ArenaCrowdAudioController(
    () => this.ctx,
    () => this.noiseBuffer,
    () => this.categoryGains.ambient ?? null,
    () => this.settings.muted || !this.settings.enabledCategories.ambient
  );

  constructor() {
    this.settings = loadAudioSettings();
  }

  public getSettings(): AudioSettings {
    return cloneAudioSettings(this.settings);
  }

  public updateSettings(partial: Partial<AudioSettings>): void {
    this.settings = {
      ...this.settings,
      ...partial,
      enabledCategories: {
        ...this.settings.enabledCategories,
        ...(partial.enabledCategories ?? {}),
      },
    };
    saveAudioSettings(this.settings);
    this.applyVolumes();
  }

  public resetSettings(): void {
    this.settings = cloneAudioSettings(DEFAULT_AUDIO_SETTINGS);
    saveAudioSettings(this.settings);
    this.applyVolumes();
  }

  public toggleMute(): boolean {
    this.updateSettings({ muted: !this.settings.muted });
    return this.settings.muted;
  }

  public async unlock(): Promise<void> {
    this.ensureContext();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (err) {
        logger.warn('AudioManager', 'Could not resume AudioContext', err);
      }
    }
    if (!this.preloaded) {
      this.preloaded = true;
      void this.preloadAll();
    }
  }

  private createImpulseResponse(durationSec = 1.65, decay = 2.8): AudioBuffer | null {
    if (!this.ctx) return null;
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * durationSec);
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.pow(1 - t, decay);
        const earlyBoost = i < rate * 0.045 ? 1.25 : 1.0;
        data[i] = (Math.random() * 2 - 1) * env * earlyBoost;
      }
    }
    return impulse;
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();

    // Master dynamics compressor & limiter for punchy, distortion-free mix
    this.masterCompressor = this.ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.setValueAtTime(-14, this.ctx.currentTime);
    this.masterCompressor.knee.setValueAtTime(12, this.ctx.currentTime);
    this.masterCompressor.ratio.setValueAtTime(4.5, this.ctx.currentTime);
    this.masterCompressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    this.masterCompressor.release.setValueAtTime(0.18, this.ctx.currentTime);

    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.masterCompressor);
    this.masterCompressor.connect(this.ctx.destination);

    // Stereo algorithmic spatial reverb bus
    const irBuffer = this.createImpulseResponse(1.6, 3.0);
    if (irBuffer) {
      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = irBuffer;
      this.reverbSendGain = this.ctx.createGain();
      this.reverbSendGain.gain.value = 0.22;
      this.reverbNode.connect(this.reverbSendGain);
      this.reverbSendGain.connect(this.masterGain);
    }

    const categories: AudioCategory[] = ['sfx', 'music', 'ambient', 'ui'];
    for (const cat of categories) {
      const gain = this.ctx.createGain();
      gain.connect(this.masterGain);
      if (this.reverbNode && (cat === 'sfx' || cat === 'ambient')) {
        const send = this.ctx.createGain();
        send.gain.value = cat === 'ambient' ? 0.35 : 0.18;
        gain.connect(send);
        send.connect(this.reverbNode);
      }
      this.categoryGains[cat] = gain;
    }

    // Pink-weighted rich noise buffer (smoother and deeper than raw white noise)
    const len = Math.floor(this.ctx.sampleRate * 2.0);
    const nb = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = nb.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      const pink = (b0 + b1 + b2 + white * 0.1848) * 0.12;
      ch[i] = Math.max(-1, Math.min(1, white * 0.62 + pink * 0.38));
    }
    this.noiseBuffer = nb;

    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const masterVal = this.settings.muted ? 0 : this.settings.masterVolume;
    this.masterGain.gain.setTargetAtTime(masterVal, now, 0.02);

    const catMap: Record<AudioCategory, number> = {
      sfx: this.settings.sfxVolume,
      music: this.settings.musicVolume,
      ambient: this.settings.ambientVolume,
      ui: this.settings.uiVolume,
    };

    for (const cat of Object.keys(catMap) as AudioCategory[]) {
      const node = this.categoryGains[cat];
      if (!node) continue;
      const enabled = this.settings.enabledCategories[cat];
      node.gain.setTargetAtTime(enabled ? catMap[cat] : 0, now, 0.02);
    }
  }

  public async preloadAll(): Promise<void> {
    const ids = Object.keys(AUDIO_MANIFEST) as SoundId[];
    await Promise.all(
      ids
        .filter((id) => {
          const entry = AUDIO_MANIFEST[id];
          return !('proceduralOnly' in entry && entry.proceduralOnly);
        })
        .map((id) => this.loadSound(id))
    );
  }

  private async loadSound(id: SoundId): Promise<AudioBuffer | null> {
    this.ensureContext();
    if (!this.ctx) return null;
    const entry = AUDIO_MANIFEST[id];
    if ('proceduralOnly' in entry && entry.proceduralOnly) return null;
    if (!entry.path) return null;
    if (this.buffers.has(id)) return this.buffers.get(id)!;
    if (this.failedIds.has(id)) return null;
    if (this.loadingPromises.has(id)) return this.loadingPromises.get(id)!;

    const promise = (async () => {
      try {
        const res = await fetch(entry.path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const decoded = await this.ctx!.decodeAudioData(buf);
        this.buffers.set(id, decoded);
        return decoded;
      } catch (err) {
        logger.warn('AudioManager', `Asset missing/invalid for "${id}", using WebAudio fallback`, err);
        this.failedIds.add(id);
        return null;
      } finally {
        this.loadingPromises.delete(id);
      }
    })();

    this.loadingPromises.set(id, promise);
    return promise;
  }

  public async play(
    id: SoundId,
    options?: { volume?: number; playbackRate?: number; minIntervalMs?: number }
  ): Promise<void> {
    this.ensureContext();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    if (options?.minIntervalMs) {
      const nowPerf = performance.now();
      const prev = this.lastPlayedMs.get(id) ?? 0;
      if (nowPerf - prev < options.minIntervalMs) return;
      this.lastPlayedMs.set(id, nowPerf);
    }

    let actualId: SoundId = id;
    if (id === 'gunshot' && Math.random() < 0.45) {
      actualId = 'gunshot_var';
    }

    const entry = AUDIO_MANIFEST[actualId];
    if (this.settings.muted || !this.settings.enabledCategories[entry.category]) {
      return;
    }

    const categoryGain = this.categoryGains[entry.category];
    if (!categoryGain) return;

    const playVolume = entry.defaultVolume * (options?.volume ?? 1);

    if ('proceduralOnly' in entry && entry.proceduralOnly) {
      this.procedural.playSfx(actualId, categoryGain, playVolume);
      return;
    }

    const buffer = await this.loadSound(actualId);
    if (!buffer) {
      this.procedural.playSfx(actualId, categoryGain, playVolume);
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value =
      options?.playbackRate ?? (actualId.startsWith('gunshot') ? 0.95 + Math.random() * 0.1 : 1);

    // Subtle EQ enhancement for sample playback
    const eqFilter = this.ctx.createBiquadFilter();
    eqFilter.type = 'lowshelf';
    eqFilter.frequency.value = 160;
    eqFilter.gain.value = actualId.startsWith('gunshot') || actualId.startsWith('zombie') ? 3.5 : 1.5;

    const gain = this.ctx.createGain();
    gain.gain.value = playVolume;

    source.connect(eqFilter);
    eqFilter.connect(gain);
    gain.connect(categoryGain);
    source.start();

    // Hybrid transient/sub-bass layer on top of OGG sample for high-impact combat audio
    if (actualId.startsWith('gunshot') || actualId === 'zombie_attack' || actualId === 'zombie_death') {
      this.procedural.playSfx(actualId, categoryGain, playVolume * 0.38);
    }
  }

  /**
   * Plays a sound with 3D stereo panning, distance attenuation, and high-frequency air absorption.
   */
  public async playSpatial(
    id: SoundId,
    sourceX: number,
    sourceZ: number,
    listenerX: number,
    listenerZ: number,
    listenerYaw: number,
    options?: { volume?: number; minIntervalMs?: number }
  ): Promise<void> {
    this.ensureContext();
    if (!this.ctx || this.ctx.state === 'suspended') return;

    if (options?.minIntervalMs) {
      const nowPerf = performance.now();
      const prev = this.lastPlayedMs.get(id) ?? 0;
      if (nowPerf - prev < options.minIntervalMs) return;
      this.lastPlayedMs.set(id, nowPerf);
    }

    const entry = AUDIO_MANIFEST[id];
    if (this.settings.muted || !this.settings.enabledCategories[entry.category]) {
      return;
    }
    const categoryGain = this.categoryGains[entry.category];
    if (!categoryGain) return;

    const { pan, gainMult } = computeSpatialPanAndGain(
      sourceX,
      sourceZ,
      listenerX,
      listenerZ,
      listenerYaw
    );
    const playVolume = entry.defaultVolume * (options?.volume ?? 1) * gainMult;

    // Distance-based lowpass filter for realistic 3D spatial depth
    const distanceFilter = this.ctx.createBiquadFilter();
    distanceFilter.type = 'lowpass';
    distanceFilter.frequency.value = Math.max(650, 1400 + gainMult * 9500);

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;

    distanceFilter.connect(panner);
    panner.connect(categoryGain);

    if ('proceduralOnly' in entry && entry.proceduralOnly) {
      this.procedural.playSfx(id, distanceFilter, playVolume);
      return;
    }

    const buffer = await this.loadSound(id);
    if (!buffer) {
      this.procedural.playSfx(id, distanceFilter, playVolume);
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.92 + Math.random() * 0.16;

    const gain = this.ctx.createGain();
    gain.gain.value = playVolume;

    source.connect(gain);
    gain.connect(distanceFilter);
    source.start();
  }

  public setBossMusicPhase(phase: 1 | 2): void {
    this.activeProceduralMusic?.ctrl.setBossPhase(phase);
  }

  public setArenaCrowdState(state: ArenaCrowdAudioState): void {
    if (state !== 'off') {
      this.ensureContext();
    }
    this.arenaCrowd.setState(state);
  }

  public getArenaCrowdState(): ArenaCrowdAudioState {
    return this.arenaCrowd.getState();
  }

  public setArenaCrowdPaused(paused: boolean): void {
    this.arenaCrowd.setPaused(paused);
  }

  public triggerArenaCrowdReaction(kind: ArenaCrowdReactionKind): void {
    this.arenaCrowd.triggerReaction(kind);
  }

  public silenceAllMusicAndDistant(): void {
    this.stopMusic();
  }

  public async playMusic(id: SoundId): Promise<void> {
    this.ensureContext();
    if (!this.ctx) return;
    if (this.currentMusicId === id) return;

    this.stopMusic();
    this.currentMusicId = id;

    const entry = AUDIO_MANIFEST[id];
    const categoryGain = this.categoryGains[entry.category];
    if (!categoryGain) return;

    if (
      id === 'music_stage1' ||
      id === 'music_stage2' ||
      id === 'music_stage3' ||
      id === 'music_boss' ||
      id === 'music_boss_phase2' ||
      id === 'music_outro_celebration'
    ) {
      const ctrl = this.procedural.startMusicLoop(id, categoryGain, entry.defaultVolume);
      if (ctrl) {
        this.activeProceduralMusic = { id, ctrl };
      }
      return;
    }

    const buffer = await this.loadSound(id);
    if (!buffer || this.currentMusicId !== id) {
      if (
        this.currentMusicId === id &&
        (id === 'music_menu' || id === 'music_victory')
      ) {
        const ctrl = this.procedural.startMusicLoop(id, categoryGain, entry.defaultVolume);
        if (ctrl) this.activeProceduralMusic = { id, ctrl };
      }
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = 'loop' in entry ? Boolean(entry.loop) : false;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(entry.defaultVolume, this.ctx.currentTime + 0.65);

    source.connect(gain);
    gain.connect(categoryGain);
    source.start();

    this.activeMusic = { id, source, gain };
  }

  public fadeOutMusic(durationSec = 0.75): void {
    if (!this.ctx) {
      this.stopMusic();
      return;
    }
    const now = this.ctx.currentTime;
    if (this.activeMusic) {
      try {
        this.activeMusic.gain.gain.cancelScheduledValues(now);
        this.activeMusic.gain.gain.setValueAtTime(this.activeMusic.gain.gain.value, now);
        this.activeMusic.gain.gain.linearRampToValueAtTime(0.001, now + durationSec);
      } catch {
        // Ignore
      }
    }
    window.setTimeout(() => {
      this.stopMusic();
    }, Math.max(50, Math.round(durationSec * 1000)));
  }

  public stopMusic(): void {
    this.currentMusicId = null;
    if (this.activeProceduralMusic) {
      this.activeProceduralMusic.ctrl.stop();
      this.activeProceduralMusic = null;
    }
    if (!this.activeMusic) return;
    try {
      this.activeMusic.source.stop();
      this.activeMusic.source.disconnect();
      this.activeMusic.gain.disconnect();
    } catch {
      // Ignore
    }
    this.activeMusic = null;
  }

  public setEnvironmentAmbience(env: StageEnvironmentId): void {
    this.activeAmbienceEnv = env;
    if (this.activeAmbience.length === 0 && this.envPulseTimerId === null) {
      void this.startAmbience(env);
    }
  }

  public async startAmbience(env: StageEnvironmentId = this.activeAmbienceEnv): Promise<void> {
    this.activeAmbienceEnv = env;
    this.ensureContext();
    if (!this.ctx) return;
    if (this.activeAmbience.length > 0) return;

    const loopIds: SoundId[] = ['ambience_city', 'ambience_wind'];
    for (const id of loopIds) {
      const entry = AUDIO_MANIFEST[id];
      const categoryGain = this.categoryGains[entry.category];
      if (!categoryGain) continue;
      const buffer = await this.loadSound(id);
      if (!buffer) continue;

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(entry.defaultVolume, this.ctx.currentTime + 0.8);

      source.connect(gain);
      gain.connect(categoryGain);
      source.start();
      this.activeAmbience.push({ id, source, gain });
    }

    if (this.distantTimerId === null) {
      this.scheduleDistantAmbience();
    }
    if (this.envPulseTimerId === null) {
      this.scheduleEnvPulse();
    }
  }

  private scheduleDistantAmbience(): void {
    const delayMs = 7000 + Math.random() * 8500;
    this.distantTimerId = window.setTimeout(() => {
      this.distantTimerId = null;
      if (this.activeAmbience.length > 0) {
        void this.play('ambience_distant_zombie', { volume: 0.65 });
        this.scheduleDistantAmbience();
      }
    }, delayMs);
  }

  private scheduleEnvPulse(): void {
    const delayMs = 3800 + Math.random() * 5200;
    this.envPulseTimerId = window.setTimeout(() => {
      this.envPulseTimerId = null;
      const catGain = this.categoryGains.ambient;
      if (catGain && this.ctx && this.ctx.state === 'running' && !this.settings.muted) {
        this.procedural.triggerEnvironmentPulse(this.activeAmbienceEnv, catGain, 0.55);
      }
      if (this.activeAmbience.length > 0 || this.currentMusicId !== null) {
        this.scheduleEnvPulse();
      }
    }, delayMs);
  }

  public stopAmbience(): void {
    this.arenaCrowd.stop();
    if (this.distantTimerId !== null) {
      clearTimeout(this.distantTimerId);
      this.distantTimerId = null;
    }
    if (this.envPulseTimerId !== null) {
      clearTimeout(this.envPulseTimerId);
      this.envPulseTimerId = null;
    }
    for (const loop of this.activeAmbience) {
      try {
        loop.source.stop();
        loop.source.disconnect();
        loop.gain.disconnect();
      } catch {
        // Ignore
      }
    }
    this.activeAmbience = [];
  }

  public dispose(): void {
    this.arenaCrowd.dispose();
    this.stopMusic();
    this.stopAmbience();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}

export const audioManager = new AudioManager();
