# ZOMBIE OUTBREAK — BIFEST Browser Game

A browser-based low-poly 3D first-person zombie survival shooter built with **TypeScript**, **Three.js**, **MediaPipe Pose Landmarker**, and **Web Audio API**. Designed for BIFEST exhibition booth demonstrations where visitors use natural body movements in front of a webcam to aim and shoot, with full Mouse & Keyboard fallback.

---

## Features

- **Webcam Body & Hand Controls (Local Browser Inference)**:
  - **Right Hand / Wrist (`Pose 16` + `Hand 0`)** steers the crosshair using mirrored right-shoulder-relative coordinates filtered through a micro-deadzone + One-Euro adaptive smoother + trigger-pull stabilization.
  - **Finger-Gun Base + Index Curl (`HandLandmarker` 21 landmarks)**: Form a finger-gun on your right hand (only thumb and index extended; middle, ring, and pinky curled) and pull/hold your index finger (`<= 132°`) to fire continuous full-auto SMG rounds.
  - **Pause Gesture (`Left Wrist 15` & `Right Wrist 16`)** raised above shoulders for ~1 second pauses gameplay.
  - Throttled CV inference (~18 FPS) decoupled from 60 FPS Three.js rendering.
- **Mouse & Keyboard Fallback**:
  - Instant fallback from Camera Setup or Calibration if no webcam is available or permission is denied.
  - Move mouse to aim, hold Left-Click or `Space` for full-auto SMG fire, `R` to reload (30-round mag), `Esc`/`P` to pause, `F3` to toggle telemetry debug overlay.
- **Data-Driven 3-Stage Campaign**:
  - **Stage 1 — FIRST CONTACT**: Eliminate 8 zombies (no time limit).
  - **Stage 2 — CITY OUTBREAK**: Eliminate 15 zombies within 90 seconds (introduces fast Runners).
  - **Stage 3 — LAST STAND**: Survive for 90 seconds against mixed waves including heavy Brutes.
- **Replaceable 3D GLB & Audio Assets**:
  - Procedural composite low-poly zombies, weapon, and abandoned city scene out of the box with zero 404 errors.
  - Drop-in GLB replacement pipeline via `public/assets/asset-manifest.json` and `GLTFLoader` + `AnimationMixer`.
  - 24 original synthesized `.ogg` audio files managed via `src/audio/AudioManifest.ts` with automatic Web Audio fallback.

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Locally

```bash
npm run dev
```

Open `http://localhost:3000` in Chrome or Edge.

### 3. Type Check & Production Build

```bash
npm run lint
npm run build
```

The production bundle is output to `dist/`.

---

## Enabling Camera Access

1. Click **Play Game** on the Main Menu.
2. When Chrome or Edge prompts for webcam access, click **Allow**.
3. Stand **1.0–2.0 meters** back so your shoulders and **right hand** are clearly visible inside the preview frame.
4. Form the **right-hand finger-gun stance** (extend only your **thumb** and **index finger**, keeping your middle, ring, and pinky fingers curled) and complete the 3-step Calibration (neutral ready stance → pull & hold right index finger like a trigger to fire an SMG burst → straighten index finger back to ready).
5. If camera permission is denied or no webcam is attached, click **Use Mouse & Keyboard Instead** to play immediately (hold left click or `Space` for full-auto SMG fire).

> **Privacy Note:** All MediaPipe pose and hand tracking runs 100% locally in the browser using `/models/pose_landmarker_lite.task`, `/models/hand_landmarker.task`, and `/wasm`. No video frames are ever uploaded to external servers.

---

## Replacing 3D Models (GLB / glTF)

The game ships with procedural composite low-poly models so it runs immediately without external files. To supply custom `.glb` models without touching combat logic:

1. Place your `.glb` files in:
   - `public/assets/zombies/basic.glb`
   - `public/assets/zombies/runner.glb`
   - `public/assets/zombies/boss.glb`
   - `public/assets/weapons/weapon.glb`
2. Enable their paths in `public/assets/asset-manifest.json`:
   ```json
   {
     "zombies": {
       "basic": "/assets/zombies/basic.glb",
       "runner": "/assets/zombies/runner.glb",
       "boss": "/assets/zombies/boss.glb"
     },
     "weapon": "/assets/weapons/weapon.glb",
     "environmentProps": null
   }
   ```
3. Ensure zombie GLB files include animation clips named `Idle`, `Walk`, `Attack`, `Hit`, and `Death` (case-insensitive; configured in `ASSET_CONFIG.expectedAnimations` inside `src/data/gameConfig.ts`).
4. If any GLB file fails to load, `AssetManager` logs a warning and falls back safely to the procedural 3D rig.

