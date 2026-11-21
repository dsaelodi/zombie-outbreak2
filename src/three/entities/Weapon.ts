import * as THREE from 'three';
import type { WeaponId } from '../../data/weapons';
import { clamp, damp, lerp } from '../../utils/math';
import type { AssetManager } from '../AssetManager';

export class Weapon {
  public readonly root = new THREE.Group();
  private readonly weaponPivot = new THREE.Group();
  private readonly rigs: Record<WeaponId, THREE.Group>;
  private readonly muzzleFlashGroup = new THREE.Group();
  private readonly flameConeGroup = new THREE.Group();
  private readonly muzzleLight: THREE.PointLight;

  // Articulated reloadable parts & support hand
  private readonly supportArmGroup = new THREE.Group();
  private arMagGroup: THREE.Group | null = null;
  private arBoltMesh: THREE.Mesh | null = null;
  private smgMagGroup: THREE.Group | null = null;
  private smgBoltMesh: THREE.Mesh | null = null;
  private flameCanisterGroup: THREE.Group | null = null;
  private flameLatchMesh: THREE.Mesh | null = null;

  private activeWeapon: WeaponId = 'ar';
  private recoilZ = 0;
  private recoilPitch = 0;
  private recoilRoll = 0;
  private muzzleFlashTimer = 0;
  private flameActiveTimer = 0;
  private throwAnimTimer = 0;
  private equipDip = 0;
  private swayTime = 0;
  private transitionCarry = false;

  private aimX = 0;
  private aimY = 0;

  private disposableGeometries: THREE.BufferGeometry[] = [];
  private disposableMaterials: THREE.Material[] = [];

