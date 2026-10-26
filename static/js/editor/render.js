// The compositor: draws the project at one moment onto a canvas. The preview and
// the export both draw with it (only where the video frames come from differs),
// so the exported video looks exactly like the preview.
import { CanvasRenderer } from '../engine/canvas.js';
import { cssFamily, fontById } from '../engine/fonts.js';
import { animMotion, EASES, LOOKS, sourceTime, transitionLook, transitionsFor, valueAt, videoTracksBottomUp } from './model.js';

// Every clip drawn at time t, bottom layer first, with its transition windows.
export function visibleAt(p, t) {
  const out = [];
  for (const tr of videoTracksBottomUp(p)) {
    if (tr.hidden) continue;
    const cs = p.clips.filter((c) => c.track === tr.id).sort((a, b) => a.start - b.start);
    for (const c of cs) {
      const w = transitionsFor(p, c);
      if (t >= w.from - 1e-9 && t < w.to - 1e-9) out.push({ clip: c, win: w });
    }
  }
  return out;
}

// Where in its source a media clip is at timeline time t (also during the run-on
// of a cross transition, holding the source's first or last frame).
export function mediaTime(p, c, t) {
  const a = p.assets[c.asset];
  const st = sourceTime(c, t);
  const last = a?.duration ? a.duration - 1 / (a.fps || 30) : Infinity;
  return Math.min(Math.max(0, st), Math.max(0, last));
}

// ---------------------------------------------------------------- effects

export function effectValues(c) {
  const look = LOOKS[c.look]?.fx || {};
  const fx = {};
  for (const k of ['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'hue', 'fade', 'vignette', 'blur', 'mono',
    'glow', 'rgb', 'grain', 'leak', 'vhs', 'glitch', 'bars']) {
    fx[k] = (look[k] || 0) + (c.fx?.[k] || 0);
  }
  return fx;
}

// The scale the frame is being drawn at (the preview draws at the size it's shown;
// the export at full size). Lengths given to canvas filters are in canvas pixels.
let SCALE = 1;

function filterString(fx, W, H, extraBlur = 0) {
  const parts = [];
  if (fx.exposure) parts.push(`brightness(${(100 + fx.exposure) / 100})`);
  if (fx.contrast) parts.push(`contrast(${(100 + fx.contrast) / 100})`);
  if (fx.saturation) parts.push(`saturate(${Math.max(0, 100 + fx.saturation) / 100})`);
  if (fx.hue) parts.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.mono) parts.push(`grayscale(${Math.min(100, fx.mono) / 100})`);
  const blur = ((fx.blur / 100) * 30 * (Math.min(W, H) / 1080) + extraBlur) * SCALE;
  if (blur > 0.05) parts.push(`blur(${blur.toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

const needsLayer = (fx) => !!(fx.temperature || fx.tint || fx.fade || fx.vignette);

// Colour washes, lifted blacks and a vignette, on a layer holding the picture.
function grade(l, w, h, fx, redraw) {
  const wash = (color, amount) => {
    l.globalCompositeOperation = 'soft-light';
    l.globalAlpha = Math.min(1, Math.abs(amount) / 100) * 0.55;
    l.fillStyle = color;
    l.fillRect(0, 0, w, h);
  };
  if (fx.temperature) wash(fx.temperature > 0 ? '#FF8A1F' : '#1F7BFF', fx.temperature);
  if (fx.tint) wash(fx.tint > 0 ? '#FF2FD0' : '#2FFF6A', fx.tint);
  l.globalAlpha = 1;
  if (fx.fade) {
    l.globalCompositeOperation = 'lighten';
    l.fillStyle = `rgba(${Math.round(fx.fade * 0.75)}, ${Math.round(fx.fade * 0.75)}, ${Math.round(fx.fade * 0.8)}, 1)`;
    l.fillRect(0, 0, w, h);
  }
  if (fx.vignette) {
    l.globalCompositeOperation = 'source-over';
    const g = l.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${Math.min(1, fx.vignette / 100) * 0.85})`);
    l.fillStyle = g;
    l.fillRect(0, 0, w, h);
  }
  // keep the picture's own transparency
  l.globalCompositeOperation = 'destination-in';
  redraw(l);
  l.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- text

