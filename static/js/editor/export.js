// Export: the edit as an MP4, made in the browser. Every video clip's frames are
// decoded exactly (not seeked from a player), each frame is drawn by the same
// compositor as the preview, and the sound of every clip is mixed with its
// volume, fades, keyframes and speed. Encoding uses the computer's own video
// hardware (WebCodecs), so nothing is uploaded.
import { CaptionEngine } from '../engine/index.js';
import { ensureFonts, fontById } from '../engine/fonts.js';
import { AUDIBLE, clone, duration, gainAt, transitionsFor } from './model.js';
import { bitmapOf, blobOf, mediabunny } from './media.js';
import { drawFrame, mediaTime } from './render.js';

export const canExport = () => typeof VideoEncoder === 'function' && typeof AudioEncoder === 'function' && typeof OffscreenCanvas === 'function';

const QUALITY = { max: 0.32, high: 0.18, small: 0.09 }; // bits per pixel per frame
const SR = 48000;
const even = (v) => Math.max(2, Math.round(v / 2) * 2);

// The project's sound, mixed: an AudioBuffer (null when nothing makes sound).
export async function mixAudio(p, dur = duration(p), signal = null) {
  const clips = p.clips.filter((c) => AUDIBLE.has(c.type) && p.assets[c.asset]?.hasAudio !== false
    && !c.audio?.mute && !(c.type === 'video' && c.audio?.detached) && !p.tracks.find((t) => t.id === c.track)?.muted);
  if (!clips.length || dur <= 0) return null;
  const mb = await mediabunny();
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(dur * SR)), SR);
  let any = false;
  for (const c of clips) {
    if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    const input = new mb.Input({ source: new mb.BlobSource(await blobOf(c.asset)), formats: mb.ALL_FORMATS });
    const at = await input.getPrimaryAudioTrack().catch(() => null);
    if (!at || !(await at.canDecode())) continue;
    const from = c.in, to = c.in + c.dur * c.speed;
    const parts = [];
    for await (const w of new mb.AudioBufferSink(at).buffers(from, to + 0.05)) parts.push(w);
    if (!parts.length) continue;
    const first = parts[0].timestamp, rate = parts[0].buffer.sampleRate, chans = Math.min(2, parts[0].buffer.numberOfChannels);
    const length = parts.reduce((n, w) => n + w.buffer.length, 0);
    const buf = ctx.createBuffer(chans, length, rate);
    let o = 0;
    for (const w of parts) {
      for (let ch = 0; ch < chans; ch++) buf.copyToChannel(w.buffer.getChannelData(Math.min(ch, w.buffer.numberOfChannels - 1)), ch, o);
      o += w.buffer.length;
    }
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.playbackRate.value = c.speed;
    const gain = ctx.createGain();
    // volume, fades and keyframes, 100 times a second
    const n = Math.max(2, Math.ceil(c.dur * 100));
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = gainAt(p, c, c.start + (i / (n - 1)) * c.dur);
    gain.gain.setValueAtTime(curve[0], 0);
    gain.gain.setValueCurveAtTime(curve, c.start, c.dur);
    node.connect(gain).connect(ctx.destination);
    node.start(c.start, Math.max(0, from - first), c.dur * c.speed);
    any = true;
  }
  return any ? ctx.startRendering() : null;
}

