import * as THREE from 'three';

export interface AssetTrackerLike {
  geo<T extends THREE.BufferGeometry>(g: T): T;
  mat<T extends THREE.Material>(m: T): T;
}

export interface ContainmentTubeOptions {
  x: number;
  z: number;
  rotY?: number;
  poseVariant?: 0 | 1 | 2;
  fluidColor?: number;
  warningColor?: number;
  scale?: number;
  shattered?: boolean;
  labelSeed?: number;
}

export interface ContainmentTubeHandle {
  group: THREE.Group;
  subjectRoot: THREE.Group | null;
  bubbles: THREE.Mesh[];
  phaseOffset: number;
}

/**
 * Builds an atmospheric low-poly laboratory containment cylinder housing an
 * anatomically recognizable human test subject in patient attire, complete with
 * fluid tint, rising air bubbles, internal glow, connecting pipes/cables, and warning LEDs.
 */
export function buildContainmentTube(
  tracker: AssetTrackerLike,
  opts: ContainmentTubeOptions
): ContainmentTubeHandle {
  const s = opts.scale ?? 1.0;
  const pose = opts.poseVariant ?? 0;
  const fluidHex = opts.fluidColor ?? 0x10b981;
  const warnHex = opts.warningColor ?? 0x22d3ee;

  const group = new THREE.Group();
  group.position.set(opts.x, 0, opts.z);
  group.rotation.y = opts.rotY ?? 0;
  group.scale.setScalar(s);

  const metalMat = tracker.mat(
    new THREE.MeshStandardMaterial({ color: 0x2c3640, roughness: 0.48, metalness: 0.62 })
  );
  const pipeMat = tracker.mat(
    new THREE.MeshStandardMaterial({ color: 0x1e252c, roughness: 0.42, metalness: 0.72 })
  );
  const cableMat = tracker.mat(
    new THREE.MeshStandardMaterial({ color: 0x111519, roughness: 0.85 })
  );
  const warnMat = tracker.mat(
    new THREE.MeshStandardMaterial({
      color: warnHex,
      emissive: warnHex,
      emissiveIntensity: 1.65,
      roughness: 0.3,
    })
  );

  // Heavy cylindrical base pedestal & top cap manifold
  const capB = new THREE.Mesh(tracker.geo(new THREE.CylinderGeometry(0.92, 0.98, 0.46, 12)), metalMat);
  capB.position.y = 0.23;
  const collarB = new THREE.Mesh(tracker.geo(new THREE.CylinderGeometry(0.84, 0.88, 0.14, 12)), pipeMat);
  collarB.position.y = 0.52;

  const capT = new THREE.Mesh(tracker.geo(new THREE.CylinderGeometry(0.96, 0.92, 0.46, 12)), metalMat);
  capT.position.y = 4.62;
  const collarT = new THREE.Mesh(tracker.geo(new THREE.CylinderGeometry(0.86, 0.84, 0.14, 12)), pipeMat);
  collarT.position.y = 4.34;
  group.add(capB, collarB, capT, collarT);

  // Twin side structural support struts & conduit pipes
  const strutGeo = tracker.geo(new THREE.CylinderGeometry(0.06, 0.06, 4.15, 7));
  for (const angle of [0.85, Math.PI - 0.85, -0.85, -Math.PI + 0.85]) {
    const strut = new THREE.Mesh(strutGeo, pipeMat);
    strut.position.set(Math.cos(angle) * 0.88, 2.45, Math.sin(angle) * 0.88);
    group.add(strut);
  }

  // Diagnostic plaque + status LED on front base
  const plaque = new THREE.Mesh(tracker.geo(new THREE.BoxGeometry(0.54, 0.22, 0.08)), pipeMat);
  plaque.position.set(0, 0.34, 0.92);
  const led = new THREE.Mesh(tracker.geo(new THREE.BoxGeometry(0.14, 0.06, 0.09)), warnMat);
  led.position.set(0.16, 0.38, 0.94);
  group.add(plaque, led);

  // Floor power/coolant umbilical cables snaking outward
  for (const side of [-1, 1]) {
    const cable = new THREE.Mesh(tracker.geo(new THREE.CylinderGeometry(0.045, 0.045, 1.35, 6)), cableMat);
    cable.rotation.z = Math.PI / 2;
    cable.rotation.y = side * 0.35;
    cable.position.set(side * 1.15, 0.05, 0.25);
    group.add(cable);
  }

  if (opts.shattered) {
    const brokenMat = tracker.mat(
      new THREE.MeshStandardMaterial({
        color: fluidHex,
        emissive: fluidHex,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      })
    );
    const stump = new THREE.Mesh(
      tracker.geo(new THREE.CylinderGeometry(0.8, 0.8, 1.1, 10, 1, true)),
      brokenMat
    );
    stump.position.y = 1.05;
    group.add(stump);
    return { group, subjectRoot: null, bubbles: [], phaseOffset: opts.labelSeed ?? 0 };
  }

  // Soft glowing nutrient core light inside tube
  const glowMat = tracker.mat(
    new THREE.MeshBasicMaterial({
      color: fluidHex,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    })
  );
  const innerFluid = new THREE.Mesh(tracker.geo(new THREE.CylinderGeometry(0.68, 0.68, 3.72, 10)), glowMat);
  innerFluid.position.y = 2.42;
  group.add(innerFluid);

  // Human Test Subject Silhouette (Recognizable unmutated human in hospital gown)
  const subjectRoot = new THREE.Group();
  subjectRoot.position.set(0, 2.38, 0);

  const skinMat = tracker.mat(
    new THREE.MeshStandardMaterial({ color: 0xc2aa97, roughness: 0.72, metalness: 0.04 })
  );
  const hairMat = tracker.mat(
    new THREE.MeshStandardMaterial({ color: 0x26211e, roughness: 0.88 })
  );
  const gownMat = tracker.mat(
    new THREE.MeshStandardMaterial({ color: 0x8ea7ad, roughness: 0.82 })
  );
  const eyeLineMat = tracker.mat(
    new THREE.MeshStandardMaterial({ color: 0x2b2421, roughness: 0.9 })
  );

  // Torso in pale patient gown + lower tunic skirt
  const torso = new THREE.Mesh(tracker.geo(new THREE.BoxGeometry(0.42, 0.56, 0.24)), gownMat);
  torso.position.y = 0.08;
  const tunicHem = new THREE.Mesh(tracker.geo(new THREE.CylinderGeometry(0.22, 0.27, 0.34, 8)), gownMat);
  tunicHem.position.y = -0.32;
  subjectRoot.add(torso, tunicHem);

  // Neck + Human Head (slightly slumped / suspended)
  const neck = new THREE.Mesh(tracker.geo(new THREE.CylinderGeometry(0.075, 0.085, 0.14, 7)), skinMat);
  neck.position.set(0, 0.41, 0.02);
  const head = new THREE.Group();
  head.position.set(0, 0.57, 0.04);
  head.rotation.set(pose === 2 ? -0.18 : 0.26, pose === 1 ? 0.22 : -0.14, 0.08);
  const cranium = new THREE.Mesh(tracker.geo(new THREE.BoxGeometry(0.24, 0.27, 0.25)), skinMat);
  const hairCap = new THREE.Mesh(tracker.geo(new THREE.BoxGeometry(0.25, 0.09, 0.26)), hairMat);
  hairCap.position.y = 0.11;
  const eyeL = new THREE.Mesh(tracker.geo(new THREE.BoxGeometry(0.045, 0.018, 0.02)), eyeLineMat);
  eyeL.position.set(-0.055, 0.02, 0.125);
  const eyeR = new THREE.Mesh(tracker.geo(new THREE.BoxGeometry(0.045, 0.018, 0.02)), eyeLineMat);
  eyeR.position.set(0.055, 0.02, 0.125);
  head.add(cranium, hairCap, eyeL, eyeR);
  subjectRoot.add(neck, head);

  // Arms + Forearms + Hands
  const upperArmGeo = tracker.geo(new THREE.BoxGeometry(0.11, 0.32, 0.11));
  const foreArmGeo = tracker.geo(new THREE.BoxGeometry(0.095, 0.3, 0.095));
  for (const side of [-1, 1]) {
    const armG = new THREE.Group();
    armG.position.set(side * 0.28, 0.3, 0);
    const upper = new THREE.Mesh(upperArmGeo, gownMat);
    upper.position.y = -0.14;
    const fore = new THREE.Mesh(foreArmGeo, skinMat);
    fore.position.set(0, -0.4, 0.06);
    fore.rotation.x = -0.35;
    armG.add(upper, fore);

    if (pose === 0) {
      armG.rotation.z = side * 0.26;
      armG.rotation.x = -0.22;
    } else if (pose === 1) {
      armG.rotation.z = side * 0.12;
      armG.rotation.x = -0.68;
    } else {
      armG.rotation.z = side * 0.38;
      armG.rotation.x = -0.1;
    }
    subjectRoot.add(armG);
  }

  // Suspended Human Legs + Feet
  const thighGeo = tracker.geo(new THREE.BoxGeometry(0.14, 0.38, 0.14));
  const shinGeo = tracker.geo(new THREE.BoxGeometry(0.115, 0.38, 0.12));
  for (const side of [-1, 1]) {
    const legG = new THREE.Group();
    legG.position.set(side * 0.11, -0.46, 0);
    const thigh = new THREE.Mesh(thighGeo, skinMat);
    thigh.position.y = -0.18;
    const shin = new THREE.Mesh(shinGeo, skinMat);
    shin.position.set(0, -0.52, -0.04);
    shin.rotation.x = 0.18;
    legG.add(thigh, shin);
    legG.rotation.x = pose === 1 ? -0.18 : 0.08 * side;
    subjectRoot.add(legG);
  }

  // Respiration mask & umbilical oxygen hose to upper tank cap
  const mask = new THREE.Mesh(tracker.geo(new THREE.BoxGeometry(0.11, 0.09, 0.08)), pipeMat);
  mask.position.set(0, 0.51, 0.18);
  const hose = new THREE.Mesh(tracker.geo(new THREE.CylinderGeometry(0.02, 0.02, 1.38, 5)), cableMat);
  hose.position.set(0.06, 1.25, 0.12);
  subjectRoot.add(mask, hose);

  group.add(subjectRoot);

  // Rising air bubbles suspended inside fluid
  const bubbleMat = tracker.mat(
    new THREE.MeshBasicMaterial({
      color: 0xd1fae5,
      transparent: true,
      opacity: 0.65,
    })
  );
  const bubbles: THREE.Mesh[] = [];
  const bubbleGeo = tracker.geo(new THREE.SphereGeometry(0.032, 6, 5));
  for (let b = 0; b < 6; b++) {
    const bm = new THREE.Mesh(bubbleGeo, bubbleMat);
    const ang = b * 1.15 + (opts.labelSeed ?? 0);
    const rad = 0.32 + (b % 3) * 0.11;
    bm.position.set(Math.cos(ang) * rad, 0.8 + (b / 6) * 3.1, Math.sin(ang) * rad);
    bm.userData = { baseY: bm.position.y };
    group.add(bm);
    bubbles.push(bm);
  }

  // Outer cylindrical glass housing (rendered cleanly over suspended subject)
  const glassMat = tracker.mat(
    new THREE.MeshStandardMaterial({
      color: fluidHex,
      emissive: fluidHex,
      emissiveIntensity: 0.55,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    })
  );
  const outerGlass = new THREE.Mesh(tracker.geo(new THREE.CylinderGeometry(0.8, 0.8, 3.85, 14)), glassMat);
  outerGlass.position.y = 2.42;
  group.add(outerGlass);

  return {
    group,
    subjectRoot,
    bubbles,
    phaseOffset: (opts.labelSeed ?? 0) * 1.3 + Math.abs(opts.z) * 0.17,
  };
}

/**
 * Updates subtle float & rising bubble animations for suspended human test subjects.
 */
export function updateContainmentTubes(
  tubes: ContainmentTubeHandle[],
  dtSec: number,
  elapsedSec: number
): void {
  for (const t of tubes) {
    if (t.subjectRoot) {
      t.subjectRoot.position.y = 2.38 + Math.sin(elapsedSec * 1.15 + t.phaseOffset) * 0.08;
      t.subjectRoot.rotation.y = Math.sin(elapsedSec * 0.45 + t.phaseOffset) * 0.08;
    }
    for (let i = 0; i < t.bubbles.length; i++) {
      const bm = t.bubbles[i];
      bm.position.y += dtSec * (0.45 + (i % 3) * 0.14);
      if (bm.position.y > 4.15) {
        bm.position.y = 0.72;
      }
    }
  }
}
