// Starting points for a new project: canvas formats (with the platforms they're
// for) and starter layouts made of titles and shapes, built for whatever canvas
// size is picked. Media is added on top (videos go on the main track, V1).
import { addClip, addTrack, isFree, makeClip } from './model.js';

export const FORMATS = [
  { id: '9x16', group: 'Social', label: 'Vertical', ratio: '9:16', W: 1080, H: 1920, note: 'Reels · TikTok · Shorts' },
  { id: '4x5', group: 'Social', label: 'Portrait', ratio: '4:5', W: 1080, H: 1350, note: 'Instagram & Facebook feed' },
  { id: '1x1', group: 'Social', label: 'Square', ratio: '1:1', W: 1080, H: 1080, note: 'Feed posts · carousels' },
  { id: '2x3', group: 'Social', label: 'Tall', ratio: '2:3', W: 1000, H: 1500, note: 'Pinterest pins' },
  { id: '16x9', group: 'Video', label: 'Landscape', ratio: '16:9', W: 1920, H: 1080, note: 'YouTube · websites · decks' },
  { id: '4k', group: 'Video', label: '4K UHD', ratio: '16:9', W: 3840, H: 2160, note: 'Big screens, best detail' },
  { id: '21x9', group: 'Video', label: 'Cinematic', ratio: '21:9', W: 2560, H: 1080, note: 'Widescreen film look' },
  { id: 'custom', group: 'Custom', label: 'Custom', ratio: '', W: 1080, H: 1080, note: 'Any size you need' },
];

export const FPS = [24, 25, 30, 60];
export const BACKGROUNDS = ['#000000', '#111114', '#FFFFFF', '#F4EBDD', '#6037D7', '#4F6BFF', '#FF4D4D', '#FFE14D', '#00C2A8'];

// Clips are laid out in a 1080-wide frame and scaled to the canvas (by its short
// side), so a layout looks the same on 9:16, 16:9 or 4K.
function text(p, at, dur, t, props = {}) {
  const k = Math.min(p.W, p.H) / 1080;
  const c = makeClip('text', { dur });
  c.text = { ...c.text, ...t, size: Math.round((t.size || 96) * k), pad: Math.round((t.pad ?? 24) * k), outline: (t.outline || 0) * k };
  c.name = c.text.content.split('\n')[0];
  c.props.x = (props.x || 0) * p.W;
  c.props.y = (props.y || 0) * p.H;
  place(p, c, at);
  return c;
}

function shape(p, at, dur, s, props = {}) {
  const k = Math.min(p.W, p.H) / 1080;
  const c = makeClip('shape', { dur, name: 'Shape' });
  c.shape = { ...c.shape, ...s, w: Math.round((s.w || 600) * k), h: Math.round((s.h || 200) * k), radius: Math.round((s.radius || 0) * k) };
  c.props.x = (props.x || 0) * p.W;
  c.props.y = (props.y || 0) * p.H;
  if (props.animIn) c.anim = { in: props.animIn, inDur: 0.5, outDur: 0.4, loopAmt: 50 };
  place(p, c, at);
  return c;
}

// Titles go above the main track (V1 stays free for the user's videos).
function place(p, c, at) {
  const above = p.tracks.filter((t) => t.type === 'video').slice(0, -1);
  const free = above.find((t) => isFree(p, t.id, at, c.dur));
  addClip(p, c, { track: (free || addTrack(p, 'video')).id, at });
}

