// Editing actions used by the library, the timeline, the menus and the keyboard.
import { toast } from '../app/ui.js';
import {
  addClip, clipById, duplicateClip, end, freeTrack, isFree, LOOKS, makeClip, removeClips, splitClip, trackKind, uid,
} from './model.js';
import { ed, edit, select, selectedClips } from './store.js';

// A media file as a clip. Dropped on the timeline (`trackId` given) it goes where
// it was dropped; added with the + button, pictures go on the main track (V1) at
// the playhead or, if that's taken, after its last clip, and sound at the playhead.
export function addAsset(asset, at = null, trackId = null) {
  const type = asset.kind;
  const dur = type === 'image' ? 5 : asset.duration || 5;
  const c = makeClip(type, { name: asset.name, asset: asset.id, dur });
  // video fills the frame; pictures (logos, stills) fit inside it
  c.fit = type === 'video' ? 'cover' : 'contain';
  edit((p) => {
    const target = trackId && p.tracks.find((t) => t.id === trackId);
    if (target && target.type === trackKind(type) && isFree(p, target.id, at ?? ed.playhead, dur)) return addClip(p, c, { track: target.id, at: at ?? ed.playhead });
    if (trackId || type === 'audio') { const t = at ?? ed.playhead; return addClip(p, c, { track: freeTrack(p, type, t, dur, trackId).id, at: t }); }
    const main = [...p.tracks].reverse().find((t) => t.type === 'video' && !t.locked);
    const t = at ?? ed.playhead;
    if (main && isFree(p, main.id, t, dur)) return addClip(p, c, { track: main.id, at: t });
    const after = Math.max(0, ...p.clips.filter((x) => x.track === main?.id).map(end));
    return addClip(p, c, { track: main ? main.id : freeTrack(p, type, after, dur).id, at: after });
  });
  select([c.id]);
  return c;
}

export const TEXT_PRESETS = [
  { id: 'title', label: 'Title', sample: 'Big title', text: { content: 'BIG TITLE', font: 'Anton-Regular', size: 150, shadow: 0.45, animIn: 'pop', animOut: 'fade' } },
  { id: 'subtitle', label: 'Subtitle', sample: 'Subtitle', text: { content: 'A short subtitle', font: 'Poppins-Bold', size: 64, shadow: 0.5, animIn: 'rise', animOut: 'fade' } },
  { id: 'lower', label: 'Lower third', sample: 'Name · Role', props: { y: 0.28 },
    text: { content: 'Anmol Sharma\nFounder, Fastrr', font: 'Poppins-Bold', size: 54, align: 'left', bg: true, bgColor: '#6037D7', bgOpacity: 1, pad: 28, radius: 18, shadow: 0, animIn: 'wipe', animOut: 'fade' } },
  { id: 'tag', label: 'Tag', sample: 'NEW', text: { content: 'NEW DROP', font: 'Montserrat-ExtraBold', size: 58, color: '#111111', bg: true, bgColor: '#FFE14D', bgOpacity: 1, pad: 22, radius: 999, shadow: 0, animIn: 'pop', animOut: 'pop' } },
  { id: 'quote', label: 'Quote', sample: '“Quote”', text: { content: '“Make every\nsecond count.”', font: 'InstrumentSerif-Italic', size: 110, shadow: 0.4, animIn: 'fade', animOut: 'fade' } },
  { id: 'type', label: 'Typewriter', sample: 'Type…', text: { content: 'Typing this out…', font: 'SpaceGrotesk-Bold', size: 70, shadow: 0.4, animIn: 'typewriter', animOut: 'fade' } },
  { id: 'outline', label: 'Outlined', sample: 'Outline', text: { content: 'WAIT FOR IT', font: 'Bangers-Regular', size: 130, color: '#FFE14D', outline: 8, outlineColor: '#000000', shadow: 0, animIn: 'drop', animOut: 'pop' } },
  { id: 'caption', label: 'Caption box', sample: 'Caption', text: { content: 'Simple caption text', font: 'Inter-Bold', size: 56, bg: true, bgColor: '#000000', bgOpacity: 0.65, pad: 18, radius: 12, shadow: 0, animIn: 'fade', animOut: 'fade' } },
];

export function addText(preset = TEXT_PRESETS[0], at = ed.playhead, trackId = null) {
  const c = makeClip('text', { dur: 4 });
  c.text = { ...c.text, ...preset.text };
  c.name = c.text.content.split('\n')[0];
  if (preset.props?.y) c.props.y = preset.props.y * ed.project.H;
  if (preset.props?.y && c.text.align === 'left') c.props.x = -ed.project.W * 0.12;
  edit((p) => addClip(p, c, { track: topTrackFree(p, at, c.dur, trackId), at }));
  select([c.id]);
  return c;
}

