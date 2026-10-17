// SVG caption renderer. The SVG uses the video's own pixel grid as its
// viewBox (same as the ASS PlayResX/PlayResY), so positions, sizes, outlines
// and boxes map 1:1 onto what libass draws in the exported file.
import { animState, geometry, layoutCaption, wordStates } from './captions.js';

const NS = 'http://www.w3.org/2000/svg';
let filterSeq = 0;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

export class CaptionRenderer {
  constructor(svg) {
    this.svg = svg;
    this.filterId = `cp-blur-${++filterSeq}`;
    const defs = el('defs', {}, svg);
    this.blurNode = el('feGaussianBlur', { stdDeviation: 0 }, el('filter', {
      id: this.filterId, x: '-20%', y: '-50%', width: '140%', height: '200%',
    }, defs));
    this.root = el('g', {}, svg);
    this.key = null;
  }

  setSize(W, H) {
    this.W = W; this.H = H;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.invalidate();
  }

  invalidate() { this.key = null; }

  render(caption, style, font, t, spaced = true) {
    if (!caption || !font || t < caption.start || t >= caption.end) {
      if (this.key !== '') { this.root.replaceChildren(); this.key = ''; }
      return;
    }
    const g = geometry(style, this.W, this.H);
    const states = wordStates(caption, t, style.wordEffect);
    const key = `${caption.id}|${caption.words.map((w) => w.text).join(' ')}|${states.join('')}|${font.id}|${JSON.stringify(style)}`;
    if (key !== this.key) {
      this.key = key;
      this.build(caption, style, font, g, states, spaced);
    }
    const a = animState(style, caption, t);
    this.group.setAttribute('transform', `translate(${g.x} ${g.y + a.dy * this.H}) scale(${a.scale})`);
    this.group.setAttribute('opacity', a.opacity);
  }

  build(caption, style, font, g, states, spaced) {
    this.root.replaceChildren();
    this.blurNode.setAttribute('stdDeviation', g.blur);
    const group = this.group = el('g', {}, this.root);
    const lines = layoutCaption(caption, style, spaced);
    const n = lines.length, lh = g.fs;
    const top = g.an === 2 ? -n * lh : g.an === 5 ? -n * lh / 2 : 0;
    const textAttrs = {
      'font-family': `cp-${font.id}`,
      'font-size': g.fs * font.scale,
      'letter-spacing': g.spacing || undefined,
      'text-anchor': 'middle',
      style: 'white-space:pre',
    };
    const blur = style.blur > 0 ? `url(#${this.filterId})` : undefined;
    const hasOutline = !style.box && g.outline > 0;

    const writeLines = (parent, colorFor) => lines.map((line, li) => {
      const text = el('text', { ...textAttrs, x: 0, y: top + li * lh + font.ascent * lh }, parent);
      line.forEach(({ i, text: word }, k) => {
        if (k && spaced) text.appendChild(document.createTextNode(' '));
        const span = el('tspan', {}, text);
        span.textContent = word;
        if (states[i] === 'hidden') span.setAttribute('visibility', 'hidden');
        const c = colorFor?.(states[i]);
        if (c) span.setAttribute('fill', c);
      });
      return text;
    });

    // libass draws one translucent box per line, so where padded boxes overlap
    // they get darker; per-rect opacity reproduces that.
    const boxLayer = style.box ? el('g', {}, group) : null;
    const boxShadow = style.box && g.shadow > 0
      ? el('g', { transform: `translate(${g.shadow} ${g.shadow})` }, boxLayer) : null;
    const boxFill = style.box ? el('g', {}, boxLayer) : null;

    if (!style.box && g.shadow > 0) {
      const sh = el('g', { opacity: style.shadowOpacity, filter: blur }, group);
      const inner = el('g', {
        transform: `translate(${g.shadow} ${g.shadow})`, fill: style.shadowColor,
        stroke: hasOutline ? style.shadowColor : undefined, 'stroke-width': hasOutline ? 2 * g.outline : undefined,
        'stroke-linejoin': 'round',
      }, sh);
      writeLines(inner);
    }
    if (hasOutline) {
      const border = el('g', {
        fill: style.outlineColor, stroke: style.outlineColor, 'stroke-width': 2 * g.outline,
        'stroke-linejoin': 'round', filter: blur,
      }, group);
      writeLines(border);
    }
    const fill = el('g', { fill: style.color, filter: !hasOutline && !style.box ? blur : undefined }, group);
    const texts = writeLines(fill, (s) => (s === 'active' ? style.highlightColor : null));

    if (style.box) {
      // Like libass, the box only spans visible words (relevant for word-by-word reveal).
      texts.forEach((text, li) => {
        const spans = [...text.querySelectorAll('tspan')];
        const shown = spans.map((s) => s.getAttribute('visibility') !== 'hidden');
        if (!shown.some(Boolean)) return;
        let x0 = Infinity, x1 = -Infinity;
        spans.forEach((s, k) => {
          if (!shown[k]) return;
          const b = s.getBBox();
          x0 = Math.min(x0, b.x);
          // a run ending before a hidden word includes the separating space
          x1 = Math.max(x1, k + 1 < spans.length && !shown[k + 1] ? spans[k + 1].getBBox().x : b.x + b.width);
        });
        const rect = { x: x0 - g.pad, y: top + li * lh - g.pad, width: x1 - x0 + 2 * g.pad, height: lh + 2 * g.pad };
        el('rect', { ...rect, fill: style.boxColor, 'fill-opacity': style.boxOpacity }, boxFill);
        if (boxShadow) el('rect', { ...rect, fill: style.shadowColor, 'fill-opacity': style.shadowOpacity }, boxShadow);
      });
    }
  }
}
