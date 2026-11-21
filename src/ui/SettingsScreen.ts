import { audioManager } from '../audio/AudioManager';
import type { AudioCategory } from '../audio/AudioManifest';
import {
  DEFAULT_USER_SETTINGS,
  type CrowdDensityLevel,
  type UserSettings,
} from '../data/gameConfig';

export class SettingsModal {
  private overlay: HTMLDivElement | null = null;

  constructor(
    private getSettings: () => UserSettings,
    private onSaveSettings: (next: UserSettings) => void,
    private onClose?: () => void
  ) {}

  public open(parent: HTMLElement = document.body): void {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.className =
      'fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6';
    overlay.setAttribute('data-ui-interactive', 'true');

    const audio = audioManager.getSettings();
    const user = this.getSettings();

    overlay.innerHTML = `
      <div class="screen-panel w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 md:p-8 shadow-2xl">
        <div class="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
          <div>
            <h2 class="font-horror text-3xl md:text-4xl text-[#f4efe9] uppercase">Settings</h2>
            <p class="text-sm text-[#9ba1a6] mt-1">Audio levels, arena horde density, right-hand finger-gun thresholds &amp; stabilization</p>
          </div>
          <button type="button" data-action="close" class="btn-secondary px-4 py-2 text-sm font-semibold">Close</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
          <!-- Audio Settings -->
          <div class="space-y-4">
            <div class="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 class="font-display text-xl font-semibold tracking-wide text-white uppercase">Audio</h3>
              <label class="flex items-center gap-2 text-sm text-[#eceae4] cursor-pointer">
                <input type="checkbox" data-audio="muted" ${audio.muted ? 'checked' : ''} class="w-4 h-4 accent-[#c92a2a]" />
                <span>Mute All</span>
              </label>
            </div>

            ${this.renderSlider('Master Volume', 'masterVolume', audio.masterVolume)}
            ${this.renderSlider('SFX Volume', 'sfxVolume', audio.sfxVolume)}
            ${this.renderSlider('Music Volume', 'musicVolume', audio.musicVolume)}
            ${this.renderSlider('Ambient Volume', 'ambientVolume', audio.ambientVolume)}
            ${this.renderSlider('UI Volume', 'uiVolume', audio.uiVolume)}

            <div class="pt-2">
              <div class="text-xs font-semibold text-[#9ba1a6] uppercase tracking-wider mb-2">Active Audio Channels</div>
              <div class="grid grid-cols-2 gap-2 text-sm">
                ${(['sfx', 'music', 'ambient', 'ui'] as AudioCategory[])
                  .map(
                    (cat) => `
                  <label class="flex items-center gap-2 text-[#eceae4] cursor-pointer">
                    <input type="checkbox" data-cat="${cat}" ${audio.enabledCategories[cat] ? 'checked' : ''} class="w-4 h-4 accent-[#c92a2a]" />
                    <span class="capitalize">${cat === 'sfx' ? 'SFX' : cat === 'ui' ? 'UI' : cat}</span>
                  </label>
                `
                  )
                  .join('')}
              </div>
            </div>
          </div>

          <!-- Pose & Arena Performance Tuning -->
          <div class="space-y-4">
            <div class="border-b border-white/10 pb-2">
              <h3 class="font-display text-xl font-semibold tracking-wide text-white uppercase">Controls &amp; Performance</h3>
            </div>

            <div>
              <div class="flex justify-between text-sm mb-1.5">
                <span class="text-[#eceae4]">Aim Sensitivity</span>
                <span class="font-mono-num text-[#d97706]" data-val="aimSensitivity">${user.aimSensitivity.toFixed(2)}x</span>
              </div>
              <input type="range" min="0.6" max="2.5" step="0.05" value="${user.aimSensitivity}" data-user="aimSensitivity" class="tactical-slider w-full" />
            </div>

            <div>
              <div class="flex justify-between text-sm mb-1.5">
                <span class="text-[#eceae4]">Aim Stabilization (Smooth)</span>
                <span class="font-mono-num text-[#d97706]" data-val="aimSmoothing">${Math.round(user.aimSmoothing * 100)}%</span>
              </div>
              <input type="range" min="0.2" max="0.9" step="0.05" value="${user.aimSmoothing}" data-user="aimSmoothing" class="tactical-slider w-full" />
              <p class="text-xs text-[#9ba1a6] mt-1">Higher values filter out hand shake and trigger-pull jitter.</p>
            </div>

            <div>
              <div class="flex justify-between text-sm mb-1.5">
                <span class="text-[#eceae4]">Index Trigger Curl Angle</span>
                <span class="font-mono-num text-[#d97706]" data-val="triggerCurlAngleDeg">${user.triggerCurlAngleDeg}°</span>
              </div>
              <input type="range" min="100" max="148" step="1" value="${user.triggerCurlAngleDeg}" data-user="triggerCurlAngleDeg" class="tactical-slider w-full" />
              <p class="text-xs text-[#9ba1a6] mt-1">Pull right index finger below this angle to hold fire.</p>
            </div>

            <div>
              <div class="flex justify-between text-sm mb-1.5">
                <span class="text-[#eceae4]">Index Release Angle</span>
                <span class="font-mono-num text-[#d97706]" data-val="triggerReleaseAngleDeg">${user.triggerReleaseAngleDeg}°</span>
              </div>
              <input type="range" min="132" max="170" step="1" value="${user.triggerReleaseAngleDeg}" data-user="triggerReleaseAngleDeg" class="tactical-slider w-full" />
              <p class="text-xs text-[#9ba1a6] mt-1">Straighten index finger above this angle to stop firing.</p>
            </div>

            <div>
              <div class="flex justify-between text-sm mb-1.5">
                <span class="text-[#eceae4]">Camera Shake Intensity</span>
                <span class="font-mono-num text-[#d97706]" data-val="cameraShakeIntensity">${Math.round(user.cameraShakeIntensity * 100)}%</span>
              </div>
              <input type="range" min="0" max="1.5" step="0.05" value="${user.cameraShakeIntensity}" data-user="cameraShakeIntensity" class="tactical-slider w-full" />
            </div>

            <div>
              <label class="flex items-center justify-between text-sm text-[#eceae4]">
                <span>Arena Horde Density (Stage 4)</span>
                <select data-user-select="crowdDensity" class="bg-[#12161b] border border-white/20 px-2.5 py-1 text-xs font-mono-num text-white">
                  <option value="low" ${user.crowdDensity === 'low' ? 'selected' : ''}>Low (600)</option>
                  <option value="medium" ${user.crowdDensity === 'medium' ? 'selected' : ''}>Medium (1200)</option>
                  <option value="high" ${user.crowdDensity === 'high' ? 'selected' : ''}>High (1800)</option>
                </select>
              </label>
            </div>

            <div class="space-y-2.5 pt-2 border-t border-white/10">
              <label class="flex items-center justify-between text-sm text-[#eceae4] cursor-pointer">
                <span>Controller / Device Vibration</span>
                <input type="checkbox" data-user-check="vibrationEnabled" ${user.vibrationEnabled ? 'checked' : ''} class="w-4 h-4 accent-[#c92a2a]" />
              </label>

              <label class="flex items-center justify-between text-sm text-[#eceae4] cursor-pointer">
                <span>Auto-Play Home Showcase Trailer</span>
                <input type="checkbox" data-user-check="autoShowcaseEnabled" ${user.autoShowcaseEnabled ? 'checked' : ''} class="w-4 h-4 accent-[#c92a2a]" />
              </label>

              <label class="flex items-center justify-between text-sm text-[#eceae4] cursor-pointer">
                <span>Show Webcam Preview in HUD</span>
                <input type="checkbox" data-user-check="showCameraPip" ${user.showCameraPip ? 'checked' : ''} class="w-4 h-4 accent-[#c92a2a]" />
              </label>

              <label class="flex items-center justify-between text-sm text-[#eceae4] cursor-pointer">
                <span>Debug Telemetry Overlay (F3)</span>
                <input type="checkbox" data-user-check="debugMode" ${user.debugMode ? 'checked' : ''} class="w-4 h-4 accent-[#c92a2a]" />
              </label>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between border-t border-white/10 pt-5 mt-8">
          <button type="button" data-action="reset" class="btn-secondary px-4 py-2 text-sm font-semibold">Reset Defaults</button>
          <button type="button" data-action="close" class="btn-primary px-6 py-2.5 text-base font-bold">Done</button>
        </div>
      </div>
    `;

    this.bindEvents(overlay);
    parent.appendChild(overlay);
    this.overlay = overlay;
  }

