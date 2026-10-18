// The Studio: the first page (upload and a showcase of looks), then the editor (tools on the
// left, the video in the middle, the timeline below).
import { icon } from './icons.js';
import { openExport } from './export.js';
import { setSeek } from './panels/captions.js';
import { PANELS, renderPanel } from './panels/index.js';
import { setReplay } from './panels/motion.js';
import { engine, leaveProject, startUpload, syncEngine } from './session.js';
import { Stage } from './stage.js';
import { canRedo, canUndo, redo, set, state, subscribe, undo } from './store.js';
import { Timeline } from './timeline.js';
import { showcase, stopShowcase } from './showcase.js';
import { templateById } from '../templates/library.js';
import { $, h, toast } from './ui.js';

let view = null;
let stage = null, timeline = null;
let unsub = null;
let mounted = null; // 'welcome' | 'editor'

export function renderStudio(el) {
  view = el;
  unsub?.();
  unsub = subscribe(onChange);
  mounted = null;
  layout();
}

function layout() {
  const want = state.project ? 'editor' : 'welcome';
  if (want === mounted) return;
  mounted = want;
  stopShowcase();
  stage?.destroy(); timeline?.destroy();
  stage = timeline = null;
  view.replaceChildren(want === 'editor' ? editor() : welcome());
  if (want === 'editor') refreshEditor();
}

async function onChange(what) {
  if (state.route !== 'studio' && what !== 'route') return;
  if (what === 'project') layout();
  if (mounted !== 'editor') return;
  if (['style', 'captions', 'project'].includes(what)) {
    await syncEngine();
    stage?.redraw();
  }
  refreshEditor(what);
}

// ---------------------------------------------------------------- welcome

function welcome() {
  const langs = state.config.languages;
  const groups = {};
  for (const l of langs) (groups[l.group] ||= []).push(l);
  const langSel = h('select', { class: 'select', id: 'pre-language', 'aria-label': 'Language spoken in the video' },
    Object.entries(groups).map(([g, ls]) => h('optgroup', { label: g },
      ls.map((l) => h('option', { value: l.id, disabled: l.unsupported ? true : null }, l.label)))));
  langSel.value = state.language;
  langSel.addEventListener('change', () => set({ language: langSel.value }));
  const vocab = h('input', { class: 'input', id: 'pre-vocab', placeholder: 'For example, Shiprocket', value: state.vocabulary });
  vocab.addEventListener('input', () => set({ vocabulary: vocab.value }));

  const maxGB = Math.round(state.config.maxUploadMB / 1024 * 10) / 10;
  const file = h('input', { type: 'file', accept: 'video/*,.mov,.mkv,.mxf', hidden: true, id: 'file-input' });
  file.addEventListener('change', () => file.files[0] && startUpload(file.files[0]));
  const startWith = h('p', { class: 'start-with' });
  const showStart = () => {
    const tpl = state.templateId && templateById(state.templateId);
    startWith.textContent = tpl ? `Starting style: ${tpl.name}` : '';
  };
  showStart();
  const drop = h('div', { class: 'drop', role: 'button', tabindex: 0, 'aria-label': 'Upload a video',
    onclick: (e) => { if (!e.target.closest('select,input,label')) file.click(); },
    onkeydown: (e) => { if (e.target === drop && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); file.click(); } } },
  h('h2', {}, 'Upload a video'),
  h('p', {}, `Drag it here or choose a file. MP4, MOV, MKV or WebM, up to ${maxGB >= 1 ? `${maxGB} GB` : `${state.config.maxUploadMB} MB`}.`),
  h('button', { class: 'btn brand lg', type: 'button' }, 'Choose a video'),
  startWith,
  h('div', { class: 'pre-options', onclick: (e) => e.stopPropagation() },
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Language in the video'), langSel),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Names to spell right'), vocab)),
  file);
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) startUpload(f); });

  return h('div', { class: 'welcome' }, h('div', { class: 'welcome-inner' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-copy' },
        h('h1', {}, 'Captions for your videos, ready in minutes'),
        h('p', { class: 'lede' }, 'Upload a video and the captions are written for you, timed to every word. Pick a style, change anything you like, and download the video at the same quality you uploaded.'),
        h('p', { class: 'langs' }, 'Works with Hindi, Hinglish and English, plus Tamil, Telugu, Bengali, Marathi and other Indian languages.')),
      drop),
    h('section', { class: 'looks' },
      h('div', { class: 'looks-head' },
        h('h2', {}, 'Pick a style to start with'),
        h('p', {}, 'It’s applied as soon as your captions are ready. The editor has 42 styles, and you can change every detail.')),
      showcase(showStart))));
}

// ---------------------------------------------------------------- editor

const TOOLS = [
  ['templates', 'Styles', 'templates'],
  ['text', 'Text', 'text'],
  ['effects', 'Effects', 'effects'],
  ['motion', 'Motion', 'motion'],
  ['position', 'Layout', 'position'],
  null,
  ['captions', 'Captions', 'captions'],
];

