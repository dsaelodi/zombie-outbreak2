export type CrowdDensityLevel = 'low' | 'medium' | 'high';

export interface GameConfig {
  playerMaxHealth: number;
  autoReloadOnEmpty: boolean;
  aimSensitivity: number;
  zombieAttackDistance: number;
  zombieAttackCooldownMs: number;
  scorePerHit: number;
  scorePerKill: number;
  inactivityResetMs: number;
  weaponWheelTimeScale: number;
  fistHoldMs: number;
  fingerSelectStableMs: number;
  wheelCooldownMs: number;
  elevatorDurationSec: number;
}

export interface PoseConfig {
  triggerCurlAngleDeg: number;
  triggerReleaseAngleDeg: number;
  confidenceThreshold: number;
  handConfidenceThreshold: number;
  aimSmoothing: number;
  pauseHoldMs: number;
  inferenceFps: number;
  horizontalAimGain: number;
  verticalAimGain: number;
}

export interface AssetConfig {
  mediapipeWasmPath: string;
  poseModelPath: string;
  handModelPath: string;
  models: {
    zombies: Record<string, string>;
    weapon: string;
    environmentProps: string;
  };
  expectedAnimations: {
    idle: string;
    walk: string;
    attack: string;
    hit: string;
    death: string;
  };
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  playerMaxHealth: 100,
  autoReloadOnEmpty: true,
  aimSensitivity: 1.45,
  zombieAttackDistance: 2.55,
  zombieAttackCooldownMs: 1200,
  scorePerHit: 15,
  scorePerKill: 150,
  inactivityResetMs: 180_000,
  weaponWheelTimeScale: 0.2,
  fistHoldMs: 260,
  fingerSelectStableMs: 340,
  wheelCooldownMs: 650,
  elevatorDurationSec: 11.0,
};

export const DEFAULT_POSE_CONFIG: PoseConfig = {
  triggerCurlAngleDeg: 132,
  triggerReleaseAngleDeg: 146,
  confidenceThreshold: 0.45,
  handConfidenceThreshold: 0.45,
  aimSmoothing: 0.72,
  pauseHoldMs: 1000,
  inferenceFps: 18,
  horizontalAimGain: 2.45,
  verticalAimGain: 2.15,
};

export const ASSET_CONFIG: AssetConfig = {
  mediapipeWasmPath: '/wasm',
  poseModelPath: '/models/pose_landmarker_lite.task',
  handModelPath: '/models/hand_landmarker.task',
  models: {
    zombies: {
      basic: '/assets/zombies/basic.glb',
      runner: '/assets/zombies/runner.glb',
      armored: '/assets/zombies/armored.glb',
      mutated: '/assets/zombies/mutated.glb',
      exploder: '/assets/zombies/exploder.glb',
      boss: '/assets/zombies/boss.glb',
    },
    weapon: '/assets/weapons/weapon.glb',
    environmentProps: '/assets/environments/props.glb',
  },
  expectedAnimations: {
    idle: 'Idle',
    walk: 'Walk',
    attack: 'Attack',
    hit: 'Hit',
    death: 'Death',
  },
};

export const SHOWCASE_CONFIG = {
  initialIdleDelaySec: 8.5,
  idleIntervalSec: 20.0,
  introDurationSec: 3.4,
  gameplayDurationSec: 12.0,
  aftermathDurationSec: 3.2,
  darkFadeOutSec: 1.2,
  returnDurationSec: 1.75,
  bossIntroSec: 3.2,
  bossMutateSec: 3.8,
  bossRevealSec: 3.4,
  bossJumpSec: 2.8,
  bossLandRoarSec: 2.6,
} as const;

export const STORY_CINEMATIC_CONFIG = {
  enabled: true,
  skipDelaySec: 1.5,
  openingShotDurations: {
    normalWorld: 4.5,
    secretExperiment: 5.5,
    firstFailure: 4.2,
    outbreakBegins: 5.2,
    worldChanging: 4.5,
    titleReveal: 3.6,
  },
  stageIntroDurationSec: {
    stage1: 11.5,
    stage2: 11.5,
    stage3: 11.5,
    stage4: 11.5,
  },
  endingGateHoldSec: 0.65,
  endingGateUnlockSec: 0.95,
  endingGateOpenSec: 2.8,
} as const;

export interface UserSettings {
  aimSensitivity: number;
  aimSmoothing: number;
  triggerCurlAngleDeg: number;
  triggerReleaseAngleDeg: number;
  debugMode: boolean;
  showCameraPip: boolean;
  preferredControlMode: 'pose' | 'mouse';
  autoShowcaseEnabled: boolean;
  cameraShakeIntensity: number;
  vibrationEnabled: boolean;
  crowdDensity: CrowdDensityLevel;
}

const SETTINGS_STORAGE_KEY = 'zombie_outbreak_user_settings_v2';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  aimSensitivity: DEFAULT_GAME_CONFIG.aimSensitivity,
  aimSmoothing: DEFAULT_POSE_CONFIG.aimSmoothing,
  triggerCurlAngleDeg: DEFAULT_POSE_CONFIG.triggerCurlAngleDeg,
  triggerReleaseAngleDeg: DEFAULT_POSE_CONFIG.triggerReleaseAngleDeg,
  debugMode: false,
  showCameraPip: true,
  preferredControlMode: 'pose',
  autoShowcaseEnabled: true,
  cameraShakeIntensity: 1.0,
  vibrationEnabled: true,
  crowdDensity: 'medium',
};

export function loadUserSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_USER_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return {
      ...DEFAULT_USER_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_USER_SETTINGS };
  }
}

export function saveUserSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}
