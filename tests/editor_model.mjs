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
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
