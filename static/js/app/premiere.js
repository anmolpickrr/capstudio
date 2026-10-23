// Inside the Premiere Pro panel (premiere/ in the repository), the app runs in a
// frame and talks to the panel by messages: it asks for the clip selected in the
// timeline, and sends back the finished captions to place above it.
import { toSRT } from '../engine/index.js';
import { exportOverlay } from './overlayexport.js';
import { state } from './store.js';

export const inPremiere = new URLSearchParams(location.search).get('host') === 'premiere' && window.parent !== window;

let seq = 0;
const pending = new Map();
window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const m = e.data;
  if (m?.type !== 'capstudio:reply' || !pending.has(m.id)) return;
  const { resolve, reject } = pending.get(m.id);
  pending.delete(m.id);
  if (m.ok) resolve(m.data); else reject(new Error(m.error || 'Premiere didn’t answer.'));
});

function ask(type, payload = {}, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ type, id, ...payload }, '*', transfer);
  });
}

// The selected clip: { file, sequence, clip, project }. Captions are made for the
// part of the clip used in the timeline, and drawn at the sequence's size.
export async function selectedClip() {
  const d = await ask('capstudio:getClip');
  const file = new File([d.bytes], d.fileName, { type: d.fileType });
  return { file, sequence: d.sequence, clip: d.clip, project: d.project };
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

// Draw the captions (and the watermark, if on) over the clip's span at the
// sequence's size and frame rate, and have the panel place them on the timeline.
export async function addToTimeline({ editable, onProgress, signal }) {
  const p = state.premiere, s = p.sequence, c = p.clip;
  const spaced = state.transcript?.spaced ?? true;
  const stem = (c.name || 'clip').replace(/\.[^.]*$/, '');
  const out = await exportOverlay({
    name: c.name, file: `${stem} captions.mov`,
    info: { width: s.width, height: s.height, fps: s.fps, duration: c.end - c.start },
    captions: state.captions, style: state.style, spaced, watermark: state.watermark,
    from: c.inPoint, speed: c.speed, onProgress, signal,
  });
  const srt = editable ? toSRT(timelineCaptions(p), state.style, s.width, s.height, spaced) : '';
  const mov = await out.blob.arrayBuffer();
  const placed = await ask('capstudio:place', {
    mov, movName: out.file, srt, start: c.start, end: c.end, above: c.track, project: p.project,
  }, [mov]);
  return { ...out, ...placed };
}
