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
    this.paths = new Map();
  }

  // Draw the scenes on screen at time t onto ctx (already holding the video frame).
  render(ctx, scenes, t) {
    for (const scene of scenes) {
      for (const e of scene.elements) {
        const s = elementState(scene, e, t);
        if (!s.visible) continue;
        const stroke = e.kind === 'text' && s.outline > 0.01;
        const fill = e.kind === 'box' || !!s.fill;
        // canvas applies alpha and blur per drawing call; SVG applies them to the
        // element as a whole, so stroke + fill goes through a layer first
        if (stroke && fill && (s.opacity < 0.999 || s.blur > 0.05)) {
          const l = this.lctx;
          l.setTransform(1, 0, 0, 1, 0, 0);
          l.clearRect(0, 0, this.W, this.H);
          this.element(l, e, s, 1, 0);
          ctx.save();
          ctx.globalAlpha = s.opacity;
          this.blurred(ctx, s.blur, () => ctx.drawImage(this.layer, 0, 0));
          ctx.restore();
        } else {
          this.element(ctx, e, s, s.opacity, s.blur);
        }
      }
    }
  }

  // Run draw() with a gaussian blur of the given std deviation (screen px).
  blurred(ctx, blur, draw) {
    if (!(blur > 0.05)) { draw(); return; }
    if (canFilter(ctx)) {
      ctx.filter = `blur(${blur.toFixed(2)}px)`;
      draw();
      ctx.filter = 'none';
      return;
    }
    // Safari: draw far off canvas and keep only the blurred shadow
    const off = this.W + this.H + 1000;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowBlur = blur * 2;
    ctx.shadowOffsetX = off;
    const m = ctx.getTransform();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e - off, m.f);
    draw();
    ctx.restore();
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
