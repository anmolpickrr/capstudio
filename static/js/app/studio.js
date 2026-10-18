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
import { deleteCaption, scaleCaption } from './captionops.js';
import { heroPhone, showcase, stopShowcase } from './showcase.js';
import { templateById, TEMPLATES } from '../templates/library.js';
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
    if (what === 'style') previewStyleChange();
  }
  refreshEditor(what);
}

// ---------------------------------------------------------------- welcome

// Language names in their own scripts, for the strip under the hero.
const SCRIPTS = [
  ['हिन्दी', 'deva'], ['English', 'latin'], ['தமிழ்', 'taml'], ['తెలుగు', 'telu'], ['বাংলা', 'beng'], ['मराठी', 'deva'],
  ['ગુજરાતી', 'gujr'], ['ಕನ್ನಡ', 'knda'], ['മലയാളം', 'mlym'], ['ਪੰਜਾਬੀ', 'guru'], ['Hinglish', 'latin'], ['اردو', 'arab'],
];

function welcome() {
  const langs = state.config.languages;
  const groups = {};
  for (const l of langs) (groups[l.group] ||= []).push(l);
  const langSel = h('select', { class: 'select', id: 'pre-language', 'aria-label': 'Language spoken in the video' },
    Object.entries(groups).map(([g, ls]) => h('optgroup', { label: g },
      ls.map((l) => h('option', { value: l.id, disabled: l.unsupported ? true : null }, l.label)))));
  langSel.value = state.language;
  langSel.addEventListener('change', () => set({ language: langSel.value }));

  const maxGB = Math.round(state.config.maxUploadMB / 1024 * 10) / 10;
  const limit = maxGB >= 1 ? `${maxGB} GB` : `${state.config.maxUploadMB} MB`;
  const file = h('input', { type: 'file', accept: 'video/*,.mov,.mkv,.mxf', hidden: true, id: 'file-input' });
  file.addEventListener('change', () => file.files[0] && startUpload(file.files[0]));
  const startWith = h('span', { class: 'start-with' });
  const showStart = () => {
    const tpl = state.templateId && templateById(state.templateId);
    startWith.textContent = tpl ? `Starting style: ${tpl.name}` : '';
  };
  showStart();

  const upload = h('div', { class: 'upload' },
    h('div', { class: 'upload-main' },
      h('button', { class: 'btn brand lg', type: 'button', onclick: () => file.click() }, 'Choose a video'),
      h('div', { class: 'upload-hint' }, h('b', {}, 'or drop it anywhere on this page'), h('span', {}, `MP4, MOV, MKV or WebM, up to ${limit}`))),
    h('label', { class: 'upload-options' }, h('span', {}, 'Language in the video'), langSel),
    startWith, file);

  // two columns of floating cards around the phone, aligned in rows
  const floats = h('div', { class: 'floats', 'aria-hidden': 'true' },
    h('div', { class: 'float left f-pop' }, 'WAIT FOR IT'),
    h('div', { class: 'float right f-hing' }, 'kya baat hai!'),
    h('div', { class: 'float left f-card f-timing' },
      h('small', {}, h('i', { class: 'dot' }), 'Hindi, every word timed'),
      h('div', { class: 'f-words' }, [['आज', '0:01.2'], ['हम', '0:01.6'], ['सीखेंगे', '0:01.9']].map(([w, t]) => h('span', {}, h('b', {}, w), h('em', {}, t)))),
      h('div', { class: 'f-wave' }, Array.from({ length: 28 }, (_, i) => h('i', { style: { height: `${20 + Math.round(Math.abs(Math.sin(i * 1.7) * 70))}%` } })))),
    h('div', { class: 'float right f-card f-type' },
      h('small', {}, `${TEMPLATES.length} styles`),
      h('div', { class: 'f-specimens' }, h('span', { class: 's1' }, 'Aa'), h('span', { class: 's2' }, 'Aa'), h('span', { class: 's3' }, 'Aa'), h('span', { class: 's4' }, 'अ'))),
    h('div', { class: 'float left f-card f-export' },
      h('small', {}, 'Export'), h('b', {}, '1080 × 1920 · 30 fps'), h('span', {}, 'Same quality as your upload')),
    h('div', { class: 'float right f-card f-safe' },
      h('small', {}, 'Instagram Reels'), h('b', {}, h('i', { class: 'tick' }, '✓'), 'Inside the safe zone')));

  const ticker = h('div', { class: 'ticker', 'aria-label': 'Languages' },
    h('div', { class: 'ticker-track' }, [...SCRIPTS, ...SCRIPTS].map(([t, sc], i) => h('span', { class: `sc-${sc}`, 'aria-hidden': i >= SCRIPTS.length ? 'true' : null }, t))));

  const page = h('div', { class: 'welcome' },
    h('div', { class: 'welcome-inner' },
      h('section', { class: 'hero' },
        h('div', { class: 'hero-copy' },
          h('span', { class: 'eyebrow' }, 'Captions for reels, ads and explainers'),
          h('h1', { class: 'hero-title' },
            h('span', {}, 'Captions that ', h('span', { class: 't-pop' }, 'POP'), ','),
            h('span', {}, h('span', { class: 't-serif' }, 'move'), ' and speak ', h('span', { class: 't-deva' }, 'हिंदी'))),
          h('p', { class: 'lede' }, 'Upload a video. Capstudio writes the captions, times every word and lets you style them your way. You download it at the same quality you uploaded.'),
          upload),
        h('div', { class: 'hero-stage' }, h('div', { class: 'glow' }), heroPhone(), floats)),
      ticker,
      h('section', { class: 'looks' },
        h('div', { class: 'looks-head' },
          h('div', {}, h('span', { class: 'kicker' }, 'Styles'), h('h2', {}, 'Set in motion, word by word')),
          h('p', {}, `Each one is drawn live by the same engine that renders your video. Pick one to start with; all ${TEMPLATES.length} are in the editor, and every detail can be changed.`)),
        showcase(showStart))),
    h('div', { class: 'drop-veil' }, h('div', {}, h('b', {}, 'Drop your video to start'), h('span', {}, `MP4, MOV, MKV or WebM, up to ${limit}`))));

  // the whole page accepts a dropped video
  let depth = 0;
  page.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; page.classList.add('dragging'); });
  page.addEventListener('dragover', (e) => e.preventDefault());
  page.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; page.classList.remove('dragging'); } });
  page.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; page.classList.remove('dragging');
    const f = e.dataTransfer.files[0];
    if (f) startUpload(f);
  });
  return page;
}

