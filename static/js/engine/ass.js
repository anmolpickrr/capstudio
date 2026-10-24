// Export: turns caption scenes into an ASS subtitle script that libass
// (ffmpeg's subtitle renderer) burns into the video. Each element becomes one
// event per time step, positioned and styled from the same element states the
// preview draws, so the two match.
import { pathCommands } from './emoji.js';
import { animating, breakpoints } from './motion.js';
import { buildScene, elementState, GRADIENT_BANDS } from './scene.js';
import { bandColors } from './svg.js';

const STEP = 1 / 30;          // sampling step while something is moving (one per frame at 30 fps)
const n2 = (v) => +v.toFixed(2);
const assTime = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const color = (hex) => {
  const h = (hex || '#000000').replace('#', '');
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
};
const alphaHex = (opacity) => Math.round(255 * (1 - Math.min(1, Math.max(0, opacity))));
const escapeText = (s) => s.replace(/\\/g, '⧵').replace(/\{/g, '(').replace(/\}/g, ')');

function drawing(w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const f = (v) => n2(v);
  if (r < 0.5) return `m 0 0 l ${f(w)} 0 ${f(w)} ${f(h)} 0 ${f(h)}`;
  const k = r * 0.4477; // bezier handle so each corner is a circular arc
  return `m ${f(r)} 0 l ${f(w - r)} 0 b ${f(w - k)} 0 ${f(w)} ${f(k)} ${f(w)} ${f(r)} `
    + `l ${f(w)} ${f(h - r)} b ${f(w)} ${f(h - k)} ${f(w - k)} ${f(h)} ${f(w - r)} ${f(h)} `
    + `l ${f(r)} ${f(h)} b ${f(k)} ${f(h)} 0 ${f(h - k)} 0 ${f(h - r)} `
    + `l 0 ${f(r)} b 0 ${f(k)} ${f(k)} 0 ${f(r)} 0`;
}

// An emoji shape as ASS drawing commands (cached on the element).
function drawingOf(el, k) {
  el.ass ||= el.layers.map(([, d]) => pathCommands(d).map(([c, ...v]) => {
    if (c === 'Z') return '';
    return `${c === 'M' ? 'm' : c === 'L' ? 'l' : 'b'} ${v.map(n2).join(' ')}`;
  }).filter(Boolean).join(' '));
  return el.ass[k];
}

// Tags that move one value linearly from a to b over the event.
function animated(name, a, b, dur, fmt = n2) {
  const fa = fmt(a), fb = fmt(b);
  return fa === fb ? `\\${name}${fa}` : `\\${name}${fa}\\t(0,${dur},\\${name}${fb})`;
}

function clipTags(a, b, dur) {
  const r = (c) => `${n2(c.x0)},${n2(c.y0)},${n2(c.x1)},${n2(c.y1)}`;
  const ra = r(a), rb = r(b);
  return ra === rb ? `\\clip(${ra})` : `\\clip(${ra})\\t(0,${dur},\\clip(${rb}))`;
}

// local rect -> screen clip rectangle (no rotation: see effectiveStyle)
const screenRect = (s, rc) => ({ x0: s.pos.x + s.scale * rc.x, y0: s.pos.y + s.scale * rc.y,
  x1: s.pos.x + s.scale * (rc.x + rc.w), y1: s.pos.y + s.scale * (rc.y + rc.h) });

