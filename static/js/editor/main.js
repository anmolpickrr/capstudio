// The Capstudio editor: a multi-track video editor in the browser. Start screen
// (new project or a recent one), then the workspace: library, viewer, inspector
// and timeline. Projects and their media are saved in this browser as you work.
import { api } from '../app/api.js';
import { icon } from '../app/icons.js';
import { $, fmtTime, h, toast } from '../app/ui.js';
import { appSwitch, goTo } from '../app/appswitch.js';
import { LOGO } from '../app/logo.js';
import { ensureFonts, fontById, setCatalogue } from '../engine/fonts.js';
import { addAsset, addShape, addText, copySelection, deleteSelection, duplicateSelection, paste, SHAPES, splitAtPlayhead, TEXT_PRESETS } from './actions.js';
import { captionsPanel, fromCapstudio, setConfig, syncFromCapstudio } from './captions.js';
import { canExport, exportProject } from './export.js';
import { mountInspector } from './inspector.js';
import { mountLibrary } from './library.js';
import { clipById, duration, end, newProject } from './model.js';
import { drawFrame, clearTextCache } from './render.js';
import { BACKGROUNDS, evenSize, FORMATS, FPS, starterById, STARTERS } from './starters.js';
import { Player } from './player.js';
import { canRedo, canUndo, deleteProject, ed, edit, emit, listProjects, loadProject, on, openProject, redo, saveNow, select, setPlayhead, setThumbSource, undo } from './store.js';
import { mountTimeline } from './timeline.js';
import { mountViewer } from './viewer.js';

const view = $('#editor');
let player = null, library = null;

async function boot() {
  const [config, fonts] = await Promise.all([api('/api/config'), api('/api/fonts')]);
  setCatalogue(fonts, '/fonts/');
  setConfig(config);
  const params = new URLSearchParams(location.search);
  if (params.get('project')) {
    const p = await loadProject(params.get('project'));
    if (p) return openWorkspace(p);
  }
  if (params.get('capstudio')) return fromCapstudioProject(params.get('capstudio'));
  startScreen();
}

// ---------------------------------------------------------------- start screen

// What the next project starts as: the canvas (format or custom size), frame rate,
// background, and a starter layout. Remembered for next time.
const SETUP_KEY = 'capstudio-editor-setup';
const setup = (() => {
  const d = { format: '9x16', W: 1080, H: 1920, fps: 30, bg: null, starter: 'blank' };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SETUP_KEY) || '{}') }; } catch { return d; }
})();
const keepSetup = () => { try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch { /* private mode */ } };
const canvasSize = () => {
  const f = FORMATS.find((x) => x.id === setup.format) || FORMATS[0];
  return f.id === 'custom' ? { W: evenSize(setup.W, 1080), H: evenSize(setup.H, 1080) } : { W: f.W, H: f.H };
};
const bgOf = () => setup.bg || starterById(setup.starter).bg || '#000000';

// The project the screen would create (also what the previews draw).
function draftProject(name = 'Untitled video') {
  const { W, H } = canvasSize();
  const p = newProject({ name, W, H, fps: setup.fps });
  p.bg = bgOf();
  starterById(setup.starter).build(p);
  return p;
}

let previews = [];
function stopPreviews() { for (const pv of previews) pv.stop(); previews = []; }

