// Export: burn captions into the video at the original quality, add a subtitle
// track without re-encoding, or download caption files. Burning runs in the
// browser when it can (fast, on the computer's video hardware) and on the
// server otherwise.
import { toASS, toSRT, toTXT, toVTT } from '../engine/index.js';
import { ensureFonts } from '../engine/fonts.js';
import { fontsFor } from '../engine/layout.js';
import { api, sleep } from './api.js';
import { ensureJob } from './session.js';
import { browserCanExport, exportInBrowser, Unsupported } from './browserexport.js';
import { exportOverlay } from './overlayexport.js';
import { exportAE } from './aeexport.js';
import { exportFormats, formatsSection } from './formats.js';
import { addToTimeline, inPremiere } from './premiere.js';
import { icon } from './icons.js';
import { emit, state } from './store.js';
import { $, download, h, toast } from './ui.js';

let dlg = null, running = false, cancelled = false, blobUrl = null, blobs = [];

const codecName = (c) => ({ h264: 'H.264', hevc: 'HEVC', prores: 'ProRes', vp9: 'VP9', av1: 'AV1' }[c] || c);
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fmtSize = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);

function baseName() { return (state.project?.name || 'video').replace(/\.[^.]+$/, ''); }
function dims() { const i = state.project.info; return [i.width, i.height]; }
const spaced = () => state.transcript?.spaced ?? true;

async function captionFile(kind) {
  const [W, H] = dims();
  await ensureFonts(fontsFor(state.captions, state.style));
  const b = baseName();
  if (kind === 'srt') download(`${b}.srt`, toSRT(state.captions, state.style, W, H, spaced()), 'application/x-subrip');
  if (kind === 'vtt') download(`${b}.vtt`, toVTT(state.captions, state.style, W, H, spaced()), 'text/vtt');
  if (kind === 'ass') download(`${b}.ass`, toASS(state.captions, state.style, W, H, { spaced: spaced() }), 'text/x-ssa');
  if (kind === 'txt') download(`${b}.txt`, toTXT(state.captions, spaced()));
}

