import type * as THREE from 'three';
import type { EventBus } from '../../core/EventBus';
import type { StageConfig } from '../../data/stages';
import type { ZombieVariant } from '../../data/zombies';
import type { AssetManager } from '../AssetManager';
import { Zombie } from '../entities/Zombie';
import type { WorldSpawnPoint } from '../World';

export class SpawnSystem {
  private spawnTimer = 0;
  private lastSpawnIndex = -1;
  private currentWaveIndex = 0;
  private currentWaveQueue: ZombieVariant[] = [];
  private wavesFinished = false;
  private stageTotalEnemies = 0;
  private stopGatedMode = false;
  private currentStopSpawnPoints: WorldSpawnPoint[] | null = null;

  public startStage(stage: StageConfig, events: EventBus, stopGated = false): void {
    this.currentWaveIndex = 0;
    this.lastSpawnIndex = -1;
    this.wavesFinished = false;
    this.stopGatedMode = stopGated;
    this.currentStopSpawnPoints = null;
    this.stageTotalEnemies = 0;

    for (const w of stage.waves) {
      for (const count of Object.values(w.counts)) {
        this.stageTotalEnemies += count ?? 0;
      }
    }

    if (stopGated) {
      // Wait for AutoMovementController to arrive at first combat stop
      this.currentWaveQueue = [];
    } else {
      this.loadWave(0, stage, events);
    }
  }

  /**
   * Starts a specific Combat Point wave along the continuous Stage 1–4 route,
   * spawning enemies smoothly ahead of the player at `spawnCenterZ`.
   */
  public startStopWave(
    stage: StageConfig,
    waveIndex: number,
    spawnCenterZ: number,
    events: EventBus
  ): void {
    this.stopGatedMode = true;
    this.wavesFinished = false;
    this.currentStopSpawnPoints = [
      { x: -7.5, z: spawnCenterZ + 2 },
      { x: -3.2, z: spawnCenterZ - 2 },
      { x: 0, z: spawnCenterZ - 4 },
      { x: 3.4, z: spawnCenterZ - 2 },
      { x: 7.5, z: spawnCenterZ + 2 },
    ];
    this.loadWave(waveIndex, stage, events);
  }

  public isCurrentStopCleared(aliveCount: number): boolean {
    return this.currentWaveQueue.length === 0 && aliveCount === 0;
  }

  private loadWave(index: number, stage: StageConfig, events: EventBus): void {
    const wave = stage.waves[index];
    if (!wave) {
      this.wavesFinished = true;
      this.currentWaveQueue = [];
      return;
    }

    this.currentWaveIndex = index;
    const queue: ZombieVariant[] = [];
    let hasBoss = false;

    for (const [variant, count] of Object.entries(wave.counts) as Array<[ZombieVariant, number]>) {
      for (let i = 0; i < (count ?? 0); i++) {
        if (variant === 'boss') {
          hasBoss = true;
        } else {
          queue.push(variant);
        }
      }
    }

    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = queue[i];
      queue[i] = queue[j];
      queue[j] = tmp;
    }

    if (hasBoss) {
      queue.unshift('boss');
    }

    this.currentWaveQueue = queue;
    this.spawnTimer = 0.45;

