// The type bar over the preview: the caption settings people change most (font,
// size, case, alignment, spacing, position and colours) one click away, applied
// live to the video. The full set stays in the Text and Layout tools.
import { fontButton } from './fontpicker.js';
import { icon } from './icons.js';
import { setStyle, state } from './store.js';
import { h } from './ui.js';

const DEFAULT_V = { top: 10, middle: 0, bottom: 14 };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function typeBar() {
  const syncs = [];
  const sync = () => syncs.forEach((f) => f());
  let pop = null;
  const pressed = (b, on) => b.setAttribute('aria-pressed', String(on));

  // font
  const font = fontButton({ value: () => state.style.font, onPick: (id) => setStyle({ font: id }) });
  font.classList.add('tb-font');
  syncs.push(() => font.paint());

  // size: − value +
  const sizeIn = h('input', { class: 'tb-num', type: 'number', min: 24, max: 200, step: 1, 'aria-label': 'Text size' });
  const setSize = (v) => setStyle({ size: clamp(Math.round(v), 24, 200) }, 'tb-size');
  sizeIn.addEventListener('change', () => setSize(Number(sizeIn.value) || state.style.size));
  const step = (d) => h('button', { type: 'button', class: 'tb-btn', 'aria-label': d > 0 ? 'Bigger' : 'Smaller', 'data-tip': d > 0 ? 'Bigger' : 'Smaller',
    html: icon(d > 0 ? 'plus' : 'minus'), onclick: () => setSize(state.style.size + d) });
  syncs.push(() => { if (document.activeElement !== sizeIn) sizeIn.value = Math.round(state.style.size); });
  const size = h('div', { class: 'tb-group tb-size', role: 'group', 'aria-label': 'Size' }, step(-4), sizeIn, step(4));

  // a row of toggle buttons for one setting
  const choice = (label, key, options, patch = (v) => ({ [key]: v })) => h('div', { class: 'tb-group', role: 'group', 'aria-label': label },
    options.map(([v, text, tip, ico]) => {
      const b = h('button', { type: 'button', class: 'tb-btn', 'data-tip': tip, 'aria-label': tip, html: ico ? icon(ico) : null,
        onclick: () => setStyle(patch(v)) }, ico ? null : text);
      syncs.push(() => pressed(b, state.style[key] === v));
      return b;
    }));

  const textCase = choice('Letter case', 'textCase', [['none', 'Aa', 'As spoken'], ['upper', 'AA', 'CAPITALS'], ['lower', 'aa', 'lower case']]);
  const align = choice('Alignment', 'align', [['left', '', 'Align left', 'alignLeft'], ['center', '', 'Centre', 'alignCenter'], ['right', '', 'Align right', 'alignRight']]);
  const place = choice('Position', 'vPos', [['top', 'Top', 'Near the top'], ['middle', 'Mid', 'In the middle'], ['bottom', 'Low', 'Near the bottom']],
    (v) => ({ vPos: v, vOffset: DEFAULT_V[v] }));

  // spacing: letter spacing, line height and width, in a small pop-over
  const slider = (label, key, min, max, stepV, fmt) => {
    const r = h('input', { type: 'range', class: 'range', min, max, step: stepV, 'aria-label': label });
    const val = h('span', { class: 'value' });
    const paint = () => { r.style.setProperty('--fill', `${((Number(r.value) - min) / (max - min)) * 100}%`); val.textContent = fmt(Number(r.value)); };
    r.addEventListener('input', () => { setStyle({ [key]: Number(r.value) }, `tb-${key}`); paint(); });
    syncs.push(() => { if (document.activeElement !== r) r.value = state.style[key]; paint(); });
    return h('label', { class: 'tb-slider' }, h('span', {}, label, val), r);
  };
  pop = h('div', { class: 'tb-pop', hidden: true, role: 'dialog', 'aria-label': 'Spacing' },
    slider('Letter spacing', 'letterSpacing', -8, 20, 0.5, (v) => `${v}`),
    slider('Line height', 'lineHeight', 0.7, 1.8, 0.05, (v) => `${v.toFixed(2)}×`),
    slider('Max width', 'width', 30, 96, 1, (v) => `${v}%`),
    slider('Move up / down', 'vOffset', -45, 48, 0.5, (v) => `${v}%`));
  const spaceBtn = h('button', { type: 'button', class: 'tb-btn', 'aria-label': 'Spacing and width', 'data-tip': 'Spacing and width', 'aria-expanded': 'false', html: icon('spacing'),
    onclick: (e) => { e.stopPropagation(); togglePop(); } });
  const away = (e) => { if (!pop.contains(e.target) && !spaceBtn.contains(e.target)) togglePop(false); };
  function togglePop(open = pop.hidden) {
    pop.hidden = !open;
    // on the page itself: the bar's blur and sideways scroll would clip it
    if (open && pop.parentNode !== document.body) document.body.append(pop);
    spaceBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      sync();
      // under the button, kept on screen (the bar scrolls sideways, so the pop-over is fixed)
      const r = spaceBtn.getBoundingClientRect();
      pop.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - 130, innerWidth - 268))}px`;
      pop.style.top = `${r.bottom + 8}px`;
      document.addEventListener('pointerdown', away, true);
    } else document.removeEventListener('pointerdown', away, true);
  }
  const spacing = h('div', { class: 'tb-group tb-spacing' }, spaceBtn);

  // colours: the text, and the spoken word's highlight (or the keyword) when used
  const colour = (label, get, set) => {
    const i = h('input', { type: 'color', class: 'tb-color', 'aria-label': label, 'data-tip': label });
    i.addEventListener('input', () => set(i.value));
    syncs.push(() => { const v = get(); i.value = /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#ffffff'; i.parentElement && (i.hidden = v === undefined); });
    return i;
  };
  const accentKey = () => (state.style.highlight && state.style.highlight !== 'none' ? (state.style.highlight === 'pill' ? 'hlBgColor' : 'hlColor')
    : state.style.emphasis && state.style.emphasis !== 'none' ? 'emphColor' : null);
  const colours = h('div', { class: 'tb-group tb-colours', role: 'group', 'aria-label': 'Colours' },
    colour('Text colour', () => state.style.color, (v) => setStyle({ color: v }, 'tb-color')),
    colour('Highlight colour', () => (accentKey() ? state.style[accentKey()] || '#FFE14D' : undefined), (v) => accentKey() && setStyle({ [accentKey()]: v }, 'tb-accent')));

  const el = h('div', { class: 'typebar', role: 'toolbar', 'aria-label': 'Caption text' },
    font, size, h('i', { class: 'tb-sep' }), textCase, align, h('i', { class: 'tb-sep' }), place, spacing, h('i', { class: 'tb-sep' }), colours);
  sync();
  return { el, sync, destroy: () => { togglePop(false); pop.remove(); } };
}
