// Safe-zone overlays for social formats. Each zone lists, for a 1080×1920
// frame, the margins covered by the platform's interface and any extra
// covered areas (such as a column of buttons). The overlay is drawn over the
// preview only; it never reaches the export.
import { effectiveStyle } from '../engine/scene.js';
import { layoutCaption } from '../engine/layout.js';
import { h } from './ui.js';

// Margins in px of a 1080×1920 frame. Sources: Instagram Reels and TikTok from
// the editors' templates (220/420/35 and 220/650/125, buttons 250 wide);
// Stories and Facebook Reels from Meta's placement guidance (top 14%,
// bottom 18% / 35%, sides 6%).
export const ZONES = [
  { id: 'off', label: 'Off' },
  {
    id: 'ig-reels', label: 'Instagram Reels', vertical: true,
    top: 220, bottom: 420, left: 35, right: 35,
    areas: { top: 'Reels header and camera', bottom: 'Name, caption and audio' },
    extra: [{ x: 960, y: 1180, w: 120, h: 320, label: 'Buttons' }],
  },
  {
    id: 'ig-stories', label: 'Instagram Stories', vertical: true,
    top: 250, bottom: 340, left: 64, right: 64,
    areas: { top: 'Progress bar and profile', bottom: 'Reply bar' },
  },
  {
    id: 'fb-reels', label: 'Facebook Reels', vertical: true,
    top: 270, bottom: 670, left: 65, right: 65,
    areas: { top: 'Reels header', bottom: 'Name, caption, buttons and audio' },
  },
  {
    id: 'tiktok', label: 'TikTok', vertical: true,
    top: 220, bottom: 650, left: 125, right: 125,
    areas: { top: 'Following / For You tabs', bottom: 'Name, caption and sound' },
    extra: [{ x: 830, y: 395, w: 250, h: 875, label: 'Buttons' }],
  },
  {
    id: 'title', label: 'Title safe',
    // 10% on every side of any frame (the classic broadcast title-safe area)
    relative: 0.1,
  },
];

export const zoneById = (id) => ZONES.find((z) => z.id === id) || ZONES[0];

// Platform zones are made for 9:16 video; allow a little tolerance.
export function zoneFits(zone, W, H) {
  if (!zone.vertical) return true;
  return Math.abs(W / H - 9 / 16) < 0.06;
}

// The zone in this video's pixels: the safe rectangle and the covered areas.
export function resolve(zone, W, H) {
  if (zone.id === 'off') return null;
  if (zone.relative) {
    const mx = Math.round(W * zone.relative), my = Math.round(H * zone.relative);
    return { safe: { x: mx, y: my, w: W - 2 * mx, h: H - 2 * my }, margins: { top: my, bottom: my, left: mx, right: mx }, extra: [], areas: {} };
  }
  const sx = W / 1080, sy = H / 1920;
  const m = { top: zone.top * sy, bottom: zone.bottom * sy, left: zone.left * sx, right: zone.right * sx };
  return {
    safe: { x: m.left, y: m.top, w: W - m.left - m.right, h: H - m.top - m.bottom },
    margins: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v)])),
    extra: (zone.extra || []).map((e) => ({ x: e.x * sx, y: e.y * sy, w: e.w * sx, h: e.h * sy, label: e.label })),
    areas: zone.areas || {},
  };
}

// ------------------------------------------------------------ overlay

const pct = (v, total) => `${(v / total) * 100}%`;

export function renderOverlay(el, zone, W, H) {
  const z = resolve(zone, W, H);
  if (!z) { el.replaceChildren(); return; }
  const { safe, margins, extra, areas } = z;
  const band = (style, label, cls = '') => h('div', { class: `sz-cover ${cls}`, style }, label ? h('span', { class: 'sz-label' }, label) : null);
  const tag = (style, text, side = '') => h('span', { class: `sz-size ${side}`, style }, text);
  const grid = h('div', { class: 'sz-grid' }, [1, 2].map((k) => h('i', { class: 'v', style: { left: `${(k / 3) * 100}%` } })),
    [1, 2].map((k) => h('i', { class: 'h', style: { top: `${(k / 3) * 100}%` } })));
  el.replaceChildren(
    band({ left: 0, top: 0, width: '100%', height: pct(safe.y, H) }, areas.top, 'top'),
    band({ left: 0, bottom: 0, width: '100%', height: pct(H - safe.y - safe.h, H) }, areas.bottom, 'bottom'),
    band({ left: 0, top: pct(safe.y, H), width: pct(safe.x, W), height: pct(safe.h, H) }),
    band({ right: 0, top: pct(safe.y, H), width: pct(W - safe.x - safe.w, W), height: pct(safe.h, H) }),
    ...extra.map((e) => band({ left: pct(e.x, W), top: pct(e.y, H), width: pct(e.w, W), height: pct(e.h, H) }, e.label, 'extra')),
    h('div', { class: 'sz-safe', style: { left: pct(safe.x, W), top: pct(safe.y, H), width: pct(safe.w, W), height: pct(safe.h, H) } }, grid),
    tag({ left: '50%', top: pct(safe.y, H) }, `${margins.top} px`),
    tag({ left: '50%', top: pct(safe.y + safe.h, H) }, `${margins.bottom} px`),
    tag({ left: pct(safe.x, W), top: '50%' }, `${margins.left} px`, 'left'),
    tag({ left: pct(safe.x + safe.w, W), top: '50%' }, `${margins.right} px`, 'right'),
  );
}

