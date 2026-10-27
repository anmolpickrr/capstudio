// The Studio: the first page (upload and a showcase of looks), then the editor (tools on the
// left, the video in the middle, the timeline below).
import { icon } from './icons.js';
import { openExport } from './export.js';
import { setSeek } from './panels/captions.js';
import { PANELS, renderPanel } from './panels/index.js';
import { setReplay } from './panels/motion.js';
import { captionSelectedClip, captionTimeline, engine, leaveProject, resumeProject, saveSessionNow, startUpload, syncEngine } from './session.js';
import { inAE, inPremiere } from './premiere.js';
import { listProjects } from './saved.js';
import { enqueue, liveProgress, nextReady, remove as removeQueued, retry } from './queue.js';
import { Stage } from './stage.js';
import { canRedo, canUndo, redo, set, state, subscribe, undo } from './store.js';
import { Timeline } from './timeline.js';
import { deleteCaption, scaleCaption } from './captionops.js';
import { heroPhone, showcase, stopShowcase } from './showcase.js';
import { templateById, TEMPLATES } from '../templates/library.js';
import { $, h, toast } from './ui.js';
import { goTo } from './appswitch.js';

let view = null;
let stage = null, timeline = null;

// Inside the Premiere Pro or After Effects panel the app gets its own compact
// layout (css/panel.css): only the settings scroll; preview and tabs stay put.
if (inPremiere) document.documentElement.classList.add('in-panel', inAE ? 'in-ae' : 'in-ppro');
const remember = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window */ } };
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
  view.replaceChildren(want === 'editor' ? editor() : inPremiere ? panelHome() : welcome());
  if (want === 'editor') { refreshEditor(); refreshNext(); }
}

async function onChange(what) {
  if (state.route !== 'studio' && what !== 'route') return;
  if (what === 'queue') {
    if (mounted === 'welcome') fillRecent();
    else refreshNext();
    return;
  }
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

// Into the editor: the captioned video goes along with its captions and style (and
// comes back to the edit made from it last time); with nothing captioned yet, the
// editor's start screen.
export async function openInEditor() {
  const p = state.project;
  if (!p) return goTo('/edit');
  if (!p.saveId || !state.captions.length) {
    if (state.phase === 'uploading' || state.phase === 'generating') return toast('Wait for the captions to finish, then open the video in the editor.');
    return goTo('/edit');
  }
  const btn = $('#to-editor');
  if (btn) btn.disabled = true;
  if (await saveSessionNow()) goTo(`/edit?capstudio=${encodeURIComponent(p.saveId)}`);
  else { if (btn) btn.disabled = false; toast('This browser couldn’t store the video for the editor (storage full?). Open the editor and import the video there.', 'error', 8000); }
}

// Straight back into a captioned video saved in this browser (from the editor's switch).
export const openSaved = (id) => resumeProject(id, pickAgain);

// How to install the Premiere Pro and After Effects panel (panel/ in the repository).
function openPanelHelp() {
  const dlg = $('#export-dialog');
  const site = location.origin;
  const cmd = (label, how, text) => {
    const copy = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 2000); }
      catch { getSelection().selectAllChildren(code); }
    } }, 'Copy');
    const code = h('code', {}, text);
    return h('div', { class: 'cmd-block' },
      h('div', { class: 'cmd-head' }, h('b', {}, label), copy),
      h('p', { class: 'hint' }, how),
      code);
  };
  const use = (app, steps) => h('div', { class: 'panel-use' }, h('b', {}, app), h('ol', {}, steps.map((t) => h('li', {}, t))));
  dlg.replaceChildren(h('div', { class: 'modal panel-help' },
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, 'Capstudio for Premiere Pro and After Effects'),
        h('p', {}, 'Caption without leaving your timeline or composition. Works in Premiere Pro and After Effects 2022 or newer, on Windows and Mac. One install covers both apps.')),
      h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => dlg.close() })),
    h('div', { class: 'modal-body' },
      h('h3', { class: 'panel-help-title' }, 'Install (once, about a minute)'),
      h('ol', { class: 'panel-steps' },
        h('li', {}, 'Close Premiere Pro and After Effects.'),
        h('li', {}, 'Copy the line for your computer below, paste it into PowerShell (Windows) or Terminal (Mac), and press Enter. No admin rights needed.'),
        h('li', {}, 'Open Premiere Pro or After Effects, then choose Window › Extensions › Capstudio.')),
      cmd('Windows', 'Open the Start menu, type PowerShell, and press Enter. Then paste this line:', `irm ${site}/panel/install.ps1 | iex`),
      cmd('Mac', 'Press ⌘ Space, type Terminal, and press Enter. Then paste this line:', `curl -fsSL ${site}/panel/install.sh | bash`),
      h('h3', { class: 'panel-help-title' }, 'Use it'),
      h('div', { class: 'panel-uses' },
        use('Premiere Pro', ['Select a clip in the timeline.', 'Click “Caption the selected clip”, then style the captions.', 'Click Export › “Add to timeline”. The captions go on the track above the clip.']),
        use('After Effects', ['Select a footage layer in the composition.', 'Click “Caption the selected layer”, then style the captions.', 'Click Export › “Add to composition”. The captions arrive as editable layers above it.'])),
      h('p', { class: 'hint' }, 'Can’t run commands on your computer? ',
        h('a', { href: `${site}/panel/capstudio-panel.zip` }, 'Download the panel files'), ' and ask IT to copy them into Adobe’s extensions folder.'))));
  dlg.showModal();
}

