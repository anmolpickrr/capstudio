// Demo: example videos with prepared (not generated) captions, to explore and
// compare styles before using your own video. Kept apart from your projects;
// "Open in Studio" starts a separate, clearly labelled example project.
import { chunkWords } from '../engine/chunk.js';
import { ensureFonts } from '../engine/fonts.js';
import { CaptionEngine, SvgRenderer } from '../engine/index.js';
import { fitsCaption, fontsFor } from '../engine/layout.js';
import { CATEGORIES, TEMPLATES, templateById } from '../templates/library.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { openDemoProject } from './session.js';
import { h, toast } from './ui.js';

let demos = null;
let current = null;      // { demo, words }
let styleId = null;
let compare = false;
let compareIds = ['hormozi', 'magazine', 'karaoke', 'neon'];
let video = null, raf = 0, alive = false;
const players = [];      // { engine, renderer, canvas?, templateId }

export function stopDemo() {
  alive = false;
  cancelAnimationFrame(raf);
  video?.pause();
}

export async function renderDemo(view, id) {
  alive = true;
  demos ||= await api('/api/demo').catch(() => []);
  if (!demos.length) {
    view.replaceChildren(h('div', { class: 'demo-inner' }, h('p', { class: 'empty-results' }, 'No examples are available right now.')));
    return;
  }
  const demo = demos.find((d) => d.id === id) || demos[0];
  if (current?.demo.id !== demo.id) {
    const caps = await (await fetch(demo.captions)).json();
    current = { demo, words: caps.words, language: caps.language };
    styleId = demo.template;
  }
  view.replaceChildren(h('div', { class: 'demo-inner' },
    h('div', { class: 'demo-hero' },
      h('div', {}, h('h1', {}, 'Explore caption styles'),
        h('p', {}, 'Try every style on example videos and compare them side by side. The captions here were prepared for the demo — upload your own video in the Studio to have captions generated for it.')),
      h('a', { class: 'btn brand lg', href: '#/studio', html: `${icon('upload')}<span>Use my own video</span>` })),
    h('div', { class: 'demo-grid' }, demos.map((d) => h('a', {
      class: 'demo-card', href: `#/demo/${d.id}`, 'aria-pressed': String(d.id === demo.id), style: { textDecoration: 'none', color: 'inherit' },
    }, h('div', { class: 'poster', style: { backgroundImage: `url(${d.poster})` } }, h('span', { class: 'tag' }, 'Example')),
    h('div', { class: 'body' }, h('b', {}, d.title), h('small', {}, `${d.subtitle} · ${Math.round(d.info.duration)}s`))))),
    player(demo)));
  await setupPlayers();
}

