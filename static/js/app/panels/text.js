// Text: typeface, size, case, spacing, colour, and keyword emphasis.
import { fontById, families } from '../../engine/fonts.js';
import { fontButton } from '../fontpicker.js';
import { setStyle, state } from '../store.js';
import { colorField, h, more, section, segmented, slider, toggle } from '../ui.js';
import { stylePanel } from './base.js';

function weightSelect(ctrls) {
  const sel = h('select', { class: 'select', 'aria-label': 'Weight' });
  sel.addEventListener('change', () => setStyle({ font: sel.value }));
  const el = h('label', { class: 'field' }, h('span', { class: 'label' }, 'Weight'), sel);
  return ctrls.add(el, () => {
    const f = fontById(state.style.font);
    const fam = families().find((x) => x.family === f.family);
    const opts = fam ? fam.fonts : [f];
    if (sel.dataset.family !== f.family) {
      sel.replaceChildren(...opts.map((o) => h('option', { value: o.id }, o.label)));
      sel.dataset.family = f.family;
    }
    sel.value = f.id;
    sel.disabled = opts.length < 2;
  });
}

export const textPanel = stylePanel({
  title: 'Text',
  shape: () => [state.style.gradientTo ? 'g' : '', state.style.emphasis, state.style.emphBg ? 'b' : ''].join('|'),
  build(ctrls) {
    const s = state.style;
    const font = fontButton({ value: () => state.style.font, onPick: (id) => setStyle({ font: id }) });
    ctrls.add(font, () => font.paint());
    const emphFont = fontButton({ value: () => state.style.emphFont, onPick: (id) => setStyle({ emphFont: id }), allowSame: true, label: 'Keyword font' });
    ctrls.add(emphFont, () => emphFont.paint());
    return [
      section('Typeface',
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Font'), font),
        h('div', { class: 'grid2' }, weightSelect(ctrls),
          slider(ctrls, { label: 'Size', key: 'size', min: 24, max: 200, step: 1 })),
        segmented(ctrls, { label: 'Letter case', key: 'textCase', options: [['none', 'Aa'], ['upper', 'AA'], ['lower', 'aa'], ['title', 'Title']] }),
        segmented(ctrls, { label: 'Alignment', key: 'align', options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] }),
      ),
      section('Colour',
        colorField(ctrls, { label: s.gradientTo ? 'Gradient top' : 'Text colour', key: 'color' }),
        h('label', { class: 'switch' }, h('span', {}, 'Gradient fill'), (() => {
          const i = h('input', { type: 'checkbox', role: 'switch', checked: s.gradientTo ? true : null });
          i.addEventListener('change', () => setStyle({ gradientTo: i.checked ? '#FF4FD8' : null }));
          return i;
        })()),
        s.gradientTo ? colorField(ctrls, { label: 'Gradient bottom', key: 'gradientTo' }) : null,
        s.gradientTo && s.tilt ? h('p', { class: 'note' }, 'Gradients are turned off while the caption is tilted (Layout → Tilt).') : null,
      ),
      section('Keyword emphasis',
        segmented(ctrls, { key: 'emphasis', options: [['none', 'Off'], ['auto', 'Automatic'], ['marked', 'Words I mark']],
          onChange: (v) => setStyle({ emphasis: v, ...(v !== 'none' && !state.style.emphColor && !state.style.emphBg && state.style.emphScale === 1
            ? { emphColor: '#FFE14D', emphScale: 1.2 } : {}) }) }),
        s.emphasis === 'none' ? h('p', { class: 'hint' }, 'Make one word per caption stand out: bigger, a different colour or font, or on a marker.') : null,
        s.emphasis !== 'none' ? h('p', { class: 'hint' }, s.emphasis === 'auto'
          ? 'Picks numbers first, then the most meaningful word. Words you star in Captions always win.'
          : 'Star words in the Captions panel to emphasise them.') : null,
        ...(s.emphasis !== 'none' ? [
          colorField(ctrls, { label: 'Keyword colour', key: 'emphColor' }),
          slider(ctrls, { label: 'Keyword size', key: 'emphScale', min: 1, max: 2, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }),
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Keyword font'), emphFont),
          toggle(ctrls, { label: 'Marker behind keyword', key: 'emphBg' }),
          s.emphBg ? colorField(ctrls, { label: 'Marker colour', key: 'emphBgColor' }) : null,
        ] : []),
      ),
      more('Spacing & punctuation',
        slider(ctrls, { label: 'Letter spacing', key: 'letterSpacing', min: -4, max: 20, step: 0.5 }),
        slider(ctrls, { label: 'Line height', key: 'lineHeight', min: 0.7, max: 1.8, step: 0.05, format: (v) => `${v.toFixed(2)}×` }),
        toggle(ctrls, { label: 'Hide punctuation', key: 'punctuation', on: 'strip', off: 'keep' }),
        slider(ctrls, { label: 'Text opacity', key: 'opacity', min: 0.2, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }),
      ),
    ];
  },
});
