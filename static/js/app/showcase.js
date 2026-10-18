// Live captioned clips on the first page: the phone in the hero (which changes
// style every loop) and the row of styles to start with. Captions are drawn
// live by the same engine as the editor, so every clip shows a real template.
import { chunkWords } from '../engine/chunk.js';
import { ensureFonts } from '../engine/fonts.js';
import { CaptionEngine, SvgRenderer } from '../engine/index.js';
import { fitsCaption, fontsFor } from '../engine/layout.js';
import { templateById } from '../templates/library.js';
import { set, state } from './store.js';
import { h } from './ui.js';

// Clips are small on screen, so type is drawn larger than on a full-size video.
const CARD_SCALE = 1.55;
const SIZE_KEYS = ['size', 'letterSpacing', 'outline', 'shadowX', 'shadowY', 'shadowBlur', 'glow', 'bgRadius', 'bgPadX', 'bgPadY'];
// Styles the hero phone cycles through, one per loop of the clip.
const HERO_STYLES = ['hormozi', 'karaoke', 'popstar', 'aurora', 'neon', 'magazine'];

let cards = null;
let raf = 0;
let active = false;
const players = [];

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const loadCards = async () => (cards ||= await fetch('showcase/showcase.json').then((r) => r.json()).catch(() => []));

export function stopShowcase() {
  active = false;
  cancelAnimationFrame(raf);
  for (const p of players) { p.video.pause(); p.observer?.disconnect(); }
  players.length = 0;
}

function startLoop() {
  if (active) return;
  active = true;
  const draw = () => {
    if (!active) return;
    for (const p of players) {
      if (!p.ready || !p.visible || p.video.paused) continue;
      const t = p.video.currentTime;
      if (p.onLoop && t + 0.05 < p.lastT) p.onLoop();
      p.lastT = t;
      p.renderer.render(p.engine.scenesAt(t), t);
    }
    raf = requestAnimationFrame(draw);
  };
  draw();
}

// A looping clip with live captions in the given template.
function livePlayer(c, templateId, { className = '', onLoop, scale = CARD_SCALE } = {}) {
  const video = h('video', { poster: c.poster, muted: true, loop: true, playsinline: true, preload: 'metadata', 'aria-hidden': 'true' },
    h('source', { src: c.video, type: 'video/mp4' }), c.webm ? h('source', { src: c.webm, type: 'video/webm' }) : null);
  video.muted = true;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'live-captions');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('aria-hidden', 'true');
  const renderer = new SvgRenderer(svg);
  renderer.setSize(c.width, c.height);
  const p = { video, renderer, engine: new CaptionEngine(), ready: false, visible: false, lastT: 0, onLoop };
  p.setTemplate = async (id) => {
    const tpl = templateById(id);
    if (!tpl) return;
    const style = { ...tpl.style };
    for (const k of SIZE_KEYS) style[k] = (style[k] || 0) * scale;
    await ensureFonts(fontsFor([{ words: c.words }], style));
    const captions = chunkWords(c.words, style, (ws) => fitsCaption(ws, style, c.width, c.height));
    await p.engine.set({ captions, style, W: c.width, H: c.height });
    renderer.clear();
    p.ready = true;
    if (reduceMotion()) { video.currentTime = Math.min(2.2, c.duration / 2); renderer.render(p.engine.scenesAt(2.2), 2.2); }
  };
  p.setTemplate(templateId);
  // only clips on screen play, so the page stays light
  p.observer = new IntersectionObserver(([entry]) => {
    p.visible = entry.isIntersecting;
    if (p.visible && !reduceMotion()) video.play().catch(() => {});
    else video.pause();
  }, { threshold: 0.2 });
  p.observer.observe(video);
  players.push(p);
  startLoop();
  return { p, el: h('span', { class: `live ${className}` }, video, svg) };
}

// The hero phone: one clip whose caption style changes on every loop.
export function heroPhone() {
  const label = h('span', { class: 'phone-style' });
  const screen = h('div', { class: 'phone-screen' });
  (async () => {
    const all = await loadCards();
    const c = all.find((x) => x.id === 'spotlight') || all[0];
    if (!c) return;
    let k = 0;
    const show = () => { label.textContent = templateById(HERO_STYLES[k])?.name || ''; };
    const { p, el } = livePlayer(c, HERO_STYLES[0], {
      scale: 1.2,
      onLoop: () => { k = (k + 1) % HERO_STYLES.length; show(); p.setTemplate(HERO_STYLES[k]); },
    });
    show();
    screen.replaceChildren(el);
  })();
  return h('div', { class: 'phone', 'aria-hidden': 'true' },
    h('span', { class: 'phone-notch' }), screen, label);
}

// The row of styles to start with; clicking one makes it the starting style.
export function showcase(onPick) {
  const row = h('div', { class: 'looks-row', role: 'list' });
  (async () => {
    const all = await loadCards();
    row.replaceChildren(...all.map((c) => card(c, row, onPick)).filter(Boolean));
  })();
  return row;
}

function card(c, row, onPick) {
  const tpl = templateById(c.template);
  if (!tpl) return null;
  const { el: live } = livePlayer(c, tpl.id);
  const selected = () => state.templateId === tpl.id;
  const el = h('button', { class: 'look', type: 'button', role: 'listitem', 'data-template': tpl.id,
    'aria-pressed': String(selected()), 'aria-label': `${tpl.name} style, ${c.language}`,
    onclick: () => {
      set({ templateId: tpl.id, style: { ...tpl.style } });
      row.querySelectorAll('.look').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === el));
        b.querySelector('small').textContent = b === el ? 'Selected' : 'Use this style';
      });
      onPick?.(tpl);
    } },
  h('span', { class: 'look-screen' }, live, h('span', { class: 'look-lang' }, c.language)),
  h('span', { class: 'look-name' }, tpl.name, h('small', {}, selected() ? 'Selected' : 'Use this style')));
  return el;
}
