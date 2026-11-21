import * as THREE from 'three';
import type { CrowdDensityLevel } from '../data/gameConfig';
import type { StageEnvironmentId } from '../data/stages';
import { ArenaChunk } from './world/ArenaChunk';
import { CorridorChunks } from './world/CorridorChunks';
import {
  buildContainmentTube,
  updateContainmentTubes,
  type ContainmentTubeHandle,
} from './world/LaboratorySubjects';
import type { CrowdBehaviorState } from './world/ZombieCrowdManager';

export interface WorldSpawnPoint {
  x: number;
  z: number;
}

export class World {
  public readonly root = new THREE.Group();
  public spawnPoints: WorldSpawnPoint[] = [
    { x: -10, z: -38 },
    { x: -4, z: -42 },
    { x: 0, z: -45 },
    { x: 5, z: -41 },
    { x: 11, z: -37 },
    { x: -13, z: -29 },
    { x: 13, z: -28 },
  ];

  private currentEnv: StageEnvironmentId | null = null;
  private campaignCorridor: CorridorChunks | null = null;
  private arenaChunk: ArenaChunk | null = null;
  private currentBgColor = new THREE.Color(0x0a0d11);
  private targetBgColor = new THREE.Color(0x0a0d11);

  private pulseLights: THREE.PointLight[] = [];
  private flickerLights: Array<{ light: THREE.PointLight; baseIntensity: number; speed: number }> = [];
  private beaconMesh: THREE.Mesh | null = null;
  private flickerMats: THREE.MeshStandardMaterial[] = [];
  private atmospherePoints: THREE.Points | null = null;
  private atmosphereBaseY: Float32Array | null = null;
  private bossArenaSpot: THREE.PointLight | null = null;
  private bossArenaHemi: THREE.HemisphereLight | null = null;
  private bossPhase2Active = false;
  private containmentTubes: ContainmentTubeHandle[] = [];

  private disposableTextures: THREE.Texture[] = [];
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private disposableMaterials: THREE.Material[] = [];

  private readonly maxAniso: number;

  constructor(
    private readonly scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    private readonly isSoftwareGl: boolean
  ) {
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    scene.add(this.root);
    this.loadEnvironment('urban');
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.disposableGeometries.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.disposableMaterials.push(m);
    return m;
  }

  private trackTex<T extends THREE.Texture>(t: T): T {
    this.disposableTextures.push(t);
    return t;
  }

  private clearStage(): void {
    while (this.root.children.length > 0) {
      this.root.remove(this.root.children[0]);
    }
    if (this.campaignCorridor) {
      this.campaignCorridor.dispose();
      this.campaignCorridor = null;
    }
    if (this.arenaChunk) {
      this.arenaChunk.dispose();
      this.arenaChunk = null;
    }
    for (const g of this.disposableGeometries) g.dispose();
    for (const m of this.disposableMaterials) m.dispose();
    for (const t of this.disposableTextures) t.dispose();
    this.disposableGeometries = [];
    this.disposableMaterials = [];
    this.disposableTextures = [];
    this.pulseLights = [];
    this.flickerLights = [];
    this.flickerMats = [];
    this.beaconMesh = null;
    this.atmospherePoints = null;
    this.atmosphereBaseY = null;
    this.bossArenaSpot = null;
    this.bossArenaHemi = null;
    this.bossPhase2Active = false;
    this.containmentTubes = [];
  }

  public loadCampaignCorridor(): void {
    this.currentEnv = null;
    this.clearStage();
    this.campaignCorridor = new CorridorChunks(this.maxAniso, this.isSoftwareGl);
    this.root.add(this.campaignCorridor.root);
    this.currentBgColor.setHex(0x0a0d11);
    this.scene.background = this.currentBgColor.clone();
    this.scene.fog = new THREE.FogExp2(0x0a0d11, 0.025);
    this.spawnPoints = [
      { x: -8, z: -42 },
      { x: 0, z: -45 },
      { x: 8, z: -42 },
      { x: -10, z: -34 },
      { x: 10, z: -34 },
    ];
  }

  public loadBossArena(crowdDensity: CrowdDensityLevel = 'medium'): void {
    this.currentEnv = 'boss_arena';
    this.clearStage();
    this.arenaChunk = new ArenaChunk(this.maxAniso, crowdDensity, this.isSoftwareGl);
    this.root.add(this.arenaChunk.root);
    this.currentBgColor.setHex(0x0c0507);
    this.scene.background = this.currentBgColor.clone();
    this.scene.fog = new THREE.FogExp2(0x0c0507, 0.022);
    this.spawnPoints = [
      { x: 0, z: -34 },
      { x: -9, z: -30 },
      { x: 9, z: -30 },
      { x: -12, z: -23 },
      { x: 12, z: -23 },
    ];
  }

  public isCorridorLoaded(): boolean {
    return this.campaignCorridor !== null;
  }

  public isArenaLoaded(): boolean {
    return this.arenaChunk !== null;
  }

  public getCrowdCount(): number {
    return this.arenaChunk?.crowdManager.instanceCount ?? 0;
  }

  public setVillageGateOpen(p: number): void {
    this.campaignCorridor?.setVillageGateOpen(p);
  }

  public updateStage1Creature(visible: boolean, turnProgress: number, walkAwayProgress: number): void {
    this.campaignCorridor?.updateStage1Creature(visible, turnProgress, walkAwayProgress);
  }

  public setBunkerDoorOpen(p: number): void {
    this.campaignCorridor?.setBunkerDoorOpen(p);
  }

  public setFacilityAlarm(active: boolean): void {
    this.campaignCorridor?.setFacilityAlarm(active);
  }

  public setAlphaKingSilhouette(visible: boolean, vanishProgress: number): void {
    this.campaignCorridor?.setAlphaKingSilhouette(visible, vanishProgress);
  }

  public setKingElevatorSequence(
    visible: boolean,
    phase: 'idle' | 'approaching' | 'entering' | 'positioned' | 'closing' | 'descending' | 'gone',
    phaseP: number,
    elapsedSec = 0
  ): void {
    this.campaignCorridor?.setKingElevatorSequence(visible, phase, phaseP, elapsedSec);
  }