// A starter's first seconds drawn by the editor's own compositor; it plays on hover.
function starterPreview(starter) {
  const cv = h('canvas', { class: 'es-tpl-canvas' });
  const ctx = cv.getContext('2d');
  let raf = 0, p = null, t0 = 0;
  const still = 1.4;
  const draw = (t) => {
    if (!p) return;
    const k = cv.width / p.W;
    drawFrame(ctx, p, t, {}, k);
  };
  const pv = {
    refresh() {
      const { W, H } = canvasSize();
      p = newProject({ W, H });
      p.bg = setup.bg || starter.bg || '#000000';
      starter.build(p);
      // fit the card's stage (about 132 × 180), drawn at twice that for sharpness
      const k = Math.min(132 / W, 180 / H);
      cv.style.width = `${Math.round(W * k)}px`; cv.style.height = `${Math.round(H * k)}px`;
      cv.width = Math.max(2, Math.round(W * k * 2)); cv.height = Math.max(2, Math.round(H * k * 2));
      const fonts = p.clips.filter((c) => c.type === 'text').map((c) => fontById(c.text.font));
      // draw once the fonts are in (text drawn with a stand-in font would be kept)
      ensureFonts(fonts).then((fresh) => { if (fresh) clearTextCache(); draw(still); });
    },
    play() {
      cancelAnimationFrame(raf);
      t0 = performance.now();
      const loop = (now) => { draw(((now - t0) / 1000) % 4); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    },
    pause() { cancelAnimationFrame(raf); draw(still); },
    stop() { cancelAnimationFrame(raf); },
  };
  pv.refresh();
  previews.push(pv);
  return { cv, pv };
}

async function startScreen() {
  history.replaceState(null, '', '/edit');
  stopPreviews();
  const recent = await listProjects();
  const paintAll = [];
  const repaint = () => { keepSetup(); paintAll.forEach((f) => f()); };

  // canvas: one row of formats (the shape, its ratio and what it's for)
  const glyph = (f) => {
    if (f.id === 'custom') return h('i', { class: 'custom' });
    const big = 22, k = big / Math.max(f.W, f.H);
    return h('i', { style: { width: `${Math.round(f.W * k)}px`, height: `${Math.round(f.H * k)}px` } });
  };
  const formats = h('div', { class: 'es-formats', role: 'radiogroup', 'aria-label': 'Canvas' }, FORMATS.map((f) => {
    const b = h('button', { type: 'button', class: 'es-format', role: 'radio', 'data-id': f.id, title: f.note,
      onclick: () => { setup.format = f.id; repaint(); if (f.id === 'custom') customW.select(); } },
    h('span', { class: 'es-format-shape' }, glyph(f)),
    h('b', {}, f.label),
    h('small', {}, f.ratio || 'Any size'));
    paintAll.push(() => b.setAttribute('aria-checked', String(setup.format === f.id)));
    return b;
  }));

  // the canvas's settings, in one quiet strip: size (typing makes it custom), frame rate, background
  const num = (key, label) => {
    const i = h('input', { class: 'es-num', type: 'number', min: 64, max: 7680, step: 2, inputmode: 'numeric', 'aria-label': label });
    i.addEventListener('focus', () => { if (setup.format !== 'custom') { const { W, H } = canvasSize(); setup.W = W; setup.H = H; setup.format = 'custom'; repaint(); } });
    i.addEventListener('change', () => { setup[key] = evenSize(i.value, setup[key]); repaint(); });
    paintAll.push(() => { if (document.activeElement !== i) i.value = canvasSize()[key]; });
    return i;
  };
  const customW = num('W', 'Width in pixels'), customH = num('H', 'Height in pixels');
  const swap = h('button', { class: 'es-icon-btn', type: 'button', 'aria-label': 'Swap width and height', 'data-tip': 'Swap width and height', html: icon('ripple'),
    onclick: () => { const { W, H } = canvasSize(); Object.assign(setup, { format: 'custom', W: H, H: W }); repaint(); } });
  const fps = h('div', { class: 'es-seg', role: 'group', 'aria-label': 'Frame rate' }, FPS.map((v) => {
    const b = h('button', { type: 'button', onclick: () => { setup.fps = v; repaint(); } }, String(v));
    paintAll.push(() => b.setAttribute('aria-pressed', String(setup.fps === v)));
    return b;
  }));
  const bgs = h('div', { class: 'es-swatches', role: 'group', 'aria-label': 'Background colour' },
    (() => {
      const b = h('button', { type: 'button', class: 'es-swatch auto', 'aria-label': 'Each layout’s own background', 'data-tip': 'Each layout’s own', onclick: () => { setup.bg = null; repaint(); } });
      paintAll.push(() => b.setAttribute('aria-pressed', String(!setup.bg)));
      return b;
    })(),
    BACKGROUNDS.map((c) => {
      const b = h('button', { type: 'button', class: 'es-swatch', style: { background: c }, 'aria-label': `Background ${c}`, onclick: () => { setup.bg = c; repaint(); } });
      paintAll.push(() => b.setAttribute('aria-pressed', String((setup.bg || '').toLowerCase() === c.toLowerCase())));
      return b;
    }),
    (() => {
      const i = h('input', { type: 'color', class: 'es-swatch custom', 'aria-label': 'Any background colour', 'data-tip': 'Any colour' });
      i.addEventListener('input', () => { setup.bg = i.value; repaint(); });
      paintAll.push(() => { i.value = bgOf().length === 7 ? bgOf() : '#000000'; });
      return i;
    })());
  const field = (label, ...kids) => h('div', { class: 'es-field' }, h('span', { class: 'es-field-label' }, label), ...kids);
  const settings = h('div', { class: 'es-settings' },
    field('Size', h('div', { class: 'es-size' }, customW, h('span', { class: 'es-x' }, '×'), customH, h('span', { class: 'es-unit' }, 'px'), swap)),
    field('Frame rate', fps, h('span', { class: 'es-unit' }, 'fps')),
    field('Background', bgs));

  // starting points: one click creates the project
  const tpls = h('div', { class: 'es-tpls' }, STARTERS.map((st) => {
    const { cv, pv } = starterPreview(st);
    const blank = st.id === 'blank';
    const b = h('button', { type: 'button', class: `es-tpl${blank ? ' blank' : ''}`, 'data-id': st.id, 'aria-label': `New project: ${st.name}`,
      onclick: () => { setup.starter = st.id; keepSetup(); create(); },
      onmouseenter: () => pv.play(), onmouseleave: () => pv.pause(), onfocus: () => pv.play(), onblur: () => pv.pause() },
    h('span', { class: 'es-tpl-stage' }, cv, blank ? h('span', { class: 'es-tpl-blank', html: icon('plus') }) : null,
      h('span', { class: 'es-tpl-cta' }, blank ? 'Create blank' : 'Use layout')),
    h('span', { class: 'es-tpl-text' }, h('b', {}, st.name), h('small', {}, st.note)));
    paintAll.push(() => pv.refresh());
    return b;
  }));
  const tplMeta = h('span', { class: 'es-sec-hint' }, 'Click one to create the project · hover to preview');

  const picker = h('input', { type: 'file', accept: 'video/*,image/*,audio/*,.mov,.mkv', multiple: true, hidden: true, class: 'es-picker' });
  picker.addEventListener('change', () => { const files = [...picker.files]; picker.value = ''; if (files.length) fromFiles(files); });

  const recentGrid = h('div', { class: 'es-recent' }, recent.map((r) => {
    const dur = Math.max(0, ...r.clips.map(end));
    return h('div', { class: 'es-proj' },
      h('button', { class: 'es-proj-open', type: 'button', onclick: () => openWorkspace(r), 'aria-label': `Open ${r.name}` },
        h('span', { class: 'es-proj-thumb' },
          r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('span', { html: icon('editor') }),
          h('span', { class: 'es-proj-badge' }, `${r.W}×${r.H}`)),
        h('span', { class: 'es-proj-text' }, h('b', {}, r.name), h('small', {}, `${fmtTime(dur, 0)} · edited ${ago(r.savedAt)}`))),
      h('button', { class: 'es-icon-btn es-proj-del', type: 'button', 'aria-label': `Delete ${r.name}`, 'data-tip': 'Delete', html: icon('trash'), onclick: async () => {
        if (!confirm(`Delete “${r.name}” and its media from this browser?`)) return;
        await deleteProject(r.id); startScreen();
      } }));
  }));

  const section = (title, meta, ...kids) => h('section', { class: 'es-sec' },
    h('div', { class: 'es-sec-head' }, h('h2', {}, title), meta), ...kids);

  view.className = 'ed-start';
  view.replaceChildren(
    h('header', { class: 'es-top' },
      h('a', { class: 'brand es-brand', href: '/', 'aria-label': 'Capstudio home', html: LOGO }),
      appSwitch('editor', { captions: () => goTo('/') }),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn es-import', type: 'button', html: `${icon('upload')}<span>Import video</span>`, onclick: () => picker.click() }),
      picker),
    h('main', { class: 'es-wrap' },
      h('div', { class: 'es-title' },
        h('h1', {}, 'New project'),
        h('p', {}, 'Choose a canvas, then a starting point. Or drop a video anywhere here and the canvas matches it.')),
      section('Canvas', null, formats, settings),
      section('Start from', tplMeta, tpls),
      recent.length ? section('Recent', h('span', { class: 'es-sec-meta' }, `${recent.length} in this browser`), recentGrid) : null,
      h('p', { class: 'es-foot' }, 'Projects and their media are saved in this browser. Works best in Chrome or Edge on a computer.')));
  repaint();
  document.fonts?.ready.then(() => paintAll.forEach((f) => f()));
}

// a video dropped on the start screen starts a project from it
addEventListener('dragover', (e) => { if (view.classList.contains('ed-start') && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); view.classList.add('dropping'); } });
addEventListener('drop', (e) => {
  if (!view.classList.contains('ed-start') || !e.dataTransfer.files.length) return;
  e.preventDefault();
  view.classList.remove('dropping');
  fromFiles([...e.dataTransfer.files]);
});

