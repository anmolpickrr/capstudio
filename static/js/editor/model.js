// The editor's project: tracks of clips on a timeline, and every edit made to them.
// Pure data and functions (no DOM), shared by the preview, the export and the tests.
//
// A clip sits on a track from `start` for `dur` timeline seconds. Media clips play
// their source from `in` at `speed`, so the source time at timeline time t is
// in + (t - start) × speed. Properties (position, scale, rotation, opacity,
// volume…) have a value, or keyframes (times relative to the clip's start) that
// override it. A clip's `transIn` is a transition from the clip just before it on
// the same track (centred on the cut), or an entrance when nothing is there;
// `transOut` is an exit when nothing follows.

export const FRAME = (p) => 1 / (p.fps || 30);

export const PRESETS = [
  { id: '9x16', label: 'Vertical 9:16', note: 'Reels, Shorts, TikTok', W: 1080, H: 1920 },
  { id: '1x1', label: 'Square 1:1', note: 'Feed posts', W: 1080, H: 1080 },
  { id: '4x5', label: 'Portrait 4:5', note: 'Instagram feed', W: 1080, H: 1350 },
  { id: '16x9', label: 'Landscape 16:9', note: 'YouTube, websites', W: 1920, H: 1080 },
];

export const EASES = {
  linear: { label: 'Linear', f: (p) => p },
  in: { label: 'Ease in', f: (p) => p * p * p },
  out: { label: 'Ease out', f: (p) => 1 - (1 - p) ** 3 },
  inout: { label: 'Ease in and out', f: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2) },
  hold: { label: 'Hold', f: () => 0 },
};

export const TRANSITIONS = {
  dissolve: { label: 'Cross dissolve' },
  'dip-black': { label: 'Dip to black' },
  'dip-white': { label: 'Dip to white' },
  'slide-left': { label: 'Slide left' },
  'slide-right': { label: 'Slide right' },
  'slide-up': { label: 'Slide up' },
  'slide-down': { label: 'Slide down' },
  'push-left': { label: 'Push left' },
  'push-right': { label: 'Push right' },
  'wipe-left': { label: 'Wipe left' },
  'wipe-right': { label: 'Wipe right' },
  'wipe-up': { label: 'Wipe up' },
  'wipe-down': { label: 'Wipe down' },
  zoom: { label: 'Zoom in' },
  blur: { label: 'Blur' },
};

export const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Colour dodge'], ['soft-light', 'Soft light'],
  ['hard-light', 'Hard light'], ['difference', 'Difference'], ['luminosity', 'Luminosity']];

// Colour settings; each is 0 when untouched. Looks are presets of them.
export const EFFECTS = {
  exposure: { label: 'Exposure', min: -100, max: 100 },
  contrast: { label: 'Contrast', min: -100, max: 100 },
  saturation: { label: 'Saturation', min: -100, max: 100 },
  temperature: { label: 'Temperature', min: -100, max: 100 },
  tint: { label: 'Tint', min: -100, max: 100 },
  hue: { label: 'Hue', min: -180, max: 180 },
  fade: { label: 'Fade', min: 0, max: 100 },
  vignette: { label: 'Vignette', min: 0, max: 100 },
  blur: { label: 'Blur', min: 0, max: 100 },
  mono: { label: 'Black & white', min: 0, max: 100 },
};
export const EFFECT_KEYS = ['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'hue', 'fade', 'vignette', 'blur', 'mono'];

export const LOOKS = {
  none: { label: 'Original', fx: {} },
  vivid: { label: 'Vivid', fx: { contrast: 18, saturation: 35, exposure: 4 } },
  warm: { label: 'Warm', fx: { temperature: 40, saturation: 10, exposure: 3 } },
  cool: { label: 'Cool', fx: { temperature: -40, contrast: 8 } },
  film: { label: 'Film', fx: { contrast: 12, saturation: -18, temperature: 15, fade: 25, vignette: 30 } },
  moody: { label: 'Moody', fx: { exposure: -12, contrast: 25, saturation: -25, temperature: -12, vignette: 45 } },
  bright: { label: 'Bright & airy', fx: { exposure: 18, contrast: -12, saturation: -5, fade: 12 } },
  punch: { label: 'Punchy', fx: { contrast: 35, saturation: 25, vignette: 20 } },
  mono: { label: 'Black & white', fx: { mono: 100, contrast: 20 } },
  noir: { label: 'Noir', fx: { mono: 100, contrast: 55, exposure: -8, vignette: 55 } },
  vintage: { label: 'Vintage', fx: { saturation: -30, temperature: 30, fade: 30, contrast: -8, vignette: 35 } },
  teal: { label: 'Teal & orange', fx: { temperature: 18, tint: -14, contrast: 20, saturation: 15 } },
};

export const TEXT_ANIMS = { none: 'None', fade: 'Fade', pop: 'Pop', rise: 'Slide up', drop: 'Drop', typewriter: 'Typewriter', wipe: 'Wipe' };

// Properties that can be keyframed, with their default values.
export const PROPS = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1 };
export const VISUAL = new Set(['video', 'image', 'text', 'shape', 'captions']);
export const AUDIBLE = new Set(['video', 'audio']);