const textCache = new Map();
let measureCtx = null;
const mctx = () => (measureCtx ||= new OffscreenCanvas(8, 8).getContext('2d'));

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line.trim() && ctx.measureText(next.trimEnd()).width > maxW) { out.push(line.trimEnd()); line = w.trimStart(); } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

// The text block as a picture (cached), with `chars` characters shown.
export function textPicture(t, W, chars = Infinity) {
  const key = `${JSON.stringify(t)}|${W}|${chars}`;
  if (textCache.has(key)) return textCache.get(key);
  const font = fontById(t.font);
  const fs = t.size * (font?.scale || 1);
  const m = mctx();
  m.font = `${fs}px ${cssFamily(font)}`;
  let lines = wrap(m, t.content || ' ', W * 0.9);
  if (chars !== Infinity) {
    let left = chars;
    lines = lines.map((ln) => { const s = [...ln].slice(0, Math.max(0, left)).join(''); left -= [...ln].length + 1; return s; });
  }
  const full = wrap(m, t.content || ' ', W * 0.9);
  const lh = t.size * (t.lineHeight || 1.15);
  const widths = full.map((ln) => m.measureText(ln).width);
  const bw = Math.max(1, ...widths);
  const pad = t.bg ? t.pad : 0;
  const ol = t.outline || 0;
  const margin = Math.ceil(ol + t.size * 0.25 + (t.shadow ? t.size * 0.12 : 0));
  const w = Math.ceil(bw + 2 * pad + 2 * margin), h = Math.ceil(lh * full.length + 2 * pad + 2 * margin);
  const cv = new OffscreenCanvas(w, h), c = cv.getContext('2d');
  if (t.bg) {
    c.fillStyle = t.bgColor;
    c.globalAlpha = t.bgOpacity ?? 1;
    const x = margin, y = margin, ww = w - 2 * margin, hh = h - 2 * margin, r = Math.min(t.radius || 0, ww / 2, hh / 2);
    c.beginPath(); c.roundRect(x, y, ww, hh, r); c.fill();
    c.globalAlpha = 1;
  }
  c.font = m.font;
  c.textBaseline = 'alphabetic';
  c.lineJoin = 'round';
  const asc = t.size * 0.8;
  lines.forEach((ln, i) => {
    const fw = widths[i];
    const x = t.align === 'left' ? margin + pad : t.align === 'right' ? w - margin - pad - fw : (w - fw) / 2;
    const y = margin + pad + i * lh + (lh - t.size) / 2 + asc;
    if (t.shadow) {
      c.shadowColor = `rgba(0,0,0,${t.shadow})`; c.shadowBlur = t.size * 0.12; c.shadowOffsetY = t.size * 0.05;
    }
    if (ol > 0) { c.strokeStyle = t.outlineColor; c.lineWidth = ol * 2; c.strokeText(ln, x, y); c.shadowColor = 'transparent'; }
    c.fillStyle = t.color;
    c.fillText(ln, x, y);
    c.shadowColor = 'transparent';
  });
  const pic = { img: cv, w, h };
  textCache.set(key, pic);
  if (textCache.size > 300) textCache.delete(textCache.keys().next().value);
  return pic;
}

const IN = 0.45, OUT = 0.35;
// How a text clip's entrance and exit animate it at local time lt.
function textMotion(t, lt, dur, len) {
  const m = { alpha: 1, scale: 1, dy: 0, reveal: 1, chars: Infinity };
  const step = (kind, q, entering) => {
    const e = EASES.out.f(q);
    if (kind === 'fade') m.alpha *= e;
    else if (kind === 'pop') { m.alpha *= Math.min(1, q * 3); m.scale *= entering ? (q < 0.7 ? 0.6 + 0.54 * (q / 0.7) : 1.14 - 0.14 * ((q - 0.7) / 0.3)) : 0.8 + 0.2 * e; }
    else if (kind === 'rise') { m.alpha *= e; m.dy += (1 - e) * (entering ? 60 : -40); }
    else if (kind === 'drop') { m.alpha *= Math.min(1, q * 4); m.dy -= (1 - EASES.out.f(q)) * 120 * (entering ? 1 : -0.5); }
    else if (kind === 'wipe') m.reveal *= e;
    else if (kind === 'typewriter') { if (entering) m.chars = Math.floor(len * q); else m.alpha *= e; }
  };
  const inLen = t.animIn === 'typewriter' ? Math.min(Math.max(0.4, len * 0.05), dur * 0.6) : Math.min(IN, dur / 2);
  if (t.animIn && t.animIn !== 'none' && lt < inLen) step(t.animIn, lt / inLen, true);
  const outLen = Math.min(OUT, dur / 3);
  if (t.animOut && t.animOut !== 'none' && dur - lt < outLen) step(t.animOut, Math.max(0, (dur - lt) / outLen), false);
  return m;
}