function editor() {
  const rail = h('nav', { class: 'rail', role: 'tablist', 'aria-label': 'Tools', 'aria-orientation': 'vertical' },
    TOOLS.map((t) => (t ? h('button', {
      role: 'tab', 'data-tool': t[0], html: `${icon(t[2])}<span>${t[1]}</span>`,
      onclick: () => set({ tool: t[0] }, 'tool'),
    }) : h('div', { class: 'rail-sep' }))));

  const bar = h('div', { class: 'projectbar' },
    h('div', { class: 'file-chip' }, h('span', { class: 'thumb', id: 'file-thumb' }),
      h('div', {}, h('b', { id: 'file-name' }), h('small', { id: 'file-specs' }))),
    h('div', { class: 'flow', id: 'flow' }),
    h('div', { class: 'bar-actions' },
      h('button', { class: 'btn ghost icon-only', id: 'undo', 'data-tip': 'Undo (Ctrl+Z)', 'data-tip-pos': 'below', html: icon('undo'), onclick: () => undo() }),
      h('button', { class: 'btn ghost icon-only', id: 'redo', 'data-tip': 'Redo (Ctrl+Shift+Z)', 'data-tip-pos': 'below', html: icon('redo'), onclick: () => redo() }),
      h('button', { class: 'btn', id: 'new-video', html: '<span>New video</span>', onclick: newVideo }),
      h('button', { class: 'btn primary', id: 'export-btn', html: '<span>Export</span>', onclick: openExport })));

  const panel = h('aside', { class: 'panel', id: 'panel', role: 'tabpanel' });
  const stageWrap = h('section', { class: 'stage-wrap', 'aria-label': 'Preview' });
  const tl = h('section', { class: 'timeline', 'aria-label': 'Timeline' });
  const root = h('div', { class: 'editor' }, bar, rail, panel, stageWrap, tl);
  stage = new Stage(stageWrap);
  timeline = new Timeline(tl, stage);
  stage.onTime = (t) => timeline.setTime(t);
  setReplay(() => stage?.replayCaption());
  setSeek((t, play) => { stage?.seek(t); if (play) stage?.video.play().catch(() => {}); });
  return root;
}

async function newVideo() {
  if (state.captions.length && !state.project?.exported
    && !window.confirm('Start a new video? Your current captions will be discarded and the files deleted.')) return;
  await leaveProject();
}

let lastTool = null;
function refreshEditor(what) {
  const p = state.project;
  if (!p) return;
  $('#file-name').textContent = p.name;
  const info = p.info;
  $('#file-specs').textContent = info
    ? `${info.width}×${info.height} · ${info.fps ? `${+info.fps.toFixed(2)} fps` : 'VFR'} · ${fmtDur(info.duration)}`
    : 'Uploading…';
  $('#undo').disabled = !canUndo();
  $('#redo').disabled = !canRedo();
  $('#export-btn').disabled = !(state.phase === 'editing' && state.captions.length && p.job);
  document.querySelectorAll('.rail button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tool === state.tool)));
  renderFlow();
  if (state.tool !== lastTool || what === 'project' || what === 'tool' || !$('#panel').firstChild) {
    lastTool = state.tool;
    renderPanel($('#panel'), state.tool);
  } else if (['style', 'captions', 'history', 'selection', 'active', 'thumb', 'transcript'].includes(what)) {
    PANELS[state.tool]?.update?.(what);
  }
  stage?.refresh();
  timeline?.refresh(what);
}

function renderFlow() {
  const steps = [['Upload', 'uploading'], ['Captions', 'generating'], ['Style', 'editing'], ['Export', 'export']];
  const order = ['uploading', 'generating', 'editing', 'export'];
  const now = state.project?.exported ? 3 : order.indexOf(state.phase);
  $('#flow').replaceChildren(...steps.flatMap(([label], i) => {
    const cls = i < now ? 'done' : i === now ? 'now' : '';
    const step = h('span', { class: cls, html: `<i>${i < now ? '✓' : i + 1}</i>${label}` });
    return i ? [h('span', { class: 'sep' }), step] : [step];
  }));
}

const fmtDur = (s) => { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; };

// Keyboard shortcuts (ignored while typing).
document.addEventListener('keydown', (e) => {
  if (state.route !== 'studio' || !state.project || document.querySelector('dialog[open]')) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
  if (typing) return;
  if (e.code === 'Space') { e.preventDefault(); stage?.toggle(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); stage?.seekBy(e.shiftKey ? -5 : -1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); stage?.seekBy(e.shiftKey ? 5 : 1); }
  if (e.key === ',') stage?.stepFrame(-1);
  if (e.key === '.') stage?.stepFrame(1);
});

export { engine, toast };