let seq = 0;
export const uid = (p = 'c') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const r6 = (v) => Math.round(v * 1e6) / 1e6;

export function newProject({ name = 'Untitled video', preset = '9x16', W, H, fps = 30 } = {}) {
  const pr = PRESETS.find((x) => x.id === preset) || PRESETS[0];
  return {
    id: uid('e'), name, W: W || pr.W, H: H || pr.H, fps, bg: '#000000',
    tracks: [newTrack('video', 'V2'), newTrack('video', 'V1'), newTrack('audio', 'A1'), newTrack('audio', 'A2')],
    clips: [], assets: {}, createdAt: Date.now(),
  };
}

export function newTrack(type, name) {
  return { id: uid('t'), type, name, muted: false, hidden: false, locked: false };
}

// Track names follow their order: video tracks V1 at the bottom of the stack upward,
// audio A1 downward.
export function renameTracks(p) {
  const v = p.tracks.filter((t) => t.type === 'video'), a = p.tracks.filter((t) => t.type === 'audio');
  v.forEach((t, i) => { t.name = `V${v.length - i}`; });
  a.forEach((t, i) => { t.name = `A${i + 1}`; });
}

export function addTrack(p, type) {
  const t = newTrack(type, '');
  if (type === 'video') p.tracks.unshift(t); else p.tracks.push(t);
  renameTracks(p);
  return t;
}

export function removeTrack(p, id) {
  const t = p.tracks.find((x) => x.id === id);
  if (!t || p.tracks.filter((x) => x.type === t.type).length < 2) return false;
  p.clips = p.clips.filter((c) => c.track !== id);
  p.tracks = p.tracks.filter((x) => x.id !== id);
  renameTracks(p);
  return true;
}

export const trackOf = (p, c) => p.tracks.find((t) => t.id === c.track);
export const clipById = (p, id) => p.clips.find((c) => c.id === id);
export const end = (c) => c.start + c.dur;
export const duration = (p) => Math.max(0, ...p.clips.map(end));
export const trackKind = (type) => (type === 'audio' ? 'audio' : 'video');
// visual stacking: the bottom video track (V1) first
export const videoTracksBottomUp = (p) => p.tracks.filter((t) => t.type === 'video').reverse();

// A new clip of a kind, with every field it can have.
export function makeClip(type, fields = {}) {
  const c = {
    id: uid(), type, name: fields.name || type, track: null, start: 0, dur: 5, in: 0, speed: 1,
    props: { ...PROPS }, keys: {}, fit: 'contain', blend: 'source-over', fx: {}, look: 'none',
    audio: { fadeIn: 0, fadeOut: 0, mute: false }, transIn: null, transOut: null,
  };
  if (type === 'text') {
    c.text = { content: 'Your text', font: 'Poppins-Bold', size: 96, color: '#FFFFFF', align: 'center', lineHeight: 1.15,
      bg: false, bgColor: '#000000', bgOpacity: 0.7, pad: 24, radius: 16, outline: 0, outlineColor: '#000000',
      shadow: 0.5, animIn: 'pop', animOut: 'fade' };
    c.name = 'Text';
  }
  if (type === 'shape') {
    c.shape = { kind: 'rect', w: 600, h: 200, fill: '#6037D7', radius: 24 };
    c.name = 'Shape';
  }
  if (type === 'captions') { c.name = 'Captions'; c.captions = []; c.style = null; }
  return Object.assign(c, fields, { props: { ...c.props, ...(fields.props || {}) } });
}

