import {
  ANIMATIONS, chunkWords, displayWord, flattenWords, resolveFont, retext, retime, toASS, toSRT, toTXT, toVTT,
} from './captions.js';
import { CaptionRenderer } from './preview.js';
import { BASE_STYLE, TEMPLATES, templateStyle } from './templates.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  config: null,
  fonts: [],
  file: null,
  job: null,
  uploading: null,          // Promise resolving to the job once uploaded
  wantTranscribe: false,
  transcript: null,         // { language, spaced, words, ... }
  captions: [],
  spaced: true,
  templateId: 'bold-pop',
  style: templateStyle('bold-pop'),
  font: null,
  undo: [],
  quality: 'high',
  exported: false,
};

// ------------------------------------------------------------------ helpers

function toast(msg, error = false, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${res.status})`);
  return body;
}

const fmt = (s, dec = 1) => {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(dec).padStart(dec ? 3 + dec : 2, '0')}`;
};
const parseTime = (v) => {
  const parts = String(v).trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function setStep(step) {
  const order = ['upload', 'generate', 'edit', 'export'];
  const idx = order.indexOf(step);
  $$('#steps li').forEach((li, i) => {
    li.classList.toggle('active', i === idx);
    li.classList.toggle('done', i < idx);
  });
}

function describeSpecs(info) {
  const codec = { h264: 'H.264', hevc: 'HEVC', prores: 'ProRes', vp9: 'VP9', av1: 'AV1' }[info.vcodec] || info.vcodec;
  return `${info.width}×${info.height} · ${info.fps ? `${+info.fps.toFixed(3)} fps` : 'VFR'} · ${codec}`
    + `${info.pixFmt?.includes('10') ? ' 10-bit' : ''} · ${fmt(info.duration, 0)}`
    + `${info.size ? ` · ${(info.size / 1e6).toFixed(1)} MB` : ''}`;
}

// -------------------------------------------------------------------- init

async function init() {
  const [config, fonts] = await Promise.all([api('/api/config'), api('/api/fonts')]);
  state.config = config;
  state.fonts = fonts;

  const css = fonts.map((f) => `@font-face{font-family:"cp-${f.id}";src:url("/fonts/${encodeURIComponent(f.file)}");font-display:block}`).join('\n');
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
  document.fonts.addEventListener('loadingdone', () => { renderer?.invalidate(); drawFrame(); });

  const groups = {};
  for (const l of config.languages) (groups[l.group] ||= []).push(l);
  $('#language').innerHTML = Object.entries(groups).map(([g, ls]) =>
    `<optgroup label="${g}">${ls.map((l) => `<option value="${l.id}">${l.label}</option>`).join('')}</optgroup>`).join('');

  const r = config.retention;
  $('#privacy').textContent = `Temporary processing only: your video and captions are deleted automatically ${r.downloadGraceMin} min after you download the result, or ${Math.round(r.jobTtlMin / 60 * 10) / 10} h after your last activity — whichever comes first. Nothing is kept permanently.`;
  $('#retention-desc').textContent = $('#privacy').textContent;

  $('#anim-select').innerHTML = Object.entries(ANIMATIONS).map(([k, a]) => `<option value="${k}">${a.label}</option>`).join('');
  const families = [...new Set(fonts.map((f) => f.family))];
  $('#font-family').innerHTML = families.map((f) => `<option>${f}</option>`).join('');

  bindStart();
  bindEditor();
  setStep('upload');
}

// ------------------------------------------------------------ upload/start

function bindStart() {
  const dz = $('#dropzone');
  $('#file-input').addEventListener('change', (e) => e.target.files[0] && pickFile(e.target.files[0]));
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  });
  $('#generate').addEventListener('click', generate);
  $('#new-video').addEventListener('click', () => {
    if (state.captions.length && !confirm('Start over with a new video? Current captions will be discarded.')) return;
    deleteJob();
    location.reload();
  });
}