// ---------------------------------------------------------------- frame

let layer = null, lctx = null;
function scratch(w, h) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  if (!layer || layer.width < w || layer.height < h) {
    layer = new OffscreenCanvas(Math.max(w, layer?.width || 0), Math.max(h, layer?.height || 0));
    lctx = layer.getContext('2d');
  }
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = 'source-over';
  lctx.globalAlpha = 1;
  lctx.filter = 'none';
  lctx.clearRect(0, 0, w, h);
  return lctx;
}

const captionRenderers = new Map();
function captionRenderer(W, H) {
  const k = `${W}x${H}`;
  if (!captionRenderers.has(k)) captionRenderers.set(k, new CanvasRenderer(W, H));
  return captionRenderers.get(k);
}

// src: { frame(clip, sourceTime) → {img, w, h} | null, image(assetId) → bitmap | null,
//        captions(clip) → CaptionEngine | null }
export function drawFrame(ctx, p, t, src, scale = 1) {
  const { W, H } = p;
  SCALE = scale;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = p.bg || '#000000';
  ctx.fillRect(0, 0, W, H);
  for (const { clip, win } of visibleAt(p, t)) drawClip(ctx, p, clip, win, t, src);
  ctx.restore();
}

function lookAt(win, t, W, H) {
  let L = null;
  const merge = (x) => {
    if (!L) { L = x; return; }
    L.alpha *= x.alpha; L.dx += x.dx; L.dy += x.dy; L.scale *= x.scale; L.blur += x.blur; L.rot += x.rot || 0;
    L.glitch = Math.max(L.glitch || 0, x.glitch || 0); L.circle = x.circle || L.circle;
    L.clip = x.clip || L.clip; if (x.color) { L.color = x.color; L.colorAlpha = Math.max(L.colorAlpha, x.colorAlpha); }
  };
  if (win.in && t >= win.in.a && t < win.in.b) merge(transitionLook(win.in.type, (t - win.in.a) / (win.in.b - win.in.a), 'in', W, H));
  if (win.out && t >= win.out.a && t <= win.out.b) {
    const q = (t - win.out.a) / (win.out.b - win.out.a);
    // an exit (no clip after) plays the entrance backwards
    merge(win.out.cross ? transitionLook(win.out.type, q, 'out', W, H) : transitionLook(win.out.type, 1 - q, 'in', W, H));
  }
  return L || { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, clip: null, color: null, colorAlpha: 0, rot: 0, circle: null, glitch: 0 };
}

