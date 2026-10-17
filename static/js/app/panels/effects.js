// Effects: outline, shadow, glow, background shapes, and the spoken-word highlight.
import { state } from '../store.js';
import { colorField, h, more, section, segmented, slider } from '../ui.js';
import { stylePanel } from './base.js';

const pct = (v) => `${Math.round(v * 100)}%`;

export const effectsPanel = stylePanel({
  title: 'Effects',
  shape: () => [state.style.bg, state.style.highlight, state.style.outline > 0, state.style.shadowOpacity > 0,
    state.style.glow > 0, state.style.tilt ? 't' : ''].join('|'),
  build(ctrls) {
    const s = state.style;
    return [
      section('Spoken word',
        segmented(ctrls, { key: 'highlight', options: [['none', 'Off'], ['color', 'Colour'], ['pill', 'Pill'], ['sweep', 'Sweep'], ['progressive', 'Spoken']] }),
        h('p', { class: 'hint' }, {
          none: 'Highlight the word being spoken, in sync with the voice.',
          color: 'The word being spoken changes colour.',
          pill: 'A rounded pill moves under the word being spoken.',
          sweep: 'Colour fills each word left to right as it’s spoken (karaoke).',
          progressive: 'Words change colour once they’ve been spoken.',
        }[s.highlight]),
        s.highlight === 'sweep' && s.tilt ? h('p', { class: 'note' }, 'Sweep shows as Read-along while the caption is tilted.') : null,
        ...(s.highlight !== 'none' ? [
          h('div', { class: 'grid2' },
            colorField(ctrls, { label: s.highlight === 'pill' ? 'Word colour' : 'Highlight colour', key: 'hlColor', swatches: false }),
            s.highlight === 'pill' ? colorField(ctrls, { label: 'Pill colour', key: 'hlBgColor', swatches: false }) : h('span')),
          s.highlight === 'color' || s.highlight === 'pill'
            ? slider(ctrls, { label: 'Grow spoken word', key: 'hlScale', min: 1, max: 1.4, step: 0.02, format: pct }) : null,
        ] : []),
      ),
      section('Outline',
        slider(ctrls, { label: 'Thickness', key: 'outline', min: 0, max: 16, step: 0.5 }),
        s.outline > 0 ? colorField(ctrls, { label: 'Outline colour', key: 'outlineColor', swatches: false }) : null),
      section('Shadow',
        slider(ctrls, { label: 'Strength', key: 'shadowOpacity', min: 0, max: 1, step: 0.05, format: pct }),
        ...(s.shadowOpacity > 0 ? [
          h('div', { class: 'grid2' },
            slider(ctrls, { label: 'Softness', key: 'shadowBlur', min: 0, max: 30, step: 1 }),
            colorField(ctrls, { label: 'Colour', key: 'shadowColor', swatches: false })),
          h('div', { class: 'grid2' },
            slider(ctrls, { label: 'Offset X', key: 'shadowX', min: -20, max: 20, step: 1 }),
            slider(ctrls, { label: 'Offset Y', key: 'shadowY', min: -20, max: 20, step: 1 })),
        ] : [])),
      section('Glow',
        slider(ctrls, { label: 'Size', key: 'glow', min: 0, max: 30, step: 1 }),
        ...(s.glow > 0 ? [h('div', { class: 'grid2' },
          colorField(ctrls, { label: 'Colour', key: 'glowColor', swatches: false }),
          slider(ctrls, { label: 'Intensity', key: 'glowOpacity', min: 0.1, max: 1, step: 0.05, format: pct }))] : [])),
      section('Background',
        segmented(ctrls, { key: 'bg', options: [['none', 'None'], ['line', 'Per line'], ['block', 'One block'], ['word', 'Per word']] }),
        ...(s.bg !== 'none' ? [
          h('div', { class: 'grid2' },
            colorField(ctrls, { label: 'Colour', key: 'bgColor', swatches: false }),
            slider(ctrls, { label: 'Opacity', key: 'bgOpacity', min: 0.1, max: 1, step: 0.05, format: pct })),
          slider(ctrls, { label: 'Corner radius', key: 'bgRadius', min: 0, max: 40, step: 1 }),
        ] : []),
        ...(s.bg !== 'none' || s.highlight === 'pill' || s.emphBg ? [more('Padding',
          slider(ctrls, { label: 'Horizontal', key: 'bgPadX', min: 0, max: 50, step: 1 }),
          slider(ctrls, { label: 'Vertical', key: 'bgPadY', min: 0, max: 40, step: 1 }),
          s.bg === 'none' ? slider(ctrls, { label: 'Corner radius', key: 'bgRadius', min: 0, max: 40, step: 1 }) : null)] : []),
      ),
    ];
  },
});
