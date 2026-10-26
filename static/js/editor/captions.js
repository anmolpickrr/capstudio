// Captions in the editor: caption the edit itself (its mixed sound is sent to the
// same speech engine as Capstudio, so captions follow the cut, music and all), or
// bring in a Capstudio project with its captions and style. Captions are a clip
// on a video track, styled with Capstudio's templates.
import { api, deleteJob, sleep, upload } from '../app/api.js';
import { icon } from '../app/icons.js';
import { listProjects as listCapstudio, loadProject as loadCapstudio } from '../app/saved.js';
import { fmtTime, h, toast } from '../app/ui.js';
import { chunkWords } from '../engine/chunk.js';
import { ensureFonts } from '../engine/fonts.js';
import { fitsCaption, fontsFor } from '../engine/layout.js';
import { DEFAULT_TEMPLATE, TEMPLATES, templateById } from '../templates/library.js';
import { addAsset } from './actions.js';
import { mixAudio } from './export.js';
import { importFiles, mediabunny } from './media.js';
import { addClip, addTrack, duration, isFree, makeClip } from './model.js';
import { ed, edit, select } from './store.js';

let config = { languages: [] };
export function setConfig(c) { config = c; }

// The mixed sound in a small MP4 (a tiny blank picture plus the sound), which the
// caption service accepts like any video.
async function soundFile(p, dur) {
  const mix = await mixAudio(p, dur);
  if (!mix) throw new Error('This edit has no sound to caption.');
  const mb = await mediabunny();
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
  const cv = new OffscreenCanvas(64, 64), g = cv.getContext('2d');
  const vcodec = await mb.getFirstEncodableVideoCodec(globalThis.__exportCodecs || ['avc', 'vp9'], { width: 64, height: 64, bitrate: 50e3 });
  const acodec = await mb.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: mix.sampleRate, bitrate: 128e3 });
  if (!vcodec || !acodec) throw new Error('This browser can’t prepare the sound for captioning.');
  const video = new mb.CanvasSource(cv, { codec: vcodec, bitrate: 50e3, keyFrameInterval: 10 });
  const audio = new mb.AudioBufferSource({ codec: acodec, bitrate: 128e3 });
  output.addVideoTrack(video, { frameRate: 1 });
  output.addAudioTrack(audio);
  await output.start();
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64);
  const secs = Math.ceil(dur);
  for (let s = 0; s < secs; s++) {
    const n = Math.min(mix.sampleRate, mix.length - s * mix.sampleRate);
    if (n > 0) {
      const chunk = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: mix.sampleRate });
      for (let ch = 0; ch < 2; ch++) chunk.copyToChannel(mix.getChannelData(ch).subarray(s * mix.sampleRate, s * mix.sampleRate + n), ch);
      await audio.add(chunk);
    }
    await video.add(s, 1);
  }
  video.close(); audio.close();
  await output.finalize();
  return new File([output.target.buffer], `${ed.project.name || 'edit'} sound.mp4`, { type: 'video/mp4' });
}

// A captions clip from words (in timeline time), on the top video track.
async function placeCaptions(words, style, spaced = true, name = 'Captions') {
  const p = ed.project;
  await ensureFonts(fontsFor([{ words }], style));
  const caps = chunkWords(words, style, (ws) => fitsCaption(ws, style, p.W, p.H));
  const dur = Math.max(duration(p), ...caps.map((c) => c.end));
  const c = makeClip('captions', { name, captions: caps, style: { ...style }, dur, spaced, templateId: TEMPLATES.find((t) => JSON.stringify(t.style) === JSON.stringify(style))?.id });
  edit((proj) => {
    const top = proj.tracks.find((t) => t.type === 'video' && !t.locked && isFree(proj, t.id, 0, dur)) || addTrack(proj, 'video');
    addClip(proj, c, { track: top.id, at: 0 });
  });
  select([c.id]);
  return caps.length;
}