function drawClip(ctx, p, c, win, t, src) {
  const { W, H } = p;
  const lt = Math.min(Math.max(t - c.start, 0), c.dur);
  const L = lookAt(win, t, W, H);

  if (c.type === 'adjust') { drawAdjust(ctx, p, c, L, t, lt); return; }

  if (c.type === 'captions') {
    const engine = src.captions?.(c);
    if (!engine) return;
    const local = t - c.start;
    ctx.save();
    ctx.globalAlpha = 1;
    captionRenderer(W, H).render(ctx, engine.scenesAt(local), local);
    ctx.restore();
    return;
  }

  let pic = null, k = 1, tm = null;
  if (c.type === 'video') pic = src.frame(c, mediaTime(p, c, t));
  else if (c.type === 'image') { const b = src.image(c.asset); if (b) pic = { img: b, w: b.width, h: b.height }; }
  else if (c.type === 'text') {
    tm = textMotion(c.text, lt, c.dur, [...(c.text.content || '')].length);
    pic = textPicture(c.text, W, tm.chars);
  } else if (c.type === 'shape') {
    const s = c.shape;
    const w = s.kind === 'full' ? W : s.w, h = s.kind === 'full' ? H : s.h;
    pic = { shape: s, w, h };
  }
  if (!pic) return;
  if (c.type === 'video' || c.type === 'image') {
    k = c.fit === 'cover' ? Math.max(W / pic.w, H / pic.h) : c.fit === 'none' ? 1 : Math.min(W / pic.w, H / pic.h);
  }
  const dw = pic.w * k, dh = pic.h * k;

  const x = valueAt(c, 'x', lt), y = valueAt(c, 'y', lt), sc = valueAt(c, 'scale', lt);
  const rot = valueAt(c, 'rotation', lt), op = valueAt(c, 'opacity', lt);
  const fx = effectValues(c);
  const am = animMotion(c, lt, W, H);
  const alpha = Math.max(0, Math.min(1, op)) * L.alpha * (tm ? tm.alpha : 1) * am.alpha;
  if (alpha <= 0.001) { overlayColor(ctx, L, W, H); return; }
  // effects that work on the finished layer (RGB split, glitch, grain…) draw it on its own first
  const post = needsPost(fx, L);
  const out = ctx;
  if (post) ctx = frameLayer(0, out);

  const paint = (g, w, h) => {
    if (pic.shape) {
      g.fillStyle = pic.shape.fill;
      g.beginPath();
      if (pic.shape.kind === 'ellipse') g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else g.roundRect(0, 0, w, h, pic.shape.kind === 'full' ? 0 : Math.min(pic.shape.radius || 0, w / 2, h / 2));
      g.fill();
    } else g.drawImage(pic.img, 0, 0, w, h);
  };

  ctx.save();
  if (L.clip) { ctx.beginPath(); ctx.rect(L.clip.x, L.clip.y, L.clip.w, L.clip.h); ctx.clip(); }
  if (L.circle) { ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.max(0.01, L.circle.r), 0, Math.PI * 2); ctx.clip(); }
  ctx.globalCompositeOperation = post ? 'source-over' : c.blend || 'source-over';
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2 + x + L.dx + am.dx, H / 2 + y + L.dy + am.dy + (tm ? tm.dy : 0));
  const turn = rot + L.rot + am.rot;
  if (turn) ctx.rotate((turn * Math.PI) / 180);
  const s = sc * L.scale * (tm ? tm.scale : 1) * am.scale;
  ctx.scale(s * am.sx, s);
  if (tm && tm.reveal < 1) { ctx.beginPath(); ctx.rect(-dw / 2, -dh / 2, dw * tm.reveal, dh); ctx.clip(); }
  if (needsLayer(fx)) {
    // the picture at its drawn size on a layer, graded there, then placed
    // (at the scale it's drawn at: no more pixels than end up on screen)
    const lw = Math.max(1, Math.min(Math.ceil(dw * SCALE), W * 2)), lh = Math.max(1, Math.min(Math.ceil(dh * SCALE), H * 2));
    const l = scratch(lw, lh);
    l.filter = filterString({ ...fx, blur: 0 }, W, H);
    paint(l, lw, lh);
    l.filter = 'none';
    grade(l, lw, lh, fx, (g) => paint(g, lw, lh));
    ctx.filter = filterString({ blur: fx.blur }, W, H, L.blur + am.blur);
    ctx.drawImage(layer, 0, 0, lw, lh, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.filter = filterString(fx, W, H, L.blur + am.blur);
    ctx.translate(-dw / 2, -dh / 2);
    paint(ctx, dw, dh);
  }
  ctx.restore();
  if (post) postComposite(out, layers[0].canvas, fx, L, t, c.blend || 'source-over', 1, W);
  overlayColor(out, L, W, H);
}

// ---------------------------------------------------------------- whole-layer effects

