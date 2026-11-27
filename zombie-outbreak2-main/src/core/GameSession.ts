import { DEFAULT_GAME_CONFIG } from '../data/gameConfig';
import { getStageByIndex, STAGES, type StageConfig } from '../data/stages';
import type { WeaponId } from '../data/weapons';

export interface MissionResultSummary {
  completed: boolean;
  campaignVictory: boolean;
  reason: string;
  stageId: number;
  stageName: string;
  stageIndex: number;
  hasNextStage: boolean;
  score: number;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  accuracyPercent: number;
  elapsedSec: number;
}

const PROGRESS_KEY = 'zombie_outbreak_unlocked_stage_v2';

export class GameSession {
  public stageIndex = 0;
  public unlockedStageIndex = 0;

  public health = DEFAULT_GAME_CONFIG.playerMaxHealth;
  public maxHealth = DEFAULT_GAME_CONFIG.playerMaxHealth;
  public score = 0;
  public kills = 0;
  public shotsFired = 0;
  public shotsHit = 0;

  public activeWeapon: WeaponId = 'ar';
  public waveIndex = 0;
  public totalWaves = 1;
  public waveName = '';
  public remainingEnemies = 0;

  public bossActive = false;
  public bossName = 'THE KING · SUBJECT ALPHA';
  public bossHealth = 0;
  public bossMaxHealth = 0;
  public bossPhase: 1 | 2 = 1;
  public bossSuperPhase: 1 | 2 = 1;
  public bossShielded = false;
  public currentObjectiveOverride = '';

  public elapsedSec = 0;
  public remainingTimeSec: number | null = null;
  public activeZombieCount = 0;
  public lastResult: MissionResultSummary | null = null;

  constructor() {
    this.unlockedStageIndex = this.loadUnlockedStage();
  }

  private loadUnlockedStage(): number {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return 0;
      const val = Number.parseInt(raw, 10);
      return Number.isFinite(val) ? Math.max(0, Math.min(val, STAGES.length - 1)) : 0;
    } catch {
      return 0;
    }
  }

  public saveUnlockedStage(): void {
    try {
      localStorage.setItem(PROGRESS_KEY, String(this.unlockedStageIndex));
    } catch {
      // Ignore storage errors
    }
  }

  public getCurrentStage(): StageConfig {
    return getStageByIndex(this.stageIndex);
  }

  /**
   * Resets session for a fresh stage start or preserves configured state across seamless stage transitions.
   */
  public prepareStage(stageIdx: number, carryFromPrevious = false): void {
    this.stageIndex = Math.max(0, Math.min(stageIdx, STAGES.length - 1));
    const stage = this.getCurrentStage();

    if (carryFromPrevious && stage.carryStateFromPrevious.preserveHealth) {
      this.health = Math.max(
        stage.carryStateFromPrevious.minHealthRestore,
        Math.min(this.maxHealth, this.health + 20)
      );
    } else {
      this.health = DEFAULT_GAME_CONFIG.playerMaxHealth;
      this.maxHealth = DEFAULT_GAME_CONFIG.playerMaxHealth;
      this.score = 0;
      this.kills = 0;
      this.shotsFired = 0;
      this.shotsHit = 0;
      this.activeWeapon = 'ar';
    }

    this.waveIndex = 0;
    this.totalWaves = stage.waves.length;
    this.waveName = stage.waves[0]?.name ?? stage.name;
    this.remainingEnemies = 0;

    this.bossActive = false;
    this.bossName = 'THE KING · SUBJECT ALPHA';
    this.bossHealth = 0;
    this.bossMaxHealth = 0;
    this.bossPhase = 1;
    this.bossSuperPhase = 1;
    this.bossShielded = false;
    this.currentObjectiveOverride = stage.objectiveLabel;

    this.elapsedSec = carryFromPrevious ? this.elapsedSec : 0;
    this.remainingTimeSec = stage.timeLimitSec;
    this.activeZombieCount = 0;
    this.lastResult = null;
  }

  public buildResult(completed: boolean, reason: string): MissionResultSummary {
    const stage = this.getCurrentStage();
    const accuracyPercent =
      this.shotsFired > 0 ? Math.round((this.shotsHit / this.shotsFired) * 100) : 0;

    if (completed && this.stageIndex + 1 > this.unlockedStageIndex) {
      this.unlockedStageIndex = Math.min(this.stageIndex + 1, STAGES.length - 1);
      this.saveUnlockedStage();
    }

    const campaignVictory = completed && this.stageIndex === STAGES.length - 1;

    const summary: MissionResultSummary = {
      completed,
      campaignVictory,
      reason,
      stageId: stage.id,
      stageName: stage.name,
      stageIndex: this.stageIndex,
      hasNextStage: completed && this.stageIndex + 1 < STAGES.length,
      score: this.score,
      kills: this.kills,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      accuracyPercent,
      elapsedSec: Math.round(this.elapsedSec),
    };
    this.lastResult = summary;
    return summary;
  }
}
