// Layout: where captions sit, how wide they are, how many words per caption,
// and expressive options (staggered lines, tilt).
import { flattenWords } from '../../engine/chunk.js';
import { rechunk } from '../session.js';
import { checkpoint, emit, setStyle, state } from '../store.js';
import { h, section, slider, toast } from '../ui.js';
import { stylePanel } from './base.js';

const POSITIONS = [
  ['top', 'left'], ['top', 'center'], ['top', 'right'],
  ['middle', 'left'], ['middle', 'center'], ['middle', 'right'],
  ['bottom', 'left'], ['bottom', 'center'], ['bottom', 'right'],
];
const DEFAULT_V = { top: 10, middle: 0, bottom: 14 };
const DEFAULT_H = { left: 6, center: 0, right: 6 };

function positionGrid(ctrls) {
  const grid = h('div', { class: 'grid3', role: 'group', 'aria-label': 'Position presets' },
    POSITIONS.map(([v, hp]) => h('button', {
      type: 'button', class: 'btn sm', 'aria-label': `${v} ${hp}`, 'data-v': v, 'data-h': hp,
      onclick: () => setStyle({ vPos: v, hPos: hp, vOffset: DEFAULT_V[v], hOffset: DEFAULT_H[hp], align: hp }),
    }, h('span', { style: { display: 'block', width: '26px', height: '18px', border: '1.5px solid currentColor', borderRadius: '3px', position: 'relative' } },
      h('span', { style: {
        position: 'absolute', height: '3px', width: '12px', background: 'currentColor', borderRadius: '2px',
        top: v === 'top' ? '2px' : v === 'middle' ? '6px' : '10px',
        left: hp === 'left' ? '2px' : hp === 'center' ? '5px' : '8px',
      } })))));
  return ctrls.add(grid, () => grid.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.v === state.style.vPos && b.dataset.h === state.style.hPos;
    b.classList.toggle('primary', on);
    b.setAttribute('aria-pressed', String(on));
  }));
}

async function applyLength(patch) {
  checkpoint(`length-${Date.now()}`);
  state.style = { ...state.style, ...patch };
  emit('style');
  if (state.captions.length) {
    state.captions = await rechunk(flattenWords(state.captions));
    emit('captions');
    toast(`Captions re-split: ${state.captions.length} captions.`, 'ok', 2500);
  }
}

function lengthSlider(ctrls, { label, key, min, max }) {
  const input = h('input', { type: 'range', class: 'range', min, max, step: 1, 'aria-label': label });
  const value = h('span', { class: 'value' });
  const paint = () => { input.style.setProperty('--fill', `${((input.value - min) / (max - min)) * 100}%`); value.textContent = input.value; };
  input.addEventListener('input', paint);
  input.addEventListener('change', () => applyLength({ [key]: Number(input.value) }));
  return ctrls.add(h('label', { class: 'field' }, h('span', { class: 'label' }, label, value), input),
    () => { if (document.activeElement !== input) input.value = state.style[key]; paint(); });
}

export const positionPanel = stylePanel({
  title: 'Layout',
  shape: () => [state.style.vPos, state.style.hPos, state.style.gradientTo ? 'g' : '', state.style.highlight, state.style.tilt ? 't' : ''].join('|'),
  build(ctrls) {
    const s = state.style;
    const clipBased = s.gradientTo || s.highlight === 'sweep';
    return [
      section('Position',
        positionGrid(ctrls),
        slider(ctrls, { label: s.vPos === 'middle' ? 'Move up / down' : `Distance from ${s.vPos}`, key: 'vOffset', min: s.vPos === 'middle' ? -45 : 0, max: 48, step: 0.5, format: (v) => `${v}%` }),
        slider(ctrls, { label: s.hPos === 'center' ? 'Move left / right' : `Distance from ${s.hPos}`, key: 'hOffset', min: s.hPos === 'center' ? -40 : 0, max: 40, step: 0.5, format: (v) => `${v}%` }),
        h('p', { class: 'hint' }, 'You can also drag the caption in the preview. Pick a safe zone above the video to see where app buttons sit.')),
      section('Size of each caption',
        slider(ctrls, { label: 'Max width', key: 'width', min: 30, max: 96, step: 1, format: (v) => `${v}%` }),
        lengthSlider(ctrls, { label: 'Max words per caption', key: 'maxWords', min: 1, max: 14 }),
        lengthSlider(ctrls, { label: 'Max lines', key: 'maxLines', min: 1, max: 4 }),
        h('p', { class: 'hint' }, 'Changing words or lines re-splits all captions (you can undo).')),
      section('Expressive',
        slider(ctrls, { label: 'Stagger lines', key: 'stagger', min: 0, max: 160, step: 2 }),
        slider(ctrls, { label: 'Tilt', key: 'tilt', min: -12, max: 12, step: 0.5, format: (v) => `${v}°` }),
        clipBased && s.tilt ? h('p', { class: 'note' }, 'While tilted, gradient fills and sweep highlights are simplified (they can’t be rotated in the export).') : null),
    ];
  },
});