// ---------------------------------------------------------------- live preview

// Settings that only show while the caption plays (animations and spoken-word effects).
const MOTION_KEYS = ['animIn', 'animOut', 'wordIn', 'cascade', 'speed', 'reveal', 'highlight', 'hlScale', 'hlColor', 'hlBgColor'];
let lastStyle = null, lastTemplate = null, replayTimer = 0;

// After a style change, make sure the result is visible: with the video paused,
// jump to a caption if none is on screen, and replay it when motion changed.
function previewStyleChange() {
  const prev = lastStyle, prevTemplate = lastTemplate;
  lastStyle = state.style;
  lastTemplate = state.templateId;
  if (!stage || !prev || prev === state.style || state.phase !== 'editing' || !state.captions.length) return;
  const video = stage.video;
  if (!video.paused || document.querySelector('.overlay.grabbing')) return;
  const changed = Object.keys(state.style).filter((k) => state.style[k] !== prev[k]);
  const t = video.currentTime;
  if (!engine.scenesAt(t).length) {
    const target = state.captions.find((c) => c.id === state.selected)
      || state.captions.find((c) => c.start >= t) || state.captions[state.captions.length - 1];
    stage.seek(Math.min(target.end - 0.05, target.start + Math.min(0.6, (target.end - target.start) / 2)));
  }
  if (changed.some((k) => MOTION_KEYS.includes(k)) || state.templateId !== prevTemplate) {
    clearTimeout(replayTimer);
    replayTimer = setTimeout(() => stage?.replayCaption(), 250); // wait for slider drags to settle
  }
}

// ---------------------------------------------------------------- editor

const TOOLS = [
  ['templates', 'Styles', 'templates'],
  ['text', 'Text', 'text'],
  ['effects', 'Effects', 'effects'],
  ['motion', 'Motion', 'motion'],
  ['position', 'Layout', 'position'],
  ['watermark', 'Watermark', 'watermark'],
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
  } else if (['style', 'captions', 'history', 'selection', 'active', 'thumb', 'transcript', 'watermark'].includes(what)) {
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
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) { e.preventDefault(); deleteCaption(); }
  if ((e.key === '+' || e.key === '=') && state.selected) scaleCaption(0.1);
  if ((e.key === '-' || e.key === '_') && state.selected) scaleCaption(-0.1);
  if (e.key === ',') stage?.stepFrame(-1);
  if (e.key === '.') stage?.stepFrame(1);
});

export { engine, toast };