function eventsFor(el, a, b, layer) {
  const dur = Math.max(1, Math.round((b.t - a.t) * 1000));
  const s0 = a.s, s1 = b.s;
  const start = assTime(a.t), end = assTime(b.t);
  if (start === end) return [];
  const pos = (an) => {
    const p0 = `${n2(s0.pos.x)},${n2(s0.pos.y)}`, p1 = `${n2(s1.pos.x)},${n2(s1.pos.y)}`;
    return `\\an${an}${p0 === p1 ? `\\pos(${p0})` : `\\move(${p0},${p1},0,${dur})`}`;
  };
  const scale = `${animated('fscx', s0.scale * 100, s1.scale * 100, dur)}${animated('fscy', s0.scale * 100, s1.scale * 100, dur)}`;
  const o0 = alphaHex(s0.opacity), o1 = alphaHex(s1.opacity);
  const fade = o0 === 0 && o1 === 0 ? '' : `\\fade(${o0},${o1},${o1},0,${dur},${dur},${dur})`;
  const rot = s0.rot ? `\\frz${n2(-s0.rot)}` : '';
  const head = (tags) => `Dialogue: ${layer},${start},${end},W,,0,0,0,,{${tags}}`;

  if (el.kind === 'emoji') {
    // one drawing per shape, stacked in order (libass draws a drawing from its own 0,0)
    const blur = (s0.blur || s1.blur) ? animated('blur', s0.blur, s1.blur, dur) : '';
    return el.layers.map(([c, d, a], k) => `Dialogue: ${layer + k},${start},${end},W,,0,0,0,,{${pos(7)}${scale}\\bord0\\shad0`
      + `\\1c${color(c)}\\1a&H${alphaHex(a ?? 1).toString(16).padStart(2, '0').toUpperCase()}&${fade}${blur}${rot}\\p1}${drawingOf(el, k)}`);
  }
  if (el.kind === 'box') {
    return [`${head(`${pos(7)}${scale}\\bord0\\shad0\\1c${color(s0.color)}\\1a&H00&${fade}${rot}\\p1`)}${drawing(s0.rect.w, s0.rect.h, s0.radius)}`];
  }

  const font = el.font;
  const base = `${pos(2)}\\fn${font.assName}\\fs${n2(el.size)}${el.spacing ? `\\fsp${n2(el.spacing)}` : ''}${scale}\\shad0`
    + `${animated('bord', s0.outline * s0.scale, s1.outline * s1.scale, dur)}\\3c${color(s0.outlineColor)}\\3a&H00&`
    + `${(s0.blur || s1.blur) ? animated('blur', s0.blur, s1.blur, dur) : ''}${fade}${rot}`;
  const text = escapeText(el.text);
  const fillTags = (c) => (c ? `\\1c${color(c)}\\1a&H00&` : '\\1a&HFF&');

  if (s0.gradient) {
    const colors = bandColors(s0.gradient.from, s0.gradient.to, GRADIENT_BANDS);
    const { y0, y1 } = s0.gradient, h = (y1 - y0) / GRADIENT_BANDS, BIG = 1e4;
    return colors.map((c, k) => {
      const rc = { x: -BIG, y: k === 0 ? -BIG : y0 + k * h, w: 2 * BIG, h: 0 };
      rc.h = (k === GRADIENT_BANDS - 1 ? BIG : y0 + (k + 1) * h) - rc.y;
      return `${head(`${base}${fillTags(c)}${clipTags(screenRect(s0, rc), screenRect(s1, rc), dur)}`)}${text}`;
    });
  }
  const clip = s0.clip ? clipTags(screenRect(s0, s0.clip), screenRect(s1, s1.clip), dur) : '';
  return [`${head(`${base}${fillTags(s0.fill)}${clip}`)}${text}`];
}

const sameStatic = (s0, s1) => JSON.stringify(s0) === JSON.stringify(s1);

// Time samples for one element: state boundaries, plus fine steps while moving.
function samples(scene, bps) {
  const { style, caption } = scene;
  const ts = [];
  for (let k = 0; k + 1 < bps.length; k++) {
    const a = bps[k], b = bps[k + 1];
    ts.push(a);
    if (animating(style, caption, (a + b) / 2)) {
      const n = Math.ceil((b - a) / STEP);
      for (let j = 1; j < n; j++) ts.push(a + ((b - a) * j) / n);
    }
  }
  ts.push(bps[bps.length - 1]);
  return ts;
}

export function captionEvents(scene) {
  const out = [];
  const bps = breakpoints(scene.style, scene.caption);
  const ts = samples(scene, bps);
  const EPS = 1e-4;
  scene.elements.forEach((el, zi) => {
    let open = null; // pending static event to extend
    const flush = () => { if (open) { out.push(...eventsFor(el, open.a, open.b, zi)); open = null; } };
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < 0.005) continue;
      const s0 = elementState(scene, el, t0 + EPS);
      if (!s0.visible) { flush(); continue; }
      const s1 = elementState(scene, el, t1 - EPS);
      const end = s1.visible ? s1 : s0;
      if (sameStatic(s0, end)) {
        if (open && open.b.t === t0 && sameStatic(open.a.s, s0)) { open.b = { t: t1, s: end }; continue; }
        flush();
        open = { a: { t: t0, s: s0 }, b: { t: t1, s: end } };
      } else {
        flush();
        out.push(...eventsFor(el, { t: t0, s: s0 }, { t: t1, s: end }, zi));
      }
    }
    flush();
  });
  return out;
}

export function toASS(captions, style, W, H, { spaced = true } = {}) {
  const header = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2',
    'ScaledBorderAndShadow: yes', 'YCbCr Matrix: None', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: W,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,0,0,0,1',
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = [];
  for (const c of captions) {
    if (c.end <= c.start || !c.words.length) continue;
    events.push(...captionEvents(buildScene(c, style, W, H, spaced)));
  }
  return [...header, ...events, ''].join('\n');
}
