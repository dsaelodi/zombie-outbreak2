import * as THREE from 'three';
import type { CrowdDensityLevel } from '../../data/gameConfig';
import { BinusCelebrationScene } from './BinusCelebrationScene';
import { ZombieCrowdManager, type CrowdBehaviorState } from './ZombieCrowdManager';

/**
 * Stage 4: THE ARENA OF THE DEAD
 * Circular subterranean colosseum centered at (0, 0, -22) featuring:
 *  - Multi-tier stone stands + GPU-instanced ZombieCrowdManager (600–1,800 spectators)
 *  - Fire braziers, hanging chains & 8 outer stone pillars (safe destabilization outside combat radius r=18)
 *  - Entrance Elevator Gate at z = +7.2
 *  - Giant Arena Exit Gate at z = -41.0 opening to sunlit Dawn BINUS Celebration Plaza
 */
export class ArenaChunk {
  public readonly root = new THREE.Group();
  public readonly crowdManager: ZombieCrowdManager;
  public readonly binusScene: BinusCelebrationScene;

  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly texs: THREE.Texture[] = [];

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly spotLight: THREE.PointLight;
  private readonly exitLight: THREE.PointLight;
  private readonly outroHemiLight: THREE.HemisphereLight;
  private readonly outroSunLight: THREE.DirectionalLight;
  private readonly fireLights: THREE.PointLight[] = [];
  private readonly outerPillars: Array<{ group: THREE.Group; baseAngle: number; tiltDir: number }> = [];

  private elevatorGateLeft: THREE.Mesh;
  private elevatorGateRight: THREE.Mesh;
  private exitGateLeft: THREE.Group;
  private exitGateRight: THREE.Group;
  private exitLockBarLeft: THREE.Mesh;
  private exitLockBarRight: THREE.Mesh;
  private exitLockCore: THREE.Mesh;
  private exitLockCoreMat: THREE.MeshStandardMaterial;
  private exitChainLeft: THREE.Mesh;
  private exitChainRight: THREE.Mesh;
  private exitDustPoints: THREE.Points;
  private exitDustMat: THREE.PointsMaterial;
  private exitDustBaseY: Float32Array;
  private exitDawnBackdrop: THREE.Mesh;
  private exitDawnTrees: THREE.Group;
  private exteriorGroup: THREE.Group;

  private destabilizeActive = false;
  private destabilizeProgress = 0;
  private exitDustProgress = 0;
  private outroDawnFactor = 0;

