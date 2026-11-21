import type { GameSession } from '../../core/GameSession';
import { DEFAULT_GAME_CONFIG } from '../../data/gameConfig';
import { ZOMBIE_STATS, type ZombieVariant } from '../../data/zombies';

export class ScoreSystem {
  public awardHit(session: GameSession, headshot: boolean): number {
    const pts = headshot
      ? Math.round(DEFAULT_GAME_CONFIG.scorePerHit * 1.5)
      : DEFAULT_GAME_CONFIG.scorePerHit;
    session.score += pts;
    return pts;
  }

  public awardKill(
    session: GameSession,
    variant: ZombieVariant,
    headshot: boolean
  ): number {
    const base = DEFAULT_GAME_CONFIG.scorePerKill;
    const bonus = ZOMBIE_STATS[variant]?.scoreBonus ?? 0;
    const hsBonus = headshot ? 50 : 0;
    const total = base + bonus + hsBonus;
    session.score += total;
    session.kills += 1;
    return total;
  }
}