// ---------------------------------------------------------------- keyframes

export function valueAt(c, prop, t) {
  const keys = c.keys?.[prop];
  const base = c.props?.[prop] ?? PROPS[prop];
  if (!keys?.length) return base;
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (t < keys[i].t) {
      const a = keys[i - 1], b = keys[i];
      const f = (EASES[b.ease] || EASES.linear).f;
      return a.v + (b.v - a.v) * f((t - a.t) / ((b.t - a.t) || 1));
    }
  }
  return keys[keys.length - 1].v;
}

const near = (a, b, eps) => Math.abs(a - b) <= eps;

// Set a property at clip-local time t: updates (or adds) a keyframe when the
// property is animated, else changes its value.
export function setValue(c, prop, v, t, eps = 1 / 60) {
  const keys = c.keys?.[prop];
  if (!keys?.length) { c.props[prop] = v; return; }
  const k = keys.find((x) => near(x.t, t, eps));
  if (k) k.v = v; else { keys.push({ t: r6(t), v, ease: 'inout' }); keys.sort((a, b) => a.t - b.t); }
}

export const keyAt = (c, prop, t, eps = 1 / 60) => c.keys?.[prop]?.find((k) => near(k.t, t, eps)) || null;

// Add a keyframe with the current value, or remove the one at t. The last one
// removed turns the property back into a plain value (the value it had there).
export function toggleKey(c, prop, t, eps = 1 / 60) {
  c.keys ||= {};
  const keys = c.keys[prop] || [];
  const k = keys.find((x) => near(x.t, t, eps));
  if (k) {
    keys.splice(keys.indexOf(k), 1);
    if (!keys.length) { c.props[prop] = k.v; delete c.keys[prop]; }
    return false;
  }
  const v = valueAt(c, prop, t);
  keys.push({ t: r6(t), v, ease: 'inout' });
  keys.sort((a, b) => a.t - b.t);
  c.keys[prop] = keys;
  return true;
}