  public setElevatorState(opts: {
    doorOpen: number;
    descending: boolean;
    speedFactor: number;
    cageYOffset?: number;
  }): void {
    this.campaignCorridor?.setElevatorState(
      opts.doorOpen,
      opts.descending,
      opts.speedFactor,
      opts.cageYOffset ?? 0
    );
  }

  public setArenaElevatorGateOpen(p: number): void {
    this.arenaChunk?.setElevatorGateOpen(p);
  }

  public setArenaDestabilized(active: boolean): void {
    this.arenaChunk?.setDestabilized(active);
  }

  public setArenaExitGateOpen(p: number): void {
    this.arenaChunk?.setExitGateOpen(p);
  }

  public setArenaExitGateState(state: {
    lockRetract: number;
    openProgress: number;
    dustProgress?: number;
  }): void {
    this.arenaChunk?.setExitGateState(state);
  }

  public setCrowdState(
    state: CrowdBehaviorState,
    collapseProgress?: number,
    showcaseExcitement?: number
  ): void {
    this.arenaChunk?.setCrowdState(state, collapseProgress, showcaseExcitement);
  }

  public setArenaPhaseAtmosphere(phase: 1 | 2): void {
    this.arenaChunk?.setAtmospherePhase(phase);
    const bgHex = phase === 2 ? 0x150205 : 0x0c0507;
    const density = phase === 2 ? 0.026 : 0.022;
    this.scene.background = new THREE.Color(bgHex);
    this.scene.fog = new THREE.FogExp2(bgHex, density);
  }

  public setArenaOutroDawnAtmosphere(t01: number): void {
    const u = Math.max(0, Math.min(1, t01));
    this.arenaChunk?.setOutroDawnAtmosphere(u);
    const darkBg = new THREE.Color(0x0c0507);
    const dawnBg = new THREE.Color(0xb8d8f0);
    const blended = darkBg.lerp(dawnBg, u);
    this.scene.background = blended;
    const density = 0.022 + (0.0055 - 0.022) * u;
    this.scene.fog = new THREE.FogExp2(blended.getHex(), density);
  }

  public getBinusCelebrationInfo() {
    return this.arenaChunk?.binusScene.getSummary() ?? null;
  }

  public setBossPhase2Atmosphere(active: boolean): void {
    this.bossPhase2Active = active;
    if (this.arenaChunk) {
      this.setArenaPhaseAtmosphere(active ? 2 : 1);
      return;
    }
    if (this.currentEnv !== 'boss_arena') return;
    const bgHex = active ? 0x160206 : 0x0c0507;
    this.scene.background = new THREE.Color(bgHex);
    this.scene.fog = new THREE.FogExp2(bgHex, active ? 0.027 : 0.022);
    if (this.bossArenaHemi) {
      this.bossArenaHemi.color.setHex(active ? 0xb91c1c : 0x662c35);
      this.bossArenaHemi.intensity = active ? 0.78 : 0.58;
    }
    if (this.bossArenaSpot) {
      this.bossArenaSpot.color.setHex(active ? 0xff1e2d : 0xff4d4d);
      this.bossArenaSpot.intensity = active ? 34 : 24;
    }
  }

  public loadEnvironment(env: StageEnvironmentId): void {
    if (this.currentEnv === env && !this.campaignCorridor && !this.arenaChunk) return;
    this.currentEnv = env;
    this.clearStage();

    if (env === 'urban') {
      this.buildUrbanEnvironment();
    } else if (env === 'industrial') {
      this.buildIndustrialEnvironment();
    } else if (env === 'research') {
      this.buildResearchEnvironment();
    } else {
      this.buildBossArenaEnvironment();
    }
  }

