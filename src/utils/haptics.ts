export type HapticImpactLevel = 'low' | 'medium' | 'high' | 'very_high';

const PATTERN_BY_LEVEL: Record<HapticImpactLevel, number | number[]> = {
  low: 28,
  medium: 52,
  high: [65, 25, 85],
  very_high: [95, 30, 120, 25, 70],
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Triggers short device or gamepad vibration when supported and enabled by user settings.
 * Silently no-ops on unsupported browsers/devices.
 */
export function triggerHapticImpact(
  level: HapticImpactLevel,
  enabled: boolean,
  intensityMult = 1.0
): void {
  if (!enabled || intensityMult <= 0.05 || prefersReducedMotion()) {
    return;
  }

  const base = PATTERN_BY_LEVEL[level];
  const scale = Math.max(0.35, Math.min(1.4, intensityMult));
  const scaledPattern = Array.isArray(base)
    ? base.map((ms) => Math.max(12, Math.round(ms * scale)))
    : Math.max(12, Math.round(base * scale));

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(scaledPattern);
    }
  } catch {
    // Ignore unsupported vibration errors
  }

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      const pads = navigator.getGamepads();
      for (const pad of pads) {
        const actuator = (
          pad as (Gamepad & {
            vibrationActuator?: {
              playEffect?: (
                type: string,
                params: { duration: number; strongMagnitude: number; weakMagnitude: number }
              ) => Promise<void>;
            };
          }) | null
        )?.vibrationActuator;
        if (actuator && typeof actuator.playEffect === 'function') {
          const mag =
            level === 'very_high'
              ? 0.95
              : level === 'high'
              ? 0.72
              : level === 'medium'
              ? 0.45
              : 0.25;
          const dur =
            level === 'very_high'
              ? 240
              : level === 'high'
              ? 170
              : level === 'medium'
              ? 100
              : 55;
          void actuator
            .playEffect('dual-rumble', {
              duration: Math.round(dur * scale),
              strongMagnitude: Math.min(1, mag * scale),
              weakMagnitude: Math.min(1, mag * 0.75 * scale),
            })
            .catch(() => {});
        }
      }
    }
  } catch {
    // Ignore unsupported gamepad actuator errors
  }
}