// ------------------------------------------------------------ checking captions

// Background padding plus outline around the text, in video px.
function edgePad(style, W, H) {
  const s = effectiveStyle(style);
  const r = Math.min(W, H) / 1080;
  return ((s.bg !== 'none' ? s.bgPadX : 0) + (s.outline || 0)) * r;
}

// The area a caption's text (plus its background and outline) covers.
function captionBox(caption, style, W, H) {
  const s = effectiveStyle(style);
  const lay = layoutCaption(caption, s, W, H);
  const r = lay.ref;
  const padX = (s.bg !== 'none' ? s.bgPadX : 0) * r + (s.outline || 0) * r;
  const padY = (s.bg !== 'none' ? s.bgPadY : 0) * r + (s.outline || 0) * r;
  const b = lay.block;
  return { left: b.left - padX, right: b.right + padX, top: b.top - padY, bottom: b.bottom + padY };
}

const hits = (b, e) => b.left < e.x + e.w && b.right > e.x && b.top < e.y + e.h && b.bottom > e.y;

function problems(box, z) {
  const { safe, extra } = z;
  return {
    top: Math.max(0, safe.y - box.top),
    bottom: Math.max(0, box.bottom - (safe.y + safe.h)),
    left: Math.max(0, safe.x - box.left),
    right: Math.max(0, box.right - (safe.x + safe.w)),
    covered: extra.filter((e) => hits(box, e)),
  };
}

const bad = (p) => p.top > 0.5 || p.bottom > 0.5 || p.left > 0.5 || p.right > 0.5 || p.covered.length > 0;

// Which captions cross into a covered area. Returns { count, ids }.
export function check(captions, style, zone, W, H) {
  const z = resolve(zone, W, H);
  if (!z) return { count: 0, ids: [] };
  const ids = captions.filter((c) => c.words.length && bad(problems(captionBox(c, style, W, H), z))).map((c) => c.id);
  return { count: ids.length, ids };
}

// A style change (width and position only) that brings every caption inside
// the safe area, or null when it isn't possible.
export function fitStyle(captions, style, zone, W, H) {
  const z = resolve(zone, W, H);
  if (!z) return null;
  const { safe, extra } = z;
  let s = { ...style };
  for (let pass = 0; pass < 6; pass++) {
    const boxes = captions.filter((c) => c.words.length).map((c) => captionBox(c, s, W, H));
    if (!boxes.length) return null;
    const p = boxes.map((b) => problems(b, z));
    if (!p.some(bad)) return pass ? s : null;
    const patch = {};
    // too wide, or reaching a column of buttons: narrow and centre
    const top = Math.min(...boxes.map((b) => b.top)), bottom = Math.max(...boxes.map((b) => b.bottom));
    let room = safe.w;
    for (const e of extra) {
      if (top < e.y + e.h && bottom > e.y) {
        // keep a centred block clear of the covered area
        room = Math.min(room, e.x > W / 2 ? 2 * (e.x - W / 2) : 2 * (W / 2 - (e.x + e.w)));
      }
    }
    const widest = Math.max(...boxes.map((b) => b.right - b.left));
    if (p.some((q) => q.left > 0.5 || q.right > 0.5 || q.covered.length) || widest > room) {
      patch.hPos = 'center'; patch.hOffset = 0; patch.align = s.align === 'left' || s.align === 'right' ? s.align : 'center';
      if (widest > room - 4) {
        const pad = 2 * edgePad(s, W, H);
        patch.width = Math.max(30, Math.min(s.width - 1, Math.floor(((room - pad - 8) / W) * 100)));
      }
    }
    // vertical: move the block by the largest overflow
    const down = Math.max(...p.map((q) => q.top)), up = Math.max(...p.map((q) => q.bottom));
    const move = ((up > 0.5 ? up : down > 0.5 ? -down : 0) / H) * 100;
    if (move) {
      const step = Math.ceil(Math.abs(move) * 2 + 1) / 2 * Math.sign(move);
      if (s.vPos === 'bottom') patch.vOffset = s.vOffset + step;
      else if (s.vPos === 'top') patch.vOffset = s.vOffset - step;
      else patch.vOffset = s.vOffset - step;
      patch.vOffset = Math.max(s.vPos === 'middle' ? -48 : 0, Math.min(48, patch.vOffset));
    }
    if (!Object.keys(patch).length) return null;
    s = { ...s, ...patch };
  }
  const left = captions.filter((c) => c.words.length).map((c) => problems(captionBox(c, s, W, H), z));
  return left.some(bad) ? null : s;
}
