export interface Waypoint2D {
  x: number;
  z: number;
}

export interface LoreDocument {
  id: string;
  code: string;
  title: string;
  stageIndex: number;
  locationLabel: string;
  body: string;
  durationSec: number;
}

export type RouteEventKind =
  | 'combat_point'
  | 'lore_inspect'
  | 'stage1_ending'
  | 'stage2_ending'
  | 'stage3_elevator';

export interface RouteStopPoint {
  id: string;
  kind: RouteEventKind;
  z: number;
  x: number;
  waveIndex?: number;
  spawnCenterZ?: number;
  loreDocIds?: string[];
  objectiveText?: string;
}

export interface StageRouteConfig {
  stageIndex: number;
  startPos: { x: number; y: number; z: number };
  endPos: { x: number; y: number; z: number };
  walkSpeed: number;
  waypoints: Waypoint2D[];
  stops: RouteStopPoint[];
}

export const LORE_DOCUMENTS: Record<string, LoreDocument> = {
  forest_01: {
    id: 'forest_01',
    code: 'LOG // ALPHA-01',
    title: 'Field Quarantine Failure',
    stageIndex: 1,
    locationLabel: 'Forest Outpost Camp',
    body: 'Subject Alpha escaped containment during night transfer. Trackers found claw gouges 14 inches deep along the village iron gate before it vanished into the fog.',
    durationSec: 4.2,
  },
  forest_02: {
    id: 'forest_02',
    code: 'LOG // ALPHA-02',
    title: 'Acoustic Mimicry & Command',
    stageIndex: 1,
    locationLabel: 'Forest Outpost Camp',
    body: 'Dr. Vance noted infected stragglers stopped attacking one another whenever Alpha vocalized. It is not just a mutant — the horde obeys it.',
    durationSec: 4.2,
  },
  forest_03: {
    id: 'forest_03',
    code: 'LOG // ALPHA-03',
    title: 'Abandoned Forest Lab Log',
    stageIndex: 1,
    locationLabel: 'Ruined Forest Laboratory',
    body: 'Bio-sedatives failed at 400% dosage. Alpha tore through reinforced glass and dragged three guards toward the deep bunker hatch below sector ridge.',
    durationSec: 4.2,
  },
  forest_04: {
    id: 'forest_04',
    code: 'LOG // ALPHA-04',
    title: 'Evacuation Override',
    stageIndex: 1,
    locationLabel: 'Ruined Forest Laboratory',
    body: 'All surface units ordered to seal Bunker Gate 02. If you are reading this, the footprints lead straight down to Sub-Level Facility.',
    durationSec: 4.2,
  },
  lab_01: {
    id: 'lab_01',
    code: 'FILE // SUB-01',
    title: 'Project Crown — Inception',
    stageIndex: 2,
    locationLabel: 'Wing B · Research Corridor',
    body: 'Subject Alpha was the first host stabilized with Crown Strain-X. Muscle density tripled within 48 hours while neural cortex remained terrifyingly intact.',
    durationSec: 4.2,
  },
  lab_02: {
    id: 'lab_02',
    code: 'FILE // SUB-02',
    title: 'Neural Pheromone Relay',
    stageIndex: 2,
    locationLabel: 'Wing B · Research Corridor',
    body: 'Blood telemetry confirmed Alpha emits sub-audible pulses that synchronize nearby infected. We did not build a cure; we forged a monarch.',
    durationSec: 4.2,
  },
  lab_03: {
    id: 'lab_03',
    code: 'FILE // SUB-03',
    title: 'Experiment Tube Breach',
    stageIndex: 2,
    locationLabel: 'Wing C · Experiment Lab',
    body: 'Tanks 01 through 08 shattered simultaneously during lockdown. Volatile carriers and Bio-Mutants flooded Specimen Storage within ninety seconds.',
    durationSec: 4.2,
  },
  lab_04: {
    id: 'lab_04',
    code: 'FILE // SUB-04',
    title: 'The Sunken Colosseum',
    stageIndex: 2,
    locationLabel: 'Wing D · Specimen Storage',
    body: 'Below the freight elevator lies the old subterranean testing pit. Over a thousand infected have gathered in the tiers — waiting for Alpha.',
    durationSec: 4.2,
  },
  lab_05: {
    id: 'lab_05',
    code: 'FILE // CROWN-FINAL',
    title: 'Subject Alpha — THE KING',
    stageIndex: 2,
    locationLabel: 'Wing E · Subject Alpha Chamber',
    body: 'Alpha Chamber breached from the inside. Look through the shattered glass: The King has already descended to The Arena of the Dead.',
    durationSec: 4.8,
  },
};