export function openExport() {
  if (inPremiere && state.premiere) return openTimelineExport();
  dlg = $('#export-dialog');
  const info = state.project.info;
  const cfg = state.config;
  // ProRes is kept as ProRes, which only the server can write
  const inBrowser = browserCanExport() && !!state.project.file && info.vcodec !== 'prores';
  const outCodec = info.vcodec === 'prores' ? 'ProRes (same profile)' : info.vcodec === 'hevc' && !cfg.lowPower && !inBrowser ? 'HEVC' : 'H.264';
  // A small server can't draw captions into videos above 1080p (not enough memory).
  const serverCanBurn = !cfg.maxBurnPixels || info.width * info.height <= cfg.maxBurnPixels;
  const canBurn = inBrowser || serverCanBurn;
  let quality = 'high';
  const qSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Quality' },
    [['max', 'Maximum'], ['high', 'High'], ['fast', 'Fast']].map(([v, t]) => h('button', { type: 'button', 'data-v': v, 'aria-pressed': String(v === quality),
      onclick: (e) => { quality = v; qSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t)));
  const opt = (value, title, desc, extra, checked, disabled) => h('label', { class: `option${disabled ? ' disabled' : ''}` },
    h('input', { type: 'radio', name: 'export-kind', value, checked: checked ? true : null, disabled: disabled ? true : null }),
    h('div', { style: { display: 'grid', gap: '8px' } }, h('div', {}, h('b', {}, title), h('span', {}, desc)), extra));
  const files = h('div', { class: 'files' }, [['srt', 'SRT'], ['vtt', 'WebVTT'], ['ass', 'ASS (styled)'], ['txt', 'Transcript']]
    .map(([k, t]) => h('button', { class: 'btn sm', type: 'button', html: `<span>${t}</span>`, onclick: () => captionFile(k) })));
  const status = h('div', { id: 'export-status' });
  const go = h('button', { class: 'btn brand lg', type: 'button', html: '<span>Export video</span>', onclick: () => start() });
  const r = state.config.retention;
  const formats = formatsSection();
  formats.hidden = true;

  dlg.replaceChildren(h('div', { class: 'modal' },
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, 'Export'), h('p', {}, 'Same resolution, frame rate, audio and file name as your original.')),
      h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => dlg.close() })),
    h('div', { class: 'modal-body' },
      h('div', { class: 'specs' },
        h('span', {}, `${info.width}×${info.height}`), h('span', {}, info.fps ? `${+info.fps.toFixed(3)} fps` : 'Variable frame rate'),
        h('span', {}, codecName(info.vcodec) + (info.pixFmt?.includes('10') ? ' 10-bit' : '')), h('span', {}, fmtDur(info.duration))),
      inBrowser ? h('p', { class: 'note info' }, 'Your video is made right here on your computer, so there’s no waiting for the server. A 30-second reel usually takes well under a minute. Keep this tab open while it runs.')
        : cfg.lowPower && canBurn ? h('p', { class: 'note info' }, 'This browser can’t make the video itself, so the server does it. That takes a few minutes, about 3 to 6 for a 30-second reel. For much faster exports, use Chrome or Edge. Keep this tab open while it runs.') : null,
      canBurn ? null : h('p', { class: 'note' }, `This server can draw captions into videos up to 1080p, and this one is ${info.width}×${info.height}. You can still add a subtitle track or download caption files.`),
      opt('burn', 'Video with captions', `Captions drawn into the picture exactly as previewed. Encoded as ${outCodec}.`,
        canBurn ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Quality'), qSeg,
          h('span', { class: 'hint' }, 'High is visually identical to the original. Maximum is for further editing; Fast is quickest.')) : null, canBurn, !canBurn),
      opt('formats', 'Every format at once', 'Vertical 9:16, portrait 4:5, square 1:1 and landscape 16:9 versions in one go, each reframed and with its captions checked against that format’s safe zone. Uses the quality above.', formats),
      opt('overlay', 'Captions only, transparent', 'Just the captions (and the watermark, if it’s on) on a see-through background, for Premiere Pro and After Effects. Same size, frame rate and length as your video: put it on the track above your footage.'),
      opt('ae', 'After Effects, editable layers', 'A script that builds the captions in After Effects as live text and shape layers with every animation as keyframes, plus the fonts it needs. Run it from File › Scripts › Run Script File.'),
      opt('soft', 'Video with a subtitle track', 'The original picture, untouched and not re-encoded. Viewers turn captions on or off; the style isn’t kept.', null, !canBurn),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Caption files'), files),
      status,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' } },
        h('p', { class: 'hint', style: { maxWidth: '32ch' } }, `Files are deleted from the server ${r.downloadGraceMin} min after you download.`), go))));
  dlg.showModal();
  dlg.querySelectorAll('input[name="export-kind"]').forEach((radio) => radio.addEventListener('change', () => {
    formats.hidden = dlg.querySelector('input[name="export-kind"]:checked').value !== 'formats';
    go.querySelector('span').textContent = formats.hidden ? 'Export video' : 'Export every format';
  }));

  async function start() {
    const kind = dlg.querySelector('input[name="export-kind"]:checked').value;
    running = true; cancelled = false;
    go.disabled = true;
    const bar = h('i');
    const msg = h('small', {}, 'Preparing captions…');
    const local = new AbortController();
    const cancel = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      cancelled = true;
      local.abort();
      if (state.project.job) await api(`/api/jobs/${state.project.job}/render/cancel`, { method: 'POST' }).catch(() => {});
    } }, 'Cancel');
    status.replaceChildren(h('div', { class: 'result' },
      h('div', { class: 'result-row' }, h('b', {}, { burn: 'Rendering your video', formats: 'Making every format', overlay: 'Drawing the captions', ae: 'Preparing the After Effects script', soft: 'Adding the subtitle track' }[kind]), cancel),
      h('div', { class: 'progress' }, bar), msg));
    try {
      const [W, H] = dims();
      await ensureFonts(fontsFor(state.captions, state.style));
      const showProgress = (p, elapsed) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        const eta = elapsed > 1 && p > 0.03 ? Math.max(1, Math.round(elapsed / p - elapsed)) : null;
        msg.textContent = `${Math.round(p * 100)}%${eta ? ` · about ${eta < 60 ? `${eta}s` : `${Math.round(eta / 60)} min`} left` : ''}`;
      };
      if (kind === 'formats') {
        const results = await exportFormats({
          quality, signal: local.signal,
          onProgress: (i, n, label, p) => {
            bar.style.width = `${Math.round(((i + p) / n) * 100)}%`;
            msg.textContent = `${label} (${i + 1} of ${n}) · ${Math.round(p * 100)}%`;
          },
        });
        showFormats(results);
        return;
      }
      if (kind === 'ae') {
        const r = await exportAE();
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(r.blob);
        showDone({ ...r, href: blobUrl, ae: true, elapsed: 0 });
        return;
      }
      if (kind === 'overlay') {
        try {
          const r = await exportOverlay({
            name: state.project.name || 'video.mp4', info, captions: state.captions, style: state.style, spaced: spaced(),
            watermark: state.watermark, signal: local.signal, onProgress: showProgress,
          });
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          blobUrl = URL.createObjectURL(r.blob);
          showDone({ ...r, href: blobUrl, overlay: true });
        } catch (e) {
          if (cancelled) { msg.textContent = 'Export cancelled.'; return; }
          throw e;
        }
        return;
      }
      if (kind === 'burn' && inBrowser) {
        try {
          const r = await exportInBrowser({
            file: state.project.file, name: state.project.name || 'video.mp4', info, captions: state.captions,
            style: state.style, spaced: spaced(), watermark: state.watermark, quality, signal: local.signal,
            onProgress: showProgress,
          });
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          blobUrl = URL.createObjectURL(r.blob);
          showDone({ ...r, href: blobUrl });
          return;
        } catch (e) {
          if (cancelled) { msg.textContent = 'Export cancelled.'; return; }
          if (!serverCanBurn) throw e;
          // the server can still do it, just more slowly
          console.warn('Browser export unavailable, using the server:', e);
          msg.textContent = e instanceof Unsupported ? 'This video needs the server, which is slower. Starting…' : 'Switching to the server, which is slower. Starting…';
          bar.style.width = '0%';
        }
      }
      const body = kind === 'burn'
        ? { mode: 'burn', quality, watermark: state.watermark.on ? state.watermark : null, ass_gz: await gzipBase64(toASS(state.captions, state.style, W, H, { spaced: spaced() })) }
        : { mode: 'soft', srt: toSRT(state.captions, state.style, W, H, spaced()), language: state.transcript?.language || 'und' };
      msg.textContent = 'Preparing…';
      await ensureJob();
      if (cancelled) { msg.textContent = 'Export cancelled.'; return; }
      await api(`/api/jobs/${state.project.job}/render`, { method: 'POST', body });
      for (;;) {
        await sleep(700);
        const j = await api(`/api/jobs/${state.project.job}`);
        const rr = j.render;
        bar.style.width = `${Math.round(rr.progress * 100)}%`;
        if (rr.status === 'cancelled' || cancelled) { msg.textContent = 'Export cancelled.'; break; }
        if (rr.status === 'error') throw new Error(rr.error || 'Export failed.');
        if (rr.status === 'queued') msg.textContent = rr.ahead > 0 ? `${rr.ahead} export${rr.ahead > 1 ? 's' : ''} ahead of yours` : 'Starting…';
        if (rr.status === 'running') {
          const eta = rr.elapsed && rr.progress > 0.05 ? Math.max(1, Math.round(rr.elapsed / rr.progress - rr.elapsed)) : null;
          msg.textContent = `${Math.round(rr.progress * 100)}%${eta ? ` · about ${eta < 60 ? `${eta}s` : `${Math.round(eta / 60)} min`} left` : ''}`;
        }
        if (rr.status === 'done') { showDone(rr); break; }
      }
    } catch (e) {
      status.replaceChildren(h('p', { class: 'note' }, `Export failed: ${e.message}`));
      toast(`Export failed: ${e.message}`, 'error', 8000);
    } finally {
      running = false;
      go.disabled = false;
    }
  }

  function showFormats(results) {
    blobs.forEach((u) => URL.revokeObjectURL(u));
    blobs = results.map((x) => URL.createObjectURL(x.blob));
    status.replaceChildren(h('div', { class: 'result ok' },
      h('div', { class: 'result-row' }, h('b', {}, `${results.length} ${results.length === 1 ? 'version is' : 'versions are'} ready`)),
      h('div', { class: 'fmt-results' }, results.map((x, i) => h('div', { class: 'result-row' },
        h('div', {}, h('b', {}, x.label), h('br'), h('small', {}, `${x.file} · ${x.W}×${x.H} · ${fmtSize(x.size)}${x.after ? ` · ${x.after} caption${x.after > 1 ? 's' : ''} outside the safe zone` : ''}`)),
        h('a', { class: 'btn brand sm', href: blobs[i], download: x.file, html: '<span>Download</span>',
          onclick: () => { state.project.exported = true; emit('project'); } }))))));
    if (!dlg.open) toast('Every format is ready. Open Export to download them.', 'ok', 8000);
  }

  function showDone(rr) {
    const a = h('a', { class: 'btn brand', href: rr.href || `/api/jobs/${state.project.job}/download`, download: rr.file,
      html: '<span>Download</span>',
      onclick: () => {
        state.project.exported = true;
        emit('project');
        // made in the browser: tell the server, which then deletes the upload soon
        if (rr.href && state.project.job) api(`/api/jobs/${state.project.job}/downloaded`, { method: 'POST' }).catch(() => {});
      } });
    status.replaceChildren(h('div', { class: 'result ok' },
      h('div', { class: 'result-row' }, h('div', {}, h('b', {}, rr.ae ? 'Your After Effects script is ready' : rr.overlay ? 'Your captions are ready' : 'Your video is ready'), h('br'),
        h('small', {}, rr.ae ? `${rr.file} · ${rr.layers} layers, ${rr.fonts} font${rr.fonts === 1 ? '' : 's'}` : `${rr.file}${rr.size ? ` · ${fmtSize(rr.size)}` : ''} · took ${Math.round(rr.elapsed)}s`)), a),
      rr.ae ? h('p', { class: 'hint' }, 'Unzip it, install the fonts in its “fonts” folder, then in After Effects choose File › Scripts › Run Script File and pick the .jsx. Place the new composition over your footage at 0:00.') : null,
      rr.overlay ? h('p', { class: 'hint' }, 'In Premiere Pro or After Effects, put it on the track above your video, starting at the same frame. It’s QuickTime Animation with transparency, so it opens directly.') : null));
    if (!dlg.open) toast('Your video is ready. Open Export to download it.', 'ok', 8000);
  }
}