    events.emit('wave:started', {
      waveIndex: index + 1,
      totalWaves: stage.waves.length,
      waveName: wave.name,
    });
  }

  public getWaveInfo(stage: StageConfig): {
    waveIndex: number;
    totalWaves: number;
    waveName: string;
    remainingInQueue: number;
    totalStageEnemies: number;
  } {
    const wave = stage.waves[this.currentWaveIndex];
    let futureCount = this.currentWaveQueue.length;
    for (let i = this.currentWaveIndex + 1; i < stage.waves.length; i++) {
      for (const c of Object.values(stage.waves[i].counts)) {
        futureCount += c ?? 0;
      }
    }

    return {
      waveIndex: Math.min(this.currentWaveIndex + 1, stage.waves.length),
      totalWaves: stage.waves.length,
      waveName: wave?.name ?? stage.name,
      remainingInQueue: futureCount,
      totalStageEnemies: this.stageTotalEnemies,
    };
  }

  public allWavesCleared(): boolean {
    return this.wavesFinished && this.currentWaveQueue.length === 0;
  }

  private pickSpawnPoint(points: WorldSpawnPoint[], isBoss = false): WorldSpawnPoint {
    if (isBoss) {
      return { x: 0, z: -27 };
    }
    const pool = this.currentStopSpawnPoints ?? points;
    if (pool.length === 1) return pool[0];
    let idx = Math.floor(Math.random() * pool.length);
    if (idx === this.lastSpawnIndex) {
      idx = (idx + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
    }
    this.lastSpawnIndex = idx;
    const base = pool[idx];
    return {
      x: base.x + (Math.random() - 0.5) * 1.8,
      z: base.z + (Math.random() - 0.5) * 1.8,
    };
  }

  public spawnArenaBoss(
    stage: StageConfig,
    activeZombies: Zombie[],
    scene: THREE.Scene,
    assetManager: AssetManager
  ): Zombie {
    const existing = activeZombies.find((z) => z.variant === 'boss');
    if (existing) return existing;
    this.currentWaveQueue = [];
    this.wavesFinished = true;
    const boss = new Zombie(
      'boss',
      0,
      -27,
      stage.speedMultiplier,
      stage.healthMultiplier,
      assetManager
    );
    scene.add(boss.root);
    activeZombies.push(boss);
    return boss;
  }

  public spawnArenaHordeDescend(
    count: number,
    stage: StageConfig,
    activeZombies: Zombie[],
    scene: THREE.Scene,
    assetManager: AssetManager
  ): void {
    const variants: ZombieVariant[] = ['basic', 'runner', 'crawler'];
    for (let i = 0; i < count; i++) {
      const ang = (i / Math.max(1, count)) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const r = 14.5 + Math.random() * 2.5;
      const sx = Math.cos(ang) * r;
      const sz = -22 + Math.sin(ang) * r;
      const variant = variants[i % variants.length];
      const z = new Zombie(
        variant,
        sx,
        sz,
        stage.speedMultiplier,
        stage.healthMultiplier * 0.85,
        assetManager
      );
      scene.add(z.root);
      activeZombies.push(z);
    }
  }

  public spawnEscorts(
    count: number,
    variant: ZombieVariant,
    stage: StageConfig,
    activeZombies: Zombie[],
    spawnPoints: WorldSpawnPoint[],
    scene: THREE.Scene,
    assetManager: AssetManager
  ): void {
    for (let i = 0; i < count; i++) {
      const pos = this.pickSpawnPoint(spawnPoints, false);
      const zombie = new Zombie(
        variant,
        pos.x,
        pos.z,
        stage.speedMultiplier,
        stage.healthMultiplier,
        assetManager
      );
      scene.add(zombie.root);
      activeZombies.push(zombie);
    }
  }

  public update(
    dtSec: number,
    stage: StageConfig,
    activeZombies: Zombie[],
    spawnPoints: WorldSpawnPoint[],
    scene: THREE.Scene,
    assetManager: AssetManager,
    events: EventBus,
    onSpawned?: (zombie: Zombie) => void
  ): void {
    if (this.wavesFinished) return;

    const aliveCount = activeZombies.filter((z) => z.state !== 'dead').length;
    const wave = stage.waves[this.currentWaveIndex];
    if (!wave) {
      this.wavesFinished = true;
      return;
    }

    if (this.currentWaveQueue.length === 0) {
      if (this.stopGatedMode) {
        if (aliveCount === 0 && this.currentWaveIndex + 1 >= stage.waves.length) {
          this.wavesFinished = true;
        }
        return;
      }
      if (aliveCount === 0) {
        if (this.currentWaveIndex + 1 < stage.waves.length) {
          this.loadWave(this.currentWaveIndex + 1, stage, events);
        } else {
          this.wavesFinished = true;
        }
      }
      return;
    }

    if (aliveCount >= wave.maxActive) return;

    this.spawnTimer -= dtSec;
    if (this.spawnTimer > 0) return;

    this.spawnTimer = wave.spawnIntervalSec;
    const nextVariant = this.currentWaveQueue.shift()!;
    const pos = this.pickSpawnPoint(spawnPoints, nextVariant === 'boss');

    const zombie = new Zombie(
      nextVariant,
      pos.x,
      pos.z,
      stage.speedMultiplier,
      stage.healthMultiplier,
      assetManager
    );
    scene.add(zombie.root);
    activeZombies.push(zombie);
    onSpawned?.(zombie);
  }
}
