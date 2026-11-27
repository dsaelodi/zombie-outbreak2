import type { WeaponId } from '../data/weapons';

export type GameScreenId =
  | 'main_menu'
  | 'camera_setup'
  | 'calibration'
  | 'briefing'
  | 'playing'
  | 'paused'
  | 'result';

export type ShowcaseState =
  | 'HOME_IDLE'
  | 'SHOWCASE_INTRO'
  | 'SHOWCASE_GAMEPLAY'
  | 'SHOWCASE_AFTERMATH'
  | 'SHOWCASE_TO_DARK'
  | 'RETURN_TO_HOME';

export type CameraStateId =
  | 'NORMAL_FPS'
  | 'ELEVATOR_ENTRY'
  | 'ELEVATOR_DESCENT'
  | 'ELEVATOR_REVEAL'
  | 'BOSS_APPROACH'
  | 'BOSS_JUMP_CINEMATIC'
  | 'BOSS_CHASE_CAMERA'
  | 'BOSS_COMBAT_FPS'
  | 'ARENA_EXIT'
  | 'OUTRO_CINEMATIC'
  | 'FINAL_END_CARD';

export type ElevatorSequenceEvent =
  | 'PLAYER_APPROACHING'
  | 'PLAYER_ENTERING'
  | 'PLAYER_POSITIONED'
  | 'KING_APPROACHING'
  | 'KING_ENTERING'
  | 'KING_POSITIONED'
  | 'ELEVATOR_CLOSING'
  | 'ELEVATOR_DESCENDING'
  | 'ELEVATOR_STOPPING'
  | 'ELEVATOR_ARRIVING'
  | 'ELEVATOR_OPENING'
  | 'SCENE_REVEAL';

export type BossChaseState =
  | 'IDLE'
  | 'PHASE_2_APPROACH'
  | 'PHASE_2_INTIMIDATION'
  | 'PHASE_2_JUMP_PREPARATION'
  | 'PHASE_2_FIRST_JUMP'
  | 'PHASE_2_LANDING'
  | 'CHASE_START'
  | 'CHASE_ACTIVE'
  | 'CHASE_COMPLETION'
  | 'RETURN_TO_COMBAT'
  | 'PHASE_2_COMBAT_ACTIVE';

