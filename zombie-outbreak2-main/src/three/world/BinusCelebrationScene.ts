import * as THREE from 'three';

export const BINUS_WOODEN_SIGN_TEXT = 'GABUNG BINUS';
export const BINUS_BANNER_TEXT = 'AYO GABUNG BINUS';

interface AnimatedSignSpec {
  group: THREE.Group;
  baseY: number;
  phase: number;
  swayAmp: number;
}

interface AnimatedBannerSpec {
  group: THREE.Group;
  clothMesh: THREE.Mesh;
  basePositions: Float32Array;
  phase: number;
}

interface HumanSurvivorSpec {
  root: THREE.Group;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  baseY: number;
  baseRotY: number;
  phase: number;
  speed: number;
  behavior: 'jump_cheer' | 'clap' | 'wave_flag' | 'sign_holder';
}

export class SignAndBannerController {
  public readonly root = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly texs: THREE.Texture[] = [];

  private readonly signs: AnimatedSignSpec[] = [];
  private readonly banners: AnimatedBannerSpec[] = [];
  public readonly signTexts: string[] = [];
  public readonly bannerTexts: string[] = [];

  constructor(maxAniso: number) {
    const woodPoleMat = this.tMat(
      new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.88 })
    );
    const woodBackMat = this.tMat(
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.84 })
    );
    const bannerPoleMat = this.tMat(
      new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.45, metalness: 0.35 })
    );

    const woodenTex = this.createWoodenSignTexture(BINUS_WOODEN_SIGN_TEXT, maxAniso);
    const bannerTex = this.createBannerTexture(BINUS_BANNER_TEXT, maxAniso);

    const woodenFaceMat = this.tMat(
      new THREE.MeshStandardMaterial({
        map: woodenTex,
        roughness: 0.72,
        metalness: 0.05,
      })
    );
    const bannerClothMat = this.tMat(
      new THREE.MeshStandardMaterial({
        map: bannerTex,
        roughness: 0.55,
        metalness: 0.04,
        side: THREE.DoubleSide,
      })
    );

    const signBoardGeo = this.tGeo(new THREE.BoxGeometry(3.2, 1.05, 0.14));
    const signFaceGeo = this.tGeo(new THREE.PlaneGeometry(3.08, 0.94));
    const signPoleGeo = this.tGeo(new THREE.CylinderGeometry(0.06, 0.07, 3.0, 6));

    // 6 crisp "GABUNG BINUS" wooden signs held high across the celebration plaza
    const signPlacements = [
      { x: -3.8, z: -51.5, rotY: 0.22, y: 0.15 },
      { x: 3.9, z: -52.2, rotY: -0.2, y: 0.1 },
      { x: -1.2, z: -56.2, rotY: 0.04, y: 0.28 },
      { x: 5.8, z: -60.5, rotY: -0.34, y: 0.18 },
      { x: -6.2, z: -62.0, rotY: 0.36, y: 0.16 },
      { x: 1.5, z: -66.5, rotY: -0.06, y: 0.22 },
    ];

    for (let i = 0; i < signPlacements.length; i++) {
      const sp = signPlacements[i];
      const g = new THREE.Group();
      g.position.set(sp.x, sp.y, sp.z);
      g.rotation.y = sp.rotY;

      const poleL = new THREE.Mesh(signPoleGeo, woodPoleMat);
      poleL.position.set(-1.18, 1.5, 0);
      const poleR = new THREE.Mesh(signPoleGeo, woodPoleMat);
      poleR.position.set(1.18, 1.5, 0);

      const board = new THREE.Mesh(signBoardGeo, woodBackMat);
      board.position.set(0, 2.72, 0);
      board.castShadow = true;

      const frontFace = new THREE.Mesh(signFaceGeo, woodenFaceMat);
      frontFace.position.set(0, 2.72, 0.076);
      const backFace = new THREE.Mesh(signFaceGeo, woodenFaceMat);
      backFace.position.set(0, 2.72, -0.076);
      backFace.rotation.y = Math.PI;

      g.add(poleL, poleR, board, frontFace, backFace);
      this.root.add(g);
      this.signs.push({
        group: g,
        baseY: sp.y,
        phase: i * 1.15,
        swayAmp: 0.045,
      });
      this.signTexts.push(BINUS_WOODEN_SIGN_TEXT);
    }

    // 3 large waving "AYO GABUNG BINUS" overhead banners held high by twin poles (above human height)
    const bannerSpecs = [
      { x: 0, y: 0, z: -59.0, rotY: 0, width: 8.6, height: 2.35, poleHeight: 5.5 },
      { x: -9.8, y: 0, z: -64.5, rotY: 0.42, width: 7.4, height: 2.15, poleHeight: 5.3 },
      { x: 9.8, y: 0, z: -64.5, rotY: -0.42, width: 7.4, height: 2.15, poleHeight: 5.3 },
    ];

    for (let b = 0; b < bannerSpecs.length; b++) {
      const bs = bannerSpecs[b];
      const g = new THREE.Group();
      g.position.set(bs.x, bs.y, bs.z);
      g.rotation.y = bs.rotY;

      const poleGeo = this.tGeo(new THREE.CylinderGeometry(0.11, 0.13, bs.poleHeight, 8));
      const poleL = new THREE.Mesh(poleGeo, bannerPoleMat);
      poleL.position.set(-bs.width * 0.5 - 0.12, bs.poleHeight * 0.5, 0);
      const poleR = new THREE.Mesh(poleGeo, bannerPoleMat);
      poleR.position.set(bs.width * 0.5 + 0.12, bs.poleHeight * 0.5, 0);

      const crossbar = new THREE.Mesh(
        this.tGeo(new THREE.CylinderGeometry(0.06, 0.06, bs.width + 0.4, 8)),
        bannerPoleMat
      );
      crossbar.rotation.z = Math.PI / 2;
      crossbar.position.set(0, bs.poleHeight - 0.18, 0);

      const clothGeo = this.tGeo(new THREE.PlaneGeometry(bs.width, bs.height, 14, 3));
      const posAttr = clothGeo.getAttribute('position') as THREE.BufferAttribute;
      const basePositions = new Float32Array(posAttr.array.length);
      basePositions.set(posAttr.array as Float32Array);

      const clothMesh = new THREE.Mesh(clothGeo, bannerClothMat);
      clothMesh.position.set(0, bs.poleHeight - 0.25 - bs.height * 0.5, 0);
      clothMesh.castShadow = true;

      g.add(poleL, poleR, crossbar, clothMesh);
      this.root.add(g);
      this.banners.push({
        group: g,
        clothMesh,
        basePositions,
        phase: b * 1.4,
      });
      this.bannerTexts.push(BINUS_BANNER_TEXT);
    }
  }

  public update(elapsedSec: number): void {
    for (const s of this.signs) {
      s.group.position.y = s.baseY + Math.max(0, Math.sin(elapsedSec * 4.2 + s.phase)) * 0.12;
      s.group.rotation.z = Math.sin(elapsedSec * 2.6 + s.phase) * s.swayAmp;
    }

    for (const b of this.banners) {
      const geo = b.clothMesh.geometry;
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
      const base = b.basePositions;
      for (let i = 0; i < posAttr.count; i++) {
        const bx = base[i * 3];
        const by = base[i * 3 + 1];
        const wave = Math.sin(bx * 0.65 + elapsedSec * 3.1 + b.phase) * 0.18 * (0.65 - by * 0.18);
        posAttr.setZ(i, base[i * 3 + 2] + wave);
      }
      posAttr.needsUpdate = true;
    }
  }

  private tGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private tMat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  private createWoodenSignTexture(text: string, maxAniso: number): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Warm hand-painted timber plank background
    const grad = ctx.createLinearGradient(0, 0, 0, 320);
    grad.addColorStop(0, '#9a6635');
    grad.addColorStop(0.5, '#855327');
    grad.addColorStop(1, '#70441e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 320);

    // Subtle wood grain planks
    ctx.strokeStyle = 'rgba(42, 22, 8, 0.34)';
    ctx.lineWidth = 4;
    for (let y = 26; y < 320; y += 54) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }

    // Crisp dark border trim & ivory painted stencil plaque
    ctx.strokeStyle = '#3b210d';
    ctx.lineWidth = 18;
    ctx.strokeRect(14, 14, 996, 292);

    ctx.fillStyle = 'rgba(254, 243, 199, 0.94)';
    ctx.fillRect(42, 42, 940, 236);
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 8;
    ctx.strokeRect(48, 48, 928, 224);

    // Bold high-contrast lettering
    ctx.fillStyle = '#0f172a';
    ctx.font = '900 108px "Impact", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 165);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    this.texs.push(tex);
    return tex;
  }

  private createBannerTexture(text: string, maxAniso: number): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Celebratory navy + golden saffron BINUS banner palette
    const grad = ctx.createLinearGradient(0, 0, 1280, 0);
    grad.addColorStop(0, '#0f2942');
    grad.addColorStop(0.5, '#173f66');
    grad.addColorStop(1, '#0f2942');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 384);

    // Top and bottom gold celebration ribbons
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(0, 0, 1280, 28);
    ctx.fillRect(0, 356, 1280, 28);

    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 6;
    ctx.strokeRect(24, 42, 1232, 300);

    // Crisp drop-shadow + bright white display text
    ctx.font = '900 112px "Impact", "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillText(text, 644, 198);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 640, 192);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    this.texs.push(tex);
    return tex;
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

