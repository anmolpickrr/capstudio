// Animation presets. A preset is a set of keyframe tracks; times are seconds
// (divided by the style's speed). The preview evaluates them every frame and
// the exporter samples them into short linear steps for libass, so both follow
// the same curves.

const out = (p) => 1 - (1 - p) * (1 - p);
const inOut = (p) => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p));
const EASE = { linear: (p) => p, out, in: (p) => p * p, inout: inOut };

// [time, value, easing of the segment that ends here]
export const CAPTION_IN = {
  none: { label: 'None' },
  fade: { label: 'Fade', opacity: [[0, 0], [0.22, 1, 'out']] },
  pop: { label: 'Pop', opacity: [[0, 0], [0.06, 1]], scale: [[0, 0.62], [0.12, 1.08, 'out'], [0.2, 1, 'inout']] },
  zoom: { label: 'Zoom in', opacity: [[0, 0], [0.14, 1]], scale: [[0, 1.3], [0.26, 1, 'out']] },
  rise: { label: 'Slide up', opacity: [[0, 0], [0.16, 1]], dy: [[0, 0.045], [0.28, 0, 'out']] },
  fall: { label: 'Slide down', opacity: [[0, 0], [0.16, 1]], dy: [[0, -0.045], [0.28, 0, 'out']] },
  blur: { label: 'Blur in', opacity: [[0, 0], [0.2, 1, 'out']], blur: [[0, 14], [0.3, 0, 'out']] },
  drop: { label: 'Drop & bounce', opacity: [[0, 0], [0.05, 1]], dy: [[0, -0.09], [0.18, 0.008, 'in'], [0.26, -0.006, 'out'], [0.32, 0, 'inout']] },
  stamp: { label: 'Stamp', opacity: [[0, 0], [0.04, 1]], scale: [[0, 1.7], [0.13, 0.96, 'in'], [0.2, 1, 'out']] },
};

export const CAPTION_OUT = {
  none: { label: 'None' },
  fade: { label: 'Fade out', opacity: [[0, 1], [0.16, 0, 'in']] },
  shrink: { label: 'Shrink', opacity: [[0, 1], [0.14, 0, 'in']], scale: [[0, 1], [0.14, 0.8, 'in']] },
  sink: { label: 'Slide down', opacity: [[0, 1], [0.16, 0, 'in']], dy: [[0, 0], [0.16, 0.03, 'in']] },
  blur: { label: 'Blur out', opacity: [[0, 1], [0.18, 0, 'in']], blur: [[0, 0], [0.18, 12, 'in']] },
};

export const WORD_IN = {
  none: { label: 'None' },
  pop: { label: 'Pop', opacity: [[0, 0], [0.04, 1]], scale: [[0, 0.5], [0.1, 1.14, 'out'], [0.17, 1, 'inout']] },
  rise: { label: 'Rise', opacity: [[0, 0], [0.12, 1]], dy: [[0, 0.025], [0.2, 0, 'out']] },
  fade: { label: 'Fade', opacity: [[0, 0], [0.16, 1, 'out']] },
  drop: { label: 'Drop', opacity: [[0, 0], [0.05, 1]], dy: [[0, -0.04], [0.16, 0.004, 'in'], [0.22, 0, 'out']] },
  zoom: { label: 'Zoom', opacity: [[0, 0], [0.08, 1]], scale: [[0, 1.6], [0.16, 1, 'out']] },
  blur: { label: 'Blur in', opacity: [[0, 0], [0.18, 1, 'out']], blur: [[0, 10], [0.26, 0, 'out']], dy: [[0, 0.008], [0.26, 0, 'out']] },
};

// an emoji pops in when its word is spoken
export const EMOJI_IN = { opacity: [[0, 0], [0.05, 1]], scale: [[0, 0.3], [0.14, 1.18, 'out'], [0.24, 1, 'inout']] };

export function emojiAppears(caption) {
  const w = caption.words.find((x) => x.emoji);
  return w ? Math.max(caption.start, Math.min(w.start, caption.end - 0.3)) : null;
}

