import * as THREE from 'three';
import {
  buildContainmentTube,
  updateContainmentTubes,
  type ContainmentTubeHandle,
} from './LaboratorySubjects';

export interface CorridorAtmosphere {
  bgHex: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiInt: number;
  keyColor: number;
  keyInt: number;
}

class AssetTracker {
  public readonly geos: THREE.BufferGeometry[] = [];
  public readonly mats: THREE.Material[] = [];
  public readonly texs: THREE.Texture[] = [];

  public geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }
  public mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }
  public tex<T extends THREE.Texture>(t: T): T {
    this.texs.push(t);
    return t;
  }
  public dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.geos.length = 0;
    this.mats.length = 0;
    this.texs.length = 0;
  }
}

function makeCanvasTex(
  tracker: AssetTracker,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  aniso: number,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeatX !== 1 || repeatY !== 1) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
  }
  t.anisotropy = aniso;
  return tracker.tex(t);
}

/**
 * Builds the continuous Z-corridor spanning Stages 1–3:
 *  - Stage 1 (Abandoned Village): z = 10 .. -90 (Iron Gate at z = -72)
 *  - Stage 2 (Cursed Forest): z = -90 .. -236 (Bunker Blast Gate at z = -224)
 *  - Stage 3 (Underground Facility Wings A–E): z = -236 .. -388 (Elevator at z = -384)
 */
export class CorridorChunks {
  public readonly root = new THREE.Group();
  private readonly tracker = new AssetTracker();

  // Animated environment elements
  private pulseLights: THREE.PointLight[] = [];
  private flickerLights: Array<{ light: THREE.PointLight; base: number; speed: number }> = [];
  private flickerMats: THREE.MeshStandardMaterial[] = [];

  // Stage 1 Iron Gate & Creature silhouette
  private villageGateLeft: THREE.Group | null = null;
  private villageGateRight: THREE.Group | null = null;
  private creatureGroup: THREE.Group | null = null;
  private creatureHead: THREE.Group | null = null;

  // Stage 2 Hanging swaying corpses, falling leaves & Bunker doors
  private hangingCorpses: Array<{ group: THREE.Group; phase: number; amp: number }> = [];
  private leavesPoints: THREE.Points | null = null;
  private leavesBaseY: Float32Array | null = null;
  private bunkerDoorLeft: THREE.Mesh | null = null;
  private bunkerDoorRight: THREE.Mesh | null = null;

  // Stage 3 Facility alarm, King chamber silhouette, containment tubes & Elevator
  private facilityAlarmLights: THREE.PointLight[] = [];
  private facilityAlarmBeacons: THREE.MeshStandardMaterial[] = [];
  private facilityAlarmActive = false;
  private containmentTubes: ContainmentTubeHandle[] = [];
  private alphaKingGroup: THREE.Group | null = null;
  private kingLeftLegPivot: THREE.Group | null = null;
  private kingRightLegPivot: THREE.Group | null = null;
  private kingTorsoPivot: THREE.Group | null = null;
  private kingLeftArmPivot: THREE.Group | null = null;
  private kingRightArmPivot: THREE.Group | null = null;
  private kingElevPlatform: THREE.Group | null = null;
  private kingElevDoorLeft: THREE.Mesh | null = null;
  private kingElevDoorRight: THREE.Mesh | null = null;
  private kingElevLight: THREE.PointLight | null = null;
  private kingElevBeaconMat: THREE.MeshStandardMaterial | null = null;
  private kingElevDescending = false;

  private playerElevatorCage: THREE.Group | null = null;
  private elevatorDoorLeft: THREE.Mesh | null = null;
  private elevatorDoorRight: THREE.Mesh | null = null;
  private elevatorShaftRibs: THREE.Group | null = null;
  private elevatorInteriorLight: THREE.PointLight | null = null;
  private elevatorEmergencyLight: THREE.PointLight | null = null;
  private elevatorCeilingLamp: THREE.MeshStandardMaterial | null = null;
  private elevatorSparkPoints: THREE.Points | null = null;
  private elevatorDescending = false;
  private elevatorSpeedFactor = 0;
  private elevatorRibOffset = 0;
  private elevatorSparkCooldown = 0.8;
  private elevatorSparkDuration = 0;

  // Dynamic lights adjusted by Z crossfade
  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;

  constructor(maxAniso: number, isSoftwareGl: boolean) {
    this.hemiLight = new THREE.HemisphereLight(0x52657a, 0x181310, 0.58);
    this.hemiLight.position.set(0, 32, -160);
    this.root.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xffd2a0, 1.15);
    this.keyLight.position.set(-16, 28, -40);
    if (!isSoftwareGl) {
      this.keyLight.castShadow = false;
    }
    this.root.add(this.keyLight);

    const rimLight = new THREE.DirectionalLight(0x526b82, 0.52);
    rimLight.position.set(14, 16, -240);
    this.root.add(rimLight);

