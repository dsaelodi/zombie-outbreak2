import * as THREE from 'three';
import type { WeaknessIconType } from '../../data/zombies';

const textureCache = new Map<Exclude<WeaknessIconType, 'none'>, THREE.CanvasTexture>();

function drawSmGIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // Compact SMG silhouette + rapid-fire velocity streaks
  ctx.fillStyle = '#e0f2fe';
  // Receiver body
  ctx.fillRect(-20, -7, 30, 10);
  // Barrel & muzzle
  ctx.fillRect(10, -4, 14, 4);
  // Grip & magazine
  ctx.fillRect(-16, 3, 7, 13);
  ctx.fillRect(-2, 3, 6, 16);
  // Folding stock
  ctx.fillRect(-26, -6, 6, 4);

  // Rapid-fire tracer streaks above/right
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(18, -14, 10, 3);
  ctx.fillRect(22, -9, 8, 3);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-22, -16, 16, 3);
  ctx.fillRect(-14, -22, 20, 3);

  ctx.restore();
}

function drawFlameBlastHybridIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // Outer jagged blast starburst (red-orange / bright yellow-white core)
  ctx.fillStyle = '#ff6b35';
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const ang = (i * Math.PI) / 8 - Math.PI / 2;
    const r = i % 2 === 0 ? 27 : 14;
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // Inner sharp flame tongue silhouette
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.bezierCurveTo(14, -8, 15, 11, 0, 19);
  ctx.bezierCurveTo(-15, 11, -14, -8, 0, -22);
  ctx.fill();

  // Bright core spark
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.bezierCurveTo(7, -1, 7, 10, 0, 15);
  ctx.bezierCurveTo(-7, 10, -7, -1, 0, -10);
  ctx.fill();

  ctx.restore();
}

function drawArIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.translate(cx, cy);

  // Assault rifle silhouette + precision crosshair ring
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 23, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  // Stock + receiver + long barrel
  ctx.fillRect(-26, -5, 11, 8);
  ctx.fillRect(-15, -6, 22, 10);
  ctx.fillRect(7, -4, 19, 4);
  // Optic / carry handle
  ctx.fillRect(-10, -11, 13, 4);
  // Pistol grip + curved mag
  ctx.fillRect(-13, 4, 6, 12);
  ctx.fillRect(0, 4, 6, 15);

  ctx.restore();
}

