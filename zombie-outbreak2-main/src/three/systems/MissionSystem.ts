import type { GameSession } from '../../core/GameSession';
import type { StageConfig } from '../../data/stages';
import type { SpawnSystem } from './SpawnSystem';

export type MissionCheckOutcome =
  | { status: 'ongoing' }
  | { status: 'completed'; reason: string }
  | { status: 'failed'; reason: string };

export class MissionSystem {
  public update(
    dtSec: number,
    session: GameSession,
    stage: StageConfig,
    spawnSystem: SpawnSystem,
    aliveZombies: number,
    bossPendingResurrection = false
  ): MissionCheckOutcome {
    session.elapsedSec += dtSec;

    if (session.health <= 0) {
      return {
        status: 'failed',
        reason: 'Overrun by the infected.',
      };
    }

    if (session.remainingTimeSec !== null) {
      session.remainingTimeSec = Math.max(0, session.remainingTimeSec - dtSec);
      if (session.remainingTimeSec <= 0) {
        return {
          status: 'failed',
          reason: `Containment timer expired in ${stage.name}.`,
        };
      }
    }

    if (spawnSystem.allWavesCleared() && aliveZombies === 0 && !bossPendingResurrection) {
      if (stage.hasBoss) {
        return {
          status: 'completed',
          reason: 'Subject-09 Apex Nightmare eradicated. Outbreak neutralized!',
        };
      }
      return {
        status: 'completed',
        reason: `Cleared all ${stage.waves.length} waves in ${stage.name}.`,
      };
    }

    return { status: 'ongoing' };
  }
}
