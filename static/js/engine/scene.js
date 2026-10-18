// A caption as a list of drawable elements (word layers and boxes), and the
// state of each element at any moment. The SVG preview draws these states
// every frame; the ASS exporter samples the same states over time.
import { layoutCaption } from './layout.js';
import { activeScale, groupMotion, wordMotion, wordTiming } from './motion.js';

export const GRADIENT_BANDS = 12;

// Settings that can't be combined are resolved here, once, for both outputs.
export function effectiveStyle(style) {
  const s = { ...style };
  if (s.tilt) {
    // libass can't rotate clipping rectangles, which gradients and sweeps need.
    s.gradientTo = null;
    if (s.highlight === 'sweep') s.highlight = 'progressive';
  }
  return s;
}

const hex = (c) => c || '#000000';

export function buildScene(caption, styleIn, W, H, spaced = true) {
  const style = effectiveStyle(styleIn);
  const layout = layoutCaption(caption, style, W, H, spaced);
  const r = layout.ref;
  const els = [];
  const outline = style.outline * r;
  const padX = style.bgPadX * r, padY = style.bgPadY * r, radius = style.bgRadius * r;

  if (style.bg === 'block' && layout.lines.length) {
    els.push({ kind: 'box', scope: 'block', z: 0, color: style.bgColor, alpha: style.bgOpacity, radius, padX, padY });
  }
  if (style.bg === 'line') {
    for (const l of layout.lines) els.push({ kind: 'box', scope: 'line', line: l.index, z: 0, color: style.bgColor, alpha: style.bgOpacity, radius, padX, padY });
  }
  for (const w of layout.words) {
    const box = (scope, color, alpha, z) => ({
      kind: 'box', scope, word: w.i, z, color, alpha, radius,
      rect: { x: -w.w / 2 - padX, y: -(w.asc + w.desc) - padY, w: w.w + 2 * padX, h: w.asc + w.desc + 2 * padY },
    });
    if (style.bg === 'word') els.push(box('word', style.bgColor, style.bgOpacity, 1));
    if (w.emph && style.emphBg) els.push(box('emph', style.emphBgColor, 1, 1));
    if (style.highlight === 'pill') els.push(box('active', style.hlBgColor, 1, 2));

    const text = { kind: 'text', word: w.i, text: w.text, font: w.font, size: w.size, desc: w.desc, w: w.w,
      spacing: w.spacing, lineTopLocal: w.lineTop - w.bottom, lineBottomLocal: w.lineBottom - w.bottom };
    if (style.shadowOpacity > 0 && (style.shadowX || style.shadowY || style.shadowBlur)) {
      els.push({ ...text, role: 'shadow', z: 3, offset: { x: style.shadowX * r, y: style.shadowY * r },
        fill: style.shadowColor, alpha: style.shadowOpacity, outline, outlineColor: style.shadowColor,
        blur: style.shadowBlur * r });
    }
    if (style.glow > 0) {
      els.push({ ...text, role: 'glow', z: 4, offset: { x: 0, y: 0 }, fill: null, alpha: style.glowOpacity,
        outline: outline + style.glow * r, outlineColor: style.glowColor, blur: style.glow * r * 0.8 });
    }
    els.push({ ...text, role: 'main', z: 5, offset: { x: 0, y: 0 }, outline, outlineColor: style.outlineColor, alpha: style.opacity ?? 1,
      emph: w.emph });
    if (style.highlight === 'sweep') {
      els.push({ ...text, role: 'sweep', z: 6, offset: { x: 0, y: 0 }, outline, outlineColor: style.outlineColor, alpha: style.opacity ?? 1 });
    }
  }
  els.sort((a, b) => a.z - b.z);
  return { caption, style, layout, elements: els, W, H };
}

// Screen-space mapping for elements attached to word i at time t.
function wordTransform(scene, i, t) {
  const { style, layout, caption, H } = scene;
  const w = layout.words[i];
  const g = groupMotion(style, caption, t);
  const m = wordMotion(style, caption, i, t);
  const hs = activeScale(style, caption, i, t);
  const sw = m.scale * hs;
  const O = layout.origin;
  const ax = w.cx, ay = w.bottom + m.dy * H;
  // local point (lx, ly) relative to the word anchor -> screen
  const map = (lx, ly) => rotate(scene, t, O.x + g.scale * (ax + sw * lx - O.x), O.y + g.scale * (ay + sw * ly - O.y) + g.dy * H, g);
  return { map, scale: g.scale * sw, opacity: g.opacity * m.opacity, visible: m.visible, blur: g.blur, g };
}

function groupTransform(scene, t) {
  const { style, layout, caption, H } = scene;
  const g = groupMotion(style, caption, t);
  const O = layout.origin;
  const map = (x, y) => rotate(scene, t, O.x + g.scale * (x - O.x), O.y + g.scale * (y - O.y) + g.dy * H, g);
  return { map, scale: g.scale, opacity: g.opacity, blur: g.blur, g };
}

