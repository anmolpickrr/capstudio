// A project's life: upload → automatic caption generation → editing → export.
import { chunkWords, flattenWords } from '../engine/chunk.js';
import { ensureFonts } from '../engine/fonts.js';
import { CaptionEngine } from '../engine/index.js';
import { fitsCaption, fontsFor } from '../engine/layout.js';
import { api, deleteJob, sleep, upload } from './api.js';
import { usedRange } from './premiere.js';
import { loadProject, newId, saveFile, saveProject, updateProject } from './saved.js';
import { DEFAULT_TEMPLATE, templateById } from '../templates/library.js';
import { clearHistory, emit, set, state, subscribe } from './store.js';
import { toast } from './ui.js';

export const engine = new CaptionEngine();
let uploadReq = null;
let runId = 0;

const describeLang = (code) => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return code; }
};

export async function syncEngine() {
  const info = state.project?.info;
  await engine.set({
    captions: state.captions, style: state.style, W: info?.width || 1920, H: info?.height || 1080,
    spaced: state.transcript?.spaced ?? true,
  });
}

export function firstStyle() {
  if (state.templateId) return state.style;
  const tpl = templateById(DEFAULT_TEMPLATE);
  set({ templateId: tpl.id, style: { ...tpl.style } });
  return state.style;
}

// Split words into captions at the current style, measuring real text widths.
export async function rechunk(words = flattenWords(state.captions), style = state.style, info = state.project?.info) {
  const { width, height } = info || { width: 1920, height: 1080 };
  const probe = [{ words }];
  await ensureFonts(fontsFor(probe, style));
  return chunkWords(words, style, (ws) => fitsCaption(ws, style, width, height));
}

// Captions from a finished transcript: words past the end of the video dropped,
// split into captions at the style's length and the video's size.
export async function captionsFromTranscript(tr, info, style, range = null) {
  const dur = info?.duration || Infinity;
  let words = tr.words.filter((w) => w.start < dur - 0.05).map((w) => (w.end > dur ? { ...w, end: dur } : w));
  if (range) words = words.filter((w) => w.end > range.from && w.start < range.to);
  return (await rechunk(words, style, info)).map((c) => (c.end > dur ? { ...c, end: dur } : c));
}

// `premiere`: the clip picked in the Premiere Pro panel ({ sequence, clip, project });
// captions are then laid out at the sequence's frame size.
export async function startUpload(file, premiere = null) {
  const max = state.config.maxUploadMB * 1024 * 1024;
  if (file.size > max) return toast(`That file is larger than ${state.config.maxUploadMB} MB.`, 'error');
  if (!/^video\//.test(file.type) && !/\.(mov|mkv|mp4|m4v|webm|avi|mxf)$/i.test(file.name)) {
    return toast('That doesn’t look like a video file. Try MP4, MOV, MKV or WebM.', 'error');
  }
  await leaveProject();
  const id = ++runId;
  firstStyle();
  set({
    project: { kind: 'upload', name: file.name, source: file.name, file, src: URL.createObjectURL(file), info: null, job: null, saveId: newId() },
    phase: 'uploading', captions: [], transcript: null, selected: null, premiere,
    progress: { upload: 0, transcribe: 0, message: 'Uploading your video…' },
  }, 'project');
  clearHistory();
  const saveId = state.project.saveId;
  saveFile(saveId, file).then((ok) => { if (state.project?.saveId === saveId) state.project.fileSaved = ok; });
  try {
    uploadReq = upload(file, (p) => {
      state.progress.upload = p;
      state.progress.message = p < 1 ? `Uploading… ${Math.round(p * 100)}%` : 'Checking the video…';
      emit('progress');
    });
    const job = await uploadReq;
    if (id !== runId) return;
    state.project.job = job.id;
    state.project.info = premiere ? { ...job.info, width: premiere.sequence.width, height: premiere.sequence.height } : job.info;
    emit('project');
    if (!job.info.acodec) {
      set({ phase: 'editing', progress: { ...state.progress, message: '' } }, 'project');
      toast('This video has no audio track, so there is nothing to caption.', 'error', 8000);
      return;
    }
    await generate(id);
  } catch (e) {
    if (id !== runId) return;
    set({ phase: state.project?.info ? 'editing' : 'empty', project: state.project?.info ? state.project : null }, 'project');
    toast(e.message, 'error', 8000);
  }
}