// Frames of a video clip, in order, for every frame of the export it's seen in.
async function clipFrames(mb, p, c, fps, frames) {
  const input = new mb.Input({ source: new mb.BlobSource(await blobOf(c.asset)), formats: mb.ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  if (!vt || !(await vt.canDecode())) throw new Error(`${p.assets[c.asset]?.name || 'A video'} can’t be decoded in this browser.`);
  const w = transitionsFor(p, c);
  const n0 = Math.max(0, Math.ceil(w.from * fps - 1e-6)), n1 = Math.min(frames - 1, Math.ceil(w.to * fps - 1e-6) - 1);
  const ts = [];
  for (let n = n0; n <= n1; n++) ts.push(mediaTime(p, c, n / fps));
  const sink = new mb.CanvasSink(vt, { poolSize: 2 });
  const it = sink.canvasesAtTimestamps(ts)[Symbol.asyncIterator]();
  return { n0, n1, it, cur: null };
}

export async function exportProject(project, { quality = 'high', scale = 1, onProgress, signal }) {
  if (!canExport()) throw new Error('Exporting needs a browser with video encoding: Chrome or Edge on a computer.');
  const p = clone(project);
  const mb = await mediabunny();
  const fps = p.fps || 30;
  const dur = duration(p);
  if (dur <= 0) throw new Error('Add something to the timeline first.');
  const frames = Math.max(1, Math.round(dur * fps));
  const W = even(p.W * scale), H = even(p.H * scale);
  const bitrate = Math.round(Math.min(80e6, W * H * fps * (QUALITY[quality] || QUALITY.high)));
  const codec = await mb.getFirstEncodableVideoCodec(globalThis.__exportCodecs || ['avc', 'vp9'], { width: W, height: H, bitrate });
  if (!codec) throw new Error('This browser can’t encode video at this size.');

  // everything drawn has to be ready first: fonts, images, captions
  await ensureFonts(p.clips.filter((c) => c.type === 'text').map((c) => fontById(c.text.font)));
  const images = new Map();
  for (const c of p.clips.filter((x) => x.type === 'image')) if (!images.has(c.asset)) images.set(c.asset, await bitmapOf(c.asset));
  const engines = new Map();
  for (const c of p.clips.filter((x) => x.type === 'captions' && x.style)) {
    const e = new CaptionEngine();
    const args = { captions: c.captions, style: c.style, W: p.W, H: p.H, spaced: c.spaced ?? true };
    await e.set(args); await e.set(args);
    engines.set(c.id, e);
  }

  onProgress?.(0, 'Mixing the sound…');
  const mix = await mixAudio(p, frames / fps, signal);
  const audioCodec = mix ? await mb.getFirstEncodableAudioCodec(globalThis.__exportAudioCodecs || ['aac', 'opus'], { numberOfChannels: 2, sampleRate: SR, bitrate: 192e3 }) : null;
  const format = codec === 'avc' || codec === 'hevc' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat();
  const ext = codec === 'avc' || codec === 'hevc' ? 'mp4' : 'webm';
  const output = new mb.Output({ format, target: new mb.BufferTarget() });
  const out = new OffscreenCanvas(W, H), octx = out.getContext('2d');
  const full = scale === 1 ? out : new OffscreenCanvas(p.W, p.H), fctx = full.getContext('2d');
  const video = new mb.CanvasSource(out, { codec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = audioCodec ? new mb.AudioBufferSource({ codec: audioCodec, bitrate: 192e3 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  // video clips' frames, opened as they come up and closed when done
  const pending = p.clips.filter((c) => c.type === 'video' && !p.tracks.find((t) => t.id === c.track)?.hidden)
    .map((c) => ({ c, w: transitionsFor(p, c) })).sort((a, b) => a.w.from - b.w.from);
  const open = new Map();
  const current = new Map();
  const src = {
    frame: (c) => current.get(c.id) || null,
    image: (id) => images.get(id) || null,
    captions: (c) => engines.get(c.id) || null,
  };

  let audioDone = 0;
  const addAudioUntil = async (t) => {
    if (!audio || !mix) return;
    const upto = Math.min(mix.length, Math.ceil(t * SR));
    while (audioDone < upto) {
      const n = Math.min(SR * 2, upto - audioDone);
      const chunk = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: SR });
      for (let ch = 0; ch < 2; ch++) chunk.copyToChannel(mix.getChannelData(ch).subarray(audioDone, audioDone + n), ch);
      await audio.add(chunk);
      audioDone += n;
    }
  };

  const t0 = performance.now();
  try {
    for (let n = 0; n < frames; n++) {
      if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
      const t = n / fps;
      while (pending.length && Math.ceil(pending[0].w.from * fps - 1e-6) <= n) {
        const { c } = pending.shift();
        open.set(c.id, await clipFrames(mb, p, c, fps, frames));
      }
      current.clear();
      for (const [id, f] of open) {
        if (n < f.n0) continue;
        if (n > f.n1) { await f.it.return?.(); open.delete(id); continue; }
        const r = await f.it.next();
        if (!r.done && r.value) f.cur = { img: r.value.canvas, w: r.value.canvas.width, h: r.value.canvas.height };
        if (f.cur) current.set(id, f.cur);
      }
      drawFrame(fctx, p, t, src);
      if (full !== out) { octx.drawImage(full, 0, 0, W, H); }
      await addAudioUntil(t + 1);
      await video.add(t, 1 / fps);
      if (n % 5 === 0) onProgress?.((n + 1) / frames, `Making frame ${n + 1} of ${frames}`, (performance.now() - t0) / 1000);
    }
    await addAudioUntil(frames / fps + 1);
    video.close();
    audio?.close();
    await output.finalize();
  } catch (e) {
    for (const f of open.values()) await f.it.return?.().catch(() => {});
    await output.cancel().catch(() => {});
    throw e;
  }
  const blob = new Blob([output.target.buffer], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' });
  const safe = (p.name || 'video').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'video';
  return { blob, file: `${safe}.${ext}`, size: blob.size, elapsed: (performance.now() - t0) / 1000, W, H, frames };
}