// The first screen inside the panel: pick the clip (Premiere) or layer (After Effects).
function panelHome() {
  const langs = state.config.languages;
  const groups = {};
  for (const l of langs) (groups[l.group] ||= []).push(l);
  const langSel = h('select', { class: 'select', 'aria-label': 'Language spoken in the clip' },
    Object.entries(groups).map(([g, ls]) => h('optgroup', { label: g },
      ls.map((l) => h('option', { value: l.id, disabled: l.unsupported ? true : null }, l.label)))));
  langSel.value = state.language;
  langSel.addEventListener('change', () => set({ language: langSel.value }));
  // the whole sequence / composition first; one clip or layer as the alternative
  const busy = (btn, text, run) => async () => {
    const was = btn.innerHTML;
    btn.disabled = true; btn.textContent = text;
    await run();
    btn.disabled = false; btn.innerHTML = was;
  };
  const whole = h('button', { class: 'btn brand lg', type: 'button', html: `<span>${inAE ? 'Caption the whole composition' : 'Caption the whole sequence'}</span>` });
  whole.onclick = busy(whole, inAE ? 'Reading the composition…' : 'Reading the sequence…', captionTimeline);
  const one = h('button', { class: 'btn ghost', type: 'button', html: `<span>${inAE ? 'Caption the selected layer' : 'Caption the selected clip'}</span>` });
  one.onclick = busy(one, inAE ? 'Reading the layer…' : 'Reading the clip…', captionSelectedClip);
  const steps = inAE
    ? ['Open the composition. Every footage layer counts: voice-overs, music and video sound are mixed, as they play.',
      'Click “Caption the whole composition”. Captions follow the full length, across every cut.',
      'Style them, then “Add to composition”: they arrive as editable layers at the top, over the full length.']
    : ['Open the sequence. Every clip on every track counts: voice-overs, music and video sound are mixed, as they play.',
      'Click “Caption the whole sequence”. Captions follow the full length, across every cut.',
      'Style them, then “Add to timeline”: they land on an empty track above everything.'];
  return h('div', { class: 'panel-home' },
    h('div', { class: 'panel-home-card' },
      h('span', { class: 'kicker' }, inAE ? 'Capstudio for After Effects' : 'Capstudio for Premiere Pro'),
      h('h1', {}, inAE ? 'Caption a composition' : 'Caption a sequence'),
      h('ol', { class: 'panel-steps' }, steps.map((t) => h('li', {}, t))),
      h('label', { class: 'upload-options' }, h('span', {}, 'Language spoken'), langSel),
      whole,
      h('div', { class: 'panel-or' }, h('span', {}, 'or just one part'), one),
      recentList()));
}

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
  const file = h('input', { type: 'file', accept: 'video/*,.mov,.mkv,.mxf', hidden: true, id: 'file-input', multiple: true });
  file.addEventListener('change', () => { openFiles([...file.files]); file.value = ''; });
  const startWith = h('span', { class: 'start-with' });
  const showStart = () => {
    const tpl = state.templateId && templateById(state.templateId);
    startWith.textContent = tpl ? `Starting style: ${tpl.name}` : '';
  };
  showStart();

  const upload = h('div', { class: 'upload' },
    h('div', { class: 'upload-main' },
      h('button', { class: 'btn brand lg', type: 'button', onclick: () => file.click() }, 'Choose a video'),
      h('div', { class: 'upload-hint' }, h('b', {}, 'or drop it anywhere on this page'), h('span', {}, `MP4, MOV, MKV or WebM, up to ${limit}. Several at once makes a queue.`))),
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
          upload,
          h('div', { class: 'more-tools' },
            h('a', { class: 'tool-card editor', href: '/edit', onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); goTo('/edit'); } },
              h('span', { class: 'tool-icon', html: icon('editor') }),
              h('span', { class: 'tool-text' }, h('b', {}, 'Video editor', h('em', {}, 'New')), h('small', {}, 'Cuts, layers, music, transitions and keyframes')),
              h('span', { class: 'tool-go', html: icon('arrowRight') })),
            h('button', { class: 'tool-card', type: 'button', onclick: openPanelHelp },
              h('span', { class: 'tool-icon adobe' }, 'Pr'),
              h('span', { class: 'tool-text' }, h('b', {}, 'Adobe panel'), h('small', {}, 'Caption inside Premiere Pro and After Effects')),
              h('span', { class: 'tool-go', html: icon('arrowRight') }))),
          recentList()),
        h('div', { class: 'hero-stage' }, h('div', { class: 'glow' }), heroPhone(showStart), floats)),
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
    openFiles([...e.dataTransfer.files]);
  });
  return page;
}

