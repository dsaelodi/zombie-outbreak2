import * as THREE from 'three';
import type { Zombie } from '../entities/Zombie';

export interface RaycastHitResult {
  zombie: Zombie;
  zone: 'head' | 'body';
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
}

export class RaycastSystem {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly origin = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();

  constructor() {
    this.raycaster.layers.set(1);
    this.raycaster.far = 110;
  }

  public getAimWorldRay(
    aimX: number,
    aimY: number,
    camera: THREE.Camera
  ): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    this.ndc.set(aimX, aimY);
    this.raycaster.setFromCamera(this.ndc, camera);
    return {
      origin: this.raycaster.ray.origin.clone(),
      dir: this.raycaster.ray.direction.clone().normalize(),
    };
  }

  public castShot(
    aimX: number,
    aimY: number,
    camera: THREE.Camera,
    zombies: Zombie[],
    maxDistance = 110
  ): RaycastHitResult | null {
    this.ndc.set(aimX, aimY);
    this.raycaster.far = maxDistance;
    this.raycaster.setFromCamera(this.ndc, camera);

    const targets: THREE.Object3D[] = [];
    for (const z of zombies) {
      if (z.state === 'dead') continue;
      const boxes = z.getHitboxes();
      for (const b of boxes) targets.push(b);
    }
    if (targets.length === 0) return null;

    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;

    const first = hits[0];
    const zombie = first.object.userData.zombie as Zombie | undefined;
    const zone = (first.object.userData.zone as 'head' | 'body' | undefined) ?? 'body';
    if (!zombie) return null;

    const normal = first.face
      ? first.face.normal.clone().transformDirection(first.object.matrixWorld).normalize()
      : this.raycaster.ray.direction.clone().negate().normalize();

    return {
      zombie,
      zone: zombie.isHeadless && zone === 'head' ? 'body' : zone,
      point: first.point.clone(),
      normal,
      distance: first.distance,
    };
  }

  /**
   * Returns all living zombies within a close-range flamethrower jet cone.
   */
  public castFlameCone(
    aimX: number,
    aimY: number,
    camera: THREE.Camera,
    zombies: Zombie[],
    maxRange = 15,
    coneCosThreshold = 0.88
  ): Array<{ zombie: Zombie; point: THREE.Vector3; distance: number }> {
    this.ndc.set(aimX, aimY);
    this.raycaster.setFromCamera(this.ndc, camera);
    this.origin.copy(this.raycaster.ray.origin);
    this.dir.copy(this.raycaster.ray.direction).normalize();

    const hits: Array<{ zombie: Zombie; point: THREE.Vector3; distance: number }> = [];

    for (const z of zombies) {
      if (z.state === 'dead') continue;
      const yOffset =
        z.variant === 'boss' ? 2.2 : z.variant === 'crawler' ? 0.38 : 1.15;
      const targetCenter = new THREE.Vector3(
        z.root.position.x,
        z.root.position.y + yOffset,
        z.root.position.z
      );
      this.toTarget.subVectors(targetCenter, this.origin);
      const dist = this.toTarget.length();
      if (dist > maxRange + (z.variant === 'boss' ? 1.5 : 0.4)) continue;

      const normDot = dist > 0.01 ? this.toTarget.clone().divideScalar(dist).dot(this.dir) : 1;
      if (normDot >= coneCosThreshold || dist < 3.4) {
        hits.push({ zombie: z, point: targetCenter, distance: dist });
      }
    }

    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }
}
