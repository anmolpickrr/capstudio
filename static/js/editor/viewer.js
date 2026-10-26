// The viewer: the preview canvas, with handles on the selected layer to move,
// scale and rotate it right on the picture (snapping to the centre lines), and
// the play controls under it.
import { icon } from '../app/icons.js';
import { fmtTime, h } from '../app/ui.js';
import { clipById, duration, setValue, valueAt } from './model.js';
import { clipCorners, textPicture, visibleAt } from './render.js';
import { ed, edit, on, select, selectedClips, setPlayhead } from './store.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (name, attrs = {}) => { const n = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

export function mountViewer(root, player) {
  const canvas = player.canvas;
  const overlay = svgEl('svg', { class: 'vw-overlay' });
  const stage = h('div', { class: 'vw-stage' }, canvas, overlay);
  const wrap = h('div', { class: 'vw-wrap' }, stage);
  const playBtn = h('button', { class: 'btn icon-only vw-play', type: 'button', 'aria-label': 'Play', html: icon('play'), onclick: () => player.toggle() });
  const frame = () => 1 / (ed.project.fps || 30);
  const tbtn = (ico, label, fn) => h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': label, 'data-tip': label, html: icon(ico), onclick: fn });
  const time = h('span', { class: 'vw-time' });
  const size = h('span', { class: 'vw-size' });
  const controls = h('div', { class: 'vw-controls' },
    size,
    h('div', { class: 'vw-transport' },
      tbtn('skipBack', 'To the start (Home)', () => setPlayhead(0)),
      tbtn('stepBack', 'Back one frame (←)', () => setPlayhead(ed.playhead - frame())),
      playBtn,
      tbtn('stepFwd', 'Forward one frame (→)', () => setPlayhead(ed.playhead + frame())),
      tbtn('skipFwd', 'To the end (End)', () => setPlayhead(duration(ed.project)))),
    time);
  root.replaceChildren(wrap, controls);

  // fit the stage in the space, keeping the project's shape
  const fit = () => {
    const p = ed.project;
    if (!p) return;
    const r = wrap.getBoundingClientRect();
    const k = Math.min((r.width - 24) / p.W, (r.height - 24) / p.H);
    stage.style.width = `${Math.max(40, p.W * k)}px`;
    stage.style.height = `${Math.max(40, p.H * k)}px`;
    overlay.setAttribute('viewBox', `0 0 ${p.W} ${p.H}`);
    size.textContent = `${p.W} × ${p.H} · ${p.fps} fps`;
  };
  new ResizeObserver(fit).observe(wrap);

  // ---------------------------------------------------------------- handles

  const natural = (c) => {
    const a = ed.project.assets[c.asset];
    if (c.type === 'text') { const pic = textPicture(c.text, ed.project.W); return { w: pic.w, h: pic.h }; }
    if (c.type === 'shape') return { w: c.shape.w, h: c.shape.h };
    return a?.width ? { w: a.width, h: a.height } : null;
  };
  const editable = (c) => c && ['video', 'image', 'text', 'shape'].includes(c.type);

  function drawHandles() {
    overlay.replaceChildren();
    const c = selectedClips()[0];
    if (!editable(c) || ed.playhead < c.start || ed.playhead > c.start + c.dur) return;
    const p = ed.project;
    const pts = clipCorners(p, c, ed.playhead, natural(c));
    const k = p.W / (stage.clientWidth || p.W); // one screen pixel in project units
    overlay.append(svgEl('polygon', { class: 'vw-box', points: pts.map((q) => q.join(',')).join(' '), 'stroke-width': 1.5 * k }));
    pts.forEach((q, i) => overlay.append(svgEl('rect', { class: 'vw-handle', 'data-h': `s${i}`, x: q[0] - 6 * k, y: q[1] - 6 * k, width: 12 * k, height: 12 * k, 'stroke-width': 1.5 * k })));
    const top = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    const cx = pts.reduce((s, q) => s + q[0], 0) / 4, cy = pts.reduce((s, q) => s + q[1], 0) / 4;
    const len = Math.hypot(top[0] - cx, top[1] - cy) || 1;
    const rot = [top[0] + ((top[0] - cx) / len) * 28 * k, top[1] + ((top[1] - cy) / len) * 28 * k];
    overlay.append(svgEl('line', { class: 'vw-box', x1: top[0], y1: top[1], x2: rot[0], y2: rot[1], 'stroke-width': 1.5 * k }));
    overlay.append(svgEl('circle', { class: 'vw-handle rot', 'data-h': 'rot', cx: rot[0], cy: rot[1], r: 7 * k, 'stroke-width': 1.5 * k }));
    if (guides.x) overlay.append(svgEl('line', { class: 'vw-guide', x1: p.W / 2, y1: 0, x2: p.W / 2, y2: p.H, 'stroke-width': k }));
    if (guides.y) overlay.append(svgEl('line', { class: 'vw-guide', x1: 0, y1: p.H / 2, x2: p.W, y2: p.H / 2, 'stroke-width': k }));
  }

  const toProject = (e) => {
    const r = stage.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * ed.project.W, ((e.clientY - r.top) / r.height) * ed.project.H];
  };
  const inside = (pt, poly) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };

  let drag = null;
  const guides = { x: false, y: false };
  stage.addEventListener('pointerdown', (e) => {
    const p = ed.project;
    const pt = toProject(e);
    const handle = e.target.closest?.('[data-h]')?.dataset.h;
    let c = selectedClips()[0];
    if (!handle) {
      // pick the top-most layer under the pointer
      const under = visibleAt(p, ed.playhead).map((v) => v.clip).filter(editable).reverse()
        .find((x) => !p.tracks.find((t) => t.id === x.track)?.locked && inside(pt, clipCorners(p, x, ed.playhead, natural(x))));
      if (!under) { select([]); return; }
      if (under.id !== c?.id) select([under.id]);
      c = under;
    }
    if (!editable(c) || p.tracks.find((t) => t.id === c.track)?.locked) return;
    const lt = Math.min(Math.max(ed.playhead - c.start, 0), c.dur);
    const pts = clipCorners(p, c, ed.playhead, natural(c));
    const cx = pts.reduce((s, q) => s + q[0], 0) / 4, cy = pts.reduce((s, q) => s + q[1], 0) / 4;
    drag = { id: c.id, kind: handle?.startsWith('s') ? 'scale' : handle === 'rot' ? 'rot' : 'move', pt, lt, cx, cy,
      x: valueAt(c, 'x', lt), y: valueAt(c, 'y', lt), scale: valueAt(c, 'scale', lt), rot: valueAt(c, 'rotation', lt),
      d0: Math.hypot(pt[0] - cx, pt[1] - cy) || 1, a0: Math.atan2(pt[1] - cy, pt[0] - cx), key: `vw-${Date.now()}` };
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = ed.project;
    const pt = toProject(e);
    const snapD = (p.W / (stage.clientWidth || p.W)) * 8;
    edit((proj) => {
      const c = clipById(proj, drag.id);
      if (!c) return;
      if (drag.kind === 'move') {
        let x = drag.x + pt[0] - drag.pt[0], y = drag.y + pt[1] - drag.pt[1];
        guides.x = Math.abs(x) < snapD; guides.y = Math.abs(y) < snapD;
        if (e.shiftKey) { if (Math.abs(x - drag.x) > Math.abs(y - drag.y)) y = drag.y; else x = drag.x; }
        if (guides.x) x = 0;
        if (guides.y) y = 0;
        setValue(c, 'x', Math.round(x), drag.lt); setValue(c, 'y', Math.round(y), drag.lt);
      } else if (drag.kind === 'scale') {
        const s = Math.max(0.01, (drag.scale * Math.hypot(pt[0] - drag.cx, pt[1] - drag.cy)) / drag.d0);
        setValue(c, 'scale', Math.round(s * 1000) / 1000, drag.lt);
      } else {
        let a = drag.rot + ((Math.atan2(pt[1] - drag.cy, pt[0] - drag.cx) - drag.a0) * 180) / Math.PI;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        else if (Math.abs(a - Math.round(a / 90) * 90) < 3) a = Math.round(a / 90) * 90;
        setValue(c, 'rotation', Math.round(a * 10) / 10, drag.lt);
      }
    }, drag.key);
  });
  const end = () => { drag = null; guides.x = guides.y = false; drawHandles(); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  on((what) => {
    if (what === 'open') { fit(); player.resize(); player.prepareFonts(); }
    if (what === 'project') { fit(); player.resize(); player.prepareFonts(); }
    if (['project', 'selection', 'time', 'frame', 'open'].includes(what)) drawHandles();
    if (['project', 'time', 'open', 'selection'].includes(what)) player.invalidate();
    if (what === 'play' || what === 'open') playBtn.innerHTML = icon(ed.playing ? 'pause' : 'play');
    if (['time', 'project', 'open'].includes(what)) time.textContent = `${fmtTime(ed.playhead)} / ${fmtTime(duration(ed.project))}`;
  });
  return { fit, canvas };
}
