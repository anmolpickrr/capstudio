// After Effects export: caption scenes as editable layers. Every drawable element
// (each word, its shadow and glow, background boxes and pills) becomes a text or
// shape layer. Its position, scale, rotation, opacity, blur, colours and clip are
// keyframed from the same element states the preview draws, sampled every frame
// and thinned to the keyframes that matter. static/ae/capstudio-ae.jsx builds them.
import { buildScene, elementState } from './scene.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;

// Keep only keyframes that change the motion: a sample on the straight line
// between its neighbours adds nothing.
export function thin(keys, eps = 0.01) {
  if (keys.length <= 2) {
    return keys.length === 2 && keys[0].slice(1).every((v, i) => Math.abs(v - keys[1][i + 1]) <= eps) ? [keys[0]] : keys;
  }
  const out = [keys[0]];
  for (let i = 1; i < keys.length - 1; i++) {
    const a = out[out.length - 1], b = keys[i], c = keys[i + 1];
    const k = (b[0] - a[0]) / ((c[0] - a[0]) || 1);
    if (b.slice(1).some((v, j) => Math.abs(v - (a[j + 1] + (c[j + 1] - a[j + 1]) * k)) > eps)) out.push(b);
  }
  const last = keys[keys.length - 1];
  if (out.length === 1 && last.slice(1).every((v, i) => Math.abs(v - out[0][i + 1]) <= eps)) return out;
  out.push(last);
  return out;
}

// Hold-style keys (colours, on/off): only where the value changes.
function changes(keys) {
  const out = [];
  for (const k of keys) {
    const prev = out[out.length - 1];
    if (!prev || JSON.stringify(prev.slice(1)) !== JSON.stringify(k.slice(1))) out.push(k);
  }
  return out;
}

// States for every sample, with hidden moments taking the nearest shown state's
// geometry at zero opacity (so nothing jumps when a word appears).
function filled(states) {
  let last = states.find((s) => s.visible);
  return states.map((s) => {
    if (s.visible) { last = s; return s; }
    return { ...last, opacity: 0, visible: false };
  });
}

function common(times, st) {
  return {
    position: thin(times.map((t, i) => [t, r2(st[i].pos.x), r2(st[i].pos.y)]), 0.05),
    scale: thin(times.map((t, i) => [t, r4(st[i].scale * 100)]), 0.05),
    rotation: thin(times.map((t, i) => [t, r2(st[i].rot || 0)]), 0.05),
    opacity: thin(times.map((t, i) => [t, r2(st[i].visible ? st[i].opacity * 100 : 0)]), 0.3),
    // AE's Gaussian Blur works in layer space and its Blurriness is about 2.4 × the
    // standard deviation the preview uses
    blur: thin(times.map((t, i) => [t, r2(((st[i].blur || 0) * 2.4) / Math.max(st[i].scale, 0.01))]), 0.05),
  };
}

function textLayer(e, times, st) {
  const size = e.size * e.font.scale;
  const style = changes(times.map((t, i) => [t, st[i].fill || (st[i].gradient ? st[i].gradient.from : null),
    st[i].outline > 0.01 ? r2(2 * st[i].outline) : 0]));
  const layer = {
    type: 'text', role: e.role, text: e.text, font: e.font.ps || e.font.id, fontFile: e.font.file, fontName: `${e.font.family} ${e.font.label}`,
    size: r2(size), tracking: Math.round(((e.spacing || 0) / size) * 1000), desc: r2(e.desc),
    stroke: st.find((s) => s.outlineColor)?.outlineColor || '#000000', style,
    keys: common(times, st),
  };
  if (st.some((s) => s.clip)) {
    // the karaoke sweep: a mask in layer space (baseline at y = 0)
    layer.keys.mask = thin(times.map((t, i) => {
      const c = st[i].clip || { x: 0, y: 0, w: 0, h: 0 };
      return [t, r2(c.x), r2(c.y + e.desc), r2(Math.max(0, c.w)), r2(c.h)];
    }), 0.05);
  }
  return layer;
}

function boxLayer(e, times, st) {
  return {
    type: 'box', role: e.scope, color: st.find((s) => s.color)?.color || e.color,
    keys: { ...common(times, st), size: thin(times.map((t, i) => [t, r2(st[i].rect.w), r2(st[i].rect.h)]), 0.05),
      radius: thin(times.map((t, i) => [t, r2(st[i].radius || 0)]), 0.05) },
  };
}

// All captions as layer data for the After Effects script.
export function toAE(captions, style, W, H, { fps = 30, duration, name = 'Captions', spaced = true } = {}) {
  const layers = [];
  const fonts = new Map();
  for (const c of captions) {
    if (!c.words.length || c.end <= c.start) continue;
    const scene = buildScene(c, style, W, H, spaced);
    // samples on the composition's frames (what After Effects shows), plus the
    // caption's own first and last moments
    const times = [c.start];
    for (let f = Math.floor(c.start * fps) + 1; f / fps < c.end - 1e-4; f++) times.push(f / fps);
    times.push(c.end - 1e-4);
    scene.elements.forEach((e) => {
      const raw = times.map((t) => elementState(scene, e, t));
      if (!raw.some((s) => s.visible)) return;
      const st = filled(raw);
      const layer = e.kind === 'box' ? boxLayer(e, times, st) : textLayer(e, times, st);
      if (layer.type === 'text') fonts.set(layer.fontFile, { file: layer.fontFile, ps: layer.font, name: layer.fontName });
      layer.in = r4(c.start);
      // keyframe times stay exact: rounding would move them off the frames
      layer.out = r4(c.end);
      layer.name = `${c.words.map((w) => w.text).join(' ').slice(0, 40)} · ${layer.type === 'text' ? `${e.text}${e.role !== 'main' ? ` (${e.role})` : ''}` : `${e.scope} box`}`;
      layers.push(layer);
    });
  }
  return { name, width: W, height: H, fps, duration: Math.max(duration || 0, ...captions.map((c) => c.end)), layers, fonts: [...fonts.values()] };
}