function rotate(scene, t, x, y, g) {
  const deg = scene.style.tilt || 0;
  if (!deg) return { x, y };
  const O = scene.layout.origin;
  const cx = O.x, cy = O.y + g.dy * scene.H;
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

function textColor(scene, el, t) {
  const { style, caption } = scene;
  const { active, spoken } = wordTiming(caption, el.word, t);
  if (style.highlight === 'color' && active) return { color: style.hlColor, solid: true };
  if (style.highlight === 'progressive' && (active || spoken)) return { color: style.hlColor, solid: true };
  if (style.highlight === 'pill' && active) return { color: style.hlColor, solid: true };
  if (el.emph && style.emphColor) return { color: style.emphColor, solid: true };
  return { color: style.color, solid: !style.gradientTo };
}

// Line-box extents covering only the words visible at time t.
function visibleLineRect(scene, lineIndex, t) {
  const { layout, style, caption } = scene;
  const l = layout.lines[lineIndex];
  let x0 = Infinity, x1 = -Infinity;
  for (let k = l.a; k < l.b; k++) {
    if (!wordMotion(style, caption, k, t).visible) continue;
    const w = layout.words[k];
    x0 = Math.min(x0, w.x);
    x1 = Math.max(x1, w.x + w.w);
  }
  if (x0 > x1) return null;
  return { x: x0, y: l.top, w: x1 - x0, h: l.bottom - l.top };
}

// The state of one element at time t. Positions are screen pixels; `rect` and
// `clip` are in the element's local coordinates (scaled by `scale` around `pos`).
export function elementState(scene, el, t) {
  const { caption, style, layout } = scene;
  if (t < caption.start || t >= caption.end) return { visible: false };

  if (el.kind === 'box' && (el.scope === 'block' || el.scope === 'line')) {
    const gt = groupTransform(scene, t);
    let rect;
    if (el.scope === 'line') rect = visibleLineRect(scene, el.line, t);
    else {
      const rs = layout.lines.map((l) => visibleLineRect(scene, l.index, t)).filter(Boolean);
      if (rs.length) {
        const x0 = Math.min(...rs.map((q) => q.x)), x1 = Math.max(...rs.map((q) => q.x + q.w));
        const y0 = Math.min(...rs.map((q) => q.y)), y1 = Math.max(...rs.map((q) => q.y + q.h));
        rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
    }
    if (!rect) return { visible: false };
    const r = { x: rect.x - el.padX, y: rect.y - el.padY, w: rect.w + 2 * el.padX, h: rect.h + 2 * el.padY };
    const pos = gt.map(r.x, r.y);
    return { visible: gt.opacity > 0.001, pos, scale: gt.scale, opacity: gt.opacity * el.alpha,
      rect: { x: 0, y: 0, w: r.w, h: r.h }, radius: Math.min(el.radius, r.h / 2, r.w / 2), color: el.color, rot: style.tilt || 0 };
  }

  const wt = wordTransform(scene, el.word, t);
  if (!wt.visible) return { visible: false };

  if (el.kind === 'box') {
    if (el.scope === 'active' && !wordTiming(caption, el.word, t).active) return { visible: false };
    const r = el.rect;
    return { visible: wt.opacity > 0.001, pos: wt.map(r.x, r.y), scale: wt.scale, opacity: wt.opacity * el.alpha,
      rect: { x: 0, y: 0, w: r.w, h: r.h }, radius: Math.min(el.radius, r.h / 2, r.w / 2), color: el.color, rot: style.tilt || 0 };
  }

  // text layers
  const state = {
    visible: wt.opacity > 0.001, pos: wt.map(el.offset.x, el.offset.y), scale: wt.scale,
    opacity: wt.opacity * el.alpha, rot: style.tilt || 0, outline: el.outline, outlineColor: el.outlineColor,
    blur: (el.blur || 0) + wt.blur,
  };
  if (el.role === 'main') {
    // A word sitting on a pill or marker reads better without its outline.
    if ((el.emph && style.emphBg) || (style.highlight === 'pill' && wordTiming(caption, el.word, t).active)) state.outline = 0;
    const c = textColor(scene, el, t);
    state.fill = c.color;
    state.gradient = c.solid ? null : { from: style.color, to: style.gradientTo, y0: el.lineTopLocal, y1: el.lineBottomLocal };
  } else if (el.role === 'sweep') {
    const { progress } = wordTiming(caption, el.word, t);
    if (progress <= 0) return { visible: false };
    state.fill = style.hlColor;
    const pad = el.outline + el.size;
    state.clip = { x: -el.w / 2 - pad, y: -el.size * 2 - pad, w: pad + el.w * progress, h: el.size * 3 + 2 * pad };
  } else {
    state.fill = el.fill;
  }
  return state;
}

export const hexColor = hex;
