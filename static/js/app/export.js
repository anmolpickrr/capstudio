// Export: burn captions into the video at the original quality, add a subtitle
// track without re-encoding, or download caption files.
import { toASS, toSRT, toTXT, toVTT } from '../engine/index.js';
import { ensureFonts } from '../engine/fonts.js';
import { fontsFor } from '../engine/layout.js';
import { api, sleep } from './api.js';
import { icon } from './icons.js';
import { emit, state } from './store.js';
import { $, download, h, toast } from './ui.js';

let dlg = null, running = false, cancelled = false;

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
  dlg = $('#export-dialog');
  const info = state.project.info;
  const cfg = state.config;
  const outCodec = info.vcodec === 'prores' ? 'ProRes (same profile)' : info.vcodec === 'hevc' && !cfg.lowPower ? 'HEVC' : 'H.264';
  // A small server can't draw captions into videos above 1080p (not enough memory).
  const canBurn = !cfg.maxBurnPixels || info.width * info.height <= cfg.maxBurnPixels;
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

  dlg.replaceChildren(h('div', { class: 'modal' },
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, 'Export'), h('p', {}, 'Same resolution, frame rate, audio and file name as your original.')),
      h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => dlg.close() })),
    h('div', { class: 'modal-body' },
      h('div', { class: 'specs' },
        h('span', {}, `${info.width}×${info.height}`), h('span', {}, info.fps ? `${+info.fps.toFixed(3)} fps` : 'Variable frame rate'),
        h('span', {}, codecName(info.vcodec) + (info.pixFmt?.includes('10') ? ' 10-bit' : '')), h('span', {}, fmtDur(info.duration))),
      cfg.lowPower && canBurn ? h('p', { class: 'note info' }, 'Drawing the captions in takes a few minutes on this server, about 3 to 6 minutes for a 30-second reel. Keep this tab open while it runs.') : null,
      canBurn ? null : h('p', { class: 'note' }, `This server can draw captions into videos up to 1080p, and this one is ${info.width}×${info.height}. You can still add a subtitle track or download caption files.`),
      opt('burn', 'Video with captions', `Captions drawn into the picture exactly as previewed. Encoded as ${outCodec}.`,
        canBurn ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Quality'), qSeg,
          h('span', { class: 'hint' }, 'High is visually identical to the original. Maximum is for further editing; Fast is quickest.')) : null, canBurn, !canBurn),
      opt('soft', 'Video with a subtitle track', 'The original picture, untouched and not re-encoded. Viewers turn captions on or off; the style isn’t kept.', null, !canBurn),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Caption files'), files),
      status,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' } },
        h('p', { class: 'hint', style: { maxWidth: '32ch' } }, `Files are deleted from the server ${r.downloadGraceMin} min after you download.`), go))));
  dlg.showModal();

  async function start() {
    const kind = dlg.querySelector('input[name="export-kind"]:checked').value;
    running = true; cancelled = false;
    go.disabled = true;
    const bar = h('i');
    const msg = h('small', {}, 'Preparing captions…');
    const cancel = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      cancelled = true;
      await api(`/api/jobs/${state.project.job}/render/cancel`, { method: 'POST' }).catch(() => {});
    } }, 'Cancel');
    status.replaceChildren(h('div', { class: 'result' },
      h('div', { class: 'result-row' }, h('b', {}, kind === 'burn' ? 'Rendering your video' : 'Adding the subtitle track'), cancel),
      h('div', { class: 'progress' }, bar), msg));
    try {
      const [W, H] = dims();
      await ensureFonts(fontsFor(state.captions, state.style));
      const body = kind === 'burn'
        ? { mode: 'burn', quality, ass_gz: await gzipBase64(toASS(state.captions, state.style, W, H, { spaced: spaced() })) }
        : { mode: 'soft', srt: toSRT(state.captions, state.style, W, H, spaced()), language: state.transcript?.language || 'und' };
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

  function showDone(rr) {
    const a = h('a', { class: 'btn brand', href: `/api/jobs/${state.project.job}/download`, download: rr.file,
      html: '<span>Download</span>',
      onclick: () => { state.project.exported = true; emit('project'); } });
    status.replaceChildren(h('div', { class: 'result ok' },
      h('div', { class: 'result-row' }, h('div', {}, h('b', {}, 'Your video is ready'), h('br'), h('small', {}, `${rr.file}${rr.size ? ` · ${fmtSize(rr.size)}` : ''} · took ${Math.round(rr.elapsed)}s`)), a)));
    if (!dlg.open) toast('Your video is ready. Open Export to download it.', 'ok', 8000);
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
