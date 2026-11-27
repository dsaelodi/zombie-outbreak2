import { STORY_CINEMATIC_CONFIG } from './gameConfig';

export interface OpeningShotConfig {
  id: 'normalWorld' | 'secretExperiment' | 'firstFailure' | 'outbreakBegins' | 'worldChanging' | 'titleReveal';
  durationSec: number;
  eyebrow: string;
  title: string;
  subtitleText: string;
  showTitleCard: boolean;
}

export interface StagePreInvasionConfig {
  stageIndex: number;
  stageNumber: number;
  stageName: string;
  eyebrow: string;
  quote: string;
  objective: string;
  beforeSubtitle: string;
  afterSubtitle: string;
  durationSec: number;
  transitionPoint: number; // normalized 0..1 where world shifts from before -> abandoned/after
  cardStartPoint: number;  // normalized 0..1 where stage narrative card fades in
}

export const OPENING_STORY_SHOTS: OpeningShotConfig[] = [
  {
    id: 'normalWorld',
    durationSec: STORY_CINEMATIC_CONFIG.openingShotDurations.normalWorld,
    eyebrow: 'PROLOGUE · DAY ZERO',
    title: 'BEFORE THE SIRENS',
    subtitleText: 'The world kept moving — unaware of what waited beneath the quarantine line.',
    showTitleCard: false,
  },
  {
    id: 'secretExperiment',
    durationSec: STORY_CINEMATIC_CONFIG.openingShotDurations.secretExperiment,
    eyebrow: 'WING C · SUB-LEVEL 04',
    title: 'PROJECT ALPHA',
    subtitleText: 'Deep underground, scientists monitored a living test subject inside Bio-Containment Chamber 07.',
    showTitleCard: false,
  },
  {
    id: 'firstFailure',
    durationSec: STORY_CINEMATIC_CONFIG.openingShotDurations.firstFailure,
    eyebrow: 'CONTAINMENT ANOMALY',
    title: 'FIRST FAILURE',
    subtitleText: 'Vitals spiked beyond lethal thresholds. Reinforced glass began to fracture under impossible force.',
    showTitleCard: false,
  },
  {
    id: 'outbreakBegins',
    durationSec: STORY_CINEMATIC_CONFIG.openingShotDurations.outbreakBegins,
    eyebrow: 'BREACH PROTOCOL ALPHA',
    title: 'THE OUTBREAK BEGINS',
    subtitleText: 'Emergency alarms bathed the facility in crimson as Subject Alpha tore free from containment.',
    showTitleCard: false,
  },
  {
    id: 'worldChanging',
    durationSec: STORY_CINEMATIC_CONFIG.openingShotDurations.worldChanging,
    eyebrow: 'SECTOR EVACUATION',
    title: 'A WORLD IN COLLAPSE',
    subtitleText: 'Sirens wailed across emptied streets while something terrible led the infected deeper into the dark.',
    showTitleCard: false,
  },
  {
    id: 'titleReveal',
    durationSec: STORY_CINEMATIC_CONFIG.openingShotDurations.titleReveal,
    eyebrow: 'FOUR-STAGE SURVIVAL CAMPAIGN',
    title: 'ZOMBIE OUTBREAK',
    subtitleText: 'Enter the quarantine zone. Follow the trail. End what they created.',
    showTitleCard: true,
  },
];

export const STAGE_PRE_INVASION_INTROS: StagePreInvasionConfig[] = [
  {
    stageIndex: 0,
    stageNumber: 1,
    stageName: 'ABANDONED VILLAGE',
    eyebrow: 'STAGE 1 · BEFORE THE OUTBREAK',
    quote: '"People didn\'t just disappear... they ran from something."',
    objective: 'Investigate the village and find out what happened.',
    beforeSubtitle: 'Three weeks ago, families still walked these quiet village lanes before dusk.',
    afterSubtitle: 'Now doors hang open, luggage litters the asphalt, and the infected stalk the fog.',
    durationSec: STORY_CINEMATIC_CONFIG.stageIntroDurationSec.stage1,
    transitionPoint: 0.44,
    cardStartPoint: 0.64,
  },
  {
    stageIndex: 1,
    stageNumber: 2,
    stageName: 'CURSED FOREST',
    eyebrow: 'STAGE 2 · FIELD OBSERVATION',
    quote: '"The deeper we go... the more it feels like something is waiting."',
    objective: 'Follow the trail and reach the underground facility.',
    beforeSubtitle: 'Beyond the village gate, covert researchers operated a quiet perimeter lab in the pines.',
    afterSubtitle: 'Massive footprints crush the soil — Subject Alpha passed this way toward the bunker.',
    durationSec: STORY_CINEMATIC_CONFIG.stageIntroDurationSec.stage2,
    transitionPoint: 0.44,
    cardStartPoint: 0.64,
  },
  {
    stageIndex: 2,
    stageNumber: 3,
    stageName: 'UNDERGROUND FACILITY',
    eyebrow: 'STAGE 3 · CLASSIFIED ARCHIVES',
    quote: '"This wasn\'t an accident. They created something they couldn\'t control."',
    objective: 'Uncover the truth behind the experiment.',
    beforeSubtitle: 'Wing C hummed with clean telemetry as researchers logged every pulse behind containment glass.',
    afterSubtitle: 'Shattered tubes, bloodstained keyboards, and an industrial elevator descending into the dark.',
    durationSec: STORY_CINEMATIC_CONFIG.stageIntroDurationSec.stage3,
    transitionPoint: 0.44,
    cardStartPoint: 0.64,
  },
  {
    stageIndex: 3,
    stageNumber: 4,
    stageName: 'THE ARENA OF THE DEAD',
    eyebrow: 'STAGE 4 · SUB-LEVEL COLOSSEUM',
    quote: '"You\'ve come this far... now survive The King."',
    objective: 'Defeat The King and escape the arena.',
    beforeSubtitle: 'Engineers carved this sunken concrete pit as the final sub-level containment chamber.',
    afterSubtitle: 'Hundreds of infected spectators now roar above the blood-lit floor. The King awaits.',
    durationSec: STORY_CINEMATIC_CONFIG.stageIntroDurationSec.stage4,
    transitionPoint: 0.44,
    cardStartPoint: 0.64,
  },
];

export function getStagePreInvasionIntro(stageIndex: number): StagePreInvasionConfig {
  return STAGE_PRE_INVASION_INTROS[
    Math.max(0, Math.min(stageIndex, STAGE_PRE_INVASION_INTROS.length - 1))
  ];
}