  private renderSlider(label: string, key: string, value: number): string {
    return `
      <div>
        <div class="flex justify-between text-sm mb-1.5">
          <span class="text-[#eceae4]">${label}</span>
          <span class="font-mono-num text-[#9ba1a6]" data-val="${key}">${Math.round(value * 100)}%</span>
        </div>
        <input type="range" min="0" max="1" step="0.02" value="${value}" data-audio-range="${key}" class="tactical-slider w-full" />
      </div>
    `;
  }

  private bindEvents(overlay: HTMLDivElement): void {
    overlay.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.dataset.audioRange) {
        const key = target.dataset.audioRange as
          | 'masterVolume'
          | 'sfxVolume'
          | 'musicVolume'
          | 'ambientVolume'
          | 'uiVolume';
        const val = Number.parseFloat(target.value);
        const label = overlay.querySelector(`[data-val="${key}"]`);
        if (label) label.textContent = `${Math.round(val * 100)}%`;
        audioManager.updateSettings({ [key]: val });
      } else if (target.dataset.user) {
        const key = target.dataset.user as
          | 'aimSensitivity'
          | 'aimSmoothing'
          | 'triggerCurlAngleDeg'
          | 'triggerReleaseAngleDeg'
          | 'cameraShakeIntensity';
        const val = Number.parseFloat(target.value);
        const label = overlay.querySelector(`[data-val="${key}"]`);
        if (label) {
          label.textContent =
            key === 'aimSensitivity'
              ? `${val.toFixed(2)}x`
              : key === 'aimSmoothing' || key === 'cameraShakeIntensity'
              ? `${Math.round(val * 100)}%`
              : `${Math.round(val)}°`;
        }
        const current = this.getSettings();
        this.onSaveSettings({ ...current, [key]: val });
      }
    });

    overlay.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement;
      if (target instanceof HTMLSelectElement && target.dataset.userSelect === 'crowdDensity') {
        const current = this.getSettings();
        this.onSaveSettings({
          ...current,
          crowdDensity: target.value as CrowdDensityLevel,
        });
      } else if (target instanceof HTMLInputElement && target.dataset.audio === 'muted') {
        audioManager.updateSettings({ muted: target.checked });
      } else if (target instanceof HTMLInputElement && target.dataset.cat) {
        const cat = target.dataset.cat as AudioCategory;
        const curr = audioManager.getSettings();
        curr.enabledCategories[cat] = target.checked;
        audioManager.updateSettings({ enabledCategories: curr.enabledCategories });
      } else if (target instanceof HTMLInputElement && target.dataset.userCheck) {
        const key = target.dataset.userCheck as
          | 'showCameraPip'
          | 'debugMode'
          | 'autoShowcaseEnabled'
          | 'vibrationEnabled';
        const current = this.getSettings();
        this.onSaveSettings({ ...current, [key]: target.checked });
      }
    });

    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const actionEl = target.closest('[data-action]') as HTMLElement | null;
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      void audioManager.play('ui_click');
      if (action === 'close') {
        this.close();
      } else if (action === 'reset') {
        audioManager.resetSettings();
        this.onSaveSettings({ ...DEFAULT_USER_SETTINGS });
        const parent = overlay.parentElement ?? document.body;
        this.close();
        this.open(parent);
      }
    });
  }

  public close(): void {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    this.onClose?.();
  }
}