  constructor(camera: THREE.Camera, assetManager: AssetManager) {
    this.root.position.set(0.24, -0.23, -0.48);
    this.root.add(this.weaponPivot);

    this.rigs = {
      ar: new THREE.Group(),
      smg: new THREE.Group(),
      flamethrower: new THREE.Group(),
      grenade: new THREE.Group(),
    };

    const customAR = assetManager.instantiateWeaponGLTF();
    if (customAR) {
      this.rigs.ar.add(customAR);
    } else {
      this.buildProceduralAR(this.rigs.ar);
    }
    this.buildProceduralSMG(this.rigs.smg);
    this.buildProceduralFlamethrower(this.rigs.flamethrower);
    this.buildProceduralGrenade(this.rigs.grenade);
    this.buildSupportHand();

    for (const id of Object.keys(this.rigs) as WeaponId[]) {
      this.rigs[id].visible = id === this.activeWeapon;
      this.weaponPivot.add(this.rigs[id]);
    }

    this.supportArmGroup.visible = false;
    this.weaponPivot.add(this.supportArmGroup);

    // Gunfire muzzle flash
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd27d,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const wingMat = new THREE.MeshBasicMaterial({
      color: 0xffae42,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    const coneGeo = new THREE.ConeGeometry(0.05, 0.22, 6);
    const wingGeo = new THREE.PlaneGeometry(0.18, 0.18);
    this.disposableMaterials.push(flashMat, wingMat);
    this.disposableGeometries.push(coneGeo, wingGeo);

    const cone1 = new THREE.Mesh(coneGeo, flashMat);
    cone1.rotation.x = -Math.PI / 2;
    const wing1 = new THREE.Mesh(wingGeo, wingMat);
    wing1.rotation.z = Math.PI / 4;
    this.muzzleFlashGroup.add(cone1, wing1);
    this.muzzleFlashGroup.position.set(0, 0.052, -0.52);
    this.muzzleFlashGroup.visible = false;
    this.weaponPivot.add(this.muzzleFlashGroup);

    // Flamethrower continuous nozzle jet cone
    const jetOuterGeo = new THREE.ConeGeometry(0.11, 0.72, 10, 1, true);
    const jetInnerGeo = new THREE.ConeGeometry(0.055, 0.45, 8, 1, true);
    const jetOuterMat = new THREE.MeshBasicMaterial({
      color: 0xff5a1f,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const jetInnerMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.disposableGeometries.push(jetOuterGeo, jetInnerGeo);
    this.disposableMaterials.push(jetOuterMat, jetInnerMat);

    const jetOuter = new THREE.Mesh(jetOuterGeo, jetOuterMat);
    jetOuter.rotation.x = Math.PI / 2;
    jetOuter.position.z = -0.36;
    const jetInner = new THREE.Mesh(jetInnerGeo, jetInnerMat);
    jetInner.rotation.x = Math.PI / 2;
    jetInner.position.z = -0.22;
    this.flameConeGroup.add(jetOuter, jetInner);
    this.flameConeGroup.position.set(0, 0.048, -0.55);
    this.flameConeGroup.visible = false;
    this.weaponPivot.add(this.flameConeGroup);

    this.muzzleLight = new THREE.PointLight(0xffb347, 0, 8, 2);
    this.muzzleLight.position.set(0, 0.06, -0.54);
    this.weaponPivot.add(this.muzzleLight);

    camera.add(this.root);
  }

  private addPart(
    target: THREE.Group,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    rot?: [number, number, number]
  ): THREE.Mesh {
    this.disposableGeometries.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    target.add(mesh);
    return mesh;
  }

  private makeMat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial(params);
    this.disposableMaterials.push(m);
    return m;
  }

  private buildSupportHand(): void {
    const sleeveMat = this.makeMat({ color: 0x262b26, roughness: 0.88, metalness: 0.08 });
    const gloveMat = this.makeMat({ color: 0x17191c, roughness: 0.72, metalness: 0.14 });
    this.addPart(
      this.supportArmGroup,
      new THREE.BoxGeometry(0.072, 0.072, 0.24),
      sleeveMat,
      [-0.08, -0.05, 0.12],
      [0.2, -0.45, 0]
    );
    this.addPart(
      this.supportArmGroup,
      new THREE.BoxGeometry(0.065, 0.056, 0.095),
      gloveMat,
      [0, 0, 0]
    );
  }

  private buildProceduralAR(group: THREE.Group): void {
    const darkSteel = this.makeMat({ color: 0x20252b, roughness: 0.38, metalness: 0.85 });
    const tanPolymer = this.makeMat({ color: 0x5c513e, roughness: 0.8, metalness: 0.12 });
    const alloy = this.makeMat({ color: 0x454c54, roughness: 0.3, metalness: 0.88 });
    const opticGlow = this.makeMat({
      color: 0x22c55e,
      emissive: 0x22c55e,
      emissiveIntensity: 1.7,
      roughness: 0.2,
    });

    this.addPart(group, new THREE.BoxGeometry(0.064, 0.068, 0.42), darkSteel, [0, 0.05, -0.08]);
    this.addPart(group, new THREE.BoxGeometry(0.046, 0.015, 0.38), alloy, [0, 0.09, -0.08]);
    this.addPart(group, new THREE.BoxGeometry(0.058, 0.058, 0.26), tanPolymer, [0, 0.048, -0.32]);

    this.addPart(
      group,
      new THREE.CylinderGeometry(0.015, 0.015, 0.24, 10),
      alloy,
      [0, 0.052, -0.5],
      [Math.PI / 2, 0, 0]
    );
    this.addPart(
      group,
      new THREE.CylinderGeometry(0.022, 0.02, 0.065, 8),
      darkSteel,
      [0, 0.052, -0.61],
      [Math.PI / 2, 0, 0]
    );

    this.addPart(group, new THREE.BoxGeometry(0.056, 0.04, 0.28), darkSteel, [0, 0.004, -0.04]);
    this.addPart(group, new THREE.BoxGeometry(0.044, 0.13, 0.062), tanPolymer, [0, -0.07, 0.06], [0.25, 0, 0]);
    this.addPart(group, new THREE.BoxGeometry(0.036, 0.08, 0.048), tanPolymer, [0, -0.022, -0.31], [-0.35, 0, 0]);

    // Removable Stanag Mag Group
    const magGroup = new THREE.Group();
    this.addPart(magGroup, new THREE.BoxGeometry(0.038, 0.18, 0.068), alloy, [0, -0.105, -0.12], [-0.18, 0, 0]);
    group.add(magGroup);
    this.arMagGroup = magGroup;

    // Articulated Charging Handle / Bolt
    this.arBoltMesh = this.addPart(
      group,
      new THREE.BoxGeometry(0.032, 0.016, 0.04),
      alloy,
      [-0.026, 0.072, 0.08]
    );

    // ACOG / Tactical scope + green dot
    this.addPart(
      group,
      new THREE.CylinderGeometry(0.022, 0.024, 0.13, 10),
      darkSteel,
      [0, 0.118, -0.03],
      [Math.PI / 2, 0, 0]
    );
    this.addPart(group, new THREE.BoxGeometry(0.008, 0.008, 0.008), opticGlow, [0, 0.118, 0.032]);
    this.addPart(group, new THREE.BoxGeometry(0.052, 0.095, 0.22), tanPolymer, [0, 0.035, 0.22]);
  }

  private buildProceduralSMG(group: THREE.Group): void {
    const darkSteel = this.makeMat({ color: 0x22272c, roughness: 0.36, metalness: 0.86 });
    const polymer = this.makeMat({ color: 0x15171a, roughness: 0.84, metalness: 0.14 });
    const brushedAlloy = this.makeMat({ color: 0x4b525a, roughness: 0.28, metalness: 0.9 });
    const reticleGlow = this.makeMat({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });

    this.addPart(group, new THREE.BoxGeometry(0.062, 0.064, 0.34), darkSteel, [0, 0.048, -0.04]);
    this.addPart(group, new THREE.BoxGeometry(0.042, 0.014, 0.31), brushedAlloy, [0, 0.085, -0.04]);
    this.addPart(group, new THREE.BoxGeometry(0.056, 0.054, 0.18), polymer, [0, 0.046, -0.27]);
    this.addPart(
      group,
      new THREE.CylinderGeometry(0.015, 0.015, 0.16, 10),
      brushedAlloy,
      [0, 0.05, -0.37],
      [Math.PI / 2, 0, 0]
    );
    this.addPart(
      group,
      new THREE.CylinderGeometry(0.022, 0.022, 0.06, 10),
      darkSteel,
      [0, 0.05, -0.43],
      [Math.PI / 2, 0, 0]
    );
    this.addPart(group, new THREE.BoxGeometry(0.054, 0.038, 0.26), polymer, [0, 0.005, -0.02]);
    this.addPart(group, new THREE.BoxGeometry(0.044, 0.13, 0.062), polymer, [0, -0.068, 0.065], [0.24, 0, 0]);
    this.addPart(
      group,
      new THREE.CylinderGeometry(0.018, 0.021, 0.1, 8),
      polymer,
      [0, -0.032, -0.25],
      [0.08, 0, 0]
    );

    // Removable MP5 Stick Mag Group
    const smgMag = new THREE.Group();
    this.addPart(smgMag, new THREE.BoxGeometry(0.036, 0.24, 0.052), darkSteel, [0, -0.125, -0.115], [-0.14, 0, 0]);
    group.add(smgMag);
    this.smgMagGroup = smgMag;

    // Articulated Forward HK Charging Handle
    this.smgBoltMesh = this.addPart(
      group,
      new THREE.BoxGeometry(0.035, 0.018, 0.022),
      brushedAlloy,
      [-0.035, 0.068, -0.24]
    );

    this.addPart(group, new THREE.BoxGeometry(0.048, 0.036, 0.068), darkSteel, [0, 0.108, -0.01]);
    this.addPart(group, new THREE.BoxGeometry(0.006, 0.006, 0.006), reticleGlow, [0, 0.11, -0.01]);
    this.addPart(group, new THREE.BoxGeometry(0.058, 0.085, 0.022), polymer, [0, 0.025, 0.22]);
  }

  private buildProceduralFlamethrower(group: THREE.Group): void {
    const oliveTank = this.makeMat({ color: 0x4b5638, roughness: 0.6, metalness: 0.45 });
    const hazardOrange = this.makeMat({ color: 0xd97706, roughness: 0.48, metalness: 0.4 });
    const brass = this.makeMat({ color: 0xb48a3e, roughness: 0.35, metalness: 0.85 });
    const charredSteel = this.makeMat({ color: 0x24272b, roughness: 0.5, metalness: 0.8 });
    const pilotGlow = this.makeMat({
      color: 0xff7b00,
      emissive: 0xff5500,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });

    this.addPart(group, new THREE.BoxGeometry(0.085, 0.082, 0.36), charredSteel, [0, 0.045, -0.06]);

    // Removable Pressurized Fuel Canister Group
    const canisterGroup = new THREE.Group();
    this.addPart(
      canisterGroup,
      new THREE.CylinderGeometry(0.052, 0.052, 0.28, 12),
      hazardOrange,
      [0, -0.055, -0.14],
      [Math.PI / 2, 0, 0]
    );
    this.addPart(
      canisterGroup,
      new THREE.CylinderGeometry(0.054, 0.054, 0.04, 12),
      charredSteel,
      [0, -0.055, -0.25],
      [Math.PI / 2, 0, 0]
    );
    group.add(canisterGroup);
    this.flameCanisterGroup = canisterGroup;

    // Rotating Fuel Locking Latch
    this.flameLatchMesh = this.addPart(
      group,
      new THREE.BoxGeometry(0.026, 0.052, 0.08),
      brass,
      [-0.055, -0.015, -0.14]
    );

    this.addPart(
      group,
      new THREE.CylinderGeometry(0.048, 0.048, 0.12, 12),
      oliveTank,
      [-0.065, -0.02, -0.04],
      [Math.PI / 2, 0, 0]
    );
    this.addPart(
      group,
      new THREE.CylinderGeometry(0.022, 0.024, 0.32, 10),
      charredSteel,
      [0, 0.048, -0.39],
      [Math.PI / 2, 0, 0]
    );
    this.addPart(
      group,
      new THREE.CylinderGeometry(0.032, 0.032, 0.07, 10),
      brass,
      [0, 0.048, -0.53],
      [Math.PI / 2, 0, 0]
    );
    this.addPart(group, new THREE.SphereGeometry(0.015, 8, 8), pilotGlow, [0, 0.022, -0.55]);
    this.addPart(group, new THREE.BoxGeometry(0.048, 0.13, 0.064), oliveTank, [0, -0.062, 0.08], [0.22, 0, 0]);
  }

  private buildProceduralGrenade(group: THREE.Group): void {
    const oliveBody = this.makeMat({ color: 0x3b4d32, roughness: 0.65, metalness: 0.35 });
    const darkMetal = this.makeMat({ color: 0x22252a, roughness: 0.4, metalness: 0.85 });
    const brassPin = this.makeMat({ color: 0xeab308, roughness: 0.3, metalness: 0.9 });
    const indicatorMat = this.makeMat({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.5,
      roughness: 0.25,
    });

    this.addPart(group, new THREE.SphereGeometry(0.072, 10, 8), oliveBody, [-0.04, 0.02, -0.06]);
    this.addPart(group, new THREE.CylinderGeometry(0.024, 0.028, 0.045, 8), darkMetal, [-0.04, 0.095, -0.06]);
    this.addPart(group, new THREE.BoxGeometry(0.014, 0.075, 0.03), darkMetal, [-0.01, 0.065, -0.06], [0, 0, -0.25]);
    this.addPart(group, new THREE.TorusGeometry(0.018, 0.004, 6, 14), brassPin, [-0.068, 0.095, -0.045]);
    this.addPart(group, new THREE.SphereGeometry(0.009, 6, 6), indicatorMat, [-0.04, 0.118, -0.06]);
  }

  private resetReloadPartTransforms(): void {
    this.supportArmGroup.visible = false;
    if (this.arMagGroup) {
      this.arMagGroup.position.set(0, 0, 0);
      this.arMagGroup.rotation.set(0, 0, 0);
      this.arMagGroup.visible = true;
    }
    if (this.arBoltMesh) this.arBoltMesh.position.z = 0.08;
    if (this.smgMagGroup) {
      this.smgMagGroup.position.set(0, 0, 0);
      this.smgMagGroup.rotation.set(0, 0, 0);
      this.smgMagGroup.visible = true;
    }
    if (this.smgBoltMesh) {
      this.smgBoltMesh.position.set(-0.035, 0.068, -0.24);
    }
    if (this.flameCanisterGroup) {
      this.flameCanisterGroup.position.set(0, 0, 0);
      this.flameCanisterGroup.rotation.set(0, 0, 0);
      this.flameCanisterGroup.visible = true;
    }
    if (this.flameLatchMesh) {
      this.flameLatchMesh.rotation.z = 0;
    }
  }

  public setActiveWeapon(id: WeaponId): void {
    if (this.activeWeapon === id) return;
    this.activeWeapon = id;
    for (const key of Object.keys(this.rigs) as WeaponId[]) {
      this.rigs[key].visible = key === id;
    }
    this.muzzleFlashGroup.visible = false;
    this.flameConeGroup.visible = false;
    this.muzzleLight.intensity = 0;
    this.equipDip = 0.18;
    this.resetReloadPartTransforms();
  }

  public setTransitionCarry(active: boolean): void {
    this.transitionCarry = active;
  }

  public setAim(aimX: number, aimY: number): void {
    this.aimX = aimX;
    this.aimY = aimY;
  }

  public triggerFire(weaponId: WeaponId): void {
    if (weaponId === 'flamethrower') {
      this.flameActiveTimer = 0.16;
      this.flameConeGroup.visible = true;
      this.muzzleLight.color.setHex(0xff6b1a);
      this.muzzleLight.intensity = 6.5;
      this.recoilZ = Math.min(0.035, this.recoilZ + 0.014);
      return;
    }

    if (weaponId === 'grenade') {
      this.throwAnimTimer = 0.34;
      this.recoilPitch = 0.22;
      return;
    }

    const isAR = weaponId === 'ar';
    this.recoilZ = Math.min(0.095, this.recoilZ + (isAR ? 0.056 : 0.036));
    this.recoilPitch = Math.min(0.18, this.recoilPitch + (isAR ? 0.09 : 0.06));
    this.recoilRoll = (Math.random() - 0.5) * (isAR ? 0.05 : 0.038);
    this.muzzleFlashTimer = 0.048;
    this.muzzleFlashGroup.visible = true;
    this.muzzleFlashGroup.position.z = isAR ? -0.64 : -0.47;
    this.muzzleFlashGroup.rotation.z = Math.random() * Math.PI * 2;
    this.muzzleLight.color.setHex(0xffb347);
    this.muzzleLight.intensity = isAR ? 6.2 : 4.8;
  }

  public update(
    dtSec: number,
    isReloading: boolean,
    grenadeCooldownSec = 0,
    reloadProgress = 0
  ): void {
    this.swayTime += dtSec;

    this.recoilZ = damp(this.recoilZ, 0, 22, dtSec);
    this.recoilPitch = damp(this.recoilPitch, 0, 20, dtSec);
    this.recoilRoll = damp(this.recoilRoll, 0, 20, dtSec);
    this.equipDip = damp(this.equipDip, 0, 12, dtSec);

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dtSec;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleFlashGroup.visible = false;
        if (this.flameActiveTimer <= 0) {
          this.muzzleLight.intensity = 0;
        }
      }
    }

    if (this.flameActiveTimer > 0) {
      this.flameActiveTimer -= dtSec;
      const flicker = 0.85 + Math.random() * 0.35;
      this.flameConeGroup.scale.set(flicker, flicker, 0.9 + Math.random() * 0.3);
      this.flameConeGroup.rotation.z += dtSec * 14;
      this.muzzleLight.intensity = 5 + Math.random() * 2.5;
      if (this.flameActiveTimer <= 0) {
        this.flameConeGroup.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    let throwForwardZ = 0;
    let throwLiftY = 0;
    if (this.throwAnimTimer > 0) {
      this.throwAnimTimer = Math.max(0, this.throwAnimTimer - dtSec);
      const p = 1 - this.throwAnimTimer / 0.34;
      throwForwardZ = -Math.sin(p * Math.PI) * 0.24;
      throwLiftY = Math.sin(p * Math.PI) * 0.1;
    }

    if (this.activeWeapon === 'grenade') {
      this.rigs.grenade.visible = grenadeCooldownSec <= 2.35;
    }

    // Physical weapon-specific reload choreography
    let rPitch = 0;
    let rYaw = 0;
    let rRoll = 0;
    let rDropY = 0;

    if (isReloading && this.activeWeapon !== 'grenade') {
      const p = clamp(reloadProgress, 0, 1);
      this.supportArmGroup.visible = true;

      if (this.activeWeapon === 'ar') {
        const cantEnv = Math.sin(clamp(p / 0.92, 0, 1) * Math.PI);
        rRoll = cantEnv * 0.48;
        rPitch = cantEnv * 0.22;
        rYaw = cantEnv * 0.26;
        rDropY = cantEnv * 0.04;

        // Mag remove (0.14..0.38) -> offscreen swap (0.38..0.52) -> mag insert (0.52..0.72)
        if (this.arMagGroup) {
          if (p < 0.16) {
            const u = p / 0.16;
            this.arMagGroup.position.set(0, -0.02 * u, 0);
            this.supportArmGroup.position.set(lerp(-0.22, -0.02, u), lerp(-0.26, -0.14, u), lerp(0.02, -0.12, u));
          } else if (p < 0.42) {
            const u = (p - 0.16) / 0.26;
            this.arMagGroup.position.set(0, -0.02 - u * 0.34, u * 0.04);
            this.supportArmGroup.position.set(0, -0.14 - u * 0.26, -0.12);
          } else if (p < 0.72) {
            const u = (p - 0.42) / 0.3;
            this.arMagGroup.position.set(0, -0.34 * (1 - u), 0.04 * (1 - u));
            this.supportArmGroup.position.set(0, -0.38 + u * 0.24, -0.12);
          } else if (p < 0.90) {
            const u = (p - 0.72) / 0.18;
            this.arMagGroup.position.set(0, 0, 0);
            const pull = Math.sin(u * Math.PI);
            if (this.arBoltMesh) this.arBoltMesh.position.z = 0.08 + pull * 0.065;
            this.supportArmGroup.position.set(-0.06, lerp(-0.14, 0.075, Math.min(1, u * 1.4)), lerp(-0.12, 0.09 + pull * 0.05, u));
          } else {
            const u = (p - 0.90) / 0.1;
            if (this.arBoltMesh) this.arBoltMesh.position.z = 0.08;
            this.supportArmGroup.position.set(lerp(-0.06, -0.24, u), lerp(0.075, -0.26, u), lerp(0.09, 0.05, u));
          }
        }
      } else if (this.activeWeapon === 'smg') {
        const cantEnv = Math.sin(clamp(p / 0.94, 0, 1) * Math.PI);
        rRoll = cantEnv * 0.54;
        rPitch = cantEnv * 0.16;
        rYaw = cantEnv * 0.32;
        rDropY = cantEnv * 0.035;

        if (this.smgMagGroup) {
          if (p < 0.18) {
            const u = p / 0.18;
            this.smgMagGroup.position.set(0, -0.02 * u, 0);
            this.supportArmGroup.position.set(lerp(-0.2, -0.02, u), lerp(-0.24, -0.16, u), -0.12);
          } else if (p < 0.44) {
            const u = (p - 0.18) / 0.26;
            this.smgMagGroup.position.set(0, -0.02 - u * 0.36, 0);
            this.supportArmGroup.position.set(0, -0.16 - u * 0.24, -0.12);
          } else if (p < 0.72) {
            const u = (p - 0.44) / 0.28;
            this.smgMagGroup.position.set(0, -0.36 * (1 - u), 0);
            this.supportArmGroup.position.set(0, -0.38 + u * 0.22, -0.12);
          } else if (p < 0.91) {
            // MP5 Charging Handle slap
            const u = (p - 0.72) / 0.19;
            this.smgMagGroup.position.set(0, 0, 0);
            const slap = Math.sin(u * Math.PI);
            if (this.smgBoltMesh) {
              this.smgBoltMesh.position.set(-0.035, 0.068 - slap * 0.012, -0.24 + slap * 0.05);
            }
            this.supportArmGroup.position.set(-0.08, lerp(-0.16, 0.065, Math.min(1, u * 1.5)), lerp(-0.12, -0.23 + slap * 0.04, u));
          } else {
            const u = (p - 0.91) / 0.09;
            if (this.smgBoltMesh) this.smgBoltMesh.position.set(-0.035, 0.068, -0.24);
            this.supportArmGroup.position.set(lerp(-0.08, -0.24, u), lerp(0.065, -0.26, u), lerp(-0.22, 0.02, u));
          }
        }
      } else if (this.activeWeapon === 'flamethrower') {
        const cantEnv = Math.sin(clamp(p / 0.95, 0, 1) * Math.PI);
        rRoll = -cantEnv * 0.48;
        rPitch = cantEnv * 0.28;
        rYaw = -cantEnv * 0.22;
        rDropY = cantEnv * 0.055;

        if (this.flameCanisterGroup) {
          if (p < 0.20) {
            const u = p / 0.20;
            if (this.flameLatchMesh) this.flameLatchMesh.rotation.z = u * 0.75;
            this.supportArmGroup.position.set(lerp(-0.22, -0.06, u), lerp(-0.24, -0.05, u), -0.14);
          } else if (p < 0.46) {
            const u = (p - 0.20) / 0.26;
            this.flameCanisterGroup.position.set(-u * 0.06, -u * 0.34, 0);
            this.flameCanisterGroup.rotation.z = u * 0.35;
            this.supportArmGroup.position.set(-0.06, -0.05 - u * 0.28, -0.14);
          } else if (p < 0.74) {
            const u = (p - 0.46) / 0.28;
            this.flameCanisterGroup.position.set(-0.06 * (1 - u), -0.34 * (1 - u), 0);
            this.flameCanisterGroup.rotation.z = 0.35 * (1 - u);
            this.supportArmGroup.position.set(-0.04, -0.33 + u * 0.26, -0.14);
          } else {
            const u = (p - 0.74) / 0.26;
            this.flameCanisterGroup.position.set(0, 0, 0);
            this.flameCanisterGroup.rotation.z = 0;
            if (this.flameLatchMesh) this.flameLatchMesh.rotation.z = 0.75 * (1 - Math.min(1, u * 1.6));
            this.supportArmGroup.position.set(lerp(-0.06, -0.25, u), lerp(-0.04, -0.26, u), lerp(-0.14, 0.04, u));
            if (u < 0.45) {
              this.muzzleLight.color.setHex(0xff7b00);
              this.muzzleLight.intensity = 2.6;
            } else if (this.flameActiveTimer <= 0 && this.muzzleFlashTimer <= 0) {
              this.muzzleLight.intensity = 0;
            }
          }
        }
      }
    } else {
      this.resetReloadPartTransforms();
    }

    const idleBobX = Math.cos(this.swayTime * (this.transitionCarry ? 4.4 : 1.4)) * (this.transitionCarry ? 0.012 : 0.004);
    const idleBobY = Math.sin(this.swayTime * (this.transitionCarry ? 8.8 : 2.8)) * (this.transitionCarry ? 0.014 : 0.004);

    const carryPitch = this.transitionCarry ? -0.32 : 0;
    const carryYaw = this.transitionCarry ? 0.28 : 0;

    const targetYaw = -this.aimX * 0.34 + carryYaw + rYaw;
    const targetPitch = this.aimY * 0.28 + this.recoilPitch + rPitch + carryPitch;

    this.weaponPivot.rotation.y = damp(this.weaponPivot.rotation.y, targetYaw, 20, dtSec);
    this.weaponPivot.rotation.x = damp(this.weaponPivot.rotation.x, targetPitch, 20, dtSec);
    this.weaponPivot.rotation.z = damp(
      this.weaponPivot.rotation.z,
      this.recoilRoll + rRoll,
      16,
      dtSec
    );

    this.weaponPivot.position.set(
      idleBobX + this.aimX * 0.06,
      idleBobY +
        this.aimY * 0.03 -
        rDropY -
        this.equipDip -
        (this.transitionCarry ? 0.04 : 0) +
        throwLiftY,
      this.recoilZ + throwForwardZ
    );
  }

  public dispose(camera: THREE.Camera): void {
    camera.remove(this.root);
    for (const g of this.disposableGeometries) g.dispose();
    for (const m of this.disposableMaterials) m.dispose();
  }
}
