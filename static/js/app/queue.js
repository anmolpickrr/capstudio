// Batch queue: several videos dropped at once are captioned one after another in
// the background, each saved as a project in this browser (saved.js), while the
// editor reviews the ones that are ready. Each uses the language and starting style
// chosen when it was queued. The queue survives a reload; a video that was being
// worked on when the page closed starts again.
import { api, sleep, upload } from './api.js';
import { listProjects, loadProject, newId, removeProject, saveFile, saveProject, updateProject } from './saved.js';
import { captionsFromTranscript, firstStyle } from './session.js';
import { emit, state } from './store.js';
import { toast } from './ui.js';

const ACTIVE = ['waiting', 'uploading', 'captioning'];
const live = new Map(); // id → { stage, p }: progress of the video being worked on
let running = false;

export const liveProgress = (id) => live.get(id);

const isVideo = (f) => /^video\//.test(f.type) || /\.(mov|mkv|mp4|m4v|webm|avi|mxf)$/i.test(f.name);

// Queue videos. Returns how many were added.
export async function enqueue(files) {
  const max = state.config.maxUploadMB * 1024 * 1024;
  const ok = [...files].filter((f) => isVideo(f) && f.size <= max);
  const skipped = files.length - ok.length;
  const now = Date.now();
  firstStyle(); // the default style, when none was picked
  let added = 0;
  for (const [i, f] of ok.entries()) {
    const id = newId();
    if (!(await saveFile(id, f))) {
      toast(`${f.name} is too large to keep in this browser, so it can’t be queued. Open it on its own instead.`, 'error', 8000);
      continue;
    }
    await saveProject({ id, name: f.name, size: f.size, type: f.type, queue: 'waiting', queuedAt: now + i,
      language: state.language, vocabulary: state.vocabulary, style: state.style, templateId: state.templateId,
      captions: [], transcript: null, info: null, job: null, exported: false, opened: false });
    added++;
  }
  if (skipped) toast(`${skipped} file${skipped > 1 ? 's were' : ' was'} skipped: not a video, or larger than ${state.config.maxUploadMB} MB.`, 'error', 7000);
  if (added) toast(`${added} video${added > 1 ? 's' : ''} queued. They’re captioned one by one; open any that’s ready.`, 'ok', 5000);
  emit('queue');
  run();
  return added;
}

export async function retry(id) {
  await updateProject(id, { queue: 'waiting', error: null });
  emit('queue');
  run();
}

export async function remove(id) {
  await removeProject(id);
  live.delete(id);
  emit('queue');
}

// The queue in order, and what to open next.
export async function queueItems() {
  return (await listProjects()).filter((p) => p.queue).sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function nextReady(exceptId) {
  return (await queueItems()).find((p) => p.queue === 'ready' && !p.exported && p.id !== exceptId) || null;
}

// After a reload: videos that were being worked on start again.
export async function resumeQueue() {
  const items = await queueItems();
  for (const p of items) if (p.queue === 'uploading' || p.queue === 'captioning') await updateProject(p.id, { queue: 'waiting' });
  if (items.some((p) => ACTIVE.includes(p.queue))) run();
}

async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = (await queueItems()).find((p) => p.queue === 'waiting');
      if (!next) break;
      await processOne(next);
    }
  } finally {
    running = false;
  }
}

function progress(id, stage, p) {
  live.set(id, { stage, p });
  emit('queue');
}

async function processOne(rec) {
  const id = rec.id;
  try {
    const saved = await loadProject(id);
    if (!saved?.file) throw new Error('The video is no longer stored in this browser.');
    await updateProject(id, { queue: 'uploading' });
    progress(id, 'uploading', 0);
    const job = await upload(saved.file, (p) => progress(id, 'uploading', p));
    if (!job.info.acodec) throw new Error('This video has no audio track, so there is nothing to caption.');
    await updateProject(id, { queue: 'captioning', job: job.id, info: job.info });
    progress(id, 'captioning', 0);
    await api(`/api/jobs/${job.id}/transcribe`, { method: 'POST', body: { language: rec.language, vocabulary: rec.vocabulary } });
    let tr;
    for (;;) {
      await sleep(900);
      if (!(await loadProject(id))) return; // removed meanwhile
      const j = await api(`/api/jobs/${job.id}`);
      const t = j.transcription;
      if (t.status === 'error') throw new Error(t.error || 'Caption generation failed.');
      if (t.status === 'running') progress(id, 'captioning', t.progress);
      if (t.status === 'done') { tr = j.transcript; break; }
    }
    if (!tr.words.length) throw new Error('No speech was found in this video.');
    const captions = await captionsFromTranscript(tr, job.info, rec.style);
    const { words, ...transcript } = tr;
    await updateProject(id, { queue: 'ready', captions, transcript, thumb: await thumbnail(saved.file), error: null });
    live.delete(id);
    emit('queue');
    toast(`${rec.name} is ready to review.`, 'ok', 3500);
  } catch (e) {
    live.delete(id);
    await updateProject(id, { queue: 'error', error: e.message });
    emit('queue');
    toast(`${rec.name}: ${e.message}`, 'error', 7000);
  }
}

// A small picture of the video for the list (best effort).
function thumbnail(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (out) => { URL.revokeObjectURL(url); resolve(out); };
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    v.addEventListener('loadeddata', () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); }, { once: true });
    v.addEventListener('seeked', () => {
      try {
        const c = document.createElement('canvas');
        const k = 160 / Math.max(v.videoWidth, v.videoHeight, 1);
        c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', 0.7));
      } catch { done(null); }
    }, { once: true });
    v.addEventListener('error', () => done(null), { once: true });
    setTimeout(() => done(null), 8000);
  });
}