// Frame-sized layers (in canvas pixels) for effects on a finished layer.
const layers = [];
function frameLayer(i, like) {
  const w = like.canvas.width, h = like.canvas.height;
  let l = layers[i];
  if (!l || l.canvas.width !== w || l.canvas.height !== h) { const cv = new OffscreenCanvas(w, h); l = layers[i] = cv.getContext('2d'); }
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.globalCompositeOperation = 'source-over'; l.globalAlpha = 1; l.filter = 'none';
  l.clearRect(0, 0, w, h);
  const k = like.getTransform().a;
  l.setTransform(k, 0, 0, k, 0, 0);
  return l;
}

const needsPost = (fx, L) => !!(fx.glow || fx.rgb || fx.grain || fx.leak || fx.vhs || fx.glitch || (L && L.glitch > 0.01));

// A repeatable pseudo-random number for (a, b): the same frame always looks the same.
function hash(a, b = 0) {
  let x = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be59b, 0xc2b2ae35);
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12;
  return ((x >>> 0) % 100000) / 100000;
}

let noiseTiles = null;
function noise(i) {
  if (!noiseTiles) {
    noiseTiles = [0, 1, 2, 3].map((n) => {
      const cv = new OffscreenCanvas(200, 200), g = cv.getContext('2d'), img = g.createImageData(200, 200);
      for (let j = 0; j < img.data.length; j += 4) {
        const v = hash(j, n * 7919 + 1) < 0.5 ? 0 : 255;
        img.data[j] = img.data[j + 1] = img.data[j + 2] = v;
        img.data[j + 3] = Math.round(hash(j + 1, n * 104729 + 3) * 255);
      }
      g.putImageData(img, 0, 0);
      return cv;
    });
  }
  return noiseTiles[i % 4];
}

// Effects on a finished layer `src` (canvas pixels), then drawn onto ctx with the
// clip's blend and `alpha`.
function postComposite(ctx, src, fx, L, t, blend, alpha, W) {
  const cw = src.width, ch = src.height, k = cw / W; // canvas pixels per project pixel
  const work = frameLayer(1, ctx); work.setTransform(1, 0, 0, 1, 0, 0);
  work.drawImage(src, 0, 0);
  const atop = (paint) => { work.save(); work.globalCompositeOperation = 'source-atop'; paint(work); work.restore(); };
  const grain = Math.min(100, (fx.grain || 0) + (fx.vhs || 0) * 0.5);
  if (grain > 0) {
    atop((g) => {
      const tile = noise(Math.floor(t * 24));
      const pat = g.createPattern(tile, 'repeat');
      const off = Math.floor(t * 24);
      pat.setTransform(new DOMMatrix().translate(hash(off, 1) * 200, hash(off, 2) * 200).scale(Math.max(1, k * 1.2)));
      g.globalAlpha = (grain / 100) * 0.32;
      g.fillStyle = pat;
      g.fillRect(0, 0, cw, ch);
    });
  }
  if (fx.leak) {
    atop((g) => {
      g.globalAlpha = (fx.leak / 100) * 0.55;
      for (const [cx0, cy0, col, sp] of [[0.15, 0.2, '255,120,40', 0.13], [0.85, 0.75, '255,60,120', 0.09]]) {
        const cx = (cx0 + 0.12 * Math.sin(t * sp * 6.283)) * cw, cy = (cy0 + 0.1 * Math.cos(t * sp * 5.1)) * ch, r = Math.max(cw, ch) * 0.55;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        gr.addColorStop(0, `rgba(${col},0.9)`); gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
      }
    });
  }
  if (fx.vhs) {
    atop((g) => {
      g.globalAlpha = (fx.vhs / 100) * 0.35;
      g.fillStyle = '#000';
      const step = Math.max(2, Math.round(3 * k));
      for (let y = Math.floor((t * 40) % step); y < ch; y += step) g.fillRect(0, y, cw, Math.max(1, Math.round(k)));
    });
  }
  let result = work.canvas;
  const rgb = Math.min(100, (fx.rgb || 0) + (fx.vhs || 0) * 0.6);
  if (rgb > 0) result = splitChannels(ctx, result, (rgb / 100) * 14 * k * (W / 1080));
  // glitch: horizontal bands thrown sideways (in bursts for the effect, all through a glitch transition)
  const seg = Math.floor(t * 12);
  const burst = fx.glitch ? (hash(seg, 7) > 1 - (fx.glitch / 100) * 0.55 ? fx.glitch / 100 : 0) : 0;
  const amp = Math.max(L?.glitch || 0, burst);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = blend;
  ctx.globalAlpha = alpha;
  if (amp > 0.01) {
    const n = 14, bh = ch / n;
    for (let i = 0; i < n; i++) {
      const r = hash(i, seg * 31 + 5);
      const dx = r > 0.55 ? (hash(i, seg) - 0.5) * cw * 0.16 * amp : 0;
      ctx.drawImage(result, 0, i * bh, cw, bh + 1, dx, i * bh, cw, bh + 1);
    }
  } else ctx.drawImage(result, 0, 0);
  if (fx.glow) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = alpha * Math.min(1, fx.glow / 100) * 0.9;
    ctx.filter = `blur(${(18 * k * (W / 1080)).toFixed(2)}px) brightness(1.25)`;
    ctx.drawImage(result, 0, 0);
    ctx.filter = 'none';
  }
  ctx.restore();
}