export const SHAPES = [
  { id: 'rect', label: 'Rectangle', shape: { kind: 'rect', w: 640, h: 220, fill: '#6037D7', radius: 0 } },
  { id: 'round', label: 'Rounded', shape: { kind: 'rect', w: 640, h: 220, fill: '#FFFFFF', radius: 40 } },
  { id: 'circle', label: 'Circle', shape: { kind: 'ellipse', w: 360, h: 360, fill: '#FFE14D' } },
  { id: 'bar', label: 'Bar', shape: { kind: 'rect', w: 900, h: 16, fill: '#FFFFFF', radius: 8 } },
  { id: 'full', label: 'Colour fill', shape: { kind: 'full', fill: '#111111' } },
];

export function addShape(def = SHAPES[0], at = ed.playhead, trackId = null) {
  const c = makeClip('shape', { dur: 5, name: def.label });
  c.shape = { ...c.shape, ...def.shape };
  const full = def.shape.kind === 'full';
  edit((p) => addClip(p, c, { track: full ? freeTrack(p, 'shape', at, c.dur, trackId).id : topTrackFree(p, at, c.dur, trackId), at }));
  select([c.id]);
  return c;
}

// Titles and shapes go on the top-most video track that's free there.
function topTrackFree(p, at, dur, prefer) {
  if (prefer && p.tracks.find((t) => t.id === prefer && t.type === 'video') && isFree(p, prefer, at, dur)) return prefer;
  const vt = p.tracks.filter((t) => t.type === 'video' && !t.locked);
  for (const t of vt) if (isFree(p, t.id, at, dur)) return t.id;
  return freeTrack(p, 'text', at, dur).id;
}

export function applyTransition(type, dur = 0.5) {
  const sel = selectedClips().filter((c) => c.type !== 'audio' && c.type !== 'captions');
  if (!sel.length) { toast('Select a clip on the timeline first, then pick a transition for its start.'); return; }
  edit((p) => { for (const s of sel) clipById(p, s.id).transIn = { type, dur }; });
  toast(`${sel.length > 1 ? `${sel.length} clips` : 'The clip'} now ${sel.length > 1 ? 'start' : 'starts'} with this transition.`, 'ok', 2200);
}

export function applyLook(look) {
  const sel = selectedClips().filter((c) => ['video', 'image', 'text', 'shape'].includes(c.type));
  if (!sel.length) { toast('Select a video or image clip first, then pick a look.'); return; }
  edit((p) => { for (const s of sel) clipById(p, s.id).look = look; });
  toast(`Look: ${LOOKS[look].label}.`, 'ok', 1600);
}

const unlocked = (p, c) => !p.tracks.find((t) => t.id === c.track)?.locked;

// Split the selected clips at the playhead, or every clip there when none is selected.
export function splitAtPlayhead() {
  const t = ed.playhead;
  const sel = selectedClips();
  const targets = (sel.length ? sel : ed.project.clips).filter((c) => c.start < t && end(c) > t && unlocked(ed.project, c));
  if (!targets.length) { toast('Move the playhead over a clip to split it.'); return; }
  const made = edit((p) => targets.map((c) => splitClip(p, c.id, t)).filter(Boolean));
  if (sel.length) select(made.map((c) => c.id));
}

export function deleteSelection(ripple = ed.ripple) {
  const ids = selectedClips().filter((c) => unlocked(ed.project, c)).map((c) => c.id);
  if (!ids.length) return;
  edit((p) => removeClips(p, ids, ripple));
  select([]);
}

export function duplicateSelection() {
  const sel = selectedClips();
  if (!sel.length) return;
  const made = edit((p) => sel.map((c) => duplicateClip(p, c.id)));
  select(made.map((c) => c.id));
}

let clipboard = null;
export function copySelection() {
  const sel = selectedClips();
  if (!sel.length) return;
  const t0 = Math.min(...sel.map((c) => c.start));
  clipboard = sel.map((c) => ({ ...JSON.parse(JSON.stringify(c)), offset: c.start - t0 }));
  toast(`${sel.length} clip${sel.length > 1 ? 's' : ''} copied.`, 'ok', 1200);
}

export function paste() {
  if (!clipboard?.length) return;
  const made = edit((p) => clipboard.map((src) => {
    const c = { ...JSON.parse(JSON.stringify(src)), id: uid() };
    delete c.offset;
    const at = ed.playhead + src.offset;
    const track = p.tracks.find((t) => t.id === src.track) && isFree(p, src.track, at, c.dur) ? src.track : freeTrack(p, c.type, at, c.dur).id;
    return addClip(p, c, { track, at });
  }));
  select(made.map((c) => c.id));
}
