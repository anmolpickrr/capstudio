// The looks on the first page: short looping clips, each with a different
// template drawn live by the same engine as the editor. Clicking one makes it
// the starting style for the next upload.
import { chunkWords } from '../engine/chunk.js';
import { ensureFonts } from '../engine/fonts.js';
import { CaptionEngine, SvgRenderer } from '../engine/index.js';
import { fitsCaption, fontsFor } from '../engine/layout.js';
import { templateById } from '../templates/library.js';
import { set, state } from './store.js';
import { h } from './ui.js';

const CARD_SCALE = 1.55;
const SIZE_KEYS = ['size', 'letterSpacing', 'outline', 'shadowX', 'shadowY', 'shadowBlur', 'glow', 'bgRadius', 'bgPadX', 'bgPadY'];

let cards = null;
let raf = 0;
let active = false;
const players = [];

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function stopShowcase() {
  active = false;
  cancelAnimationFrame(raf);
  for (const p of players) { p.video.pause(); p.observer?.disconnect(); }
  players.length = 0;
}

export function showcase(onPick) {
  stopShowcase();
  active = true;
  const row = h('div', { class: 'looks-row', role: 'list' });
  (async () => {
    cards ||= await fetch('showcase/showcase.json').then((r) => r.json()).catch(() => []);
    if (!active) return;
    row.replaceChildren(...cards.map((c) => card(c, row, onPick)).filter(Boolean));
    draw();
  })();
  return row;
}

function card(c, row, onPick) {
  const tpl = templateById(c.template);
  if (!tpl) return null;
  // Cards are small, so the type is drawn larger than on a full-size video to stay readable.
  const style = { ...tpl.style };
  for (const k of SIZE_KEYS) style[k] = (style[k] || 0) * CARD_SCALE;
  const video = h('video', { poster: c.poster, muted: true, loop: true, playsinline: true,
    preload: 'metadata', 'aria-hidden': 'true' },
  h('source', { src: c.video, type: 'video/mp4' }), c.webm ? h('source', { src: c.webm, type: 'video/webm' }) : null);
  video.muted = true;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'look-captions');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('aria-hidden', 'true');
  const renderer = new SvgRenderer(svg);
  renderer.setSize(c.width, c.height);
  const engine = new CaptionEngine();
  const p = { video, renderer, engine, ready: false, visible: false };
  players.push(p);

  (async () => {
    await ensureFonts(fontsFor([{ words: c.words }], style));
    const captions = chunkWords(c.words, style, (ws) => fitsCaption(ws, style, c.width, c.height));
    await engine.set({ captions, style, W: c.width, H: c.height });
    p.ready = true;
    if (reduceMotion()) { video.currentTime = Math.min(2.2, c.duration / 2); renderer.render(engine.scenesAt(2.2), 2.2); }
  })();

  // Only clips on screen play, so the page stays light.
  p.observer = new IntersectionObserver(([entry]) => {
    p.visible = entry.isIntersecting;
    if (p.visible && !reduceMotion()) video.play().catch(() => {});
    else video.pause();
  }, { threshold: 0.25 });
  p.observer.observe(video);

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
  h('span', { class: 'look-screen' }, video, svg, h('span', { class: 'look-lang' }, c.language)),
  h('span', { class: 'look-name' }, tpl.name, h('small', {}, selected() ? 'Selected' : 'Use this style')));
  return el;
}

function draw() {
  if (!active) return;
  for (const p of players) {
    if (p.ready && p.visible && !p.video.paused) p.renderer.render(p.engine.scenesAt(p.video.currentTime), p.video.currentTime);
  }
  raf = requestAnimationFrame(draw);
}
