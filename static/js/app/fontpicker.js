// Font picker: search, categories, live previews in each typeface, and only
// fonts that can actually render the captions' language(s).
import { displayWord } from '../engine/chunk.js';
import { CATEGORY_LABELS, cssFamily, ensureFonts, families, fontById, scriptsIn, SCRIPT_LABELS } from '../engine/fonts.js';
import { state } from './store.js';
import { h } from './ui.js';

let open = null;

export function captionTexts() {
  return state.captions.flatMap((c) => c.words.map((w) => displayWord(w.text, state.style)));
}

export function fontButton({ value, onPick, allowSame = false, label = 'Font' }) {
  const btn = h('button', { class: 'font-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-label': label });
  const paint = () => {
    const v = value();
    if (!v) { btn.replaceChildren(h('span', { class: 'sample' }, 'Same as captions'), h('small', {}, '')); return; }
    const f = fontById(v);
    ensureFonts([f]);
    btn.replaceChildren(h('span', { class: 'sample', style: { fontFamily: cssFamily(f) } }, f.family), h('small', {}, f.label));
  };
  btn.addEventListener('click', () => openPicker(btn, { current: value(), onPick: (id) => { onPick(id); paint(); }, allowSame }));
  paint();
  btn.paint = paint;
  return btn;
}

function close() {
  if (!open) return;
  open.el.remove();
  document.removeEventListener('pointerdown', open.outside, true);
  document.removeEventListener('keydown', open.keys, true);
  open = null;
}

function openPicker(anchor, { current, onPick, allowSame }) {
  close();
  const scripts = scriptsIn(captionTexts());
  const nonLatin = scripts.filter((s) => s !== 'latin');
  const currentFont = current ? fontById(current) : null;
  let cat = 'all', q = '';
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search fonts', 'aria-label': 'Search fonts' });
  const list = h('div', { class: 'popover-list', role: 'listbox' });
  const chips = h('div', { class: 'chips', style: { margin: 0, padding: 0 } },
    [['all', 'All'], ...Object.entries(CATEGORY_LABELS)].map(([id, name]) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(id === cat),
      onclick: (e) => { cat = id; chips.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); fill(); },
    }, name)));
  const note = nonLatin.length
    ? h('p', { class: 'hint' }, `Showing fonts that support ${nonLatin.map((s) => SCRIPT_LABELS[s]).join(', ')}${scripts.includes('latin') ? ' and English' : ''}.`)
    : null;
  const el = h('div', { class: 'popover', role: 'dialog', 'aria-label': 'Choose a font' },
    h('div', { class: 'popover-head' }, search, chips, note), list);
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  el.style.left = `${Math.min(r.left, innerWidth - 350)}px`;
  el.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - el.offsetHeight - 8))}px`;

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { ensureFonts([fontById(e.target.dataset.font)]); io.unobserve(e.target); }
  }, { root: list });

  function pickFamily(fam) {
    const w = currentFont?.weight || 700;
    const best = [...fam.fonts].sort((a, b) => (a.italic - b.italic) || Math.abs(a.weight - w) - Math.abs(b.weight - w))[0];
    onPick(best.id);
    close();
  }

  function fill() {
    const query = q.trim().toLowerCase();
    const fams = families().filter((f) => (cat === 'all' || f.category === cat)
      && (!query || f.family.toLowerCase().includes(query))
      && f.fonts.some((x) => scripts.every((s) => x.scripts.includes(s))));
    const items = [];
    if (allowSame && !query) {
      items.push(h('button', { class: 'font-item', type: 'button', role: 'option', 'aria-selected': String(!current), onclick: () => { onPick(null); close(); } },
        h('span', { class: 'sample' }, 'Same as captions'), h('small', {}, '')));
    }
    let lastCat = null;
    for (const fam of fams) {
      if (cat === 'all' && fam.category !== lastCat) { lastCat = fam.category; items.push(h('div', { class: 'font-cat' }, CATEGORY_LABELS[fam.category] || fam.category)); }
      const sampleFont = fam.fonts.find((x) => !x.italic) || fam.fonts[0];
      const item = h('button', { class: 'font-item', type: 'button', role: 'option', 'data-font': sampleFont.id,
        'aria-selected': String(currentFont?.family === fam.family), onclick: () => pickFamily(fam) },
      h('span', { class: 'sample', style: { fontFamily: cssFamily(sampleFont) } }, fam.family),
      h('small', {}, `${fam.fonts.length} style${fam.fonts.length > 1 ? 's' : ''}`));
      io.observe(item);
      items.push(item);
    }
    if (!items.length) items.push(h('p', { class: 'empty-results' }, 'No fonts match.'));
    list.replaceChildren(...items);
  }
  search.addEventListener('input', () => { q = search.value; fill(); });
  fill();
  search.focus();
  const outside = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const keys = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keys, true);
  open = { el, outside, keys };
}