// Projects saved in this browser, newest first, to pick up where you left off.
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  return hrs < 24 ? `${hrs} h ago` : `${Math.round(hrs / 24)} d ago`;
};

// When the video couldn't be kept in the browser, ask for the same file again.
function pickAgain(record) {
  return new Promise((resolve) => {
    toast(`Pick “${record.name}” again to continue (it was too large to keep in the browser).`, 'info', 6000);
    const input = h('input', { type: 'file', accept: 'video/*,.mov,.mkv,.mxf', hidden: true });
    input.addEventListener('change', () => resolve(input.files[0] || null));
    input.addEventListener('cancel', () => resolve(null));
    document.body.append(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  });
}

// One video opens in the editor; several go into the queue.
function openFiles(files) {
  if (files.length > 1) enqueue(files);
  else if (files[0]) startUpload(files[0]);
}

// Where each video is: the queue's stages, then "ready", "in progress", "exported".
function statusOf(p) {
  const lv = liveProgress(p.id);
  if (p.queue === 'waiting') return ['Waiting', 'wait'];
  if (p.queue === 'uploading') return [`Uploading${lv ? ` ${Math.round(lv.p * 100)}%` : '…'}`, 'busy'];
  if (p.queue === 'captioning') return [`Writing captions${lv?.p ? ` ${Math.round(lv.p * 100)}%` : '…'}`, 'busy'];
  if (p.queue === 'error') return [p.error || 'Failed', 'bad'];
  if (p.exported) return ['Exported', 'done'];
  if (p.queue === 'ready' && !p.opened) return ['Ready to review', 'ready'];
  return [`In progress · ${p.captions?.length || 0} captions`, 'open'];
}

// Saved projects and the queue, to pick up where you left off.
let recentBox = null;
function recentList() {
  const box = h('div', { class: 'recent', hidden: true });
  recentBox = box;
  fillRecent();
  return box;
}

async function fillRecent() {
  const box = recentBox;
  if (!box?.isConnected && box?.dataset.filled) return;
  const all = await listProjects();
  const queued = all.filter((p) => p.queue && !p.exported).sort((a, b) => a.queuedAt - b.queuedAt);
  const others = all.filter((p) => !queued.includes(p)).slice(0, 3);
  const items = [...queued, ...others];
  box.dataset.filled = '1';
  box.hidden = !items.length;
  const counts = { ready: queued.filter((p) => p.queue === 'ready' && !p.opened).length,
    working: queued.filter((p) => ['waiting', 'uploading', 'captioning'].includes(p.queue)).length };
  const title = queued.length
    ? `Queue · ${counts.ready} ready to review${counts.working ? `, ${counts.working} being captioned` : ''}`
    : 'Continue where you left off';
  box.replaceChildren(h('span', { class: 'recent-title' }, title), ...items.map((p) => {
    const [label, kind] = statusOf(p);
    const openable = !['waiting', 'uploading', 'captioning', 'error'].includes(p.queue || '');
    const lv = liveProgress(p.id);
    return h('div', { class: `recent-item${openable ? '' : ' busy'}`, 'data-id': p.id },
      h('button', { class: 'recent-open', type: 'button', disabled: openable ? null : true, 'aria-label': `Open ${p.name}`,
        onclick: () => resumeProject(p.id, pickAgain) },
        h('span', { class: 'recent-thumb', style: p.thumb ? { backgroundImage: `url(${p.thumb})` } : null }),
        h('span', { class: 'recent-text' }, h('b', {}, p.name),
          h('small', {}, h('i', { class: `q-${kind}` }, label), p.queue ? '' : ` · ${ago(p.savedAt)}`),
          lv ? h('span', { class: 'q-bar' }, h('i', { style: { width: `${Math.round(((lv.stage === 'captioning' ? 0.5 : 0) + lv.p / 2) * 100)}%` } })) : null)),
      p.queue === 'error' ? h('button', { class: 'btn sm', type: 'button', onclick: () => retry(p.id) }, 'Retry') : null,
      h('button', { class: 'btn ghost sm icon-only recent-remove', type: 'button', 'aria-label': `Remove ${p.name}`, 'data-tip': 'Remove from this browser',
        html: icon('close'), onclick: () => removeQueued(p.id) }));
  }));
}

// In the editor: open the next video in the queue that's ready to review.
async function refreshNext() {
  const btn = document.getElementById('next-video');
  if (!btn) return;
  const next = await nextReady(state.project?.saveId);
  btn.hidden = !next;
  if (next) {
    btn.dataset.id = next.id;
    btn.title = `Next in the queue: ${next.name}`;
  }
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

const TOOL_IDS = TOOLS.filter(Boolean).map((t) => t[0]);

function editor() {
  const rail = h('nav', { class: 'rail', role: 'tablist', 'aria-label': 'Tools', 'aria-orientation': inPremiere ? 'horizontal' : 'vertical' },
    TOOLS.map((t) => (t ? h('button', {
      // (a narrow panel calls Watermark "Logo", so every tab fits)
      role: 'tab', 'data-tool': t[0], html: `${icon(t[2])}<span>${inPremiere && t[0] === 'watermark' ? 'Logo' : t[1]}</span>`, title: `${t[1]} (${TOOL_IDS.indexOf(t[0]) + 1})`,
      onclick: () => set({ tool: t[0] }, 'tool'),
    }) : h('div', { class: 'rail-sep' }))));

  const bar = h('div', { class: 'projectbar' },
    h('div', { class: 'file-chip' }, h('span', { class: 'thumb', id: 'file-thumb' }),
      h('div', {}, h('b', { id: 'file-name' }), h('small', { id: 'file-specs' }))),
    h('div', { class: 'flow', id: 'flow' }),
    h('div', { class: 'bar-actions' },
      h('button', { class: 'btn ghost icon-only', id: 'undo', 'data-tip': 'Undo (Ctrl+Z)', 'data-tip-pos': 'below', html: icon('undo'), onclick: () => undo() }),
      h('button', { class: 'btn ghost icon-only', id: 'redo', 'data-tip': 'Redo (Ctrl+Shift+Z)', 'data-tip-pos': 'below', html: icon('redo'), onclick: () => redo() }),
      h('button', { class: 'btn', id: 'next-video', hidden: true, html: '<span>Next video ›</span>',
        onclick: (e) => e.currentTarget.dataset.id && resumeProject(e.currentTarget.dataset.id, pickAgain) }),
      inPremiere
        ? h('button', { class: 'btn ghost icon-only', id: 'new-video', 'data-tip': inAE ? 'Caption another layer' : 'Caption another clip', 'data-tip-pos': 'below',
          'aria-label': inAE ? 'Caption another layer' : 'Caption another clip', html: icon('replay'), onclick: newVideo })
        : h('button', { class: 'btn', id: 'new-video', html: '<span>New video</span>', onclick: newVideo }),
      inPremiere ? null : h('button', { class: 'btn', id: 'to-editor', 'data-tip': 'Cut, layer, add music and transitions in the video editor', 'data-tip-pos': 'below',
        html: `${icon('editor')}<span>Open in Editor</span>`, onclick: openInEditor }),
      h('button', { class: 'btn primary', id: 'export-btn', html: inPremiere ? `${icon('export')}<span>${inAE ? 'Add to comp' : 'Add to timeline'}</span>` : '<span>Export</span>', onclick: openExport })));

  const panel = h('aside', { class: 'panel', id: 'panel', role: 'tabpanel' });
  const stageWrap = h('section', { class: 'stage-wrap', 'aria-label': 'Preview' });
  const tl = h('section', { class: 'timeline', 'aria-label': 'Timeline' });
  const root = h('div', { class: 'editor' }, bar, rail, panel, stageWrap, tl);
  if (inPremiere) panelChrome(root, rail, panel);
  stage = new Stage(stageWrap);
  timeline = new Timeline(tl, stage);
  stage.onTime = (t) => timeline.setTime(t);
  setReplay(() => stage?.replayCaption());
  setSeek((t, play) => { stage?.seek(t); if (play) stage?.video.play().catch(() => {}); });
  return root;
}

async function newVideo() {
  if (state.captions.length && !state.project?.exported && !state.project?.saved
    && !window.confirm('Start a new video? Your current captions will be discarded and the files deleted.')) return;
  const saved = state.project?.saved;
  await leaveProject();
  if (saved) toast('Saved. Pick it up again under “Continue where you left off”.', 'ok', 4000);
}

// ---------------------------------------------------------------- panel layout

// The panel's extras: a handle to resize the preview (double-click: small or
// normal), a switch for the caption timeline, and sections that fold away. Each
// tool keeps its scroll position and folded sections.
function panelChrome(root, rail, panel) {
  const set = (px) => { root.style.setProperty('--pv-h', `${px}px`); keep('capstudio-panel-pv', px); };
  const saved = remember('capstudio-panel-pv', null);
  if (saved) root.style.setProperty('--pv-h', `${saved}px`);
  const grip = h('div', { class: 'pv-resize', role: 'separator', 'aria-label': 'Resize the preview', title: 'Drag to resize the preview. Double-click: small or normal.' }, h('i'));
  grip.addEventListener('pointerdown', (e) => {
    const stageWrap = root.querySelector('.stage-wrap');
    const y0 = e.clientY, h0 = stageWrap.getBoundingClientRect().height;
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => set(Math.round(Math.min(innerHeight * 0.75, Math.max(150, h0 + ev.clientY - y0))));
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => {
    const cur = root.querySelector('.stage-wrap').getBoundingClientRect().height;
    set(cur > 220 ? 180 : Math.round(innerHeight * 0.42));
  });
  root.insertBefore(grip, rail);
  const showTl = remember('capstudio-panel-tl', false);
  root.classList.toggle('show-tl', showTl);
  const tlBtn = h('button', { class: 'rail-toggle', type: 'button', 'aria-pressed': String(showTl), 'data-tip': 'Show the caption timeline', 'aria-label': 'Caption timeline',
    html: `${icon('film')}<span>Timing</span>`, onclick: () => {
      const on = !root.classList.contains('show-tl');
      root.classList.toggle('show-tl', on);
      tlBtn.setAttribute('aria-pressed', String(on));
      keep('capstudio-panel-tl', on);
    } });
  rail.append(tlBtn);
  // fold a section by its title; remembered per tool
  const folded = new Set(remember('capstudio-panel-folded', []));
  const keyOf = (sec) => `${state.tool}:${sec.querySelector(':scope > h3')?.textContent.trim()}`;
  panel.addEventListener('click', (e) => {
    const title = e.target.closest('.section > h3');
    if (!title) return;
    const sec = title.parentElement;
    const k = keyOf(sec);
    if (folded.has(k)) folded.delete(k); else folded.add(k);
    sec.classList.toggle('folded', folded.has(k));
    keep('capstudio-panel-folded', [...folded]);
  });
  new MutationObserver(() => {
    panel.querySelectorAll('.section > h3').forEach((t) => { if (!t.tabIndex) { t.tabIndex = 0; t.setAttribute('role', 'button'); } t.parentElement.classList.toggle('folded', folded.has(keyOf(t.parentElement))); });
  }).observe(panel, { childList: true, subtree: true });
  panel.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.section > h3')) { e.preventDefault(); e.target.click(); } });
}

// Where each tool was scrolled to, and which "more" groups were open, so switching
// tools and coming back finds everything as it was.
const toolMemory = new Map();
function rememberTool(tool) {
  const body = $('#panel .panel-body');
  if (!tool || !body) return;
  toolMemory.set(tool, { top: body.scrollTop, open: [...body.querySelectorAll('details.more[open] > summary')].map((s) => s.textContent.trim()) });
}
function restoreTool(tool) {
  const m = toolMemory.get(tool), body = $('#panel .panel-body');
  if (!m || !body) return;
  body.querySelectorAll('details.more > summary').forEach((s) => { if (m.open.includes(s.textContent.trim())) s.parentElement.open = true; });
  requestAnimationFrame(() => { body.scrollTop = m.top; });
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
  $('#export-btn').disabled = !(state.phase === 'editing' && state.captions.length && (p.job || p.file));
  const toEd = $('#to-editor');
  if (toEd) toEd.disabled = !(state.phase === 'editing' && state.captions.length && p.file);
  document.querySelectorAll('.rail button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tool === state.tool)));
  renderFlow();
  if (state.tool !== lastTool || what === 'project' || what === 'tool' || !$('#panel').firstChild) {
    rememberTool(lastTool);
    lastTool = state.tool;
    renderPanel($('#panel'), state.tool);
    restoreTool(state.tool);
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
  // 1–7 switch tools
  const n = Number(e.key);
  if (!mod && !e.altKey && n >= 1 && n <= TOOL_IDS.length) { e.preventDefault(); set({ tool: TOOL_IDS[n - 1] }, 'tool'); return; }
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