export async function generate(id = ++runId, { language = state.language, vocabulary = state.vocabulary } = {}) {
  set({ phase: 'generating', progress: { ...state.progress, transcribe: 0, message: 'Listening to your video…' } }, 'project');
  try {
    const jobId = await ensureJob();
    await api(`/api/jobs/${jobId}/transcribe`, { method: 'POST', body: { language, vocabulary } });
    let t;
    for (;;) {
      await sleep(700);
      if (id !== runId) return;
      const j = await api(`/api/jobs/${jobId}`);
      t = j.transcription;
      state.progress.transcribe = t.progress;
      if (t.status === 'queued') {
        state.progress.message = t.ahead > 0 ? `${t.ahead} video${t.ahead > 1 ? 's' : ''} ahead of yours` : 'Starting…';
      } else if (t.status === 'running') {
        const eta = t.elapsed && t.progress > 0.15 ? Math.max(1, Math.round(t.elapsed / t.progress - t.elapsed)) : null;
        state.progress.message = t.progress < 0.05 ? 'Preparing the audio…'
          : `Writing captions… ${Math.round(t.progress * 100)}%${eta ? ` · about ${eta}s left` : ''}`;
      } else if (t.status === 'error') {
        throw new Error(t.error || 'Caption generation failed.');
      } else if (t.status === 'done') {
        await applyTranscript(j.transcript);
        return;
      }
      emit('progress');
    }
  } catch (e) {
    if (id !== runId) return;
    set({ phase: 'editing' }, 'project');
    toast(`Captions couldn't be generated: ${e.message}`, 'error', 10000);
  }
}

async function applyTranscript(tr) {
  if (!tr.words.length) {
    set({ phase: 'editing', transcript: tr, captions: [] }, 'project');
    toast('No speech was found in this video. If there is speech, pick the language and generate again.', 'error', 10000);
    return;
  }
  // in the Premiere panel, only the part of the clip used in the timeline
  const captions = await captionsFromTranscript(tr, state.project?.info, state.style, state.premiere ? usedRange() : null);
  set({ transcript: tr, captions, phase: 'editing', selected: null }, 'project');
  clearHistory();
  emit('captions');
  const lang = describeLang(tr.language);
  toast(`Captions ready: ${tr.words.length} words in ${lang}${tr.requested === 'auto' ? ' (detected automatically)' : ''}`, 'ok');
  if (tr.fallback) {
    toast('The fast caption service was busy, so the backup engine wrote these captions. Please check them carefully.', 'info', 9000);
  }
}

export async function leaveProject({ beacon = false } = {}) {
  runId++;
  uploadReq?.abort?.();
  uploadReq = null;
  const p = state.project;
  if (!p) return;
  if (p.job) deleteJob(p.job);
  if (p.src && p.kind === 'upload') URL.revokeObjectURL(p.src);
  if (!beacon) {
    set({ project: null, phase: 'empty', captions: [], transcript: null, selected: null, premiere: null }, 'project');
    clearHistory();
  }
}

// ---------------------------------------------------------------- name

// The name the video is saved and exported under (the extension stays the video's own).
export const stemOf = (name) => String(name || 'video').replace(/\.[^.]*$/, '');
export const extOf = (name) => (/\.[^./\\]+$/.exec(String(name || '')) || [''])[0];
export function cleanStem(text) {
  return String(text || '').replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120);
}
export function renameProject(text) {
  const p = state.project;
  const stem = cleanStem(text);
  if (!p || !stem || stem === stemOf(p.name)) return false;
  p.name = `${stem}${extOf(p.name) || extOf(p.source) || '.mp4'}`;
  emit('project');
  return true;
}
// A file named by the server (after the uploaded file) under the name chosen here.
export function chosenName(serverFile) {
  const p = state.project;
  if (!p || !serverFile) return serverFile;
  const from = stemOf(p.source || p.name), to = stemOf(p.name);
  return from !== to && serverFile.startsWith(from) ? to + serverFile.slice(from.length) : serverFile;
}

// ---------------------------------------------------------------- autosave & resume

