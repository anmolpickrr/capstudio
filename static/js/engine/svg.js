// Live preview: draws caption scenes as SVG on the video's own pixel grid
// (viewBox = video size), using the element states from scene.js.
import { cssFamily } from './fonts.js';
import { elementState, GRADIENT_BANDS } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
let seq = 0;

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function set(node, attr, value) {
  const v = value === null || value === undefined ? null : String(value);
  if (node.__a?.[attr] === v) return;
  (node.__a ||= {})[attr] = v;
  if (v === null) node.removeAttribute(attr); else node.setAttribute(attr, v);
}

export function roundedRect(w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const f = (n) => +n.toFixed(2);
  if (r < 0.5) return `M0 0H${f(w)}V${f(h)}H0Z`;
  return `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}`
    + `H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`;
}

export function bandColors(from, to, n = GRADIENT_BANDS) {
  const a = parseInt(from.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (v, s) => (v >> s) & 255;
  return Array.from({ length: n }, (_, k) => {
    const p = (k + 0.5) / n;
    const c = [16, 8, 0].map((s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * p));
    return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  });
}

export class SvgRenderer {
  constructor(svg) {
    this.svg = svg;
    this.defs = el('defs', {}, svg);
    this.root = el('g', {}, svg);
    this.nodes = new Map(); // scene -> built nodes
  }

  setSize(W, H) {
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  }

  clear() {
    this.root.replaceChildren();
    this.defs.replaceChildren();
    this.nodes.clear();
  }

  // Draw the given scenes (the captions on screen) at time t.
  render(scenes, t) {
    const keep = new Set(scenes);
    for (const [scene, built] of this.nodes) {
      if (!keep.has(scene)) { built.group.remove(); built.defs.forEach((d) => d.remove()); this.nodes.delete(scene); }
    }
    for (const scene of scenes) {
      let built = this.nodes.get(scene);
      if (!built) { built = this.build(scene); this.nodes.set(scene, built); }
      built.items.forEach((item) => this.update(item, elementState(scene, item.el, t)));
    }
  }

  build(scene) {
    const group = el('g', {}, this.root);
    const defs = [];
    const items = scene.elements.map((e) => {
      const g = el('g', {}, group);
      const item = { el: e, g };
      if (e.kind === 'box') {
        item.shape = el('path', {}, g);
      } else {
        item.text = el('text', {
          x: 0, y: (-e.desc).toFixed(2), 'text-anchor': 'middle', 'font-family': cssFamily(e.font),
          'font-size': (e.size * e.font.scale).toFixed(2), 'letter-spacing': e.spacing ? e.spacing.toFixed(2) : null,
          'stroke-linejoin': 'round', 'paint-order': 'stroke fill', style: 'white-space:pre',
        }, g);
        item.text.textContent = e.text;
      }
      return item;
    });
    return { group, items, defs };
  }

  def(item, kind, make) {
    if (!item[kind]) {
      item[kind] = make();
      this.defs.appendChild(item[kind]);
      this.nodes.forEach(() => {});
    }
    return item[kind];
  }

  update(item, s) {
    const { g, el: e } = item;
    if (!s.visible) { set(g, 'display', 'none'); return; }
    set(g, 'display', null);
    const f = (n) => +n.toFixed(2);
    set(g, 'transform', `translate(${f(s.pos.x)} ${f(s.pos.y)})${s.rot ? ` rotate(${f(s.rot)})` : ''} scale(${f(s.scale)})`);
    set(g, 'opacity', f(s.opacity));

    // blur (local units, so it scales with the element like libass's scaled \blur)
    const blur = s.blur ? s.blur / Math.max(s.scale, 0.01) : 0;
    if (blur > 0.05) {
      const filter = this.def(item, 'filter', () => {
        const fl = el('filter', { id: `cpb${++seq}`, x: '-50%', y: '-50%', width: '200%', height: '200%' });
        item.blurNode = el('feGaussianBlur', { stdDeviation: 0 }, fl);
        return fl;
      });
      set(item.blurNode, 'stdDeviation', f(blur));
      set(g, 'filter', `url(#${filter.id})`);
    } else set(g, 'filter', null);

    if (e.kind === 'box') {
      set(item.shape, 'd', roundedRect(s.rect.w, s.rect.h, s.radius));
      set(item.shape, 'fill', s.color);
      return;
    }
    const t = item.text;
    if (s.gradient) {
      const grad = this.def(item, 'grad', () => el('linearGradient', { id: `cpg${++seq}`, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0 }));
      const key = `${s.gradient.from}${s.gradient.to}${s.gradient.y0}${s.gradient.y1}`;
      if (item.gradKey !== key) {
        item.gradKey = key;
        grad.setAttribute('y1', f(s.gradient.y0));
        grad.setAttribute('y2', f(s.gradient.y1));
        grad.replaceChildren();
        bandColors(s.gradient.from, s.gradient.to).forEach((c, k, all) => {
          el('stop', { offset: k / all.length, 'stop-color': c }, grad);
          el('stop', { offset: (k + 1) / all.length, 'stop-color': c }, grad);
        });
      }
      set(t, 'fill', `url(#${grad.id})`);
    } else {
      set(t, 'fill', s.fill || 'none');
    }
    if (s.outline > 0.01) {
      set(t, 'stroke', s.outlineColor);
      set(t, 'stroke-width', f(2 * s.outline));
    } else {
      set(t, 'stroke', null);
      set(t, 'stroke-width', null);
    }
    if (s.clip) {
      const cp = this.def(item, 'clip', () => {
        const c = el('clipPath', { id: `cpc${++seq}`, clipPathUnits: 'userSpaceOnUse' });
        item.clipRect = el('rect', {}, c);
        return c;
      });
      set(item.clipRect, 'x', f(s.clip.x)); set(item.clipRect, 'y', f(s.clip.y));
      set(item.clipRect, 'width', f(Math.max(0, s.clip.w))); set(item.clipRect, 'height', f(s.clip.h));
      set(t, 'clip-path', `url(#${cp.id})`);
    } else set(t, 'clip-path', null);
  }
}