export function emojiMotion(style, caption, t) {
  const at = emojiAppears(caption), speed = style.speed || 1;
  if (at === null || t < at) return { visible: false, scale: 1, opacity: 0 };
  return { visible: true, scale: track(scaled(EMOJI_IN.scale, speed), t - at), opacity: track(scaled(EMOJI_IN.opacity, speed), t - at) };
}

const emojiOn = (style, caption) => style.emoji && style.emoji !== 'off' && caption.words.some((w) => w.emoji);

export const CASCADE_GAP = 0.07; // seconds between words for "cascade" entrances
const HL_TWEEN = 0.07;           // active-word grow/shrink time

function track(keys, t) {
  if (!keys) return null;
  if (t <= keys[0][0]) return keys[0][1];
  for (let k = 1; k < keys.length; k++) {
    const [t1, v1, ease] = keys[k];
    if (t <= t1) {
      const [t0, v0] = keys[k - 1];
      const p = (EASE[ease] || EASE.linear)((t - t0) / (t1 - t0));
      return v0 + (v1 - v0) * p;
    }
  }
  return keys[keys.length - 1][1];
}

const scaled = (keys, speed) => keys && keys.map(([t, v, e]) => [t / speed, v, e]);
const span = (preset) => Math.max(0, ...['opacity', 'scale', 'dy', 'blur']
  .filter((k) => preset[k]).map((k) => preset[k][preset[k].length - 1][0]));

export function presetDuration(preset, speed = 1) { return span(preset) / speed; }

// Caption-level motion at time t: opacity, scale, vertical shift (fraction of
// video height) and extra blur.
export function groupMotion(style, caption, t) {
  const speed = style.speed || 1;
  const pin = CAPTION_IN[style.animIn] || CAPTION_IN.none;
  const pout = CAPTION_OUT[style.animOut] || CAPTION_OUT.none;
  const rel = t - caption.start, toEnd = caption.end - t;
  const dur = caption.end - caption.start;
  const outLen = Math.min(presetDuration(pout, speed), dur / 3);
  const r = { opacity: 1, scale: 1, dy: 0, blur: 0 };
  const apply = (preset, at) => {
    for (const k of ['opacity', 'scale', 'dy', 'blur']) {
      const v = track(scaled(preset[k], speed), at);
      if (v === null) continue;
      if (k === 'opacity' || k === 'scale') r[k] *= v; else r[k] += v;
    }
  };
  apply(pin, rel);
  if (outLen > 0 && toEnd < outLen) apply(pout, outLen - toEnd);
  return r;
}

// When word i first appears (null = together with the caption).
export function wordAppears(style, caption, i) {
  if (style.reveal) return i === 0 ? caption.start : caption.words[i].start;
  if (style.cascade) return caption.start + (i * CASCADE_GAP) / (style.speed || 1);
  return null;
}

// Word-level motion at time t: visibility, opacity, scale, vertical shift.
export function wordMotion(style, caption, i, t) {
  const at = wordAppears(style, caption, i);
  const r = { visible: true, opacity: 1, scale: 1, dy: 0, blur: 0 };
  if (at !== null) {
    if (t < at) return { ...r, visible: false, opacity: 0 };
    const preset = WORD_IN[style.wordIn] || WORD_IN.none;
    const speed = style.speed || 1;
    const rel = t - at;
    const o = track(scaled(preset.opacity, speed), rel);
    const s = track(scaled(preset.scale, speed), rel);
    const d = track(scaled(preset.dy, speed), rel);
    const bl = track(scaled(preset.blur, speed), rel);
    if (bl !== null) r.blur = bl;
    if (o !== null) r.opacity = o;
    if (s !== null) r.scale = s;
    if (d !== null) r.dy = d;
  }
  return r;
}