// What's saved for a project; the video is stored separately, once.
function snapshot() {
  const p = state.project;
  const { words, ...transcript } = state.transcript || {}; // words live in the captions
  return {
    id: p.saveId, name: p.name, source: p.source || p.name, size: p.file?.size || 0, type: p.file?.type || '', info: p.info, job: p.job,
    captions: state.captions, style: state.style, templateId: state.templateId,
    transcript: state.transcript ? transcript : null, language: state.language, vocabulary: state.vocabulary,
    thumb: state.frameThumb || p.thumb || null, peaks: p.peaks || null, premiere: state.premiere || null,
    exported: !!p.exported, opened: true,
  };
}

let saveTimer = 0;
subscribe((what) => {
  if (!['captions', 'style', 'history', 'transcript', 'project', 'thumb'].includes(what)) return;
  if (what === 'project' && state.project?.exported && state.project.saveId) updateProject(state.project.saveId, { exported: true }).then(() => emit('queue'));
  const p = state.project;
  if (!p?.saveId || !p.info || state.phase !== 'editing' || !state.captions.length) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (state.project !== p) return;
    if (await saveProject(snapshot())) { p.saved = true; emit('saved'); }
  }, 800);
});

// Save now (before leaving for the editor). True when the project and its video are stored.
export async function saveSessionNow() {
  const p = state.project;
  if (!p?.saveId || !p.info || !state.captions.length) return false;
  clearTimeout(saveTimer);
  const ok = await saveProject(snapshot());
  if (ok) { p.saved = true; emit('saved'); }
  return ok && p.fileSaved !== false;
}

// Pick a saved project up again. The video comes from this browser's storage (or,
// if it couldn't be stored, from the file the editor picks again).
export async function resumeProject(id, pickFile) {
  const saved = await loadProject(id);
  if (!saved) return toast('That project is no longer saved in this browser.', 'error');
  const { record } = saved;
  let file = saved.file;
  if (!file) {
    file = await pickFile?.(record);
    if (!file) return;
    if (file.name !== (record.source || record.name) || file.size !== record.size) {
      return toast(`That isn’t the same video. Pick “${record.name}” to continue.`, 'error', 8000);
    }
    saveFile(id, file);
  }
  await leaveProject();
  runId++;
  set({
    project: { kind: 'upload', name: record.name, source: record.source || record.name, file, src: URL.createObjectURL(file), info: record.info, job: null,
      savedJob: record.job, saveId: id, saved: true, fileSaved: true, peaks: record.peaks, thumb: record.thumb,
      exported: !!record.exported },
    phase: 'editing', captions: record.captions, style: record.style, templateId: record.templateId,
    transcript: record.transcript, language: record.language || state.language, vocabulary: record.vocabulary || '',
    premiere: record.premiere || null,
    selected: null, progress: { upload: 1, transcribe: 1, message: '' },
  }, 'project');
  clearHistory();
  emit('captions');
  if (!record.opened) updateProject(id, { opened: true }).then(() => emit('queue'));
  // a freshly queued video's copy on the server is usually still there: use it
  if (record.job) {
    const p = state.project;
    api(`/api/jobs/${record.job}`).then(() => {
      if (state.project === p && !p.job) { p.job = record.job; p.savedJob = null; emit('project'); }
    }).catch(() => {});
  }
  toast(record.queue && !record.opened ? `${record.name}: check the captions, then export.` : `Welcome back to ${record.name}.`, 'ok', 2500);
}

// The server's copy of the video, for the jobs only the server can do (writing
// captions again, server exports, a playable preview). A resumed project's copy
// has usually expired: it's sent again, once, when first needed.
let sending = null;
export async function ensureJob() {
  const p = state.project;
  if (!p) throw new Error('No video is open.');
  if (p.job) return p.job;
  if (p.savedJob) {
    const old = p.savedJob;
    p.savedJob = null;
    try { await api(`/api/jobs/${old}`); p.job = old; emit('project'); return old; } catch { /* expired */ }
  }
  if (!p.file) throw new Error('The video isn’t available in this tab.');
  if (!sending) {
    toast('Sending the video to the server first…', 'info', 4000);
    sending = upload(p.file, () => {}).then((job) => {
      if (state.project === p) { p.job = job.id; emit('project'); }
      return job.id;
    }).finally(() => { sending = null; });
  }
  return sending;
}

