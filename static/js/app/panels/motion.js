// Motion: how captions enter and leave, word-by-word reveals, and speed.
import { CAPTION_IN, CAPTION_OUT, WORD_IN } from '../../engine/motion.js';
import { icon } from '../icons.js';
import { setStyle, state } from '../store.js';
import { h, section, slider, toggle } from '../ui.js';
import { stylePanel } from './base.js';

function presetGrid(ctrls, key, presets) {
  const grid = h('div', { class: 'grid3' }, Object.entries(presets).map(([id, p]) => h('button', {
    type: 'button', class: 'btn sm', 'data-v': id, onclick: () => { setStyle({ [key]: id }); replay(); },
  }, p.label)));
  return ctrls.add(grid, () => grid.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.v === state.style[key];
    b.classList.toggle('primary', on);
    b.setAttribute('aria-pressed', String(on));
  }));
}

let replayHook = null;
export function setReplay(fn) { replayHook = fn; }
const replay = () => replayHook?.();

export const motionPanel = stylePanel({
  title: 'Motion',
  shape: () => [state.style.reveal, state.style.cascade].join('|'),
  build(ctrls) {
    const s = state.style;
    const wordAnim = s.reveal || s.cascade;
    return [
      h('button', { class: 'btn', type: 'button', html: `${icon('replay')}<span>Preview the current caption</span>`, onclick: replay }),
      section('Caption entrance', presetGrid(ctrls, 'animIn', CAPTION_IN)),
      section('Caption exit', presetGrid(ctrls, 'animOut', CAPTION_OUT)),
      section('Word by word',
        toggle(ctrls, { label: 'Words appear as they’re spoken', key: 'reveal' }),
        !s.reveal ? toggle(ctrls, { label: 'Words enter one after another', key: 'cascade' }) : null,
        wordAnim ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Word entrance'), presetGrid(ctrls, 'wordIn', WORD_IN)) : null,
      ),
      section('Speed',
        slider(ctrls, { label: 'Animation speed', key: 'speed', min: 0.5, max: 2, step: 0.1, format: (v) => `${v.toFixed(1)}×` }),
        h('p', { class: 'hint' }, 'Faster speeds make entrances snappier; slower ones feel calmer.')),
    ];
  },
});
