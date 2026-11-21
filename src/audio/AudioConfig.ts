import type { AudioCategory } from './AudioManifest';

export interface AudioSettings {
  muted: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  ambientVolume: number;
  uiVolume: number;
  enabledCategories: Record<AudioCategory, boolean>;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  muted: false,
  masterVolume: 0.85,
  sfxVolume: 0.9,
  musicVolume: 0.55,
  ambientVolume: 0.65,
  uiVolume: 0.8,
  enabledCategories: {
    sfx: true,
    music: true,
    ambient: true,
    ui: true,
  },
};

const AUDIO_STORAGE_KEY = 'zombie_outbreak_audio_settings_v1';

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return cloneAudioSettings(DEFAULT_AUDIO_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      ...DEFAULT_AUDIO_SETTINGS,
      ...parsed,
      enabledCategories: {
        ...DEFAULT_AUDIO_SETTINGS.enabledCategories,
        ...(parsed.enabledCategories ?? {}),
      },
    };
  } catch {
    return cloneAudioSettings(DEFAULT_AUDIO_SETTINGS);
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function cloneAudioSettings(settings: AudioSettings): AudioSettings {
  return {
    ...settings,
    enabledCategories: { ...settings.enabledCategories },
  };
}
