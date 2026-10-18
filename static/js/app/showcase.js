// The first page's live type: the Reels mockup in the hero (its caption changes
// style every few seconds) and the bento of style specimens. Captions are drawn
// live by the same engine that renders exports, timed by a clock instead of video.
import { chunkWords } from '../engine/chunk.js';
import { ensureFonts, fontById } from '../engine/fonts.js';
import { CaptionEngine, SvgRenderer } from '../engine/index.js';
import { fitsCaption, fontsFor } from '../engine/layout.js';
import { CATEGORIES, templateById } from '../templates/library.js';
import { set, state } from './store.js';
import { h } from './ui.js';

const SIZE_KEYS = ['size', 'letterSpacing', 'outline', 'shadowX', 'shadowY', 'shadowBlur', 'glow', 'bgRadius', 'bgPadX', 'bgPadY', 'stagger'];

// Words at a natural speaking pace (the same model the editor's examples use).
function timed(text) {
  const words = [];
  let t = 0.15;
  for (const word of text.split(' ')) {
    const d = 0.16 + 0.05 * word.replace(/[.,!?।]/g, '').length;
    words.push({ text: word, start: +t.toFixed(3), end: +(t + d).toFixed(3) });
    t += d + (/[.!?।]$/.test(word) ? 0.4 : /,$/.test(word) ? 0.18 : 0.06);
  }
  return { words, duration: t + 0.25 };
}

// The specimens: one style each, on a flat surface. `size` places the card in the bento.
const SPECIMENS = [
  { template: 'hormozi', surface: 'purple', size: 'big', language: 'English',
    text: 'Meet the new one click checkout. No forms. No waiting. Your customers pay in seconds.' },
  { template: 'karaoke', surface: 'ink', language: 'English',
    text: 'Most people watch with the sound off, so the words on screen do the talking.' },
  { template: 'desi', surface: 'maroon', language: 'Hindi',
    text: 'नमस्ते दोस्तों! आज हम सीखेंगे कि वीडियो पर कैप्शन कैसे लगाएं।' },
  { template: 'popstar', surface: 'forest', language: 'Hinglish',
    text: 'Yeh offer sirf aaj ke liye hai, toh jaldi order karo aur free delivery pao!' },
  { template: 'magazine', surface: 'stone', language: 'English',
    text: 'Keep each line short, keep it in sync, and make the key idea stand out.' },
  { template: 'tiles', surface: 'paper', size: 'wide', language: 'English',
    text: 'Every word sits on its own tile, so it reads on any footage.' },
  { template: 'neon', surface: 'night', size: 'wide', language: 'English',
    text: 'Launching tonight for every store. Free shipping on your first order.' },
];
const HERO_TEXT = 'Meet the new one click checkout. No forms. No waiting. Your customers pay in seconds.';
const HERO_STYLES = ['hormozi', 'karaoke', 'popstar', 'aurora', 'neon', 'magazine'];

let raf = 0;
let active = false;
const players = [];
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function stopShowcase() {
  active = false;
  cancelAnimationFrame(raf);
  for (const p of players) p.observer?.disconnect();
  players.length = 0;
}

function startLoop() {
  if (active) return;
  active = true;
  const draw = (now) => {
    if (!active) return;
    for (const p of players) {
      if (!p.ready || !p.visible) continue;
      const t = reduceMotion() ? p.still : ((now - p.t0) / 1000) % p.duration;
      if (p.onLoop && t + 0.05 < p.lastT) p.onLoop();
      p.lastT = t;
      p.renderer.render(p.engine.scenesAt(t), t);
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
}

// Live captions in a W×H frame, looping on a clock. `scale` enlarges the type
// for small cards so it reads at a glance.
function livePlayer(text, templateId, { W, H, scale = 1, textSize = 0, onLoop, el, fit = false }) {
  const { words, duration } = timed(text);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'live-captions');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  const renderer = new SvgRenderer(svg);
  renderer.setSize(W, H);
  const p = { W, H, renderer, engine: new CaptionEngine(), ready: false, visible: false, lastT: 0, onLoop, duration,
    t0: performance.now(), still: words[Math.min(3, words.length - 1)].start + 0.1 };
  p.setTemplate = async (id = p.templateId) => {
    const tpl = templateById(id);
    if (!tpl) return;
    p.templateId = id;
    // centre the caption: the specimen is about the type, not where it sits on a video
    const style = { ...tpl.style, vPos: 'middle', vOffset: 0, hPos: 'center', hOffset: 0 };
    // textSize: type size in frame px (short side 1080), whatever the template's own size
    const k = textSize ? textSize / tpl.style.size : scale;
    for (const key of SIZE_KEYS) style[key] = (style[key] || 0) * k;
    await ensureFonts(fontsFor([{ words }], style));
    const captions = chunkWords(words, style, (ws) => fitsCaption(ws, style, p.W, p.H));
    await p.engine.set({ captions, style, W: p.W, H: p.H });
    renderer.clear();
    p.ready = true;
  };
  if (fit && el) {
    // match the frame to the box it's shown in (short side 1080), so type sizes stay
    // proportional and nothing is shrunk to fit
    let timer = 0;
    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const a = width / height;
      const nW = a >= 1 ? Math.round(1080 * a) : 1080, nH = a >= 1 ? 1080 : Math.round(1080 / a);
      if (nW === p.W && nH === p.H) return;
      p.W = nW; p.H = nH;
      renderer.setSize(nW, nH);
      clearTimeout(timer);
      timer = setTimeout(() => p.setTemplate(), 60);
    }).observe(el);
  }
  p.setTemplate(templateId);
  p.observer = new IntersectionObserver(([entry]) => { p.visible = entry.isIntersecting; }, { threshold: 0.15 });
  // start watching once the element is on the page; watching a detached element
  // reports it as off-screen and never corrects itself
  requestAnimationFrame(() => p.observer?.observe(el || svg));
  players.push(p);
  startLoop();
  return { p, svg };
}