export const STARTERS = [
  { id: 'blank', name: 'Blank', note: 'An empty timeline', build() {} },
  { id: 'hook', name: 'Scroll-stopper', note: 'A big opening hook', bg: '#111114', build(p) {
    text(p, 0, 6, { content: 'WAIT FOR IT', font: 'Bangers-Regular', size: 170, color: '#FFE14D', outline: 9, outlineColor: '#000000', shadow: 0, animIn: 'drop', animOut: 'pop' }, { y: -0.2 });
    text(p, 0.4, 5.6, { content: 'the one trick nobody tells you', font: 'Poppins-Bold', size: 58, shadow: 0.5, animIn: 'rise', animOut: 'fade' }, { y: -0.08 });
  } },
  { id: 'launch', name: 'Product launch', note: 'Tag, title and a line', bg: '#6037D7', build(p) {
    text(p, 0, 6, { content: 'NEW DROP', font: 'Montserrat-ExtraBold', size: 52, color: '#111111', bg: true, bgColor: '#FFE14D', bgOpacity: 1, pad: 22, radius: 999, shadow: 0, animIn: 'pop', animOut: 'fade' }, { y: -0.16 });
    text(p, 0.2, 5.8, { content: 'ONE CLICK\nCHECKOUT', font: 'Anton-Regular', size: 168, lineHeight: 1, shadow: 0.35, animIn: 'rise', animOut: 'fade' }, { y: -0.02 });
    shape(p, 0.4, 5.6, { kind: 'rect', w: 420, h: 12, fill: '#FFFFFF', radius: 6 }, { y: 0.1, animIn: 'slide-right' });
    text(p, 0.6, 5.4, { content: 'Live today on every store', font: 'Poppins-Bold', size: 52, shadow: 0, animIn: 'fade', animOut: 'fade' }, { y: 0.16 });
  } },
  { id: 'quote', name: 'Quote card', note: 'Quote and a name', bg: '#F4EBDD', build(p) {
    text(p, 0, 6, { content: '“Make every\nsecond count.”', font: 'InstrumentSerif-Italic', size: 132, color: '#1A1A1A', lineHeight: 1.05, shadow: 0, animIn: 'fade', animOut: 'fade' }, { y: -0.04 });
    text(p, 0.6, 5.4, { content: '— ANMOL, FOUNDER', font: 'Montserrat-ExtraBold', size: 38, color: '#6037D7', shadow: 0, animIn: 'rise', animOut: 'fade' }, { y: 0.12 });
  } },
  { id: 'sale', name: 'Sale promo', note: 'Offer and a code', bg: '#FF4D4D', build(p) {
    text(p, 0, 6, { content: 'FLAT', font: 'Anton-Regular', size: 90, color: '#FFFFFF', shadow: 0, animIn: 'fade', animOut: 'fade' }, { y: -0.17 });
    text(p, 0.1, 5.9, { content: '50% OFF', font: 'Anton-Regular', size: 230, color: '#FFE14D', outline: 0, shadow: 0.3, animIn: 'pop', animOut: 'pop' }, { y: -0.05 });
    text(p, 0.5, 5.5, { content: 'Use code FASTRR', font: 'Poppins-Bold', size: 50, color: '#111111', bg: true, bgColor: '#FFFFFF', bgOpacity: 1, pad: 22, radius: 999, shadow: 0, animIn: 'rise', animOut: 'fade' }, { y: 0.1 });
    text(p, 0.8, 5.2, { content: 'Ends Sunday', font: 'Poppins-Bold', size: 40, color: '#FFFFFF', shadow: 0, animIn: 'fade', animOut: 'fade' }, { y: 0.18 });
  } },
  { id: 'list', name: 'Top 3 list', note: 'Title and 3 points', bg: '#0B0B10', build(p) {
    text(p, 0, 9, { content: '3 THINGS TO KNOW', font: 'Montserrat-ExtraBold', size: 76, color: '#A08BFF', shadow: 0, animIn: 'rise', animOut: 'fade' }, { y: -0.22 });
    ['1. Pay in one click', '2. No forms to fill', '3. Done in seconds'].forEach((line, i) => {
      text(p, 0.3 + i * 3, 2.7, { content: line, font: 'Poppins-Bold', size: 84, shadow: 0.4, animIn: 'pop', animOut: 'fade' }, { y: 0 });
    });
  } },
  { id: 'lower', name: 'Talking head', note: 'Name and role', bg: '#1C1C22', build(p) {
    text(p, 0.3, 5.7, { content: 'Anmol Sharma\nFounder, Fastrr', font: 'Poppins-Bold', size: 52, align: 'left', bg: true, bgColor: '#6037D7', bgOpacity: 1, pad: 28, radius: 18, shadow: 0, animIn: 'wipe', animOut: 'fade' },
      { x: -0.2, y: p.H > p.W ? 0.26 : 0.3 });
  } },
];

export const starterById = (id) => STARTERS.find((s) => s.id === id) || STARTERS[0];

// Even sizes in a sensible range (video encoders need even sizes).
export const evenSize = (v, fallback) => {
  const n = Math.round(Number(v) / 2) * 2;
  return Number.isFinite(n) && n >= 64 ? Math.min(7680, n) : fallback;
};
