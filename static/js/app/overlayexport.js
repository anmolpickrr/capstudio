// "Captions only" export: the captions (and the watermark, if on) on a transparent
// background, as a QuickTime Animation (RLE, 32-bit ARGB) .mov that Premiere Pro and
// After Effects open natively with its alpha channel. Same size, frame rate and
// length as the video, so it lines up when placed on the track above it. Made in
// the browser with the canvas renderer: no server, no video encoder needed.
import { CanvasRenderer } from '../engine/canvas.js';
import { CaptionEngine } from '../engine/index.js';
import { watermarkFile, watermarkRect } from '../engine/watermark.js';

// ------------------------------------------------------------ byte writer
class Bytes {
  constructor(size = 1 << 16) { this.buf = new Uint8Array(size); this.n = 0; }
  room(k) {
    if (this.n + k <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  u8(v) { this.room(1); this.buf[this.n++] = v & 255; }
  u16(v) { this.room(2); this.buf[this.n++] = (v >> 8) & 255; this.buf[this.n++] = v & 255; }
  u32(v) { this.room(4); for (let s = 24; s >= 0; s -= 8) this.buf[this.n++] = (v >>> s) & 255; }
  // one pixel from canvas RGBA (little-endian uint32) as big-endian A R G B
  argb(v) {
    this.room(4);
    const b = this.buf;
    b[this.n++] = v >>> 24; b[this.n++] = v & 255; b[this.n++] = (v >> 8) & 255; b[this.n++] = (v >> 16) & 255;
  }
  str(s) { for (const c of s) this.u8(c.charCodeAt(0)); }
  bytes(a) { this.room(a.length); this.buf.set(a, this.n); this.n += a.length; }
  done() { return this.buf.slice(0, this.n); }
}

// ------------------------------------------------------------ QuickTime Animation (qtrle) frames
// Each line: a skip byte, then codes: 0 = skip (next byte - 1) pixels, n > 0 = n literal
// pixels, n < -1 = one pixel repeated -n times, -1 = end of line. A key frame writes every
// pixel; other frames only the lines and pixels that changed since the previous frame.
function encodeLine(out, cur, prev, row, W, key) {
  const same = (x) => !key && cur[row + x] === prev[row + x];
  out.u8(1); // start at the first pixel
  let x = 0;
  while (x < W) {
    if (same(x)) {
      let n = 0;
      while (x < W && n < 254 && same(x)) { x++; n++; }
      if (x >= W) break; // the rest of the line is unchanged
      out.u8(0); out.u8(n + 1);
      continue;
    }
    const v = cur[row + x];
    let r = 1;
    while (x + r < W && r < 128 && !same(x + r) && cur[row + x + r] === v) r++;
    if (r >= 2) { out.u8(256 - r); out.argb(v); x += r; continue; }
    const start = x;
    let n = 0;
    while (x < W && n < 127 && !same(x)) {
      if (n && x + 2 < W && cur[row + x] === cur[row + x + 1] && cur[row + x] === cur[row + x + 2]) break;
      x++; n++;
    }
    out.u8(n);
    for (let k = 0; k < n; k++) out.argb(cur[row + start + k]);
  }
  out.u8(255); // end of line
}

function encodeFrame(cur, prev, W, H, key, rows = [0, H - 1]) {
  const out = new Bytes(key ? W * H + 64 : 4096);
  out.u32(0); // chunk size, filled in below
  let first = 0, last = H - 1;
  if (!key) {
    // only rows inside `rows` can have changed
    first = Math.max(0, rows[0]); last = Math.min(H - 1, rows[1]);
    const rowSame = (y) => { for (let i = y * W, e = i + W; i < e; i++) if (cur[i] !== prev[i]) return false; return true; };
    while (first <= last && rowSame(first)) first++;
    while (last > first && rowSame(last)) last--;
    if (first > last) { first = 0; last = 0; } // unchanged: one unchanged line
  }
  if (key) out.u16(0);
  else { out.u16(0x0008); out.u16(first); out.u16(0); out.u16(last - first + 1); out.u16(0); }
  for (let y = first; y <= last; y++) encodeLine(out, cur, prev, y * W, W, key);
  const bytes = out.done();
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  return bytes;
}

// ------------------------------------------------------------ QuickTime file
function atom(type, ...parts) {
  const body = parts.flat();
  const size = 8 + body.reduce((s, p) => s + p.length, 0);
  const b = new Bytes(size);
  b.u32(size); b.str(type);
  body.forEach((p) => b.bytes(p));
  return b.done();
}
const fields = (fn) => { const b = new Bytes(256); fn(b); return b.done(); };
const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];

function movFile(frames, keys, W, H, timescale, delta) {
  const duration = frames.length * delta;
  const ftyp = atom('ftyp', fields((b) => { b.str('qt  '); b.u32(0x200); b.str('qt  '); }));
  const mdatSize = 8 + frames.reduce((s, f) => s + f.length, 0);
  const offsets = [];
  let at = ftyp.length + 8;
  for (const f of frames) { offsets.push(at); at += f.length; }

  const mvhd = atom('mvhd', fields((b) => {
    b.u32(0); b.u32(0); b.u32(0); b.u32(timescale); b.u32(duration);
    b.u32(0x10000); b.u16(0x100); for (let i = 0; i < 10; i++) b.u8(0);
    MATRIX.forEach((m) => b.u32(m));
    for (let i = 0; i < 6; i++) b.u32(0);
    b.u32(2);
  }));
  const tkhd = atom('tkhd', fields((b) => {
    b.u32(0x0000000f); b.u32(0); b.u32(0); b.u32(1); b.u32(0); b.u32(duration);
    b.u32(0); b.u32(0); b.u16(0); b.u16(0); b.u16(0); b.u16(0);
    MATRIX.forEach((m) => b.u32(m));
    b.u32(W * 65536); b.u32(H * 65536);
  }));
  const mdhd = atom('mdhd', fields((b) => { b.u32(0); b.u32(0); b.u32(0); b.u32(timescale); b.u32(duration); b.u16(0); b.u16(0); }));
  const hdlr = (type, sub, name) => atom('hdlr', fields((b) => {
    b.u32(0); b.str(type); b.str(sub); b.u32(0); b.u32(0); b.u32(0); b.u8(name.length); b.str(name);
  }));
  const vmhd = atom('vmhd', fields((b) => { b.u32(1); b.u16(0x40); b.u16(0x8000); b.u16(0x8000); b.u16(0x8000); }));
  const dinf = atom('dinf', atom('dref', fields((b) => { b.u32(0); b.u32(1); }), atom('url ', fields((b) => b.u32(1)))));
  const rle = atom('rle ', fields((b) => {
    for (let i = 0; i < 6; i++) b.u8(0);
    b.u16(1); b.u16(0); b.u16(0); b.str('appl'); b.u32(0); b.u32(1024);
    b.u16(W); b.u16(H); b.u32(72 * 65536); b.u32(72 * 65536); b.u32(0); b.u16(1);
    const name = 'Animation';
    b.u8(name.length); b.str(name); for (let i = name.length; i < 31; i++) b.u8(0);
    b.u16(32); b.u16(0xffff);
  }));
  const stsd = atom('stsd', fields((b) => { b.u32(0); b.u32(1); }), rle);
  const stts = atom('stts', fields((b) => { b.u32(0); b.u32(1); b.u32(frames.length); b.u32(delta); }));
  const stss = atom('stss', fields((b) => { b.u32(0); b.u32(keys.length); }), u32s(keys));
  const stsc = atom('stsc', fields((b) => { b.u32(0); b.u32(1); b.u32(1); b.u32(1); b.u32(1); }));
  const stsz = atom('stsz', fields((b) => { b.u32(0); b.u32(0); b.u32(frames.length); }), sizes(frames));
  const stco = atom('stco', fields((b) => { b.u32(0); b.u32(offsets.length); }), u32s(offsets));
  const stbl = atom('stbl', stsd, stts, stss, stsc, stsz, stco);
  const minf = atom('minf', vmhd, hdlr('dhlr', 'url ', 'DataHandler'), dinf, stbl);
  const mdia = atom('mdia', mdhd, hdlr('mhlr', 'vide', 'VideoHandler'), minf);
  const moov = atom('moov', mvhd, atom('trak', tkhd, mdia));
  const mdatHead = fields((b) => { b.u32(mdatSize); b.str('mdat'); });
  return new Blob([ftyp, mdatHead, ...frames, moov], { type: 'video/quicktime' });
}
const u32s = (list) => fields((b) => list.forEach((v) => b.u32(v)));
const sizes = (frames) => u32s(frames.map((f) => f.length));

// ------------------------------------------------------------ export
export function overlayName(original) {
  return `${original.replace(/\.[^.]*$/, '') || 'video'} captions.mov`;
}

// `from` and `speed` map overlay time to caption time (a clip placed in a Premiere
// timeline from its in-point, maybe sped up): caption time = from + t × speed.
export async function exportOverlay({ name, info, captions, style, spaced, watermark, onProgress, signal, from = 0, speed = 1, file }) {
  const W = info.width, H = info.height;
  // frame rate as a whole-number timescale: 29.97 → 29970 per second, 1000 per frame
  const fps = info.fps && info.fps > 1 && info.fps < 241 ? info.fps : 30;
  const timescale = Math.round(fps * 1000), delta = 1000;
  const count = Math.max(1, Math.round(info.duration * timescale / delta));

  const engine = new CaptionEngine();
  await engine.set({ captions, style, W, H, spaced });
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const renderer = new CanvasRenderer(W, H);
  let wm = null;
  if (watermark?.on) {
    const res = await fetch(`/watermarks/${watermarkFile(watermark, W, H)}`);
    if (!res.ok) throw new Error('The watermark image could not be loaded.');
    wm = { img: await createImageBitmap(await res.blob()), rect: watermarkRect(watermark, W, H), alpha: watermark.opacity / 100 };
  }

  const frames = [], keys = [];
  const keyEvery = Math.max(1, Math.round(fps)); // a key frame each second, for scrubbing
  let prev = new Uint32Array(W * H);
  let lastBounds = null;
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
    const t = from + ((i * delta) / timescale) * speed;
    ctx.clearRect(0, 0, W, H);
    if (wm) {
      ctx.globalAlpha = wm.alpha;
      ctx.drawImage(wm.img, wm.rect.x, wm.rect.y, wm.rect.w, wm.rect.h);
      ctx.globalAlpha = 1;
    }
    renderer.resetBounds();
    renderer.render(ctx, engine.scenesAt(t), t);
    const key = i % keyEvery === 0 || !!globalThis.__overlayFullFrames; // (tests compare against full frames)
    // Reading pixels back is the slow part, so between key frames only the area the
    // captions cover now or covered in the last frame is read; the rest is unchanged.
    // Key frames read the whole frame.
    const b = renderer.bounds, both = b && lastBounds ? { x0: Math.min(b.x0, lastBounds.x0), y0: Math.min(b.y0, lastBounds.y0),
      x1: Math.max(b.x1, lastBounds.x1), y1: Math.max(b.y1, lastBounds.y1) } : b || lastBounds;
    lastBounds = b;
    let cur, rows;
    if (key) {
      cur = new Uint32Array(ctx.getImageData(0, 0, W, H).data.buffer);
    } else if (!both) {
      cur = prev; rows = [0, -1]; // nothing drawn now or before: unchanged
    } else {
      const x0 = Math.max(0, Math.floor(both.x0)), y0 = Math.max(0, Math.floor(both.y0));
      const x1 = Math.min(W, Math.ceil(both.x1)), y1 = Math.min(H, Math.ceil(both.y1));
      cur = prev.slice();
      if (x1 > x0 && y1 > y0) {
        const part = new Uint32Array(ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data.buffer), w = x1 - x0;
        for (let y = y0; y < y1; y++) cur.set(part.subarray((y - y0) * w, (y - y0 + 1) * w), y * W + x0);
      }
      rows = [y0, y1 - 1];
    }
    frames.push(encodeFrame(cur, prev, W, H, key, rows));
    if (key) keys.push(i + 1);
    prev = cur;
    if (i % 4 === 3) {
      onProgress?.((i + 1) / count, (performance.now() - t0) / 1000);
      await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }
  }
  const blob = movFile(frames, keys, W, H, timescale, delta);
  return { blob, file: file || overlayName(name), size: blob.size, elapsed: (performance.now() - t0) / 1000 };
}
