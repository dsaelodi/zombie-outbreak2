import { audioManager } from '../audio/AudioManager';

export class ControlsGuideModal {
  private overlay: HTMLDivElement | null = null;

  constructor(private readonly onClose?: () => void) {}

  public open(parent: HTMLElement = document.body): void {
    if (this.overlay) return;

    const overlay = document.createElement('div');
    overlay.className =
      'fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-6';
    overlay.setAttribute('data-ui-interactive', 'true');

    overlay.innerHTML = `
      <div class="screen-panel w-full max-w-4xl p-6 md:p-8 shadow-2xl">
        <div class="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
          <div>
            <div class="text-[11px] uppercase tracking-[0.22em] text-[#b91c1c] font-semibold mb-1">Field Manual</div>
            <h2 class="font-horror text-3xl md:text-4xl text-[#f4efe9] uppercase">How to Play</h2>
            <p class="text-sm text-[#9ba1a6] mt-1">Dual-hand gesture controls, GTA Weapon Wheel &amp; enemy weaknesses</p>
          </div>
          <button type="button" data-close class="btn-secondary px-4 py-2 text-sm font-semibold">Close</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div class="p-4 bg-white/[0.03] border border-white/10">
            <div class="font-mono-num text-xs font-semibold text-[#d97706] mb-1">01 · RIGHT HAND AIM</div>
            <h3 class="font-display text-xl font-bold text-white uppercase mb-2">Move &amp; Finger-Gun</h3>
            <p class="text-sm text-[#9ba1a6] leading-relaxed">
              Move your right hand to steer the stabilized crosshair. Curl your index finger (like pulling a trigger) to fire or throw; straighten to stop.
            </p>
          </div>

          <div class="p-4 bg-white/[0.03] border border-white/10">
            <div class="font-mono-num text-xs font-semibold text-[#38bdf8] mb-1">02 · DUAL-HAND WHEEL</div>
            <h3 class="font-display text-xl font-bold text-white uppercase mb-2">Left Fist + Right Pick</h3>
            <p class="text-sm text-[#9ba1a6] leading-relaxed">
              Hold a closed Left Fist to keep the Weapon Wheel open. Show 1–4 Right Fingers to switch (AR / SMG / Flame / Frag) or 5 to hold. Open your Left Hand to close.
            </p>
          </div>

          <div class="p-4 bg-white/[0.03] border border-white/10">
            <div class="font-mono-num text-xs font-semibold text-[#f97316] mb-1">03 · WEAKNESS ICONS</div>
            <h3 class="font-display text-xl font-bold text-white uppercase mb-2">Match Your Weapon</h3>
            <p class="text-sm text-[#9ba1a6] leading-relaxed">
              Runners fall fast to SMG, Armored Riot to AR headshots, Bio-Mutants can ONLY be killed by Flamethrower fire, and Exploders burst to Frag Grenades.
            </p>
          </div>

          <div class="p-4 bg-white/[0.03] border border-white/10">
            <div class="font-mono-num text-xs font-semibold text-[#eceae4] mb-1">04 · PAUSE GESTURE</div>
            <h3 class="font-display text-xl font-bold text-white uppercase mb-2">Raise Both Hands</h3>
            <p class="text-sm text-[#9ba1a6] leading-relaxed">
              Lift both wrists above your shoulders and hold for 1 second to pause gameplay at any moment.
            </p>
          </div>
        </div>

        <div class="p-4 bg-white/[0.03] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <div class="font-display text-lg font-semibold text-white uppercase">Mouse &amp; Keyboard Controls</div>
            <p class="text-sm text-[#9ba1a6]">Mouse = Aim · Left-Click / Space = Fire or Throw · Tab / Q = Weapon Wheel · 1–4 = Select Weapon · R = Reload · P / Esc = Pause · F3 = Telemetry</p>
          </div>
        </div>

        <div class="flex justify-end">
          <button type="button" data-close class="btn-primary px-6 py-2.5 text-base font-bold">Got It</button>
        </div>
      </div>
    `;

    overlay.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-close]') || target === overlay) {
        void audioManager.play('ui_click');
        this.close();
      }
    });

    parent.appendChild(overlay);
    this.overlay = overlay;
  }

  public close(): void {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    this.onClose?.();
  }
}