function drawSingleNeonBadge(
  type: Exclude<WeaknessIconType, 'none' | 'ar_red'>
): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;

  const palette =
    type === 'smg'
      ? {
          auraInner: 'rgba(0, 212, 255, 0.72)',
          auraOuter: 'rgba(0, 212, 255, 0)',
          ring: '#00d4ff',
          coreBg: 'rgba(7, 18, 28, 0.92)',
          label: 'SMG',
          labelColor: '#7dd3fc',
        }
      : type === 'ar'
      ? {
          auraInner: 'rgba(255, 255, 255, 0.68)',
          auraOuter: 'rgba(255, 255, 255, 0)',
          ring: '#ffffff',
          coreBg: 'rgba(14, 17, 22, 0.92)',
          label: 'AR',
          labelColor: '#ffffff',
        }
      : {
          auraInner: 'rgba(255, 46, 46, 0.76)',
          auraOuter: 'rgba(255, 46, 46, 0)',
          ring: '#ff3333',
          coreBg: 'rgba(26, 8, 10, 0.92)',
          label: 'FIRE / FRAG',
          labelColor: '#fca5a5',
        };

  ctx.clearRect(0, 0, size, size);

  // Layer 1: Wide outer neon aura
  const aura = ctx.createRadialGradient(cx, cy, 32, cx, cy, 62);
  aura.addColorStop(0, palette.auraInner);
  aura.addColorStop(0.55, palette.auraInner.replace(/[\d.]+\)$/, '0.28)'));
  aura.addColorStop(1, palette.auraOuter);
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(cx, cy, 62, 0, Math.PI * 2);
  ctx.fill();

  // Layer 2: Dark high-contrast circular core
  ctx.fillStyle = palette.coreBg;
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.fill();

  // Layer 3: Bright double neon rim
  ctx.strokeStyle = palette.ring;
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 39, 0, Math.PI * 2);
  ctx.stroke();

  // Layer 4: High-contrast category glyph
  if (type === 'smg') {
    drawSmGIcon(ctx, cx, cy - 6);
  } else if (type === 'ar') {
    drawArIcon(ctx, cx, cy - 6);
  } else {
    drawFlameBlastHybridIcon(ctx, cx, cy - 7);
  }

  // Layer 5: Crisp high-contrast label bar
  const barW = type === 'flamethrower' || type === 'grenade' ? 86 : 62;
  ctx.fillStyle = 'rgba(5, 7, 10, 0.94)';
  ctx.fillRect(cx - barW / 2, 85, barW, 22);
  ctx.strokeStyle = palette.ring;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - barW / 2, 85, barW, 22);

  ctx.fillStyle = palette.labelColor;
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(palette.label, cx, 96);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function drawDualWhiteRedBadge(): THREE.CanvasTexture {
  const w = 192;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);

  const leftCx = 56;
  const rightCx = 136;
  const cy = 58;

  // Left White Neon Aura (AR)
  const wAura = ctx.createRadialGradient(leftCx, cy, 22, leftCx, cy, 52);
  wAura.addColorStop(0, 'rgba(255, 255, 255, 0.65)');
  wAura.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = wAura;
  ctx.beginPath();
  ctx.arc(leftCx, cy, 52, 0, Math.PI * 2);
  ctx.fill();

  // Right Red Neon Aura (FIRE / FRAG)
  const rAura = ctx.createRadialGradient(rightCx, cy, 22, rightCx, cy, 52);
  rAura.addColorStop(0, 'rgba(255, 46, 46, 0.72)');
  rAura.addColorStop(1, 'rgba(255, 46, 46, 0)');
  ctx.fillStyle = rAura;
  ctx.beginPath();
  ctx.arc(rightCx, cy, 52, 0, Math.PI * 2);
  ctx.fill();

  // Left White Node
  ctx.fillStyle = 'rgba(14, 17, 22, 0.93)';
  ctx.beginPath();
  ctx.arc(leftCx, cy, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.stroke();
  drawArIcon(ctx, leftCx, cy - 3);

  // Right Red Node
  ctx.fillStyle = 'rgba(26, 8, 10, 0.93)';
  ctx.beginPath();
  ctx.arc(rightCx, cy, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 4;
  ctx.stroke();
  drawFlameBlastHybridIcon(ctx, rightCx, cy - 3);

  // Bottom labels
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(6, 8, 11, 0.94)';
  ctx.fillRect(leftCx - 26, 94, 52, 21);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.strokeRect(leftCx - 26, 94, 52, 21);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('AR', leftCx, 105);

  ctx.fillStyle = 'rgba(6, 8, 11, 0.94)';
  ctx.fillRect(rightCx - 34, 94, 68, 21);
  ctx.strokeStyle = '#ff3333';
  ctx.lineWidth = 2;
  ctx.strokeRect(rightCx - 34, 94, 68, 21);
  ctx.fillStyle = '#fca5a5';
  ctx.fillText('FRAG', rightCx, 105);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function getWeaknessTexture(type: Exclude<WeaknessIconType, 'none'>): THREE.CanvasTexture {
  const cacheKey: Exclude<WeaknessIconType, 'none'> =
    type === 'grenade' ? 'flamethrower' : type;
  const existing = textureCache.get(cacheKey);
  if (existing) return existing;

  const tex =
    cacheKey === 'ar_red'
      ? drawDualWhiteRedBadge()
      : drawSingleNeonBadge(cacheKey);

  textureCache.set(cacheKey, tex);
  return tex;
}

export function getWeaknessBaseScale(type: WeaknessIconType, isBoss: boolean): { x: number; y: number } {
  const isDual = type === 'ar_red';
  if (isBoss) {
    // Boss root has scale 2.35, so 0.95–1.38 local renders at ~2.2–3.2 world units overhead
    return isDual ? { x: 1.38, y: 0.92 } : { x: 0.98, y: 0.98 };
  }
  return isDual ? { x: 1.48, y: 0.98 } : { x: 1.06, y: 1.06 };
}

export function createWeaknessSprite(
  type: WeaknessIconType,
  isBoss = false
): { sprite: THREE.Sprite; material: THREE.SpriteMaterial } | null {
  if (type === 'none') return null;
  const tex = getWeaknessTexture(type);
  const material = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.layers.set(0); // Never hit by Layer 1 shooting raycaster
  sprite.renderOrder = 6;
  sprite.position.set(0, isBoss ? 2.82 : 2.52, 0);
  const base = getWeaknessBaseScale(type, isBoss);
  sprite.scale.set(base.x, base.y, 1);
  return { sprite, material };
}