export async function autoCaption({ language, templateId, onStatus }) {
  const p = ed.project;
  const dur = duration(p);
  if (dur <= 0) throw new Error('Add a video or sound to the timeline first.');
  onStatus('Mixing the sound…');
  const file = await soundFile(p, dur);
  onStatus('Sending the sound…');
  const job = await upload(file, (x) => onStatus(`Sending the sound… ${Math.round(x * 100)}%`));
  try {
    await api(`/api/jobs/${job.id}/transcribe`, { method: 'POST', body: { language, vocabulary: '' } });
    let tr;
    for (;;) {
      await sleep(900);
      const j = await api(`/api/jobs/${job.id}`);
      const t = j.transcription;
      if (t.status === 'error') throw new Error(t.error || 'Captioning failed.');
      if (t.status === 'running') onStatus(`Listening… ${Math.round((t.progress || 0) * 100)}%`);
      if (t.status === 'done') { tr = j.transcript; break; }
    }
    if (!tr.words.length) throw new Error('No speech was found in this edit.');
    const style = (templateById(templateId) || templateById(DEFAULT_TEMPLATE)).style;
    const words = tr.words.filter((w) => w.start < dur).map((w) => ({ ...w, end: Math.min(w.end, dur) }));
    return placeCaptions(words, style, tr.spaced ?? true);
  } finally {
    deleteJob(job.id);
  }
}

// A Capstudio project: its video on the timeline at 0:00, with its captions and style.
export async function fromCapstudio(id, { withVideo = true } = {}) {
  const saved = await loadCapstudio(id);
  if (!saved) throw new Error('That Capstudio project is no longer in this browser.');
  const { record, file } = saved;
  let videoClip = null;
  if (withVideo && file) {
    const { added } = await importFiles([new File([file], record.name || file.name || 'video.mp4', { type: file.type })]);
    if (added[0]) {
      edit((p) => { p.assets[added[0].id] = added[0]; });
      videoClip = addAsset(added[0], 0, ed.project.tracks.filter((t) => t.type === 'video').at(-1).id);
    }
  }
  if (record.captions?.length && record.style) {
    const words = record.captions.flatMap((c) => c.words);
    await placeCaptions(words, record.style, record.transcript?.spaced ?? true, `Captions · ${record.name || 'Capstudio'}`);
  }
  return { videoClip, captions: record.captions?.length || 0 };
}

// The Captions tab of the library.
export function captionsPanel() {
  const lang = h('select', { class: 'select', 'aria-label': 'Spoken language' },
    h('option', { value: 'auto' }, 'Detect automatically'),
    (config.languages || []).filter((l) => !l.unsupported && l.id !== 'auto').map((l) => h('option', { value: l.id }, l.label)));
  const style = h('select', { class: 'select', 'aria-label': 'Caption style' }, TEMPLATES.map((t) => h('option', { value: t.id }, t.name)));
  style.value = DEFAULT_TEMPLATE;
  const status = h('p', { class: 'hint' });
  const go = h('button', { class: 'btn brand', type: 'button', html: `${icon('captions')}<span>Caption this edit</span>`, onclick: async () => {
    go.disabled = true;
    try {
      const n = await autoCaption({ language: lang.value, templateId: style.value, onStatus: (s) => { status.textContent = s; } });
      status.textContent = '';
      toast(`${n} captions added on the top track. Pick another style on the right any time.`, 'ok', 5000);
    } catch (e) {
      status.textContent = '';
      toast(e.message, 'error', 8000);
    } finally { go.disabled = false; }
  } });
  const recent = h('div', { class: 'lib-recent' }, h('p', { class: 'hint' }, 'Loading…'));
  listCapstudio().then((items) => {
    const done = items.filter((r) => r.captions?.length);
    recent.replaceChildren(...(done.length ? done.slice(0, 8).map((r) => h('div', { class: 'lib-recent-item' },
      r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('span', { class: 'lib-recent-ph', html: icon('film') }),
      h('div', {}, h('b', {}, r.name || 'Video'), h('small', {}, `${r.captions.length} captions${r.info?.duration ? ` · ${fmtTime(r.info.duration, 0)}` : ''}`)),
      h('button', { class: 'btn sm', type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { const r2 = await fromCapstudio(r.id); toast(`Added ${r2.videoClip ? 'the video and ' : ''}${r2.captions} captions.`, 'ok', 3500); } catch (err) { toast(err.message, 'error', 6000); }
      } }, 'Add'))) : [h('p', { class: 'hint' }, 'Videos you caption in Capstudio show up here.')]));
  });
  return [
    h('h4', { class: 'lib-h' }, 'Caption this edit'),
    h('p', { class: 'hint' }, 'Listens to the edit’s sound, so captions match your cuts and speed changes. Each caption is styled like in Capstudio.'),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Language'), lang),
    h('label', { class: 'field' }, h('span', { class: 'label' }, 'Style'), style),
    go, status,
    h('h4', { class: 'lib-h' }, 'From Capstudio'),
    recent,
  ];
}
