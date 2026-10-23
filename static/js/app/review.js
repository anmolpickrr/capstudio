// Checking captions: words the speech engine was unsure about, and near misses
// of the team glossary ("faster" → "Fastrr?"). Both are only suggestions; a word
// marked as checked is left alone.
import { state } from './store.js';

export const isUnsure = (w) => w.conf != null && w.conf < 0.5 && !w.checked;

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const core = (t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

// Fuzzy matching only for real names (5+ letters): short acronyms like COD would
// otherwise catch everyday words ("code").
const terms = () => (state.config?.glossary || []).filter((g) => g.length >= 5 && !/\s/.test(g));

// A glossary term this word (or this word and the next, written apart) probably is.
// Returns { term, join } or null.
export function glossaryHint(words, i) {
  const w = words[i];
  if (w.checked) return null;
  const c = core(w.text).toLowerCase();
  if (c.length < 3 || !/^[a-z]+$/.test(c)) return null;
  for (const t of terms()) {
    const lt = t.toLowerCase();
    if (c === lt) return null;
    if (distance(c, lt) <= (lt.length >= 7 ? 2 : 1)) return { term: t, join: false };
    const n = words[i + 1];
    if (n && !n.checked) {
      const both = c + core(n.text).toLowerCase();
      if (both === lt || (lt.length >= 7 && distance(both, lt) <= 1)) return { term: t, join: true };
    }
  }
  return null;
}

// Apply a hint to a caption: the word takes the term (keeping its punctuation);
// a joined pair becomes one word spanning both.
export function applyHint(caption, i, hint) {
  const words = caption.words.slice();
  const w = words[i];
  const m = w.text.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
  if (hint.join) {
    const n = words[i + 1];
    const tail = n.text.match(/([^\p{L}\p{N}]*)$/u)[1];
    words.splice(i, 2, { ...w, text: `${m[1]}${hint.term}${tail}`, end: n.end, conf: 1, checked: true });
  } else {
    words[i] = { ...w, text: `${m[1]}${hint.term}${m[3]}`, conf: 1, checked: true };
  }
  return { ...caption, words };
}

// Everything left to check, in order: [{ cid, wi, kind: 'unsure' | 'name', hint }]
export function toCheck(captions = state.captions) {
  const out = [];
  for (const c of captions) {
    c.words.forEach((w, wi) => {
      const hint = glossaryHint(c.words, wi);
      if (hint) out.push({ cid: c.id, wi, kind: 'name', hint });
      else if (isUnsure(w)) out.push({ cid: c.id, wi, kind: 'unsure' });
    });
  }
  return out;
}

// ---------------------------------------------------------------- script

const DEVANAGARI = /[ऀ-ॿ]/;

// Show the script switch for Hindi and Hinglish videos.
export function isHindiProject() {
  const tr = state.transcript;
  if (tr && (tr.language === 'hi' || String(tr.requested).startsWith('hinglish'))) return true;
  return state.captions.some((c) => c.words.some((w) => DEVANAGARI.test(w.text)));
}

// New captions from the server's answer. Transliterations keep each word's
// timing; a translation is spread over the caption's span by word length.
export function rebuild(captions, mode, items) {
  const byId = new Map(items.map((it) => [it.id, it]));
  return captions.map((c) => {
    const it = byId.get(c.id);
    if (!it) return c;
    if (mode !== 'english') {
      return { ...c, words: c.words.map((w, k) => (it.words[k] && it.words[k] !== w.text ? { ...w, text: it.words[k], conf: 1 } : w)) };
    }
    const toks = it.text.split(/\s+/).filter(Boolean);
    if (!toks.length) return c;
    const t0 = c.words[0].start, t1 = c.words[c.words.length - 1].end;
    const weights = toks.map((t) => t.length + 2), total = weights.reduce((a, b) => a + b, 0);
    let t = t0;
    const words = toks.map((text, k) => {
      const d = ((t1 - t0) * weights[k]) / total;
      const w = { text, start: +t.toFixed(3), end: +(t + d * 0.92).toFixed(3), conf: 1 };
      t += d;
      return w;
    });
    return { ...c, words };
  });
}