// Highlight state of word i: is it the word being spoken, has it been spoken,
// and how far through it the speaker is (for karaoke sweeps).
export function wordTiming(caption, i, t) {
  const w = caption.words[i];
  const until = i + 1 < caption.words.length ? caption.words[i + 1].start : caption.end;
  const active = t >= w.start && t < until;
  const spoken = t >= until;
  const sweepEnd = Math.max(w.start + 0.05, Math.min(w.end, until));
  const progress = Math.min(1, Math.max(0, (t - w.start) / (sweepEnd - w.start)));
  return { active, spoken, progress, start: w.start, until, sweepEnd };
}

// Grow factor for the active word (smoothly in and out).
export function activeScale(style, caption, i, t) {
  const target = style.hlScale || 1;
  if (target === 1 || style.highlight === 'none') return 1;
  const { start, until } = wordTiming(caption, i, t);
  const grow = HL_TWEEN / (style.speed || 1);
  if (t < start || t >= until + grow) return 1;
  if (t < start + grow) return 1 + (target - 1) * out((t - start) / grow);
  if (t < until) return target;
  return target + (1 - target) * out((t - until) / grow);
}

// Every time at which some motion or state begins or ends for this caption;
// the exporter only needs to split events at these points.
export function breakpoints(style, caption) {
  const speed = style.speed || 1;
  const pts = new Set([caption.start, caption.end]);
  const pin = CAPTION_IN[style.animIn] || CAPTION_IN.none;
  const pout = CAPTION_OUT[style.animOut] || CAPTION_OUT.none;
  const dur = caption.end - caption.start;
  for (const k of ['opacity', 'scale', 'dy', 'blur']) {
    for (const [t] of pin[k] || []) pts.add(caption.start + t / speed);
  }
  const outLen = Math.min(presetDuration(pout, speed), dur / 3);
  if (outLen > 0) pts.add(caption.end - outLen);
  caption.words.forEach((w, i) => {
    const at = wordAppears(style, caption, i);
    if (at !== null) {
      pts.add(at);
      const wp = WORD_IN[style.wordIn] || WORD_IN.none;
      pts.add(at + presetDuration(wp, speed));
    }
    const { start, until, sweepEnd } = wordTiming(caption, i, start0(w));
    pts.add(start); pts.add(until); pts.add(sweepEnd);
    if ((style.hlScale || 1) !== 1) { pts.add(start + HL_TWEEN / speed); pts.add(until + HL_TWEEN / speed); }
  });
  if (emojiOn(style, caption)) {
    const at = emojiAppears(caption);
    for (const [t] of EMOJI_IN.scale) pts.add(at + t / speed);
  }
  return [...pts].filter((t) => t >= caption.start && t <= caption.end).sort((a, b) => a - b);
}
const start0 = (w) => w.start;

// True while anything about the caption is moving at time t (not just changing state).
export function animating(style, caption, t) {
  const speed = style.speed || 1;
  const pin = CAPTION_IN[style.animIn] || CAPTION_IN.none;
  if (t - caption.start < presetDuration(pin, speed)) return true;
  if (emojiOn(style, caption)) {
    const at = emojiAppears(caption);
    if (t >= at && t - at < presetDuration(EMOJI_IN, speed)) return true;
  }
  const pout = CAPTION_OUT[style.animOut] || CAPTION_OUT.none;
  const outLen = Math.min(presetDuration(pout, speed), (caption.end - caption.start) / 3);
  if (outLen > 0 && caption.end - t < outLen) return true;
  for (let i = 0; i < caption.words.length; i++) {
    const at = wordAppears(style, caption, i);
    if (at !== null && t >= at && t - at < presetDuration(WORD_IN[style.wordIn] || WORD_IN.none, speed)) return true;
    if ((style.hlScale || 1) !== 1 && style.highlight !== 'none') {
      const { start, until } = wordTiming(caption, i, t);
      const g = HL_TWEEN / speed;
      if ((t >= start && t < start + g) || (t >= until && t < until + g)) return true;
    }
    if (style.highlight === 'sweep') {
      const { start, sweepEnd } = wordTiming(caption, i, t);
      if (t >= start && t < sweepEnd) return true;
    }
  }
  return false;
}
