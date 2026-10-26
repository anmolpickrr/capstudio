// The timeline: tracks of clips under a time ruler. Select, move (across tracks of
// the same kind), trim either edge, split with the razor or at the playhead, with
// snapping to the playhead and other clips' edges. Video clips show frames from
// their source and audio clips their waveform.
import { icon } from '../app/icons.js';
import { fmtTime, h } from '../app/ui.js';
import {
  addTrack, allKeyTimes, clipById, closeGap, duration, end, moveClip, removeTrack, snapPoints, splitClip, trimEnd, trimStart, valueAt,
} from './model.js';
import { thumbnails, waveform } from './media.js';
import { ed, edit, emit, on, select, setPlayhead } from './store.js';

const HEAD_W = 136, RULER_H = 28, LANE_H = { video: 62, audio: 50 }, EDGE = 7, SNAP_PX = 9;

export function mountTimeline(root, { onDropAsset, onSplit, onDelete }) {
  const heads = h('div', { class: 'et-heads' });
  const ruler = h('canvas', { class: 'et-ruler', height: RULER_H });
  const lanes = h('div', { class: 'et-lanes' });
  const playhead = h('div', { class: 'et-playhead' }, h('span', { class: 'et-playhead-cap' }));
  const inner = h('div', { class: 'et-inner' }, ruler, lanes, playhead);
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
  }

  function laneFor(track) {
    const row = h('div', { class: `et-lane ${track.type}${track.locked ? ' locked' : ''}${track.hidden || track.muted ? ' off' : ''}`,
      'data-track': track.id, style: { height: `${LANE_H[track.type]}px` } });
    const cs = ed.project.clips.filter((c) => c.track === track.id);
    for (const c of cs) row.append(clipEl(c, track));
    return row;
  }

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
    lanes.replaceChildren(...p.tracks.map(laneFor));
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
    if (!clipNode || e.target.closest('.et-ruler')) {
      // the ruler or empty space: move the playhead (and scrub while dragging)
      if (!e.shiftKey && !clipNode) select([]);
      setPlayhead(snap(t, [], 6));
      drag = { kind: 'scrub' };
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

  scroll.addEventListener('pointermove', (e) => {
    const clipNode = e.target.closest?.('.et-clip');
    if (!drag) {
      // edge cursor
      if (clipNode && ed.tool === 'select') {
        const r = clipNode.getBoundingClientRect();
        scroll.style.cursor = e.clientX - r.left < EDGE || r.right - e.clientX < EDGE ? 'ew-resize' : '';
      } else scroll.style.cursor = '';
      return;
    }
    const t = x2t(e.clientX);
    if (drag.kind === 'scrub') { setPlayhead(snap(t, [], 6)); return; }
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
  });

  const stop = () => { drag = null; };
  scroll.addEventListener('pointerup', stop);
  scroll.addEventListener('pointercancel', stop);
  scroll.addEventListener('dblclick', (e) => {
    const lane = e.target.closest('.et-lane');
    if (lane && !e.target.closest('.et-clip')) {
      const d = edit((p) => closeGap(p, lane.dataset.track, x2t(e.clientX)));
      if (!d) emit('project');
    }
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