    this.buildStage1AbandonedVillage(maxAniso);
    this.buildStage2CursedForest(maxAniso);
    this.buildStage3UndergroundFacility(maxAniso);
  }

  private sharedBloodDecalMat: THREE.MeshBasicMaterial | null = null;
  private sharedBloodDecalGeo: THREE.PlaneGeometry | null = null;

  private addBloodDecal(x: number, z: number, size: number, rot = 0): void {
    if (!this.sharedBloodDecalMat || !this.sharedBloodDecalGeo) {
      const tex = makeCanvasTex(
        this.tracker,
        256,
        256,
        (ctx) => {
          ctx.clearRect(0, 0, 256, 256);
          const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 108);
          g.addColorStop(0, 'rgba(54, 5, 5, 0.94)');
          g.addColorStop(0.55, 'rgba(98, 12, 12, 0.68)');
          g.addColorStop(1, 'rgba(98, 12, 12, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 256, 256);
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            const d = 32 + (i % 5) * 16;
            const r = 6 + (i % 4) * 4;
            ctx.fillStyle = 'rgba(72, 8, 8, 0.55)';
            ctx.beginPath();
            ctx.arc(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, r, 0, Math.PI * 2);
            ctx.fill();
          }
        },
        1
      );
      this.sharedBloodDecalMat = this.tracker.mat(
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        })
      );
      this.sharedBloodDecalGeo = this.tracker.geo(new THREE.PlaneGeometry(1, 1.15));
    }
    const m = new THREE.Mesh(this.sharedBloodDecalGeo, this.sharedBloodDecalMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rot;
    m.position.set(x, 0.022, z);
    m.scale.set(size, size, 1);
    this.root.add(m);
  }

  // ==================== STAGE 1: ABANDONED VILLAGE (z = 10 .. -90) ====================
  private buildStage1AbandonedVillage(maxAniso: number): void {
    const roadTex = makeCanvasTex(
      this.tracker,
      256,
      256,
      (ctx) => {
        ctx.fillStyle = '#222528';
        ctx.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 2400; i++) {
          const v = 22 + Math.floor(Math.random() * 24);
          ctx.fillStyle = `rgb(${v},${v + 1},${v + 2})`;
          ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
        }
        ctx.fillStyle = 'rgba(182, 138, 42, 0.45)';
        ctx.fillRect(124, 0, 4, 256);
      },
      maxAniso,
      1,
      12
    );

    const earth = new THREE.Mesh(
      this.tracker.geo(new THREE.PlaneGeometry(90, 110)),
      this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x161a16, roughness: 0.96 }))
    );
    earth.rotation.x = -Math.PI / 2;
    earth.position.set(0, -0.04, -40);
    this.root.add(earth);

    const road = new THREE.Mesh(
      this.tracker.geo(new THREE.PlaneGeometry(14, 102)),
      this.tracker.mat(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.88 }))
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.004, -40);
    this.root.add(road);

    // Sidewalk stone curbs & checkpoint sandbag barricades
    const curbMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x383c42, roughness: 0.9 }));
    const curbGeo = this.tracker.geo(new THREE.BoxGeometry(1.1, 0.16, 100));
    const curbL = new THREE.Mesh(curbGeo, curbMat);
    curbL.position.set(-7.55, 0.08, -40);
    const curbR = new THREE.Mesh(curbGeo, curbMat);
    curbR.position.set(7.55, 0.08, -40);
    this.root.add(curbL, curbR);

    const sandbagMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x6b614b, roughness: 0.94 }));
    const sandbagGeo = this.tracker.geo(new THREE.BoxGeometry(0.95, 0.34, 0.48));
    for (const [bx, bz, ry] of [
      [-3.2, -20.2, 0.18],
      [-2.2, -20.3, -0.1],
      [3.3, -50.2, -0.22],
      [2.3, -50.3, 0.12],
    ]) {
      const sb1 = new THREE.Mesh(sandbagGeo, sandbagMat);
      sb1.position.set(bx, 0.17, bz);
      sb1.rotation.y = ry;
      const sb2 = new THREE.Mesh(sandbagGeo, sandbagMat);
      sb2.position.set(bx + 0.15, 0.48, bz);
      sb2.rotation.y = -ry;
      this.root.add(sb1, sb2);
    }

    // Abandoned Village Houses with open front doors & porches
    const wallColors = [0x47413c, 0x3b4445, 0x4c3b34, 0x383c42];
    const roofMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x261d1a, roughness: 0.92 }));
    const woodMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x4a3425, roughness: 0.88 }));
    const darkVoidMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x07080a, roughness: 0.95 }));
    const boardMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x5d442e, roughness: 0.85 }));

    const houseSpecs = [
      { x: -13.5, z: -10, side: 1, c: 0, hScale: 1.0, hasPorch: true },
      { x: 13.5, z: -16, side: -1, c: 1, hScale: 1.18, hasPorch: false },
      { x: -14.0, z: -28, side: 1, c: 2, hScale: 0.92, hasPorch: true },
      { x: 13.8, z: -36, side: -1, c: 3, hScale: 1.12, hasPorch: true },
      { x: -13.5, z: -48, side: 1, c: 1, hScale: 1.05, hasPorch: false },
      { x: 13.5, z: -56, side: -1, c: 0, hScale: 0.96, hasPorch: true },
    ];

    for (const h of houseSpecs) {
      const g = new THREE.Group();
      const bodyH = 5.2 * h.hScale;
      const wMat = this.tracker.mat(
        new THREE.MeshStandardMaterial({ color: wallColors[h.c], roughness: 0.88 })
      );
      const body = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(8, bodyH, 9)), wMat);
      body.position.y = bodyH * 0.5;
      const roof = new THREE.Mesh(this.tracker.geo(new THREE.ConeGeometry(6.5, 3.1, 4)), roofMat);
      roof.position.y = bodyH + 1.5;
      roof.rotation.y = Math.PI / 4;
      const chimney = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.7, 1.8, 0.7)), roofMat);
      chimney.position.set(-h.side * 1.6, bodyH + 1.9, -1.8);

      // Dark doorway + door swung open on hinges
      const doorway = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.18, 2.3, 1.35)), darkVoidMat);
      doorway.position.set(h.side * 4.02, 1.15, 0);
      const openDoor = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.1, 2.25, 1.25)), woodMat);
      openDoor.position.set(h.side * 4.55, 1.15, 0.95);
      openDoor.rotation.y = h.side * 0.95;

      // Windows with crooked boards
      for (const wz of [-2.4, 2.4]) {
        const win = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.15, 1.1, 1.1)), darkVoidMat);
        win.position.set(h.side * 4.02, 2.7, wz);
        const plank = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.2, 0.16, 1.35)), boardMat);
        plank.position.set(h.side * 4.08, 2.7, wz);
        plank.rotation.x = 0.24;
        g.add(win, plank);
      }

      if (h.hasPorch) {
        const porchDeck = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.7, 0.18, 5.8)), woodMat);
        porchDeck.position.set(h.side * 4.8, 0.09, 0);
        const awning = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.9, 0.14, 6.0)), roofMat);
        awning.position.set(h.side * 4.85, 3.0, 0);
        awning.rotation.z = -h.side * 0.22;
        g.add(porchDeck, awning);
      }

      // Fallen porch chair & scattered table beside door
      const chair = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.65, 0.65, 0.65)), woodMat);
      chair.position.set(h.side * 4.9, 0.3, -1.8);
      chair.rotation.set(0.7, 0.4, 1.2);

      g.add(body, roof, chimney, doorway, openDoor, chair);
      g.position.set(h.x, 0, h.z);
      this.root.add(g);
    }

    // Wooden yard fences flanking houses cleanly outside central walking lane
    const fencePostGeo = this.tracker.geo(new THREE.BoxGeometry(0.16, 1.15, 0.16));
    const fenceRailGeo = this.tracker.geo(new THREE.BoxGeometry(0.08, 0.12, 8.2));
    for (const fz of [-19, -39, -59]) {
      for (const side of [-1, 1]) {
        const fx = side * 8.4;
        const rail1 = new THREE.Mesh(fenceRailGeo, woodMat);
        rail1.position.set(fx, 0.88, fz);
        const rail2 = new THREE.Mesh(fenceRailGeo, woodMat);
        rail2.position.set(fx, 0.45, fz);
        this.root.add(rail1, rail2);
        for (let pz = fz - 3.6; pz <= fz + 3.6; pz += 1.8) {
          const post = new THREE.Mesh(fencePostGeo, woodMat);
          post.position.set(fx, 0.58, pz);
          this.root.add(post);
        }
      }
    }

    // Abandoned Roadside Food Stall (z = -21.5) with unfinished meal plates & overturned stools
    const stallAwningMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.85 }));
    const plateMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.4 }));
    const stallGroup = new THREE.Group();
    stallGroup.position.set(-6.1, 0, -21.5);
    const counter = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.5, 0.95, 3.6)), woodMat);
    counter.position.set(0, 0.475, 0);
    const stallRoof = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(2.1, 0.14, 3.9)), stallAwningMat);
    stallRoof.position.set(0.15, 2.55, 0);
    stallRoof.rotation.z = -0.18;
    const stallTable = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.1, 0.72, 1.1)), woodMat);
    stallTable.position.set(1.55, 0.36, 0.5);
    const plate1 = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(0.18, 0.15, 0.04, 8)), plateMat);
    plate1.position.set(1.5, 0.74, 0.35);
    const cup = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(0.06, 0.05, 0.14, 7)), plateMat);
    cup.position.set(1.68, 0.79, 0.65);
    stallGroup.add(counter, stallRoof, stallTable, plate1, cup);
    this.root.add(stallGroup);

    // Evacuation notice signs
    const signTex = makeCanvasTex(
      this.tracker,
      256,
      128,
      (ctx) => {
        ctx.fillStyle = '#d97706';
        ctx.fillRect(0, 0, 256, 128);
        ctx.fillStyle = '#111827';
        ctx.fillRect(10, 10, 236, 108);
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('EVACUATION ORDER', 128, 54);
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 17px monospace';
        ctx.fillText('SECTOR 01 · QUARANTINED', 128, 86);
      },
      maxAniso
    );
    const signMat = this.tracker.mat(new THREE.MeshBasicMaterial({ map: signTex }));
    const poleMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.65, roughness: 0.45 }));
    for (const sp of [
      { x: -6.8, z: -13.5, ry: 0.35 },
      { x: 6.8, z: -43.0, ry: -0.35 },
    ]) {
      const post = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(0.08, 0.08, 2.7, 6)), poleMat);
      post.position.set(sp.x, 1.35, sp.z);
      const board = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(2.1, 1.05, 0.08)), signMat);
      board.position.set(sp.x, 2.2, sp.z);
      board.rotation.y = sp.ry;
      this.root.add(post, board);
    }

    // Abandoned Suitcases, Children's Toys & Toppled Bicycles left behind during evacuation
    const bagMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x5a3e2b, roughness: 0.85 }));
    const toyMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.7 }));
    const bikeMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.5, roughness: 0.45 }));
    for (const l of [
      { x: -4.2, z: -9.0, r: 0.5 },
      { x: 4.8, z: -22.0, r: -0.4 },
      { x: -5.1, z: -38.5, r: 0.9 },
      { x: 3.9, z: -53.0, r: -0.7 },
    ]) {
      const suitcase = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.85, 0.48, 0.28)), bagMat);
      suitcase.position.set(l.x, 0.24, l.z);
      suitcase.rotation.set(0.3, l.r, 0.15);
      const toyBox = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.36, 0.36, 0.36)), toyMat);
      toyBox.position.set(l.x + 0.7, 0.18, l.z - 0.5);
      toyBox.rotation.y = l.r * 1.4;
      this.root.add(suitcase, toyBox);
    }

    // Toppled bicycles
    const wheelGeo = this.tracker.geo(new THREE.TorusGeometry(0.32, 0.045, 6, 12));
    for (const bk of [
      { x: 5.5, z: -12.0, ry: 0.6 },
      { x: -5.9, z: -45.5, ry: -0.8 },
    ]) {
      const bike = new THREE.Group();
      const w1 = new THREE.Mesh(wheelGeo, poleMat);
      w1.position.set(-0.48, 0.1, 0);
      w1.rotation.x = Math.PI / 2;
      const w2 = new THREE.Mesh(wheelGeo, poleMat);
      w2.position.set(0.48, 0.1, 0);
      w2.rotation.x = Math.PI / 2;
      const frame = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.95, 0.08, 0.36)), bikeMat);
      frame.position.set(0, 0.15, 0);
      bike.add(w1, w2, frame);
      bike.position.set(bk.x, 0, bk.z);
      bike.rotation.y = bk.ry;
      this.root.add(bike);
    }

    // Abandoned cars with doors flung open
    const carSpecs = [
      { x: -4.4, z: -26.5, r: 0.32, c: 0x3b483d },
      { x: 4.5, z: -41.5, r: -0.45, c: 0x4c3532 },
    ];
    for (const cs of carSpecs) {
      const car = new THREE.Group();
      const cMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: cs.c, roughness: 0.65, metalness: 0.35 }));
      const hull = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.9, 0.68, 4.1)), cMat);
      hull.position.y = 0.56;
      const cab = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.65, 0.55, 2.0)), cMat);
      cab.position.set(0, 1.15, -0.15);
      const openCarDoor = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.08, 0.62, 1.05)), cMat);
      openCarDoor.position.set(1.22, 0.68, 0.35);
      openCarDoor.rotation.y = -0.85;
      car.add(hull, cab, openCarDoor);
      car.position.set(cs.x, 0, cs.z);
      car.rotation.y = cs.r;
      this.root.add(car);
    }

    // Parked Abandoned Motorcycle (z = -34.5, side lane) + Rubble/Trash bags
    const motoGroup = new THREE.Group();
    const motoBodyMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.65 }));
    const mw1 = new THREE.Mesh(wheelGeo, poleMat);
    mw1.position.set(-0.55, 0.36, 0);
    const mw2 = new THREE.Mesh(wheelGeo, poleMat);
    mw2.position.set(0.55, 0.36, 0);
    const mFrame = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.15, 0.38, 0.32)), motoBodyMat);
    mFrame.position.set(0, 0.56, 0);
    motoGroup.add(mw1, mw2, mFrame);
    motoGroup.position.set(5.2, 0, -34.5);
    motoGroup.rotation.set(0.22, -0.55, 0.42);
    this.root.add(motoGroup);

    const trashMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x181b1f, roughness: 0.92 }));
    for (const tr of [
      { x: -6.3, z: -17.0, s: 0.42 },
      { x: 6.1, z: -29.0, s: 0.48 },
      { x: -6.2, z: -51.0, s: 0.45 },
    ]) {
      const bag = new THREE.Mesh(this.tracker.geo(new THREE.DodecahedronGeometry(tr.s, 0)), trashMat);
      bag.position.set(tr.x, tr.s * 0.65, tr.z);
      this.root.add(bag);
    }

    // Streetlights, Overhead Utility Poles & Hanging Power Wires + blood trails
    const wireMat = this.tracker.mat(new THREE.MeshBasicMaterial({ color: 0x111317 }));
    const lampMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0xffc875, emissive: 0xff9d3b, emissiveIntensity: 1.4 })
    );
    this.flickerMats.push(lampMat);
    for (const lp of [
      { x: -7.8, z: -15, dir: 1 },
      { x: 7.8, z: -34, dir: -1 },
      { x: -7.8, z: -55, dir: 1 },
    ]) {
      const post = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(0.1, 0.14, 5.4, 7)), poleMat);
      post.position.set(lp.x, 2.7, lp.z);
      const bulb = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.45, 0.16, 0.28)), lampMat);
      bulb.position.set(lp.x + lp.dir * 0.9, 5.3, lp.z);
      const spanWire = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(0.018, 0.018, 16, 4)), wireMat);
      spanWire.rotation.z = Math.PI / 2;
      spanWire.position.set(0, 6.25, lp.z);
      this.root.add(post, bulb, spanWire);

      const light = new THREE.PointLight(0xffaa55, 13, 24, 1.6);
      light.position.set(lp.x + lp.dir * 0.9, 5.0, lp.z);
      this.root.add(light);
      this.flickerLights.push({ light, base: 13, speed: 12 + Math.abs(lp.z) * 0.1 });
    }

    for (const bz of [-8, -16, -24, -33, -44, -56, -66]) {
      this.addBloodDecal(Math.sin(bz) * 2.2, bz, 2.4, bz * 0.4);
    }

    // VILLAGE IRON GATE AT z = -72
    const stoneMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x2e3136, roughness: 0.9 }));
    const ironMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x16181c, metalness: 0.78, roughness: 0.4 }));
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.6, 5.6, 1.6)), stoneMat);
      pillar.position.set(side * 4.8, 2.8, -72);
      const wall = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(18, 4.4, 1.1)), stoneMat);
      wall.position.set(side * 14.5, 2.2, -72);
      this.root.add(pillar, wall);
    }

    const buildGateLeaf = (hingeX: number, sign: number): THREE.Group => {
      const g = new THREE.Group();
      g.position.set(hingeX, 0, -72);
      const frame = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(4.0, 0.25, 0.2)), ironMat);
      frame.position.set(sign * 2.0, 3.6, 0);
      const botFrame = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(4.0, 0.25, 0.2)), ironMat);
      botFrame.position.set(sign * 2.0, 0.4, 0);
      g.add(frame, botFrame);
      for (let i = 0; i < 6; i++) {
        const bar = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(0.06, 0.06, 3.8, 6)), ironMat);
        bar.position.set(sign * (0.35 + i * 0.66), 1.9, 0);
        g.add(bar);
      }
      this.root.add(g);
      return g;
    };
    this.villageGateLeft = buildGateLeaf(-4.0, 1);
    this.villageGateRight = buildGateLeaf(4.0, -1);

    // STAGE 1 ENDING: Distant Creature Silhouette beyond the gate (z = -80)
    const creature = new THREE.Group();
    const silhouetteMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x120d0e, roughness: 0.9 }));
    const eyeGlowMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0xff1e2d, emissive: 0xdc2626, emissiveIntensity: 3.2 })
    );
    const cTorso = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.5, 2.1, 0.9)), silhouetteMat);
    cTorso.position.y = 2.2;
    const cArmL = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.48, 1.9, 0.48)), silhouetteMat);
    cArmL.position.set(-1.05, 2.0, 0.15);
    const cArmR = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.36, 1.6, 0.36)), silhouetteMat);
    cArmR.position.set(0.95, 1.9, 0.1);
    const cLegs = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.2, 1.3, 0.7)), silhouetteMat);
    cLegs.position.y = 0.65;
    const cHead = new THREE.Group();
    cHead.position.set(0, 3.55, 0.1);
    const cSkull = new THREE.Mesh(this.tracker.geo(new THREE.DodecahedronGeometry(0.45, 0)), silhouetteMat);
    const cEye1 = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.11, 0.08, 0.08)), eyeGlowMat);
    cEye1.position.set(-0.15, 0.06, 0.4);
    const cEye2 = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.11, 0.08, 0.08)), eyeGlowMat);
    cEye2.position.set(0.15, 0.04, 0.4);
    cHead.add(cSkull, cEye1, cEye2);
    creature.add(cLegs, cTorso, cArmL, cArmR, cHead);
    creature.position.set(0, 0, -80);
    creature.visible = false;
    this.root.add(creature);
    this.creatureGroup = creature;
    this.creatureHead = cHead;
  }

  // ==================== STAGE 2: CURSED FOREST (z = -90 .. -236) ====================
  private buildStage2CursedForest(maxAniso: number): void {
    const forestFloor = new THREE.Mesh(
      this.tracker.geo(new THREE.PlaneGeometry(90, 150)),
      this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x121712, roughness: 0.96 }))
    );
    forestFloor.rotation.x = -Math.PI / 2;
    forestFloor.position.set(0, -0.02, -163);
    this.root.add(forestFloor);

    const trailMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x201d18, roughness: 0.95 }));
    const trail = new THREE.Mesh(this.tracker.geo(new THREE.PlaneGeometry(8.5, 148)), trailMat);
    trail.rotation.x = -Math.PI / 2;
    trail.position.set(0, 0.008, -163);
    this.root.add(trail);

    // Remodeled mossy forest boulders & fallen dead logs flanking the misty trail
    const rockMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x2b302c, roughness: 0.92 }));
    const rockGeo = this.tracker.geo(new THREE.DodecahedronGeometry(1.15, 0));
    for (const [rx, rz, rs] of [
      [-5.6, -102, 1.2],
      [5.8, -128, 1.45],
      [-6.1, -148, 1.1],
      [6.2, -174, 1.35],
      [-5.5, -192, 1.25],
      [5.9, -212, 1.4],
    ]) {
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(rx, rs * 0.45, rz);
      rock.scale.set(rs * 1.2, rs * 0.75, rs);
      rock.rotation.y = rz * 0.3;
      this.root.add(rock);
    }

    // Dead Twisted Trees along both sides of the misty forest road
    const barkMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x231d19, roughness: 0.95 }));
    const branchGeo = this.tracker.geo(new THREE.CylinderGeometry(0.12, 0.22, 3.8, 5));
    const trunkGeo = this.tracker.geo(new THREE.CylinderGeometry(0.32, 0.56, 8.8, 6));

    // Dedicated thick cover tree just past the village gate (x = -4.2, z = -96.5) for the Creature to peek from
    const peekTree = new THREE.Group();
    const peekTrunk = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(0.48, 0.72, 9.2, 7)), barkMat);
    peekTrunk.position.y = 4.6;
    const peekBr = new THREE.Mesh(branchGeo, barkMat);
    peekBr.position.set(1.15, 5.8, 0.2);
    peekBr.rotation.z = -0.78;
    peekTree.add(peekTrunk, peekBr);
    peekTree.position.set(-4.2, 0, -96.5);
    this.root.add(peekTree);

    for (let z = -92; z >= -222; z -= 8.5) {
      for (const side of [-1, 1]) {
        const tree = new THREE.Group();
        const xOff = side * (6.2 + ((Math.abs(z) * 13) % 7));
        const trunk = new THREE.Mesh(trunkGeo, barkMat);
        trunk.position.y = 4.2;
        trunk.rotation.z = side * (0.06 + (Math.abs(z) % 3) * 0.04);
        const br1 = new THREE.Mesh(branchGeo, barkMat);
        br1.position.set(-side * 1.1, 6.2, 0);
        br1.rotation.z = side * 0.85;
        const br2 = new THREE.Mesh(branchGeo, barkMat);
        br2.position.set(side * 0.9, 5.2, 0.6);
        br2.rotation.z = -side * 0.72;
        tree.add(trunk, br1, br2);
        tree.position.set(xOff, 0, z);
        this.root.add(tree);

        if (Math.abs(z) % 17 === 0) {
          this.addBloodDecal(xOff - side * 1.4, z, 2.2, z);
        }
      }
    }

    // Hanging Swaying Corpse Silhouettes (non-enemy atmospheric props)
    const ropeMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x4b4032, roughness: 0.9 }));
    const corpseMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x2a2422, roughness: 0.88 }));
    for (const hc of [
      { x: -4.8, z: -108, phase: 0.2, amp: 0.08 },
      { x: 5.1, z: -136, phase: 1.9, amp: 0.11 },
      { x: -4.9, z: -178, phase: 3.1, amp: 0.09 },
      { x: 5.2, z: -206, phase: 4.4, amp: 0.1 },
    ]) {
      const g = new THREE.Group();
      g.position.set(hc.x, 6.8, hc.z);
      const rope = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 5)), ropeMat);
      rope.position.y = -1.1;
      const body = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.46, 0.85, 0.28)), corpseMat);
      body.position.y = -2.6;
      const head = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.26, 0.28, 0.26)), corpseMat);
      head.position.set(0.05, -2.06, 0.08);
      head.rotation.set(0.45, 0.2, 0.25);
      const legs = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.36, 0.88, 0.22)), corpseMat);
      legs.position.y = -3.45;
      g.add(rope, body, head, legs);
      this.root.add(g);
      this.hangingCorpses.push({ group: g, phase: hc.phase, amp: hc.amp });
    }

    // Forest Outpost Camp at z = -116 (Lore forest_01..02)
    const tentMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x3f4739, roughness: 0.9 }));
    const crateMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x4b3f30, roughness: 0.86 }));
    const paperMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xd97706, emissiveIntensity: 0.45 })
    );
    const outpostDesk = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(2.2, 0.85, 1.1)), crateMat);
    outpostDesk.position.set(-4.1, 0.425, -116);
    const tent = new THREE.Mesh(this.tracker.geo(new THREE.ConeGeometry(2.8, 2.4, 4)), tentMat);
    tent.position.set(-6.4, 1.2, -116.8);
    tent.rotation.y = Math.PI / 4;
    const note1 = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.42, 0.04, 0.56)), paperMat);
    note1.position.set(-3.9, 0.88, -115.9);
    const outpostLight = new THREE.PointLight(0xf59e0b, 12, 16, 1.6);
    outpostLight.position.set(-3.8, 2.1, -116);
    this.root.add(outpostDesk, tent, note1, outpostLight);

    // Abandoned Forest Laboratory at z = -158 (Lore forest_03..04) + Field Containment Tubes with Human Subjects
    const labMetal = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x2f373d, roughness: 0.68, metalness: 0.45 }));
    const labScreenMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 1.65 })
    );
    const labCabin = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(5.2, 3.8, 7.6)), labMetal);
    labCabin.position.set(-7.9, 1.9, -158);
    const fieldTable = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(2.4, 0.85, 1.1)), labMetal);
    fieldTable.position.set(-3.8, 0.425, -158);
    const fieldMonitor = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.75, 0.48, 0.1)), labScreenMat);
    fieldMonitor.position.set(-4.35, 1.1, -158.15);
    fieldMonitor.rotation.y = 0.45;
    const note2 = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.45, 0.04, 0.58)), paperMat);
    note2.position.set(-3.55, 0.88, -157.8);

    // 2 intact Field Containment Tubes housing suspended Human Test Subjects beside Forest Lab
    for (let ti = 0; ti < 2; ti++) {
      const fTube = buildContainmentTube(this.tracker, {
        x: ti === 0 ? -5.1 : 5.3,
        z: ti === 0 ? -154.6 : -159.4,
        rotY: ti === 0 ? 0.45 : -0.5,
        poseVariant: (ti as 0 | 1),
        fluidColor: 0x10b981,
        warningColor: 0x38bdf8,
        scale: 0.92,
        labelSeed: 10 + ti,
      });
      this.root.add(fTube.group);
      this.containmentTubes.push(fTube);
    }

    // Portable medical exam gurney & generator crate across from lab
    const gurneyBed = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.15, 0.72, 2.2)), labMetal);
    gurneyBed.position.set(4.8, 0.36, -155.8);
    gurneyBed.rotation.y = -0.22;

    const labBeacon = new THREE.PointLight(0x38bdf8, 13, 20, 1.6);
    labBeacon.position.set(-3.9, 2.6, -157.5);
    this.root.add(labCabin, fieldTable, fieldMonitor, note2, gurneyBed, labBeacon);

    // Giant Creature Footprints leading from z = -196 toward Bunker z = -222
    const printMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({
        color: 0x7f1d1d,
        emissive: 0x450a0a,
        emissiveIntensity: 0.85,
        roughness: 0.4,
      })
    );
    for (let i = 0; i < 6; i++) {
      const fz = -196 - i * 4.4;
      const fx = i % 2 === 0 ? -0.9 : 0.9;
      const print = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.95, 0.04, 1.45)), printMat);
      print.position.set(fx, 0.025, fz);
      print.rotation.y = i % 2 === 0 ? 0.08 : -0.08;
      this.root.add(print);
    }

    // Falling forest leaves particle layer
    const leafCount = 120;
    const lPos = new Float32Array(leafCount * 3);
    const lBaseY = new Float32Array(leafCount);
    for (let i = 0; i < leafCount; i++) {
      lPos[i * 3] = (Math.random() - 0.5) * 22;
      const y = 0.5 + Math.random() * 6.5;
      lPos[i * 3 + 1] = y;
      lBaseY[i] = y;
      lPos[i * 3 + 2] = -92 - Math.random() * 130;
    }
    const lGeo = this.tracker.geo(new THREE.BufferGeometry());
    lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
    const lMat = this.tracker.mat(
      new THREE.PointsMaterial({ color: 0x847858, size: 0.16, transparent: true, opacity: 0.65 })
    );
    const lPts = new THREE.Points(lGeo, lMat);
    this.root.add(lPts);
    this.leavesPoints = lPts;
    this.leavesBaseY = lBaseY;

    // UNDERGROUND BUNKER BLAST GATE AT z = -224
    const concreteMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x32363a, roughness: 0.9 }));
    const bunkerFrame = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(28, 8.5, 2.2)), concreteMat);
    bunkerFrame.position.set(0, 6.8, -224);
    const bunkerL = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(10, 6, 2.2)), concreteMat);
    bunkerL.position.set(-8.5, 3, -224);
    const bunkerR = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(10, 6, 2.2)), concreteMat);
    bunkerR.position.set(8.5, 3, -224);
    this.root.add(bunkerFrame, bunkerL, bunkerR);

    const blastDoorTex = makeCanvasTex(
      this.tracker,
      256,
      256,
      (ctx) => {
        ctx.fillStyle = '#262b30';
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = '#d97706';
        ctx.fillRect(0, 210, 256, 34);
        ctx.fillStyle = '#111827';
        for (let x = -30; x < 280; x += 36) {
          ctx.fillRect(x, 210, 16, 34);
        }
      },
      maxAniso
    );
    const blastMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ map: blastDoorTex, metalness: 0.72, roughness: 0.42 })
    );
    this.bunkerDoorLeft = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(3.6, 5.4, 0.55)), blastMat);
    this.bunkerDoorLeft.position.set(-1.8, 2.7, -224);
    this.bunkerDoorRight = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(3.6, 5.4, 0.55)), blastMat);
    this.bunkerDoorRight.position.set(1.8, 2.7, -224);
    this.root.add(this.bunkerDoorLeft, this.bunkerDoorRight);
  }

  // ==================== STAGE 3: UNDERGROUND FACILITY WINGS A-E (z = -236 .. -386) ====================
  private buildStage3UndergroundFacility(maxAniso: number): void {
    const tileTex = makeCanvasTex(
      this.tracker,
      256,
      256,
      (ctx) => {
        ctx.fillStyle = '#182428';
        ctx.fillRect(0, 0, 256, 256);
        ctx.strokeStyle = '#0e171a';
        ctx.lineWidth = 4;
        for (let i = 0; i <= 256; i += 64) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, 256);
          ctx.moveTo(0, i);
          ctx.lineTo(256, i);
          ctx.stroke();
        }
      },
      maxAniso,
      4,
      28
    );

    const floor = new THREE.Mesh(
      this.tracker.geo(new THREE.PlaneGeometry(24, 155.4)),
      this.tracker.mat(new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.48, metalness: 0.28 }))
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -302.7);
    this.root.add(floor);

    const ceiling = new THREE.Mesh(
      this.tracker.geo(new THREE.PlaneGeometry(24, 155.4)),
      this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x101619, roughness: 0.85, side: THREE.DoubleSide }))
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 6.2, -302.7);
    this.root.add(ceiling);

    const wallMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.55, metalness: 0.38 }));
    const wallGeo = this.tracker.geo(new THREE.BoxGeometry(1.4, 6.4, 158));
    const lWall = new THREE.Mesh(wallGeo, wallMat);
    lWall.position.set(-10.5, 3.2, -306);
    const rWallBeforeLift = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(1.4, 6.4, 4.7)),
      wallMat
    );
    rWallBeforeLift.position.set(10.5, 3.2, -382.65);
    const rWallAfterLift = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(1.4, 6.4, 152.4)),
      wallMat
    );
    rWallAfterLift.position.set(10.5, 3.2, -303.2);
    this.root.add(lWall, rWallBeforeLift, rWallAfterLift);

    // Ceiling Steel Ribs + Emergency Red Beacons along Wings A–E
    const ribMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x1b2226, metalness: 0.65, roughness: 0.45 }));
    for (let z = -232; z >= -376; z -= 12) {
      const rib = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(20, 0.55, 0.55)), ribMat);
      rib.position.set(0, 5.9, z);
      this.root.add(rib);

      const beaconMat = this.tracker.mat(
        new THREE.MeshStandardMaterial({ color: 0x14b8a6, emissive: 0x0d9488, emissiveIntensity: 1.5 })
      );
      const bulb = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.4, 0.14, 0.24)), beaconMat);
      bulb.position.set(0, 5.58, z);
      this.root.add(bulb);
      this.facilityAlarmBeacons.push(beaconMat);

      if (Math.abs(z) % 24 === 4) {
        const pt = new THREE.PointLight(0x5eead4, 14, 24, 1.5);
        pt.position.set(0, 4.9, z);
        this.root.add(pt);
        this.facilityAlarmLights.push(pt);
      }
    }

    // Wing B (Research Corridor, z = -264) & Wing D (Storage, z = -332) Lore Terminals
    const deskMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.5 }));
    const screenMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x06b6d4, emissiveIntensity: 1.7 })
    );
    for (const tz of [-264, -298, -332, -362]) {
      const consoleBox = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.8, 1.05, 0.9)), deskMat);
      consoleBox.position.set(-4.2, 0.525, tz);
      const scr = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.9, 0.6, 0.12)), screenMat);
      scr.position.set(-4.2, 1.32, tz + 0.15);
      scr.rotation.y = 0.35;
      this.root.add(consoleBox, scr);
    }

    // Wing C Experiment Lab Bio-Tubes (z = -288 .. -314): ALL non-shattered tubes populated with Human Test Subjects!
    const glassMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({
        color: 0x34d399,
        emissive: 0x10b981,
        emissiveIntensity: 1.4,
        transparent: true,
        opacity: 0.72,
      })
    );
    let tubeIdx = 0;
    for (let z = -290; z >= -312; z -= 7) {
      for (const sx of [-7.2, 7.2]) {
        const isShattered = z === -297 && sx < 0;
        const tubeHandle = buildContainmentTube(this.tracker, {
          x: sx,
          z,
          rotY: sx < 0 ? Math.PI * 0.45 : -Math.PI * 0.45,
          poseVariant: (tubeIdx % 3) as 0 | 1 | 2,
          fluidColor: tubeIdx % 2 === 0 ? 0x10b981 : 0x0ea5e9,
          warningColor: isShattered ? 0xef4444 : 0x22d3ee,
          shattered: isShattered,
          labelSeed: tubeIdx,
        });
        this.root.add(tubeHandle.group);
        this.containmentTubes.push(tubeHandle);
        if (isShattered) {
          this.addBloodDecal(sx + 1.5, z, 3.2, 0.5);
        }
        tubeIdx++;
      }
    }

    // Lab Workstations, Medical Beds, Observation Window Frames & Hanging Ceiling Cables (wings B–D)
    const bedSheetMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.85 }));
    const cableMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 }));
    for (const wz of [-258, -280, -322, -346]) {
      const side = wz % 16 === 0 ? 6.8 : -6.8;
      const bed = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.1, 0.65, 2.2)), deskMat);
      bed.position.set(side, 0.325, wz);
      const mattress = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.95, 0.14, 2.0)), bedSheetMat);
      mattress.position.set(side, 0.72, wz);
      const cart = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.7, 0.85, 0.55)), deskMat);
      cart.position.set(side + (side > 0 ? -1.1 : 1.1), 0.425, wz + 0.8);
      this.root.add(bed, mattress, cart);
    }
    for (const cz of [-268, -294, -318, -352]) {
      const hangCable = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 5)), cableMat);
      hangCable.position.set(cz % 8 === 0 ? -5.6 : 5.6, 4.9, cz);
      hangCable.rotation.z = 0.22;
      this.root.add(hangCable);
    }

    // Wing E: SUBJECT ALPHA CHAMBER (z = -362 .. -372) — Giant Shattered Containment Tank + King Silhouette
    const giantCapB = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(2.6, 2.8, 0.65, 14)), deskMat);
    giantCapB.position.set(4.8, 0.325, -364);
    const giantCapT = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(2.6, 2.8, 0.65, 14)), deskMat);
    giantCapT.position.set(4.8, 5.2, -364);
    const brokenGlass = new THREE.Mesh(this.tracker.geo(new THREE.CylinderGeometry(2.35, 2.35, 1.3, 12, 1, true)), glassMat);
    brokenGlass.position.set(4.8, 1.25, -364);
    this.root.add(giantCapB, giantCapT, brokenGlass);
    this.addBloodDecal(2.6, -364, 4.4, 0.9);
    this.addBloodDecal(0.8, -370, 3.6, -0.3);

    // Paired Wing E freight elevator bay, aligned with the player lift at the corridor end.
    const freightGroup = new THREE.Group();
    freightGroup.position.set(6.8, 0, -382.3);
    this.root.add(freightGroup);

    const cageMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x26292e, metalness: 0.8, roughness: 0.36 }));
    const frameSteelMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.72, roughness: 0.4 }));
    const kWarnMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xd97706, emissiveIntensity: 1.6 }));
    this.kingElevBeaconMat = kWarnMat;

    // Freight lift bay frame
    const fPostL = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.4, 5.8, 0.65)), frameSteelMat);
    fPostL.position.set(-2.65, 2.9, 3.05);
    const fPostR = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.4, 5.8, 0.65)), frameSteelMat);
    fPostR.position.set(2.65, 2.9, 3.05);
    const fHeader = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(5.5, 0.8, 0.75)), frameSteelMat);
    fHeader.position.set(0, 5.55, 3.05);
    const fBeacon = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.1, 0.22, 0.25)), kWarnMat);
    fBeacon.position.set(0, 5.55, 3.48);
    freightGroup.add(fPostL, fPostR, fHeader, fBeacon);

    const doorPocket = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(0.1, 5.3, 0.86)),
      this.tracker.mat(
        new THREE.MeshStandardMaterial({ color: 0x090d10, metalness: 0.28, roughness: 0.72 })
      )
    );
    doorPocket.position.set(4.35, 2.55, 2.46);
    freightGroup.add(doorPocket);

    // Heavy lift guide rails and overhead hoist housing.
    const guideRailMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.88, roughness: 0.28 })
    );
    for (const x of [-2.85, 2.85]) {
      const guide = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.24, 16, 0.3)), guideRailMat);
      guide.position.set(x, -3.2, -0.55);
      const clamp = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.48, 0.34, 0.6)), frameSteelMat);
      clamp.position.set(x, 4.35, -0.55);
      freightGroup.add(guide, clamp);
    }
    const hoist = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(5.5, 0.48, 1.0)), cageMat);
    hoist.position.set(0, 5.05, -0.2);
    freightGroup.add(hoist);

    // Freight sliding hazard doors.
    const kDoorMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.76, roughness: 0.38 }));
    this.kingElevDoorLeft = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(2.15, 5.0, 0.24)), kDoorMat);
    this.kingElevDoorLeft.position.set(-1.08, 2.45, 2.46);
    this.kingElevDoorRight = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(2.15, 5.0, 0.24)), kDoorMat);
    this.kingElevDoorRight.position.set(1.08, 2.45, 2.46);
    freightGroup.add(this.kingElevDoorLeft, this.kingElevDoorRight);

    // Moving freight lift cabin, sized for the King and aligned to the shared lift bank.
    const kPlatform = new THREE.Group();
    const kpFloor = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(5.2, 0.3, 6.2)), cageMat);
    kpFloor.position.set(0, -0.15, 0);
    const kpRoof = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(5.2, 0.3, 6.2)), cageMat);
    kpRoof.position.set(0, 5.0, 0);
    const kpBack = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(5.2, 5.0, 0.25)), cageMat);
    kpBack.position.set(0, 2.42, -3.0);
    const kpSideL = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.25, 5.0, 6.2)), cageMat);
    kpSideL.position.set(-2.48, 2.42, 0);
    const kpSideR = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.25, 5.0, 6.2)), cageMat);
    kpSideR.position.set(2.48, 2.42, 0);
    const kpLight = new THREE.PointLight(0xfbbf24, 18, 15, 1.4);
    kpLight.position.set(0, 4.55, -0.25);
    const kpControl = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.18, 1.1, 0.12)), kWarnMat);
    kpControl.position.set(-2.25, 1.8, 1.5);
    const kpFloorStrip = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(5.2, 0.035, 0.12)),
      kWarnMat
    );
    kpFloorStrip.position.set(0, 0.0175, 2.5);
    kPlatform.add(kpFloor, kpRoof, kpBack, kpSideL, kpSideR, kpLight, kpControl, kpFloorStrip);
    freightGroup.add(kPlatform);
    this.kingElevPlatform = kPlatform;
    this.kingElevLight = kpLight;

    // Articulated Heavy King Boss Mesh (Scale matches Wing E Freight Bay with zero wall/door clipping)
    const kingGroup = new THREE.Group();
    const kFleshMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x2a1d1f, roughness: 0.85 }));
    const kMuscleMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x6b1d1d, roughness: 0.42 }));
    const kBoneMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0xc2b29b, roughness: 0.55 }));
    const kSteelMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.35 }));
    const kEyeMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0xff1e2d, emissive: 0xdc2626, emissiveIntensity: 3.0 })
    );

    const kLeftLeg = new THREE.Group();
    kLeftLeg.position.set(-0.42, 1.35, 0);
    const klThigh = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.48, 0.72, 0.48)), kFleshMat);
    klThigh.position.y = -0.34;
    const klShin = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.52, 0.68, 0.54)), kSteelMat);
    klShin.position.y = -0.96;
    kLeftLeg.add(klThigh, klShin);

    const kRightLeg = new THREE.Group();
    kRightLeg.position.set(0.42, 1.35, 0);
    const krThigh = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.44, 0.72, 0.44)), kMuscleMat);
    krThigh.position.y = -0.34;
    const krShin = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.4, 0.68, 0.42)), kFleshMat);
    krShin.position.y = -0.96;
    kRightLeg.add(krThigh, krShin);

    const kTorso = new THREE.Group();
    kTorso.position.set(0, 1.4, 0);
    const kHull = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(1.48, 1.18, 0.86)), kFleshMat);
    kHull.position.set(-0.04, 0.62, 0);
    kHull.rotation.z = 0.08;
    const kTumor = new THREE.Mesh(this.tracker.geo(new THREE.DodecahedronGeometry(0.46, 0)), kMuscleMat);
    kTumor.position.set(-0.62, 1.12, -0.02);
    const kPauldron = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.52, 0.36, 0.68)), kSteelMat);
    kPauldron.position.set(0.65, 1.02, 0);
    for (let s = 0; s < 3; s++) {
      const sp = new THREE.Mesh(this.tracker.geo(new THREE.ConeGeometry(0.12, 0.52, 5)), kBoneMat);
      sp.position.set(s % 2 === 0 ? -0.1 : 0.1, 1.08 - s * 0.25, -0.44);
      sp.rotation.x = -0.9;
      kTorso.add(sp);
    }

    const kHead = new THREE.Mesh(this.tracker.geo(new THREE.DodecahedronGeometry(0.38, 0)), kFleshMat);
    kHead.position.set(0.03, 1.48, 0.18);
    const kHorn = new THREE.Mesh(this.tracker.geo(new THREE.ConeGeometry(0.1, 0.44, 5)), kBoneMat);
    kHorn.position.set(0.22, 1.76, 0.15);
    kHorn.rotation.z = -0.35;
    const kEyeL = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.12, 0.08, 0.08)), kEyeMat);
    kEyeL.position.set(-0.11, 1.52, 0.52);
    const kEyeR = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.12, 0.08, 0.08)), kEyeMat);
    kEyeR.position.set(0.16, 1.5, 0.52);

    const kLeftArm = new THREE.Group();
    kLeftArm.position.set(-0.88, 1.04, 0.04);
    const klArm = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.44, 0.84, 0.44)), kMuscleMat);
    klArm.position.y = -0.38;
    const klClaw = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.48, 0.86, 0.48)), kFleshMat);
    klClaw.position.set(0, -1.04, 0.16);
    klClaw.rotation.x = -0.42;
    for (let t = -1; t <= 1; t++) {
      const talon = new THREE.Mesh(this.tracker.geo(new THREE.ConeGeometry(0.06, 0.46, 4)), kBoneMat);
      talon.position.set(t * 0.12, -1.52, 0.34);
      talon.rotation.x = Math.PI + 0.38;
      kLeftArm.add(talon);
    }
    kLeftArm.add(klArm, klClaw);

    const kRightArm = new THREE.Group();
    kRightArm.position.set(0.82, 0.94, 0);
    const krArm = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.24, 0.72, 0.24)), kFleshMat);
    krArm.position.y = -0.34;
    const krSpike = new THREE.Mesh(this.tracker.geo(new THREE.ConeGeometry(0.08, 0.44, 4)), kBoneMat);
    krSpike.position.set(0.04, -0.82, 0.16);
    krSpike.rotation.x = Math.PI + 0.42;
    kRightArm.add(krArm, krSpike);

    kTorso.add(kHull, kTumor, kPauldron, kHead, kHorn, kEyeL, kEyeR, kLeftArm, kRightArm);
    kingGroup.add(kLeftLeg, kRightLeg, kTorso);
    kingGroup.position.set(4.1, 0, -366.0);
    kingGroup.visible = false;
    this.root.add(kingGroup);

    this.alphaKingGroup = kingGroup;
    this.kingLeftLegPivot = kLeftLeg;
    this.kingRightLegPivot = kRightLeg;
    this.kingTorsoPivot = kTorso;
    this.kingLeftArmPivot = kLeftArm;
    this.kingRightArmPivot = kRightArm;

    // INDUSTRIAL ELEVATOR CHAMBER (z = -380 .. -388) — Grouped physically for smooth descent
    const playerCage = new THREE.Group();
    const elevFloor = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(7.2, 0.3, 7.2)), cageMat);
    elevFloor.position.set(0, -0.15, -384);
    const elevRoof = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(7.2, 0.3, 7.2)), cageMat);
    elevRoof.position.set(0, 4.4, -384);
    const elevBackGlassMat = this.tracker.mat(
      new THREE.MeshPhysicalMaterial({
        color: 0x9fc3ca,
        metalness: 0.12,
        roughness: 0.16,
        transparent: true,
        opacity: 0.24,
        transmission: 0.72,
        thickness: 0.08,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const elevBackGlass = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(5.8, 3.35, 0.1)),
      elevBackGlassMat
    );
    elevBackGlass.position.set(0, 2.2, -387.48);
    const elevBackFrameL = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(0.55, 4.5, 0.3)),
      frameSteelMat
    );
    elevBackFrameL.position.set(-3.325, 2.15, -387.5);
    const elevBackFrameR = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(0.55, 4.5, 0.3)),
      frameSteelMat
    );
    elevBackFrameR.position.set(3.325, 2.15, -387.5);
    const elevBackTop = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(6.6, 0.58, 0.3)),
      cageMat
    );
    elevBackTop.position.set(0, 4.15, -387.5);
    const elevBackBottom = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(6.6, 0.52, 0.3)),
      cageMat
    );
    elevBackBottom.position.set(0, 0.26, -387.5);
    const elevL = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.3, 4.5, 7.2)), cageMat);
    elevL.position.set(-3.55, 2.15, -384);
    const elevR = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.3, 4.5, 7.2)), cageMat);
    elevR.position.set(3.55, 2.15, -384);
    const elevControl = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(0.16, 1.0, 0.12)),
      frameSteelMat
    );
    elevControl.position.set(3.25, 1.85, -382.2);
    const elevCeilingLampMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({
        color: 0xfef08a,
        emissive: 0xfde68a,
        emissiveIntensity: 1.8,
      })
    );
    const elevCeilingLight = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(2.4, 0.08, 0.32)),
      elevCeilingLampMat
    );
    elevCeilingLight.position.set(0, 4.22, -383.0);
    const elevFloorStripMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.42, roughness: 0.48 })
    );
    const elevFloorStrip = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(6.0, 0.035, 0.12)),
      elevFloorStripMat
    );
    elevFloorStrip.position.set(0, 0.0175, -381.1);
    const cageLight = new THREE.PointLight(0xfef08a, 15, 13, 1.4);
    cageLight.position.set(0, 3.9, -384);
    const emergencyLight = new THREE.PointLight(0xef4444, 0, 8, 1.8);
    emergencyLight.position.set(3.05, 3.2, -382.2);
    const sparkPositions = new Float32Array(18);
    const sparkGeometry = this.tracker.geo(new THREE.BufferGeometry());
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    const sparkMaterial = this.tracker.mat(
      new THREE.PointsMaterial({
        color: 0xfff1a8,
        size: 0.12,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    const sparkPoints = new THREE.Points(sparkGeometry, sparkMaterial);
    sparkPoints.position.set(3.05, 1.9, -382.18);
    sparkPoints.visible = false;
    playerCage.add(
      elevFloor,
      elevRoof,
      elevBackGlass,
      elevBackFrameL,
      elevBackFrameR,
      elevBackTop,
      elevBackBottom,
      elevL,
      elevR,
      elevControl,
      elevCeilingLight,
      elevFloorStrip,
      cageLight,
      emergencyLight,
      sparkPoints
    );
    this.root.add(playerCage);
    this.playerElevatorCage = playerCage;
    this.elevatorInteriorLight = cageLight;
    this.elevatorEmergencyLight = emergencyLight;
    this.elevatorCeilingLamp = elevCeilingLampMat;
    this.elevatorSparkPoints = sparkPoints;

    // Exterior Elevator Portal Frame & Sliding Doors at z = -380.4
    const portalL = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.55, 4.8, 0.6)), frameSteelMat);
    portalL.position.set(-3.65, 2.4, -380.4);
    const portalR = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.55, 4.8, 0.6)), frameSteelMat);
    portalR.position.set(3.65, 2.4, -380.4);
    const portalTop = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(8.0, 0.65, 0.7)), frameSteelMat);
    portalTop.position.set(0, 4.55, -380.4);
    this.root.add(portalL, portalR, portalTop);

    const elevDoorMat = this.tracker.mat(
      new THREE.MeshPhysicalMaterial({
        color: 0x9fc3ca,
        metalness: 0.16,
        roughness: 0.14,
        transparent: true,
        opacity: 0.26,
        transmission: 0.74,
        thickness: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.elevatorDoorLeft = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(3.4, 4.2, 0.22)), elevDoorMat);
    this.elevatorDoorLeft.position.set(-1.7, 2.1, -380.52);
    this.elevatorDoorRight = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(3.4, 4.2, 0.22)), elevDoorMat);
    this.elevatorDoorRight.position.set(1.7, 2.1, -380.52);
    playerCage.add(this.elevatorDoorLeft, this.elevatorDoorRight);

    // Scrolling Shaft Structural Ribs visible behind rear glass (-388.4) so entrance doorway is 100% clear
    const shaftGroup = new THREE.Group();
    const shaftMat = this.tracker.mat(new THREE.MeshStandardMaterial({ color: 0x1c1e24, metalness: 0.6, roughness: 0.5 }));
    const warnMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 1.8 })
    );
    for (let i = 0; i < 6; i++) {
      const y = -6 + i * 4;
      const beam = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(9.6, 0.45, 0.45)), shaftMat);
      beam.position.set(0, y, -388.4);
      const lamp = new THREE.Mesh(this.tracker.geo(new THREE.BoxGeometry(0.65, 0.28, 0.28)), warnMat);
      lamp.position.set(i % 2 === 0 ? -3.1 : 3.1, y + 0.5, -388.25);
      shaftGroup.add(beam, lamp);
    }
    this.root.add(shaftGroup);
    this.elevatorShaftRibs = shaftGroup;

    this.buildElevatorShaftDisplays();
  }

  private buildElevatorShaftDisplays(): void {
    const tubeSpecs = [
      { x: -4.8, z: -393, pose: 0, fluid: 0x10b981, scale: 0.88 },
      { x: 4.8, z: -393, pose: 1, fluid: 0x0ea5e9, scale: 0.92 },
      { x: -3.4, z: -402, pose: 2, fluid: 0x22c55e, scale: 1.0 },
      { x: 3.6, z: -410, pose: 0, fluid: 0x0ea5e9, scale: 1.05 },
    ] as const;
    for (const spec of tubeSpecs) {
      const tube = buildContainmentTube(this.tracker, {
        x: spec.x,
        z: spec.z,
        poseVariant: spec.pose,
        fluidColor: spec.fluid,
        warningColor: spec.fluid,
        scale: spec.scale,
        labelSeed: Math.abs(spec.z),
      });
      this.root.add(tube.group);
      this.containmentTubes.push(tube);
    }

    const shaftSteelMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0x253139, metalness: 0.72, roughness: 0.44 })
    );
    const redIndicatorMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 1.8,
      })
    );
    for (const z of [-391, -401, -411]) {
      const beam = new THREE.Mesh(
        this.tracker.geo(new THREE.BoxGeometry(19, 0.42, 0.48)),
        shaftSteelMat
      );
      beam.position.set(0, 5.85, z);
      this.root.add(beam);
      for (const x of [-8.7, 8.7]) {
        const rail = new THREE.Mesh(
          this.tracker.geo(new THREE.BoxGeometry(0.3, 8.8, 0.3)),
          shaftSteelMat
        );
        rail.position.set(x, 2.3, z);
        const indicator = new THREE.Mesh(
          this.tracker.geo(new THREE.BoxGeometry(0.42, 0.18, 0.16)),
          redIndicatorMat
        );
        indicator.position.set(x * 0.92, 4.7, z + 0.25);
        this.root.add(rail, indicator);
      }
    }

    const fossilGroup = new THREE.Group();
    fossilGroup.position.set(0, 0, -404);
    const boneMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0xa59a83, roughness: 0.82, metalness: 0.04 })
    );
    const displayMat = this.tracker.mat(
      new THREE.MeshStandardMaterial({ color: 0x303940, roughness: 0.5, metalness: 0.68 })
    );
    const displayBase = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(3.8, 0.32, 1.8)),
      displayMat
    );
    displayBase.position.y = 0.16;
    fossilGroup.add(displayBase);

    const spine = new THREE.Mesh(
      this.tracker.geo(new THREE.CylinderGeometry(0.13, 0.18, 2.7, 8)),
      boneMat
    );
    spine.rotation.x = Math.PI / 2;
    spine.position.set(0, 1.22, -0.05);
    fossilGroup.add(spine);
    for (let i = 0; i < 6; i++) {
      const vertebra = new THREE.Mesh(
        this.tracker.geo(new THREE.DodecahedronGeometry(0.2, 0)),
        boneMat
      );
      vertebra.position.set(0, 1.22, 0.92 - i * 0.38);
      fossilGroup.add(vertebra);
    }
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(
        this.tracker.geo(new THREE.TorusGeometry(0.5 + i * 0.035, 0.065, 6, 14, Math.PI)),
        boneMat
      );
      rib.position.set(0, 1.23, 0.55 - i * 0.34);
      fossilGroup.add(rib);
    }
    const fossilSkull = new THREE.Mesh(
      this.tracker.geo(new THREE.DodecahedronGeometry(0.52, 0)),
      boneMat
    );
    fossilSkull.position.set(0, 1.4, -1.22);
    fossilGroup.add(fossilSkull);

    const displayGlass = new THREE.Mesh(
      this.tracker.geo(new THREE.BoxGeometry(4.0, 3.2, 0.08)),
      this.tracker.mat(
        new THREE.MeshPhysicalMaterial({
          color: 0x85aab1,
          metalness: 0.08,
          roughness: 0.18,
          transparent: true,
          opacity: 0.12,
          transmission: 0.8,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      )
    );
    displayGlass.position.set(0, 1.75, 1.6);
    fossilGroup.add(displayGlass);
    this.root.add(fossilGroup);
  }

  // ==================== CONTROL HOOKS FOR STORY EVENTS ====================

  public setVillageGateOpen(openProgress: number): void {
    const p = Math.max(0, Math.min(1, openProgress));
    const angle = p * 1.48;
    if (this.villageGateLeft) this.villageGateLeft.rotation.y = angle;
    if (this.villageGateRight) this.villageGateRight.rotation.y = -angle;
  }

  public updateStage1Creature(visible: boolean, turnProgress: number, walkAwayProgress: number): void {
    if (!this.creatureGroup) return;
    this.creatureGroup.visible = visible;
    if (!visible) return;
    const t = Math.max(0, Math.min(1, turnProgress));
    const w = Math.max(0, Math.min(2, walkAwayProgress));

    if (w <= 1.0) {
      // Phase 1: Turns beyond the village gate and darts behind the left forest cover tree (x = -3.45, z = -97.0)
      const easeW = w * w * (3 - 2 * w);
      this.creatureGroup.rotation.set(0, t * Math.PI * 0.92, 0);
      this.creatureGroup.position.set(-easeW * 3.45, 0, -80 - easeW * 17.0);
      this.creatureGroup.scale.setScalar(1.0);
      if (this.creatureHead) {
        this.creatureHead.rotation.set(0, Math.sin(t * Math.PI) * 0.45, 0);
      }
      return;
    }

    // Phase 2 (w = 1.0 .. 2.0): Silently peeks out from behind the forest tree trunk, then slowly backs away into the dark mist
    const peekPhase = w - 1.0;
    if (peekPhase < 0.45) {
      const sway = Math.sin(peekPhase * Math.PI * 4) * 0.03;
      this.creatureGroup.position.set(-3.45 + sway, -0.15, -97.0);
      this.creatureGroup.rotation.set(0.08, 0.18, -0.34);
      this.creatureGroup.scale.setScalar(1.0);
      if (this.creatureHead) {
        this.creatureHead.rotation.set(-0.06, 0.12, 0.24);
      }
    } else {
      const retreatU = (peekPhase - 0.45) / 0.55;
      const easeRetreat = retreatU * retreatU * (3 - 2 * retreatU);
      this.creatureGroup.position.set(
        -3.45 - easeRetreat * 6.8,
        -0.15 - easeRetreat * 0.35,
        -97.0 - easeRetreat * 12.5
      );
      this.creatureGroup.rotation.set(0.08, 0.18 + easeRetreat * 0.35, -0.34 * (1 - easeRetreat));
      this.creatureGroup.scale.setScalar(Math.max(0.01, 1.0 - easeRetreat * 0.45));
      if (retreatU >= 0.98) {
        this.creatureGroup.visible = false;
      }
    }
  }

  public setBunkerDoorOpen(openProgress: number): void {
    const p = Math.max(0, Math.min(1, openProgress));
    if (this.bunkerDoorLeft) this.bunkerDoorLeft.position.x = -1.8 - p * 3.1;
    if (this.bunkerDoorRight) this.bunkerDoorRight.position.x = 1.8 + p * 3.1;
  }

  public setFacilityAlarm(active: boolean): void {
    this.facilityAlarmActive = active;
  }

  public setKingElevatorSequence(
    visible: boolean,
    phase: 'idle' | 'approaching' | 'entering' | 'positioned' | 'closing' | 'descending' | 'gone',
    phaseP: number,
    elapsedSec = 0
  ): void {
    if (!this.alphaKingGroup) return;
    this.alphaKingGroup.visible = visible && phase !== 'gone';

    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const p = clamp01(phaseP);
    const eased = p * p * (3 - 2 * p);
    const setDoors = (openP: number) => {
      const o = clamp01(openP);
      if (this.kingElevDoorLeft) this.kingElevDoorLeft.position.x = -1.08 - o * 1.45;
      if (this.kingElevDoorRight) this.kingElevDoorRight.position.x = 1.08 + o * 1.45;
    };

    const setWalkGait = (speedWeight: number) => {
      const s = Math.sin(elapsedSec * 5.2) * speedWeight;
      const bob = Math.abs(Math.sin(elapsedSec * 5.2)) * 0.14 * speedWeight;
      if (this.kingLeftLegPivot) this.kingLeftLegPivot.rotation.x = s * 0.48;
      if (this.kingRightLegPivot) this.kingRightLegPivot.rotation.x = -s * 0.44;
      if (this.kingLeftArmPivot) this.kingLeftArmPivot.rotation.x = -0.75 - s * 0.34;
      if (this.kingRightArmPivot) this.kingRightArmPivot.rotation.x = -0.65 + s * 0.32;
      if (this.kingTorsoPivot) {
        this.kingTorsoPivot.position.y = 1.4 + bob;
        this.kingTorsoPivot.rotation.set(0.18 * speedWeight, 0, Math.cos(elapsedSec * 2.6) * 0.08 * speedWeight);
      }
    };

    if (!visible || phase === 'idle' || phase === 'gone') {
      setDoors(0);
      if (this.kingElevPlatform) this.kingElevPlatform.position.y = phase === 'gone' ? -8.5 : 0;
      this.kingElevDescending = false;
      return;
    }

    if (phase === 'approaching') {
      // King stomps heavily out from shattered chamber toward open threshold while freight doors open
      setDoors(eased);
      if (this.kingElevPlatform) this.kingElevPlatform.position.y = 0;
      this.kingElevDescending = false;
      this.alphaKingGroup.position.set(
        3.9 + (6.8 - 3.9) * eased,
        -0.05,
        -365.8 + (-378.99 + 365.8) * eased
      );
      this.alphaKingGroup.rotation.y = Math.PI - 0.38;
      setWalkGait(1.0);
    } else if (phase === 'entering') {
      // Doors are 100% open; King steps cleanly inside freight platform with zero door clipping
      setDoors(1);
      if (this.kingElevPlatform) this.kingElevPlatform.position.y = 0;
      this.kingElevDescending = false;
      this.alphaKingGroup.position.set(
        6.8,
        -0.05,
        -378.99 + (-382.3 + 378.99) * eased
      );
      this.alphaKingGroup.rotation.y = Math.PI - 0.34;
      setWalkGait(0.9);
    } else if (phase === 'positioned') {
      // Turns back heavily toward the player & raises crusher claw menacingly
      setDoors(1);
      if (this.kingElevPlatform) this.kingElevPlatform.position.y = 0;
      this.kingElevDescending = false;
      this.alphaKingGroup.position.set(6.8, -0.05, -382.3);
      this.alphaKingGroup.rotation.y = (Math.PI - 0.34) * (1 - eased) + -0.34 * eased;
      setWalkGait(0);
      if (this.kingTorsoPivot) {
        this.kingTorsoPivot.position.y = 1.4 + Math.sin(elapsedSec * 2.2) * 0.04;
        this.kingTorsoPivot.rotation.set(-0.08 * eased, 0, 0);
      }
      if (this.kingLeftArmPivot) this.kingLeftArmPivot.rotation.x = -0.85 - eased * 1.15;
    } else if (phase === 'closing') {
      // Doors slide shut smoothly after King is stationed inside
      setDoors(1 - eased);
      if (this.kingElevPlatform) this.kingElevPlatform.position.y = 0;
      this.kingElevDescending = false;
      this.alphaKingGroup.position.set(6.8, -0.05, -382.3);
      this.alphaKingGroup.rotation.y = -0.34;
      setWalkGait(0);
    } else if (phase === 'descending') {
      // Freight cage + King physically drop down shaft
      setDoors(0);
      this.kingElevDescending = true;
      const dropY = -eased * 8.5;
      if (this.kingElevPlatform) this.kingElevPlatform.position.y = dropY;
      this.alphaKingGroup.position.set(6.8, dropY - 0.05, -382.3);
      this.alphaKingGroup.rotation.y = -0.34;
      setWalkGait(0);
    }
  }

  public setAlphaKingSilhouette(visible: boolean, vanishProgress: number): void {
    const v = Math.max(0, Math.min(1, vanishProgress));
    if (!visible) {
      this.setKingElevatorSequence(false, 'gone', 1, 0);
      return;
    }
    if (v < 0.36) {
      this.setKingElevatorSequence(true, 'approaching', v / 0.36, v * 8.5);
    } else if (v < 0.56) {
      this.setKingElevatorSequence(true, 'entering', (v - 0.36) / 0.20, v * 8.5);
    } else if (v < 0.69) {
      this.setKingElevatorSequence(true, 'positioned', (v - 0.56) / 0.13, v * 8.5);
    } else if (v < 0.82) {
      this.setKingElevatorSequence(true, 'closing', (v - 0.69) / 0.13, v * 8.5);
    } else {
      this.setKingElevatorSequence(true, 'descending', (v - 0.82) / 0.18, v * 8.5);
    }
  }

  public setElevatorState(
    doorOpen: number,
    descending: boolean,
    speedFactor: number,
    cageYOffset = 0
  ): void {
    const p = Math.max(0, Math.min(1, doorOpen));
    if (this.elevatorDoorLeft) this.elevatorDoorLeft.position.x = -1.7 - p * 2.9;
    if (this.elevatorDoorRight) this.elevatorDoorRight.position.x = 1.7 + p * 2.9;
    if (this.playerElevatorCage) {
      this.playerElevatorCage.position.y = cageYOffset;
    }
    this.elevatorDescending = descending;
    this.elevatorSpeedFactor = speedFactor;
  }

  public getAtmosphereForZ(playerZ: number): CorridorAtmosphere {
    // Stage 1 Village (z > -75) -> Stage 2 Forest (-75..-224) -> Stage 3 Facility (z < -224)
    if (playerZ > -76) {
      return {
        bgHex: 0x0a0d11,
        fogDensity: 0.025,
        hemiSky: 0x52657a,
        hemiGround: 0x181310,
        hemiInt: 0.58,
        keyColor: 0xffd2a0,
        keyInt: 1.15,
      };
    }
    if (playerZ > -226) {
      return {
        bgHex: 0x09100b,
        fogDensity: 0.031,
        hemiSky: 0x3b5244,
        hemiGround: 0x121510,
        hemiInt: 0.52,
        keyColor: 0x9ab8a0,
        keyInt: 0.92,
      };
    }
    return {
      bgHex: this.facilityAlarmActive ? 0x140507 : 0x050d0f,
      fogDensity: 0.029,
      hemiSky: this.facilityAlarmActive ? 0x991b1b : 0x3a9188,
      hemiGround: 0x081417,
      hemiInt: 0.62,
      keyColor: this.facilityAlarmActive ? 0xf87171 : 0x86efac,
      keyInt: 1.1,
    };
  }

  public update(dtSec: number, elapsedSec: number, playerZ: number): void {
    const atmo = this.getAtmosphereForZ(playerZ);
    this.hemiLight.color.setHex(atmo.hemiSky);
    this.hemiLight.groundColor.setHex(atmo.hemiGround);
    this.hemiLight.intensity = atmo.hemiInt;
    this.keyLight.color.setHex(atmo.keyColor);
    this.keyLight.intensity = atmo.keyInt;

    const pulse = 0.6 + 0.4 * Math.sin(elapsedSec * 4.5);
    for (const l of this.pulseLights) {
      const near = Math.abs(l.position.z - playerZ) < 68;
      l.visible = near;
      if (near) l.intensity = 8 + pulse * 10;
    }
    for (const fl of this.flickerLights) {
      const near = Math.abs(fl.light.position.z - playerZ) < 68;
      fl.light.visible = near;
      if (near) {
        const n = Math.sin(elapsedSec * fl.speed) * Math.cos(elapsedSec * (fl.speed * 0.37));
        fl.light.intensity = n > -0.45 ? fl.base * (0.7 + 0.3 * Math.abs(n)) : fl.base * 0.16;
      }
    }
    for (const m of this.flickerMats) {
      m.emissiveIntensity = 0.9 + pulse * 0.9;
    }

    // Swaying hanging corpse props & falling leaves in Cursed Forest (only updated when player is in/near Stage 2)
    const inForestRange = playerZ <= -65 && playerZ >= -242;
    if (inForestRange) {
      for (const hc of this.hangingCorpses) {
        if (Math.abs(hc.group.position.z - playerZ) > 55) continue;
        hc.group.rotation.z = Math.sin(elapsedSec * 1.45 + hc.phase) * hc.amp;
        hc.group.rotation.x = Math.cos(elapsedSec * 1.1 + hc.phase) * (hc.amp * 0.55);
      }
      if (this.leavesPoints && this.leavesBaseY) {
        this.leavesPoints.visible = true;
        const attr = this.leavesPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        for (let i = 0; i < this.leavesBaseY.length; i++) {
          arr[i * 3 + 1] -= dtSec * (0.55 + (i % 4) * 0.14);
          arr[i * 3] += Math.sin(elapsedSec * 1.6 + i) * dtSec * 0.35;
          if (arr[i * 3 + 1] < 0.08) {
            arr[i * 3 + 1] = 6.5;
          }
        }
        attr.needsUpdate = true;
      }
    } else if (this.leavesPoints) {
      this.leavesPoints.visible = false;
    }

    // Facility emergency alarm strobing
    const alarmFlash = 0.45 + 0.55 * Math.sin(elapsedSec * 7.5);
    for (const bm of this.facilityAlarmBeacons) {
      if (this.facilityAlarmActive) {
        bm.color.setHex(0xef4444);
        bm.emissive.setHex(0xdc2626);
        bm.emissiveIntensity = 0.8 + alarmFlash * 2.2;
      } else {
        bm.color.setHex(0x14b8a6);
        bm.emissive.setHex(0x0d9488);
        bm.emissiveIntensity = 1.4;
      }
    }
    for (const pt of this.facilityAlarmLights) {
      const near = Math.abs(pt.position.z - playerZ) < 72;
      pt.visible = near;
      if (!near) continue;
      if (this.facilityAlarmActive) {
        pt.color.setHex(0xef4444);
        pt.intensity = 8 + alarmFlash * 16;
      } else {
        pt.color.setHex(0x5eead4);
        pt.intensity = 14;
      }
    }

    // Animate suspended Human Test Subjects & rising tube bubbles only for nearby tubes (< 52m)
    const nearbyTubes = this.containmentTubes.filter(
      (t) => Math.abs(t.group.position.z - playerZ) < 52
    );
    updateContainmentTubes(nearbyTubes, dtSec, elapsedSec);
    if (this.kingElevLight) {
      this.kingElevLight.visible = playerZ < -335;
    }
    if (this.elevatorInteriorLight) {
      this.elevatorInteriorLight.visible = playerZ < -345;
    }
    if (this.elevatorEmergencyLight) {
      this.elevatorEmergencyLight.visible = this.elevatorDescending && playerZ < -350;
    }

    // Wing E Freight beacon flash when King descends
    if (this.kingElevBeaconMat) {
      if (this.kingElevDescending) {
        this.kingElevBeaconMat.color.setHex(0xef4444);
        this.kingElevBeaconMat.emissive.setHex(0xdc2626);
        this.kingElevBeaconMat.emissiveIntensity = 1.1 + alarmFlash * 2.4;
      } else {
        this.kingElevBeaconMat.color.setHex(0xf59e0b);
        this.kingElevBeaconMat.emissive.setHex(0xd97706);
        this.kingElevBeaconMat.emissiveIntensity = 1.4;
      }
    }
    if (this.kingElevLight) {
      this.kingElevLight.color.setHex(this.kingElevDescending ? 0xef4444 : 0xfbbf24);
      this.kingElevLight.intensity = this.kingElevDescending ? 18 : 13;
    }

    const powerFault =
      this.elevatorDescending &&
      Math.sin(elapsedSec * 5.7 + Math.sin(elapsedSec * 1.3) * 2.1) > 0.9;
    if (this.elevatorInteriorLight) {
      this.elevatorInteriorLight.intensity = powerFault ? 1.2 : 12.5 + pulse * 2.4;
    }
    if (this.elevatorCeilingLamp) {
      this.elevatorCeilingLamp.emissiveIntensity = powerFault ? 0.12 : 1.5 + pulse * 0.5;
    }
    if (this.elevatorEmergencyLight) {
      this.elevatorEmergencyLight.intensity = this.elevatorDescending
        ? powerFault
          ? 5.2
          : 0.5 + Math.max(0, Math.sin(elapsedSec * 3.2)) * 0.8
        : 0;
    }
    if (this.elevatorSparkPoints) {
      if (this.elevatorDescending) {
        this.elevatorSparkDuration = Math.max(0, this.elevatorSparkDuration - dtSec);
        if (this.elevatorSparkDuration === 0) {
          this.elevatorSparkCooldown -= dtSec;
          if (this.elevatorSparkCooldown <= 0) {
            this.elevatorSparkDuration = 0.075;
            this.elevatorSparkCooldown = 0.9 + Math.random() * 1.8;
            const positions = this.elevatorSparkPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
            const values = positions.array as Float32Array;
            for (let i = 0; i < values.length; i += 3) {
              values[i] = (Math.random() - 0.5) * 0.22;
              values[i + 1] = (Math.random() - 0.5) * 0.28;
              values[i + 2] = (Math.random() - 0.5) * 0.16;
            }
            positions.needsUpdate = true;
          }
        }
      } else {
        this.elevatorSparkDuration = 0;
        this.elevatorSparkCooldown = Math.max(this.elevatorSparkCooldown, 0.45);
      }
      this.elevatorSparkPoints.visible = this.elevatorSparkDuration > 0;
    }

    // Elevator shaft upward rib scroll during descent
    if (this.elevatorShaftRibs && this.elevatorDescending) {
      this.elevatorRibOffset = (this.elevatorRibOffset + dtSec * 9.5 * Math.max(0.2, this.elevatorSpeedFactor)) % 4;
      this.elevatorShaftRibs.position.y = this.elevatorRibOffset;
    }
  }

  public dispose(): void {
    this.tracker.dispose();
  }
}
