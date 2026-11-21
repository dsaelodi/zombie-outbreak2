import { WEAPON_ORDER, WEAPONS, type WeaponId, type WeaponSlotRuntime } from '../data/weapons';

const WEAPON_ICONS: Record<WeaponId, string> = {
  ar: `<svg viewBox="0 0 64 28" class="w-12 h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
    <path d="M4 13h44l5 2v3H42l-4 5h-5l2-5H25l-3 7h-4l2-7H11l-4 4H3l1-9z" fill="currentColor" fill-opacity="0.22"/>
    <line x1="48" y1="14" x2="61" y2="14" stroke-width="2.5"/>
    <rect x="20" y="7" width="12" height="4" rx="1"/>
  </svg>`,
  smg: `<svg viewBox="0 0 64 28" class="w-12 h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
    <path d="M12 11h32l3 3v3H38l-3 9h-5l2-9H22l-2 5h-4l1-5H10l2-6z" fill="currentColor" fill-opacity="0.22"/>
    <line x1="44" y1="13" x2="56" y2="13" stroke-width="2.5"/>
    <rect x="24" y="6" width="8" height="4" rx="1"/>
  </svg>`,
  flamethrower: `<svg viewBox="0 0 64 28" class="w-12 h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
    <rect x="8" y="13" width="22" height="9" rx="2" fill="currentColor" fill-opacity="0.22"/>
    <path d="M14 11h34v4H14z" fill="currentColor" fill-opacity="0.35"/>
    <path d="M51 9c4 2 7 5 9 5-2 2-5 5-9 5 1-3 1-7 0-10z" fill="#fb923c" stroke="#fdba74"/>
  </svg>`,
  grenade: `<svg viewBox="0 0 40 32" class="w-9 h-7" fill="none" stroke="currentColor" stroke-width="2">
    <ellipse cx="20" cy="19" rx="9" ry="10" fill="currentColor" fill-opacity="0.24"/>
    <line x1="12" y1="17" x2="28" y2="17"/>
    <line x1="12" y1="22" x2="28" y2="22"/>
    <line x1="20" y1="9" x2="20" y2="29"/>
    <rect x="17" y="4" width="6" height="5"/>
    <circle cx="13" cy="7" r="2.5"/>
  </svg>`,
};

export interface WeaponWheelOverlayCallbacks {
  onSelect: (weaponId: WeaponId) => void;
  onCancel: () => void;
}

export class WeaponWheelOverlay {
  private root: HTMLDivElement | null = null;
  private isOpen = false;
  private slotEls = new Map<WeaponId, HTMLButtonElement>();
  private centerNameEl: HTMLElement | null = null;
  private centerRoleEl: HTMLElement | null = null;
  private centerAmmoEl: HTMLElement | null = null;
  private fingerHintEl: HTMLElement | null = null;
  private progressCircleEl: SVGCircleElement | null = null;
  private cancelBtnEl: HTMLButtonElement | null = null;

  constructor(private readonly callbacks: WeaponWheelOverlayCallbacks) {}

