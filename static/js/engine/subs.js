// Plain caption files (SRT, WebVTT, transcript) with the same line breaks as the
// styled captions.
import { layoutCaption } from './layout.js';

function stamp(s, sep) {
  const t = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, sec = Math.floor(t / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${sep}${String(t % 1000).padStart(3, '0')}`;
}

function lines(c, style, W, H, spaced) {
  const lay = layoutCaption(c, style, W, H, spaced);
  return lay.lines.map((l) => lay.words.slice(l.a, l.b).map((w) => w.text).join(spaced ? ' ' : '')).join('\n');
}

const usable = (captions) => captions.filter((c) => c.end > c.start && c.words.length);

export function toSRT(captions, style, W, H, spaced = true) {
  return usable(captions).map((c, i) =>
    `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${lines(c, style, W, H, spaced)}\n`).join('\n');
}

export function toVTT(captions, style, W, H, spaced = true) {
  return `WEBVTT\n\n${usable(captions).map((c) =>
    `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${lines(c, style, W, H, spaced)}\n`).join('\n')}`;
}

export function toTXT(captions, spaced = true) {
  return captions.map((c) => c.words.map((w) => w.text).join(spaced ? ' ' : '')).join(spaced ? ' ' : '')
    .replace(/([.!?।])\s+/g, '$1\n');
}