function pickFile(file) {
  if (state.job) deleteJob();
  const maxBytes = state.config.maxUploadMB * 1024 * 1024;
  if (file.size > maxBytes) return toast(`That file is larger than ${state.config.maxUploadMB} MB.`, true);
  state.file = file;
  state.job = null;
  $('#file-row').hidden = false;
  $('#file-name').textContent = file.name;
  $('#file-specs').textContent = 'Uploading…';
  $('#upload-bar').style.width = '0%';
  $('#generate').disabled = false;
  $('#dropzone .dz-title').textContent = 'Replace video';
  setStep('generate');

  state.uploading = new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/jobs');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = e.loaded / e.total;
      $('#upload-bar').style.width = `${p * 100}%`;
      $('#file-specs').textContent = p < 1 ? `Uploading… ${Math.round(p * 100)}%` : 'Checking video…';
    };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status !== 200) return reject(new Error(body.detail || 'Upload failed'));
      resolve(body);
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    xhr.send(file);
  });
  state.uploading.then((job) => {
    if (state.file !== file) return;
    state.job = job;
    $('#file-specs').textContent = describeSpecs(job.info);
    $('#upload-bar').style.width = '100%';
    if (!job.info.acodec) toast('This video has no audio track, so there is nothing to caption.', true, 6000);
  }).catch((e) => {
    if (state.file !== file) return;
    $('#file-specs').textContent = e.message;
    $('#generate').disabled = true;
    toast(e.message, true);
  });
}