export class CrowdCelebrationController {
  public readonly root = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly humans: HumanSurvivorSpec[] = [];

  constructor() {
    // Shared low-poly human geometries for fast draw-call friendly rendering
    const torsoGeo = this.tGeo(new THREE.BoxGeometry(0.46, 0.58, 0.26));
    const headGeo = this.tGeo(new THREE.BoxGeometry(0.28, 0.28, 0.28));
    const hairGeo = this.tGeo(new THREE.BoxGeometry(0.31, 0.11, 0.31));
    const armGeo = this.tGeo(new THREE.BoxGeometry(0.14, 0.5, 0.14));
    const legGeo = this.tGeo(new THREE.BoxGeometry(0.17, 0.78, 0.18));

    const shirtPalette = [0x0ea5e9, 0xf59e0b, 0x10b981, 0xef4444, 0x6366f1, 0xf97316, 0xeab308, 0xf8fafc];
    const pantsPalette = [0x1e293b, 0x334155, 0x292524, 0x1e3a5f];
    const skinPalette = [0xd6a682, 0xc28e68, 0xe2b89b, 0x9c6c4d];
    const hairPalette = [0x1f1916, 0x452c1e, 0x78552b, 0x292524];

    const shirtMats = shirtPalette.map((c) =>
      this.tMat(new THREE.MeshStandardMaterial({ color: c, roughness: 0.72 }))
    );
    const pantsMats = pantsPalette.map((c) =>
      this.tMat(new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }))
    );
    const skinMats = skinPalette.map((c) =>
      this.tMat(new THREE.MeshStandardMaterial({ color: c, roughness: 0.76 }))
    );
    const hairMats = hairPalette.map((c) =>
      this.tMat(new THREE.MeshStandardMaterial({ color: c, roughness: 0.82 }))
    );

    // 36 vibrant human survivors arranged across the plaza, standing cleanly behind sign poles (zero clipping)
    const spots: Array<{ x: number; z: number; rotY: number; behavior: HumanSurvivorSpec['behavior'] }> = [
      // Left & right welcoming cheering corridor just past Giant Exit Gate (z = -46 .. -56)
      { x: -5.4, z: -47.2, rotY: 0.45, behavior: 'jump_cheer' },
      { x: 5.5, z: -47.6, rotY: -0.45, behavior: 'clap' },
      { x: -4.2, z: -49.0, rotY: 0.35, behavior: 'wave_flag' },
      { x: 4.3, z: -49.2, rotY: -0.35, behavior: 'jump_cheer' },
      { x: -6.8, z: -50.2, rotY: 0.55, behavior: 'clap' },
      { x: 6.7, z: -50.6, rotY: -0.5, behavior: 'wave_flag' },
      // Sign holders standing 0.52m behind wooden GABUNG BINUS sign poles so raised hands grip poles cleanly
      { x: -5.06, z: -51.76, rotY: 0.22, behavior: 'sign_holder' },
      { x: -2.76, z: -52.27, rotY: 0.22, behavior: 'sign_holder' },
      { x: 2.64, z: -52.94, rotY: -0.2, behavior: 'sign_holder' },
      { x: 4.96, z: -52.48, rotY: -0.2, behavior: 'sign_holder' },
      { x: -2.40, z: -56.68, rotY: 0.04, behavior: 'sign_holder' },
      { x: -0.04, z: -56.77, rotY: 0.04, behavior: 'sign_holder' },
      // Midground celebration plaza & banner crew (z = -54 .. -65)
      { x: -8.2, z: -54.5, rotY: 0.35, behavior: 'jump_cheer' },
      { x: 8.1, z: -54.8, rotY: -0.35, behavior: 'jump_cheer' },
      { x: -6.4, z: -57.2, rotY: 0.25, behavior: 'clap' },
      { x: 6.5, z: -57.5, rotY: -0.25, behavior: 'wave_flag' },
      { x: -4.42, z: -59.55, rotY: 0.0, behavior: 'sign_holder' },
      { x: 4.42, z: -59.55, rotY: 0.0, behavior: 'sign_holder' },
      { x: 4.52, z: -61.38, rotY: -0.34, behavior: 'sign_holder' },
      { x: 6.74, z: -60.60, rotY: -0.34, behavior: 'sign_holder' },
      { x: -7.48, z: -62.07, rotY: 0.36, behavior: 'sign_holder' },
      { x: -5.28, z: -62.91, rotY: 0.36, behavior: 'sign_holder' },
      // Deep courtyard cheering arc (positioned clear of Banner 1 & 2 cloth at z = -64.5)
      { x: -11.5, z: -59.5, rotY: 0.45, behavior: 'jump_cheer' },
      { x: 11.4, z: -59.8, rotY: -0.45, behavior: 'clap' },
      { x: -8.9, z: -62.6, rotY: 0.38, behavior: 'wave_flag' },
      { x: 8.9, z: -62.6, rotY: -0.38, behavior: 'wave_flag' },
      { x: -2.5, z: -63.5, rotY: 0.1, behavior: 'jump_cheer' },
      { x: 2.6, z: -63.8, rotY: -0.1, behavior: 'clap' },
      { x: 0.29, z: -67.09, rotY: -0.06, behavior: 'sign_holder' },
      { x: 2.65, z: -66.95, rotY: -0.06, behavior: 'sign_holder' },
      { x: -7.8, z: -68.2, rotY: 0.22, behavior: 'jump_cheer' },
      { x: 7.8, z: -68.5, rotY: -0.22, behavior: 'jump_cheer' },
      { x: -4.0, z: -70.5, rotY: 0.12, behavior: 'wave_flag' },
      { x: 4.1, z: -70.8, rotY: -0.12, behavior: 'clap' },
      { x: -1.1, z: -72.2, rotY: 0.05, behavior: 'jump_cheer' },
      { x: 1.4, z: -72.5, rotY: -0.05, behavior: 'jump_cheer' },
    ];

    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const root = new THREE.Group();
      root.position.set(s.x, 0, s.z);
      root.rotation.y = s.rotY;

      const shirtMat = shirtMats[i % shirtMats.length];
      const pantsMat = pantsMats[i % pantsMats.length];
      const skinMat = skinMats[i % skinMats.length];
      const hairMat = hairMats[i % hairMats.length];

      const torsoPivot = new THREE.Group();
      torsoPivot.position.set(0, 0.84, 0);
      const torso = new THREE.Mesh(torsoGeo, shirtMat);
      torso.position.y = 0.29;
      torso.castShadow = true;
      torsoPivot.add(torso);

      const headPivot = new THREE.Group();
      headPivot.position.set(0, 0.62, 0);
      const head = new THREE.Mesh(headGeo, skinMat);
      head.position.y = 0.14;
      const hair = new THREE.Mesh(hairGeo, hairMat);
      hair.position.y = 0.28;
      headPivot.add(head, hair);
      torsoPivot.add(headPivot);

      const leftArmPivot = new THREE.Group();
      leftArmPivot.position.set(-0.31, 0.54, 0);
      const lArm = new THREE.Mesh(armGeo, shirtMat);
      lArm.position.y = -0.22;
      leftArmPivot.add(lArm);
      torsoPivot.add(leftArmPivot);

      const rightArmPivot = new THREE.Group();
      rightArmPivot.position.set(0.31, 0.54, 0);
      const rArm = new THREE.Mesh(armGeo, shirtMat);
      rArm.position.y = -0.22;
      rightArmPivot.add(rArm);
      torsoPivot.add(rightArmPivot);

      const leftLegPivot = new THREE.Group();
      leftLegPivot.position.set(-0.13, 0.82, 0);
      const lLeg = new THREE.Mesh(legGeo, pantsMat);
      lLeg.position.y = -0.4;
      leftLegPivot.add(lLeg);

      const rightLegPivot = new THREE.Group();
      rightLegPivot.position.set(0.13, 0.82, 0);
      const rLeg = new THREE.Mesh(legGeo, pantsMat);
      rLeg.position.y = -0.4;
      rightLegPivot.add(rLeg);

      root.add(leftLegPivot, rightLegPivot, torsoPivot);
      this.root.add(root);

      this.humans.push({
        root,
        torsoPivot,
        headPivot,
        leftArmPivot,
        rightArmPivot,
        leftLegPivot,
        rightLegPivot,
        baseY: 0,
        baseRotY: s.rotY,
        phase: i * 0.67,
        speed: 3.8 + (i % 5) * 0.45,
        behavior: s.behavior,
      });
    }
  }

  public getHumanCount(): number {
    return this.humans.length;
  }

  public update(elapsedSec: number): void {
    for (const h of this.humans) {
      const t = elapsedSec * h.speed + h.phase;
      if (h.behavior === 'jump_cheer') {
        const hop = Math.max(0, Math.sin(t));
        h.root.position.y = h.baseY + hop * 0.34;
        h.torsoPivot.rotation.x = -0.08 * hop;
        h.leftArmPivot.rotation.x = -2.45 - Math.sin(t * 1.4) * 0.35;
        h.rightArmPivot.rotation.x = -2.45 + Math.sin(t * 1.4) * 0.35;
        h.leftArmPivot.rotation.z = -0.28;
        h.rightArmPivot.rotation.z = 0.28;
        h.leftLegPivot.rotation.x = -hop * 0.32;
        h.rightLegPivot.rotation.x = hop * 0.24;
      } else if (h.behavior === 'clap') {
        const clap = Math.sin(t * 2.2);
        h.root.position.y = h.baseY + Math.abs(Math.sin(t * 0.75)) * 0.08;
        h.leftArmPivot.rotation.x = -1.25;
        h.rightArmPivot.rotation.x = -1.25;
        h.leftArmPivot.rotation.z = 0.38 + clap * 0.24;
        h.rightArmPivot.rotation.z = -0.38 - clap * 0.24;
        h.headPivot.rotation.x = -0.06 + Math.sin(t) * 0.08;
      } else if (h.behavior === 'wave_flag') {
        h.root.position.y = h.baseY + Math.max(0, Math.sin(t * 0.85)) * 0.14;
        h.leftArmPivot.rotation.x = -2.55;
        h.leftArmPivot.rotation.z = -0.35 + Math.sin(t * 1.6) * 0.35;
        h.rightArmPivot.rotation.x = -0.45 + Math.cos(t) * 0.2;
        h.rightArmPivot.rotation.z = 0.15;
        h.root.rotation.y = h.baseRotY + Math.sin(t * 0.5) * 0.1;
      } else {
        // sign_holder: raised holding arms swaying slightly with poles
        const lift = Math.max(0, Math.sin(t * 0.9)) * 0.1;
        h.root.position.y = h.baseY + lift;
        h.leftArmPivot.rotation.x = -2.25;
        h.rightArmPivot.rotation.x = -2.25;
        h.leftArmPivot.rotation.z = -0.1;
        h.rightArmPivot.rotation.z = 0.1;
        h.headPivot.rotation.y = Math.sin(t * 0.65) * 0.18;
      }
    }
  }

  private tGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  private tMat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  public dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos.length = 0;
    this.mats.length = 0;
  }
}

export class BinusCelebrationScene {
  public readonly root = new THREE.Group();
  public readonly crowdController: CrowdCelebrationController;
  public readonly signController: SignAndBannerController;

  constructor(maxAniso: number) {
    this.crowdController = new CrowdCelebrationController();
    this.signController = new SignAndBannerController(maxAniso);
    this.root.add(this.crowdController.root);
    this.root.add(this.signController.root);
  }

  public update(elapsedSec: number): void {
    this.crowdController.update(elapsedSec);
    this.signController.update(elapsedSec);
  }

  public getSummary(): {
    humanCount: number;
    woodenSignCount: number;
    bannerCount: number;
    signTexts: string[];
    bannerTexts: string[];
  } {
    return {
      humanCount: this.crowdController.getHumanCount(),
      woodenSignCount: this.signController.signTexts.length,
      bannerCount: this.signController.bannerTexts.length,
      signTexts: [...this.signController.signTexts],
      bannerTexts: [...this.signController.bannerTexts],
    };
  }

  public dispose(): void {
    this.crowdController.dispose();
    this.signController.dispose();
  }
}
