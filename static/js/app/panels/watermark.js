// Watermark: the fastrr overlay in a light or dark variant, in the 1:1 or 9:16
// layout, with size and visibility. Shown in the preview and drawn into the export.
import { watermarkFile, watermarkFormat } from '../../engine/watermark.js';
import { setWatermark, state } from '../store.js';
import { Controls, h, section } from '../ui.js';

const dims = () => [state.project?.info?.width || 1080, state.project?.info?.height || 1920];

function seg(ctrls, label, key, options) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label },
    options.map(([v, text]) => h('button', { type: 'button', 'data-v': v, onclick: () => setWatermark({ [key]: v }) }, text)));
  return ctrls.add(h('div', { class: 'field' }, h('span', { class: 'label' }, label), el),
    () => el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === state.watermark[key]))));
}

function range(ctrls, label, key, min, max) {
  const input = h('input', { type: 'range', class: 'range', min, max, step: 1, 'aria-label': label });
  const value = h('span', { class: 'value' });
  const paint = () => { input.style.setProperty('--fill', `${((input.value - min) / (max - min)) * 100}%`); value.textContent = `${input.value}%`; };
  input.addEventListener('input', () => { setWatermark({ [key]: Number(input.value) }); paint(); });
  return ctrls.add(h('label', { class: 'field' }, h('span', { class: 'label' }, label, value), input),
    () => { if (document.activeElement !== input) input.value = state.watermark[key]; paint(); });
}

// A card per variant, showing the real overlay on the kind of video it suits.
function toneCards(ctrls) {
  const card = (tone, title, desc) => {
    const img = h('img', { alt: '', draggable: 'false' });
    const b = h('button', { type: 'button', class: `wm-card ${tone}`, 'data-tone': tone, onclick: () => setWatermark({ tone, on: true }) },
      h('span', { class: 'wm-thumb' }, img), h('b', {}, title), h('small', {}, desc));
    b.img = img;
    return b;
  };
  const cards = [card('light', 'Light', 'For dark videos'), card('dark', 'Dark', 'For light videos')];
  return ctrls.add(h('div', { class: 'wm-cards' }, cards), () => {
    const [W, H] = dims();
    for (const c of cards) {
      c.setAttribute('aria-pressed', String(state.watermark.on && state.watermark.tone === c.dataset.tone));
      c.img.src = `/watermarks/${watermarkFile({ ...state.watermark, tone: c.dataset.tone }, W, H)}`;
      c.querySelector('.wm-thumb').style.aspectRatio = watermarkFormat(state.watermark, W, H) === '9x16' ? '9 / 16' : '1 / 1';
    }
  });
}

let root = null, ctrls = null;
export const watermarkPanel = {
  mount(container) {
    ctrls = new Controls();
    const on = h('input', { type: 'checkbox', role: 'switch' });
    on.addEventListener('change', () => setWatermark({ on: on.checked }));
    const [W, H] = dims();
    const autoLabel = `Auto (${watermarkFormat({ format: 'auto' }, W, H) === '9x16' ? '9:16' : '1:1'})`;
    const body = h('div', { class: 'panel-body' },
      section(null,
        ctrls.add(h('label', { class: 'switch' }, h('span', {}, 'Add the fastrr watermark'), on), () => { on.checked = state.watermark.on; }),
        h('p', { class: 'hint' }, 'Shown in the preview and drawn into the exported video, under the captions.')),
      section('Variant', toneCards(ctrls)),
      section('Layout',
        seg(ctrls, 'Frame', 'format', [['auto', autoLabel], ['1x1', '1:1'], ['9x16', '9:16']]),
        range(ctrls, 'Size', 'size', 20, 100),
        range(ctrls, 'Visibility', 'opacity', 10, 100)));
    root = h('div', { style: { display: 'contents' } }, h('div', { class: 'panel-head' }, h('h2', {}, 'Watermark')), body);
    container.replaceChildren(root);
  },
  unmount() { root = null; },
  update() { if (root) ctrls.sync(); },
};