/**
 * Continuous world Z coordinates across Stages 1–3:
 * - Stage 1 (Abandoned Village): z = 0 -> -90 (Iron Gate at z = -72)
 * - Stage 2 (Cursed Forest): z = -90 -> -234 (Bunker Gate at z = -224)
 * - Stage 3 (Underground Facility): z = -234 -> -386 (Elevator at z = -382)
 * - Stage 4 (The Arena of the Dead): Dedicated circular amphitheater centered at (0, 0, -22), player starts at z = 5
 */
export const STAGE_ROUTES: StageRouteConfig[] = [
  {
    stageIndex: 0,
    startPos: { x: 0, y: 1.68, z: 0 },
    endPos: { x: 0, y: 1.68, z: -90 },
    walkSpeed: 4.9,
    waypoints: [
      { x: 0, z: 0 },
      { x: -0.6, z: -10 },
      { x: 0, z: -18 },
      { x: 0.9, z: -32 },
      { x: -0.4, z: -48 },
      { x: 0, z: -64 },
      { x: 0, z: -76 },
      { x: 0, z: -90 },
    ],
    stops: [
      {
        id: 's1_cp1',
        kind: 'combat_point',
        x: 0,
        z: -18,
        waveIndex: 0,
        spawnCenterZ: -44,
        objectiveText: 'Hold Village Entrance',
      },
      {
        id: 's1_cp2',
        kind: 'combat_point',
        x: -0.4,
        z: -48,
        waveIndex: 1,
        spawnCenterZ: -71,
        objectiveText: 'Clear Evacuated Square',
      },
      {
        id: 's1_ending',
        kind: 'stage1_ending',
        x: 0,
        z: -62,
        objectiveText: 'FOLLOW THE CREATURE',
      },
    ],
  },
  {
    stageIndex: 1,
    startPos: { x: 0, y: 1.68, z: -90 },
    endPos: { x: 0, y: 1.68, z: -236 },
    walkSpeed: 5.1,
    waypoints: [
      { x: 0, z: -90 },
      { x: -1.1, z: -106 },
      { x: -0.4, z: -116 },
      { x: 0, z: -124 },
      { x: 1.3, z: -142 },
      { x: -0.8, z: -158 },
      { x: 0, z: -168 },
      { x: 0.9, z: -184 },
      { x: 0, z: -198 },
      { x: 0, z: -214 },
      { x: 0, z: -226 },
      { x: 0, z: -236 },
    ],
    stops: [
      {
        id: 's2_lore1',
        kind: 'lore_inspect',
        x: -0.4,
        z: -116,
        loreDocIds: ['forest_01', 'forest_02'],
        objectiveText: 'Inspect Forest Outpost Notes',
      },
      {
        id: 's2_cp1',
        kind: 'combat_point',
        x: 0,
        z: -124,
        waveIndex: 0,
        spawnCenterZ: -150,
        objectiveText: 'Survive Misty Trail Ambush',
      },
      {
        id: 's2_lore2',
        kind: 'lore_inspect',
        x: -0.8,
        z: -158,
        loreDocIds: ['forest_03', 'forest_04'],
        objectiveText: 'Inspect Abandoned Forest Lab',
      },
      {
        id: 's2_cp2',
        kind: 'combat_point',
        x: 0,
        z: -168,
        waveIndex: 1,
        spawnCenterZ: -194,
        objectiveText: 'Defend Forest Lab Perimeter',
      },
      {
        id: 's2_cp3',
        kind: 'combat_point',
        x: 0,
        z: -198,
        waveIndex: 2,
        spawnCenterZ: -221,
        objectiveText: 'Clear Bunker Approach',
      },
      {
        id: 's2_ending',
        kind: 'stage2_ending',
        x: 0,
        z: -210,
        objectiveText: 'ENTER UNDERGROUND BUNKER',
      },
    ],
  },
  {
    stageIndex: 2,
    startPos: { x: 0, y: 1.68, z: -236 },
    endPos: { x: 0, y: 1.68, z: -384 },
    walkSpeed: 4.8,
    waypoints: [
      { x: 0, z: -236 },
      { x: 0, z: -252 },
      { x: 0, z: -266 },
      { x: 0, z: -274 },
      { x: 0, z: -294 },
      { x: 0, z: -306 },
      { x: 0, z: -326 },
      { x: 0, z: -340 },
      { x: 0, z: -362 },
      { x: 0, z: -374 },
      { x: 0, z: -376.2 },
    ],
    stops: [
      {
        id: 's3_lore1',
        kind: 'lore_inspect',
        x: 0,
        z: -264,
        loreDocIds: ['lab_01', 'lab_02'],
        objectiveText: 'Wing B · Research Telemetry',
      },
      {
        id: 's3_cp1',
        kind: 'combat_point',
        x: 0,
        z: -274,
        waveIndex: 0,
        spawnCenterZ: -299,
        objectiveText: 'Clear Wing B Corridor',
      },
      {
        id: 's3_lore2',
        kind: 'lore_inspect',
        x: 0,
        z: -298,
        loreDocIds: ['lab_03'],
        objectiveText: 'Wing C · Experiment Lab',
      },
      {
        id: 's3_cp2',
        kind: 'combat_point',
        x: 0,
        z: -306,
        waveIndex: 1,
        spawnCenterZ: -331,
        objectiveText: 'Contain Specimen Breach',
      },
      {
        id: 's3_lore3',
        kind: 'lore_inspect',
        x: 0,
        z: -332,
        loreDocIds: ['lab_04'],
        objectiveText: 'Wing D · Specimen Storage',
      },
      {
        id: 's3_cp3',
        kind: 'combat_point',
        x: 0,
        z: -340,
        waveIndex: 2,
        spawnCenterZ: -365,
        objectiveText: 'Clear Storage Sector',
      },
      {
        id: 's3_lore4',
        kind: 'lore_inspect',
        x: 0,
        z: -362,
        loreDocIds: ['lab_05'],
        objectiveText: 'Wing E · Subject Alpha Chamber',
      },
      {
        id: 's3_elevator',
        kind: 'stage3_elevator',
        x: 0,
        z: -376.2,
        objectiveText: 'Board Industrial Elevator',
      },
    ],
  },
  {
    stageIndex: 3,
    startPos: { x: 0, y: 1.68, z: 4.5 },
    endPos: { x: 0, y: 1.68, z: -43 },
    walkSpeed: 4.2,
    waypoints: [
      { x: 0, z: 4.5 },
      { x: 0, z: -2.0 },
    ],
    stops: [
      {
        id: 's4_cp1',
        kind: 'combat_point',
        x: 0,
        z: -2.0,
        waveIndex: 0,
        spawnCenterZ: -28,
        objectiveText: 'Defeat The King (Subject Alpha)',
      },
    ],
  },
];

export function getStageRoute(stageIndex: number): StageRouteConfig {
  return STAGE_ROUTES[Math.max(0, Math.min(stageIndex, STAGE_ROUTES.length - 1))];
}
