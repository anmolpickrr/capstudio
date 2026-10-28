// Turning transcribed words into captions, and keeping word timings sensible
// while editors change text and times.

// how long before its first word a caption may appear
export const LEAD_IN = 0.12;

export const SENTENCE_END = /[.!?।॥。？！]["'”’)]*$/;

let nextId = 1;
export const uid = () => `c${Date.now().toString(36)}${(nextId++).toString(36)}`;

const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

// The text shown for a word after case and punctuation settings.
export function displayWord(text, style) {
  let s = text;
  if (style.punctuation === 'strip') {
    const stripped = s.replace(EDGE_PUNCT, '');
    if (stripped) s = stripped;
  }
  if (style.textCase === 'upper') s = s.toLocaleUpperCase();
  else if (style.textCase === 'lower') s = s.toLocaleLowerCase();
  else if (style.textCase === 'title') s = s.charAt(0).toLocaleUpperCase() + s.slice(1);
  return s;
}

// Groups words into captions. `fits(words)` reports whether a group still fits
// the caption box at the current style (measured), so length limits follow the
// real typography instead of a character count.
export function chunkWords(words, style, fits = () => true) {
  const groups = [];
  let cur = [];
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1];
      if (cur.length >= style.maxWords
        || !fits([...cur, w])
        || w.start - prev.end > 0.6                      // speaker pause
        || w.end - cur[0].start > 6                      // keep captions readable
        || (SENTENCE_END.test(prev.text) && style.maxWords > 2)) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  // each caption comes on a moment before its first word (as subtitles do), when the
  // previous caption's words are over by then, so it's read as it's heard
  const starts = groups.map((ws, i) => {
    const prev = groups[i - 1];
    return Math.min(ws[0].start, Math.max(0, prev ? prev[prev.length - 1].end : 0, ws[0].start - LEAD_IN));
  });
  return groups.map((ws, i) => {
    const last = ws[ws.length - 1].end;
    let end = last + 0.3; // linger so captions don't flash off
    if (i + 1 < groups.length) end = Math.min(end, starts[i + 1]);
    return { id: uid(), start: starts[i], end: Math.max(end, last), words: ws.map((w) => ({ ...w })) };
  });
}

export const flattenWords = (captions) => captions.flatMap((c) => c.words);

// New text for a caption: keep timings for unchanged word counts, otherwise
// spread the caption's time over the new words by length.
export function retext(caption, text, spaced = true) {
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
  return {
    ...caption,
    words: tokens.map((tok) => {
      const d = (end - start) * (tok.length + 1) / total;
      // a keyword mark and an emoji stay on their word
      const keep = old.find((w) => w.text === tok && w.emph), pic = old.find((w) => w.text === tok && w.emoji);
      const w = { text: tok, start: t, end: t + d, conf: 1, ...(keep ? { emph: true } : {}), ...(pic ? { emoji: pic.emoji } : {}) };
      t += d;
      return w;
    }),
  };
}

// Moves/stretches a caption and its words to a new time range.
export function retime(caption, start, end) {
  const s0 = caption.start, d0 = caption.end - caption.start || 1, d1 = end - start;
  const map = (t) => start + (t - s0) * d1 / d0;
  return { ...caption, start, end, words: caption.words.map((w) => ({ ...w, start: map(w.start), end: map(w.end) })) };
}

// Changes one word boundary (the start of word i) and keeps neighbours ordered.
export function moveWordStart(caption, i, t) {
  const ws = caption.words.map((w) => ({ ...w }));
  const lo = i > 0 ? ws[i - 1].start + 0.05 : caption.start;
  const hi = ws[i].end - 0.05;
  t = Math.min(Math.max(t, lo), hi);
  ws[i].start = t;
  if (i > 0) ws[i - 1].end = Math.min(ws[i - 1].end, t);
  const c = { ...caption, words: ws };
  if (i === 0) c.start = Math.min(c.start, t);
  return c;
}
