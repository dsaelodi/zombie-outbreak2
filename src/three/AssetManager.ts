import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { ASSET_CONFIG } from '../data/gameConfig';
import type { ZombieVariant } from '../data/zombies';
import { logger } from '../utils/logger';

interface AssetOverrideManifest {
  zombies?: Partial<Record<ZombieVariant, string | null>>;
  weapon?: string | null;
  environmentProps?: string | null;
}

export interface LoadedModelTemplate {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export class AssetManager {
  private readonly gltfLoader = new GLTFLoader();
  private manifest: AssetOverrideManifest = {};
  private modelCache = new Map<string, LoadedModelTemplate>();
  private initialized = false;

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const res = await fetch('/assets/asset-manifest.json');
      if (res.ok) {
        this.manifest = (await res.json()) as AssetOverrideManifest;
      }
    } catch {
      this.manifest = {};
    }

    const urlsToPreload: string[] = [];
    const zombieVariants: ZombieVariant[] = [
      'basic',
      'runner',
      'armored',
      'mutated',
      'exploder',
      'boss',
    ];
    for (const v of zombieVariants) {
      const path = this.manifest.zombies?.[v];
      if (path) urlsToPreload.push(path);
    }
    if (this.manifest.weapon) urlsToPreload.push(this.manifest.weapon);
    if (this.manifest.environmentProps) urlsToPreload.push(this.manifest.environmentProps);

    await Promise.all(urlsToPreload.map((url) => this.preloadGLTF(url)));
  }

  public async preloadGLTF(url: string): Promise<LoadedModelTemplate | null> {
    if (this.modelCache.has(url)) {
      return this.modelCache.get(url)!;
    }

    try {
      const gltf = await new Promise<GLTF>((resolve, reject) => {
        this.gltfLoader.load(url, resolve, undefined, reject);
      });
      gltf.scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      const template: LoadedModelTemplate = {
        scene: gltf.scene,
        animations: gltf.animations ?? [],
      };
      this.modelCache.set(url, template);
      return template;
    } catch (err) {
      logger.warn('AssetManager', `Failed to load GLTF "${url}", falling back to procedural model`, err);
      return null;
    }
  }

  public instantiateZombieGLTF(variant: ZombieVariant): {
    root: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    actions: Partial<Record<'idle' | 'walk' | 'attack' | 'hit' | 'death', THREE.AnimationAction>>;
  } | null {
    const url = this.manifest.zombies?.[variant];
    if (!url) return null;
    const template = this.modelCache.get(url);
    if (!template) return null;

    const root = cloneSkeleton(template.scene);
    const mixer = new THREE.AnimationMixer(root);
    const actions: Partial<
      Record<'idle' | 'walk' | 'attack' | 'hit' | 'death', THREE.AnimationAction>
    > = {};

    const expected = ASSET_CONFIG.expectedAnimations;
    const findClip = (targetName: string) =>
      template.animations.find(
        (c) => c.name.toLowerCase() === targetName.toLowerCase()
      );

    const mapping: Array<[keyof typeof actions, string]> = [
      ['idle', expected.idle],
      ['walk', expected.walk],
      ['attack', expected.attack],
      ['hit', expected.hit],
      ['death', expected.death],
    ];

    for (const [key, clipName] of mapping) {
      const clip = findClip(clipName);
      if (clip) {
        const action = mixer.clipAction(clip);
        if (key === 'death' || key === 'hit' || key === 'attack') {
          action.loop = THREE.LoopOnce;
          action.clampWhenFinished = true;
        }
        actions[key] = action;
      }
    }

    return { root, mixer, actions };
  }

  public instantiateWeaponGLTF(): THREE.Object3D | null {
    const url = this.manifest.weapon;
    if (!url) return null;
    const template = this.modelCache.get(url);
    if (!template) return null;
    return template.scene.clone(true);
  }

  public dispose(): void {
    this.modelCache.clear();
  }
}
