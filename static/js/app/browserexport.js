// Export in the browser: decode the original file, draw the captions on each
// frame with the canvas renderer, and encode with the computer's own video
// hardware (WebCodecs). Much faster than the small server, and nothing has to be
// uploaded or downloaded again. Throws Unsupported when this browser or file
// can't be handled, so the caller can fall back to the server.
import { CanvasRenderer } from '../engine/canvas.js';
import { CaptionEngine } from '../engine/index.js';
import { drawFrame } from '../engine/reframe.js';
import { watermarkFile, watermarkRect } from '../engine/watermark.js';

const LIB = '/vendor/mediabunny-1.61.0.min.js';
const MP4_AUDIO = new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac']);
const MAX_BYTES = 2e9; // the finished video is held in memory until it's saved

export class Unsupported extends Error {}

export const browserCanExport = () => typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function'
  && typeof OffscreenCanvas === 'function' && typeof AudioDecoder === 'function';

// Exports keep the original name; the extension changes only with the format.
export function exportName(original, ext) {
  const m = original.match(/^(.*?)(\.[^.]*)?$/);
  return (m[2] || '').toLowerCase() === ext ? original : `${m[1] || 'video'}${ext}`;
}

// Bitrate for each quality: at least the original's, so nothing gets softer.
// bpp is the floor in bits per pixel per frame, for sources that are already small.
const QUALITY = { max: { k: 1.6, bpp: 0.3 }, high: { k: 1.25, bpp: 0.16 }, fast: { k: 1, bpp: 0.1 } };

// `out` ({ W, H, frame, file }) makes another format of the video: the picture is
// reframed into W × H (see engine/reframe.js) and the result gets its own file name.
export async function exportInBrowser({ file, name, info, captions, style, spaced, watermark, quality = 'high', onProgress, signal, out = null }) {
  if (!browserCanExport()) throw new Unsupported('This browser has no video encoder.');
  if (!file) throw new Unsupported('The original file is not in this tab.');
  if (file.size > MAX_BYTES) throw new Unsupported('The video is too large to export in the browser.');
  const mb = await import(LIB);
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack().catch(() => null);
  if (!track) throw new Unsupported('This file type can’t be read in the browser.');
  if (!(await track.canDecode())) throw new Unsupported('This browser can’t decode the video.');

  const W = out?.W || info.width, H = out?.H || info.height;
  const stats = await track.computePacketStats(120);
  const fps = stats.averagePacketRate || info.fps || 30;
  const q = QUALITY[quality] || QUALITY.high;
  const bitrate = Math.round(Math.min(120e6, Math.max(stats.averageBitrate * q.k, W * H * fps * q.bpp)));
  // H.264 plays everywhere. Tests set __exportCodecs, since test browsers ship no H.264 encoder.
  const codec = await mb.getFirstEncodableVideoCodec(globalThis.__exportCodecs || ['avc'], { width: W, height: H, bitrate });
  if (!codec) throw new Unsupported('This browser can’t encode H.264 at this size.');

  const mov = /\.mov$/i.test(name);
  const ext = mov ? '.mov' : '.mp4';
  const output = new mb.Output({
    format: mov ? new mb.MovOutputFormat({ fastStart: 'in-memory' }) : new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new mb.BufferTarget(),
  });

  // Audio is copied as is when every player takes it inside MP4; others (Opus,
  // FLAC, PCM) become AAC at a transparent bitrate, as on the server.
  const audio = await input.getPrimaryAudioTrack().catch(() => null);
  const copyAudio = !audio || mov || MP4_AUDIO.has(audio.codec);

  const engine = new CaptionEngine();
  await engine.set({ captions, style, W, H, spaced });
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const renderer = new CanvasRenderer(W, H);
  const scratch = {};
  let wm = null;
  if (watermark?.on) {
    const res = await fetch(`/watermarks/${watermarkFile(watermark, W, H)}`);
    if (!res.ok) throw new Error('The watermark image could not be loaded.');
    wm = { img: await createImageBitmap(await res.blob()), rect: watermarkRect(watermark, W, H), alpha: watermark.opacity / 100 };
  }

  const conversion = await mb.Conversion.init({
    input, output, showWarnings: false,
    video: {
      codec, bitrate, forceTranscode: true, allowTransformationMetadata: false, keyFrameInterval: 2,
      processedWidth: W, processedHeight: H,
      process: (sample) => {
        const t = sample.timestamp;
        if (out) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, W, H);
          drawFrame(ctx, (c, sx, sy, sw, sh, dx, dy, dw, dh) => sample.draw(c, sx, sy, sw, sh, dx, dy, dw, dh),
            sample.displayWidth || info.width, sample.displayHeight || info.height, W, H, out.frame, scratch);
        } else {
          sample.draw(ctx, 0, 0, W, H);
        }
        if (wm) {
          ctx.globalAlpha = wm.alpha;
          ctx.drawImage(wm.img, wm.rect.x, wm.rect.y, wm.rect.w, wm.rect.h);
          ctx.globalAlpha = 1;
        }
        renderer.render(ctx, engine.scenesAt(t), t);
        return canvas;
      },
    },
    audio: copyAudio ? {} : { codec: 'aac', bitrate: 320e3, forceTranscode: true },
  });
  // the video and its main audio must both make it; a silent export is no good
  const kept = new Set(conversion.utilizedTracks);
  if (!conversion.isValid || !kept.has(track) || (audio && !kept.has(audio))) {
    throw new Unsupported('This browser can’t convert one of the tracks.');
  }

  const t0 = performance.now();
  conversion.onProgress = (p) => onProgress?.(p, (performance.now() - t0) / 1000);
  const abort = () => conversion.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await conversion.execute();
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  const blob = new Blob([output.target.buffer], { type: mov ? 'video/quicktime' : 'video/mp4' });
  return { blob, file: out?.file ? `${out.file}${ext}` : exportName(name, ext), size: blob.size, elapsed: (performance.now() - t0) / 1000 };
}