async function generate() {
  const btn = $('#generate');
  btn.disabled = true;
  $('#gen-status').hidden = false;
  $('#gen-bar').style.width = '0%';
  const lang = $('#language').value;
  try {
    $('#gen-text').textContent = state.job ? 'Starting…' : 'Waiting for upload to finish…';
    const job = state.job || await state.uploading;
    state.job = job;
    await api(`/api/jobs/${job.id}/transcribe`, {
      method: 'POST', body: JSON.stringify({ language: lang, vocabulary: $('#vocabulary').value }),
    });
    for (;;) {
      await sleep(700);
      const j = await api(`/api/jobs/${job.id}`);
      state.job = j;
      const t = j.transcription;
      $('#gen-bar').style.width = `${t.progress * 100}%`;
      if (t.status === 'queued' || (t.status === 'running' && t.progress < 0.04)) {
        $('#gen-text').textContent = 'Preparing audio and speech model…';
      } else if (t.status === 'running') {
        const eta = t.elapsed && t.progress > 0.1 ? Math.max(0, t.elapsed / t.progress - t.elapsed) : null;
        $('#gen-text').textContent = `Transcribing… ${Math.round(t.progress * 100)}%${eta != null ? ` · about ${Math.ceil(eta)}s left` : ''}`;
      } else if (t.status === 'error') {
        throw new Error(t.error || 'Caption generation failed');
      } else if (t.status === 'done') {
        onTranscript(j.transcript);
        return;
      }
    }
  } catch (e) {
    toast(e.message, true, 6000);
    $('#gen-text').textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

function onTranscript(tr) {
  if (!tr.words.length) {
    toast('No speech was detected in this video.', true, 6000);
    $('#gen-text').textContent = 'No speech detected. Try choosing the language manually.';
    return;
  }
  state.transcript = tr;
  state.spaced = tr.spaced;
  state.captions = chunkWords(tr.words, state.style, tr.spaced);
  state.undo = [];
  const label = new Intl.DisplayNames(['en'], { type: 'language' }).of(tr.language) || tr.language;
  const conf = tr.languageProbability ? ` (${Math.round(tr.languageProbability * 100)}% confident)` : '';
  toast(`${tr.requested === 'auto' ? 'Detected' : 'Language'}: ${label}${conf} · ${tr.words.length} words`);
  openEditor();
}

// ------------------------------------------------------------------ editor

let renderer = null;
const video = () => $('#video');

function openEditor() {
  $('#screen-start').hidden = true;
  $('#screen-editor').hidden = false;
  $('#new-video').hidden = false;
  setStep('edit');
  const { info } = state.job;
  renderer ||= new CaptionRenderer($('#overlay'));
  renderer.setSize(info.width, info.height);
  $('#specs').textContent = `Original: ${describeSpecs(info)} — exported at exactly this resolution and frame rate.`;
  const v = video();
  if (!v.src) {
    v.src = URL.createObjectURL(state.file);
    v.addEventListener('error', useProxy, { once: true });
    v.addEventListener('loadedmetadata', () => { if (!v.videoWidth) useProxy(); }, { once: true });
  }
  // Thumbnails are built once the panel is visible, since box sizes are measured from the rendered text.
  if (!$('#tpl-grid').children.length) buildTemplates();
  syncControls();
  recompute();
  renderList();
  renderTimeline();
  updateRetention();
}

async function useProxy() {
  toast('Your browser can’t play this format directly — preparing a preview copy (export still uses the original).', false, 6000);
  video().src = `/api/jobs/${state.job.id}/proxy`;
}

function bindEditor() {
  const v = video();
  $('#play').addEventListener('click', togglePlay);
  $('#mute').addEventListener('click', () => { v.muted = !v.muted; $('#mute').textContent = v.muted ? '🔇' : '🔊'; });
  v.addEventListener('play', () => { $('#play').textContent = '❚❚'; loop(); });
  v.addEventListener('pause', () => { $('#play').textContent = '▶'; });
  v.addEventListener('seeked', drawFrame);
  v.addEventListener('loadeddata', drawFrame);
  document.addEventListener('keydown', (e) => {
    if ($('#screen-editor').hidden) return;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (e.code === 'Space' && !typing) { e.preventDefault(); togglePlay(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !typing) { e.preventDefault(); undo(); }
  });

  const tl = $('#timeline');
  const seekFromEvent = (e) => {
    const r = tl.getBoundingClientRect();
    v.currentTime = Math.min(Math.max(0, (e.clientX - r.left) / r.width), 1) * state.job.info.duration;
    drawFrame();
  };
  tl.addEventListener('pointerdown', (e) => {
    tl.setPointerCapture(e.pointerId);
    seekFromEvent(e);
    tl.onpointermove = seekFromEvent;
  });
  tl.addEventListener('pointerup', () => { tl.onpointermove = null; });

  $$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // Style controls
  $$('[data-k]').forEach((input) => {
    const k = input.dataset.k;
    if (input.classList.contains('seg')) {
      $$('button', input).forEach((b) => b.addEventListener('click', () => setStyle({ [k]: b.value, offset: defaultOffset(b.value) })));
      return;
    }
    const ev = input.type === 'range' || input.type === 'color' ? 'input' : 'change';
    input.addEventListener(ev, () => {
      let val = input.type === 'checkbox' ? input.checked : input.value;
      if (input.type === 'range') val = Number(val);
      setStyle({ [k]: val }, input.hasAttribute('data-rechunk'));
    });
  });
  $('#font-family').addEventListener('change', () => {
    const fam = $('#font-family').value;
    const cur = state.fonts.find((f) => f.id === state.style.fontId);
    const options = state.fonts.filter((f) => f.family === fam);
    options.sort((a, b) => Math.abs(a.weight - (cur?.weight || 700)) - Math.abs(b.weight - (cur?.weight || 700)));
    setStyle({ fontId: options[0].id });
  });
  $('#font-weight').addEventListener('change', () => setStyle({ fontId: $('#font-weight').value }));

  bindDrag();

  // Caption tools
  $('#replace-all').addEventListener('click', replaceAll);
  $$('[data-shift]').forEach((b) => b.addEventListener('click', () => shiftAll(Number(b.dataset.shift))));
  $('#undo').addEventListener('click', undo);

  // Export
  $$('#quality button').forEach((b) => b.addEventListener('click', () => {
    state.quality = b.value;
    $$('#quality button').forEach((x) => x.classList.toggle('active', x === b));
    updateBurnDesc();
  }));
  $('#render-burn').addEventListener('click', () => render('burn'));
  $('#render-soft').addEventListener('click', () => render('soft'));
  $$('[data-file]').forEach((b) => b.addEventListener('click', () => exportFile(b.dataset.file)));
  $('#delete-now').addEventListener('click', () => {
    if (!confirm('Delete your uploaded video and all generated files from the server now?')) return;
    deleteJob();
    state.captions = [];
    toast('Your files were deleted from the server.');
    setTimeout(() => location.reload(), 1200);
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.captions.length && !state.exported) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('pagehide', deleteJob);
}

function defaultOffset(placement) {
  return { top: 8, middle: 0, bottom: 8 }[placement];
}

function showTab(tab) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-body').forEach((b) => { b.hidden = b.dataset.tab !== tab; });
  setStep(tab === 'export' ? 'export' : 'edit');
  if (tab === 'export') updateBurnDesc();
  if (tab === 'captions') scrollToActive(true);
}

function togglePlay() {
  const v = video();
  if (v.paused) v.play(); else v.pause();
}

function loop() {
  drawFrame();
  if (!video().paused) requestAnimationFrame(loop);
}

function captionAt(t) {
  const cs = state.captions;
  let lo = 0, hi = cs.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cs[mid].start <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found >= 0 && t < cs[found].end ? found : -1;
}

let lastActive = -2;
function drawFrame() {
  if (!state.job || !renderer) return;
  const t = video().currentTime;
  const idx = captionAt(t);
  renderer.render(state.captions[idx], state.style, state.font, t, state.spaced);
  const dur = state.job.info.duration;
  $('#time').textContent = `${fmt(t)} / ${fmt(dur)}`;
  $('#tl-head').style.left = `${(t / dur) * 100}%`;
  if (idx !== lastActive) {
    $$('#cap-list .cap.active, #tl-caps .tl-cap.active').forEach((n) => n.classList.remove('active'));
    if (idx >= 0) {
      $(`#cap-list .cap[data-i="${idx}"]`)?.classList.add('active');
      $(`#tl-caps .tl-cap[data-i="${idx}"]`)?.classList.add('active');
    }
    lastActive = idx;
    scrollToActive();
  }
}

function scrollToActive(force) {
  const list = $('#cap-list');
  const node = $('.cap.active', list);
  if (!node || list.closest('.tab-body').hidden) return;
  if (!force && list.contains(document.activeElement)) return; // don't yank while typing
  node.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- styling

function setStyle(patch, rechunk = false) {
  state.style = { ...state.style, ...patch };
  if (rechunk || 'maxWords' in patch || 'maxCharsPerLine' in patch || 'maxLines' in patch) {
    state.captions = chunkWords(flattenWords(state.captions), state.style, state.spaced);
    renderList();
    renderTimeline();
  } else if ('textCase' in patch || 'stripPunctuation' in patch) {
    renderList();
  }
  syncControls();
  recompute();
}

function recompute() {
  const text = state.captions.flatMap((c) => c.words.map((w) => displayWord(w.text, state.style))).join(' ');
  const res = resolveFont(state.fonts, state.style.fontId, text);
  state.font = res.font;
  const note = $('#font-note');
  const chosen = state.fonts.find((f) => f.id === state.style.fontId);
  if (res.substituted) {
    note.hidden = false;
    note.textContent = `${chosen.family} can’t display every character in these captions, so ${res.font.family} is used instead (in the preview and the export).`;
  } else if (res.missingGlyphs) {
    note.hidden = false;
    note.textContent = 'No single font covers every script in these captions; some characters may not display.';
  } else note.hidden = true;
  renderer?.invalidate();
  drawFrame();
  $$('.tpl').forEach((n) => n.classList.toggle('active', n.dataset.id === state.templateId));
}

function syncControls() {
  const s = state.style;
  $$('[data-k]').forEach((input) => {
    const k = input.dataset.k;
    if (input.classList.contains('seg')) {
      $$('button', input).forEach((b) => b.classList.toggle('active', b.value === s[k]));
    } else if (input.type === 'checkbox') input.checked = !!s[k];
    else input.value = s[k];
  });
  $$('[data-out]').forEach((o) => {
    const v = s[o.dataset.out];
    o.textContent = ['shadowOpacity', 'boxOpacity'].includes(o.dataset.out) ? `${Math.round(v * 100)}%` : v;
  });
  const font = state.fonts.find((f) => f.id === s.fontId) || state.fonts[0];
  $('#font-family').value = font.family;
  const weightNames = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
  $('#font-weight').innerHTML = state.fonts.filter((f) => f.family === font.family)
    .map((f) => `<option value="${f.id}">${weightNames[f.weight] || f.weight}</option>`).join('');
  $('#font-weight').value = font.id;
}

const PRESET_KEY = 'caption-panel.presets';

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY)) || []; } catch { return []; }
}