// Premiere Pro panel: caption the clip selected in the timeline.
// The whole sequence or composition from the Adobe panel: its clips and files are sent,
// the server rebuilds the edit as one video (all voice-overs, music and video sound
// mixed; the picture for the preview), and that video is captioned over its full
// length. The captions are then placed over the whole edit.
export async function captionTimeline() {
  const { wholeTimeline } = await import('./premiere.js');
  let t;
  try { t = await wholeTimeline(); } catch (e) { return toast(e.message, 'error', 9000); }
  const seq = t.sequence;
  const name = `${(seq.name || 'Timeline').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Timeline'}.mp4`;
  const premiere = {
    app: t.app, project: t.project, sequence: seq, whole: true, skipped: t.skipped,
    clip: { name: seq.name, start: 0, end: t.duration, inPoint: 0, speed: 1, track: t.topTrack },
    layer: t.app === 'aftereffects' ? { index: 0, name: '' } : undefined,
  };
  await leaveProject();
  const id = ++runId;
  firstStyle();
  set({
    project: { kind: 'upload', name, source: name, file: null, src: null, info: null, job: null, saveId: newId() },
    phase: 'uploading', captions: [], transcript: null, selected: null, premiere,
    progress: { upload: 0, transcribe: 0, message: 'Sending the timeline…' },
  }, 'project');
  clearHistory();
  const status = (upload, message) => { state.progress.upload = upload; state.progress.message = message; emit('progress'); };
  try {
    const tl = await api('/api/timelines', { method: 'POST', body: {
      name: seq.name || 'Timeline', width: seq.width, height: seq.height, fps: seq.fps, duration: t.duration,
      files: t.files.map((f) => ({ name: f.name, size: f.size })), segments: t.clips,
    } });
    const total = t.files.reduce((n, f) => n + f.size, 0) || 1;
    let sent = 0;
    for (let i = 0; i < t.files.length; i++) {
      const f = t.files[i];
      uploadReq = upload(f, (p) => status(0.9 * (sent + p * f.size) / total,
        `Sending ${t.files.length > 1 ? `${i + 1} of ${t.files.length} media files` : 'the media'}… ${Math.round(100 * (sent + p * f.size) / total)}%`),
      `/api/timelines/${tl.id}/files/${i}`);
      await uploadReq;
      if (id !== runId) return;
      sent += f.size;
    }
    await api(`/api/timelines/${tl.id}/build`, { method: 'POST' });
    let job;
    for (;;) {
      await sleep(700);
      if (id !== runId) return;
      const s = await api(`/api/timelines/${tl.id}`);
      if (s.build.status === 'error') throw new Error(s.build.error || 'The timeline couldn’t be put together.');
      if (s.build.status === 'done') { job = s.job; premiere.used = s.used; break; }
      status(0.9 + 0.1 * s.build.progress, `Putting the edit together (${t.clips.length} clips)… ${Math.round(s.build.progress * 100)}%`);
    }
    const res = await fetch(`/api/jobs/${job.id}/source`);
    if (!res.ok) throw new Error('The rebuilt timeline couldn’t be loaded.');
    const file = new File([await res.blob()], name, { type: 'video/mp4' });
    if (id !== runId) return;
    Object.assign(state.project, { file, src: URL.createObjectURL(file), job: job.id, info: { ...job.info, width: seq.width, height: seq.height } });
    const saveId = state.project.saveId;
    saveFile(saveId, file).then((ok) => { if (state.project?.saveId === saveId) state.project.fileSaved = ok; });
    emit('project');
    if (t.skipped) toast(`${t.skipped} item${t.skipped > 1 ? 's' : ''} without a media file (titles, graphics or nested sequences) ${t.skipped > 1 ? 'were' : 'was'} left out. Everything else is captioned.`, 'info', 8000);
    await generate(id);
  } catch (e) {
    if (id !== runId) return;
    set({ phase: 'empty', project: null }, 'project');
    toast(e.message, 'error', 9000);
  }
}

export async function captionSelectedClip() {
  const { selectedClip } = await import('./premiere.js');
  let picked;
  try { picked = await selectedClip(); } catch (e) { return toast(e.message, 'error', 8000); }
  const { file, ...premiere } = picked;
  await startUpload(file, premiere);
}
