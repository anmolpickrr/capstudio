// "Every format at once": the same captions on 9:16, 4:5, 1:1 and 16:9 versions of
// the video, each reframed (crop to fill, or fit over a blurred background), with its
// captions checked against that format's safe zone and moved inside when needed.
import { CanvasRenderer } from '../engine/canvas.js';
import { CaptionEngine, toASS } from '../engine/index.js';
import { captionsFor, drawFrame, FORMATS, formatSize, frameRects, sameShape } from '../engine/reframe.js';
import { api, sleep } from './api.js';
import { browserCanExport, exportInBrowser, Unsupported } from './browserexport.js';
import { check, fitStyle, resolve, zoneById, ZONES } from './safezones.js';
import { ensureJob } from './session.js';
import { state } from './store.js';
import { h } from './ui.js';

const KEY = 'capstudio-formats';
const VERTICAL_ZONES = ZONES.filter((z) => z.vertical);

// How much of the picture a crop keeps; below about half, fitting it is kinder.
function keptByCrop(sw, sh, W, H) {
  const k = Math.max(W / sw, H / sh);
  return (W / k) * (H / k) / (sw * sh);
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function save(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private window */ } }

// Settings per format: on, mode (fill | fit), focus fx/fy, safe zone, and whether
// captions may be moved inside the zone. Remembered in this browser.
export function settings() {
  const info = state.project.info, saved = load();
  return Object.fromEntries(FORMATS.map((f) => {
    const { W, H } = formatSize(f, info.width, info.height);
    const s = saved[f.id] || {};
    return [f.id, {
      on: s.on ?? f.id !== '4x5',
      mode: s.mode || (keptByCrop(info.width, info.height, W, H) >= 0.5 ? 'fill' : 'fit'),
      fx: s.fx ?? 0.5, fy: s.fy ?? 0.5, zone: s.zone || f.zone, fix: s.fix ?? true,
    }];
  }));
}

export function setSetting(id, patch) {
  const all = load();
  all[id] = { ...(all[id] || {}), ...patch };
  save(all);
}

// Everything needed to make one format: size, framing, captions and style (moved
// into the safe zone if that's on), and the zone check before and after.
export function plan(format, set) {
  const info = state.project.info;
  const { W, H } = formatSize(format, info.width, info.height);
  const zone = zoneById(set.zone);
  const captions = captionsFor(state.captions, state.style, W, H);
  const before = check(captions, state.style, zone, W, H).count;
  let style = state.style, fixed = false;
  if (before && set.fix) {
    const s = fitStyle(captions, state.style, zone, W, H);
    if (s) { style = s; fixed = true; }
  }
  const after = fixed ? check(captions, style, zone, W, H).count : before;
  return { format, W, H, frame: { mode: set.mode, fx: set.fx, fy: set.fy }, zone, captions, style, before, after, fixed,
    same: sameShape(info.width, info.height, W, H) };
}

// ---------------------------------------------------------------- previews

function caption_t(captions) {
  const t = document.querySelector('.frame video')?.currentTime || 0;
  if (captions.some((c) => t >= c.start && t < c.end)) return t;
  const c = captions.find((x) => x.start >= t) || captions[0];
  return c ? Math.min(c.end - 0.05, c.start + Math.min(0.6, (c.end - c.start) / 2)) : t;
}

async function drawPreview(canvas, p) {
  const video = document.querySelector('.frame video');
  const full = new OffscreenCanvas(p.W, p.H), ctx = full.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, p.W, p.H);
  if (video?.videoWidth) {
    drawFrame(ctx, (c, sx, sy, sw, sh, dx, dy, dw, dh) => c.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh),
      video.videoWidth, video.videoHeight, p.W, p.H, p.frame, {});
  }
  const engine = new CaptionEngine();
  await engine.set({ captions: p.captions, style: p.style, W: p.W, H: p.H, spaced: state.transcript?.spaced ?? true });
  const t = caption_t(p.captions);
  new CanvasRenderer(p.W, p.H).render(ctx, engine.scenesAt(t), t);
  // the safe area, outlined
  const z = resolve(p.zone, p.W, p.H);
  if (z) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 90, 90, 0.18)';
    ctx.beginPath();
    ctx.rect(0, 0, p.W, p.H);
    ctx.rect(z.safe.x, z.safe.y, z.safe.w, z.safe.h);
    ctx.fill('evenodd');
    for (const e of z.extra) ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.setLineDash([p.W / 60, p.W / 90]);
    ctx.lineWidth = Math.max(2, p.W / 270);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.strokeRect(z.safe.x, z.safe.y, z.safe.w, z.safe.h);
    ctx.restore();
  }
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.drawImage(full, 0, 0, canvas.width, canvas.height);
}

// ---------------------------------------------------------------- the dialog section

