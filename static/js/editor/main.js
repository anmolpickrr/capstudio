// The Capstudio editor: a multi-track video editor in the browser. Start screen
// (new project or a recent one), then the workspace: library, viewer, inspector
// and timeline. Projects and their media are saved in this browser as you work.
import { api } from '../app/api.js';
import { icon } from '../app/icons.js';
import { $, fmtTime, h, toast } from '../app/ui.js';
import { setCatalogue } from '../engine/fonts.js';
import { addAsset, addShape, addText, copySelection, deleteSelection, duplicateSelection, paste, SHAPES, splitAtPlayhead, TEXT_PRESETS } from './actions.js';
import { captionsPanel, fromCapstudio, setConfig } from './captions.js';
import { canExport, exportProject } from './export.js';
import { mountInspector } from './inspector.js';
import { mountLibrary } from './library.js';
import { clipById, duration, end, newProject, PRESETS } from './model.js';
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

async function startScreen() {
  history.replaceState(null, '', '/edit');
  const recent = await listProjects();
  const presets = h('div', { class: 'es-presets' }, PRESETS.map((pr) => h('button', { class: 'es-preset', type: 'button', onclick: () => create(pr.id) },
    h('i', { style: { aspectRatio: `${pr.W} / ${pr.H}` } }), h('b', {}, pr.label), h('small', {}, pr.note))));
  const list = h('div', { class: 'es-recent' }, recent.map((r) => h('div', { class: 'es-item' },
    h('button', { class: 'es-open', type: 'button', onclick: () => openWorkspace(r) },
      r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('span', { class: 'es-ph', html: icon('editor') }),
      h('span', {}, h('b', {}, r.name), h('small', {}, `${r.W}×${r.H} · ${fmtTime(Math.max(0, ...r.clips.map(end)), 0)} · ${new Date(r.savedAt).toLocaleString()}`))),
    h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': `Delete ${r.name}`, html: icon('trash'), onclick: async () => {
      if (!confirm(`Delete “${r.name}” and its media from this browser?`)) return;
      await deleteProject(r.id); startScreen();
    } }))));
  view.className = 'ed-start';
  view.replaceChildren(h('div', { class: 'es-card' },
    h('div', { class: 'es-head' },
      h('a', { class: 'btn ghost sm', href: '/', html: `${icon('arrowLeft')}<span>Capstudio</span>` }),
      h('span', { class: 'kicker' }, 'Capstudio Editor')),
    h('h1', {}, 'Edit a video'),
    h('p', { class: 'es-lead' }, 'Cut, layer, animate with keyframes, add transitions, colour, text, music and captions, then export in your browser. Pick a shape to start:'),
    presets,
    recent.length ? h('h2', {}, 'Recent projects') : null, recent.length ? list : null,
    h('p', { class: 'hint' }, 'Projects and their media are saved in this browser as you work. Works best in Chrome or Edge on a computer.')));
}

function create(preset) {
  const p = newProject({ preset });
  openWorkspace(p);
  saveNow();
}

async function fromCapstudioProject(id) {
  const p = newProject({ preset: '9x16', name: 'From Capstudio' });
  openWorkspace(p);
  try {
    const r = await fromCapstudio(id);
    const a = r.videoClip && ed.project.assets[r.videoClip.asset];
    if (a?.width) edit((x) => { x.W = Math.round(a.width / 2) * 2; x.H = Math.round(a.height / 2) * 2; x.fps = Math.round(a.fps) || 30; x.name = a.name.replace(/\.[^.]*$/, ''); });
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
    h('a', { class: 'btn ghost sm', href: '/edit', 'data-tip': 'All projects', html: `${icon('arrowLeft')}<span>Projects</span>`,
      onclick: async (e) => { e.preventDefault(); await saveNow(); player?.destroy(); player = null; startScreen(); } }),
    h('span', { class: 'ed-logo', html: `${icon('editor')}<b>Editor</b>` }),
    name, saved,
    h('span', { class: 'grow' }),
    undoBtn, redoBtn,
    h('a', { class: 'btn ghost sm', href: '/', html: `${icon('captions')}<span>Capstudio</span>`, 'data-tip': 'Caption a single video' }),
    h('button', { class: 'btn brand', type: 'button', html: `${icon('export')}<span>Export</span>`, onclick: openExport }));
  view.replaceChildren(top, h('div', { class: 'ed-main' }, libEl, viewerEl, insEl), resizer, tlEl);

  player = new Player(canvas);
  setThumbSource(() => thumbOf(canvas));
  openProject(p);
  library = mountLibrary(libEl, { captionsPanel });
  mountViewer(viewerEl, player);
  mountInspector(insEl);
  const tl = mountTimeline(tlEl, {
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

addEventListener('dragover', (e) => { if (ed.project && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); view.classList.add('dropping'); } });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) view.classList.remove('dropping'); });
addEventListener('drop', async (e) => {
  view.classList.remove('dropping');
  if (!ed.project || !e.dataTransfer.files.length) return;
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
