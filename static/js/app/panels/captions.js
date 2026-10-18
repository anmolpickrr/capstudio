// Captions: the language, and every caption's text and timing. Click a word to
// star it for keyword emphasis; underlined words are ones the speech engine
// wasn't sure about.
import { retext, retime, uid } from '../../engine/chunk.js';
import { icon } from '../icons.js';
import { generate } from '../session.js';
import { emit, setCaptions, set, state } from '../store.js';
import { fmtTime, h, more, parseTime, section, toast } from '../ui.js';

let root = null, list = null, seek = null;
export function setSeek(fn) { seek = fn; }

const langLabel = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code); } catch { return code; } };

function languageSection() {
  const tr = state.transcript;
  const langs = state.config.languages;
  const groups = {};
  for (const l of langs) (groups[l.group] ||= []).push(l);
  const sel = h('select', { class: 'select', 'aria-label': 'Spoken language' },
    Object.entries(groups).map(([g, ls]) => h('optgroup', { label: g },
      ls.map((l) => h('option', { value: l.id, disabled: l.unsupported ? true : null }, l.label)))));
  sel.value = state.language;
  sel.addEventListener('change', () => set({ language: sel.value }));
  const vocab = h('input', { class: 'input', placeholder: 'Brand or people names, comma-separated', value: state.vocabulary });
  vocab.addEventListener('input', () => set({ vocabulary: vocab.value }));
  const regen = h('button', { class: 'btn', type: 'button', disabled: !state.project?.job ? true : null, html: `<span>Generate again</span>`,
    onclick: async () => {
      if (state.captions.length && !window.confirm('Generate captions again? Your caption edits will be replaced (styles are kept).')) return;
      await generate(undefined, { language: sel.value, vocabulary: vocab.value });
    } });
  const summary = tr
    ? `${langLabel(tr.language)}${tr.requested === 'auto' ? ' · detected automatically' : ''}${tr.engine === 'local' && tr.fallback ? ' · backup engine' : ''}`
    : 'Not generated yet';
  return section('Language',
    h('div', { class: 'row-label' }, h('span', {}, summary)),
    more('Change language or improve accuracy',
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Spoken language'), sel),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Names & terms'), vocab),
      regen));
}

function toolsSection() {
  const find = h('input', { class: 'input', placeholder: 'Find' });
  const repl = h('input', { class: 'input', placeholder: 'Replace with' });
  const doReplace = () => {
    const f = find.value;
    if (!f) return;
    const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let count = 0;
    const spaced = state.transcript?.spaced ?? true;
    const next = state.captions.map((c) => {
      const text = c.words.map((w) => w.text).join(spaced ? ' ' : '');
      const n = (text.match(re) || []).length;
      if (!n) return c;
      count += n;
      return retext(c, text.replace(re, repl.value), spaced);
    }).filter((c) => c.words.length);
    if (!count) return toast('No matches found.');
    setCaptions(next, `replace-${Date.now()}`);
    toast(`Replaced ${count} match${count > 1 ? 'es' : ''}.`, 'ok');
  };
  const shift = (d) => {
    setCaptions(state.captions.map((c) => retime(c, Math.max(0, c.start + d), Math.max(0.05, c.end + d))), 'shift');
    toast(`All captions moved ${d > 0 ? 'later' : 'earlier'} by ${Math.abs(Math.round(d * 1000))} ms`, 'ok', 1400);
  };
  return more('Find & replace, sync',
    h('div', { class: 'grid2' }, find, repl),
    h('button', { class: 'btn', type: 'button', onclick: doReplace }, 'Replace all'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Move all captions earlier or later'),
      h('div', { class: 'seg' },
        h('button', { type: 'button', onclick: () => shift(-0.1) }, '−100 ms'),
        h('button', { type: 'button', onclick: () => shift(-0.02) }, '−20 ms'),
        h('button', { type: 'button', onclick: () => shift(0.02) }, '+20 ms'),
        h('button', { type: 'button', onclick: () => shift(0.1) }, '+100 ms'))));
}

