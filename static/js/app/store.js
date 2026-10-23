// App state with undo/redo. Editable content (captions, style, template) is
// versioned; everything else (playback, progress, UI) is not.
import { WATERMARK_DEFAULT } from '../engine/watermark.js';
import { DEFAULT_STYLE } from '../templates/base.js';

export const state = {
  config: null,
  user: null,
  route: 'studio',
  project: null,        // { kind: 'upload', job, info, name, file?, src }
  phase: 'empty',       // empty | uploading | generating | editing
  progress: { upload: 0, transcribe: 0, message: '' },
  transcript: null,     // { language, requested, spaced, engine, fallback, words }
  captions: [],
  style: { ...DEFAULT_STYLE },
  templateId: null,
  selected: null,       // selected caption id
  tool: 'templates',
  safeZone: 'off',      // safe-zone overlay shown on the preview (see safezones.js)
  language: 'auto',
  vocabulary: '',
  watermark: loadWatermark(), // fastrr watermark, remembered in this browser
  premiere: null,       // in the Premiere Pro panel: { sequence, clip, project } being captioned
};

function loadWatermark() {
  try { return { ...WATERMARK_DEFAULT, ...JSON.parse(localStorage.getItem('capstudio-watermark') || '{}') }; }
  catch { return { ...WATERMARK_DEFAULT }; }
}

export function setWatermark(patch) {
  state.watermark = { ...state.watermark, ...patch };
  try { localStorage.setItem('capstudio-watermark', JSON.stringify(state.watermark)); } catch { /* private window */ }
  emit('watermark');
}

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { listeners.forEach((fn) => fn(what)); }

export function set(patch, what = 'state') {
  Object.assign(state, patch);
  emit(what);
}

// ---------------------------------------------------------------- history
const past = [], future = [];
let lastKey = null, lastAt = 0;
const snap = () => JSON.stringify({ captions: state.captions, style: state.style, templateId: state.templateId });

// Call before an edit. Repeated edits of the same kind within a moment (a
// slider drag, typing) collapse into one undo step.
export function checkpoint(key = null) {
  const now = Date.now();
  if (key && key === lastKey && now - lastAt < 900) { lastAt = now; return; }
  lastKey = key; lastAt = now;
  past.push(snap());
  if (past.length > 200) past.shift();
  future.length = 0;
  emit('history');
}

function restore(json) {
  const s = JSON.parse(json);
  state.captions = s.captions; state.style = s.style; state.templateId = s.templateId;
  lastKey = null;
  emit('captions'); emit('style'); emit('history');
}

export function undo() { if (!past.length) return false; future.push(snap()); restore(past.pop()); return true; }
export function redo() { if (!future.length) return false; past.push(snap()); restore(future.pop()); return true; }
export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
export function clearHistory() { past.length = 0; future.length = 0; emit('history'); }

// ---------------------------------------------------------------- edits
export function setStyle(patch, key = null) {
  checkpoint(key || Object.keys(patch).join(','));
  state.style = { ...state.style, ...patch };
  emit('style');
}

export function setCaptions(captions, key = null) {
  checkpoint(key);
  state.captions = [...captions].sort((a, b) => a.start - b.start);
  emit('captions');
}