export function formatsSection() {
  const all = settings();
  const info = state.project.info;
  const rows = FORMATS.map((f) => {
    let set = all[f.id];
    const box = h('input', { type: 'checkbox', checked: set.on ? true : null, 'aria-label': `Include ${f.label}` });
    const { W, H } = formatSize(f, info.width, info.height);
    const canvas = h('canvas', { class: 'fmt-preview', width: Math.round((W / H) * 160), height: 160 });
    const status = h('span', { class: 'fmt-status' });
    const modeSeg = h('div', { class: 'seg fmt-mode', role: 'group', 'aria-label': 'Framing' },
      [['fill', 'Crop to fill'], ['fit', 'Fit, blurred background']].map(([v, t]) => h('button', { type: 'button', 'data-v': v,
        onclick: () => update({ mode: v }) }, t)));
    // focus: which part of the picture a crop keeps
    const r = frameRects(info.width, info.height, W, H, { mode: 'fill' }).cover;
    const axis = r.sw < info.width - 1 ? 'fx' : 'fy';
    const focus = h('input', { type: 'range', class: 'range', min: 0, max: 100, step: 1, value: Math.round(set[axis] * 100),
      'aria-label': axis === 'fx' ? 'Keep: left to right' : 'Keep: top to bottom' });
    focus.addEventListener('input', () => update({ [axis]: Number(focus.value) / 100 }));
    const focusField = h('label', { class: 'field fmt-focus' },
      h('span', { class: 'label' }, axis === 'fx' ? 'Keep: left ↔ right' : 'Keep: top ↕ bottom'), focus);
    const zoneSel = f.id === '9x16'
      ? h('select', { class: 'select', 'aria-label': 'Safe zone' }, VERTICAL_ZONES.map((z) => h('option', { value: z.id }, z.name)))
      : null;
    if (zoneSel) { zoneSel.value = set.zone; zoneSel.addEventListener('change', () => update({ zone: zoneSel.value })); }
    const keep = h('button', { class: 'linkish', type: 'button', onclick: () => update({ fix: !set.fix }) });
    box.addEventListener('change', () => update({ on: box.checked }));

    function update(patch) {
      setSetting(f.id, patch);
      set = { ...set, ...patch };
      paint();
    }
    function paint() {
      const p = plan(f, set);
      row.classList.toggle('off', !set.on);
      modeSeg.hidden = p.same;
      modeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === set.mode)));
      focusField.hidden = p.same || set.mode !== 'fill';
      const zoneName = p.zone.id === 'title' ? 'title-safe area' : `${p.zone.name} safe zone`;
      status.className = `fmt-status ${p.after ? 'bad' : 'ok'}`;
      status.textContent = p.after
        ? `${p.after} caption${p.after > 1 ? 's' : ''} cross the ${zoneName}`
        : p.fixed ? `Moved inside the ${zoneName}` : `Inside the ${zoneName}`;
      keep.hidden = !(p.fixed || (!set.fix && p.before));
      keep.textContent = set.fix ? 'Keep my layout' : 'Move inside';
      drawPreview(canvas, p);
    }
    const row = h('div', { class: 'fmt-row' },
      h('label', { class: 'fmt-pick' }, box, canvas),
      h('div', { class: 'fmt-body' },
        h('div', { class: 'fmt-title' }, h('b', {}, f.label), h('small', {}, `${W} × ${H} · ${f.note}`)),
        modeSeg, focusField,
        h('div', { class: 'fmt-zone' }, zoneSel || h('span', { class: 'hint' }, 'Title safe (10% margins)'), status, keep)));
    requestAnimationFrame(paint);
    return row;
  });
  return h('div', { class: 'fmt-list' }, rows);
}

// ---------------------------------------------------------------- export

async function serverRender(p, quality, onProgress, signal) {
  const job = await ensureJob();
  const ass = toASS(p.captions, p.style, p.W, p.H, { spaced: state.transcript?.spaced ?? true });
  const stream = new Blob([ass]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await api(`/api/jobs/${job}/render`, { method: 'POST', body: {
    mode: 'burn', quality, ass_gz: btoa(bin), watermark: state.watermark.on ? state.watermark : null,
    reframe: { width: p.W, height: p.H, mode: p.frame.mode, fx: p.frame.fx, fy: p.frame.fy, suffix: p.format.id },
  } });
  for (;;) {
    await sleep(700);
    if (signal?.aborted) {
      await api(`/api/jobs/${job}/render/cancel`, { method: 'POST' }).catch(() => {});
      throw new DOMException('Export cancelled.', 'AbortError');
    }
    const r = (await api(`/api/jobs/${job}`)).render;
    if (r.status === 'error') throw new Error(r.error || 'Export failed.');
    if (r.status === 'running') onProgress(r.progress);
    if (r.status === 'done') {
      const blob = await (await fetch(`/api/jobs/${job}/download`)).blob();
      return { blob, file: r.file, size: blob.size };
    }
  }
}

// Make every chosen format, one after another. onProgress(index, count, label, p).
export async function exportFormats({ quality, onProgress, signal }) {
  const all = settings();
  const chosen = FORMATS.filter((f) => all[f.id].on).map((f) => plan(f, all[f.id]));
  if (!chosen.length) throw new Error('Pick at least one format.');
  const stem = (state.project.name || 'video').replace(/\.[^.]*$/, '');
  const results = [];
  let browser = browserCanExport() && !!state.project.file && state.project.info.vcodec !== 'prores';
  for (const [i, p] of chosen.entries()) {
    const progress = (x) => onProgress(i, chosen.length, p.format.label, x);
    let r = null;
    if (browser) {
      try {
        r = await exportInBrowser({
          file: state.project.file, name: state.project.name || 'video.mp4', info: state.project.info,
          captions: p.captions, style: p.style, spaced: state.transcript?.spaced ?? true, watermark: state.watermark,
          quality, signal, onProgress: progress, out: { W: p.W, H: p.H, frame: p.frame, file: `${stem} ${p.format.id}` },
        });
      } catch (e) {
        if (signal?.aborted || !(e instanceof Unsupported)) throw e;
        browser = false; // the server makes this one and the rest
      }
    }
    if (!r) r = await serverRender(p, quality, progress, signal);
    results.push({ ...r, label: p.format.label, W: p.W, H: p.H, after: p.after });
  }
  return results;
}