const ago = (t) => {
  const m = Math.round((Date.now() - (t || 0)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  return hrs < 24 ? `${hrs} h ago` : new Date(t).toLocaleDateString();
};

function create() {
  stopPreviews();
  const p = draftProject();
  openWorkspace(p);
  saveNow();
}

// "Import a video": the canvas takes the first video's size and frame rate.
async function fromFiles(files) {
  stopPreviews();
  const p = newProject({ preset: '9x16', name: files[0].name.replace(/\.[^.]*$/, '') });
  openWorkspace(p);
  const added = await library.importInto(files);
  const v = added?.find((a) => a.kind === 'video' && a.width) || added?.find((a) => a.kind === 'image' && a.width);
  if (v) edit((x) => { x.W = Math.round(v.width / 2) * 2; x.H = Math.round(v.height / 2) * 2; if (v.fps) x.fps = Math.round(v.fps); });
  let at = 0;
  for (const a of added || []) { if (a.kind === 'audio') addAsset(a, 0); else { const c = addAsset(a, at); at = end(c); } }
  select([]);
  requestAnimationFrame(() => window.__editorTimeline?.fit());
  saveNow();
}

// From Capstudio: reopen the edit made from this captioned video (its captions
// brought up to date), or start one with the video and captions on the timeline.
async function fromCapstudioProject(id) {
  const earlier = (await listProjects()).find((r) => r.source === id);
  if (earlier) {
    openWorkspace(earlier);
    try {
      if (await syncFromCapstudio(id)) toast('Your edit is open, with the latest captions from Capstudio.', 'ok', 4000);
      else toast('Your edit of this video is open.', 'ok', 2500);
    } catch (e) { toast(e.message, 'error', 7000); }
    return;
  }
  const p = newProject({ preset: '9x16', name: 'From Capstudio' });
  openWorkspace(p);
  try {
    const r = await fromCapstudio(id);
    const a = r.videoClip && ed.project.assets[r.videoClip.asset];
    if (a?.width) edit((x) => { x.W = Math.round(a.width / 2) * 2; x.H = Math.round(a.height / 2) * 2; x.fps = Math.round(a.fps) || 30; x.name = a.name.replace(/\.[^.]*$/, ''); });
    select([]);
    requestAnimationFrame(() => window.__editorTimeline?.fit());
    saveNow();
    toast('Your video and its captions are on the timeline.', 'ok', 4000);
  } catch (e) { toast(e.message, 'error', 7000); }
}

// ---------------------------------------------------------------- workspace

function openWorkspace(p) {
  player?.destroy();
  history.replaceState(null, '', `/edit?project=${p.id}`);
  view.className = 'ed-app';
  const canvas = h('canvas', { class: 'vw-canvas' });
  const libEl = h('aside', { class: 'ed-lib' });
  const viewerEl = h('section', { class: 'ed-viewer' });
  const insEl = h('aside', { class: 'ed-ins' });
  const tlEl = h('section', { class: 'ed-tl' });
  const resizer = h('div', { class: 'ed-resize', role: 'separator', 'aria-label': 'Resize the timeline' });
  const name = h('input', { class: 'ed-name', 'aria-label': 'Project name', spellcheck: 'false' });
  name.addEventListener('change', () => edit((x) => { x.name = name.value.trim() || 'Untitled video'; }));
  const saved = h('span', { class: 'ed-saved' });
  const undoBtn = h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Undo (Ctrl+Z)', 'data-tip': 'Undo (Ctrl+Z)', html: icon('undo'), onclick: undo });
  const redoBtn = h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Redo (Ctrl+Shift+Z)', 'data-tip': 'Redo (Ctrl+Shift+Z)', html: icon('redo'), onclick: redo });
  const top = h('header', { class: 'ed-top' },
    h('a', { class: 'btn ghost sm icon-only', href: '/edit', 'aria-label': 'All projects', 'data-tip': 'All projects', 'data-tip-pos': 'below', html: icon('arrowLeft'),
      onclick: async (e) => { e.preventDefault(); await saveNow(); player?.destroy(); player = null; startScreen(); } }),
    appSwitch('editor', { captions: toCaptions }),
    h('span', { class: 'ed-sep' }),
    h('div', { class: 'ed-title' }, name, saved),
    h('span', { class: 'grow' }),
    undoBtn, redoBtn,
    h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Keyboard shortcuts (?)', 'data-tip': 'Keyboard shortcuts (?)', 'data-tip-pos': 'below', html: icon('keyboard'), onclick: openShortcuts }),
    h('button', { class: 'btn brand', type: 'button', html: `${icon('export')}<span>Export</span>`, onclick: openExport }));
  view.replaceChildren(top, h('div', { class: 'ed-main' }, libEl, viewerEl, insEl), resizer, tlEl);

  player = new Player(canvas);
  setThumbSource(() => thumbOf(canvas));
  openProject(p);
  library = mountLibrary(libEl, { captionsPanel });
  mountViewer(viewerEl, player);
  mountInspector(insEl);
  const tl = window.__editorTimeline = mountTimeline(tlEl, {
    onDropAsset: dropped,
    onSplit: splitAtPlayhead,
    onDelete: (ripple) => deleteSelection(ripple || ed.ripple),
  });
  // timeline height by dragging the bar above it
  resizer.addEventListener('pointerdown', (e) => {
    const y0 = e.clientY, h0 = tlEl.getBoundingClientRect().height;
    const move = (ev) => { view.style.setProperty('--tl-h', `${Math.min(window.innerHeight * 0.7, Math.max(180, h0 - (ev.clientY - y0)))}px`); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  const paintTop = () => {
    if (document.activeElement !== name) name.value = ed.project.name;
    undoBtn.disabled = !canUndo(); redoBtn.disabled = !canRedo();
  };
  on((what) => {
    if (['project', 'open'].includes(what)) paintTop();
    if (what === 'saved') saved.textContent = 'Saved';
    if (what === 'save-failed') saved.textContent = 'Not saved: browser storage is full';
    if (what === 'project') saved.textContent = 'Saving…';
  });
  emit('open');
  paintTop();
  requestAnimationFrame(() => { if (ed.project.clips.length) tl.fit(); });
  window.__editor = { ed, edit, player, select, setPlayhead, clipById };
}

// Back to Captions: to the captioned video this edit came from, else the upload page.
async function toCaptions() {
  await saveNow();
  goTo(ed.project?.source ? `/?open=${encodeURIComponent(ed.project.source)}` : '/');
}

const SHORTCUTS = [
  ['Playback', [['Space', 'Play / pause'], ['J / K / L', 'Back a second / pause / play'], ['← →', 'One frame (Shift: one second)'], ['Home / End', 'Start / end']]],
  ['Editing', [['S', 'Split at the playhead'], ['Del', 'Delete'], ['Shift+Del', 'Delete and close the gap'], ['Ctrl+D', 'Duplicate'],
    ['Ctrl+C / V', 'Copy / paste at the playhead'], ['Ctrl+A', 'Select everything'], ['Ctrl+Z', 'Undo (Ctrl+Shift+Z: redo)']]],
  ['Timeline', [['V / C', 'Select / razor tool'], ['+ / −', 'Zoom in / out'], ['Ctrl+wheel', 'Zoom at the pointer'], ['Double-click a gap', 'Close the gap'], ['Right-click a clip', 'More actions']]],
];

function openShortcuts() {
  const dlg = $('#ed-dialog');
  if (dlg.open) { dlg.close(); return; }
  dlg.replaceChildren(h('div', { class: 'modal ed-keys' },
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, 'Keyboard shortcuts'), h('p', {}, 'On a Mac, use ⌘ for Ctrl.')),
      h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => dlg.close() })),
    h('div', { class: 'modal-body ed-keys-grid' }, SHORTCUTS.map(([title, rows]) => h('section', {},
      h('h3', {}, title),
      h('dl', {}, rows.flatMap(([k, d]) => [h('dt', {}, k.split(' / ').map((x, i) => [i ? ' / ' : null, h('kbd', {}, x)]).flat()), h('dd', {}, d)])))))));
  dlg.showModal();
}

