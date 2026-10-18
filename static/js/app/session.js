// A project's life: upload → automatic caption generation → editing → export.
import { chunkWords, flattenWords } from '../engine/chunk.js';
import { ensureFonts } from '../engine/fonts.js';
import { CaptionEngine } from '../engine/index.js';
import { fitsCaption, fontsFor } from '../engine/layout.js';
import { api, deleteJob, sleep, upload } from './api.js';
import { DEFAULT_TEMPLATE, templateById } from '../templates/library.js';
import { clearHistory, emit, set, state } from './store.js';
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

export async function startUpload(file) {
  const max = state.config.maxUploadMB * 1024 * 1024;
  if (file.size > max) return toast(`That file is larger than ${state.config.maxUploadMB} MB.`, 'error');
  if (!/^video\//.test(file.type) && !/\.(mov|mkv|mp4|m4v|webm|avi|mxf)$/i.test(file.name)) {
    return toast('That doesn’t look like a video file. Try MP4, MOV, MKV or WebM.', 'error');
  }
  await leaveProject();
  const id = ++runId;
  firstStyle();
  set({
    project: { kind: 'upload', name: file.name, file, src: URL.createObjectURL(file), info: null, job: null },
    phase: 'uploading', captions: [], transcript: null, selected: null,
    progress: { upload: 0, transcribe: 0, message: 'Uploading your video…' },
  }, 'project');
  clearHistory();
  try {
    uploadReq = upload(file, (p) => {
      state.progress.upload = p;
      state.progress.message = p < 1 ? `Uploading… ${Math.round(p * 100)}%` : 'Checking the video…';
      emit('progress');
    });
    const job = await uploadReq;
    if (id !== runId) return;
    state.project.job = job.id;
    state.project.info = job.info;
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
  const jobId = state.project.job;
  set({ phase: 'generating', progress: { ...state.progress, transcribe: 0, message: 'Listening to your video…' } }, 'project');
  try {
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
  const words = tr.words.filter((w) => w.start < dur - 0.05).map((w) => (w.end > dur ? { ...w, end: dur } : w));
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
    set({ project: null, phase: 'empty', captions: [], transcript: null, selected: null }, 'project');
    clearHistory();
  }
}
