// Captions: the language and script, emojis and keywords, a check of doubtful
// words, and every caption's text and timing. Click a word to star it for keyword emphasis;
// underlined words are ones the speech engine wasn't sure about, and dotted
// ones look like a misspelt team glossary name.
import { retext, retime, uid } from '../../engine/chunk.js';
import { api } from '../api.js';
import { emojiIcon, enhanceCaptions, enhanceMessage, openEmojiPicker, removeEmojis } from '../emojis.js';
import { icon } from '../icons.js';
import { applyHint, glossaryHint, isHindiProject, isUnsure, rebuild, toCheck } from '../review.js';
import { generate } from '../session.js';
import { replay } from './motion.js';
import { emit, setCaptions, set, state } from '../store.js';
import { fmtTime, h, more, parseTime, section, toast } from '../ui.js';

let root = null, list = null, seek = null;
let cursor = 0; // position in the list of words to check
let reviewing = null; // the word being checked
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
  const regen = h('button', { class: 'btn', type: 'button', disabled: !(state.project?.job || state.project?.file) ? true : null, html: `<span>Generate again</span>`,
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
      state.config.glossary?.length ? h('p', { class: 'hint' }, `Always included from the team glossary: ${state.config.glossary.join(', ')}.`) : null,
      regen));
}

// ---------------------------------------------------------------- script

const SCRIPTS = [
  ['roman', 'Roman', 'aaj ka offer'],
  ['devanagari', 'हिंदी', 'आज का offer'],
  ['english', 'English', 'Translate to English'],
];

function scriptSection() {
  if (!isHindiProject()) return null;
  const note = h('p', { class: 'hint' }, 'Rewrites every caption. Ctrl+Z puts it back.');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Caption script' }, SCRIPTS.map(([mode, label, tip]) => {
    const needsService = mode !== 'roman' && !state.config.scriptConvert;
    return h('button', { type: 'button', 'data-mode': mode, 'data-tip': needsService ? 'Needs the Groq key' : tip,
      disabled: needsService ? true : null, onclick: () => convertScript(mode, seg, note) }, label);
  }));
  return section('Script', seg, note);
}

async function convertScript(mode, seg, note) {
  if (!state.captions.length) return;
  const buttons = [...seg.querySelectorAll('button')];
  buttons.forEach((b) => { b.disabled = true; });
  const was = note.textContent;
  note.textContent = mode === 'english' ? 'Translating…' : 'Rewriting…';
  try {
    const items = state.captions.map((c) => ({ id: c.id, words: c.words.map((w) => w.text) }));
    const res = await api('/api/convert', { method: 'POST', body: { mode, items } });
    setCaptions(rebuild(state.captions, mode, res.items), `script-${Date.now()}`);
    toast(mode === 'english' ? 'Captions translated to English. Ctrl+Z to undo.' : 'Captions rewritten. Ctrl+Z to undo.', 'ok', 3500);
  } catch (e) {
    toast(`Couldn’t change the script: ${e.message}`, 'error', 7000);
  } finally {
    note.textContent = was;
    buttons.forEach((b) => { b.disabled = b.dataset.mode !== 'roman' && !state.config.scriptConvert; });
  }
}

// ---------------------------------------------------------------- emojis and keywords

function enhanceSection() {
  const box = (label, checked) => h('label', { class: 'checkline' }, h('input', { type: 'checkbox', checked: checked ? true : null }), h('span', {}, label));
  const emo = box('Emojis', true), kw = box('Keywords', true);
  const note = h('p', { class: 'hint' }, state.config.scriptConvert
    ? 'AI stars the word that matters in each caption and adds an emoji where it fits. Ctrl+Z puts it back.'
    : 'Stars the word that matters in each caption and adds an emoji where a word matches. Ctrl+Z puts it back.');
  const go = h('button', { class: 'btn primary enhance-go', type: 'button', html: `${icon('sparkle')}<span>Add emojis & keywords</span>`, onclick: async () => {
    const emoji = emo.querySelector('input').checked, keywords = kw.querySelector('input').checked;
    if (!emoji && !keywords) return toast('Pick emojis, keywords or both.');
    go.disabled = true;
    const label = go.querySelector('span').textContent;
    go.querySelector('span').textContent = 'Picking…';
    try {
      toast(enhanceMessage(await enhanceCaptions({ emoji, keywords })), 'ok', 4500);
    } catch (e) {
      toast(`Couldn’t add emojis and keywords: ${e.message}`, 'error', 7000);
    } finally {
      go.disabled = false;
      go.querySelector('span').textContent = label;
    }
  } });
  return section('Emojis & keywords',
    h('div', { class: 'enhance-row' }, emo, kw), go, note,
    h('button', { class: 'linkish', type: 'button', onclick: () => {
      if (!state.captions.some((c) => c.words.some((w) => w.emoji))) return toast('There are no emojis to remove.');
      removeEmojis();
    } }, 'Remove all emojis'));
}

// ---------------------------------------------------------------- check

function setWord(cid, wi, patch) {
  setCaptions(state.captions.map((c) => (c.id === cid ? { ...c, words: c.words.map((w, k) => (k === wi ? { ...w, ...patch } : w)) } : c)), `check-${cid}-${wi}`);
}