export interface GameEvents {
  'screen:changed': { screen: GameScreenId };
  'camera:state_changed': { state: CameraStateId };
  'showcase:state_changed': { state: ShowcaseState; mode?: 'combat' | 'boss_phase2' };
  'showcase:fade': { curtainAlpha: number; titleOpacity: number; menuOpacity: number };
  'chase:state_changed': {
    active: boolean;
    phase: 'none' | 'pursuit' | 'vulnerability';
    state?: BossChaseState;
    label: string;
  };
  'chase:completed': {
    finalPosition: { x: number; y: number; z: number };
    bossRemainingHealth: number;
  };
  'chase:beat_changed': {
    beat: number;
    totalBeats: number;
    name: string;
    cameraMode: 'BOSS_CHASE_CAMERA' | 'BOSS_COMBAT_FPS';
    bossVisible: boolean;
  };
  'boss:approach_state': {
    phase: 'approach' | 'confrontation' | 'jump_prep' | 'first_jump' | 'landed' | 'done';
    label: string;
  };
  'shot:fired': { weaponId: WeaponId; x: number; y: number; ammoRemaining: number };
  'shot:empty': { weaponId: WeaponId };
  'weapon:switched': { weaponId: WeaponId };
  'weapon:reload_start': { weaponId: WeaponId };
  'weapon:reload_complete': { weaponId: WeaponId; ammo: number };
  'wheel:toggled': { open: boolean };
  'grenade:thrown': { remaining: number };
  'grenade:exploded': { x: number; y: number; z: number; kills: number };
  'zombie:hit': {
    zombieId: string;
    damage: number;
    remainingHp: number;
    headshot: boolean;
    zone?: 'head' | 'body' | 'arm' | 'leg';
    effectiveness: 'weak' | 'normal' | 'resisted';
    clampedByFireRule: boolean;
  };
  'zombie:killed': { zombieId: string; variant: string; scoreAwarded: number };
  'boss:phase_changed': { phase: 1 | 2; shielded: boolean; label?: string; transitionStarted?: boolean };
  'boss:phase_transition': { fromPhase: 1; toPhase: 2; label: string; transitioning: boolean };
  'boss:resurrection_start': Record<string, never>;
  'boss:phase2_reveal': { bossName: string };
  'boss:final_death': { bossName: string };
  'boss:state_changed': { state: string };
  'boss:telegraph': { attackName: string };
  'boss:intro_start': { bossName: string };
  'boss:intro_frame': { title: string; subtitle: string; canSkip: boolean; fadeAlpha: number };
  'boss:intro_end': Record<string, never>;
  'boss:cinematic_start': { bossName: string; isResurrection?: boolean; eyebrow?: string };
  'boss:cinematic_frame': {
    shotLabel: string;
    subtitle?: string;
    eyebrow?: string;
    canSkip: boolean;
    fadeAlpha: number;
    revealTitle?: string;
    revealSubtitle?: string;
  };
  'boss:cinematic_end': Record<string, never>;
  'story:cinematic_start': {
    kind: 'opening' | 'stage_intro';
    stageNumber?: number;
    title: string;
    subtitle: string;
    description?: string;
    objective?: string;
  };
  'story:cinematic_frame': {
    eyebrow: string;
    title: string;
    subtitleText: string;
    description?: string;
    objective?: string;
    showStageCard: boolean;
    canSkip: boolean;
    fadeAlpha: number;
  };
  'story:cinematic_end': { kind: 'opening' | 'stage_intro' };
  'lore:opened': { code: string; title: string; locationLabel: string; body: string; index: number; total: number };
  'lore:closed': Record<string, never>;
  'stage:exit_gate_state': { state: 'approaching' | 'unlocking' | 'opening' | 'passing'; progress: number };
  'story:banner': { label: string; sublabel?: string; tone?: 'warning' | 'objective' | 'danger' | 'ending'; durationSec?: number };
  'elevator:state': { active: boolean; progress: number; depthMeters: number; canSkip: boolean; phaseLabel?: string };
  'elevator:sequence_event': { event: ElevatorSequenceEvent; detail?: string };
  'campaign:ending_overlay': { visible: boolean; title: string; subtitle: string; fadeAlpha: number };
  'outro:shot_changed': {
    active: boolean;
    shot: number;
    totalShots: number;
    eyebrow: string;
    title: string;
    subtitle: string;
    showEndCard: boolean;
    fadeAlpha: number;
  };
  'outro:restart_campaign': Record<string, never>;
  'outro:return_home': Record<string, never>;
  'wave:started': { waveIndex: number; totalWaves: number; waveName: string };
  'stage:transition_start': { nextStageIndex: number; titleCard: string; subtitle: string };
  'stage:transition_end': { stageIndex: number };
  'player:damaged': { amount: number; health: number; maxHealth: number };
  'mission:updated': {
    kills: number;
    targetKills: number;
    remainingTimeSec: number | null;
    score: number;
    health: number;
    maxHealth: number;
    activeWeapon: WeaponId;
    ammo: number;
    magazineSize: number;
    isReloading: boolean;
    grenadeCount: number;
    grenadeMax: number;
    grenadeCooldownSec: number;
    waveIndex: number;
    totalWaves: number;
    waveName: string;
    remainingEnemies: number;
    objectiveBanner?: string;
    bossActive: boolean;
    bossName: string;
    bossHealth: number;
    bossMaxHealth: number;
    bossPhase: 1 | 2;
    bossSuperPhase: 1 | 2;
    bossShielded: boolean;
  };
  'mission:completed': { stageIndex: number; campaignVictory: boolean };
  'mission:failed': { stageIndex: number; reason: string };
  'pose:pause_gesture': Record<string, never>;
  'settings:updated': Record<string, never>;
}

type Listener<T> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<keyof GameEvents, Set<Listener<never>>>();

  public on<K extends keyof GameEvents>(event: K, fn: Listener<GameEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => {
      set?.delete(fn as Listener<never>);
    };
  }

  public emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      (fn as Listener<GameEvents[K]>)(payload);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
