// Autosave: each project (captions, style, settings and the video itself) is kept
// in this browser's storage, so closing the tab or a server restart loses nothing.
// The first page lists recent projects to pick up again. Storage can be refused
// (private windows, a full disk); everything here then quietly does nothing.

const DB = 'capstudio', VERSION = 1, KEEP = 5;
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' });
        req.result.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { dbp = null; throw e; });
  }
  return dbp;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

export const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// The video, once per project. Returns false when the browser won't store it
// (too big for the free space): the project is still saved, and resuming asks
// for the file again.
export async function saveFile(id, file) {
  try {
    navigator.storage?.persist?.().catch(() => {});
    await run('files', 'readwrite', (s) => s.put(file, id));
    return true;
  } catch { return false; }
}

export async function saveProject(record) {
  try {
    await run('projects', 'readwrite', (s) => s.put({ ...record, savedAt: Date.now() }));
    await prune();
    return true;
  } catch { return false; }
}

export async function listProjects() {
  try {
    const all = await run('projects', 'readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => b.savedAt - a.savedAt);
  } catch { return []; }
}

export async function loadProject(id) {
  try {
    const [record, file] = await Promise.all([
      run('projects', 'readonly', (s) => s.get(id)),
      run('files', 'readonly', (s) => s.get(id)),
    ]);
    return record ? { record, file: file || null } : null;
  } catch { return null; }
}

export async function removeProject(id) {
  try {
    await run('projects', 'readwrite', (s) => s.delete(id));
    await run('files', 'readwrite', (s) => s.delete(id));
  } catch { /* nothing stored */ }
}

// Keep the most recent few; older videos would only fill the disk.
async function prune() {
  const all = await listProjects();
  for (const p of all.slice(KEEP)) await removeProject(p.id);
}
