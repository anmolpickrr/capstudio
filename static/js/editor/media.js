// Media in the editor: importing files (kept in this browser's storage with the
// project), reading their size, length and tracks, and the pictures the timeline
// shows for them (frame thumbnails, audio waveforms).
import { uid } from './model.js';
import { getFile, putFile } from './store.js';

const LIB = '/vendor/mediabunny-1.61.0.min.js';
let mbp = null;
export const mediabunny = () => (mbp ||= import(LIB));

const blobs = new Map(), urls = new Map(), bitmaps = new Map(), thumbCache = new Map(), peakCache = new Map();

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|mxf)$/i, AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/i, IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;

export function kindOf(file) {
  const t = file.type || '';
  if (t.startsWith('video/') || VIDEO_EXT.test(file.name)) return 'video';
  if (t.startsWith('audio/') || AUDIO_EXT.test(file.name)) return 'audio';
  if (t.startsWith('image/') || IMAGE_EXT.test(file.name)) return 'image';
  return null;
}

function elementProbe(file, kind) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    const url = URL.createObjectURL(file);
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => {
      resolve({ duration: el.duration, width: el.videoWidth || 0, height: el.videoHeight || 0, fps: 30, hasAudio: true });
      URL.revokeObjectURL(url);
    };
    el.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} can't be played in this browser.`)); };
    el.src = url;
  });
}

// Size, length, frame rate and tracks of a file.
export async function probe(file, kind) {
  if (kind === 'image') {
    const bmp = await createImageBitmap(file);
    return { width: bmp.width, height: bmp.height, duration: null, bitmap: bmp };
  }
  try {
    const mb = await mediabunny();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const duration = await input.computeDuration();
    const at = await input.getPrimaryAudioTrack().catch(() => null);
    const hasAudio = !!at && (await at.canDecode().catch(() => false));
    if (kind === 'audio') return { duration, hasAudio };
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error('no video track');
    const stats = await vt.computePacketStats(90).catch(() => null);
    return { duration, width: vt.displayWidth, height: vt.displayHeight, fps: Math.round((stats?.averagePacketRate || 30) * 1000) / 1000,
      hasAudio, decodable: await vt.canDecode().catch(() => false) };
  } catch {
    return elementProbe(file, kind);
  }
}

// Import files: stored with the project, described in project.assets. Returns
// the new assets, and the files that couldn't be used.
export async function importFiles(files) {
  const added = [], skipped = [];
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) { skipped.push(`${file.name} (not a video, audio or image file)`); continue; }
    try {
      const info = await probe(file, kind);
      const id = uid('a');
      await putFile(id, file).catch(() => { throw new Error('there is no room left in this browser’s storage'); });
      blobs.set(id, file);
      if (info.bitmap) { bitmaps.set(id, info.bitmap); delete info.bitmap; }
      added.push({ id, name: file.name, kind, mime: file.type, size: file.size, addedAt: Date.now(), ...info });
    } catch (e) {
      skipped.push(`${file.name} (${e.message})`);
    }
  }
  return { added, skipped };
}

export async function blobOf(id) {
  if (!blobs.has(id)) {
    const b = await getFile(id);
    if (!b) throw new Error('A media file of this project is missing from this browser.');
    blobs.set(id, b);
  }
  return blobs.get(id);
}

export async function urlOf(id) {
  if (!urls.has(id)) urls.set(id, URL.createObjectURL(await blobOf(id)));
  return urls.get(id);
}

export const cachedBitmap = (id) => bitmaps.get(id) || null;
export async function bitmapOf(id) {
  if (!bitmaps.has(id)) bitmaps.set(id, await createImageBitmap(await blobOf(id)));
  return bitmaps.get(id);
}

// Small frames across a video, for its clips on the timeline: [{ t, img }].
export async function thumbnails(asset, height = 64) {
  if (thumbCache.has(asset.id)) return thumbCache.get(asset.id);
  const job = (async () => {
    if (asset.kind === 'image') return [{ t: 0, img: await bitmapOf(asset.id) }];
    const mb = await mediabunny();
    const input = new mb.Input({ source: new mb.BlobSource(await blobOf(asset.id)), formats: mb.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack();
    if (!vt || !(await vt.canDecode())) return [];
    const n = Math.max(1, Math.min(40, Math.ceil(asset.duration / 1.5)));
    const ts = Array.from({ length: n }, (_, i) => (asset.duration * (i + 0.5)) / n);
    const w = Math.round((height * asset.width) / Math.max(1, asset.height));
    const sink = new mb.CanvasSink(vt, { width: w, height, fit: 'fill', poolSize: 0 });
    const out = [];
    for await (const r of sink.canvasesAtTimestamps(ts)) {
      if (r) out.push({ t: r.timestamp, img: await createImageBitmap(r.canvas) });
    }
    return out;
  })().catch(() => []);
  thumbCache.set(asset.id, job);
  return job;
}

// Loudness peaks every 1/100 s (0..1), for waveforms.
export async function waveform(asset) {
  if (peakCache.has(asset.id)) return peakCache.get(asset.id);
  const job = (async () => {
    const mb = await mediabunny();
    const input = new mb.Input({ source: new mb.BlobSource(await blobOf(asset.id)), formats: mb.ALL_FORMATS });
    const at = await input.getPrimaryAudioTrack();
    if (!at || !(await at.canDecode())) return null;
    const peaks = new Float32Array(Math.ceil((asset.duration || 0) * 100) + 1);
    const sink = new mb.AudioBufferSink(at);
    for await (const { buffer, timestamp } of sink.buffers()) {
      const ch = buffer.getChannelData(0), sr = buffer.sampleRate;
      for (let i = 0; i < ch.length; i += 16) {
        const k = Math.floor((timestamp + i / sr) * 100);
        const v = Math.abs(ch[i]);
        if (k >= 0 && k < peaks.length && v > peaks[k]) peaks[k] = v;
      }
    }
    return peaks;
  })().catch(() => null);
  peakCache.set(asset.id, job);
  return job;
}

export function forget(id) {
  if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
  urls.delete(id); blobs.delete(id); bitmaps.delete(id); thumbCache.delete(id); peakCache.delete(id);
}