function show(item) {
  const c = state.captions.find((x) => x.id === item.cid);
  if (!c) return;
  state.selected = c.id;
  emit('selection');
  seek?.(c.start + 0.01);
  replay();
  requestAnimationFrame(() => list?.querySelector(`.cap[data-id="${c.id}"] .word[data-i="${item.wi}"]`)?.scrollIntoView({ block: 'nearest' }));
}

function reviewBar(items) {
  if (!items.length) return null;
  cursor = Math.min(cursor, items.length - 1);
  const it = items[cursor];
  const c = state.captions.find((x) => x.id === it.cid);
  const word = c?.words[it.wi]?.text || '';
  const q = it.kind === 'name'
    ? h('span', {}, 'Did you mean ', h('b', {}, it.hint.term), ' for “', h('b', {}, it.hint.join ? `${word} ${c.words[it.wi + 1].text}` : word), '”?')
    : h('span', {}, 'Is “', h('b', {}, word), '” right? The speech engine wasn’t sure.');
  const btn = (label, fn, cls = 'btn sm') => h('button', { class: cls, type: 'button', onclick: fn }, label);
  const actions = it.kind === 'name'
    ? [btn(`Use ${it.hint.term}`, () => setCaptions(state.captions.map((x) => (x.id === it.cid ? applyHint(x, it.wi, it.hint) : x)), `hint-${it.cid}`), 'btn sm primary'),
      btn('Keep', () => setWord(it.cid, it.wi, { checked: true }))]
    : [btn('Looks right', () => setWord(it.cid, it.wi, { checked: true }), 'btn sm primary'),
      btn('Edit', () => { const box = list?.querySelector(`.cap[data-id="${it.cid}"] textarea`); box?.focus(); box?.select(); })];
  return h('div', { class: 'review' },
    h('div', { class: 'review-head' },
      h('b', {}, `${items.length} ${items.length === 1 ? 'word' : 'words'} to check`),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { show(items[cursor]); } }, 'Play'),
      h('button', { class: 'btn ghost sm', type: 'button', disabled: items.length < 2 ? true : null,
        onclick: () => { cursor = (cursor + 1) % items.length; renderList(); show(items[cursor]); } }, 'Next')),
    h('p', { class: 'review-q' }, q),
    h('div', { class: 'review-actions' }, actions,
      h('span', { class: 'grow' }),
      btn('All good', () => setCaptions(state.captions.map((x) => ({ ...x, words: x.words.map((w) => (isUnsure(w) || glossaryHint(x.words, x.words.indexOf(w)) ? { ...w, checked: true } : w)) })), 'check-all'), 'btn ghost sm')));
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
    type: 'button', 'data-i': wi,
    class: `word${w.emph ? ' emph' : ''}${w.emoji ? ' has-emoji' : ''}${isUnsure(w) ? ' unsure' : ''}${glossaryHint(c.words, wi) ? ' name-hint' : ''}${reviewing?.cid === c.id && reviewing.wi === wi ? ' reviewing' : ''}`,
    title: `${fmtTime(w.start)}${isUnsure(w) ? ' · the speech engine was unsure about this word' : ''}${glossaryHint(c.words, wi) ? ` · did you mean ${glossaryHint(c.words, wi).term}?` : ''}${emphOn ? ' · click to star for emphasis' : ''}`,
    html: `${w.emph ? icon('star') : ''}<span></span>`,
    onclick: () => {
      seek?.(w.start + 0.01);
      if (!emphOn) return;
      setCaptions(state.captions.map((x) => (x.id === c.id
        ? { ...x, words: x.words.map((y, k) => (k === wi ? { ...y, emph: !y.emph } : y)) } : x)));
    },
  })));
  words.querySelectorAll('.word span').forEach((s, k) => {
    s.textContent = c.words[k].text;
    if (c.words[k].emoji) s.after(emojiIcon(c.words[k].emoji, 14));
  });
  const emojiNow = c.words.find((w) => w.emoji)?.emoji;
  const emojiBtn = h('button', { class: `btn ghost sm icon-only emoji-btn${emojiNow ? ' on' : ''}`, type: 'button',
    'data-tip': emojiNow ? 'Change emoji' : 'Add an emoji', 'aria-label': emojiNow ? 'Change emoji' : 'Add an emoji',
    html: emojiNow ? '' : icon('smile'), onclick: () => openEmojiPicker(emojiBtn, c) });
  if (emojiNow) emojiBtn.append(emojiIcon(emojiNow, 18));

  const act = (ico, tip, fn) => h('button', { class: 'btn ghost sm icon-only', type: 'button', 'data-tip': tip, html: icon(ico), onclick: fn });
  const card = h('div', { class: 'cap', 'data-id': c.id },
    h('div', { class: 'cap-top' }, start, h('span', { class: 'arrow' }, '→'), end, h('span', { class: 'grow' }),
      act('play', 'Play', () => seek?.(c.start + 0.01, true)),
      emojiBtn,
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
  const items = toCheck();
  cursor = Math.min(cursor, Math.max(0, items.length - 1));
  reviewing = items[cursor] || null;
  list.replaceChildren(reviewBar(items) || '', ...state.captions.map(captionCard));
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
      h('div', { class: 'panel-body', id: 'cap-body' }, languageSection(), scriptSection(), enhanceSection(), toolsSection(), list));
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
