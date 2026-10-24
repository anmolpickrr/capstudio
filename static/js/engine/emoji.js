// Emojis on captions: flat-colour vector shapes (static/emoji/emoji.json, built by
// scripts/build_emoji.mjs from Twemoji) drawn by every renderer, so the preview,
// the browser and server exports and After Effects show the same picture. An emoji
// belongs to a word (word.emoji = '🔥', like word.emph for keywords), so it stays
// with that word when captions are regrouped, split or edited. A caption shows the
// first one among its words, popping in when that word is spoken.

export const EMOJI_BOX = 36;   // the shapes' coordinate box
let table = null, loading = null;

export function ensureEmoji() {
  if (table || typeof fetch === 'undefined') return Promise.resolve(table);
  loading ||= fetch('/emoji/emoji.json').then((r) => (r.ok ? r.json() : null)).then((d) => { table = d; return d; }).catch(() => null);
  return loading;
}

// For tests and Node: set the table directly.
export function setEmojiTable(t) { table = t; }

export const emojiTable = () => table;
export const emojiShape = (char) => (char && table ? table[char] || null : null);

export const emojiWord = (caption) => caption.words.findIndex((w) => w.emoji);

// The caption's emoji as it will be drawn (null when off, unknown or not loaded).
export function captionEmoji(caption, style) {
  if (!style.emoji || style.emoji === 'off') return null;
  const word = emojiWord(caption);
  const shape = word >= 0 ? emojiShape(caption.words[word].emoji) : null;
  return shape ? { char: caption.words[word].emoji, word, layers: shape.layers } : null;
}

// Path data "M1 2L3 4C...Z" → commands, for ASS and After Effects.
export function pathCommands(d) {
  const out = [];
  for (const m of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const v = m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [];
    out.push([m[1], ...v]);
  }
  return out;
}
