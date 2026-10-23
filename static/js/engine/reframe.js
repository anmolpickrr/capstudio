// One edit, every format: the same captions on 9:16, 4:5, 1:1 and 16:9 versions
// of the video. The picture is either cropped to fill the new frame (with a focus
// point choosing what stays) or fitted inside it over a blurred copy of itself.
// The browser export, the server export (as an ffmpeg filter) and the previews in
// the Export dialog all frame the picture with these rules.
import { chunkWords } from './chunk.js';
import { fitsCaption } from './layout.js';

export const FORMATS = [
  { id: '9x16', label: 'Vertical 9:16', note: 'Reels, Shorts, TikTok, Stories', aw: 9, ah: 16, zone: 'ig-reels' },
  { id: '4x5', label: 'Portrait 4:5', note: 'Instagram and Facebook feed', aw: 4, ah: 5, zone: 'title' },
  { id: '1x1', label: 'Square 1:1', note: 'Feed posts', aw: 1, ah: 1, zone: 'title' },
  { id: '16x9', label: 'Landscape 16:9', note: 'YouTube, LinkedIn, websites', aw: 16, ah: 9, zone: 'title' },
];

const even = (v) => Math.max(2, Math.round(v / 2) * 2);

// The format's size in the original's quality class: its short side matches the
// original's (between 720 and 2160), so 1080p gives 1080 × 1920, 4K gives 2160 × 3840.
export function formatSize(format, srcW, srcH) {
  const short = Math.min(2160, Math.max(720, Math.min(srcW, srcH)));
  return format.aw <= format.ah
    ? { W: even(short), H: even((short * format.ah) / format.aw) }
    : { W: even((short * format.aw) / format.ah), H: even(short) };
}

export const sameShape = (sw, sh, W, H) => Math.abs(sw / sh - W / H) < 0.01;

// Where the picture goes. fill: the part of the source to crop (focus 0..1 picks
// which part, 0.5 = centre). fit: where the whole picture sits, plus the cropped
// background behind it.
export function frameRects(sw, sh, W, H, { mode = 'fill', fx = 0.5, fy = 0.5 } = {}) {
  const k = Math.max(W / sw, H / sh);
  const cw = W / k, ch = H / k;
  const cover = { sx: (sw - cw) * fx, sy: (sh - ch) * fy, sw: cw, sh: ch };
  if (mode !== 'fit' || sameShape(sw, sh, W, H)) return { cover };
  const f = Math.min(W / sw, H / sh);
  const dw = sw * f, dh = sh * f;
  return { cover: { ...cover, sx: (sw - cw) / 2, sy: (sh - ch) / 2 }, contain: { dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh } };
}

// Draw a reframed picture. draw(ctx, sx, sy, sw, sh, dx, dy, dw, dh) paints a part
// of the source (a video element, a frame, a decoded sample).
export function drawFrame(ctx, draw, sw, sh, W, H, frame, scratch) {
  const r = frameRects(sw, sh, W, H, frame);
  const c = r.cover;
  if (!r.contain) { draw(ctx, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H); return; }
  // the blurred background: drawn tiny, then stretched back up, then darkened a little
  const bw = Math.max(8, Math.round(W / 24)), bh = Math.max(8, Math.round(H / 24));
  if (!scratch.canvas || scratch.canvas.width !== bw || scratch.canvas.height !== bh) {
    scratch.canvas = new OffscreenCanvas(bw, bh);
    scratch.ctx = scratch.canvas.getContext('2d');
  }
  draw(scratch.ctx, c.sx, c.sy, c.sw, c.sh, 0, 0, bw, bh);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(scratch.canvas, 0, 0, W, H);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const d = r.contain;
  draw(ctx, 0, 0, sw, sh, d.dx, d.dy, d.dw, d.dh);
}

// Captions for a format: the same captions and timing, with any caption too long
// for the new frame split into ones that fit (each keeps its own size setting).
export function captionsFor(captions, style, W, H) {
  return captions.flatMap((c) => {
    if (!c.words.length || fitsCaption(c.words, style, W, H)) return [c];
    const parts = chunkWords(c.words, style, (ws) => fitsCaption(ws, style, W, H));
    return parts.map((p, i) => ({ ...p, id: `${c.id}-${i}`, scale: c.scale, start: i ? p.start : c.start,
      end: i === parts.length - 1 ? c.end : p.end }));
  });
}
