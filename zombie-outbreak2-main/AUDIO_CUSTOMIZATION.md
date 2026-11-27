# Audio Customization Guide — ZOMBIE OUTBREAK

All sound effects, ambient loops, UI feedback, and music tracks are managed through a centralized audio pipeline in `src/audio/`. Gameplay classes (`Zombie`, `Weapon`, `CombatSystem`, UI screens) never load or decode audio files directly—they call `audioManager.play(soundId)` or `audioManager.playMusic(soundId)`.

---

## Architecture

- **`src/audio/AudioManifest.ts`**: Maps every `SoundId` to an audio file path under `/assets/audio/`, its mixing category (`sfx`, `music`, `ambient`, `ui`), default relative volume, and loop flag.
- **`src/audio/AudioConfig.ts`**: Stores user volume sliders, global mute state, and per-category enable/disable toggles in `localStorage` (`zombie_outbreak_audio_settings_v1`).
- **`src/audio/AudioManager.ts`**:
  - Unlocks `AudioContext` on the first user click/key interaction.
  - Routes audio through Master → Category (`sfx`, `music`, `ambient`, `ui`) → `AudioDestinationNode`.
  - Automatically falls back to synthesized Web Audio tones if an `.ogg` file is missing or cannot be decoded, ensuring the game never crashes.

---

## Replacing Existing Sound Files

To replace any sound without editing TypeScript code, overwrite the corresponding `.ogg` file in `public/assets/audio/` using the exact same filename (Vorbis `.ogg`, mono or stereo, 44.1 kHz recommended):

### Weapon Sounds (`sfx`)
| Sound ID | File Path | Trigger |
|---|---|---|
| `gunshot` | `public/assets/audio/gunshot.ogg` | Primary shot fired |
| `gunshot_var` | `public/assets/audio/gunshot-var.ogg` | Randomized gunshot variation (45% chance) |
| `weapon_empty` | `public/assets/audio/weapon-empty.ogg` | Dry-fire click on empty magazine |
| `weapon_reload` | `public/assets/audio/weapon-reload.ogg` | Reload sequence started |
| `weapon_handling` | `public/assets/audio/weapon-handling.ogg` | Mission weapon ready / reload finished |

### Zombie Sounds (`sfx`)
| Sound ID | File Path | Trigger |
|---|---|---|
| `zombie_groan` | `public/assets/audio/zombie-groan.ogg` | Periodic active zombie groan |
| `zombie_walk` | `public/assets/audio/zombie-walk.ogg` | Zombie movement step |
| `zombie_attack` | `public/assets/audio/zombie-attack.ogg` | Zombie hits player |
| `zombie_hit` | `public/assets/audio/zombie-hit.ogg` | Bullet impacts zombie |
| `zombie_death` | `public/assets/audio/zombie-death.ogg` | Zombie eliminated |

### Environment Ambience (`ambient`)
| Sound ID | File Path | Trigger |
|---|---|---|
| `ambience_city` | `public/assets/audio/ambience-city.ogg` | Seamless abandoned city drone loop |
| `ambience_wind` | `public/assets/audio/ambience-wind.ogg` | Seamless cold urban wind loop |
| `ambience_distant_zombie` | `public/assets/audio/ambience-distant-zombie.ogg` | Periodic distant eerie echo |

### UI & Mission Cues (`ui`)
| Sound ID | File Path | Trigger |
|---|---|---|
| `ui_click` | `public/assets/audio/ui-click.ogg` | Button press |
| `ui_select` | `public/assets/audio/ui-select.ogg` | Primary action confirm |
| `ui_pause` | `public/assets/audio/ui-pause.ogg` | Game paused |
| `ui_resume` | `public/assets/audio/ui-resume.ogg` | Game resumed |
| `mission_start` | `public/assets/audio/mission-start.ogg` | Start Mission button pressed |
| `stage_complete` | `public/assets/audio/stage-complete.ogg` | Stage objective achieved |
| `mission_fail` | `public/assets/audio/mission-fail.ogg` | Player defeated or timer expired |

### Music (`music`)
| Sound ID | File Path | Trigger |
|---|---|---|
| `music_menu` | `public/assets/audio/music-menu.ogg` | Looping Main Menu / Setup theme |
| `music_gameplay` | `public/assets/audio/music-gameplay.ogg` | Looping active combat track |
| `music_victory` | `public/assets/audio/music-victory.ogg` | Stage completed result screen |
| `music_gameover` | `public/assets/audio/music-gameover.ogg` | Mission failed result screen |

---

## Adding New Sound Effects or Using WAV/MP3

1. Drop your new audio file (`.ogg`, `.wav`, or `.mp3`) into `public/assets/audio/`.
2. Add a new entry to `AUDIO_MANIFEST` in `src/audio/AudioManifest.ts`:
   ```ts
   headshot_chime: {
     path: '/assets/audio/headshot-chime.ogg',
     category: 'sfx',
     defaultVolume: 0.75,
   },
   ```
3. Trigger it anywhere via `audioManager.play('headshot_chime')`.

---

## Default Volume Tuning

Default levels are defined in `DEFAULT_AUDIO_SETTINGS` inside `src/audio/AudioConfig.ts`. Players can override them live inside the in-game **Settings** screen (accessible from both the Main Menu and Pause Screen).
