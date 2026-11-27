import type { ZombieVariant } from './zombies';

export type StageEnvironmentId = 'urban' | 'industrial' | 'research' | 'boss_arena';

export interface WaveDefinition {
  name: string;
  maxActive: number;
  spawnIntervalSec: number;
  counts: Partial<Record<ZombieVariant, number>>;
}

export interface StageConfig {
  id: number;
  name: string;
  titleCard: string;
  subtitle: string;
  description: string;
  objectiveLabel: string;
  environment: StageEnvironmentId;
  hasBoss: boolean;
  timeLimitSec: number | null;
  speedMultiplier: number;
  healthMultiplier: number;
  waves: WaveDefinition[];
  carryStateFromPrevious: {
    preserveHealth: boolean;
    minHealthRestore: number;
    preserveAmmo: boolean;
    bonusGrenadesOnStageStart: number;
  };
  transitionWalkHint: string;
}

export const STAGES: StageConfig[] = [
  {
    id: 1,
    name: 'ABANDONED VILLAGE',
    titleCard: 'STAGE 1 — ABANDONED VILLAGE',
    subtitle: 'Evacuated Outskirts · Quarantine Zone',
    description:
      'An eerie evacuated village choked with abandoned luggage, open vehicles, and dried blood trails. Hold each street checkpoint, then follow the Creature beyond the iron gate.',
    objectiveLabel: 'Clear Village Checkpoints',
    environment: 'urban',
    hasBoss: false,
    timeLimitSec: null,
    speedMultiplier: 0.94,
    healthMultiplier: 1.0,
    waves: [
      {
        name: 'Checkpoint 1 · Village Entrance',
        maxActive: 3,
        spawnIntervalSec: 2.0,
        counts: { basic: 5 },
      },
      {
        name: 'Checkpoint 2 · Evacuated Square',
        maxActive: 4,
        spawnIntervalSec: 1.7,
        counts: { basic: 4, runner: 2, crawler: 2 },
      },
    ],
    carryStateFromPrevious: {
      preserveHealth: false,
      minHealthRestore: 100,
      preserveAmmo: false,
      bonusGrenadesOnStageStart: 0,
    },
    transitionWalkHint: 'Follow the Creature through the iron gate...',
  },
  {
    id: 2,
    name: 'CURSED FOREST',
    titleCard: 'STAGE 2 — CURSED FOREST',
    subtitle: 'Misty Woods & Abandoned Field Lab',
    description:
      'Dead twisted trees, swaying corpses, and an abandoned forest laboratory mark the trail of Subject Alpha. Inspect recovered logs and survive the forest ambush.',
    objectiveLabel: 'Follow the Tracks & Inspect Lab',
    environment: 'industrial',
    hasBoss: false,
    timeLimitSec: null,
    speedMultiplier: 1.1,
    healthMultiplier: 1.06,
    waves: [
      {
        name: 'Checkpoint 1 · Foggy Trail',
        maxActive: 4,
        spawnIntervalSec: 1.6,
        counts: { basic: 3, runner: 3, crawler: 2 },
      },
      {
        name: 'Checkpoint 2 · Forest Lab Perimeter',
        maxActive: 5,
        spawnIntervalSec: 1.45,
        counts: { basic: 2, runner: 2, crawler: 2, mutated: 2 },
      },
      {
        name: 'Checkpoint 3 · Bunker Approach',
        maxActive: 5,
        spawnIntervalSec: 1.35,
        counts: { runner: 3, crawler: 3, armored: 2, mutated: 1 },
      },
    ],
    carryStateFromPrevious: {
      preserveHealth: true,
      minHealthRestore: 75,
      preserveAmmo: true,
      bonusGrenadesOnStageStart: 1,
    },
    transitionWalkHint: 'Descending into the Underground Bunker...',
  },
  {
    id: 3,
    name: 'UNDERGROUND FACILITY',
    titleCard: 'STAGE 3 — UNDERGROUND FACILITY',
    subtitle: 'Sub-Level Bio-Research & Alpha Chamber',
    description:
      'Traverse the Security Entrance, Experiment Labs, Specimen Storage, and Subject Alpha Chamber. Uncover the origin of The King before descending the industrial elevator.',
    objectiveLabel: 'Reach Subject Alpha Chamber',
    environment: 'research',
    hasBoss: false,
    timeLimitSec: null,
    speedMultiplier: 1.18,
    healthMultiplier: 1.12,
    waves: [
      {
        name: 'Wing B · Research Corridor',
        maxActive: 5,
        spawnIntervalSec: 1.5,
        counts: { armored: 2, mutated: 3, crawler: 2 },
      },
      {
        name: 'Wing C · Experiment Lab',
        maxActive: 5,
        spawnIntervalSec: 1.38,
        counts: { armored: 2, mutated: 3, exploder: 2 },
      },
      {
        name: 'Wing D · Specimen Storage',
        maxActive: 6,
        spawnIntervalSec: 1.3,
        counts: { runner: 2, crawler: 3, mutated: 3, exploder: 2 },
      },
    ],
    carryStateFromPrevious: {
      preserveHealth: true,
      minHealthRestore: 80,
      preserveAmmo: true,
      bonusGrenadesOnStageStart: 2,
    },
    transitionWalkHint: 'Riding the industrial elevator to the Arena...',
  },
  {
    id: 4,
    name: 'THE ARENA OF THE DEAD',
    titleCard: 'STAGE 4 — THE ARENA OF THE DEAD',
    subtitle: 'Subterranean Colosseum · The King’s Territory',
    description:
      'Surrounded by a screaming horde of infected spectators, Subject Alpha — The King — rules this sunken colosseum. Survive both phases of The King and walk out through the exit gate.',
    objectiveLabel: 'Defeat The King (Subject Alpha)',
    environment: 'boss_arena',
    hasBoss: true,
    timeLimitSec: null,
    speedMultiplier: 1.2,
    healthMultiplier: 1.15,
    waves: [
      {
        name: 'The King’s Throne',
        maxActive: 6,
        spawnIntervalSec: 2.5,
        counts: { boss: 1 },
      },
    ],
    carryStateFromPrevious: {
      preserveHealth: true,
      minHealthRestore: 90,
      preserveAmmo: true,
      bonusGrenadesOnStageStart: 2,
    },
    transitionWalkHint: 'Entering The Arena of the Dead...',
  },
];

export function getStageByIndex(index: number): StageConfig {
  return STAGES[Math.max(0, Math.min(index, STAGES.length - 1))];
}
