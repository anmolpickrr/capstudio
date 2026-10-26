// The editor's edits (static/js/editor/model.js): placement, moving, trimming,
// splitting, ripple delete, speed, keyframes, transitions and audio gain.
//   node tests/editor_model.mjs
import {
  addClip, closeGap, duplicateClip, end, gainAt, keyAt, makeClip, moveClip, newProject, removeClips, setSpeed, setValue,
  splitClip, toggleKey, transitionLook, transitionsFor, trimEnd, trimStart, valueAt,
} from '../static/js/editor/model.js';

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` (${extra})` : ''}`); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

function project() {
  const p = newProject({ preset: '9x16' });
  p.assets.a = { id: 'a', kind: 'video', duration: 10, fps: 30, width: 1080, height: 1920, hasAudio: true };
  p.assets.m = { id: 'm', kind: 'audio', duration: 30, hasAudio: true };
  return p;
}
const v1 = (p) => p.tracks.filter((t) => t.type === 'video').at(-1).id;

{
  const p = project();
  const a = addClip(p, makeClip('video', { asset: 'a', dur: 10 }), { track: v1(p), at: 0 });
  const b = addClip(p, makeClip('video', { asset: 'a', dur: 4 }), { track: v1(p), at: 2 });
  check('a clip that would overlap goes on another track', a.track === v1(p) && b.track !== v1(p));
  check('moving stops at the neighbour', moveClip(p, b.id, 3, v1(p)) === false || end(b) <= a.start + 1e-9 || b.start >= end(a) - 1e-9);
  const q = project();
  const x = addClip(q, makeClip('video', { asset: 'a', dur: 10 }), { track: v1(q), at: 0 });
  const c = addClip(q, makeClip('video', { asset: 'a', dur: 4 }), { track: v1(q), at: 12 });
  moveClip(q, c.id, 8, v1(q));
  check('a clip dragged onto its neighbour stops against it', near(c.start, end(x)), String(c.start));
}
{
  const p = project();
  const a = addClip(p, makeClip('video', { asset: 'a', dur: 6, in: 2 }), { track: v1(p), at: 5 });
  trimStart(p, a.id, 2);
  check('trimming the start reaches back into the source only as far as it goes', near(a.start, 3) && near(a.in, 0) && near(a.dur, 8), `${a.start} ${a.in} ${a.dur}`);
  trimEnd(p, a.id, 100);
  check('trimming the end stops at the end of the source', near(end(a), 3 + 10), String(end(a)));
  trimStart(p, a.id, 6);
  check('trimming the start forward moves the in point', near(a.start, 6) && near(a.in, 3) && near(a.dur, 7));
}
{
  const p = project();
  const a = addClip(p, makeClip('video', { asset: 'a', dur: 10 }), { track: v1(p), at: 0 });
  a.keys.x = [{ t: 0, v: 0, ease: 'linear' }, { t: 10, v: 100, ease: 'linear' }];
  a.transIn = { type: 'fade', dur: 1 }; a.transOut = { type: 'fade', dur: 1 };
  const b = splitClip(p, a.id, 4);
  check('split makes two clips with continuous source', near(a.dur, 4) && near(b.start, 4) && near(b.in, 4) && near(b.dur, 6));
  check('split keeps the motion at the cut on both sides', near(valueAt(a, 'x', 4), 40) && near(valueAt(b, 'x', 0), 40) && near(valueAt(b, 'x', 6), 100));
  check('the entrance stays on the left part and the exit on the right', a.transIn && !a.transOut && !b.transIn && b.transOut);
  check('no split at the very edge', splitClip(p, a.id, 0.001) === null);
}
{
  const p = project();
  const t = v1(p);
  const a = addClip(p, makeClip('video', { asset: 'a', dur: 3 }), { track: t, at: 0 });
  const b = addClip(p, makeClip('video', { asset: 'a', dur: 3 }), { track: t, at: 3 });
  const c = addClip(p, makeClip('video', { asset: 'a', dur: 3 }), { track: t, at: 6 });
  removeClips(p, [b.id], true);
  check('ripple delete closes the gap', near(c.start, 3) && p.clips.length === 2);
  removeClips(p, [a.id], false);
  check('a plain delete leaves the gap', near(c.start, 3));
  check('double-clicking the gap closes it', near(closeGap(p, t, 1), 3) && near(c.start, 0));
  const d = duplicateClip(p, c.id);
  check('duplicate goes right after the clip', near(d.start, end(c)) && d.track === t);
}
{
  const p = project();
  const a = addClip(p, makeClip('video', { asset: 'a', dur: 8 }), { track: v1(p), at: 0 });
  a.keys.opacity = [{ t: 4, v: 0.5, ease: 'linear' }];
  setSpeed(p, a.id, 2);
  check('2× speed halves the clip and its keyframe times', near(a.dur, 4) && near(a.keys.opacity[0].t, 2));
  setSpeed(p, a.id, 0.5);
  check('slowing down can lengthen it, up to its source', near(a.dur, 16), String(a.dur));
}
{
  const c = makeClip('text', { dur: 4 });
  check('a property without keyframes is its value', valueAt(c, 'scale', 2) === 1);
  setValue(c, 'scale', 1.5, 2);
  check('setting it changes the value', c.props.scale === 1.5 && !c.keys.scale);
  toggleKey(c, 'scale', 0);
  setValue(c, 'scale', 2, 4);
  check('with a keyframe, setting elsewhere adds another', c.keys.scale.length === 2 && near(valueAt(c, 'scale', 2), 1.75));
  c.keys.scale[1].ease = 'hold';
  check('hold easing jumps at the keyframe', near(valueAt(c, 'scale', 3.99), 1.5) && near(valueAt(c, 'scale', 4), 2));
  check('a keyframe is found at its time', !!keyAt(c, 'scale', 4));
  toggleKey(c, 'scale', 4); toggleKey(c, 'scale', 0);
  check('removing the last keyframe keeps its value', !c.keys.scale && c.props.scale === 1.5);
}
{
  const p = project();
  const t = v1(p);
  const a = addClip(p, makeClip('video', { asset: 'a', dur: 5 }), { track: t, at: 0 });
  const b = addClip(p, makeClip('video', { asset: 'a', dur: 5 }), { track: t, at: 5 });
  b.transIn = { type: 'dissolve', dur: 1 };
  const wa = transitionsFor(p, a), wb = transitionsFor(p, b);
  check('a cross transition is centred on the cut', near(wa.to, 5.5) && near(wb.from, 4.5) && wb.in.cross && wa.out.cross);
  const lone = addClip(p, makeClip('text', { dur: 3 }), { at: 20 });
  lone.transIn = { type: 'slide-left', dur: 0.5 };
  const wl = transitionsFor(p, lone);
  check('without a clip before it, it’s an entrance', !wl.in.cross && near(wl.in.a, 20) && near(wl.in.b, 20.5) && near(wl.from, 20));
  const mid = transitionLook('dissolve', 0.5, 'in', 1080, 1920);
  const push = transitionLook('push-left', 0.5, 'out', 1080, 1920);
  check('dissolve halfway, push moves the old picture out', near(mid.alpha, 0.5) && near(push.dx, -540));
  const wipe = transitionLook('wipe-right', 0.25, 'in', 1000, 1000);
  check('a wipe reveals from the edge', wipe.clip && wipe.clip.x === 0 && wipe.clip.w > 0 && wipe.clip.w < 500);
}
{
  const p = project();
  const m = addClip(p, makeClip('audio', { asset: 'm', dur: 10, audio: { fadeIn: 2, fadeOut: 4, mute: false } }), { at: 0 });
  check('fade in', near(gainAt(p, m, 1), 0.5));
  check('full volume between fades', near(gainAt(p, m, 4), 1));
  check('fade out', near(gainAt(p, m, 9), 0.25));
  m.keys.volume = [{ t: 4, v: 1, ease: 'linear' }, { t: 5, v: 0.5, ease: 'linear' }];
  check('keyframed volume', near(gainAt(p, m, 5.5), 0.5));
  p.tracks.find((t) => t.id === m.track).muted = true;
  check('a muted track is silent', gainAt(p, m, 4) === 0);
  const v = addClip(p, makeClip('video', { asset: 'a', dur: 5, audio: { detached: true } }), { track: v1(p), at: 0 });
  check('a video whose sound was separated is silent itself', gainAt(p, v, 2) === 0);
}
// ---------------------------------------------------------------- trending transitions, animations, beats, automation
{
  const { transitionLook: look, animMotion } = await import('../static/js/editor/model.js');
  const flash = look('flash', 0.5, 'in', 1080, 1920), early = look('flash', 0.2, 'out', 1080, 1920);
  check('flash: white at the cut, the old picture until then', flash.color === '#FFFFFF' && flash.colorAlpha > 0.9 && early.alpha === 1);
  check('glitch: strongest at the cut', near(look('glitch', 0.5, 'in', 1080, 1920).glitch, 1) && look('glitch', 0.1, 'in', 1080, 1920).alpha === 0);
  check('iris opens from the centre', look('iris', 0, 'in', 1000, 1000).circle.r === 0 && look('iris', 1, 'in', 1000, 1000).circle.r > 700);
  const whip = look('whip-left', 0.5, 'out', 1000, 1000);
  check('whip: motion blur at its peak', whip.blur > 40 && whip.dx < 0);
  const c = makeClip('image', { dur: 10, anim: { in: 'slide-up', inDur: 1, out: 'fade', outDur: 1, loop: 'kenburns', loopAmt: 50 } });
  const m0 = animMotion(c, 0, 1000, 2000), m5 = animMotion(c, 5, 1000, 2000), m95 = animMotion(c, 9.5, 1000, 2000);
  check('slide up starts below and arrives', m0.dy > 600 && near(m5.dy, 0));
  check('Ken Burns zooms slowly through the clip', m5.scale > 1.05 && m5.scale < 1.07);
  check('fade out at the end', m95.alpha < 0.95 && m95.alpha > 0);
}
{
  const { findBeats } = await import('../static/js/editor/beats.js');
  for (const [bpm, off] of [[120, 0.13], [96, 0.31], [150, 0.05]]) {
    const peaks = new Float32Array(2000);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < peaks.length; i++) peaks[i] = 0.05 + 0.04 * rnd();
    const period = 60 / bpm;
    for (let t = off; t < 20; t += period) { const k = Math.round(t * 100); for (let j = 0; j < 8; j++) peaks[k + j] = Math.max(peaks[k + j] || 0, 0.9 * Math.exp(-j / 3)); }
    for (let t = off + period / 2; t < 20; t += period) { const k = Math.round(t * 100); peaks[k] = Math.max(peaks[k], 0.3); }
    const r = findBeats(peaks);
    const worst = Math.max(...r.beats.map((b) => { const ph = ((b - off) / period) % 1; return Math.min(ph, 1 - ph) * period; }));
    check(`beat found at ${bpm} BPM (on the beat within 20 ms)`, Math.abs(r.bpm - bpm) <= 1 && worst < 0.02, `${r.bpm} BPM, ${Math.round(worst * 1000)} ms`);
  }
}
{
  const store = await import('../static/js/editor/store.js');
  const auto = await import('../static/js/editor/auto.js');
  const p = project();
  const t = v1(p);
  const a = addClip(p, makeClip('video', { asset: 'a', dur: 4 }), { track: t, at: 0 });
  const b = addClip(p, makeClip('video', { asset: 'a', dur: 4 }), { track: t, at: 4 });
  const c2 = addClip(p, makeClip('image', { dur: 4 }), { track: t, at: 8 });
  store.openProject(p);
  const n = auto.applyTransitionStyle('snappy', { ends: true });
  check('a transition style on every cut, alternating', n === 2 && b.transIn.type === 'push-left' && c2.transIn.type === 'push-right' && a.transIn?.type === 'dissolve' && c2.transOut);
  store.edit((x) => { x.beats = { bpm: 120, times: Array.from({ length: 40 }, (_, i) => 0.25 + i * 0.5) }; });
  auto.cutToBeat(2);
  const [x1, x2, x3] = store.ed.project.clips.filter((c) => c.track === t).sort((u, v) => u.start - v.start);
  check('cut to the beat: each clip ends on a beat, the next follows on', near(x1.dur, 0.75) && near(x2.start, 0.75) && near(end(x2), 1.75) && near(x3.start, 1.75), `${x1.dur} ${x2.start} ${end(x2)}`);
  store.undo(); store.undo();
  check('undo puts it back', near(store.ed.project.clips.find((c) => c.id === b.id).start, 4));
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
