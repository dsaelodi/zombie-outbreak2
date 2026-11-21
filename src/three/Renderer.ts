import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { logger } from '../utils/logger';

export function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class GameRenderer {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly isSoftwareGl: boolean;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private contextLost = false;
  private onContextLostCb?: (lost: boolean) => void;

  private readonly handleResizeBound = (): void => this.resize();
  private readonly handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    this.onContextLostCb?.(true);
    logger.warn('GameRenderer', 'WebGL context lost');
  };
  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    this.onContextLostCb?.(false);
    logger.warn('GameRenderer', 'WebGL context restored');
  };

  constructor(container: HTMLElement, onContextLost?: (lost: boolean) => void) {
    this.isSoftwareGl = detectSoftwareWebGL();
    this.onContextLostCb = onContextLost;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    container.appendChild(this.renderer.domElement);

    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener(
      'webglcontextrestored',
      this.handleContextRestored
    );
    window.addEventListener('resize', this.handleResizeBound);
  }

  public setupEnvironment(scene: THREE.Scene): void {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.envRenderTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = this.envRenderTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();
  }

  public precompile(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.isSoftwareGl) {
      this.renderer.compile(scene, camera);
    }
  }

  public isContextLost(): boolean {
    return this.contextLost;
  }

  public resize(camera?: THREE.PerspectiveCamera): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (camera) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
  }

  public render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.contextLost) return;
    this.renderer.render(scene, camera);
  }

  public afterSoftwareDraw(callback: () => void): number {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      return window.setTimeout(callback, 80);
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = (): void => {
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        window.setTimeout(callback, 80);
      }
    };
    return window.setTimeout(poll, 5);
  }

  public dispose(): void {
    window.removeEventListener('resize', this.handleResizeBound);
    this.renderer.domElement.removeEventListener(
      'webglcontextlost',
      this.handleContextLost
    );
    this.renderer.domElement.removeEventListener(
      'webglcontextrestored',
      this.handleContextRestored
    );
    this.envRenderTarget?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
