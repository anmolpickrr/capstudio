// One-click edits across the whole project: a transition style on every cut, the
// beat of the music (markers, snapping, and cutting the main track to it), and
// motion for every photo and title.
import { toast } from '../app/ui.js';
import { clipBeats } from './beats.js';
import { clipsOn, end, maxDur, prevAdjacent, TRANSITION_STYLES } from './model.js';
import { ed, edit } from './store.js';

const VISUALS = new Set(['video', 'image', 'text', 'shape']);
const mainTrack = (p) => [...p.tracks].reverse().find((t) => t.type === 'video');

// Every cut between two clips on a video track gets the style's transition. Returns how many.
export function applyTransitionStyle(id, { ends = false } = {}) {
  const style = TRANSITION_STYLES[id];
  let n = 0;
  edit((p) => {
    for (const tr of p.tracks.filter((t) => t.type === 'video')) {
      const cs = clipsOn(p, tr.id).filter((c) => VISUALS.has(c.type));
      cs.forEach((c, i) => {
        if (prevAdjacent(p, c)) { c.transIn = { type: style.types[n % style.types.length], dur: style.dur }; n++; }
        else if (ends && i === 0 && tr === mainTrack(p)) c.transIn = { type: 'dissolve', dur: 0.6 };
        if (ends && i === cs.length - 1 && tr === mainTrack(p)) c.transOut = { type: 'dissolve', dur: 0.8 };
      });
    }
  });
  return n;
}

export function removeTransitions() {
  edit((p) => { for (const c of p.clips) { c.transIn = null; c.transOut = null; } });
}

// The beat of a music clip (the selected one, else the longest), kept on the project.
export async function detectBeats(clipId = null) {
  const p = ed.project;
  const music = (clipId && p.clips.find((c) => c.id === clipId && c.type === 'audio'))
    || [...p.clips].filter((c) => c.type === 'audio').sort((a, b) => b.dur - a.dur)[0];
  if (!music) throw new Error('Add a music clip first.');
  const r = await clipBeats(p, music);
  if (r.beats.length < 2) throw new Error('No steady beat found in this music.');
  edit((x) => { x.beats = { bpm: r.bpm, times: r.beats, clip: music.id }; });
  return r;
}

export function clearBeats() { edit((p) => { delete p.beats; }); }

// Cut the main track to the beat: one after another, each clip is made to last
// `every` beats (fewer when its source runs out), and later clips follow on.
export function cutToBeat(every = 2) {
  const p = ed.project;
  const beats = p.beats?.times;
  if (!beats?.length) throw new Error('Find the beat first.');
  const tr = mainTrack(p);
  const cs = clipsOn(p, tr.id).filter((c) => VISUALS.has(c.type));
  if (!cs.length) throw new Error('Put some clips on the main track (V1) first.');
  let changed = 0;
  edit((x) => {
    let cursor = cs[0].start;
    for (const src of cs) {
      const c = x.clips.find((o) => o.id === src.id);
      c.start = cursor;
      const room = maxDur(x, c);
      // the beat `every` beats after the first one past the cut
      const first = beats.findIndex((b) => b > cursor + 0.15);
      let endAt = null;
      if (first >= 0) {
        for (let j = Math.min(beats.length - 1, first + every - 1); j >= first; j--) {
          if (beats[j] - cursor <= room + 1e-6) { endAt = beats[j]; break; }
        }
      }
      if (endAt !== null) { c.dur = Math.round((endAt - cursor) * 1e6) / 1e6; changed++; }
      cursor = end(c);
    }
  });
  return changed;
}

export function kenBurnsPhotos() {
  let n = 0;
  edit((p) => p.clips.filter((c) => c.type === 'image').forEach((c, i) => {
    c.anim = { ...(c.anim || {}), loop: i % 2 ? 'kenburns-out' : 'kenburns', loopAmt: 60 };
    n++;
  }));
  return n;
}

export function animateTitles(inType = 'pop', outType = 'fade') {
  let n = 0;
  edit((p) => p.clips.filter((c) => c.type === 'text').forEach((c) => { c.text = { ...c.text, animIn: inType, animOut: outType }; n++; }));
  return n;
}

// Set an animation on the selected clips.
export function animateSelection(patch) {
  const ids = ed.selection;
  const sel = ed.project.clips.filter((c) => ids.includes(c.id) && (VISUALS.has(c.type) || c.type === 'adjust'));
  if (!sel.length) { toast('Select a clip on the timeline first.'); return 0; }
  edit((p) => { for (const s of sel) { const c = p.clips.find((o) => o.id === s.id); c.anim = { inDur: 0.5, outDur: 0.4, loopAmt: 50, ...(c.anim || {}), ...patch }; } });
  return sel.length;
}