function savePresets(list) {
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); } catch { toast('Could not save presets in this browser.', true); }
}

// Custom presets (e.g. a brand style) live in this browser only, never on the server.
function saveCurrentAsPreset() {
  const name = prompt('Name this style (e.g. "Brand – Reels")');
  if (!name?.trim()) return;
  const list = loadPresets().filter((p) => p.name !== name.trim());
  list.unshift({ id: `my-${Date.now()}`, name: name.trim(), tag: 'My preset', style: { ...state.style }, custom: true });
  savePresets(list);
  state.templateId = list[0].id;
  buildTemplates();
  toast('Style saved to My presets.');
}

function buildTemplates() {
  const grid = $('#tpl-grid');
  grid.innerHTML = '<button class="tpl tpl-save" id="save-preset"><span>＋</span><div class="tpl-name">Save current style</div><div class="tpl-tag">As your own preset</div></button>';
  $('#save-preset').addEventListener('click', saveCurrentAsPreset);
  const sample = {
    id: 'sample', start: 0, end: 10,
    words: ['Make', 'every', 'video', 'count'].map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 })),
  };
  const all = [...loadPresets(), ...TEMPLATES.map((t) => ({ ...t, style: templateStyle(t.id) }))];
  for (const tpl of all) {
    const btn = document.createElement('button');
    btn.className = 'tpl';
    btn.dataset.id = tpl.id;
    btn.innerHTML = `<svg preserveAspectRatio="xMidYMid meet"></svg><div class="tpl-name"></div><div class="tpl-tag"></div>`;
    $('.tpl-name', btn).textContent = tpl.name;
    $('.tpl-tag', btn).textContent = tpl.tag;
    if (tpl.custom) {
      const del = Object.assign(document.createElement('span'), { className: 'tpl-del', title: 'Delete preset', textContent: '✕' });
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete preset "${tpl.name}"?`)) return;
        savePresets(loadPresets().filter((p) => p.id !== tpl.id));
        buildTemplates();
      });
      btn.appendChild(del);
    }
    grid.appendChild(btn);
    const style = { ...BASE_STYLE, ...tpl.style };
    const r = new CaptionRenderer($('svg', btn));
    r.setSize(1920, 1080);
    const words = style.maxWords === 1 ? { ...sample, words: [{ text: 'video', start: 0, end: 5 }] } : sample;
    const draw = () => {
      r.invalidate();
      // Thumbnails are tiny, so the text is enlarged to stay legible.
      const preview = {
        ...style, size: style.size * 2.2, outline: style.outline * 2, shadow: style.shadow * 2, blur: style.blur * 2,
        boxPadding: style.boxPadding * 2, letterSpacing: style.letterSpacing * 2,
        placement: 'middle', offset: 0, maxCharsPerLine: 12, maxLines: 2,
      };
      const font = resolveFont(state.fonts, style.fontId, '').font;
      r.render(words, preview, font, 0.9, true);
    };
    document.fonts.load(`20px "cp-${style.fontId}"`).then(draw);
    draw();
    btn.addEventListener('click', () => {
      state.templateId = tpl.id;
      setStyle({ ...style }, true);
    });
  }
  $$('.tpl').forEach((n) => n.classList.toggle('active', n.dataset.id === state.templateId));
}

function bindDrag() {
  const svg = $('#overlay');
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    if (!state.job) return;
    const r = svg.getBoundingClientRect();
    const { width: W, height: H } = state.job.info;
    drag = { y: e.clientY, offset: state.style.offset, scale: Math.min(r.width / W, r.height / H), H, moved: false };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('dragging');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dyVideo = (e.clientY - drag.y) / drag.scale;
    if (Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
    const pct = (dyVideo / drag.H) * 100;
    const sign = state.style.placement === 'bottom' ? -1 : 1;
    const offset = Math.round(Math.min(45, Math.max(-40, drag.offset + sign * pct)) * 2) / 2;
    setStyle({ offset });
  });
  svg.addEventListener('pointerup', () => {
    if (drag && !drag.moved) togglePlay();
    drag = null;
    svg.classList.remove('dragging');
  });
}

// ---------------------------------------------------------- caption list

function snapshot() {
  state.undo.push(JSON.stringify(state.captions));
  if (state.undo.length > 100) state.undo.shift();
}

function undo() {
  const prev = state.undo.pop();
  if (!prev) return toast('Nothing to undo');
  state.captions = JSON.parse(prev);
  afterEdit();
}

function afterEdit() {
  state.captions.sort((a, b) => a.start - b.start);
  renderList();
  renderTimeline();
  recompute();
}

function mirrorHTML(c) {
  const esc = (s) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  return c.words.map((w) => (w.conf != null && w.conf < 0.5 ? `<mark>${esc(w.text)}</mark>` : esc(w.text)))
    .join(state.spaced ? ' ' : '');
}

function renderList() {
  const list = $('#cap-list');
  list.innerHTML = '';
  let low = false;
  state.captions.forEach((c, i) => {
    if (c.words.some((w) => w.conf != null && w.conf < 0.5)) low = true;
    const node = document.createElement('div');
    node.className = 'cap';
    node.dataset.i = i;
    node.innerHTML = `
      <div class="cap-head">
        <input data-f="start" value="${fmt(c.start, 2)}" title="Start">
        <span class="muted">→</span>
        <input data-f="end" value="${fmt(c.end, 2)}" title="End">
        <span class="spacer"></span>
        <button data-a="play" title="Play this caption">▶</button>
        <button data-a="split" title="Split in two">Split</button>
        <button data-a="merge" title="Merge with next">Merge</button>
        <button data-a="delete" title="Delete">✕</button>
      </div>
      <div class="cap-text"><div class="cap-mirror"></div><textarea rows="1" spellcheck="true"></textarea></div>`;
    const ta = $('textarea', node);
    ta.value = c.words.map((w) => w.text).join(state.spaced ? ' ' : '');
    $('.cap-mirror', node).innerHTML = mirrorHTML(c);
    list.appendChild(node);
  });
  $$('#cap-list textarea').forEach(autosize);
  $('#lowconf-hint').hidden = !low;
  lastActive = -2;
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

$('#cap-list').addEventListener('input', (e) => {
  if (e.target.tagName === 'TEXTAREA') {
    autosize(e.target);
    $('.cap-mirror', e.target.parentNode).textContent = '';
  }
});

$('#cap-list').addEventListener('change', (e) => {
  const node = e.target.closest('.cap');
  if (!node) return;
  const i = Number(node.dataset.i);
  const c = state.captions[i];
  snapshot();
  if (e.target.tagName === 'TEXTAREA') {
    const updated = retext(c, e.target.value, state.spaced);
    if (!updated.words.length) state.captions.splice(i, 1);
    else state.captions[i] = updated;
  } else {
    const start = e.target.dataset.f === 'start' ? parseTime(e.target.value) : c.start;
    const end = e.target.dataset.f === 'end' ? parseTime(e.target.value) : c.end;
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      state.undo.pop();
      toast('Enter a valid time like 0:12.40 (end must be after start).', true);
      e.target.value = fmt(e.target.dataset.f === 'start' ? c.start : c.end, 2);
      return;
    }
    state.captions[i] = retime(c, start, end);
  }
  afterEdit();
});

$('#cap-list').addEventListener('focusin', (e) => {
  const node = e.target.closest('.cap');
  if (!node || !video().paused) return;
  const c = state.captions[Number(node.dataset.i)];
  if (c && (video().currentTime < c.start || video().currentTime >= c.end)) {
    video().currentTime = c.start + 0.01;
  }
});

$('#cap-list').addEventListener('click', (e) => {
  const a = e.target.dataset.a;
  if (!a) return;
  const i = Number(e.target.closest('.cap').dataset.i);
  const cs = state.captions;
  const c = cs[i];
  if (a === 'play') {
    video().currentTime = c.start;
    video().play();
    const stop = () => { if (video().currentTime >= c.end) { video().pause(); video().removeEventListener('timeupdate', stop); } };
    video().addEventListener('timeupdate', stop);
    return;
  }
  snapshot();
  if (a === 'delete') cs.splice(i, 1);
  if (a === 'merge') {
    if (i + 1 >= cs.length) { state.undo.pop(); return toast('This is the last caption.'); }
    const n = cs[i + 1];
    cs.splice(i, 2, { ...c, end: n.end, words: [...c.words, ...n.words] });
  }
  if (a === 'split') {
    if (c.words.length < 2) { state.undo.pop(); return toast('A single word can’t be split.'); }
    const mid = Math.ceil(c.words.length / 2);
    const left = c.words.slice(0, mid), right = c.words.slice(mid);
    cs.splice(i, 1,
      { ...c, end: right[0].start, words: left },
      { id: `${c.id}b${Date.now()}`, start: right[0].start, end: c.end, words: right });
  }
  afterEdit();
});

function replaceAll() {
  const find = $('#find').value;
  if (!find) return;
  const repl = $('#replace').value;
  let count = 0;
  snapshot();
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  state.captions = state.captions.map((c) => {
    const text = c.words.map((w) => w.text).join(state.spaced ? ' ' : '');
    if (!re.test(text)) return c;
    re.lastIndex = 0;
    count += (text.match(re) || []).length;
    return retext(c, text.replace(re, repl), state.spaced);
  }).filter((c) => c.words.length);
  if (!count) { state.undo.pop(); return toast('No matches found.'); }
  afterEdit();
  toast(`Replaced ${count} occurrence${count > 1 ? 's' : ''}.`);
}

function shiftAll(delta) {
  snapshot();
  state.captions = state.captions.map((c) => retime(c, Math.max(0, c.start + delta), Math.max(0.05, c.end + delta)));
  afterEdit();
  toast(`Captions shifted ${delta > 0 ? '+' : ''}${Math.round(delta * 1000)} ms`, false, 1200);
}

function renderTimeline() {
  const dur = state.job.info.duration || 1;
  $('#tl-caps').innerHTML = state.captions.map((c, i) =>
    `<div class="tl-cap" data-i="${i}" style="left:${(c.start / dur) * 100}%;width:${((c.end - c.start) / dur) * 100}%"></div>`).join('');
}

// ----------------------------------------------------------------- export

function buildASS() {
  const { width, height } = state.job.info;
  return toASS(state.captions, state.style, state.font, width, height, { spaced: state.spaced, matrix: 'None' });
}

function baseName() {
  return (state.job?.name || 'video').replace(/\.[^.]+$/, '');
}

function exportFile(kind) {
  if (!state.captions.length) return toast('There are no captions to export.', true);
  const b = baseName();
  if (kind === 'srt') download(`${b}.srt`, toSRT(state.captions, state.style, state.spaced), 'application/x-subrip');
  if (kind === 'vtt') download(`${b}.vtt`, toVTT(state.captions, state.style, state.spaced), 'text/vtt');
  if (kind === 'ass') download(`${b}.ass`, buildASS(), 'text/x-ssa');
  if (kind === 'txt') download(`${b}.txt`, toTXT(state.captions, state.spaced));
}

function updateBurnDesc() {
  const { info } = state.job;
  const enc = info.vcodec === 'prores' ? 'ProRes (same profile)' : info.vcodec === 'hevc' ? 'HEVC' : 'H.264';
  const q = { max: 'visually lossless, slowest', high: 'visually identical to the source', fast: 'quickest, slightly larger quality trade-off' }[state.quality];
  $('#burn-desc').textContent = `Keeps ${info.width}×${info.height}, ${info.fps ? `${+info.fps.toFixed(3)} fps` : 'original frame timing'}, original audio untouched. Encoded as ${enc} — ${q}.`;
}

async function render(mode) {
  if (!state.captions.length) return toast('There are no captions to render.', true);
  const box = $('#render-status');
  box.hidden = false;
  $('#download').hidden = true;
  $('#render-bar').style.width = '0%';
  $('#render-text').textContent = 'Starting…';
  $('#render-burn').disabled = $('#render-soft').disabled = true;
  try {
    const body = mode === 'burn'
      ? { mode, ass: buildASS(), quality: state.quality }
      : { mode, srt: toSRT(state.captions, state.style, state.spaced), language: state.transcript.language };
    await api(`/api/jobs/${state.job.id}/render`, { method: 'POST', body: JSON.stringify(body) });
    for (;;) {
      await sleep(600);
      const j = await api(`/api/jobs/${state.job.id}`);
      state.job = j;
      const r = j.render;
      $('#render-bar').style.width = `${r.progress * 100}%`;
      if (r.status === 'error') throw new Error(r.error || 'Render failed');
      if (r.status === 'done') {
        $('#render-text').textContent = `Done in ${r.elapsed}s · ${r.file}`;
        const a = $('#download');
        a.href = `/api/jobs/${j.id}/download`;
        a.download = r.file;
        a.hidden = false;
        a.onclick = () => {
          state.exported = true;
          setTimeout(updateRetention, 1500);
        };
        updateRetention();
        return;
      }
      const eta = r.elapsed && r.progress > 0.05 ? Math.ceil(r.elapsed / r.progress - r.elapsed) : null;
      $('#render-text').textContent = mode === 'burn'
        ? `Rendering… ${Math.round(r.progress * 100)}%${eta != null ? ` · about ${eta}s left` : ''}`
        : 'Adding subtitle track…';
    }
  } catch (e) {
    $('#render-text').textContent = e.message;
    toast(e.message, true, 6000);
  } finally {
    $('#render-burn').disabled = $('#render-soft').disabled = false;
  }
}

async function updateRetention() {
  if (!state.job) return;
  try {
    const j = await api(`/api/jobs/${state.job.id}`);
    const mins = Math.max(0, Math.round((j.expiresAt * 1000 - Date.now()) / 60000));
    const el = $('#retention');
    el.hidden = false;
    el.textContent = `🔒 Files auto-delete in ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`}`;
  } catch {
    $('#retention').textContent = '🔒 Files deleted from server';
  }
  clearTimeout(updateRetention.timer);
  updateRetention.timer = setTimeout(updateRetention, 60000);
}

function deleteJob() {
  if (state.job) navigator.sendBeacon(`/api/jobs/${state.job.id}/delete`);
}

init().catch((e) => toast(`Failed to start: ${e.message}`, true, 10000));
