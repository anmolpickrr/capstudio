// Emojis and keywords: the "Add emojis & keywords" action (an AI picks each
// caption's keyword and, now and then, an emoji; see server/enhance.py), and the
// emoji picker for a single caption. Emojis are drawn from the same shapes the
// captions use (engine/emoji.js), so what's picked here is what's exported.
import { emojiShape, emojiTable, emojiWord, ensureEmoji } from '../engine/emoji.js';
import { api } from './api.js';
import { setCaptions, setStyle, state } from './store.js';
import { h } from './ui.js';

// A small picture of an emoji (an <svg> element).
export function emojiIcon(char, size = 22) {
  const shape = emojiShape(char);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('emoji-icon');
  for (const [fill, d, a] of shape?.layers || []) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); p.setAttribute('fill', fill);
    if (a !== undefined) p.setAttribute('fill-opacity', a);
    svg.append(p);
  }
  return svg;
}

// Show emojis and starred keywords, if the style has them off.
function styleFor({ emoji, keywords }) {
  const s = state.style, patch = {};
  if (emoji && (!s.emoji || s.emoji === 'off')) Object.assign(patch, { emoji: 'above', emojiSize: s.emojiSize || 1.6 });
  if (keywords && s.emphasis !== 'marked' && s.emphasis !== 'auto') {
    patch.emphasis = 'marked';
    if (!s.emphColor && !s.emphBg && (s.emphScale || 1) === 1) Object.assign(patch, { emphColor: '#FFE14D', emphScale: 1.2 });
  } else if (keywords && s.emphasis === 'auto') patch.emphasis = 'marked';
  return patch;
}

// Ask for keywords and emojis for every caption and apply them (one undo step).
export async function enhanceCaptions({ emoji = true, keywords = true } = {}) {
  if (!state.captions.length || (!emoji && !keywords)) return null;
  await ensureEmoji();
  const items = state.captions.map((c) => ({ id: c.id, words: c.words.map((w) => w.text) }));
  const res = await api('/api/enhance', { method: 'POST', body: { items, emoji, keywords } });
  const got = new Map(res.items.map((r) => [r.id, r]));
  let emojis = 0, starred = 0;
  const next = state.captions.map((c) => {
    const r = got.get(c.id);
    if (!r) return c;
    const words = c.words.map((w, i) => {
      const x = { ...w };
      if (keywords) { if (i === r.keyword) x.emph = true; else delete x.emph; }
      if (emoji) { if (r.emoji && i === r.emojiWord && emojiShape(r.emoji)) x.emoji = r.emoji; else delete x.emoji; }
      return x;
    });
    emojis += words.some((w) => w.emoji) ? 1 : 0;
    starred += words.some((w) => w.emph) ? 1 : 0;
    return { ...c, words };
  });
  const key = `enhance-${Date.now()}`;
  setCaptions(next, key);
  const patch = styleFor({ emoji: emoji && emojis > 0, keywords: keywords && starred > 0 });
  if (Object.keys(patch).length) setStyle(patch, key);
  return { emojis, keywords: starred, source: res.source };
}

export function removeEmojis() {
  setCaptions(state.captions.map((c) => (c.words.some((w) => w.emoji)
    ? { ...c, words: c.words.map(({ emoji, ...w }) => w) } : c)), `emoji-clear-${Date.now()}`);
}

// Set (or with null, remove) a caption's emoji. It goes on the word it had, else the
// starred keyword, else the first word.
export function setCaptionEmoji(cid, char) {
  setCaptions(state.captions.map((c) => {
    if (c.id !== cid) return c;
    let at = emojiWord(c);
    if (at < 0) at = Math.max(0, c.words.findIndex((w) => w.emph));
    return { ...c, words: c.words.map(({ emoji, ...w }, i) => (char && i === at ? { ...w, emoji: char } : w)) };
  }), `emoji-${cid}`);
  if (char && (!state.style.emoji || state.style.emoji === 'off')) setStyle({ emoji: 'above', emojiSize: state.style.emojiSize || 1.6 }, `emoji-${cid}`);
}

// The emoji picker, opened next to a button.
let open = null;
export async function openEmojiPicker(anchor, caption) {
  closeEmojiPicker();
  await ensureEmoji();
  const table = emojiTable() || {};
  const current = caption.words.find((w) => w.emoji)?.emoji || null;
  const pick = (char) => { closeEmojiPicker(); setCaptionEmoji(caption.id, char); };
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search: money, delivery, fire…', 'aria-label': 'Search emojis' });
  const grid = h('div', { class: 'emoji-grid', role: 'listbox', 'aria-label': 'Emojis' });
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    grid.replaceChildren(...Object.entries(table)
      .filter(([, e]) => !q || e.name.includes(q) || e.keywords.some((k) => k.startsWith(q)))
      .map(([char, e]) => {
        const b = h('button', { type: 'button', class: `emoji-opt${char === current ? ' on' : ''}`, role: 'option', title: e.name,
          'aria-label': e.name, 'aria-selected': String(char === current), onclick: () => pick(char) });
        b.append(emojiIcon(char, 26));
        return b;
      }));
  };
  search.addEventListener('input', paint);
  paint();
  const pop = h('div', { class: 'emoji-pop', role: 'dialog', 'aria-label': 'Choose an emoji' },
    h('div', { class: 'emoji-pop-head' }, search,
      current ? h('button', { class: 'btn sm', type: 'button', onclick: () => pick(null) }, 'Remove') : null),
    grid,
    h('p', { class: 'hint' }, 'Emoji graphics: Twemoji, CC-BY 4.0.'));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = Math.min(320, window.innerWidth - 16);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  const below = r.bottom + 6, height = Math.min(360, window.innerHeight - 16);
  pop.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 6) : below}px`;
  pop.style.maxHeight = `${height}px`;
  const onDown = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeEmojiPicker(); };
  const onKey = (e) => { if (e.key === 'Escape') closeEmojiPicker(); };
  setTimeout(() => document.addEventListener('pointerdown', onDown), 0);
  document.addEventListener('keydown', onKey);
  open = { pop, off: () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); } };
  search.focus();
}

export function closeEmojiPicker() {
  if (!open) return;
  open.off();
  open.pop.remove();
  open = null;
}

export function enhanceMessage(r) {
  if (!r) return '';
  const parts = [];
  if (r.emojis) parts.push(`${r.emojis} emoji${r.emojis === 1 ? '' : 's'}`);
  if (r.keywords) parts.push(`${r.keywords} keyword${r.keywords === 1 ? '' : 's'}`);
  return parts.length ? `Added ${parts.join(' and ')}. Ctrl+Z to undo.` : 'Nothing to add: no clear keywords or emojis found.';
}

