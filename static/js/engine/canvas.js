// Export renderer: draws caption scenes onto a canvas, frame by frame, with the
// same element states the SVG preview uses, so a video exported in the browser
// looks exactly like the preview.
import { cssFamily } from './fonts.js';
import { elementState } from './scene.js';
import { bandColors, roundedRect } from './svg.js';

let filterWorks = null;
function canFilter(ctx) {
  if (filterWorks === null) {
    const prev = ctx.filter;
    ctx.filter = 'blur(2px)';
    filterWorks = ctx.filter === 'blur(2px)';
    ctx.filter = prev ?? 'none';
  }
  return filterWorks;
}

export class CanvasRenderer {
  constructor(W, H) {
    this.W = W; this.H = H;
    // scratch layer for elements whose stroke and fill must fade or blur as one
    this.layer = new OffscreenCanvas(W, H);
    this.lctx = this.layer.getContext('2d');
    // (tests can turn canvas filters off to check the fallback used by Safari)
    this.filterOK = canFilter(this.lctx) && !globalThis.__noCanvasFilter;
    this.paths = new Map();
    this.bounds = null; // screen area drawn since resetBounds(), generously padded
  }

  resetBounds() { this.bounds = null; }

  // The screen rectangle an element can paint into (with its outline, glyph overhang
  // and blur), so blurs and layers only work on that area, not the whole frame.
  area(e, s) {
    let x0, y0, x1, y1;
    if (e.kind === 'box') { x0 = 0; y0 = 0; x1 = s.rect.w; y1 = s.rect.h; }
    else {
      // glyphs can reach past the measured box (italics, accents, outline): pad generously
      const fs = e.size * e.font.scale, pad = 2 * (s.outline || 0) + fs * 0.35 + Math.abs(e.spacing || 0) * 2, y = -e.desc;
      x0 = -e.w / 2 - pad; x1 = e.w / 2 + pad; y0 = y - fs * 1.4 - pad; y1 = y + fs * 0.7 + pad;
    }
    const a = ((s.rot || 0) * Math.PI) / 180, k = s.scale, cos = Math.cos(a) * k, sin = Math.sin(a) * k;
    let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const px = s.pos.x + cos * x - sin * y, py = s.pos.y + sin * x + cos * y;
      ax = Math.min(ax, px); ay = Math.min(ay, py); bx = Math.max(bx, px); by = Math.max(by, py);
    }
    const pad = 3 * (s.blur || 0) + 4;
    ax = Math.max(0, Math.floor(ax - pad)); ay = Math.max(0, Math.floor(ay - pad));
    bx = Math.min(this.W, Math.ceil(bx + pad)); by = Math.min(this.H, Math.ceil(by + pad));
    return { x: ax, y: ay, w: Math.max(0, bx - ax), h: Math.max(0, by - ay) };
  }

  // Draw the scenes on screen at time t onto ctx (already holding the video frame).
  render(ctx, scenes, t) {
    for (const scene of scenes) {
      for (const e of scene.elements) {
        const s = elementState(scene, e, t);
        if (!s.visible) continue;
        const r = this.area(e, s);
        if (!r.w || !r.h) continue;
        const b = this.bounds;
        this.bounds = b ? { x0: Math.min(b.x0, r.x), y0: Math.min(b.y0, r.y), x1: Math.max(b.x1, r.x + r.w), y1: Math.max(b.y1, r.y + r.h) }
          : { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
        const stroke = e.kind === 'text' && s.outline > 0.01;
        const fill = e.kind === 'box' || !!s.fill;
        const blurred = s.blur > 0.05;
        ctx.save();
        if (blurred) { ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip(); }
        // canvas applies alpha and blur per drawing call; SVG applies them to the
        // element as a whole, so stroke + fill goes through a layer first
        // (and without canvas filters, as in Safari, blurs are done on the layer's pixels)
        if ((stroke && fill && (s.opacity < 0.999 || blurred)) || (blurred && !this.filterOK)) {
          const l = this.lctx;
          l.setTransform(1, 0, 0, 1, 0, 0);
          l.clearRect(r.x, r.y, r.w, r.h);
          this.element(l, e, s, 1, 0);
          ctx.globalAlpha = s.opacity;
          if (blurred && !this.filterOK) {
            l.putImageData(blurPixels(l.getImageData(r.x, r.y, r.w, r.h), s.blur), r.x, r.y);
            ctx.drawImage(this.layer, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
          } else {
            this.blurred(ctx, s.blur, () => ctx.drawImage(this.layer, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h));
          }
        } else {
          this.element(ctx, e, s, s.opacity, this.filterOK ? s.blur : 0);
        }
        ctx.restore();
      }
    }
  }

  // Run draw() with a gaussian blur of the given std deviation (screen px). Only
  // called where canvas filters work; elsewhere blurs go through blurPixels.
  blurred(ctx, blur, draw) {
    if (!(blur > 0.05)) { draw(); return; }
    ctx.filter = `blur(${blur.toFixed(2)}px)`;
    draw();
    ctx.filter = 'none';
  }

  element(ctx, e, s, alpha, blur) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(s.pos.x, s.pos.y);
    if (s.rot) ctx.rotate((s.rot * Math.PI) / 180);
    ctx.scale(s.scale, s.scale);
    if (e.kind === 'box') {
      ctx.fillStyle = s.color;
      const key = `${s.rect.w.toFixed(2)},${s.rect.h.toFixed(2)},${s.radius.toFixed(2)}`;
      let p = this.paths.get(key);
      if (!p) {
        p = new Path2D(roundedRect(s.rect.w, s.rect.h, s.radius));
        if (this.paths.size > 500) this.paths.clear();
        this.paths.set(key, p);
      }
      this.blurred(ctx, blur, () => ctx.fill(p));
      ctx.restore();
      return;
    }
    ctx.font = `${(e.size * e.font.scale).toFixed(2)}px ${cssFamily(e.font)}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = e.spacing ? `${e.spacing.toFixed(2)}px` : '0px';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    if (s.clip) {
      ctx.beginPath();
      ctx.rect(s.clip.x, s.clip.y, Math.max(0, s.clip.w), s.clip.h);
      ctx.clip();
    }
    const y = -e.desc;
    this.blurred(ctx, blur, () => {
      if (s.outline > 0.01) {
        ctx.strokeStyle = s.outlineColor;
        ctx.lineWidth = 2 * s.outline;
        ctx.strokeText(e.text, 0, y);
      }
      if (s.gradient) {
        const g = ctx.createLinearGradient(0, s.gradient.y0, 0, s.gradient.y1);
        const bands = bandColors(s.gradient.from, s.gradient.to);
        bands.forEach((c, k) => { g.addColorStop(k / bands.length, c); g.addColorStop((k + 1) / bands.length, c); });
        ctx.fillStyle = g;
        ctx.fillText(e.text, 0, y);
      } else if (s.fill) {
        ctx.fillStyle = s.fill;
        ctx.fillText(e.text, 0, y);
      }
    });
    ctx.restore();
  }
}

// Gaussian blur of an ImageData (std deviation `sigma` px) by three box blurs, on
// premultiplied colour so edges don't darken. For browsers without canvas filters.
export function blurPixels(img, sigma) {
  const { width: w, height: h, data } = img;
  const n = w * h, ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    ch[0][i] = data[i * 4] * a; ch[1][i] = data[i * 4 + 1] * a; ch[2][i] = data[i * 4 + 2] * a; ch[3][i] = data[i * 4 + 3];
  }
  // box widths whose three passes approximate the gaussian
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(ideal); if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  const radii = [0, 1, 2].map((k) => ((k < m ? wl : wl + 2) - 1) / 2);
  const tmp = new Float32Array(n);
  const pass = (src, dst, r, len, lines, step, lineStep) => {
    const k = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      const o = l * lineStep;
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += src[o + Math.min(len - 1, Math.max(0, j)) * step];
      for (let j = 0; j < len; j++) {
        dst[o + j * step] = acc * k;
        acc += src[o + Math.min(len - 1, j + r + 1) * step] - src[o + Math.max(0, j - r) * step];
      }
    }
  };
  for (const c of ch) {
    for (const r of radii) {
      if (r < 1) continue;
      pass(c, tmp, r, w, h, 1, w); // rows
      pass(tmp, c, r, h, w, w, 1); // columns
    }
  }
  for (let i = 0; i < n; i++) {
    const a = ch[3][i], inv = a > 0.01 ? 255 / a : 0;
    data[i * 4] = ch[0][i] * inv; data[i * 4 + 1] = ch[1][i] * inv; data[i * 4 + 2] = ch[2][i] * inv; data[i * 4 + 3] = a;
  }
  return img;
}
