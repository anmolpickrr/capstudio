// Text measurement with the exact font files libass uses, so line breaks and
// word positions computed here hold in the exported video too.
import { cssFamily } from './fonts.js';

let ctx = null;
const cache = new Map();

function context() {
  if (!ctx) ctx = (typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(8, 8) : document.createElement('canvas')).getContext('2d');
  return ctx;
}

// Advance width of `text` in video pixels. `size` is the libass font size;
// `spacing` is extra space after every character (libass \fsp).
export function textWidth(text, font, size, spacing = 0) {
  const key = `${font.id}|${size.toFixed(2)}|${spacing.toFixed(2)}|${text}`;
  let w = cache.get(key);
  if (w === undefined) {
    const c = context();
    c.font = `${size * font.scale}px ${cssFamily(font)}`;
    if ('letterSpacing' in c) c.letterSpacing = `${spacing}px`;
    w = c.measureText(text).width;
    if (!('letterSpacing' in c)) w += spacing * [...text].length;
    if (cache.size > 20000) cache.clear();
    cache.set(key, w);
  }
  return w;
}

export function clearMeasureCache() { cache.clear(); }