// ------------------------------------------------------------ hero phone

const ICON = {
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  comment: '<path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z"/>',
  share: '<path d="M21 4 3 11l7 2 2 7 9-16z"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="12" cy="13.5" r="3.5"/><path d="M9 7l1.5-2.5h3L15 7"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
};
const svgIcon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

// A Reels-style screen: soft studio backdrop, the app's own chrome, and the
// live caption in the safe area, changing style every loop.
export function heroPhone() {
  const label = h('span', { class: 'phone-style' });
  const screen = h('div', { class: 'phone-screen' });
  const frame = h('div', { class: 'reel-backdrop' });
  let k = 0;
  const show = () => { label.textContent = templateById(HERO_STYLES[k])?.name || ''; };
  const { p, svg } = livePlayer(HERO_TEXT, HERO_STYLES[0], { W: 1080, H: 1920, textSize: 160, el: screen,
    onLoop: () => { k = (k + 1) % HERO_STYLES.length; show(); p.setTemplate(HERO_STYLES[k]); } });
  show();
  const action = (icon, count) => h('span', { class: 'reel-action', html: `${svgIcon(icon)}${count ? `<small>${count}</small>` : ''}` });
  screen.append(frame, svg,
    h('div', { class: 'reel-top' }, h('b', {}, 'Reels'), h('span', { html: svgIcon('camera') })),
    h('div', { class: 'reel-actions' }, action('heart', '12.4K'), action('comment', '318'), action('share', '1.2K'), action('more')),
    h('div', { class: 'reel-meta' },
      h('div', { class: 'reel-user' }, h('i', {}), h('b', {}, 'yourbrand'), h('span', {}, 'Follow')),
      h('p', {}, 'One click checkout is here'),
      h('div', { class: 'reel-audio', html: `${svgIcon('music')}<span>Original audio</span>` })),
    h('span', { class: 'reel-progress' }, h('i', {})));
  return h('div', { class: 'phone', 'aria-hidden': 'true' }, h('span', { class: 'phone-notch' }), screen, label);
}

// ------------------------------------------------------------ specimens

function traits(style) {
  const out = [fontById(style.font)?.family || style.font];
  const hl = { color: 'Spoken word in colour', pill: 'Pill on the spoken word', sweep: 'Karaoke sweep', progressive: 'Read-along' }[style.highlight];
  if (hl) out.push(hl);
  else if (style.bg === 'word') out.push('Word tiles');
  else if (style.bg !== 'none') out.push('Background box');
  if (style.glow) out.push('Glow');
  else if (style.outline >= 4) out.push('Outline');
  if (style.emphasis !== 'none' && style.emphFont) out.push('Keyword in serif');
  if (style.reveal) out.push('Word by word');
  return out.slice(0, 3);
}

// Bento of style specimens; clicking one makes it the starting style.
export function showcase(onPick) {
  const grid = h('div', { class: 'specimens', role: 'list' });
  const cards = SPECIMENS.map((sp) => specimen(sp, grid, onPick)).filter(Boolean);
  grid.replaceChildren(...cards);
  return grid;
}

function specimen(sp, grid, onPick) {
  const tpl = templateById(sp.template);
  if (!tpl) return null;
  const wide = sp.size === 'wide';
  const stage = h('span', { class: 'spec-stage' });
  // big and square cards use a square frame, wide cards a 2:1 frame
  const textSize = wide ? 270 : sp.size === 'big' ? 150 : 230;
  const { svg } = livePlayer(sp.text, tpl.id, { W: 1620, H: 1080, textSize, el: stage, fit: true });
  stage.append(svg);
  const selected = () => state.templateId === tpl.id;
  const category = CATEGORIES.find((c) => c.id === tpl.category)?.name || '';
  const cta = h('span', { class: 'spec-cta' }, selected() ? 'Selected' : 'Use this style');
  const el = h('button', { class: `look spec spec-${sp.size || 'square'} surface-${sp.surface}`, type: 'button', role: 'listitem',
    'data-template': tpl.id, 'aria-pressed': String(selected()), 'aria-label': `${tpl.name} style, ${sp.language}`,
    onclick: () => {
      set({ templateId: tpl.id, style: { ...tpl.style } });
      grid.querySelectorAll('.look').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === el));
        b.querySelector('.spec-cta').textContent = b === el ? 'Selected' : 'Use this style';
      });
      onPick?.(tpl);
    } },
  h('span', { class: 'spec-head' },
    h('span', {}, h('b', {}, tpl.name), h('small', {}, category)),
    h('span', { class: 'spec-lang' }, sp.language)),
  stage,
  h('span', { class: 'spec-foot' }, h('span', { class: 'spec-traits' }, traits(tpl.style).map((t) => h('i', {}, t)))),
  cta);
  return el;
}