export function allKeyTimes(c) {
  const ts = new Set();
  for (const keys of Object.values(c.keys || {})) for (const k of keys) ts.add(k.t);
  return [...ts].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- media time

export const sourceTime = (c, t) => c.in + (t - c.start) * c.speed;
const hasSource = (c) => c.type === 'video' || c.type === 'audio';
// how far a clip can reach into its source, in timeline seconds
export const maxDur = (p, c) => (hasSource(c) && p.assets[c.asset]?.duration ? (p.assets[c.asset].duration - c.in) / c.speed : Infinity);

// ---------------------------------------------------------------- placement

const EPS = 1e-6;
const overlaps = (a0, a1, b0, b1) => a0 < b1 - EPS && b0 < a1 - EPS;
export const clipsOn = (p, trackId, except = null) => p.clips.filter((c) => c.track === trackId && c.id !== except).sort((a, b) => a.start - b.start);

export function isFree(p, trackId, start, dur, except = null) {
  return !clipsOn(p, trackId, except).some((c) => overlaps(start, start + dur, c.start, end(c)));
}

// The nearest start to `want` on the track where the clip fits without
// overlapping others (null when it can't fit anywhere near).
export function fitStart(p, trackId, want, dur, except = null) {
  const others = clipsOn(p, trackId, except);
  const gaps = [];
  let prev = 0;
  for (const c of others) { gaps.push([prev, c.start]); prev = Math.max(prev, end(c)); }
  gaps.push([prev, Infinity]);
  let best = null;
  for (const [a, b] of gaps) {
    if (b - a < dur - EPS) continue;
    const s = Math.min(Math.max(want, a), b - dur);
    if (best === null || Math.abs(s - want) < Math.abs(best - want)) best = s;
  }
  return best;
}

// A track of the right kind that's free over [start, start + dur], preferring
// `prefer`; a new one is added when none is.
export function freeTrack(p, type, start, dur, prefer = null) {
  const kind = trackKind(type);
  const tracks = p.tracks.filter((t) => t.type === kind && !t.locked);
  let order = kind === 'video' ? [...tracks].reverse() : tracks; // V1 first, A1 first
  const i = prefer ? order.findIndex((t) => t.id === prefer) : -1;
  if (i > 0) order = [order[i], ...order.filter((_, k) => k !== i)];
  for (const t of order) if (isFree(p, t.id, start, dur)) return t;
  return addTrack(p, kind);
}

export function addClip(p, c, { track = null, at = null } = {}) {
  const t = track ? p.tracks.find((x) => x.id === track) : null;
  const start = Math.max(0, at ?? 0);
  if (t && trackKind(c.type) === t.type && isFree(p, t.id, start, c.dur)) c.track = t.id;
  else c.track = freeTrack(p, c.type, start, c.dur, track).id;
  c.start = r6(start);
  p.clips.push(c);
  return c;
}

// Move a clip; it stops at its neighbours instead of covering them. Returns false
// when there's no room on that track.
export function moveClip(p, id, start, trackId = null) {
  const c = clipById(p, id);
  const tId = trackId || c.track;
  const t = p.tracks.find((x) => x.id === tId);
  if (!t || t.type !== trackKind(c.type) || t.locked) return false;
  const s = fitStart(p, tId, Math.max(0, start), c.dur, c.id);
  if (s === null) return false;
  c.track = tId;
  c.start = r6(s);
  return true;
}

// Drag a clip's left edge to timeline time `to` (its right edge stays put).
export function trimStart(p, id, to) {
  const c = clipById(p, id);
  const others = clipsOn(p, c.track, c.id).filter((o) => end(o) <= c.start + EPS);
  const lo = Math.max(0, others.length ? end(others[others.length - 1]) : 0,
    hasSource(c) ? c.start - c.in / c.speed : -Infinity);
  const hi = end(c) - FRAME(p);
  to = Math.min(Math.max(to, lo), hi);
  const d = to - c.start;
  shiftKeys(c, -d);
  c.in = r6(c.in + d * c.speed);
  c.dur = r6(c.dur - d);
  c.start = r6(to);
  if (hasSource(c)) c.in = Math.max(0, c.in);
}

// Drag a clip's right edge to timeline time `to`.
export function trimEnd(p, id, to) {
  const c = clipById(p, id);
  const next = clipsOn(p, c.track, c.id).find((o) => o.start >= c.start + EPS);
  const hi = Math.min(next ? next.start : Infinity, c.start + maxDur(p, c));
  to = Math.min(Math.max(to, c.start + FRAME(p)), hi);
  c.dur = r6(to - c.start);
}

function shiftKeys(c, d) {
  for (const [prop, keys] of Object.entries(c.keys || {})) {
    c.keys[prop] = keys.map((k) => ({ ...k, t: r6(k.t + d) }));
  }
}

// Cut a clip in two at timeline time t. Returns the new (right-hand) clip.
export function splitClip(p, id, t) {
  const c = clipById(p, id);
  if (!c || t <= c.start + FRAME(p) / 2 || t >= end(c) - FRAME(p) / 2) return null;
  const right = JSON.parse(JSON.stringify(c));
  right.id = uid();
  const d = t - c.start;
  right.start = r6(t);
  right.dur = r6(c.dur - d);
  right.in = r6(c.in + d * c.speed);
  right.transIn = null;
  shiftKeys(right, -d);
  c.dur = r6(d);
  c.transOut = null;
  // keyframes stay on the side they belong to, plus the value at the cut on both
  for (const prop of Object.keys(c.keys || {})) {
    const v = valueAt(c, prop, d);
    c.keys[prop] = c.keys[prop].filter((k) => k.t < d - EPS);
    c.keys[prop].push({ t: r6(d), v, ease: 'linear' });
    right.keys[prop] = right.keys[prop].filter((k) => k.t > EPS);
    right.keys[prop].unshift({ t: 0, v, ease: 'linear' });
  }
  if (c.type === 'captions') {
    right.captions = c.captions.filter((x) => x.end > d).map((x) => shiftCaption(x, -d)).filter((x) => x.end > 0);
    c.captions = c.captions.filter((x) => x.start < d);
  }
  p.clips.push(right);
  return right;
}

function shiftCaption(cap, d) {
  return { ...cap, start: Math.max(0, cap.start + d), end: cap.end + d, words: cap.words.map((w) => ({ ...w, start: w.start + d, end: w.end + d })) };
}

// Delete clips. With ripple, later clips on the same tracks close the gap.
export function removeClips(p, ids, ripple = false) {
  const gone = p.clips.filter((c) => ids.includes(c.id));
  p.clips = p.clips.filter((c) => !ids.includes(c.id));
  if (!ripple) return;
  for (const g of gone.sort((a, b) => b.start - a.start)) {
    for (const c of p.clips) if (c.track === g.track && c.start >= end(g) - EPS) c.start = r6(c.start - g.dur);
  }
}

// Remove the empty space before a clip on its track.
export function closeGap(p, trackId, at) {
  const cs = clipsOn(p, trackId);
  let prevEnd = 0;
  for (const c of cs) {
    if (c.start > prevEnd + EPS && at >= prevEnd - EPS && at <= c.start + EPS) {
      const d = c.start - prevEnd;
      for (const o of cs) if (o.start >= c.start - EPS) o.start = r6(o.start - d);
      return d;
    }
    prevEnd = Math.max(prevEnd, end(c));
  }
  return 0;
}

export function duplicateClip(p, id) {
  const c = clipById(p, id);
  const copy = JSON.parse(JSON.stringify(c));
  copy.id = uid();
  const s = fitStart(p, c.track, end(c), c.dur);
  if (s !== null && Math.abs(s - end(c)) < 1e-3) { copy.start = r6(s); p.clips.push(copy); return copy; }
  copy.track = freeTrack(p, c.type, end(c), c.dur, c.track).id;
  copy.start = r6(end(c));
  p.clips.push(copy);
  return copy;
}

export function setSpeed(p, id, speed) {
  const c = clipById(p, id);
  const srcLen = c.dur * c.speed;
  const ratio = c.speed / speed;
  c.speed = speed;
  let dur = srcLen / speed;
  const next = clipsOn(p, c.track, c.id).find((o) => o.start >= c.start + EPS);
  if (next) dur = Math.min(dur, next.start - c.start);
  c.dur = r6(Math.max(FRAME(p), dur));
  for (const [prop, keys] of Object.entries(c.keys || {})) c.keys[prop] = keys.map((k) => ({ ...k, t: r6(k.t * ratio) }));
}

// ---------------------------------------------------------------- transitions

// The clip right before c on its track, if it ends where c starts.
export function prevAdjacent(p, c) {
  const tol = FRAME(p) * 1.01;
  return clipsOn(p, c.track, c.id).find((o) => Math.abs(end(o) - c.start) <= tol && o.start < c.start) || null;
}
export function nextAdjacent(p, c) {
  const tol = FRAME(p) * 1.01;
  return clipsOn(p, c.track, c.id).find((o) => Math.abs(o.start - end(c)) <= tol && o.start > c.start) || null;
}

// The windows in which a clip is drawn, and its transitions there. Cross
// transitions are centred on the cut, so the outgoing clip runs on a little past
// its end and the incoming one starts a little early (holding the edge frame when
// the source has nothing more).
export function transitionsFor(p, c) {
  let from = c.start, to = end(c);
  const out = { in: null, out: null };
  if (c.transIn?.type && c.transIn.dur > 0) {
    const prev = prevAdjacent(p, c);
    const d = Math.min(c.transIn.dur, c.dur, prev ? prev.dur : Infinity);
    if (prev) { out.in = { type: c.transIn.type, a: c.start - d / 2, b: c.start + d / 2, cross: true }; from = c.start - d / 2; }
    else out.in = { type: c.transIn.type, a: c.start, b: c.start + Math.min(d, c.dur), cross: false };
  }
  const next = nextAdjacent(p, c);
  if (next?.transIn?.type && next.transIn.dur > 0) {
    const d = Math.min(next.transIn.dur, next.dur, c.dur);
    out.out = { type: next.transIn.type, a: end(c) - d / 2, b: end(c) + d / 2, cross: true };
    to = end(c) + d / 2;
  } else if (c.transOut?.type && c.transOut.dur > 0) {
    const d = Math.min(c.transOut.dur, c.dur);
    out.out = { type: c.transOut.type, a: end(c) - d, b: end(c), cross: false };
  }
  return { from, to, ...out };
}

// How a clip looks at progress q (0..1) through a transition, as the incoming
// ('in') or outgoing ('out') side.
export function transitionLook(type, q, role, W, H) {
  const p = EASES.inout.f(Math.min(1, Math.max(0, q)));
  const L = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, clip: null, color: null, colorAlpha: 0 };
  const inn = role === 'in';
  const dir = type.split('-')[1];
  const sx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, sy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
  switch (type.split('-')[0]) {
    case 'dissolve':
      if (inn) L.alpha = p;
      break;
    case 'dip': {
      L.color = type === 'dip-white' ? '#FFFFFF' : '#000000';
      if (inn) { L.alpha = Math.max(0, 2 * p - 1); L.colorAlpha = 1 - Math.abs(2 * p - 1); }
      else L.alpha = Math.max(0, 1 - 2 * p);
      break;
    }
    case 'slide':
      // the new picture slides over the old one, moving towards `dir`
      if (inn) { L.dx = -sx * (1 - p) * W; L.dy = -sy * (1 - p) * H; }
      break;
    case 'push':
      if (inn) { L.dx = -sx * (1 - p) * W; L.dy = -sy * (1 - p) * H; } else { L.dx = sx * p * W; L.dy = sy * p * H; }
      break;
    case 'wipe':
      // the new picture is revealed from the edge opposite `dir`
      if (inn) {
        if (sx < 0) L.clip = { x: W * (1 - p), y: 0, w: W * p, h: H };
        else if (sx > 0) L.clip = { x: 0, y: 0, w: W * p, h: H };
        else if (sy < 0) L.clip = { x: 0, y: H * (1 - p), w: W, h: H * p };
        else L.clip = { x: 0, y: 0, w: W, h: H * p };
      }
      break;
    case 'zoom':
      if (inn) { L.alpha = p; L.scale = 1.35 - 0.35 * p; } else L.scale = 1 + 0.12 * p;
      break;
    case 'blur':
      if (inn) { L.alpha = p; L.blur = 40 * (1 - p); } else L.blur = 40 * p;
      break;
    default:
  }
  return L;
}

// ---------------------------------------------------------------- audio

// The clip's gain at timeline time t (keyframed volume, fades, mute).
export function gainAt(p, c, t) {
  const tr = trackOf(p, c);
  if (!AUDIBLE.has(c.type) || c.audio?.mute || tr?.muted) return 0;
  if (c.type === 'video' && (c.audio?.detached || p.assets[c.asset]?.hasAudio === false)) return 0;
  const lt = t - c.start;
  if (lt < 0 || lt > c.dur) return 0;
  let g = valueAt(c, 'volume', lt);
  const fi = c.audio?.fadeIn || 0, fo = c.audio?.fadeOut || 0;
  if (fi > 0 && lt < fi) g *= lt / fi;
  if (fo > 0 && c.dur - lt < fo) g *= (c.dur - lt) / fo;
  return Math.max(0, g);
}

// ---------------------------------------------------------------- snapshot

export const clone = (p) => JSON.parse(JSON.stringify(p));

// Snap points for dragging: zero, the playhead and every clip edge.
export function snapPoints(p, playhead, except = []) {
  const pts = [0, playhead];
  for (const c of p.clips) if (!except.includes(c.id)) pts.push(c.start, end(c));
  return pts;
}
