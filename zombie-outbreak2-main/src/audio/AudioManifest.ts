export type AudioCategory = 'sfx' | 'music' | 'ambient' | 'ui';

export interface AudioAssetEntry {
  path: string;
  category: AudioCategory;
  defaultVolume: number;
  loop?: boolean;
  /** Synthesized directly in WebAudio without issuing a network fetch (zero 404s) */
  proceduralOnly?: boolean;
}

export const AUDIO_MANIFEST = {
  // Weapon Sounds (existing .ogg + procedural)
  gunshot: {
    path: '/assets/audio/gunshot.ogg',
    category: 'sfx',
    defaultVolume: 0.85,
  },
  gunshot_var: {
    path: '/assets/audio/gunshot-var.ogg',
    category: 'sfx',
    defaultVolume: 0.85,
  },
  weapon_empty: {
    path: '/assets/audio/weapon-empty.ogg',
    category: 'sfx',
    defaultVolume: 0.65,
  },
  weapon_reload: {
    path: '/assets/audio/weapon-reload.ogg',
    category: 'sfx',
    defaultVolume: 0.72,
  },
  weapon_handling: {
    path: '/assets/audio/weapon-handling.ogg',
    category: 'sfx',
    defaultVolume: 0.55,
  },

  // Layered Weapon Fire & Reload Foley (procedural WebAudio)
  ar_fire: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.82,
    proceduralOnly: true,
  },
  smg_fire: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.7,
    proceduralOnly: true,
  },
  flamethrower_burst: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.58,
    proceduralOnly: true,
  },
  grenade_throw: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.65,
    proceduralOnly: true,
  },
  explosion: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.94,
    proceduralOnly: true,
  },
  reload_mag_out: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.62,
    proceduralOnly: true,
  },
  reload_mag_in: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.68,
    proceduralOnly: true,
  },
  reload_bolt: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.65,
    proceduralOnly: true,
  },
  reload_fuel: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.65,
    proceduralOnly: true,
  },

  weapon_switch: {
    path: '',
    category: 'ui',
    defaultVolume: 0.68,
    proceduralOnly: true,
  },
  wheel_open: {
    path: '',
    category: 'ui',
    defaultVolume: 0.6,
    proceduralOnly: true,
  },
  wheel_close: {
    path: '',
    category: 'ui',
    defaultVolume: 0.52,
    proceduralOnly: true,
  },
  footstep: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.42,
    proceduralOnly: true,
  },
  chase_footstep: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.56,
    proceduralOnly: true,
  },

  // Responsive Hit Impacts (Played ONLY on actual zombie hits)
  impact_flesh: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.68,
    proceduralOnly: true,
  },
  impact_heavy: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.78,
    proceduralOnly: true,
  },
  impact_armor: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.74,
    proceduralOnly: true,
  },
  impact_mutated: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.76,
    proceduralOnly: true,
  },

  // Category-Specific Zombie & Boss SFX
  zombie_groan: {
    path: '/assets/audio/zombie-groan.ogg',
    category: 'sfx',
    defaultVolume: 0.55,
  },
  zombie_groan_basic: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.58,
    proceduralOnly: true,
  },
  zombie_runner_shriek: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.62,
    proceduralOnly: true,
  },
  zombie_armored_clank: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.52,
    proceduralOnly: true,
  },
  zombie_mutated_gurgle: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.64,
    proceduralOnly: true,
  },
  crawler_screech: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.6,
    proceduralOnly: true,
  },
  zombie_walk: {
    path: '/assets/audio/zombie-walk.ogg',
    category: 'sfx',
    defaultVolume: 0.35,
  },
  zombie_attack: {
    path: '/assets/audio/zombie-attack.ogg',
    category: 'sfx',
    defaultVolume: 0.8,
  },
  zombie_hit: {
    path: '/assets/audio/zombie-hit.ogg',
    category: 'sfx',
    defaultVolume: 0.72,
  },
  zombie_death: {
    path: '/assets/audio/zombie-death.ogg',
    category: 'sfx',
    defaultVolume: 0.78,
  },
  boss_roar: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.9,
    proceduralOnly: true,
  },
  boss_hit: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.72,
    proceduralOnly: true,
  },
  boss_death: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.96,
    proceduralOnly: true,
  },
  boss_slam_impact: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.96,
    proceduralOnly: true,
  },
  boss_jump_prep: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.88,
    proceduralOnly: true,
  },
  boss_jump_air: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.84,
    proceduralOnly: true,
  },
  boss_jump_land: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.98,
    proceduralOnly: true,
  },
  boss_resurrection_twitch: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.85,
    proceduralOnly: true,
  },
  boss_mutation_morph: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.92,
    proceduralOnly: true,
  },
  boss_phase2_roar: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.98,
    proceduralOnly: true,
  },
  boss_shockwave: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.92,
    proceduralOnly: true,
  },
  boss_tendril_fire: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.78,
    proceduralOnly: true,
  },
  distant_siren: {
    path: '',
    category: 'ambient',
    defaultVolume: 0.52,
    proceduralOnly: true,
  },
  gate_open: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.82,
    proceduralOnly: true,
  },
  bunker_open: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.88,
    proceduralOnly: true,
  },
  facility_alarm: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.64,
    proceduralOnly: true,
  },
  elevator_hum: {
    path: '',
    category: 'ambient',
    defaultVolume: 0.58,
    proceduralOnly: true,
  },
  elevator_chime: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.72,
    proceduralOnly: true,
  },
  elevator_door_open: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.74,
    proceduralOnly: true,
  },
  elevator_door_close: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.78,
    proceduralOnly: true,
  },
  elevator_brake: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.82,
    proceduralOnly: true,
  },
  crowd_cheer_celebration: {
    path: '',
    category: 'ambient',
    defaultVolume: 0.75,
    proceduralOnly: true,
  },
  crowd_clap: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.58,
    proceduralOnly: true,
  },
  lore_paper: {
    path: '',
    category: 'ui',
    defaultVolume: 0.55,
    proceduralOnly: true,
  },
  king_breathing: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.88,
    proceduralOnly: true,
  },
  arena_crowd_cheer: {
    path: '',
    category: 'ambient',
    defaultVolume: 0.62,
    proceduralOnly: true,
  },
  exit_gate_open: {
    path: '',
    category: 'sfx',
    defaultVolume: 0.86,
    proceduralOnly: true,
  },

  // Environment Sounds
  ambience_city: {
    path: '/assets/audio/ambience-city.ogg',
    category: 'ambient',
    defaultVolume: 0.42,
    loop: true,
  },
  ambience_wind: {
    path: '/assets/audio/ambience-wind.ogg',
    category: 'ambient',
    defaultVolume: 0.38,
    loop: true,
  },
  ambience_distant_zombie: {
    path: '/assets/audio/ambience-distant-zombie.ogg',
    category: 'ambient',
    defaultVolume: 0.34,
  },

  // UI Sounds
  ui_click: {
    path: '/assets/audio/ui-click.ogg',
    category: 'ui',
    defaultVolume: 0.65,
  },
  ui_select: {
    path: '/assets/audio/ui-select.ogg',
    category: 'ui',
    defaultVolume: 0.65,
  },
  ui_pause: {
    path: '/assets/audio/ui-pause.ogg',
    category: 'ui',
    defaultVolume: 0.6,
  },
  ui_resume: {
    path: '/assets/audio/ui-resume.ogg',
    category: 'ui',
    defaultVolume: 0.6,
  },
  mission_start: {
    path: '/assets/audio/mission-start.ogg',
    category: 'ui',
    defaultVolume: 0.75,
  },
  stage_complete: {
    path: '/assets/audio/stage-complete.ogg',
    category: 'ui',
    defaultVolume: 0.8,
  },
  mission_fail: {
    path: '/assets/audio/mission-fail.ogg',
    category: 'ui',
    defaultVolume: 0.8,
  },

  // Music
  music_menu: {
    path: '/assets/audio/music-menu.ogg',
    category: 'music',
    defaultVolume: 0.48,
    loop: true,
  },
  music_gameplay: {
    path: '/assets/audio/music-gameplay.ogg',
    category: 'music',
    defaultVolume: 0.46,
    loop: true,
  },
  music_stage1: {
    path: '',
    category: 'music',
    defaultVolume: 0.46,
    loop: true,
    proceduralOnly: true,
  },
  music_stage2: {
    path: '',
    category: 'music',
    defaultVolume: 0.5,
    loop: true,
    proceduralOnly: true,
  },
  music_stage3: {
    path: '',
    category: 'music',
    defaultVolume: 0.52,
    loop: true,
    proceduralOnly: true,
  },
  music_boss: {
    path: '',
    category: 'music',
    defaultVolume: 0.56,
    loop: true,
    proceduralOnly: true,
  },
  music_boss_phase2: {
    path: '',
    category: 'music',
    defaultVolume: 0.62,
    loop: true,
    proceduralOnly: true,
  },
  music_victory: {
    path: '/assets/audio/music-victory.ogg',
    category: 'music',
    defaultVolume: 0.55,
    loop: false,
  },
  music_outro_celebration: {
    path: '',
    category: 'music',
    defaultVolume: 0.54,
    loop: true,
    proceduralOnly: true,
  },
  music_gameover: {
    path: '/assets/audio/music-gameover.ogg',
    category: 'music',
    defaultVolume: 0.55,
    loop: false,
  },
} as const satisfies Record<string, AudioAssetEntry>;

export type SoundId = keyof typeof AUDIO_MANIFEST;
