// A project's life: upload → automatic caption generation → editing → export.
import { chunkWords, flattenWords } from '../engine/chunk.js';
import { ensureFonts } from '../engine/fonts.js';
import { CaptionEngine } from '../engine/index.js';
import { fitsCaption, fontsFor } from '../engine/layout.js';
import { api, deleteJob, sleep, upload } from './api.js';
import { usedRange } from './premiere.js';
import { loadProject, newId, saveFile, saveProject } from './saved.js';
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

function firstStyle() {
  if (state.templateId) return state.style;
  const tpl = templateById(DEFAULT_TEMPLATE);
  set({ templateId: tpl.id, style: { ...tpl.style } });
  return state.style;
}

// Split words into captions at the current style, measuring real text widths.
export async function rechunk(words = flattenWords(state.captions)) {
  const info = state.project?.info || { width: 1920, height: 1080 };
  const style = state.style;
  const probe = [{ words }];
  await ensureFonts(fontsFor(probe, style));
  return chunkWords(words, style, (ws) => fitsCaption(ws, style, info.width, info.height));
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
    project: { kind: 'upload', name: file.name, file, src: URL.createObjectURL(file), info: null, job: null, saveId: newId() },
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
  // nothing may run past the end of the video
  const dur = state.project?.info?.duration || Infinity;
  let words = tr.words.filter((w) => w.start < dur - 0.05).map((w) => (w.end > dur ? { ...w, end: dur } : w));
  if (state.premiere) {
    // only the part of the clip used in the timeline
    const { from, to } = usedRange();
    words = words.filter((w) => w.end > from && w.start < to);
  }
  const captions = (await rechunk(words)).map((c) => (c.end > dur ? { ...c, end: dur } : c));
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

// ---------------------------------------------------------------- autosave & resume

// What's saved for a project; the video is stored separately, once.
function snapshot() {
  const p = state.project;
  const { words, ...transcript } = state.transcript || {}; // words live in the captions
  return {
    id: p.saveId, name: p.name, size: p.file?.size || 0, type: p.file?.type || '', info: p.info, job: p.job,
    captions: state.captions, style: state.style, templateId: state.templateId,
    transcript: state.transcript ? transcript : null, language: state.language, vocabulary: state.vocabulary,
    thumb: state.frameThumb || p.thumb || null, peaks: p.peaks || null, premiere: state.premiere || null,
  };
}

let saveTimer = 0;
subscribe((what) => {
  if (!['captions', 'style', 'history', 'transcript', 'project', 'thumb'].includes(what)) return;
  const p = state.project;
  if (!p?.saveId || !p.info || state.phase !== 'editing' || !state.captions.length) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (state.project !== p) return;
    if (await saveProject(snapshot())) { p.saved = true; emit('saved'); }
  }, 800);
});

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
    if (file.name !== record.name || file.size !== record.size) {
      return toast(`That isn’t the same video. Pick “${record.name}” to continue.`, 'error', 8000);
    }
    saveFile(id, file);
  }
  await leaveProject();
  runId++;
  set({
    project: { kind: 'upload', name: record.name, file, src: URL.createObjectURL(file), info: record.info, job: null,
      savedJob: record.job, saveId: id, saved: true, fileSaved: true, peaks: record.peaks, thumb: record.thumb },
    phase: 'editing', captions: record.captions, style: record.style, templateId: record.templateId,
    transcript: record.transcript, language: record.language || state.language, vocabulary: record.vocabulary || '',
    premiere: record.premiere || null,
    selected: null, progress: { upload: 1, transcribe: 1, message: '' },
  }, 'project');
  clearHistory();
  emit('captions');
  toast(`Welcome back to ${record.name}.`, 'ok', 2500);
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
export async function captionSelectedClip() {
  const { selectedClip } = await import('./premiere.js');
  let picked;
  try { picked = await selectedClip(); } catch (e) { return toast(e.message, 'error', 8000); }
  const { file, ...premiere } = picked;
  await startUpload(file, premiere);
}