// In the Premiere Pro panel: draw the captions over the clip's span and place them
// on the timeline, optionally with an editable caption track.
function openTimelineExport() {
  dlg = $('#export-dialog');
  const { sequence: sq, clip } = state.premiere;
  const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const editable = h('input', { type: 'checkbox', role: 'switch', checked: true });
  const files = h('div', { class: 'files' }, [['srt', 'SRT'], ['vtt', 'WebVTT'], ['ass', 'ASS (styled)'], ['txt', 'Transcript']]
    .map(([k, t]) => h('button', { class: 'btn sm', type: 'button', html: `<span>${t}</span>`, onclick: () => captionFile(k) })));
  const status = h('div', { id: 'export-status' });
  const go = h('button', { class: 'btn brand lg', type: 'button', html: '<span>Add to timeline</span>', onclick: () => start() });
  dlg.replaceChildren(h('div', { class: 'modal' },
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, 'Add to timeline'), h('p', {}, `Over “${clip.name}”, on the first empty video track above it.`)),
      h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => dlg.close() })),
    h('div', { class: 'modal-body' },
      h('div', { class: 'specs' },
        h('span', {}, sq.name), h('span', {}, `${sq.width}×${sq.height}`), h('span', {}, `${+sq.fps.toFixed(3)} fps`),
        h('span', {}, `${fmt(clip.start)} – ${fmt(clip.end)}`)),
      h('p', { class: 'note info' }, 'The captions (and the watermark, if it’s on) are drawn on a transparent layer at the sequence’s size and frame rate, saved in a Capstudio folder next to your project, and placed in a Capstudio bin.'),
      h('label', { class: 'switch' }, h('span', {}, 'Also add an editable caption track (plain text, for corrections in Premiere)'), editable),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Caption files'), files),
      status,
      h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, go))));
  dlg.showModal();

  async function start() {
    running = true; cancelled = false;
    go.disabled = true;
    const bar = h('i');
    const msg = h('small', {}, 'Drawing the captions…');
    const local = new AbortController();
    const cancel = h('button', { class: 'btn sm', type: 'button', onclick: () => { cancelled = true; local.abort(); } }, 'Cancel');
    status.replaceChildren(h('div', { class: 'result' }, h('div', { class: 'result-row' }, h('b', {}, 'Adding to the timeline'), cancel),
      h('div', { class: 'progress' }, bar), msg));
    try {
      await ensureFonts(fontsFor(state.captions, state.style));
      const r = await addToTimeline({
        editable: editable.checked, signal: local.signal,
        onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; msg.textContent = `Drawing the captions… ${Math.round(p * 100)}%`; },
      });
      state.project.exported = true;
      emit('project');
      status.replaceChildren(h('div', { class: 'result ok' }, h('div', { class: 'result-row' },
        h('div', {}, h('b', {}, `Added on track V${r.track}`), h('br'),
          h('small', {}, `${r.captions ? 'With an editable caption track. ' : ''}Saved as ${r.file}`)))));
      toast(`Captions added to the timeline on V${r.track}.`, 'ok', 5000);
    } catch (e) {
      if (cancelled) { msg.textContent = 'Cancelled.'; return; }
      status.replaceChildren(h('p', { class: 'note' }, e.message));
      toast(e.message, 'error', 9000);
    } finally {
      running = false;
      go.disabled = false;
    }
  }
}

export const exportRunning = () => running;

// The styled caption script can be large for long videos; it compresses ~10×.
async function gzipBase64(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
