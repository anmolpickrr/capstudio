// The editor's state: the open project, selection, playhead and tools, with undo
// and redo, and autosave to this browser's storage (projects and their media
// files), so nothing is lost when the tab closes.
import { clone } from './model.js';

export const ed = {
  project: null,
  selection: [],        // selected clip ids
  playhead: 0,
  playing: false,
  zoom: 80,             // timeline pixels per second
  tool: 'select',       // select | razor
  snap: true,
  ripple: false,
};

const listeners = new Set();
export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = (what) => listeners.forEach((fn) => fn(what));

// ---------------------------------------------------------------- history

const past = [], future = [];
let lastKey = null, lastAt = 0;

// Change the project. Edits with the same key in quick succession (a slider drag)
// are one undo step.
export function edit(fn, key = null) {
  const now = Date.now();
  if (!(key && key === lastKey && now - lastAt < 900)) {
    past.push(JSON.stringify(ed.project));
    if (past.length > 300) past.shift();
    future.length = 0;
  }
  lastKey = key; lastAt = now;
  const out = fn(ed.project);
  ed.project.rev = (ed.project.rev || 0) + 1; // (cached results about the project are stale)
  ed.selection = ed.selection.filter((id) => ed.project.clips.some((c) => c.id === id));
  emit('project');
  scheduleSave();
  return out;
}

export function undo() {
  if (!past.length) return false;
  future.push(JSON.stringify(ed.project));
  ed.project = JSON.parse(past.pop());
  lastKey = null;
  ed.selection = ed.selection.filter((id) => ed.project.clips.some((c) => c.id === id));
  emit('project'); scheduleSave();
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(JSON.stringify(ed.project));
  ed.project = JSON.parse(future.pop());
  lastKey = null;
  emit('project'); scheduleSave();
  return true;
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

export function openProject(p) {
  ed.project = p;
  ed.selection = [];
  ed.playhead = 0;
  past.length = 0; future.length = 0; lastKey = null;
  emit('open');
}

export function select(ids, add = false) {
  ed.selection = add ? [...new Set([...ed.selection, ...ids])] : ids;
  emit('selection');
}

export const selectedClips = () => ed.selection.map((id) => ed.project.clips.find((c) => c.id === id)).filter(Boolean);

export function setPlayhead(t) {
  ed.playhead = Math.max(0, t);
  emit('time');
}

// ---------------------------------------------------------------- storage

const DB = 'capstudio-editor', VERSION = 1;
let dbp = null;

function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('projects', { keyPath: 'id' });
      req.result.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { dbp = null; throw e; });
  return dbp;
}

export async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

let saveTimer = null, thumbFn = null;
export function setThumbSource(fn) { thumbFn = fn; }

export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}

export async function saveNow() {
  clearTimeout(saveTimer);
  const p = ed.project;
  if (!p) return false;
  try {
    const record = { ...clone(p), savedAt: Date.now() };
    try { record.thumb = thumbFn?.() || null; } catch { record.thumb = null; }
    await idb('projects', 'readwrite', (s) => s.put(record));
    emit('saved');
    return true;
  } catch { emit('save-failed'); return false; }
}

export async function listProjects() {
  try {
    const all = await idb('projects', 'readonly', (s) => s.getAll());
    return all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch { return []; }
}

export const loadProject = (id) => idb('projects', 'readonly', (s) => s.get(id)).catch(() => null);

export async function deleteProject(id) {
  const p = await loadProject(id);
  await idb('projects', 'readwrite', (s) => s.delete(id)).catch(() => {});
  // media files no other project uses
  if (!p) return;
  const others = (await listProjects()).flatMap((x) => Object.keys(x.assets || {}));
  for (const a of Object.keys(p.assets || {})) if (!others.includes(a)) await idb('files', 'readwrite', (s) => s.delete(a)).catch(() => {});
}

export const putFile = (id, blob) => idb('files', 'readwrite', (s) => s.put(blob, id));
export const getFile = (id) => idb('files', 'readonly', (s) => s.get(id)).catch(() => null);