---

## Replacing Audio Files

See [`AUDIO_CUSTOMIZATION.md`](./AUDIO_CUSTOMIZATION.md) for the full manifest and instructions.

---

## Adjusting Gameplay & Pose Configuration

All tuning constants live in two central data files:

- **`src/data/gameConfig.ts`**:
  - `DEFAULT_GAME_CONFIG`: `playerMaxHealth`, `weaponDamage` (`18`), `fireRateMs` (`105`), `magazineSize` (`30`), `reloadDurationMs` (`1200`), `aimSensitivity`, `zombieAttackDistance`, `inactivityResetMs`, and per-variant zombie `health`, `speed`, `attackDamage`, `scale`.
  - `DEFAULT_POSE_CONFIG`: `triggerCurlAngleDeg` (default `132`), `triggerReleaseAngleDeg` (default `146`), `confidenceThreshold` (default `0.45`), `handConfidenceThreshold` (default `0.45`), `aimSmoothing` (default `0.72` One-Euro + deadzone stabilization), `pauseHoldMs` (default `1000`), `inferenceFps` (default `18`).
- **`src/data/stages.ts`**:
  - Add, reorder, or tune stages in the `STAGES` array (`missionType`: `'kills' | 'kills_timed' | 'survive'`, `targetKills`, `timeLimitSec`, `maxActiveZombies`, `spawnIntervalSec`, `zombieWeights`).

---

## Architecture Overview

```text
src/
├── main.ts                  # Application entry point
├── app/
│   ├── AppController.ts     # Screen transitions, inactivity reset, tab visibility, audio sync
│   ├── GameStateMachine.ts  # Screen state machine
│   └── ScreenManager.ts     # Lifecycle-safe DOM screen mounting
├── core/
│   ├── EventBus.ts          # Typed pub/sub events
│   ├── Game.ts              # 3D scene & system orchestrator
│   ├── GameLoop.ts          # THREE.Clock loop + software-WebGL pacing
│   └── GameSession.ts       # Score, health, ammo, unlock persistence
├── cv/
│   ├── CameraManager.ts     # getUserMedia & error classification
│   ├── PoseTracker.ts       # MediaPipe PoseLandmarker wrapper
│   ├── PoseController.ts    # Inference throttling, smoothing, preview rendering
│   ├── GestureRecognizer.ts # Arm-extension shot & 1s pause gesture state machine
│   ├── PoseCalibration.ts   # Posture baseline capture
│   └── LandmarkUtils.ts     # Confidence filter, mirrored offsets, 3D joint angles
├── input/
│   ├── PlayerInput.ts       # Unified input state interface
│   ├── PoseInputProvider.ts # Webcam pose provider
│   └── MouseInputProvider.ts# Mouse & keyboard fallback provider
├── three/
│   ├── Renderer.ts          # WebGLRenderer, RoomEnvironment IBL, software-GL guard
│   ├── World.ts             # Abandoned city street, vehicles, barricades, fog, lighting
│   ├── CameraRig.ts         # First-person camera, aim parallax, recoil, damage shake
│   ├── AssetManager.ts      # GLTFLoader + SkeletonUtils + AnimationMixer
│   ├── entities/            # Zombie.ts, Weapon.ts
│   └── systems/             # SpawnSystem, RaycastSystem, CombatSystem, MissionSystem, ScoreSystem, EffectsSystem
├── audio/
│   ├── AudioManager.ts      # Web Audio playback, category gains, autoplay unlock, fallback synth
│   ├── AudioConfig.ts       # LocalStorage persistence & defaults
│   └── AudioManifest.ts     # Centralized SoundId -> OGG path map
├── ui/                      # MainMenu, CameraSetup, CalibrationScreen, MissionBriefing, HUD, PauseScreen, ResultScreen, SettingsScreen, ControlsGuideModal
└── data/                    # gameConfig.ts, stages.ts
```

---

## Deploying to Static Hosting (HTTPS Required for Webcam)

Browsers require **HTTPS** (or `localhost`) for `navigator.mediaDevices.getUserMedia`.

1. Run `bun run build`.
2. Deploy the generated `dist/` directory to any HTTPS static host (Cloudflare Pages, Firebase Hosting, Netlify, Vercel, GitHub Pages, or Nginx with TLS).
3. Verify `/models/pose_landmarker_lite.task`, `/wasm/*`, and `/assets/audio/*.ogg` are served with standard MIME types (`application/wasm`, `audio/ogg`).
