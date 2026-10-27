// Inside the Premiere Pro or After Effects panel (panel/ in the repository), the app
// runs in a frame and talks to the panel by messages: it asks for the clip (Premiere)
// or footage layer (After Effects) that's selected, and sends back the finished
// captions to place above it.
import { toAE } from '../engine/ae.js';
import { toSRT } from '../engine/index.js';
import { watermarkFile, watermarkRect } from '../engine/watermark.js';
import { exportOverlay } from './overlayexport.js';
import { state } from './store.js';
import { zip } from './zip.js';

const param = new URLSearchParams(location.search).get('host');
export const hostApp = window.parent !== window && (param === 'premiere' || param === 'aftereffects') ? param : null;
export const inPanel = !!hostApp;
export const inAE = hostApp === 'aftereffects';
export const inPremiere = inPanel; // older name: "in a panel"

let seq = 0;
const pending = new Map();
window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (m?.type !== 'capstudio:reply' || !pending.has(m.id)) return;
  const { resolve, reject } = pending.get(m.id);
  pending.delete(m.id);
  if (m.ok) resolve(m.data); else reject(new Error(m.error || 'The panel didn’t answer.'));
});

function ask(type, payload = {}, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ type, id, ...payload }, '*', transfer);
  });
}

// The selection, in one shape for both apps: { file, sequence, clip, layer, project, app }.
// sequence: the frame captions are drawn for (the sequence or composition);
// clip: where it sits (start/end in that timeline), its in-point in the file and speed.
export async function selectedClip() {
  const d = await ask('capstudio:getClip');
  const file = new File([d.bytes], d.fileName, { type: d.fileType });
  if (d.app !== 'aftereffects') return { app: 'premiere', file, sequence: d.sequence, clip: d.clip, project: d.project };
  const c = d.comp, l = d.layer, speed = 100 / l.stretch;
  return {
    app: 'aftereffects', file, project: d.project, layer: l,
    sequence: { name: c.name, width: c.width, height: c.height, fps: c.fps },
    clip: { name: l.name, path: l.path, start: l.inPoint, end: l.outPoint, inPoint: (l.inPoint - l.startTime) * speed, speed, track: l.index },
  };
}

// The whole open sequence (Premiere) or composition (After Effects): every clip that
// plays, on any track, and the media files they use (each once):
// { app, project, sequence, duration, topTrack, skipped, clips: [{ file, kind, start, end, inPoint, speed, track }], files: [File] }
export async function wholeTimeline() {
  const d = await ask('capstudio:getTimeline');
  return { ...d, files: d.files.map((f) => new File([f.bytes], f.name, { type: f.type })) };
}

// The source time span of the clip in the timeline.
export function usedRange(p = state.premiere) {
  const c = p.clip;
  return { from: c.inPoint, to: c.inPoint + (c.end - c.start) * c.speed };
}

// Captions in timeline time, relative to the clip's start, for the SRT.
function timelineCaptions(p) {
  const { from, to } = usedRange(p), k = 1 / p.clip.speed;
  const map = (t) => Math.max(0, (Math.min(t, to) - from) * k);
  return state.captions.filter((c) => c.end > from && c.start < to)
    .map((c) => ({ ...c, start: map(c.start), end: map(c.end), words: c.words.map((w) => ({ ...w, start: map(w.start), end: map(w.end) })) }));
}

const spaced = () => state.transcript?.spaced ?? true;
const stemOf = (name) => (name || 'clip').replace(/\.[^.]*$/, '');

// Draw the captions (and the watermark, if on) over the clip's span at the
// sequence's or composition's size and frame rate, and have the panel place them.
export async function addToTimeline({ editable, onProgress, signal }) {
  const p = state.premiere, s = p.sequence, c = p.clip;
  const out = await exportOverlay({
    name: c.name, file: `${stemOf(c.name)} captions.mov`,
    info: { width: s.width, height: s.height, fps: s.fps, duration: c.end - c.start },
    captions: state.captions, style: state.style, spaced: spaced(), watermark: state.watermark,
    from: c.inPoint, speed: c.speed, onProgress, signal,
  });
  const srt = editable && p.app !== 'aftereffects' ? toSRT(timelineCaptions(p), state.style, s.width, s.height, spaced()) : '';
  const mov = await out.blob.arrayBuffer();
  const placed = await ask('capstudio:place', {
    mov, movName: out.file, srt, start: c.start, end: c.end, above: c.track, project: p.project,
    index: p.layer?.index, name: p.layer?.name,
  }, [mov]);
  return { ...out, ...placed };
}

// After Effects: the captions as editable text and shape layers in a precomp above
// the layer. The precomp runs in the footage's own time and takes the layer's start
// and stretch, so it stays in sync. Returns { layers, missing: [font names], fonts }.
export async function addAsLayers() {
  const p = state.premiere, s = p.sequence;
  const info = state.project.info;
  const data = toAE(state.captions, state.style, s.width, s.height, {
    fps: +s.fps.toFixed(3), duration: info.duration, name: `${stemOf(p.clip.name)} captions`, spaced: spaced(),
  });
  let watermark = null;
  const wm = state.watermark;
  if (wm?.on) {
    const r = watermarkRect(wm, s.width, s.height);
    const file = watermarkFile(wm, s.width, s.height);
    watermark = await (await fetch(`/watermarks/${file}`)).arrayBuffer();
    data.watermark = { file, x: r.x, y: r.y, w: r.w, h: r.h, opacity: wm.opacity / 100 };
  }
  const builder = await (await fetch('/ae/capstudio-ae.jsx')).text();
  const done = await ask('capstudio:aeBuild', { builder, data, watermark, project: p.project, index: p.layer.index, name: p.layer.name },
    watermark ? [watermark] : []);
  return { ...done, fonts: data.fonts };
}

// The fonts the captions use, zipped, for installing in After Effects.
export async function fontsZip(fonts) {
  const files = [];
  for (const f of fonts) {
    const res = await fetch(`/fonts/${encodeURIComponent(f.file)}`);
    if (res.ok) files.push({ name: f.file, data: new Uint8Array(await res.arrayBuffer()) });
  }
  return zip(files);
}