function thumbOf(canvas) {
  if (!canvas.width) return null;
  const k = 160 / Math.max(canvas.width, canvas.height);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

function dropped(data, t, trackId) {
  if (data.kind === 'asset') { const a = ed.project.assets[data.id]; if (a) addAsset(a, t, trackId); }
  else if (data.kind === 'text') addText(TEXT_PRESETS.find((x) => x.id === data.id), t, trackId);
  else if (data.kind === 'shape') addShape(SHAPES.find((x) => x.id === data.id), t, trackId);
  else if (data.kind === 'transition') {
    const target = ed.project.clips.find((c) => c.track === trackId && c.start <= t && end(c) >= t && c.type !== 'audio' && c.type !== 'captions');
    if (!target) { toast('Drop the transition onto a video, image, text or shape clip.'); return; }
    edit((p) => { clipById(p, target.id).transIn = { type: data.id, dur: 0.5 }; });
    select([target.id]);
  }
}

// ---------------------------------------------------------------- files dropped anywhere

addEventListener('dragover', (e) => { if (ed.project && view.classList.contains('ed-app') && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); view.classList.add('dropping'); } });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) view.classList.remove('dropping'); });
addEventListener('drop', async (e) => {
  view.classList.remove('dropping');
  if (!ed.project || !view.classList.contains('ed-app') || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const added = await library.importInto([...e.dataTransfer.files]);
  // straight onto the timeline when dropped there
  if (added?.length && e.target.closest?.('.ed-tl')) {
    let at = ed.playhead;
    for (const a of added) { const c = addAsset(a, at); at = end(c); }
  }
});

// ---------------------------------------------------------------- keyboard

addEventListener('keydown', (e) => {
  if (!ed.project || !player) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]') && e.target.type !== 'range' && e.target.type !== 'checkbox';
  if (typing) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), frame = 1 / ed.project.fps;
  const done = () => e.preventDefault();
  if (k === ' ') { player.toggle(); done(); }
  else if (mod && k === 'z') { if (e.shiftKey) redo(); else undo(); done(); }
  else if (mod && k === 'y') { redo(); done(); }
  else if (mod && k === 'd') { duplicateSelection(); done(); }
  else if (mod && k === 'c') { copySelection(); done(); }
  else if (mod && k === 'v') { paste(); done(); }
  else if (mod && k === 'a') { select(ed.project.clips.map((c) => c.id)); done(); }
  else if (mod && k === 'k') { splitAtPlayhead(); done(); }
  else if (mod && k === 's') { saveNow().then(() => toast('Saved in this browser.', 'ok', 1200)); done(); }
  else if (mod) return;
  else if (k === 's') splitAtPlayhead();
  else if (k === 'delete' || k === 'backspace') { deleteSelection(e.shiftKey || ed.ripple); done(); }
  else if (k === 'arrowleft') { setPlayhead(ed.playhead - (e.shiftKey ? 1 : frame)); done(); }
  else if (k === 'arrowright') { setPlayhead(ed.playhead + (e.shiftKey ? 1 : frame)); done(); }
  else if (k === 'home') setPlayhead(0);
  else if (k === 'end') setPlayhead(duration(ed.project));
  else if (k === 'v') { ed.tool = 'select'; emit('tool'); }
  else if (k === 'c') { ed.tool = 'razor'; emit('tool'); }
  else if (k === 'escape') { select([]); ed.tool = 'select'; emit('tool'); }
  else if (e.key === '?') { openShortcuts(); done(); }
  else if (k === '=' || k === '+') { ed.zoom = Math.min(600, ed.zoom * 1.4); emit('zoom'); }
  else if (k === '-') { ed.zoom = Math.max(4, ed.zoom / 1.4); emit('zoom'); }
  else if (k === 'j') setPlayhead(ed.playhead - 1);
  else if (k === 'k') player.pause();
  else if (k === 'l') player.play();
});