  public mount(parent: HTMLElement): void {
    const root = document.createElement('div');
    root.className =
      'hidden fixed inset-0 z-30 flex items-center justify-center pointer-events-auto bg-[#07090b]/45';
    root.setAttribute('data-ui-interactive', 'true');

    // Semicircular layout: 4 slots spaced along upper-half arc (-154deg to -26deg)
    const radius = 195;
    const anglesDeg = [-154, -111, -69, -26];

    const slotsHtml = WEAPON_ORDER.map((id, i) => {
      const def = WEAPONS[id];
      const rad = (anglesDeg[i] * Math.PI) / 180;
      const dx = Math.round(Math.cos(rad) * radius);
      const dy = Math.round(Math.sin(rad) * radius) + 46;

      return `
        <button
          type="button"
          data-wheel-slot="${id}"
          style="transform: translate(${dx}px, ${dy}px);"
          class="absolute left-1/2 top-1/2 -ml-[74px] -mt-[46px] w-[148px] h-[92px] bg-[#0e1217]/92 border border-white/20 hover:border-white/55 px-3 py-2 flex flex-col items-center justify-between transition-all duration-120 text-left cursor-pointer shadow-xl"
        >
          <div class="w-full flex items-center justify-between text-[10px] font-mono-num uppercase tracking-wider text-[#9ba1a6]">
            <span class="px-1.5 py-0.5 bg-white/10 text-white font-bold">${def.slot}</span>
            <span data-slot-ammo="${id}" class="text-white font-semibold">--</span>
          </div>
          <div style="color:${def.accentColor};" class="my-0.5">
            ${WEAPON_ICONS[id]}
          </div>
          <div class="text-xs font-display font-bold uppercase tracking-wider text-white text-center leading-none">
            ${def.name}
          </div>
        </button>
      `;
    }).join('');

    root.innerHTML = `
      <div class="relative w-[560px] h-[380px] max-w-[95vw] select-none">
        <!-- Decorative semicircular arc guide -->
        <svg viewBox="0 0 560 380" class="absolute inset-0 w-full h-full pointer-events-none">
          <path d="M 65 250 A 215 215 0 0 1 495 250" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="58" />
          <path d="M 65 250 A 215 215 0 0 1 495 250" fill="none" stroke="rgba(217,119,6,0.28)" stroke-width="2" stroke-dasharray="6 6" />
        </svg>

        ${slotsHtml}

        <!-- Center Hub -->
        <div
          style="transform: translate(0px, 56px);"
          class="absolute left-1/2 top-1/2 -ml-[98px] -mt-[82px] w-[196px] h-[164px] bg-[#0b0e12]/95 border border-white/20 flex flex-col items-center justify-center p-4 text-center shadow-2xl"
        >
          <svg viewBox="0 0 64 64" class="w-12 h-12 mb-1">
            <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="4" />
            <circle
              data-wheel-progress-ring
              cx="32"
              cy="32"
              r="26"
              fill="none"
              stroke="#f59e0b"
              stroke-width="4"
              stroke-linecap="butt"
              stroke-dasharray="163.36"
              stroke-dashoffset="163.36"
              transform="rotate(-90 32 32)"
            />
            <text x="32" y="36" text-anchor="middle" fill="#ffffff" font-size="13" font-family="monospace" font-weight="bold" data-wheel-finger-num>--</text>
          </svg>
          <div data-wheel-center-name class="font-display text-lg font-bold uppercase text-white tracking-wide leading-tight">
            Weapon Wheel
          </div>
          <div data-wheel-center-role class="text-[11px] text-[#d97706] font-medium mt-0.5">
            Hold Left Fist · Right 1–4 Select · 5 Hold
          </div>
          <div data-wheel-center-ammo class="text-[11px] font-mono-num text-[#9ba1a6] mt-1">
            Open Left Hand to Close
          </div>
        </div>

        <!-- Bottom Action -->
        <button
          type="button"
          data-wheel-cancel
          style="transform: translate(0px, 162px);"
          class="absolute left-1/2 top-1/2 -ml-[96px] w-[192px] py-2 bg-[#14181d]/95 border border-white/20 hover:border-white/50 text-xs font-mono-num uppercase tracking-wider text-[#eceae4] cursor-pointer"
        >
          Open Left Hand / Tab Close
        </button>
      </div>
    `;

    for (const id of WEAPON_ORDER) {
      const btn = root.querySelector(`[data-wheel-slot="${id}"]`) as HTMLButtonElement | null;
      if (btn) {
        this.slotEls.set(id, btn);
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.callbacks.onSelect(id);
        });
      }
    }

    this.centerNameEl = root.querySelector('[data-wheel-center-name]');
    this.centerRoleEl = root.querySelector('[data-wheel-center-role]');
    this.centerAmmoEl = root.querySelector('[data-wheel-center-ammo]');
    this.fingerHintEl = root.querySelector('[data-wheel-finger-num]');
    this.progressCircleEl = root.querySelector('[data-wheel-progress-ring]');
    this.cancelBtnEl = root.querySelector('[data-wheel-cancel]');

    this.cancelBtnEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onCancel();
    });

    root.addEventListener('click', (e) => {
      if (e.target === root) {
        this.callbacks.onCancel();
      }
    });

    parent.appendChild(root);
    this.root = root;
  }

  public setOpen(open: boolean): void {
    this.isOpen = open;
    if (!this.root) return;
    this.root.classList.toggle('hidden', !open);
  }

  public updateState(params: {
    activeWeapon: WeaponId;
    hoveredSlot: WeaponId | null;
    fingerCount: number;
    lockProgress: number;
    cancelProgress: number;
    slots: Record<WeaponId, WeaponSlotRuntime>;
  }): void {
    if (!this.root || !this.isOpen) return;

    const focusedId = params.hoveredSlot ?? params.activeWeapon;
    const focusedDef = WEAPONS[focusedId];
    const focusedRuntime = params.slots[focusedId];

    for (const id of WEAPON_ORDER) {
      const el = this.slotEls.get(id);
      if (!el) continue;
      const isHovered = params.hoveredSlot === id;
      const isActive = params.activeWeapon === id;
      const runtime = params.slots[id];

      el.style.borderColor = isHovered
        ? WEAPONS[id].accentColor
        : isActive
        ? 'rgba(255,255,255,0.6)'
        : 'rgba(255,255,255,0.18)';
      el.style.backgroundColor = isHovered
        ? 'rgba(34, 41, 49, 0.96)'
        : isActive
        ? 'rgba(24, 30, 36, 0.94)'
        : 'rgba(14, 18, 23, 0.9)';

      const ammoEl = el.querySelector(`[data-slot-ammo="${id}"]`);
      if (ammoEl) {
        if (id === 'grenade') {
          ammoEl.textContent =
            runtime.cooldownRemainingMs > 0
              ? `${(runtime.cooldownRemainingMs / 1000).toFixed(1)}s`
              : `${runtime.ammo}/${runtime.magazineSize}`;
        } else if (id === 'flamethrower') {
          ammoEl.textContent = `${runtime.ammo}%`;
        } else {
          ammoEl.textContent = `${runtime.ammo}/${runtime.magazineSize}`;
        }
      }
    }

    if (this.centerNameEl) {
      this.centerNameEl.textContent =
        params.cancelProgress > 0 ? '5 Fingers · Holding' : focusedDef.name;
    }
    if (this.centerRoleEl) {
      this.centerRoleEl.textContent =
        params.cancelProgress > 0
          ? 'No selection · Open left hand to close'
          : `${focusedDef.role} · Open Left Hand to Close`;
    }
    if (this.centerAmmoEl) {
      this.centerAmmoEl.textContent =
        focusedId === 'flamethrower'
          ? `Fuel: ${focusedRuntime.ammo}%`
          : focusedId === 'grenade'
          ? `Frag: ${focusedRuntime.ammo}/${focusedRuntime.magazineSize}`
          : `Ammo: ${focusedRuntime.ammo}/${focusedRuntime.magazineSize}`;
    }

    if (this.fingerHintEl) {
      this.fingerHintEl.textContent =
        params.fingerCount > 0 ? `${params.fingerCount}F` : '1-5';
    }

    if (this.progressCircleEl) {
      const circumference = 163.36;
      const pct = Math.max(params.lockProgress, params.cancelProgress);
      this.progressCircleEl.style.strokeDashoffset = `${circumference * (1 - pct)}`;
      this.progressCircleEl.setAttribute(
        'stroke',
        params.cancelProgress > 0 ? '#64748b' : focusedDef.accentColor
      );
    }

    if (this.cancelBtnEl) {
      this.cancelBtnEl.style.borderColor =
        params.cancelProgress > 0 ? '#64748b' : 'rgba(255,255,255,0.2)';
    }
  }

  public unmount(): void {
    this.slotEls.clear();
    this.root?.remove();
    this.root = null;
  }
}
