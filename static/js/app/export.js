// Export: burn captions into the video at the original quality, add a subtitle
// track without re-encoding, or download caption files. Burning runs in the
// browser when it can (fast, on the computer's video hardware) and on the
// server otherwise.
import { toASS, toSRT, toTXT, toVTT } from '../engine/index.js';
import { ensureFonts } from '../engine/fonts.js';
import { fontsFor } from '../engine/layout.js';
import { api, sleep } from './api.js';
import { chosenName, ensureJob, extOf, renameProject, stemOf } from './session.js';
import { browserCanExport, exportInBrowser, Unsupported } from './browserexport.js';
import { exportOverlay } from './overlayexport.js';
import { exportAE } from './aeexport.js';
import { exportFormats, formatsSection } from './formats.js';
import { addAsLayers, addToTimeline, fontsZip, inAE, inPremiere } from './premiere.js';
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

// The name every exported file takes (the video's name; renaming it here renames
// the project too). `ext` shows what the main file will be called.
function nameField(ext = () => extOf(state.project?.name)) {
  const input = h('input', { id: 'export-name', class: 'ex-name-input', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'File name',
    value: stemOf(state.project?.name) });
  const suffix = h('span', { class: 'ex-name-ext' });
  const commit = () => { if (!renameProject(input.value)) input.value = stemOf(state.project?.name); paint(); };
  const paint = () => { suffix.textContent = ext(); };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } e.stopPropagation(); });
  paint();
  const el = h('label', { class: 'ex-name' }, h('span', { class: 'ex-name-label' }, 'File name'), h('span', { class: 'ex-name-box' }, input, suffix));
  el.paint = paint;
  return el;
}

async function captionFile(kind) {
  const [W, H] = dims();
  await ensureFonts(fontsFor(state.captions, state.style));
  const b = baseName();
  if (kind === 'srt') download(`${b}.srt`, toSRT(state.captions, state.style, W, H, spaced()), 'application/x-subrip');
  if (kind === 'vtt') download(`${b}.vtt`, toVTT(state.captions, state.style, W, H, spaced()), 'text/vtt');
  if (kind === 'ass') download(`${b}.ass`, toASS(state.captions, state.style, W, H, { spaced: spaced() }), 'text/x-ssa');
  if (kind === 'txt') download(`${b}.txt`, toTXT(state.captions, spaced()));
}

// Mark the label of the checked radio in a group (for its highlight; Adobe's panels
// can't select a label by its input).
function markChecked(root, name) {
  const paint = () => root.querySelectorAll(`input[name="${name}"]`).forEach((i) => i.closest('label')?.classList.toggle('on', i.checked));
  root.addEventListener('change', paint);
  paint();
}