function player(demo) {
  video = h('video', { src: demo.video, playsinline: true, preload: 'auto', crossorigin: 'anonymous', loop: true,
    style: { width: '100%', height: '100%', display: 'block', background: '#000', objectFit: 'contain' } });
  const playBtn = h('button', { class: 'play', 'aria-label': 'Play or pause', html: icon('play'),
    onclick: () => { if (video.paused) video.play().catch(() => {}); else video.pause(); } });
  const scrub = h('input', { type: 'range', class: 'range', min: 0, max: demo.info.duration, step: 0.01, value: 0, 'aria-label': 'Position' });
  scrub.addEventListener('input', () => { video.currentTime = Number(scrub.value); });
  video.addEventListener('play', () => { playBtn.innerHTML = icon('pause'); });
  video.addEventListener('pause', () => { playBtn.innerHTML = icon('play'); });
  video.addEventListener('timeupdate', () => {
    scrub.value = video.currentTime;
    scrub.style.setProperty('--fill', `${(video.currentTime / demo.info.duration) * 100}%`);
  });
  const transport = h('div', { class: 'transport', style: { padding: '4px 2px 0' } }, playBtn, scrub);
  const ar = demo.info.width / demo.info.height;
  const single = h('div', { class: 'frame', style: { aspectRatio: `${demo.info.width} / ${demo.info.height}`, width: `min(100%, calc(54vh * ${ar.toFixed(4)}))`, margin: '0 auto' } });
  const area = h('div', { id: 'demo-area' });
  const styleSel = h('select', { class: 'select', 'aria-label': 'Caption style' },
    CATEGORIES.map((c) => h('optgroup', { label: c.name }, TEMPLATES.filter((t) => t.category === c.id).map((t) => h('option', { value: t.id }, t.name)))));
  styleSel.value = styleId;
  styleSel.addEventListener('change', () => { styleId = styleSel.value; setupPlayers(); });
  const cmp = h('label', { class: 'switch' }, h('span', {}, 'Compare 4 styles'), (() => {
    const i = h('input', { type: 'checkbox', role: 'switch', checked: compare ? true : null });
    i.addEventListener('change', () => { compare = i.checked; renderArea(); setupPlayers(); });
    return i;
  })());
  const side = h('div', { class: 'demo-side' },
    h('div', { class: 'note info' }, 'Example video with prepared captions. Nothing you do here changes your own projects.'),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Style'), styleSel),
    cmp,
    h('div', { id: 'compare-pickers', style: { display: 'grid', gap: '8px' } }),
    h('button', { class: 'btn primary', type: 'button', html: `${icon('wand')}<span>Customise this example in the Studio</span>`,
      onclick: async () => {
        stopDemo();
        location.hash = '#/studio';
        const tpl = templateById(compare ? compareIds[0] : styleId);
        await openDemoProject({ ...demo, template: tpl?.id });
        if (tpl) {
          const { state, emit } = await import('./store.js');
          state.templateId = tpl.id; state.style = { ...tpl.style }; emit('style');
        }
      } }),
    h('p', { class: 'hint' }, 'You can edit and export the example to see the full workflow; it’s labelled “Example” throughout.'));
  const root = h('div', { class: 'demo-player' }, h('div', { class: 'demo-stage' }, area), side);
  function renderArea() {
    if (compare) {
      // one decoder feeds all four previews; the video itself stays hidden
      video.style.display = 'none';
      area.replaceChildren(h('div', { class: 'compare', id: 'compare-grid' }), video, transport);
    } else {
      video.style.display = 'block';
      single.replaceChildren(video);
      area.replaceChildren(single, transport);
    }
    const pickers = document.getElementById('compare-pickers');
    if (pickers) {
      pickers.replaceChildren(...(compare ? compareIds.map((id, k) => {
        const s = h('select', { class: 'select', 'aria-label': `Style ${k + 1}` },
          TEMPLATES.map((t) => h('option', { value: t.id }, `${k + 1}. ${t.name}`)));
        s.value = id;
        s.addEventListener('change', () => { compareIds[k] = s.value; setupPlayers(); });
        return s;
      }) : []));
    }
    styleSel.disabled = compare;
  }
  queueMicrotask(renderArea);
  return root;
}

async function setupPlayers() {
  if (!current || !alive) return;
  cancelAnimationFrame(raf);
  players.length = 0;
  const { demo, words } = current;
  const W = demo.info.width, H = demo.info.height;
  const ids = compare ? compareIds : [styleId];
  for (const id of ids) {
    const tpl = templateById(id);
    await ensureFonts(fontsFor([{ words }], tpl.style));
    const captions = chunkWords(words, tpl.style, (ws) => fitsCaption(ws, tpl.style, W, H));
    const engine = new CaptionEngine();
    await engine.set({ captions, style: tpl.style, W, H });
    players.push({ engine, templateId: id, name: tpl.name });
  }
  const svgFor = (p) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'overlay');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    p.renderer = new SvgRenderer(svg);
    p.renderer.setSize(W, H);
    return svg;
  };
  if (compare) {
    const grid = document.getElementById('compare-grid');
    grid?.replaceChildren(...players.map((p) => {
      p.canvas = h('canvas', { width: Math.round(W / 3), height: Math.round(H / 3) });
      return h('div', { class: 'cell' }, p.canvas, svgFor(p), h('span', { class: 'tag' }, p.name));
    }));
  } else {
    const frame = video.parentElement;
    frame.querySelectorAll('svg.overlay').forEach((s) => s.remove());
    const svg = svgFor(players[0]);
    svg.style.pointerEvents = 'none';
    frame.append(svg);
  }
  const draw = () => {
    if (!alive) return;
    const t = video.currentTime;
    for (const p of players) {
      if (p.canvas) {
        try { p.canvas.getContext('2d').drawImage(video, 0, 0, p.canvas.width, p.canvas.height); } catch { /* not ready */ }
      }
      p.renderer.render(p.engine.scenesAt(t), t);
    }
    raf = requestAnimationFrame(draw);
  };
  draw();
}

export { toast };