// The picture's red channel shifted one way and the rest the other.
function splitChannels(like, srcCanvas, d) {
  const cw = srcCanvas.width, ch = srcCanvas.height;
  const chan = (i, color) => {
    const g = frameLayer(i, like); g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(srcCanvas, 0, 0);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = color; g.fillRect(0, 0, cw, ch);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(srcCanvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
    return g.canvas;
  };
  const red = chan(2, '#FF0000'), rest = chan(3, '#00FFFF');
  const out = frameLayer(4, like); out.setTransform(1, 0, 0, 1, 0, 0);
  out.drawImage(red, -d, 0);
  out.globalCompositeOperation = 'lighter';
  out.drawImage(rest, d, 0);
  out.globalCompositeOperation = 'source-over';
  return out.canvas;
}

// An adjustment layer: its colour settings and effects change everything drawn
// under it so far (its opacity mixes the change in).
function drawAdjust(ctx, p, c, L, t, lt) {
  const { W, H } = p;
  const fx = effectValues(c);
  const alpha = Math.max(0, Math.min(1, valueAt(c, 'opacity', lt))) * L.alpha;
  if (alpha <= 0.001) return;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const base = frameLayer(5, ctx); base.setTransform(1, 0, 0, 1, 0, 0);
  base.filter = filterString(fx, W, H);
  base.drawImage(ctx.canvas, 0, 0);
  base.filter = 'none';
  if (needsLayer(fx)) grade(base, cw, ch, fx, (g) => g.drawImage(ctx.canvas, 0, 0));
  if (needsPost(fx, null)) postComposite(ctx, base.canvas, fx, null, t, 'source-over', alpha, W);
  else { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(base.canvas, 0, 0); ctx.restore(); }
  if (fx.bars) {
    // cinema bars, top and bottom
    const bh = (fx.bars / 100) * 0.13 * H;
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
    ctx.restore();
  }
}

function overlayColor(ctx, L, W, H) {
  if (!L.color || L.colorAlpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = L.colorAlpha;
  ctx.fillStyle = L.color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// The rectangle a clip covers on screen at time t (for the selection outline and
// dragging in the viewer), as its four corners.
export function clipCorners(p, c, t, natural) {
  const lt = Math.min(Math.max(t - c.start, 0), c.dur);
  let w = natural?.w || p.W, h = natural?.h || p.H, k = 1;
  if (c.type === 'video' || c.type === 'image') k = c.fit === 'cover' ? Math.max(p.W / w, p.H / h) : c.fit === 'none' ? 1 : Math.min(p.W / w, p.H / h);
  if (c.type === 'shape' && c.shape.kind === 'full') { w = p.W; h = p.H; }
  const s = valueAt(c, 'scale', lt), r = (valueAt(c, 'rotation', lt) * Math.PI) / 180;
  const cx = p.W / 2 + valueAt(c, 'x', lt), cy = p.H / 2 + valueAt(c, 'y', lt);
  const hw = (w * k * s) / 2, hh = (h * k * s) / 2, cos = Math.cos(r), sin = Math.sin(r);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => [cx + a * cos - b * sin, cy + a * sin + b * cos]);
}