addEventListener('beforeunload', () => { if (ed.project) saveNow(); });

// ---------------------------------------------------------------- export

let exporting = null;
function openExport() {
  const dlg = $('#ed-dialog');
  if (!ed.project.clips.length) { toast('Add something to the timeline first.'); return; }
  player.pause();
  const p = ed.project;
  const q = h('div', { class: 'seg', role: 'group', 'aria-label': 'Quality' }, [['high', 'High'], ['max', 'Best'], ['small', 'Small file']].map(([v, t]) =>
    h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(v === 'high'), onclick: (e) => { q.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t)));
  const res = h('div', { class: 'seg', role: 'group', 'aria-label': 'Size' }, [[1, `${p.W}×${p.H}`], [0.5, `${Math.round(p.W / 2)}×${Math.round(p.H / 2)}`]].map(([v, t]) =>
    h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(v === 1), onclick: (e) => { res.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t)));
  const status = h('div', { id: 'ed-export-status' });
  const go = h('button', { class: 'btn brand lg', type: 'button', html: `${icon('export')}<span>Export video</span>`, onclick: run });
  dlg.replaceChildren(h('div', { class: 'modal' },
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, 'Export'), h('p', {}, `${p.name} · ${fmtTime(duration(p))} · ${p.fps} fps`)),
      h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => { exporting?.abort(); dlg.close(); } })),
    h('div', { class: 'modal-body' },
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Size'), res),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Quality'), q),
      canExport() ? h('p', { class: 'note info' }, 'Made on this computer, with its video hardware: nothing is uploaded. Keep this tab open until it’s done.')
        : h('p', { class: 'note' }, 'This browser can’t encode video. Open the editor in Chrome or Edge on a computer to export.'),
      status,
      h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, go))));
  dlg.showModal();

  async function run() {
    go.disabled = true;
    exporting = new AbortController();
    const bar = h('i'), msg = h('small', {}, 'Getting ready…');
    status.replaceChildren(h('div', { class: 'result' }, h('div', { class: 'result-row' }, h('b', {}, 'Exporting'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => exporting.abort() }, 'Cancel')), h('div', { class: 'progress' }, bar), msg));
    try {
      const r = await exportProject(ed.project, {
        quality: q.querySelector('[aria-pressed="true"]').dataset.v, scale: Number(res.querySelector('[aria-pressed="true"]').dataset.v), signal: exporting.signal,
        onProgress: (x, text, secs) => {
          bar.style.width = `${Math.round(x * 100)}%`;
          const left = secs && x > 0.03 ? ` · about ${Math.max(1, Math.round((secs / x) * (1 - x)))} s left` : '';
          msg.textContent = `${text || ''}${left}`;
        },
      });
      const url = URL.createObjectURL(r.blob);
      status.replaceChildren(h('div', { class: 'result ok' },
        h('div', { class: 'result-row' }, h('div', {}, h('b', {}, r.file), h('br'), h('small', {}, `${r.W}×${r.H} · ${(r.size / 1e6).toFixed(1)} MB · made in ${Math.round(r.elapsed)} s`)),
          h('a', { class: 'btn brand', href: url, download: r.file, html: `${icon('download')}<span>Download</span>` }))));
    } catch (e) {
      status.replaceChildren(h('p', { class: 'note' }, e.name === 'AbortError' ? 'Export cancelled.' : e.message));
    } finally {
      go.disabled = false;
      exporting = null;
    }
  }
}

boot().catch((e) => { view.replaceChildren(h('p', { class: 'note', style: { margin: '40px' } }, `The editor couldn’t start: ${e.message}`)); });