export function openExport() {
  if (inAE && state.premiere) return openCompExport();
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
  // quality: three choices with what each is for
  const qSeg = h('div', { class: 'ex-quality', role: 'radiogroup', 'aria-label': 'Quality' },
    [['max', 'Maximum', 'For further editing'], ['high', 'High', 'Looks like the original'], ['fast', 'Fast', 'Quickest']].map(([v, t, sub]) =>
      h('button', { type: 'button', role: 'radio', 'data-v': v, 'aria-checked': String(v === quality), 'aria-pressed': String(v === quality),
        onclick: (e) => { quality = v; qSeg.querySelectorAll('button').forEach((b) => { const on = b === e.currentTarget; b.setAttribute('aria-checked', String(on)); b.setAttribute('aria-pressed', String(on)); }); } },
      h('b', {}, t), h('small', {}, sub))));
  const qualityField = h('div', { class: 'ex-field' }, h('span', { class: 'ex-label' }, 'Quality'), qSeg);

  // what can be exported: a list on the left, the chosen one's settings on the right
  const TYPES = [
    { v: 'burn', icon: 'film', title: 'Video with captions', sub: `MP4 · ${outCodec}`, disabled: !canBurn, go: 'Export video' },
    { v: 'formats', icon: 'templates', title: 'Every format', sub: '9:16 · 4:5 · 1:1 · 16:9', go: 'Export formats' },
    { v: 'overlay', icon: 'captions', title: 'Transparent captions', sub: 'For Premiere Pro, After Effects', go: 'Export captions' },
    { v: 'ae', icon: 'effects', title: 'After Effects layers', sub: 'Editable text, keyframed', go: 'Download script' },
    { v: 'soft', icon: 'text', title: 'Subtitle track', sub: 'Original picture, not re-encoded', go: 'Export video' },
    { v: 'files', icon: 'copy', title: 'Caption files', sub: 'SRT · VTT · ASS · TXT', go: null },
  ];
  const first = canBurn ? 'burn' : 'soft';
  const rail = h('div', { class: 'ex-types', role: 'radiogroup', 'aria-label': 'What to export' }, TYPES.map((t) => h('label', { class: `ex-type${t.disabled ? ' disabled' : ''}` },
    h('input', { type: 'radio', name: 'export-kind', value: t.v, checked: t.v === first ? true : null, disabled: t.disabled ? true : null }),
    h('span', { class: 'ex-type-icon', html: icon(t.icon) }),
    h('span', { class: 'ex-type-text' }, h('b', {}, t.title), h('small', {}, t.sub)))));

  const files = h('div', { class: 'ex-files' }, [['srt', 'SRT', 'Subtitles for most players and sites'], ['vtt', 'WebVTT', 'Subtitles for the web'],
    ['ass', 'ASS', 'Styled subtitles (fonts, colours, motion)'], ['txt', 'Transcript', 'Plain text, no times']]
    .map(([k, t, sub]) => h('button', { class: 'ex-file', type: 'button', onclick: () => captionFile(k) },
      h('span', { html: icon('download') }), h('b', {}, t), h('small', {}, sub))));
  const status = h('div', { id: 'export-status' });
  const go = h('button', { class: 'btn brand lg', type: 'button', html: '<span>Export video</span>', onclick: () => start() });
  const r = state.config.retention;
  const formats = formatsSection();
  const where = inBrowser ? 'Made on this computer: no upload, no waiting for the server. Keep this tab open while it runs.'
    : cfg.lowPower && canBurn ? 'Made on the server, about 3–6 minutes for a 30-second reel. Chrome or Edge make it much faster, on this computer.' : null;
  // the main file's ending for each kind of export
  const EXT = { burn: () => (info.vcodec === 'prores' ? extOf(state.project.name) : '.mp4'), soft: () => (extOf(state.project.name) === '.mkv' ? '.mkv' : extOf(state.project.name) === '.mov' ? '.mov' : '.mp4'),
    formats: () => ' 9x16.mp4 …', overlay: () => ' captions.mov', ae: () => ' After Effects captions.zip', files: () => '.srt · .vtt · .ass · .txt' };
  const fileName = nameField(() => (EXT[dlg?.querySelector('input[name="export-kind"]:checked')?.value] || EXT.burn)());
  const pane = (title, text, ...kids) => h('div', { class: 'ex-pane-body' }, h('div', { class: 'ex-pane-head' }, h('h3', {}, title), h('p', {}, text)), ...kids);
  const list = (items) => h('ul', { class: 'ex-points' }, items.map((t) => h('li', {}, t)));
  const panes = {
    burn: pane('Video with captions', `The captions drawn into the picture exactly as previewed, encoded as ${outCodec}.`,
      qualityField, where ? h('p', { class: 'ex-note' }, where) : null),
    formats: pane('Every format at once', 'One video per format, each reframed, with its captions checked against that format’s safe zone.', formats),
    overlay: pane('Transparent captions', 'Just the captions (and the watermark, if it’s on) on a see-through background.',
      list([`QuickTime Animation .mov with transparency, ${info.width}×${info.height}, same frame rate and length`, 'Put it on the track above your footage, starting at the same frame'])),
    ae: pane('After Effects layers', 'A script that builds the captions as live text and shape layers, every animation as keyframes, with the fonts it needs.',
      list(['Unzip, and install the fonts in its “fonts” folder', 'In After Effects: File › Scripts › Run Script File, and pick the .jsx'])),
    soft: pane('Video with a subtitle track', 'The original picture, untouched and not re-encoded. Viewers turn the captions on or off; their style isn’t kept.'),
    files: pane('Caption files', 'Download the captions on their own, timed to the video.', files),
  };
  if (!canBurn) panes.soft.prepend(h('p', { class: 'ex-note warn' }, `This server can draw captions into videos up to 1080p, and this one is ${info.width}×${info.height}.`));
  const paneWrap = h('div', { class: 'ex-pane' }, ...Object.values(panes), status);
  const specs = h('div', { class: 'ex-specs' },
    h('span', {}, `${info.width}×${info.height}`), h('span', {}, info.fps ? `${+info.fps.toFixed(3)} fps` : 'VFR'),
    h('span', {}, codecName(info.vcodec) + (info.pixFmt?.includes('10') ? ' 10-bit' : '')), h('span', {}, fmtDur(info.duration)));

  dlg.replaceChildren(h('div', { class: 'modal ex-modal' },
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, 'Export'), h('div', { class: 'ex-head-meta' }, h('p', {}, 'Same resolution, frame rate and audio as your original.'), specs)),
      h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => dlg.close() })),
    h('div', { class: 'ex-body' }, rail, paneWrap),
    h('div', { class: 'ex-foot' }, fileName, h('span', { class: 'ex-keep', title: `Files are deleted from the server ${r.downloadGraceMin} min after you download.` },
      `Deleted from the server ${r.downloadGraceMin} min after download`), go)));
  dlg.showModal();
  const paint = () => {
    const kind = dlg.querySelector('input[name="export-kind"]:checked').value;
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== kind;
    const t = TYPES.find((x) => x.v === kind);
    go.hidden = !t.go;
    const n = formats.querySelectorAll('.fmt-row:not(.off)').length;
    go.querySelector('span').textContent = kind === 'formats' ? `Export ${n} format${n === 1 ? '' : 's'}` : t.go || '';
    go.disabled = kind === 'formats' && !n;
    fileName.paint();
    // the quality setting belongs to both video kinds
    if (kind === 'formats') panes.formats.insertBefore(qualityField, formats);
    else if (kind === 'burn') panes.burn.insertBefore(qualityField, panes.burn.children[1]);
  };
  dlg.querySelectorAll('input[name="export-kind"]').forEach((radio) => radio.addEventListener('change', paint));
  markChecked(dlg, 'export-kind');
  formats.addEventListener('change', () => requestAnimationFrame(paint));
  paint();

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
    if (!rr.href) rr = { ...rr, file: chosenName(rr.file) };
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
      h('div', {}, h('h2', {}, 'Add to timeline'), h('p', {}, state.premiere.whole ? 'Over the whole sequence, on the first empty video track above every clip.' : `Over “${clip.name}”, on the first empty video track above it.`)),
      h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => dlg.close() })),
    h('div', { class: 'modal-body' },
      h('div', { class: 'specs' },
        h('span', {}, sq.name), h('span', {}, `${sq.width}×${sq.height}`), h('span', {}, `${+sq.fps.toFixed(3)} fps`),
        h('span', {}, `${fmt(clip.start)} – ${fmt(clip.end)}`)),
      nameField(() => ' captions.mov'),
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

// After Effects: the captions as editable layers in a precomp above the layer (the
// default), or as a transparent video like in Premiere.
function openCompExport() {
  dlg = $('#export-dialog');
  const { sequence: comp, clip } = state.premiere;
  const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const choice = (v, title, note, checked) => h('label', { class: 'choice' },
    h('input', { type: 'radio', name: 'ae-kind', value: v, checked: checked ? true : null }),
    h('span', {}, h('b', {}, title), h('small', {}, note)));
  const kinds = h('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'How to add the captions' },
    choice('layers', 'Editable layers', 'A precomp of text and shape layers with the animation keyframed. Change any word, colour or timing in After Effects.', true),
    choice('video', 'Transparent video', 'One layer, drawn exactly like the preview. Quickest; edit the captions here.', false));
  const status = h('div', { id: 'export-status' });
  const go = h('button', { class: 'btn brand lg', type: 'button', html: '<span>Add to composition</span>', onclick: () => start() });
  dlg.replaceChildren(h('div', { class: 'modal' },
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, 'Add to composition'), h('p', {}, state.premiere.whole ? 'At the top of the composition, over its full length.' : `Above “${clip.name}”, in sync with it.`)),
      h('button', { class: 'btn ghost icon-only', type: 'button', 'aria-label': 'Close', html: icon('close'), onclick: () => dlg.close() })),
    h('div', { class: 'modal-body' },
      h('div', { class: 'specs' },
        h('span', {}, comp.name), h('span', {}, `${comp.width}×${comp.height}`), h('span', {}, `${+comp.fps.toFixed(3)} fps`),
        h('span', {}, `${fmt(clip.start)} – ${fmt(clip.end)}`)),
      nameField(() => ' captions'),
      kinds,
      h('p', { class: 'note info' }, 'Files (the watermark, or the video) are saved in a Capstudio folder next to your project.'),
      status,
      h('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, go))));
  dlg.showModal();
  markChecked(dlg, 'ae-kind');

  async function start() {
    const kind = kinds.querySelector('input:checked').value;
    running = true; cancelled = false;
    go.disabled = true;
    const bar = h('i');
    const msg = h('small', {}, kind === 'layers' ? 'Building the layers…' : 'Drawing the captions…');
    const local = new AbortController();
    const cancel = h('button', { class: 'btn sm', type: 'button', onclick: () => { cancelled = true; local.abort(); } }, 'Cancel');
    status.replaceChildren(h('div', { class: 'result' }, h('div', { class: 'result-row' }, h('b', {}, 'Adding to the composition'),
      kind === 'video' ? cancel : ''), h('div', { class: 'progress' }, bar), msg));
    try {
      await ensureFonts(fontsFor(state.captions, state.style));
      if (kind === 'layers') {
        bar.style.width = '50%';
        const r = await addAsLayers();
        state.project.exported = true;
        emit('project');
        const rows = [h('div', {}, h('b', {}, `Added “${r.name}”: ${r.layers} layer${r.layers === 1 ? '' : 's'}`), h('br'),
          h('small', {}, 'Double-click the precomp to edit the captions.'))];
        const out = [h('div', { class: 'result-row' }, ...rows)];
        if (r.missing?.length) {
          const fonts = r.fonts.filter((f) => r.missing.includes(f.name));
          const get = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
            get.disabled = true;
            download('capstudio-fonts.zip', await fontsZip(fonts.length ? fonts : r.fonts), 'application/zip');
            get.disabled = false;
          } }, 'Download the fonts');
          out.push(h('p', { class: 'note' }, `Not installed on this computer: ${r.missing.join(', ')}. After Effects shows a stand-in until you install them and restart it.`), get);
        }
        status.replaceChildren(h('div', { class: 'result ok' }, ...out));
        toast('Captions added to the composition.', 'ok', 5000);
      } else {
        const r = await addToTimeline({
          editable: false, signal: local.signal,
          onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; msg.textContent = `Drawing the captions… ${Math.round(p * 100)}%`; },
        });
        state.project.exported = true;
        emit('project');
        status.replaceChildren(h('div', { class: 'result ok' }, h('div', { class: 'result-row' },
          h('div', {}, h('b', {}, state.premiere.whole ? 'Added at the top of the composition' : 'Added above the layer'), h('br'), h('small', {}, `Saved as ${r.file}`)))));
        toast('Captions added to the composition.', 'ok', 5000);
      }
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
