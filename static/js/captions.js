// Caption engine shared by the live preview and the export.
//
// Everything that decides what a caption looks like at a given moment
// (chunking, line breaks, word states, animation curves, geometry) lives here,
// and both the SVG preview and the ASS file sent to ffmpeg/libass are generated
// from it. That's what keeps the preview and the exported video in sync.

export const SENTENCE_END = /[.!?।॥。？！]["'”’)]*$/;

let nextId = 1;
export const uid = () => `c${nextId++}`;

// ---------------------------------------------------------------- chunking

export function chunkWords(words, style, spaced = true) {
  const maxWords = style.maxWords, maxChars = style.maxCharsPerLine * style.maxLines;
  const groups = [];
  let cur = [];
  const width = (ws) => ws.reduce((n, w, i) => n + w.text.length + (i && spaced ? 1 : 0), 0);
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      if (cur.length >= maxWords
        || width([...cur, w]) > maxChars
        || w.start - prev.end > 0.6           // speaker pause
        || w.end - cur[0].start > 6           // keep captions readable
        || (SENTENCE_END.test(prev.text) && maxWords > 1)) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups.map((ws, i) => {
    const last = ws[ws.length - 1].end;
    const next = groups[i + 1];
    // Linger briefly after the last word so captions don't flash off.
    let end = last + 0.3;
    if (next) end = Math.min(end, next[0].start);
    return { id: uid(), start: ws[0].start, end: Math.max(end, last), words: ws.map((w) => ({ ...w })) };
  });
}

export function flattenWords(captions) {
  return captions.flatMap((c) => c.words);
}

// --------------------------------------------------------------- text/lines

const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

export function displayWord(text, style) {
  let s = text;
  if (style.stripPunctuation) {
    const stripped = s.replace(EDGE_PUNCT, '');
    if (stripped) s = stripped;
  }
  if (style.textCase === 'upper') s = s.toLocaleUpperCase();
  else if (style.textCase === 'lower') s = s.toLocaleLowerCase();
  return s;
}

// Splits word indices into at most maxLines balanced lines.
export function breakLines(texts, maxChars, maxLines, spaced) {
  const n = texts.length, sep = spaced ? 1 : 0;
  const all = [...Array(n).keys()];
  const width = (a, b) => {
    let s = 0;
    for (let i = a; i < b; i++) s += texts[i].length + (i > a ? sep : 0);
    return s;
  };
  if (n < 2 || maxLines < 2 || width(0, n) <= maxChars) return [all];
  let best = null;
  for (let k = 2; k <= Math.min(maxLines, n); k++) {
    // minimise the longest line, prefer slightly bottom-heavy splits
    const memo = new Map();
    const solve = (start, lines) => {
      const key = start * 16 + lines;
      if (memo.has(key)) return memo.get(key);
      let res;
      if (lines === 1) res = { cost: width(start, n), cuts: [] };
      else {
        res = { cost: Infinity, cuts: [] };
        for (let cut = start + 1; cut <= n - lines + 1; cut++) {
          const sub = solve(cut, lines - 1);
          const w = width(start, cut);
          const cost = Math.max(w, sub.cost) + (w > sub.cost ? 0.5 : 0);
          if (cost < res.cost) res = { cost, cuts: [cut, ...sub.cuts] };
        }
      }
      memo.set(key, res);
      return res;
    };
    const r = solve(0, k);
    best = r;
    if (Math.floor(r.cost) <= maxChars) break;
  }
  const lines = [];
  let prev = 0;
  for (const cut of [...best.cuts, n]) {
    lines.push(all.slice(prev, cut));
    prev = cut;
  }
  return lines;
}

export function layoutCaption(caption, style, spaced) {
  const texts = caption.words.map((w) => displayWord(w.text, style));
  return breakLines(texts, style.maxCharsPerLine, style.maxLines, spaced)
    .map((line) => line.map((i) => ({ i, text: texts[i] })));
}

// -------------------------------------------------------------- word states

// 'normal' | 'active' (highlight colour) | 'hidden' (reserved space, invisible)
export function wordStates(caption, t, effect) {
  const ws = caption.words;
  return ws.map((w, i) => {
    if (effect === 'none') return 'normal';
    const until = i + 1 < ws.length ? ws[i + 1].start : caption.end;
    if (t < w.start) return effect === 'reveal' && i > 0 ? 'hidden' : 'normal';
    if (effect === 'reveal') return 'normal';
    if (t < until) return 'active';
    return effect === 'progressive' ? 'active' : 'normal';
  });
}

function stateBoundaries(caption, effect) {
  const pts = [caption.start];
  if (effect !== 'none') {
    for (const w of caption.words) if (w.start > caption.start && w.start < caption.end) pts.push(w.start);
  }
  pts.push(caption.end);
  return [...new Set(pts)].sort((a, b) => a - b);
}

// --------------------------------------------------------------- animation

// Keyframes are [seconds since caption start, value]. Interpolation is linear
// in both the preview and libass (\t, \fade, \move are linear).
export const ANIMATIONS = {
  none: { label: 'None' },
  fade: { label: 'Fade', opacity: [[0, 0], [0.18, 1]], fadeOut: 0.15 },
  pop: { label: 'Pop', opacity: [[0, 0], [0.05, 1]], scale: [[0, 0.7], [0.1, 1.08], [0.18, 1]] },
  zoom: { label: 'Zoom in', opacity: [[0, 0], [0.12, 1]], scale: [[0, 1.25], [0.2, 1]] },
  slide: { label: 'Slide up', opacity: [[0, 0], [0.15, 1]], dy: [[0, 0.035], [0.22, 0]] },
};

export function valueAt(keys, t) {
  if (!keys) return null;
  if (t <= keys[0][0]) return keys[0][1];
  for (let k = 1; k < keys.length; k++) {
    const [t1, v1] = keys[k];
    if (t <= t1) {
      const [t0, v0] = keys[k - 1];
      return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

function opacityKeys(anim, dur) {
  if (!anim.opacity) return null;
  const inEnd = anim.opacity[anim.opacity.length - 1][0];
  if (!anim.fadeOut) return anim.opacity;
  const outStart = Math.max(inEnd, dur - anim.fadeOut);
  return [...anim.opacity, [outStart, 1], [Math.max(outStart, dur), 0]];
}

export function animState(style, caption, t) {
  const anim = ANIMATIONS[style.animation] || ANIMATIONS.none;
  const rel = t - caption.start, dur = caption.end - caption.start;
  return {
    opacity: valueAt(opacityKeys(anim, dur), rel) ?? 1,
    scale: valueAt(anim.scale, rel) ?? 1,
    dy: valueAt(anim.dy, rel) ?? 0,
  };
}

// ---------------------------------------------------------------- geometry

// Sizes in the style are expressed for a 1080px short side and scaled to the
// actual video, so a template looks the same on 16:9, 9:16 and 4K sources.
export function geometry(style, W, H) {
  const ref = Math.min(W, H) / 1080;
  let an, y;
  if (style.placement === 'top') { an = 8; y = H * style.offset / 100; }
  else if (style.placement === 'middle') { an = 5; y = H / 2 + H * style.offset / 100; }
  else { an = 2; y = H * (1 - style.offset / 100); }
  return {
    an, x: W / 2, y,
    fs: style.size * ref,
    outline: style.outline * ref,
    shadow: style.shadow * ref,
    blur: style.blur * ref,
    pad: style.boxPadding * ref,
    spacing: style.letterSpacing * ref,
  };
}

// ------------------------------------------------------------ font choice

export function fontCovers(font, text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x20 || (cp >= 0x200b && cp <= 0x200d)) continue;
    let lo = 0, hi = font.ranges.length - 1, ok = false;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, [a, b] = font.ranges[mid];
      if (cp < a) hi = mid - 1; else if (cp > b) lo = mid + 1; else { ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
}

// Returns the chosen font, or the closest font that can render every
// character in the captions (e.g. Poppins → Noto Sans Tamil for Tamil).
export function resolveFont(fonts, fontId, text) {
  const chosen = fonts.find((f) => f.id === fontId) || fonts[0];
  if (fontCovers(chosen, text)) return { font: chosen, substituted: false };
  const candidates = fonts.filter((f) => fontCovers(f, text));
  if (!candidates.length) return { font: chosen, substituted: false, missingGlyphs: true };
  candidates.sort((a, b) => Math.abs(a.weight - chosen.weight) - Math.abs(b.weight - chosen.weight)
    || (a.family.startsWith('Noto') ? -1 : 1));
  return { font: candidates[0], substituted: true };
}

// ------------------------------------------------------------------ export

const assColor = (hex) => {
  const h = hex.replace('#', '');
  return `${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};
const assAlpha = (opacity) => Math.round(255 * (1 - opacity)).toString(16).padStart(2, '0').toUpperCase();
const n2 = (v) => +v.toFixed(2);
const ms = (s) => Math.round(s * 1000);

function assTime(s) {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

const assText = (s) => s.replace(/\\/g, '⧵').replace(/\{/g, '(').replace(/\}/g, ')');

export function toASS(captions, style, font, W, H, { spaced = true, matrix = 'TV.709' } = {}) {
  const g = geometry(style, W, H);
  const anim = ANIMATIONS[style.animation] || ANIMATIONS.none;
  const primary = assColor(style.color), hl = assColor(style.highlightColor);
  const oa = style.box ? assAlpha(style.boxOpacity) : '00';
  const sa = assAlpha(style.shadowOpacity);
  const oc = assColor(style.box ? style.boxColor : style.outlineColor);
  const shadowColor = assColor(style.shadowColor);

  const styleLine = (name, { fillAlpha = '00', border, outline, shadow }) =>
    `Style: ${name},${font.assName},${n2(g.fs)},&H${fillAlpha}${primary},&H${fillAlpha}${primary},&H${oa}${oc},&H${sa}${shadowColor},0,0,0,0,100,100,${n2(g.spacing)},0,${border},${n2(outline)},${n2(shadow)},${g.an},0,0,0,1`;
  const styleLines = () => (style.box
    ? [styleLine('Box', { fillAlpha: 'FF', border: 3, outline: g.pad, shadow: g.shadow }),
      styleLine('Text', { border: 1, outline: 0, shadow: 0 })]
    : [styleLine('Text', { border: 1, outline: g.outline, shadow: g.shadow })]);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `YCbCr Matrix: ${matrix}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styleLines(),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const lines = [];
  for (const c of captions) {
    if (c.end <= c.start || !c.words.length) continue;
    const layout = layoutCaption(c, style, spaced);
    const dur = c.end - c.start;
    const bounds = stateBoundaries(c, style.wordEffect);
    for (let k = 0; k + 1 < bounds.length; k++) {
      const a = bounds[k], b = bounds[k + 1];
      if (assTime(a) === assTime(b)) continue;
      const o = a - c.start, d = b - a;
      const states = wordStates(c, a + 1e-4, style.wordEffect);
      const tags = [`\\an${g.an}`];

      if (anim.dy) {
        const [t0] = anim.dy[0], [t1] = anim.dy[anim.dy.length - 1];
        const y0 = g.y + H * valueAt(anim.dy, o);
        if (o < t1) tags.push(`\\move(${n2(g.x)},${n2(y0)},${n2(g.x)},${n2(g.y)},0,${ms(Math.max(t0, t1 - o))})`);
        else tags.push(`\\pos(${n2(g.x)},${n2(g.y)})`);
      } else {
        tags.push(`\\pos(${n2(g.x)},${n2(g.y)})`);
      }
      if (style.blur > 0) tags.push(`\\blur${n2(g.blur)}`);

      const op = opacityKeys(anim, dur);
      if (op) {
        const inEnd = anim.opacity[anim.opacity.length - 1][0];
        const a1 = Math.round(255 * (1 - valueAt(op, o)));
        const t2 = Math.max(0, ms(inEnd - o));
        let a3 = 0, t3 = ms(d), t4 = ms(d);
        if (anim.fadeOut) {
          const outStart = Math.max(inEnd, dur - anim.fadeOut);
          a3 = 255;
          t3 = Math.max(t2, ms(outStart - o));
          t4 = Math.max(t3, ms(dur - o));
        }
        tags.push(`\\fade(${a1},0,${a3},0,${t2},${t3},${t4})`);
      }
      if (anim.scale) {
        const s0 = valueAt(anim.scale, o) * 100;
        tags.push(`\\fscx${n2(s0)}\\fscy${n2(s0)}`);
        for (let i = 1; i < anim.scale.length; i++) {
          const [tk, vk] = anim.scale[i], tp = anim.scale[i - 1][0];
          if (tk <= o) continue;
          tags.push(`\\t(${ms(Math.max(tp, o) - o)},${ms(tk - o)},\\fscx${n2(vk * 100)}\\fscy${n2(vk * 100)})`);
        }
      }

      const text = (restore, colors) => layout.map((line) => line.map(({ i, text: t }) => {
        const s = assText(t);
        if (states[i] === 'active' && colors) return `{\\1c&H${hl}&}${s}{\\1c&H${primary}&}`;
        if (states[i] === 'hidden') return `{\\alpha&HFF&}${s}{${restore}}`;
        return s;
      }).join(spaced ? ' ' : '')).join('\\N');

      const head = `${assTime(a)},${assTime(b)}`;
      if (style.box) {
        // libass splits a box wherever the text style changes (e.g. a highlighted
        // word), leaving visible seams. Drawing the box on its own layer keeps it whole.
        lines.push(`Dialogue: 0,${head},Box,,0,0,0,,{${tags.join('')}}${text(`\\1a&HFF&\\3a&H${oa}&\\4a&H${sa}&`, false)}`);
        lines.push(`Dialogue: 1,${head},Text,,0,0,0,,{${tags.join('')}}${text('\\1a&H00&', true)}`);
      } else {
        lines.push(`Dialogue: 0,${head},Text,,0,0,0,,{${tags.join('')}}${text(`\\1a&H00&\\3a&H00&\\4a&H${sa}&`, true)}`);
      }
    }
  }
  return [...header, ...lines, ''].join('\n');
}

function stamp(s, sep) {
  const t = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, sec = Math.floor(t / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${sep}${String(t % 1000).padStart(3, '0')}`;
}

function plainLines(c, style, spaced) {
  return layoutCaption(c, style, spaced).map((l) => l.map((w) => w.text).join(spaced ? ' ' : '')).join('\n');
}

export function toSRT(captions, style, spaced = true) {
  return captions.filter((c) => c.end > c.start && c.words.length).map((c, i) =>
    `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${plainLines(c, style, spaced)}\n`).join('\n');
}

export function toVTT(captions, style, spaced = true) {
  return 'WEBVTT\n\n' + captions.filter((c) => c.end > c.start && c.words.length).map((c) =>
    `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${plainLines(c, style, spaced)}\n`).join('\n');
}

export function toTXT(captions, spaced = true) {
  return captions.map((c) => c.words.map((w) => w.text).join(spaced ? ' ' : '')).join(spaced ? ' ' : '')
    .replace(/([.!?।])\s+/g, '$1\n');
}

// Retimes words when an editor changes a caption's text.
export function retext(caption, text, spaced) {
  const tokens = spaced ? text.trim().split(/\s+/).filter(Boolean) : Array.from(text.replace(/\s+/g, ''));
  if (!tokens.length) return { ...caption, words: [] };
  const old = caption.words;
  if (tokens.length === old.length) {
    return { ...caption, words: old.map((w, i) => ({ ...w, text: tokens[i], conf: w.text === tokens[i] ? w.conf : 1 })) };
  }
  const start = old.length ? old[0].start : caption.start;
  const end = old.length ? old[old.length - 1].end : caption.end;
  const total = tokens.reduce((n, t) => n + t.length + 1, 0);
  let t = start;
  const words = tokens.map((tok) => {
    const d = (end - start) * (tok.length + 1) / total;
    const w = { text: tok, start: t, end: t + d, conf: 1 };
    t += d;
    return w;
  });
  return { ...caption, words };
}

// Moves/stretches a caption and its words to a new time range.
export function retime(caption, start, end) {
  const s0 = caption.start, d0 = caption.end - caption.start || 1, d1 = end - start;
  const map = (t) => start + (t - s0) * d1 / d0;
  return { ...caption, start, end, words: caption.words.map((w) => ({ ...w, start: map(w.start), end: map(w.end) })) };
}