function captionCard(c, i) {
  const spaced = state.transcript?.spaced ?? true;
  const start = h('input', { class: 'time-input', value: fmtTime(c.start), 'aria-label': 'Start time' });
  const end = h('input', { class: 'time-input', value: fmtTime(c.end), 'aria-label': 'End time' });
  const onTime = () => {
    const s = parseTime(start.value), e = parseTime(end.value);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) {
      toast('Use times like 0:12.40, with the end after the start.', 'error');
      start.value = fmtTime(c.start); end.value = fmtTime(c.end);
      return;
    }
    setCaptions(state.captions.map((x) => (x.id === c.id ? retime(x, s, e) : x)));
  };
  start.addEventListener('change', onTime);
  end.addEventListener('change', onTime);
  const text = h('textarea', { class: 'cap-text', rows: 1, 'aria-label': `Caption ${i + 1} text` });
  text.value = c.words.map((w) => w.text).join(spaced ? ' ' : '');
  const grow = () => { text.style.height = 'auto'; text.style.height = `${text.scrollHeight}px`; };
  text.addEventListener('input', grow);
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); text.blur(); } });
  text.addEventListener('change', () => {
    const next = retext(c, text.value, spaced);
    setCaptions(next.words.length ? state.captions.map((x) => (x.id === c.id ? next : x)) : state.captions.filter((x) => x.id !== c.id));
  });
  requestAnimationFrame(grow);

  const emphOn = state.style.emphasis !== 'none';
  const words = h('div', { class: 'words' }, c.words.map((w, wi) => h('button', {
    type: 'button', class: `word${w.emph ? ' emph' : ''}${w.conf != null && w.conf < 0.5 ? ' unsure' : ''}`,
    title: `${fmtTime(w.start)}${w.conf != null && w.conf < 0.5 ? ' · the speech engine was unsure about this word' : ''}${emphOn ? ' · click to star for emphasis' : ''}`,
    html: `${w.emph ? icon('star') : ''}<span></span>`,
    onclick: () => {
      seek?.(w.start + 0.01);
      if (!emphOn) return;
      setCaptions(state.captions.map((x) => (x.id === c.id
        ? { ...x, words: x.words.map((y, k) => (k === wi ? { ...y, emph: !y.emph } : y)) } : x)));
    },
  })));
  words.querySelectorAll('.word span').forEach((s, k) => { s.textContent = c.words[k].text; });

  const act = (ico, tip, fn) => h('button', { class: 'btn ghost sm icon-only', type: 'button', 'data-tip': tip, html: icon(ico), onclick: fn });
  const card = h('div', { class: 'cap', 'data-id': c.id },
    h('div', { class: 'cap-top' }, start, h('span', { class: 'arrow' }, '→'), end, h('span', { class: 'grow' }),
      act('play', 'Play', () => seek?.(c.start + 0.01, true)),
      act('split', 'Split in two', () => split(c)),
      act('merge', 'Merge with next', () => merge(c)),
      act('trash', 'Delete', () => setCaptions(state.captions.filter((x) => x.id !== c.id)))),
    text, words);
  card.addEventListener('focusin', () => { if (state.selected !== c.id) { state.selected = c.id; emit('selection'); } });
  card.addEventListener('click', (e) => {
    if (e.target.closest('button,input,textarea')) return;
    state.selected = c.id; emit('selection'); seek?.(c.start + 0.01);
  });
  return card;
}

function split(c) {
  if (c.words.length < 2) return toast('A single word can’t be split.');
  const mid = Math.ceil(c.words.length / 2);
  const left = c.words.slice(0, mid), right = c.words.slice(mid);
  setCaptions(state.captions.flatMap((x) => (x.id !== c.id ? [x] : [
    { ...c, end: right[0].start, words: left }, { id: uid(), start: right[0].start, end: c.end, words: right, scale: c.scale }])));
}

function merge(c) {
  const i = state.captions.findIndex((x) => x.id === c.id);
  const n = state.captions[i + 1];
  if (!n) return toast('This is the last caption.');
  setCaptions(state.captions.flatMap((x, k) => (k === i ? [{ ...c, end: n.end, words: [...c.words, ...n.words] }] : k === i + 1 ? [] : [x])));
}

function renderList() {
  if (!list) return;
  if (!state.captions.length) {
    list.replaceChildren(h('p', { class: 'empty-results' },
      state.phase === 'editing' ? 'No captions yet. Pick the language above and generate captions.' : 'Captions appear here once they’re generated.'));
    return;
  }
  const unsure = state.captions.some((c) => c.words.some((w) => w.conf != null && w.conf < 0.5));
  list.replaceChildren(
    unsure ? h('p', { class: 'hint' }, 'A wavy underline means the speech engine wasn’t sure about that word, so give it a quick look.') : '',
    ...state.captions.map(captionCard));
  markActive();
}

function markActive(scroll = false) {
  if (!list) return;
  list.querySelectorAll('.cap').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === state.activeCaption);
    el.classList.toggle('selected', el.dataset.id === state.selected);
  });
  const target = list.querySelector('.cap.selected') || list.querySelector('.cap.active');
  if (target && (scroll || !list.contains(document.activeElement))) target.scrollIntoView({ block: 'nearest' });
}

export const captionsPanel = {
  mount(container) {
    list = h('div', { class: 'cap-list' });
    root = h('div', { style: { display: 'contents' } },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Captions'), h('span', { class: 'hint', id: 'cap-count' })),
      h('div', { class: 'panel-body', id: 'cap-body' }, languageSection(), toolsSection(), list));
    container.replaceChildren(root);
    renderList();
    this.update('count');
  },
  unmount() { root = null; list = null; },
  update(what) {
    if (!root) return;
    const count = root.querySelector('#cap-count');
    if (count) count.textContent = state.captions.length ? `${state.captions.length} captions` : '';
    if (what === 'captions' || what === 'history' || what === 'style') {
      if (!list.contains(document.activeElement) || document.activeElement.tagName === 'BUTTON') renderList();
    }
    if (what === 'transcript' || what === 'project') this.mount(root.parentNode);
    if (what === 'active') markActive();
    if (what === 'selection') markActive(true);
  },
};