  private addLighting(
    hemiSky: number,
    hemiGround: number,
    hemiInt: number,
    keyColor: number,
    keyInt: number,
    rimColor: number
  ): void {
    const hemi = new THREE.HemisphereLight(hemiSky, hemiGround, hemiInt);
    hemi.position.set(0, 30, 0);
    this.root.add(hemi);
    this.bossArenaHemi = hemi;

    const keyLight = new THREE.DirectionalLight(keyColor, keyInt);
    keyLight.position.set(-14, 24, 12);
    if (!this.isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 75;
      keyLight.shadow.camera.left = -26;
      keyLight.shadow.camera.right = 26;
      keyLight.shadow.camera.top = 26;
      keyLight.shadow.camera.bottom = -26;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    this.root.add(keyLight);

    const rimLight = new THREE.DirectionalLight(rimColor, 0.58);
    rimLight.position.set(10, 14, -36);
    this.root.add(rimLight);
  }

  private createAsphaltTexture(lineColor = 'rgba(182, 138, 42, 0.58)'): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#202326';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 6500; i++) {
      const v = 20 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgb(${v},${v + 1},${v + 2})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    ctx.fillStyle = lineColor;
    ctx.fillRect(246, 0, 6, 512);
    ctx.fillRect(260, 0, 6, 512);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 8);
    tex.anisotropy = this.maxAniso;
    return this.trackTex(tex);
  }

  private createHazardTexture(stripeHex = '#b47b24'): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#3d4145';
    ctx.fillRect(0, 0, 256, 128);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 256, 36);
    ctx.clip();
    ctx.fillStyle = stripeHex;
    ctx.fillRect(0, 0, 256, 36);
    ctx.fillStyle = '#141618';
    for (let x = -40; x < 300; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 16, 0);
      ctx.lineTo(x - 4, 36);
      ctx.lineTo(x - 20, 36);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAniso;
    return this.trackTex(tex);
  }

  private createBuildingTexture(baseColor: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 256, 512);
    const cols = 4;
    const rows = 8;
    const padX = 16;
    const padY = 18;
    const winW = (256 - padX * (cols + 1)) / cols;
    const winH = (512 - padY * (rows + 1)) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = Math.random() < 0.08 ? '#4f4632' : '#0c1014';
        ctx.fillRect(padX + c * (winW + padX), padY + r * (winH + padY), winW, winH);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAniso;
    return this.trackTex(tex);
  }

  private createTileTexture(bg: string, line: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = line;
    ctx.lineWidth = 3;
    for (let i = 0; i <= 256; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 18);
    tex.anisotropy = this.maxAniso;
    return this.trackTex(tex);
  }

  private createFloorDecalTexture(rgbPrimary: string, rgbCore: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);

    const grad = ctx.createRadialGradient(128, 128, 8, 128, 128, 92);
    grad.addColorStop(0, `rgba(${rgbCore}, 0.92)`);
    grad.addColorStop(0.55, `rgba(${rgbPrimary}, 0.68)`);
    grad.addColorStop(1, `rgba(${rgbPrimary}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 24; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 24 + Math.random() * 82;
      const r = 4 + Math.random() * 14;
      ctx.fillStyle = `rgba(${rgbPrimary}, ${0.35 + Math.random() * 0.45})`;
      ctx.beginPath();
      ctx.arc(128 + Math.cos(ang) * dist, 128 + Math.sin(ang) * dist, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return this.trackTex(tex);
  }

  private createCobwebTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 256);

    const cx = 24;
    const cy = 24;
    ctx.strokeStyle = 'rgba(218, 224, 230, 0.52)';
    ctx.lineWidth = 1.6;

    // Radial anchor threads fanning from top-left corner across the triangle
    const spokeAngles = [0.06, 0.24, 0.44, 0.68, 0.92, 1.18, 1.44];
    for (const ang of spokeAngles) {
      const len = 225;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      ctx.stroke();
    }

    // Concentric sagging silk spirals with natural torn gaps
    ctx.lineWidth = 1.15;
    const rings = [34, 62, 92, 126, 160, 194];
    for (let rIdx = 0; rIdx < rings.length; rIdx++) {
      const rad = rings[rIdx];
      for (let s = 0; s < spokeAngles.length - 1; s++) {
        if ((rIdx + s) % 5 === 3) continue; // torn gap for realism
        const a0 = spokeAngles[s];
        const a1 = spokeAngles[s + 1];
        const aMid = (a0 + a1) * 0.5;
        const p0x = cx + Math.cos(a0) * rad;
        const p0y = cy + Math.sin(a0) * rad;
        const p1x = cx + Math.cos(a1) * rad;
        const p1y = cy + Math.sin(a1) * rad;
        const sag = rad * 0.88;
        const mx = cx + Math.cos(aMid) * sag;
        const my = cy + Math.sin(aMid) * sag + 6;
        ctx.beginPath();
        ctx.moveTo(p0x, p0y);
        ctx.quadraticCurveTo(mx, my, p1x, p1y);
        ctx.stroke();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return this.trackTex(tex);
  }

  private addCobwebs(
    spots: Array<{
      x: number;
      y: number;
      z: number;
      w: number;
      h: number;
      rotY: number;
      rotX?: number;
      rotZ?: number;
    }>
  ): void {
    const tex = this.createCobwebTexture();
    const mat = this.trackMat(
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const geo = this.trackGeo(new THREE.PlaneGeometry(1, 1));
    for (const s of spots) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(s.x, s.y, s.z);
      m.scale.set(s.w, s.h, 1);
      m.rotation.set(s.rotX ?? 0, s.rotY, s.rotZ ?? 0);
      this.root.add(m);
    }
  }

  private addFloorDecals(
    spots: Array<{ x: number; z: number; size: number; rot: number }>,
    rgbPrimary = '95, 12, 12',
    rgbCore = '48, 4, 4'
  ): void {
    const tex = this.createFloorDecalTexture(rgbPrimary, rgbCore);
    const mat = this.trackMat(
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );
    const geo = this.trackGeo(new THREE.PlaneGeometry(1, 1));
    for (const s of spots) {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = s.rot;
      m.position.set(s.x, 0.018, s.z);
      m.scale.set(s.size, s.size * (0.85 + Math.random() * 0.45), 1);
      this.root.add(m);
    }
  }

  private addAtmosphereParticles(colorHex: number, count: number, minZ: number, maxZ: number): void {
    const pos = new Float32Array(count * 3);
    const baseY = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 28;
      const y = 0.25 + Math.random() * 5.2;
      pos[i * 3 + 1] = y;
      baseY[i] = y;
      pos[i * 3 + 2] = minZ + Math.random() * (maxZ - minZ);
    }
    const geo = this.trackGeo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = this.trackMat(
      new THREE.PointsMaterial({
        color: colorHex,
        size: 0.11,
        transparent: true,
        opacity: 0.44,
        depthWrite: false,
      })
    );
    const pts = new THREE.Points(geo, mat);
    this.root.add(pts);
    this.atmospherePoints = pts;
    this.atmosphereBaseY = baseY;
  }

  // ==================== STAGE 1: URBAN STREET ====================
  private buildUrbanEnvironment(): void {
    const bgHex = 0x0a0d11;
    this.scene.background = new THREE.Color(bgHex);
    this.scene.fog = new THREE.FogExp2(bgHex, 0.028);
    this.addLighting(0x52657a, 0x181310, 0.56, 0xffd2a0, 1.15, 0x45627d);

    this.spawnPoints = [
      { x: -10, z: -38 },
      { x: -4, z: -42 },
      { x: 0, z: -45 },
      { x: 5, z: -41 },
      { x: 11, z: -37 },
      { x: -12, z: -29 },
      { x: 12, z: -28 },
    ];

    const earth = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(240, 240)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0x171a18, roughness: 0.95 }))
    );
    earth.rotation.x = -Math.PI / 2;
    earth.position.set(0, -0.04, -30);
    earth.receiveShadow = true;
    this.root.add(earth);

    const road = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(18, 120)),
      this.trackMat(new THREE.MeshStandardMaterial({ map: this.createAsphaltTexture(), roughness: 0.88 }))
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -30);
    road.receiveShadow = true;
    this.root.add(road);

    const curbGeo = this.trackGeo(new THREE.BoxGeometry(7, 0.16, 120));
    const curbMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x34373a, roughness: 0.92 }));
    const lCurb = new THREE.Mesh(curbGeo, curbMat);
    lCurb.position.set(-12.5, 0.04, -30);
    const rCurb = new THREE.Mesh(curbGeo, curbMat);
    rCurb.position.set(12.5, 0.04, -30);
    this.root.add(lCurb, rCurb);

    // Blood trails & splatter decals across quarantine asphalt
    this.addFloorDecals([
      { x: -2.1, z: -8.5, size: 2.6, rot: 0.4 },
      { x: 2.8, z: -13.2, size: 3.1, rot: 1.7 },
      { x: -1.4, z: -22.5, size: 2.8, rot: -0.9 },
      { x: 4.1, z: -29.0, size: 3.4, rot: 2.3 },
    ]);

    // Buildings + overgrown dark vines
    const facadeColors = ['#2d3135', '#37302a', '#29302e', '#343436'];
    const mats = facadeColors.map((hex) =>
      this.trackMat(new THREE.MeshStandardMaterial({ map: this.createBuildingTexture(hex), roughness: 0.88 }))
    );
    const vineMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x1d2b1b, roughness: 0.94 }));
    const bSpecs = [
      { x: -19, z: -8, w: 9, h: 15, d: 12, m: 0 },
      { x: -20, z: -24, w: 11, h: 21, d: 13, m: 1 },
      { x: -19, z: -40, w: 9, h: 17, d: 14, m: 2 },
      { x: 19, z: -9, w: 9, h: 18, d: 12, m: 2 },
      { x: 20, z: -25, w: 11, h: 14, d: 13, m: 3 },
      { x: 19, z: -41, w: 10, h: 22, d: 13, m: 0 },
      { x: 0, z: -80, w: 24, h: 28, d: 12, m: 1 },
    ];
    for (const b of bSpecs) {
      const mesh = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(b.w, b.h, b.d)), mats[b.m]);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);

      if (Math.abs(b.x) < 21 && b.z > -45) {
        const vine = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.45, 7.5, 2.8)), vineMat);
        vine.position.set(b.x > 0 ? b.x - b.w * 0.5 - 0.1 : b.x + b.w * 0.5 + 0.1, 4.2, b.z);
        this.root.add(vine);
      }
    }

    // Broken & leaning streetlights along sidewalks
    const poleMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x26292e, roughness: 0.5, metalness: 0.72 }));
    const lampMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0xffc875, emissive: 0xff9d3b, emissiveIntensity: 1.5 }));
    this.flickerMats.push(lampMat);
    const poleGeo = this.trackGeo(new THREE.CylinderGeometry(0.11, 0.15, 5.8, 7));
    for (const lp of [
      { x: -9.8, z: -11, tilt: 0.08, dir: 1 },
      { x: 9.8, z: -18, tilt: -0.14, dir: -1 },
      { x: -9.8, z: -30, tilt: 0.04, dir: 1 },
    ]) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(poleGeo, poleMat);
      post.position.y = 2.9;
      const arm = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.7, 0.12, 0.12)), poleMat);
      arm.position.set(lp.dir * 0.85, 5.7, 0);
      const bulb = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.38, 0.14, 0.25)), lampMat);
      bulb.position.set(lp.dir * 1.55, 5.6, 0);
      g.add(post, arm, bulb);
      g.position.set(lp.x, 0, lp.z);
      g.rotation.z = lp.tilt;
      this.root.add(g);
    }

    // Storefront awnings, bus stop shelter, traffic signal, shopping cart & overhead cables
    const awningMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.82 }));
    const signAccentMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 }));
    for (const sf of [
      { x: -13.9, z: -8, len: 6.2 },
      { x: 13.9, z: -25, len: 6.8 },
    ]) {
      const awning = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.8, 0.22, sf.len)), awningMat);
      awning.position.set(sf.x, 3.3, sf.z);
      awning.rotation.z = sf.x < 0 ? -0.25 : 0.25;
      const shopSign = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.24, 0.85, 3.8)), signAccentMat);
      shopSign.position.set(sf.x + (sf.x < 0 ? 0.55 : -0.55), 4.2, sf.z);
      this.root.add(awning, shopSign);
    }
    const trafficPost = new THREE.Mesh(poleGeo, poleMat);
    trafficPost.position.set(8.8, 2.7, -12.5);
    const signalBox = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.45, 1.25, 0.45)), signAccentMat);
    signalBox.position.set(8.8, 5.2, -12.5);
    const busShelterRoof = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(2.0, 0.14, 4.2)), poleMat);
    busShelterRoof.position.set(-10.5, 2.5, -24.5);
    const shelterBench = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.65, 0.45, 2.6)), signAccentMat);
    shelterBench.position.set(-10.5, 0.45, -24.5);
    const wireSpan = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.02, 0.02, 20, 4)), poleMat);
    wireSpan.rotation.z = Math.PI / 2;
    wireSpan.position.set(0, 6.2, -18.0);
    this.root.add(trafficPost, signalBox, busShelterRoof, shelterBench, wireSpan);

    const flickerStreet = new THREE.PointLight(0xffaa55, 14, 24, 1.6);
    flickerStreet.position.set(-7.5, 5.2, -11);
    this.root.add(flickerStreet);
    this.flickerLights.push({ light: flickerStreet, baseIntensity: 15, speed: 17 });

    // Overturned barrels, abandoned military crates & debris along flanks
    const crateMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x3b4432, roughness: 0.82 }));
    const barrelMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x5c2d25, roughness: 0.68, metalness: 0.35 }));
    for (const c of [
      { x: -7.5, z: -7.4, r: 0.25 },
      { x: 7.4, z: -9.8, r: -0.4 },
      { x: -8.1, z: -21.0, r: 0.15 },
    ]) {
      const crate = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.15, 0.82, 0.9)), crateMat);
      crate.position.set(c.x, 0.41, c.z);
      crate.rotation.y = c.r;
      crate.castShadow = true;
      this.root.add(crate);
    }
    const barrelGeo = this.trackGeo(new THREE.CylinderGeometry(0.36, 0.36, 1.0, 9));
    for (const br of [
      { x: -6.4, z: -7.2, fallen: true },
      { x: 6.7, z: -15.5, fallen: false },
      { x: 7.5, z: -26.5, fallen: true },
    ]) {
      const b = new THREE.Mesh(barrelGeo, barrelMat);
      if (br.fallen) {
        b.rotation.z = Math.PI / 2;
        b.rotation.y = 0.6;
        b.position.set(br.x, 0.36, br.z);
      } else {
        b.position.set(br.x, 0.5, br.z);
      }
      this.root.add(b);
    }

    // Barriers & Beacon
    const hazardMat = this.trackMat(
      new THREE.MeshStandardMaterial({ map: this.createHazardTexture(), roughness: 0.85 })
    );
    const barGeo = this.trackGeo(new THREE.BoxGeometry(2.6, 0.95, 0.65));
    for (const bp of [
      { x: -3.2, z: -5.5, r: 0.12 },
      { x: 0.1, z: -5.8, r: -0.05 },
      { x: 3.3, z: -5.3, r: -0.18 },
      { x: -6.0, z: -18.5, r: 0.32 },
      { x: 5.8, z: -25.0, r: -0.25 },
    ]) {
      const m = new THREE.Mesh(barGeo, hazardMat);
      m.position.set(bp.x, 0.475, bp.z);
      m.rotation.y = bp.r;
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
    }

    const beaconMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd92626, emissive: 0xd92626, emissiveIntensity: 1.8 })
    );
    this.beaconMesh = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(0.08, 0.1, 0.14, 10)), beaconMat);
    this.beaconMesh.position.set(3.2, 1.12, -5.2);
    this.root.add(this.beaconMesh);

    const flareLight = new THREE.PointLight(0xd92626, 7, 14, 1.7);
    flareLight.position.set(3.2, 1.2, -5.2);
    this.root.add(flareLight);
    this.pulseLights.push(flareLight);

    const midLamp = new THREE.PointLight(0xffaa55, 16, 26, 1.6);
    midLamp.position.set(-6.5, 5.2, -18);
    this.root.add(midLamp);

    // Dried blood smears & drag trails on urban road and sidewalk corners
    this.addFloorDecals([
      { x: -0.6, z: -4.2, size: 1.9, rot: 0.7 },
      { x: 1.9, z: -6.8, size: 2.3, rot: -0.4 },
      { x: -3.8, z: -11.4, size: 2.8, rot: 1.1 },
      { x: 4.9, z: -16.2, size: 2.5, rot: -1.3 },
      { x: -6.2, z: -26.0, size: 3.1, rot: 0.5 },
    ]);

    // Natural cobwebs spanning building corners, lamp arms, and crate overhangs
    this.addCobwebs([
      { x: -13.2, y: 4.8, z: -10.8, w: 2.8, h: 2.8, rotY: 0.65 },
      { x: 13.2, y: 4.9, z: -17.6, w: 3.0, h: 3.0, rotY: -0.75, rotZ: Math.PI / 2 },
      { x: -8.6, y: 5.1, z: -11.0, w: 1.8, h: 1.8, rotY: 0.25 },
      { x: 8.6, y: 4.9, z: -18.0, w: 1.9, h: 1.9, rotY: -0.25, rotZ: Math.PI / 2 },
      { x: -7.5, y: 1.05, z: -7.6, w: 1.4, h: 1.4, rotY: 0.5, rotX: 0.2 },
    ]);

    this.addVehicles([
      { x: -4.8, z: -14.0, r: 0.38, c: 0x3b483d },
      { x: 5.1, z: -20.5, r: -0.52, c: 0x4c3532 },
      { x: -5.4, z: -32.0, r: 0.18, c: 0x343b46 },
    ]);
    this.addAtmosphereParticles(0x9ca3af, 105, -48, -2);
  }

  // ==================== STAGE 2: INDUSTRIAL FOUNDRY ====================
  private buildIndustrialEnvironment(): void {
    const bgHex = 0x0e0a08;
    this.scene.background = new THREE.Color(bgHex);
    this.scene.fog = new THREE.FogExp2(bgHex, 0.029);
    this.addLighting(0x6e5441, 0x18110c, 0.54, 0xffac62, 1.22, 0xea580c);

    this.spawnPoints = [
      { x: -9, z: -36 },
      { x: -3, z: -42 },
      { x: 3, z: -42 },
      { x: 9, z: -36 },
      { x: -11, z: -26 },
      { x: 11, z: -26 },
    ];

    const floor = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(140, 140)),
      this.trackMat(new THREE.MeshStandardMaterial({ map: this.createTileTexture('#252322', '#141211'), roughness: 0.85, metalness: 0.25 }))
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -28);
    floor.receiveShadow = true;
    this.root.add(floor);

    this.addFloorDecals([
      { x: -4.2, z: -12, size: 3.0, rot: 0.3 },
      { x: 3.8, z: -19, size: 2.7, rot: 1.9 },
      { x: -2.0, z: -28, size: 3.3, rot: -0.6 },
    ]);

    const rustSteel = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x4a352c, roughness: 0.68, metalness: 0.52 }));
    const darkIron = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x222528, roughness: 0.45, metalness: 0.78 }));
    const containerBlue = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x284359, roughness: 0.7, metalness: 0.35 }));
    const containerRed = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x6b2c25, roughness: 0.7, metalness: 0.35 }));
    const furnaceGlow = this.trackMat(new THREE.MeshStandardMaterial({ color: 0xff6b1a, emissive: 0xff4d00, emissiveIntensity: 2.0 }));
    this.flickerMats.push(furnaceGlow);

    const wallGeo = this.trackGeo(new THREE.BoxGeometry(2.2, 13, 95));
    const lWall = new THREE.Mesh(wallGeo, darkIron);
    lWall.position.set(-15.5, 6.5, -30);
    const rWall = new THREE.Mesh(wallGeo, darkIron);
    rWall.position.set(15.5, 6.5, -30);
    this.root.add(lWall, rWall);

    // Overhead steel trusses & sagging broken conduits/pipes
    const beamGeo = this.trackGeo(new THREE.BoxGeometry(31, 0.7, 0.7));
    const pipeGeo = this.trackGeo(new THREE.CylinderGeometry(0.28, 0.28, 30, 8));
    for (let z = -10; z >= -50; z -= 10) {
      const beam = new THREE.Mesh(beamGeo, rustSteel);
      beam.position.set(0, 10.5, z);
      this.root.add(beam);
      if (z === -20 || z === -40) {
        const pipe = new THREE.Mesh(pipeGeo, darkIron);
        pipe.rotation.z = Math.PI / 2 + (z === -20 ? 0.06 : -0.05);
        pipe.position.set(0, 9.4, z + 1.2);
        this.root.add(pipe);
      }
    }

    // Shipping containers + hazard drum clusters & industrial work-lamp flicker
    const containerGeo = this.trackGeo(new THREE.BoxGeometry(3.2, 3.0, 7.2));
    for (const c of [
      { x: -7.8, z: -15, r: 0.15, mat: containerBlue },
      { x: 7.8, z: -22, r: -0.18, mat: containerRed },
      { x: -7.5, z: -31, r: -0.08, mat: containerRed },
    ]) {
      const box = new THREE.Mesh(containerGeo, c.mat);
      box.position.set(c.x, 1.5, c.z);
      box.rotation.y = c.r;
      box.castShadow = true;
      box.receiveShadow = true;
      this.root.add(box);
    }

    const drumMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.55, metalness: 0.4 }));
    const drumGeo = this.trackGeo(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 10));
    for (const d of [
      { x: 6.2, z: -11.5 },
      { x: 7.1, z: -12.3 },
      { x: -5.4, z: -22.5 },
      { x: 5.5, z: -32.0 },
    ]) {
      const drum = new THREE.Mesh(drumGeo, drumMat);
      drum.position.set(d.x, 0.55, d.z);
      this.root.add(drum);
    }

    const vat = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(3.5, 4.0, 4.5, 10)), darkIron);
    vat.position.set(0, 2.25, -52);
    const vatCore = new THREE.Mesh(this.trackGeo(new THREE.CylinderGeometry(3.6, 3.6, 0.8, 10)), furnaceGlow);
    vatCore.position.set(0, 3.8, -52);
    this.root.add(vat, vatCore);

    const forgeLight = new THREE.PointLight(0xff6b1a, 22, 34, 1.5);
    forgeLight.position.set(0, 5.5, -42);
    this.root.add(forgeLight);
    this.pulseLights.push(forgeLight);

    const sparkLight = new THREE.PointLight(0xfbbf24, 12, 22, 1.8);
    sparkLight.position.set(7.5, 4.5, -18);
    this.root.add(sparkLight);
    this.flickerLights.push({ light: sparkLight, baseIntensity: 13, speed: 23 });

    // Hanging industrial chains & cobwebs in overhead trusses and container flanks
    const chainGeo = this.trackGeo(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6));
    for (const ch of [
      { x: -11.5, z: -10 },
      { x: 11.5, z: -20 },
      { x: -11.0, z: -30 },
    ]) {
      const chain = new THREE.Mesh(chainGeo, darkIron);
      chain.position.set(ch.x, 8.6, ch.z);
      this.root.add(chain);
    }

    this.addFloorDecals([
      { x: 4.8, z: -9.5, size: 2.4, rot: 0.9 },
      { x: -5.8, z: -17.5, size: 3.1, rot: -0.4 },
    ]);

    this.addCobwebs([
      { x: -12.6, y: 9.2, z: -10.0, w: 3.2, h: 3.2, rotY: 0.45 },
      { x: 12.6, y: 9.2, z: -20.0, w: 3.4, h: 3.4, rotY: -0.45, rotZ: Math.PI / 2 },
      { x: -6.4, y: 2.9, z: -12.2, w: 2.0, h: 2.0, rotY: 0.7 },
      { x: 6.4, y: 2.9, z: -19.0, w: 2.0, h: 2.0, rotY: -0.7, rotZ: Math.PI / 2 },
    ]);

    const hazardMat = this.trackMat(new THREE.MeshStandardMaterial({ map: this.createHazardTexture('#d97706'), roughness: 0.8 }));
    const barGeo = this.trackGeo(new THREE.BoxGeometry(2.6, 0.95, 0.65));
    for (const bx of [-3.4, 0, 3.4]) {
      const b = new THREE.Mesh(barGeo, hazardMat);
      b.position.set(bx, 0.475, -5.6);
      this.root.add(b);
    }
    this.addAtmosphereParticles(0xfb923c, 110, -48, -2);
  }

  // ==================== STAGE 3: CONTAMINATED RESEARCH FACILITY ====================
  private buildResearchEnvironment(): void {
    const bgHex = 0x050d0f;
    this.scene.background = new THREE.Color(bgHex);
    this.scene.fog = new THREE.FogExp2(bgHex, 0.032);
    this.addLighting(0x3a9188, 0x081417, 0.58, 0x86efac, 1.12, 0x16a34a);

    this.spawnPoints = [
      { x: -8, z: -36 },
      { x: -3, z: -42 },
      { x: 3, z: -42 },
      { x: 8, z: -36 },
      { x: -10, z: -26 },
      { x: 10, z: -26 },
    ];

    const floor = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(140, 140)),
      this.trackMat(new THREE.MeshStandardMaterial({ map: this.createTileTexture('#182629', '#0b1417'), roughness: 0.42, metalness: 0.35 }))
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -28);
    floor.receiveShadow = true;
    this.root.add(floor);

    // Biohazard spill + blood stains on lab tiles
    this.addFloorDecals(
      [
        { x: -6.8, z: -12.5, size: 3.4, rot: 0.5 },
        { x: 7.4, z: -21.8, size: 3.2, rot: -1.1 },
      ],
      '34, 197, 94',
      '20, 83, 45'
    );
    this.addFloorDecals([
      { x: 1.5, z: -15.0, size: 2.5, rot: 0.8 },
      { x: -2.4, z: -25.5, size: 3.0, rot: 2.0 },
    ]);

    const labWallMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x26353a, roughness: 0.5, metalness: 0.4 }));
    const glassBioMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x10b981, emissiveIntensity: 1.5, transparent: true, opacity: 0.78 })
    );
    const deskMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.55, metalness: 0.45 }));
    const screenGlowMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x06b6d4, emissiveIntensity: 1.7 }));
    this.flickerMats.push(glassBioMat, screenGlowMat);

    const wallGeo = this.trackGeo(new THREE.BoxGeometry(1.8, 10, 90));
    const lWall = new THREE.Mesh(wallGeo, labWallMat);
    lWall.position.set(-14, 5, -28);
    const rWall = new THREE.Mesh(wallGeo, labWallMat);
    rWall.position.set(14, 5, -28);
    this.root.add(lWall, rWall);

    // Bio-tanks populated with suspended Human Test Subjects (plus one breached tank on left flank)
    const tubeTracker = {
      geo: <T extends THREE.BufferGeometry>(g: T): T => this.trackGeo(g),
      mat: <T extends THREE.Material>(m: T): T => this.trackMat(m),
    };
    let rTubeIdx = 0;
    for (let z = -12; z >= -42; z -= 10) {
      for (const side of [-10.5, 10.5]) {
        const isBreached = side < 0 && z === -12;
        const th = buildContainmentTube(tubeTracker, {
          x: side,
          z,
          rotY: side < 0 ? Math.PI * 0.42 : -Math.PI * 0.42,
          poseVariant: (rTubeIdx % 3) as 0 | 1 | 2,
          fluidColor: 0x10b981,
          warningColor: isBreached ? 0xef4444 : 0x22d3ee,
          shattered: isBreached,
          labelSeed: rTubeIdx,
        });
        this.root.add(th.group);
        this.containmentTubes.push(th);
        rTubeIdx++;
      }
    }

    // Overturned lab desk + flickering diagnostic monitor
    const desk = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(2.4, 0.85, 1.1)), deskMat);
    desk.position.set(6.4, 0.48, -11.5);
    desk.rotation.set(0.28, -0.5, 0.14);
    const monitor = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.75, 0.55, 0.12)), screenGlowMat);
    monitor.position.set(6.1, 0.95, -11.3);
    monitor.rotation.y = -0.5;
    this.root.add(desk, monitor);

    const bioLight1 = new THREE.PointLight(0x2dd4bf, 18, 28, 1.5);
    bioLight1.position.set(-6, 4.5, -18);
    const bioLight2 = new THREE.PointLight(0x4ade80, 18, 28, 1.5);
    bioLight2.position.set(6, 4.5, -32);
    this.root.add(bioLight1, bioLight2);
    this.pulseLights.push(bioLight1, bioLight2);

    const alertRed = new THREE.PointLight(0xef4444, 14, 24, 1.7);
    alertRed.position.set(-9, 4.8, -12);
    this.root.add(alertRed);
    this.flickerLights.push({ light: alertRed, baseIntensity: 14, speed: 9 });

    // Medical gurney frame on left flank + blood trail leading from breached bio-tank
    const gurneyFrame = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(1.1, 0.14, 2.3)), deskMat);
    gurneyFrame.position.set(-7.6, 0.72, -16.5);
    gurneyFrame.rotation.set(0.08, 0.42, -0.15);
    this.root.add(gurneyFrame);

    this.addFloorDecals([
      { x: -8.8, z: -12.0, size: 2.9, rot: 0.3 },
      { x: -6.2, z: -14.8, size: 2.4, rot: 1.5 },
    ]);

    this.addCobwebs([
      { x: -11.6, y: 4.6, z: -12.0, w: 2.6, h: 2.6, rotY: 0.6 },
      { x: 11.6, y: 4.6, z: -22.0, w: 2.6, h: 2.6, rotY: -0.6, rotZ: Math.PI / 2 },
      { x: -11.6, y: 4.6, z: -32.0, w: 2.5, h: 2.5, rotY: 0.5 },
      { x: 6.4, y: 1.35, z: -11.5, w: 1.5, h: 1.5, rotY: -0.4 },
    ]);

    const hazardMat = this.trackMat(new THREE.MeshStandardMaterial({ map: this.createHazardTexture('#eab308'), roughness: 0.7 }));
    const barGeo = this.trackGeo(new THREE.BoxGeometry(2.6, 0.95, 0.65));
    for (const bx of [-3.3, 0, 3.3]) {
      const b = new THREE.Mesh(barGeo, hazardMat);
      b.position.set(bx, 0.475, -5.6);
      this.root.add(b);
    }
    this.addAtmosphereParticles(0x4ade80, 105, -45, -2);
  }

  // ==================== STAGE 4: BOSS ARENA ====================
  private buildBossArenaEnvironment(): void {
    const bgHex = 0x0c0507;
    this.scene.background = new THREE.Color(bgHex);
    this.scene.fog = new THREE.FogExp2(bgHex, 0.022);
    this.addLighting(0x662c35, 0x160b0e, 0.58, 0xffbfa0, 1.28, 0xdc2626);

    this.spawnPoints = [
      { x: 0, z: -34 },
      { x: -8, z: -30 },
      { x: 8, z: -30 },
      { x: -11, z: -24 },
      { x: 11, z: -24 },
    ];

    const floor = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(150, 150)),
      this.trackMat(new THREE.MeshStandardMaterial({ map: this.createTileTexture('#1e191b', '#100c0e'), roughness: 0.78, metalness: 0.2 }))
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -24);
    floor.receiveShadow = true;
    this.root.add(floor);

    // Heavy blood stains across the containment pit
    this.addFloorDecals([
      { x: -3.2, z: -18, size: 4.5, rot: 0.2 },
      { x: 3.6, z: -24, size: 4.2, rot: -0.9 },
      { x: 0.0, z: -22, size: 5.4, rot: 1.4 },
    ]);

    const ringMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 1.4 }));
    this.flickerMats.push(ringMat);
    const arenaRing = new THREE.Mesh(this.trackGeo(new THREE.RingGeometry(15.5, 16.4, 32)), ringMat);
    arenaRing.rotation.x = -Math.PI / 2;
    arenaRing.position.set(0, 0.03, -22);
    this.root.add(arenaRing);

    // Towering containment pylons with dangling broken chains
    const pylonMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.5, metalness: 0.75 }));
    const chainMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.35, metalness: 0.85 }));
    const pylonGeo = this.trackGeo(new THREE.BoxGeometry(2.2, 16, 2.2));
    const chainGeo = this.trackGeo(new THREE.CylinderGeometry(0.08, 0.08, 4.4, 6));

    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.35;
      const px = Math.cos(ang) * 19;
      const pz = -22 + Math.sin(ang) * 19;
      const pylon = new THREE.Mesh(pylonGeo, pylonMat);
      pylon.position.set(px, 8, pz);
      pylon.castShadow = true;
      this.root.add(pylon);

      const strip = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(0.4, 10, 0.4)), ringMat);
      strip.position.set(px * 0.93, 6, pz - (pz + 22) * 0.07);
      this.root.add(strip);

      // Broken heavy containment chain hanging inward from pylons
      const chain = new THREE.Mesh(chainGeo, chainMat);
      chain.position.set(px * 0.88, 3.8, pz - (pz + 22) * 0.12);
      chain.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.28;
      this.root.add(chain);
    }

    // Cobwebs anchored high in outer containment pylons (strictly outside inner chase arena)
    this.addCobwebs([
      { x: -16.8, y: 6.4, z: -12.0, w: 3.4, h: 3.4, rotY: 0.75 },
      { x: 16.8, y: 6.4, z: -12.0, w: 3.4, h: 3.4, rotY: -0.75, rotZ: Math.PI / 2 },
      { x: -16.8, y: 6.2, z: -31.5, w: 3.2, h: 3.2, rotY: 2.3 },
      { x: 16.8, y: 6.2, z: -31.5, w: 3.2, h: 3.2, rotY: -2.3, rotZ: Math.PI / 2 },
    ]);

    // Elevated shattered observation booth silhouette in rear background
    const booth = new THREE.Mesh(this.trackGeo(new THREE.BoxGeometry(16, 4.5, 4)), pylonMat);
    booth.position.set(0, 11.5, -45);
    const boothWin = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(12, 1.8, 0.4)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: 0x450a0a, emissiveIntensity: 0.9 }))
    );
    boothWin.position.set(0, 11.5, -42.9);
    this.root.add(booth, boothWin);

    const spot = new THREE.PointLight(0xff4d4d, 24, 42, 1.4);
    spot.position.set(0, 9, -22);
    this.root.add(spot);
    this.bossArenaSpot = spot;
    this.pulseLights.push(spot);

    const sideBeacon = new THREE.PointLight(0xf97316, 16, 26, 1.6);
    sideBeacon.position.set(-12, 5.5, -20);
    this.root.add(sideBeacon);
    this.flickerLights.push({ light: sideBeacon, baseIntensity: 16, speed: 12 });

    this.addAtmosphereParticles(0xfca5a5, 115, -40, -2);
  }

  private addVehicles(specs: Array<{ x: number; z: number; r: number; c: number }>): void {
    const wheelGeo = this.trackGeo(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 12));
    const wheelMat = this.trackMat(new THREE.MeshStandardMaterial({ color: 0x161719, roughness: 0.9 }));
    const hullGeo = this.trackGeo(new THREE.BoxGeometry(1.9, 0.68, 4.1));
    const cabinGeo = this.trackGeo(new THREE.BoxGeometry(1.65, 0.58, 2.1));

    for (const s of specs) {
      const car = new THREE.Group();
      const bodyMat = this.trackMat(new THREE.MeshStandardMaterial({ color: s.c, roughness: 0.65, metalness: 0.35 }));
      const hull = new THREE.Mesh(hullGeo, bodyMat);
      hull.position.y = 0.56;
      const cabin = new THREE.Mesh(cabinGeo, bodyMat);
      cabin.position.set(0, 1.15, -0.15);
      car.add(hull, cabin);

      for (const [wx, wy, wz] of [
        [-0.92, 0.38, 1.28],
        [0.92, 0.38, 1.28],
        [-0.92, 0.38, -1.28],
        [0.92, 0.38, -1.28],
      ]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, wy, wz);
        car.add(w);
      }
      car.position.set(s.x, 0, s.z);
      car.rotation.y = s.r;
      this.root.add(car);
    }
  }

  public update(elapsedSec: number, dtSec = 0.016, playerZ = 0): void {
    if (this.campaignCorridor) {
      this.campaignCorridor.update(dtSec, elapsedSec, playerZ);
      const atmo = this.campaignCorridor.getAtmosphereForZ(playerZ);
      this.targetBgColor.setHex(atmo.bgHex);
      this.currentBgColor.lerp(this.targetBgColor, Math.min(1, dtSec * 3.5));
      if (this.scene.background instanceof THREE.Color) {
        this.scene.background.copy(this.currentBgColor);
      } else {
        this.scene.background = this.currentBgColor.clone();
      }
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.copy(this.currentBgColor);
        this.scene.fog.density += (atmo.fogDensity - this.scene.fog.density) * Math.min(1, dtSec * 3.0);
      }
      return;
    }

    if (this.arenaChunk) {
      this.arenaChunk.update(dtSec, elapsedSec);
      return;
    }

    const pulse = 0.6 + 0.4 * Math.sin(elapsedSec * 4.5);
    updateContainmentTubes(this.containmentTubes, dtSec, elapsedSec);
    for (const l of this.pulseLights) {
      l.intensity = 6 + pulse * 14;
    }
    for (const fl of this.flickerLights) {
      const n = Math.sin(elapsedSec * fl.speed) * Math.cos(elapsedSec * (fl.speed * 0.37));
      fl.light.intensity = n > -0.45 ? fl.baseIntensity * (0.65 + 0.35 * Math.abs(n)) : fl.baseIntensity * 0.14;
    }
    if (this.beaconMesh) {
      (this.beaconMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + pulse * 1.6;
    }
    for (const m of this.flickerMats) {
      m.emissiveIntensity = 0.9 + pulse * 1.1;
    }
    if (this.atmospherePoints && this.atmosphereBaseY) {
      const attr = this.atmospherePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < this.atmosphereBaseY.length; i++) {
        arr[i * 3 + 1] = this.atmosphereBaseY[i] + Math.sin(elapsedSec * 0.65 + i * 0.9) * 0.35;
      }
      attr.needsUpdate = true;
    }
  }

  public dispose(scene: THREE.Scene): void {
    this.clearStage();
    scene.remove(this.root);
  }
}
