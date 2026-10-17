// Caption style library: categories, search, and live previews of every style
// drawn with its real fonts over a frame of your own video.
import { ensureFonts } from '../../engine/fonts.js';
import { SvgRenderer } from '../../engine/index.js';
import { fontsFor } from '../../engine/layout.js';
import { buildScene } from '../../engine/scene.js';
import { CATEGORIES, TEMPLATES } from '../../templates/library.js';
import { icon } from '../icons.js';
import { rechunk } from '../session.js';
import { checkpoint, emit, state } from '../store.js';
import { h } from '../ui.js';

const PREVIEW_W = 1080, PREVIEW_H = 810;
let root = null, grid = null, category = 'all', query = '';
let observer = null;
const cards = new Map(); // template id -> { el, renderer, rendered }

function sampleWords() {
  const c = state.captions.find((x) => x.words.length >= 4) || state.captions[0];
  const text = c ? c.words.map((w) => w.text) : 'Make every single video count'.split(' ');
  return text;
}

function sampleCaption(tpl) {
  const words = sampleWords().slice(0, Math.max(1, Math.min(tpl.style.maxWords, 5)));
  const ws = words.map((text, i) => ({ text, start: i * 0.32, end: i * 0.32 + 0.3 }));
  return { id: `sample-${tpl.id}`, start: 0, end: ws.length * 0.32 + 0.6, words: ws };
}

// Thumbnails show the style centred in a 4:3 frame, enlarged so it reads at
// card size (every size-related setting scales together, so proportions hold).
const PX_KEYS = ['size', 'letterSpacing', 'outline', 'shadowX', 'shadowY', 'shadowBlur', 'glow', 'bgRadius', 'bgPadX', 'bgPadY', 'stagger'];
const previewStyle = (tpl) => {
  const s = { ...tpl.style, vPos: 'middle', vOffset: 0, hPos: 'center', hOffset: 0, width: 96, maxLines: Math.max(3, tpl.style.maxLines) };
  for (const k of PX_KEYS) s[k] = (s[k] || 0) * 2;
  return s;
};

async function renderCard(id, t = null) {
  const card = cards.get(id);
  const tpl = TEMPLATES.find((x) => x.id === id);
  if (!card || !tpl) return;
  const caption = sampleCaption(tpl);
  const style = previewStyle(tpl);
  await ensureFonts(fontsFor([caption], style));
  card.scene = buildScene(caption, style, PREVIEW_W, PREVIEW_H, true);
  card.renderer.clear();
  const n = caption.words.length;
  const at = t ?? (n > 1 ? caption.words[Math.max(0, n - 2)].start + 0.1 : caption.words[0].start + 0.5);
  card.renderer.render([card.scene], at);
  card.rendered = true;
}

function animate(id) {
  const card = cards.get(id);
  if (!card?.scene) return;
  const start = performance.now();
  const dur = card.scene.caption.end + 0.3;
  card.playing = true;
  const step = () => {
    if (!card.playing) return;
    const t = ((performance.now() - start) / 1000) % dur;
    card.renderer.render([card.scene], Math.min(t, card.scene.caption.end - 0.01));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function applyTemplate(tpl) {
  checkpoint(`template-${Date.now()}`);
  const prev = state.style;
  state.templateId = tpl.id;
  state.style = { ...tpl.style };
  emit('style');
  if (state.captions.length && (prev.maxWords !== tpl.style.maxWords || prev.maxLines !== tpl.style.maxLines)) {
    state.captions = await rechunk();
    emit('captions');
  }
  markSelected();
}

function markSelected() {
  cards.forEach((c, id) => c.el.setAttribute('aria-pressed', String(id === state.templateId)));
}

function card(tpl) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${PREVIEW_W} ${PREVIEW_H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const thumb = h('div', { class: 'thumb' }, svg);
  if (state.frameThumb) thumb.style.backgroundImage = `url(${state.frameThumb})`;
  else thumb.style.background = 'linear-gradient(135deg, #2a2340, #121220 55%, #2b1830)';
  const el = h('button', { class: 'tpl', type: 'button', 'data-id': tpl.id, 'aria-pressed': 'false',
    onclick: () => applyTemplate(tpl),
    onmouseenter: () => animate(tpl.id),
    onmouseleave: () => { const c = cards.get(tpl.id); if (c) { c.playing = false; renderCard(tpl.id); } },
    onfocus: () => animate(tpl.id), onblur: () => { const c = cards.get(tpl.id); if (c) c.playing = false; } },
  h('span', { class: 'check', html: icon('check') }), thumb,
  h('span', { class: 'meta' }, h('b', {}, tpl.name), h('small', {}, tpl.note)));
  cards.set(tpl.id, { el, renderer: new SvgRenderer(svg), rendered: false });
  observer.observe(el);
  return el;
}

function renderGrid() {
  cards.clear();
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.dataset.id;
      if (!cards.get(id)?.rendered) renderCard(id);
    }
  }, { root: grid.closest('.panel-body'), rootMargin: '200px' });
  const q = query.trim().toLowerCase();
  const match = (t) => (category === 'all' || t.category === category)
    && (!q || `${t.name} ${t.note} ${t.category}`.toLowerCase().includes(q));
  const groups = CATEGORIES.map((c) => ({ ...c, items: TEMPLATES.filter((t) => t.category === c.id && match(t)) }))
    .filter((g) => g.items.length);
  if (!groups.length) {
    grid.replaceChildren(h('p', { class: 'empty-results' }, 'No styles match that search.'));
    return;
  }
  grid.replaceChildren(...groups.map((g) => h('div', { class: 'tpl-group' },
    category === 'all' ? h('h4', {}, g.name) : null,
    h('div', { class: 'tpl-grid' }, g.items.map(card)))));
  markSelected();
}

export const templatesPanel = {
  mount(container) {
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search styles', value: query, 'aria-label': 'Search styles' });
    search.addEventListener('input', () => { query = search.value; renderGrid(); });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Categories' },
      [{ id: 'all', name: 'All' }, ...CATEGORIES].map((c) => h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(c.id === category),
        onclick: (e) => {
          category = c.id;
          chips.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
          renderGrid();
        },
      }, c.name.replace(' & ', ' & '))));
    grid = h('div', { style: { display: 'grid', gap: '14px' } });
    const current = TEMPLATES.find((t) => t.id === state.templateId);
    root = h('div', { style: { display: 'contents' } },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Caption styles'),
        h('span', { class: 'hint', id: 'tpl-current' }, current ? `Using “${current.name}”` : '')),
      h('div', { class: 'panel-body' },
        h('div', { class: 'tpl-search', html: icon('search') }, search), chips, grid));
    container.replaceChildren(root);
    renderGrid();
  },
  unmount() { observer?.disconnect(); cards.forEach((c) => { c.playing = false; }); root = null; },
  update(what) {
    if (!root) return;
    if (what === 'style' || what === 'history') {
      markSelected();
      const current = TEMPLATES.find((t) => t.id === state.templateId);
      const label = root.querySelector('#tpl-current');
      if (label) label.textContent = current ? `Using “${current.name}”${JSON.stringify(current.style) !== JSON.stringify(state.style) ? ' · customised' : ''}` : '';
    }
    if (what === 'thumb' || what === 'transcript') renderGrid();
  },
};