  constructor(maxAniso: number, crowdDensity: CrowdDensityLevel, isSoftwareGl: boolean) {
    this.hemiLight = new THREE.HemisphereLight(0x662c35, 0x160b0e, 0.62);
    this.hemiLight.position.set(0, 32, -22);
    this.root.add(this.hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffbfa0, 1.25);
    keyLight.position.set(-14, 26, 8);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 75;
      keyLight.shadow.camera.left = -24;
      keyLight.shadow.camera.right = 24;
      keyLight.shadow.camera.top = 24;
      keyLight.shadow.camera.bottom = -24;
    }
    this.root.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xdc2626, 0.65);
    rimLight.position.set(12, 16, -45);
    this.root.add(rimLight);

    // Arena Tile Floor
    const floorTex = this.createArenaFloorTex(maxAniso);
    const floor = new THREE.Mesh(
      this.tGeo(new THREE.PlaneGeometry(140, 140)),
      this.tMat(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.78, metalness: 0.22 }))
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -22);
    floor.receiveShadow = true;
    this.root.add(floor);

    // Combat Boundary Ring (r = 16.5m centered at 0, -22)
    const ringMat = this.tMat(
      new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 1.3 })
    );
    const ring = new THREE.Mesh(this.tGeo(new THREE.RingGeometry(16.2, 17.0, 40)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.03, -22);
    this.root.add(ring);

    // Multi-tier Colosseum Spectator Stands (radius 21.4 .. 33.8m, leaving south/north gate gaps)
    const standMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x241e21, roughness: 0.92 }));
    const wallMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x1c1719, roughness: 0.94 }));
    const segCount = 28;
    for (let s = 0; s < segCount; s++) {
      const ang = (s / segCount) * Math.PI * 2;
      const cx = Math.cos(ang);
      const cz = Math.sin(ang);
      const testZ = -22 + cz * 22;
      const testX = cx * 22;
      if (testZ > -2 && Math.abs(testX) < 5.5) continue; // South Elevator Entrance gap
      if (testZ < -39 && Math.abs(testX) < 6.8) continue; // North Giant Exit Gate gap

      for (let t = 0; t < 7; t++) {
        const r = 21.4 + t * 1.78;
        const h = 2.6 + t * 1.24;
        const block = new THREE.Mesh(
          this.tGeo(new THREE.BoxGeometry(5.6, h, 2.0)),
          t % 2 === 0 ? standMat : wallMat
        );
        block.position.set(cx * r, h * 0.5, -22 + cz * r);
        block.rotation.y = -ang + Math.PI / 2;
        this.root.add(block);
      }
    }

    // 8 Outer Stone Pillars + Fire Braziers + Hanging Chains (placed safely at r = 19.6m outside combat floor)
    const pylonMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x2a272a, roughness: 0.65, metalness: 0.35 }));
    const chainMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.85, roughness: 0.35 }));
    const flameMat = this.tMat(
      new THREE.MeshStandardMaterial({ color: 0xff6b1a, emissive: 0xff4500, emissiveIntensity: 2.2 })
    );

    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.38;
      const px = Math.cos(ang) * 19.6;
      const pz = -22 + Math.sin(ang) * 19.6;

      const pg = new THREE.Group();
      pg.position.set(px, 0, pz);
      const col = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(2.1, 14.5, 2.1)), pylonMat);
      col.position.y = 7.25;
      col.castShadow = true;
      const brazierBowl = new THREE.Mesh(this.tGeo(new THREE.CylinderGeometry(0.85, 0.5, 0.7, 8)), pylonMat);
      brazierBowl.position.set(0, 3.2, 0);
      const brazierFire = new THREE.Mesh(this.tGeo(new THREE.DodecahedronGeometry(0.58, 0)), flameMat);
      brazierFire.position.set(0, 3.75, 0);
      const chain = new THREE.Mesh(this.tGeo(new THREE.CylinderGeometry(0.07, 0.07, 4.6, 6)), chainMat);
      chain.position.set(-Math.cos(ang) * 1.1, 4.6, -Math.sin(ang) * 1.1);
      chain.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.25;
      pg.add(col, brazierBowl, brazierFire, chain);
      this.root.add(pg);
      this.outerPillars.push({ group: pg, baseAngle: ang, tiltDir: i % 2 === 0 ? 1 : -1 });

      if (i % 2 === 0) {
        const fLight = new THREE.PointLight(0xff6b1a, 18, 28, 1.5);
        fLight.position.set(px * 0.88, 4.2, -22 + Math.sin(ang) * 17.5);
        this.root.add(fLight);
        this.fireLights.push(fLight);
      }
    }

    // Center Arena Spot Light
    this.spotLight = new THREE.PointLight(0xff4d4d, 26, 46, 1.4);
    this.spotLight.position.set(0, 10, -22);
    this.root.add(this.spotLight);

    // Entrance Elevator Gate at z = +7.2
    const gateFrameMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x262930, metalness: 0.75, roughness: 0.4 }));
    const frameL = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(2.2, 5.2, 1.2)), gateFrameMat);
    frameL.position.set(-3.8, 2.6, 7.2);
    const frameR = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(2.2, 5.2, 1.2)), gateFrameMat);
    frameR.position.set(3.8, 2.6, 7.2);
    this.root.add(frameL, frameR);

    this.elevatorGateLeft = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(2.8, 4.4, 0.4)), gateFrameMat);
    this.elevatorGateLeft.position.set(-1.4, 2.2, 7.2);
    this.elevatorGateRight = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(2.8, 4.4, 0.4)), gateFrameMat);
    this.elevatorGateRight.position.set(1.4, 2.2, 7.2);
    this.root.add(this.elevatorGateLeft, this.elevatorGateRight);

    // GIANT ARENA EXIT GATE AT z = -41.0
    const archPillarL = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(2.4, 9.5, 2.4)), pylonMat);
    archPillarL.position.set(-5.2, 4.75, -41.0);
    const archPillarR = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(2.4, 9.5, 2.4)), pylonMat);
    archPillarR.position.set(5.2, 4.75, -41.0);
    const archLint = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(12.8, 2.2, 2.6)), pylonMat);
    archLint.position.set(0, 9.2, -41.0);
    this.root.add(archPillarL, archPillarR, archLint);

    const doorMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x1e2024, metalness: 0.7, roughness: 0.45 }));
    const makeExitWing = (hingeX: number, sign: number): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(hingeX, 0, -41.0);
      const panel = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(4.0, 8.0, 0.55)), doorMat);
      panel.position.set(sign * 2.0, 4.0, 0);
      const brace = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(3.8, 0.42, 0.72)), gateFrameMat);
      brace.position.set(sign * 2.0, 2.8, 0);
      const topBrace = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(3.8, 0.36, 0.68)), gateFrameMat);
      topBrace.position.set(sign * 2.0, 6.2, 0);
      g.add(panel, brace, topBrace);
      this.root.add(g);
      return g;
    };
    this.exitGateLeft = makeExitWing(-4.0, 1);
    this.exitGateRight = makeExitWing(4.0, -1);

    // Retractable Locking Bolt Bar, Lock Indicator & Tension Chains on Exit Gate
    const boltMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.3 }));
    this.exitLockBarLeft = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(3.4, 0.34, 0.28)), boltMat);
    this.exitLockBarLeft.position.set(-1.7, 3.25, -40.58);
    this.exitLockBarRight = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(3.4, 0.34, 0.28)), boltMat);
    this.exitLockBarRight.position.set(1.7, 3.25, -40.58);
    this.exitLockCoreMat = this.tMat(
      new THREE.MeshStandardMaterial({ color: 0xdc2626, emissive: 0xdc2626, emissiveIntensity: 1.8 })
    );
    this.exitLockCore = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(0.46, 0.56, 0.34)), this.exitLockCoreMat);
    this.exitLockCore.position.set(0, 3.25, -40.5);

    this.exitChainLeft = new THREE.Mesh(this.tGeo(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 6)), chainMat);
    this.exitChainLeft.position.set(-2.3, 4.4, -40.48);
    this.exitChainLeft.rotation.z = -0.82;
    this.exitChainRight = new THREE.Mesh(this.tGeo(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 6)), chainMat);
    this.exitChainRight.position.set(2.3, 4.4, -40.48);
    this.exitChainRight.rotation.z = 0.82;
    this.root.add(
      this.exitLockBarLeft,
      this.exitLockBarRight,
      this.exitLockCore,
      this.exitChainLeft,
      this.exitChainRight
    );

    // Falling Stone Dust Particles at Giant Exit Gate Threshold
    const dustCount = 48;
    const dustPositions = new Float32Array(dustCount * 3);
    this.exitDustBaseY = new Float32Array(dustCount);
    for (let d = 0; d < dustCount; d++) {
      const y = 0.6 + Math.random() * 7.6;
      this.exitDustBaseY[d] = y;
      dustPositions[d * 3] = (Math.random() - 0.5) * 8.4;
      dustPositions[d * 3 + 1] = y;
      dustPositions[d * 3 + 2] = -40.3 + (Math.random() - 0.5) * 1.4;
    }
    const dustGeo = this.tGeo(new THREE.BufferGeometry());
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    this.exitDustMat = this.tMat(
      new THREE.PointsMaterial({ color: 0xd6d3d1, size: 0.16, transparent: true, opacity: 0.0 })
    );
    this.exitDustPoints = new THREE.Points(dustGeo, this.exitDustMat);
    this.root.add(this.exitDustPoints);

    // Warm Dawn Sanctuary Light & Exterior Tree Silhouettes behind Giant Exit Gate
    const dawnMat = this.tMat(
      new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.0 })
    );
    this.exitDawnBackdrop = new THREE.Mesh(this.tGeo(new THREE.PlaneGeometry(18, 12)), dawnMat);
    this.exitDawnBackdrop.position.set(0, 5.2, -48.5);
    this.root.add(this.exitDawnBackdrop);

    this.exitDawnTrees = new THREE.Group();
    const extPineMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x1c2b22, roughness: 0.9 }));
    for (const [tx, tz, sc] of [
      [-4.2, -46.8, 1.1],
      [3.9, -47.2, 1.25],
    ]) {
      const pine = new THREE.Mesh(this.tGeo(new THREE.ConeGeometry(1.4 * sc, 5.2 * sc, 6)), extPineMat);
      pine.position.set(tx, 2.6 * sc, tz);
      this.exitDawnTrees.add(pine);
    }
    this.exitDawnTrees.visible = false;
    this.root.add(this.exitDawnTrees);

    this.exitLight = new THREE.PointLight(0xfde68a, 0, 36, 1.2);
    this.exitLight.position.set(0, 4.4, -44);
    this.root.add(this.exitLight);

    // Exterior BINUS Celebration Plaza & Dawn Sun Lighting (north of Exit Gate z = -41 .. -122)
    this.exteriorGroup = new THREE.Group();
    const plazaFloor = new THREE.Mesh(
      this.tGeo(new THREE.PlaneGeometry(96, 86)),
      this.tMat(new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 0.86, metalness: 0.05 }))
    );
    plazaFloor.rotation.x = -Math.PI / 2;
    plazaFloor.position.set(0, 0.02, -84);
    plazaFloor.receiveShadow = true;
    this.exteriorGroup.add(plazaFloor);

    // Warm sanctuary center carpet / stone promenade extending from Exit Gate
    const walkway = new THREE.Mesh(
      this.tGeo(new THREE.PlaneGeometry(11.5, 58)),
      this.tMat(new THREE.MeshStandardMaterial({ color: 0xb6a992, roughness: 0.78 }))
    );
    walkway.rotation.x = -Math.PI / 2;
    walkway.position.set(0, 0.035, -70);
    walkway.receiveShadow = true;
    this.exteriorGroup.add(walkway);

    // Flanking sunlit grass terraces
    const grassMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x3b6e3c, roughness: 0.92 }));
    const lawnL = new THREE.Mesh(this.tGeo(new THREE.PlaneGeometry(42, 86)), grassMat);
    lawnL.rotation.x = -Math.PI / 2;
    lawnL.position.set(-34, 0.03, -84);
    const lawnR = new THREE.Mesh(this.tGeo(new THREE.PlaneGeometry(42, 86)), grassMat);
    lawnR.rotation.x = -Math.PI / 2;
    lawnR.position.set(34, 0.03, -84);
    this.exteriorGroup.add(lawnL, lawnR);

    // Monumental exterior Colosseum fortress walls flanking Exit Gate for wide Shot 5 pull-back
    const outerWallMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x2d282b, roughness: 0.9 }));
    const wallLeft = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(22, 12.5, 3.2)), outerWallMat);
    wallLeft.position.set(-16.5, 6.25, -41.4);
    const wallRight = new THREE.Mesh(this.tGeo(new THREE.BoxGeometry(22, 12.5, 3.2)), outerWallMat);
    wallRight.position.set(16.5, 6.25, -41.4);
    this.exteriorGroup.add(wallLeft, wallRight);

    // Sunlit pine & cypress horizon perimeter framing the celebration courtyard
    const treeTrunkMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x5c3d28, roughness: 0.9 }));
    const treeLeafMat = this.tMat(new THREE.MeshStandardMaterial({ color: 0x2d5a34, roughness: 0.85 }));
    for (const [tx, tz, sc] of [
      [-15.5, -51, 1.2],
      [15.5, -52, 1.25],
      [-17.2, -63, 1.4],
      [17.4, -64, 1.35],
      [-15.0, -76, 1.45],
      [15.2, -77, 1.4],
      [-8.5, -83, 1.5],
      [8.5, -84, 1.55],
      [0, -88, 1.6],
    ]) {
      const trunk = new THREE.Mesh(this.tGeo(new THREE.CylinderGeometry(0.28 * sc, 0.36 * sc, 1.8 * sc, 6)), treeTrunkMat);
      trunk.position.set(tx, 0.9 * sc, tz);
      const canopy = new THREE.Mesh(this.tGeo(new THREE.ConeGeometry(1.7 * sc, 4.8 * sc, 7)), treeLeafMat);
      canopy.position.set(tx, 3.6 * sc, tz);
      this.exteriorGroup.add(trunk, canopy);
    }

    this.binusScene = new BinusCelebrationScene(maxAniso);
    this.exteriorGroup.add(this.binusScene.root);
    this.exteriorGroup.visible = false;
    this.root.add(this.exteriorGroup);

    this.outroHemiLight = new THREE.HemisphereLight(0xfef9c3, 0x4b5e43, 0);
    this.outroHemiLight.position.set(0, 36, -64);
    this.outroSunLight = new THREE.DirectionalLight(0xfff1c9, 0);
    this.outroSunLight.position.set(18, 28, -95);
    this.root.add(this.outroHemiLight, this.outroSunLight);

    // Instanced Spectator Horde
    this.crowdManager = new ZombieCrowdManager(crowdDensity, isSoftwareGl);
    this.root.add(this.crowdManager.root);
  }

  private tGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }
  private tMat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private createArenaFloorTex(aniso: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1e191b';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#110d0e';
    ctx.lineWidth = 4;
    for (let i = 0; i <= 256; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(8, 8);
    t.anisotropy = aniso;
    this.texs.push(t);
    return t;
  }

  public setElevatorGateOpen(p: number): void {
    const u = Math.max(0, Math.min(1, p));
    this.elevatorGateLeft.position.x = -1.4 - u * 2.5;
    this.elevatorGateRight.position.x = 1.4 + u * 2.5;
  }

  public setExitGateState(state: {
    lockRetract: number;
    openProgress: number;
    dustProgress?: number;
  }): void {
    const lockU = Math.max(0, Math.min(1, state.lockRetract));
    const openU = Math.max(0, Math.min(1, state.openProgress));
    this.exitDustProgress = Math.max(0, Math.min(1, state.dustProgress ?? (openU > 0 && openU < 0.99 ? 0.7 : 0)));

    // Retract locking bars outward into stone pillars & turn core green once unlocked
    this.exitLockBarLeft.position.x = -1.7 - lockU * 2.6;
    this.exitLockBarRight.position.x = 1.7 + lockU * 2.6;
    this.exitLockBarLeft.visible = openU < 0.15;
    this.exitLockBarRight.visible = openU < 0.15;

    this.exitLockCoreMat.color.setHex(lockU >= 0.85 ? 0x22c55e : 0xdc2626);
    this.exitLockCoreMat.emissive.setHex(lockU >= 0.85 ? 0x22c55e : 0xdc2626);
    this.exitLockCore.position.y = 3.25 + lockU * 0.45;
    this.exitLockCore.visible = openU < 0.1;

    // Tension chains drop downward to side anchors as lock releases
    this.exitChainLeft.position.y = 4.4 - lockU * 2.8;
    this.exitChainLeft.position.x = -2.3 - lockU * 1.9;
    this.exitChainLeft.rotation.z = -0.82 - lockU * 0.65;
    this.exitChainRight.position.y = 4.4 - lockU * 2.8;
    this.exitChainRight.position.x = 2.3 + lockU * 1.9;
    this.exitChainRight.rotation.z = 0.82 + lockU * 0.65;

    // Double hinged doors rotate cleanly outward
    const ang = openU * 1.42;
    this.exitGateLeft.rotation.y = -ang;
    this.exitGateRight.rotation.y = ang;
    this.exitLight.intensity = openU * 44;
    // Fade flat dawn mist plane out smoothly once the full 3D exterior plaza fades into view
    (this.exitDawnBackdrop.material as THREE.MeshBasicMaterial).opacity =
      openU * 0.72 * Math.max(0, 1 - this.outroDawnFactor * 1.4);
    this.exitDawnTrees.visible = openU > 0.05 && this.outroDawnFactor < 0.25;
    this.exteriorGroup.visible = openU > 0.05 || this.outroDawnFactor > 0.01;
    this.exitDustMat.opacity = this.exitDustProgress * 0.65;
  }

  public setExitGateOpen(p: number): void {
    const u = Math.max(0, Math.min(1, p));
    this.setExitGateState({
      lockRetract: u > 0 ? 1 : 0,
      openProgress: u,
      dustProgress: u > 0 && u < 0.99 ? 0.65 : 0,
    });
  }

  public setOutroDawnAtmosphere(t01: number): void {
    const u = Math.max(0, Math.min(1, t01));
    this.outroDawnFactor = u;
    this.exteriorGroup.visible = u > 0.01 || this.exteriorGroup.visible;
    this.outroHemiLight.intensity = u * 1.65;
    this.outroSunLight.intensity = u * 2.15;
    (this.exitDawnBackdrop.material as THREE.MeshBasicMaterial).opacity *= Math.max(0, 1 - u * 1.4);
    if (u > 0.25) {
      this.exitDawnTrees.visible = false;
    }
  }

  public setDestabilized(active: boolean): void {
    this.destabilizeActive = active;
  }

  public setCrowdState(
    state: CrowdBehaviorState,
    collapseProgress?: number,
    showcaseExcitement?: number
  ): void {
    this.crowdManager.setState(state, collapseProgress);
    if (showcaseExcitement !== undefined) {
      this.crowdManager.setShowcaseExcitement(showcaseExcitement);
    }
  }

  public setAtmospherePhase(phase: 1 | 2): void {
    if (phase === 1) {
      this.hemiLight.color.setHex(0x662c35);
      this.hemiLight.intensity = 0.62;
      this.spotLight.color.setHex(0xff4d4d);
      this.spotLight.intensity = 26;
    } else {
      this.hemiLight.color.setHex(0x991b1b);
      this.hemiLight.intensity = 0.78;
      this.spotLight.color.setHex(0xff2a2a);
      this.spotLight.intensity = 34;
    }
  }

  public update(dtSec: number, elapsedSec: number): void {
    this.crowdManager.update(dtSec, elapsedSec);
    if (this.exteriorGroup.visible) {
      this.binusScene.update(elapsedSec);
    }

    if (this.exitDustProgress > 0.02) {
      const posAttr = this.exitDustPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i) - dtSec * 1.9;
        if (y < 0.2) y = this.exitDustBaseY[i];
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
    }

    if (this.destabilizeActive) {
      this.destabilizeProgress = Math.min(1, this.destabilizeProgress + dtSec * 0.35);
      for (let i = 0; i < this.outerPillars.length; i++) {
        const p = this.outerPillars[i];
        const tremor = Math.sin(elapsedSec * 14 + i * 1.7) * 0.025;
        // Tilt pillars slightly OUTWARD away from arena floor so combat space stays clean
        p.group.rotation.z = Math.cos(p.baseAngle) * -0.14 * this.destabilizeProgress + tremor;
        p.group.rotation.x = Math.sin(p.baseAngle) * 0.14 * this.destabilizeProgress;
      }
    } else {
      this.destabilizeProgress = 0;
      for (const p of this.outerPillars) {
        p.group.rotation.set(0, 0, 0);
      }
    }

    for (let i = 0; i < this.fireLights.length; i++) {
      const fl = this.fireLights[i];
      const flicker = 0.72 + 0.28 * Math.sin(elapsedSec * (9 + i * 2.1));
      fl.intensity = (this.destabilizeActive ? 26 : 17) * flicker;
    }
  }

  public dispose(): void {
    this.crowdManager.dispose();
    this.binusScene.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.geos.length = 0;
    this.mats.length = 0;
    this.texs.length = 0;
  }
}
