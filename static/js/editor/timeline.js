// The timeline: tracks of clips under a time ruler. Select, move (across tracks of
// the same kind), trim either edge, split with the razor or at the playhead, with
// snapping to the playhead and other clips' edges. Video clips show frames from
// their source and audio clips their waveform.
import { icon } from '../app/icons.js';
import { fmtTime, h } from '../app/ui.js';
import {
  addTrack, allKeyTimes, clipById, closeGap, duration, end, moveClip, removeTrack, setSpeed, snapPoints, splitClip, trimEnd, trimStart, valueAt,
} from './model.js';
import { copySelection, deleteSelection, duplicateSelection, paste, splitAtPlayhead } from './actions.js';
import { thumbnails, waveform } from './media.js';
import { openMenu } from './menu.js';
import { ed, edit, emit, on, select, setPlayhead } from './store.js';

const HEAD_W = 136, RULER_H = 28, LANE_H = { video: 62, audio: 50 }, EDGE = 7, SNAP_PX = 9;

export function mountTimeline(root, { onDropAsset, onSplit, onDelete }) {
  const heads = h('div', { class: 'et-heads' });
  const ruler = h('canvas', { class: 'et-ruler', height: RULER_H });
  const lanes = h('div', { class: 'et-lanes' });
  const playhead = h('div', { class: 'et-playhead' }, h('span', { class: 'et-playhead-cap' }));
  const inner = h('div', { class: 'et-inner' }, ruler, lanes, playhead);
  const marquee = h('div', { class: 'et-marquee' });
  const scroll = h('div', { class: 'et-scroll' }, inner);
  const zoomRange = h('input', { type: 'range', class: 'range et-zoom', min: 0, max: 100, step: 1, 'aria-label': 'Timeline zoom' });
  const toolBtn = (tool, ico, tip) => h('button', { class: 'btn ghost sm icon-only', type: 'button', 'data-tool': tool, 'data-tip': tip, 'aria-label': tip,
    html: icon(ico), onclick: () => { ed.tool = tool; emit('tool'); } });
  const toggleBtn = (key, ico, tip) => h('button', { class: 'btn ghost sm icon-only', type: 'button', 'data-toggle': key, 'data-tip': tip, 'aria-label': tip,
    html: icon(ico), onclick: () => { ed[key] = !ed[key]; emit('tool'); } });
  const time = h('span', { class: 'et-time' });
  const toolbar = h('div', { class: 'et-toolbar' },
    h('div', { class: 'et-group' }, toolBtn('select', 'cursor', 'Select (V)'), toolBtn('razor', 'scissors', 'Razor: click a clip to cut it (C)')),
    h('div', { class: 'et-group' },
      h('button', { class: 'btn ghost sm', type: 'button', 'data-tip': 'Split the selected clips (or all) at the playhead (S)', html: `${icon('split')}<span>Split</span>`, onclick: onSplit }),
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'data-tip': 'Delete (Del). Shift+Del closes the gap.', 'aria-label': 'Delete', html: icon('trash'), onclick: () => onDelete(false) })),
    h('div', { class: 'et-group' }, toggleBtn('snap', 'magnet', 'Snapping'), toggleBtn('ripple', 'ripple', 'Ripple: deleting closes the gap')),
    h('div', { class: 'et-group' },
      h('button', { class: 'btn ghost sm', type: 'button', html: `${icon('plus')}<span>Video track</span>`, onclick: () => edit((p) => addTrack(p, 'video')) }),
      h('button', { class: 'btn ghost sm', type: 'button', html: `${icon('plus')}<span>Audio track</span>`, onclick: () => edit((p) => addTrack(p, 'audio')) })),
    h('span', { class: 'grow' }),
    time,
    h('div', { class: 'et-group' },
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Zoom out', html: icon('minus'), onclick: () => setZoom(ed.zoom / 1.4) }),
      zoomRange,
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Zoom in', html: icon('plus'), onclick: () => setZoom(ed.zoom * 1.4) }),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: fit }, 'Fit')));
  const body = h('div', { class: 'et-body' }, heads, scroll);
  root.replaceChildren(toolbar, body);

  // zoom: 4 px/s (minutes on screen) to 600 px/s (single frames)
  const zFrom = (v) => 4 * (150 ** (v / 100)), zTo = (z) => (100 * Math.log(z / 4)) / Math.log(150);
  zoomRange.addEventListener('input', () => setZoom(zFrom(Number(zoomRange.value))));
  function setZoom(z, anchorX = null) {
    const old = ed.zoom;
    ed.zoom = Math.min(600, Math.max(4, z));
    const ax = anchorX ?? (scroll.clientWidth / 2);
    const t = (scroll.scrollLeft + ax) / old;
    render();
    scroll.scrollLeft = t * ed.zoom - ax;
  }
  function fit() { setZoom(Math.max(4, (scroll.clientWidth - 40) / Math.max(5, duration(ed.project)))); scroll.scrollLeft = 0; }

  const x2t = (clientX) => Math.max(0, (clientX - lanes.getBoundingClientRect().left) / ed.zoom);
  const laneRows = () => [...lanes.children];
  function trackAtY(clientY) {
    for (const row of laneRows()) {
      const r = row.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return row.dataset.track;
    }
    return null;
  }
  function snap(t, except, px = SNAP_PX) {
    if (!ed.snap) return t;
    let best = t, dist = px / ed.zoom;
    for (const s of snapPoints(ed.project, ed.playhead, except)) {
      if (Math.abs(s - t) < dist) { dist = Math.abs(s - t); best = s; }
    }
    return best;
  }

  // ---------------------------------------------------------------- drawing

  function drawRuler() {
    const w = Math.max(scroll.clientWidth, inner.offsetWidth);
    const dpr = devicePixelRatio || 1;
    ruler.width = w * dpr; ruler.height = RULER_H * dpr;
    ruler.style.width = `${w}px`;
    ruler.style.height = `${RULER_H}px`;
    const c = ruler.getContext('2d');
    c.scale(dpr, dpr);
    c.clearRect(0, 0, w, RULER_H);
    const steps = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const major = steps.find((s) => s * ed.zoom >= 70) || 600;
    const minor = steps.filter((s) => s < major).reverse().find((s) => s * ed.zoom >= 9) || major;
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '11px ui-monospace, Menlo, monospace';
    c.beginPath();
    for (let t = 0; t * ed.zoom < w; t += minor) {
      const x = Math.round(t * ed.zoom) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      c.moveTo(x, isMajor ? 10 : 19); c.lineTo(x, RULER_H);
      if (isMajor) c.fillText(fmtRuler(t, major), x + 4, 12);
    }
    c.stroke();
    // the music's beats, when found
    const beats = ed.project?.beats?.times;
    if (beats) {
      c.fillStyle = '#ffd166';
      for (const b of beats) { const x = b * ed.zoom; if (x > w) break; c.beginPath(); c.moveTo(x - 3, RULER_H); c.lineTo(x + 3, RULER_H); c.lineTo(x, RULER_H - 5); c.fill(); }
    }
  }

  // Lanes and clips are kept and updated in place: a clip that only moved is just
  // repositioned (its frames and waveform aren't drawn again), so dragging stays smooth.
  const laneEls = new Map(), clipEls = new Map();
  function laneFor(track) {
    let row = laneEls.get(track.id);
    if (!row) { row = h('div', { 'data-track': track.id }); laneEls.set(track.id, row); }
    row.className = `et-lane ${track.type}${track.locked ? ' locked' : ''}${track.hidden || track.muted ? ' off' : ''}`;
    row.style.height = `${LANE_H[track.type]}px`;
    return row;
  }
  // everything that changes how a clip looks, apart from where it is
  const contentOf = (c) => JSON.stringify([c.type, c.name, c.asset, c.in, c.dur, c.speed, ed.zoom, ed.selection.includes(c.id),
    c.text?.content, Object.keys(c.keys || {}).length, ed.selection.includes(c.id) ? allKeyTimes(c) : 0, c.transIn, c.transOut,
    c.audio?.fadeIn, c.audio?.fadeOut, c.audio?.detached, c.captions?.length, c.captions?.[0]?.start, c.anim, c.keys?.volume]);

  function clipEl(c, track) {
    const sel = ed.selection.includes(c.id);
    const w = Math.max(2, c.dur * ed.zoom);
    const el = h('div', { class: `et-clip t-${c.type}${sel ? ' selected' : ''}`, 'data-id': c.id,
      style: { left: `${c.start * ed.zoom}px`, width: `${w}px` }, title: `${c.name} · ${fmtTime(c.dur)}` });
    const asset = ed.project.assets[c.asset];
    if ((c.type === 'video' || c.type === 'image') && asset) {
      const cv = h('canvas', { class: 'et-thumbs' });
      el.append(cv);
      requestAnimationFrame(() => paintThumbs(cv, c, asset, w, LANE_H[track.type] - 2));
    }
    if ((c.type === 'audio' || (c.type === 'video' && asset?.hasAudio && !c.audio?.detached)) && asset) {
      const cv = h('canvas', { class: `et-wave${c.type === 'video' ? ' small' : ''}` });
      el.append(cv);
      requestAnimationFrame(() => paintWave(cv, c, asset, w, c.type === 'video' ? 16 : LANE_H[track.type] - 18));
    }
    if (c.type === 'captions') {
      const strip = h('div', { class: 'et-caps' });
      for (const cap of c.captions || []) {
        strip.append(h('i', { style: { left: `${cap.start * ed.zoom}px`, width: `${Math.max(1, (cap.end - cap.start) * ed.zoom - 1)}px` } }));
      }
      el.append(strip);
    }
    const label = h('div', { class: 'et-label' },
      c.speed !== 1 ? h('b', {}, `${+c.speed.toFixed(2)}×`) : null,
      h('span', {}, c.type === 'text' ? (c.text.content || 'Text') : c.name),
      Object.keys(c.keys || {}).length ? h('span', { class: 'et-badge', html: icon('diamond') }) : null);
    el.append(label);
    if (c.transIn?.type) el.append(h('div', { class: 'et-trans in', title: `Transition: ${c.transIn.type} ${c.transIn.dur}s`, style: { width: `${Math.max(8, (c.transIn.dur / 2) * ed.zoom)}px` } }));
    if (c.transOut?.type) el.append(h('div', { class: 'et-trans out', title: `Exit: ${c.transOut.type} ${c.transOut.dur}s`, style: { width: `${Math.max(8, c.transOut.dur * ed.zoom)}px` } }));
    if (c.audio?.fadeIn) el.append(h('div', { class: 'et-fade in', style: { width: `${c.audio.fadeIn * ed.zoom}px` } }));
    if (c.audio?.fadeOut) el.append(h('div', { class: 'et-fade out', style: { width: `${c.audio.fadeOut * ed.zoom}px` } }));
    if (sel) {
      for (const k of allKeyTimes(c)) {
        if (k < 0 || k > c.dur) continue;
        el.append(h('button', { class: 'et-key', type: 'button', style: { left: `${k * ed.zoom}px` }, title: `Keyframe at ${fmtTime(c.start + k)}`,
          'data-t': c.start + k, html: icon('diamond') }));
      }
    }
    el.append(h('div', { class: 'et-edge l' }), h('div', { class: 'et-edge r' }));
    return el;
  }

  async function paintThumbs(cv, c, asset, w, hgt) {
    const dpr = devicePixelRatio || 1, cw = Math.min(w, 4000);
    cv.width = cw * dpr; cv.height = hgt * dpr; cv.style.width = `${cw}px`; cv.style.height = `${hgt}px`;
    const thumbs = await thumbnails(asset);
    if (!thumbs.length || !cv.isConnected) return;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const tw = (hgt * thumbs[0].img.width) / thumbs[0].img.height;
    for (let x = 0; x < cw; x += tw) {
      const st = c.type === 'image' ? 0 : c.in + ((x + tw / 2) / ed.zoom) * c.speed;
      let best = thumbs[0];
      for (const th of thumbs) if (Math.abs(th.t - st) < Math.abs(best.t - st)) best = th;
      g.drawImage(best.img, x, 0, tw, hgt);
    }
  }

  async function paintWave(cv, c, asset, w, hgt) {
    const dpr = devicePixelRatio || 1, cw = Math.min(w, 8000);
    cv.width = cw * dpr; cv.height = hgt * dpr; cv.style.width = `${cw}px`; cv.style.height = `${hgt}px`;
    const peaks = await waveform(asset);
    if (!peaks || !cv.isConnected) return;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = c.type === 'video' ? 'rgba(255,255,255,0.55)' : 'rgba(167, 243, 208, 0.9)';
    const mid = hgt / 2;
    for (let x = 0; x < cw; x++) {
      const s0 = c.in + (x / ed.zoom) * c.speed, s1 = c.in + ((x + 1) / ed.zoom) * c.speed;
      let v = 0;
      for (let k = Math.floor(s0 * 100); k <= Math.floor(s1 * 100) && k < peaks.length; k++) v = Math.max(v, peaks[k] || 0);
      const lt = x / ed.zoom;
      const gain = Math.min(2, valueAt(c, 'volume', lt));
      const a = Math.min(mid, Math.max(0.5, v * gain * mid));
      g.fillRect(x, mid - a, 1, 2 * a);
    }
  }

  function headFor(track) {
    const n = ed.project.tracks.filter((t) => t.type === track.type).length;
    const btn = (on, ico, offIco, tip, key) => h('button', { class: `btn ghost xs icon-only${on ? ' on' : ''}`, type: 'button', 'aria-label': tip, 'data-tip': tip,
      html: icon(on ? offIco : ico), onclick: () => edit((p) => { const t = p.tracks.find((x) => x.id === track.id); t[key] = !t[key]; }) });
    return h('div', { class: `et-head ${track.type}`, style: { height: `${LANE_H[track.type]}px` } },
      h('b', {}, track.name),
      track.type === 'video'
        ? btn(track.hidden, 'eye', 'eyeOff', track.hidden ? 'Show track' : 'Hide track', 'hidden')
        : btn(track.muted, 'volume', 'mute', track.muted ? 'Unmute track' : 'Mute track', 'muted'),
      btn(track.locked, 'unlock', 'lock', track.locked ? 'Unlock track' : 'Lock track', 'locked'),
      n > 1 ? h('button', { class: 'btn ghost xs icon-only et-del', type: 'button', 'aria-label': 'Delete track', 'data-tip': 'Delete track and its clips',
        html: icon('close'), onclick: () => edit((p) => removeTrack(p, track.id)) }) : null);
  }

  function render() {
    const p = ed.project;
    if (!p) return;
    const total = Math.max(duration(p) + 20, scroll.clientWidth / ed.zoom);
    inner.style.width = `${total * ed.zoom}px`;
    heads.replaceChildren(h('div', { class: 'et-heads-top', style: { height: `${RULER_H}px` } }), ...p.tracks.map(headFor));
    const rows = p.tracks.map(laneFor);
    if (rows.some((r, i) => lanes.children[i] !== r) || lanes.children.length !== rows.length) lanes.replaceChildren(...rows);
    for (const id of laneEls.keys()) if (!p.tracks.some((t) => t.id === id)) laneEls.delete(id);
    const seen = new Set();
    for (const c of p.clips) {
      seen.add(c.id);
      const track = p.tracks.find((t) => t.id === c.track);
      const sig = contentOf(c);
      let e = clipEls.get(c.id);
      if (!e || e.sig !== sig) {
        const el = clipEl(c, track);
        if (e) e.el.replaceWith(el);
        e = { el, sig };
        clipEls.set(c.id, e);
      }
      e.el.style.left = `${c.start * ed.zoom}px`;
      const row = laneEls.get(c.track);
      if (e.el.parentNode !== row) row.append(e.el);
    }
    for (const [id, e] of clipEls) if (!seen.has(id)) { e.el.remove(); clipEls.delete(id); }
    zoomRange.value = zTo(ed.zoom);
    toolbar.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === ed.tool)));
    toolbar.querySelectorAll('[data-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(!!ed[b.dataset.toggle])));
    root.classList.toggle('razor', ed.tool === 'razor');
    drawRuler();
    placePlayhead();
  }

  function placePlayhead(follow = false) {
    const x = ed.playhead * ed.zoom;
    playhead.style.transform = `translateX(${x}px)`;
    time.textContent = `${fmtTime(ed.playhead)} / ${fmtTime(duration(ed.project))}`;
    if (follow && (x < scroll.scrollLeft || x > scroll.scrollLeft + scroll.clientWidth - 40)) scroll.scrollLeft = x - 60;
  }

  // ---------------------------------------------------------------- pointer

  let drag = null;
  scroll.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const keyBtn = e.target.closest('.et-key');
    if (keyBtn) { setPlayhead(Number(keyBtn.dataset.t)); return; }
    const clipNode = e.target.closest('.et-clip');
    const t = x2t(e.clientX);
    if (e.target.closest('.et-ruler') || (!clipNode && !e.target.closest('.et-lane'))) {
      // the ruler: move the playhead (and scrub while dragging)
      setPlayhead(snap(t, [], 6));
      drag = { kind: 'scrub' };
      scroll.setPointerCapture(e.pointerId);
      return;
    }
    if (!clipNode) {
      // empty track space: drag a box to select clips (a click deselects and moves the playhead)
      const r = inner.getBoundingClientRect();
      drag = { kind: 'marquee', x0: e.clientX - r.left, y0: e.clientY - r.top, t0: t, add: e.shiftKey ? [...ed.selection] : [], moved: false };
      scroll.setPointerCapture(e.pointerId);
      return;
    }
    const c = clipById(ed.project, clipNode.dataset.id);
    const track = ed.project.tracks.find((x) => x.id === c.track);
    if (ed.tool === 'razor') {
      if (track.locked) return;
      const at = snap(t, []);
      edit((p) => splitClip(p, c.id, at));
      return;
    }
    // (measured before selecting: selecting redraws the clips)
    const r = clipNode.getBoundingClientRect();
    const edge = e.clientX - r.left < EDGE ? 'l' : r.right - e.clientX < EDGE ? 'r' : null;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      select(ed.selection.includes(c.id) ? ed.selection.filter((id) => id !== c.id) : [...ed.selection, c.id]);
    } else if (!ed.selection.includes(c.id)) select([c.id]);
    if (track.locked) return;
    drag = {
      kind: edge ? `trim-${edge}` : 'move', id: c.id, x0: e.clientX, t0: t, moved: false,
      orig: ed.selection.map((id) => { const o = clipById(ed.project, id); return { id, start: o.start, track: o.track }; }),
      start: c.start, end: end(c), key: `drag-${Date.now()}`,
    };
    scroll.setPointerCapture(e.pointerId);
  });

  // pointer moves are handled once per frame (the latest one), however fast they come
  let pending = null;
  scroll.addEventListener('pointermove', (e) => {
    if (!drag) { hover(e); return; }
    const first = !pending;
    pending = e;
    if (first) requestAnimationFrame(() => { const ev = pending; pending = null; if (drag) dragTo(ev); });
  });
  function hover(e) {
    const clipNode = e.target.closest?.('.et-clip');
    // edge cursor
    if (clipNode && ed.tool === 'select') {
      const r = clipNode.getBoundingClientRect();
      scroll.style.cursor = e.clientX - r.left < EDGE || r.right - e.clientX < EDGE ? 'ew-resize' : '';
    } else scroll.style.cursor = '';
  }
  // near the left or right edge while dragging, the timeline scrolls along
  function edgeScroll(e) {
    if (!drag) return;
    const r = scroll.getBoundingClientRect(), zone = 48;
    const d = e.clientX < r.left + zone ? -(r.left + zone - e.clientX) : e.clientX > r.right - zone ? e.clientX - (r.right - zone) : 0;
    if (!d) return;
    scroll.scrollLeft += d * 0.6;
    requestAnimationFrame(() => { if (drag && !pending) dragTo(e); });
  }
  function dragTo(e) {
    edgeScroll(e);
    const t = x2t(e.clientX);
    if (drag.kind === 'scrub') { setPlayhead(snap(t, [], 6)); return; }
    if (drag.kind === 'marquee') {
      const r = inner.getBoundingClientRect();
      const x1 = e.clientX - r.left, y1 = e.clientY - r.top;
      if (!drag.moved && Math.hypot(x1 - drag.x0, y1 - drag.y0) < 4) return;
      drag.moved = true;
      const box = { l: Math.min(drag.x0, x1), t: Math.min(drag.y0, y1), w: Math.abs(x1 - drag.x0), h: Math.abs(y1 - drag.y0) };
      Object.assign(marquee.style, { left: `${box.l}px`, top: `${box.t}px`, width: `${box.w}px`, height: `${box.h}px` });
      if (!marquee.isConnected) inner.append(marquee);
      const hit = [];
      for (const [id, ce] of clipEls) {
        const cr = ce.el.getBoundingClientRect();
        const cl = cr.left - r.left, ct = cr.top - r.top;
        if (cl < box.l + box.w && cl + cr.width > box.l && ct < box.t + box.h && ct + cr.height > box.t) hit.push(id);
      }
      select([...new Set([...drag.add, ...hit])]);
      return;
    }
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3) return;
    drag.moved = true;
    if (drag.kind === 'trim-l') { const to = snap(drag.start + (t - drag.t0), [drag.id]); edit((p) => trimStart(p, drag.id, to), drag.key); return; }
    if (drag.kind === 'trim-r') { const to = snap(drag.end + (t - drag.t0), [drag.id]); edit((p) => trimEnd(p, drag.id, to), drag.key); return; }
    // move: snap the primary clip's start or end
    const prim = drag.orig.find((o) => o.id === drag.id);
    const c = clipById(ed.project, drag.id);
    let s = prim.start + (t - drag.t0);
    const except = drag.orig.map((o) => o.id);
    const sS = snap(s, except), sE = snap(s + c.dur, except) - c.dur;
    s = Math.abs(sS - s) <= Math.abs(sE - s) ? sS : sE;
    const delta = s - prim.start;
    const overTrack = trackAtY(e.clientY);
    edit((p) => {
      for (const o of drag.orig) {
        const target = o.id === drag.id && overTrack ? overTrack : o.track;
        if (!moveClip(p, o.id, o.start + delta, target)) moveClip(p, o.id, o.start + delta, o.track);
      }
    }, drag.key);
  }

  const stop = () => {
    if (pending && drag) dragTo(pending);
    pending = null;
    if (drag?.kind === 'marquee') { marquee.remove(); if (!drag.moved) { select([]); setPlayhead(snap(drag.t0, [], 6)); } }
    drag = null;
  };
  scroll.addEventListener('pointerup', stop);
  scroll.addEventListener('pointercancel', stop);
  scroll.addEventListener('dblclick', (e) => {
    const lane = e.target.closest('.et-lane');
    if (lane && !e.target.closest('.et-clip')) {
      const d = edit((p) => closeGap(p, lane.dataset.track, x2t(e.clientX)));
      if (!d) emit('project');
    }
  });

  // right-click a clip: the usual edits in one place
  scroll.addEventListener('contextmenu', (e) => {
    const node = e.target.closest('.et-clip');
    e.preventDefault();
    if (!node) {
      openMenu(e.clientX, e.clientY, [{ label: 'Paste here', hint: 'Ctrl+V', run: () => { setPlayhead(x2t(e.clientX)); paste(); } }]);
      return;
    }
    const c = clipById(ed.project, node.dataset.id);
    if (!ed.selection.includes(c.id)) select([c.id]);
    const at = x2t(e.clientX);
    const media = c.type === 'video' || c.type === 'audio';
    openMenu(e.clientX, e.clientY, [
      { label: 'Split here', hint: 'C', run: () => edit((p) => splitClip(p, c.id, snap(at, []))) },
      { label: 'Split at the playhead', hint: 'S', run: splitAtPlayhead },
      null,
      { label: 'Duplicate', hint: 'Ctrl+D', run: duplicateSelection },
      { label: 'Copy', hint: 'Ctrl+C', run: copySelection },
      { label: 'Paste at the playhead', hint: 'Ctrl+V', run: paste },
      null,
      media ? { title: 'Speed', row: [0.5, 1, 1.5, 2, 4].map((v) => ({ label: `${v}×`, on: c.speed === v, run: () => edit((p) => setSpeed(p, c.id, v)) })) } : false,
      c.type !== 'audio' && c.type !== 'captions' ? { title: 'In', row: [['', 'None'], ['dissolve', 'Dissolve'], ['zoom', 'Zoom'], ['whip-left', 'Whip']].map(([t, l]) => ({
        label: l, on: (c.transIn?.type || '') === t, run: () => edit((p) => { clipById(p, c.id).transIn = t ? { type: t, dur: 0.5 } : null; }) })) } : false,
      { label: 'Delete', hint: 'Del', run: () => deleteSelection(false) },
      { label: 'Delete and close the gap', hint: 'Shift+Del', run: () => deleteSelection(true) },
    ].filter((x) => x !== false));
  });

  scroll.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setZoom(ed.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - scroll.getBoundingClientRect().left);
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
      // vertical wheel scrolls tracks; with many tracks keep it, otherwise scroll time
      if (scroll.scrollHeight <= scroll.clientHeight + 2) { e.preventDefault(); scroll.scrollLeft += e.deltaY; }
    }
  }, { passive: false });
  scroll.addEventListener('scroll', () => { heads.scrollTop = scroll.scrollTop; drawRuler(); });

  // drops from the library
  scroll.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('text/x-capstudio')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  scroll.addEventListener('drop', (e) => {
    const data = e.dataTransfer.getData('text/x-capstudio');
    if (!data) return;
    e.preventDefault();
    onDropAsset(JSON.parse(data), snap(x2t(e.clientX), []), trackAtY(e.clientY));
  });

  on((what) => {
    if (what === 'time') placePlayhead(ed.playing);
    else if (['project', 'selection', 'open', 'tool', 'zoom'].includes(what)) render();
  });
  new ResizeObserver(() => drawRuler()).observe(scroll);
  render();
  return { render, fit, setZoom };
}

function fmtRuler(t, major) {
  if (major < 1) return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${String(Math.round((t % 1) * 100)).padStart(2, '0')}`;
  return `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
}

