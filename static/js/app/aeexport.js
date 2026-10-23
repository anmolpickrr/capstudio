// "After Effects (editable layers)": a zip with a script that builds the captions
// as text and shape layers (static/ae/capstudio-ae.jsx with the caption data filled
// in), the fonts they use, the watermark if it's on, and a short how-to.
import { toAE } from '../engine/ae.js';
import { watermarkFile, watermarkRect } from '../engine/watermark.js';
import { state } from './store.js';
import { zip } from './zip.js';

const README = (name, fonts) => `Capstudio captions for After Effects
====================================

1. Install the fonts in the "fonts" folder (double-click each one, then Install).
   ${fonts.map((f) => f.name).join(', ')}
2. Restart After Effects if it was open.
3. File > Scripts > Run Script File..., and pick "${name}".
4. A composition with your captions appears. Place it over your footage at 0:00.

Every word is a live text layer (plus its shadow and glow), backgrounds and pills
are shape layers, and all the animation is keyframes, so everything can be changed.
`;

export async function exportAE() {
  const info = state.project.info;
  const stem = (state.project.name || 'video').replace(/\.[^.]*$/, '');
  const data = toAE(state.captions, state.style, info.width, info.height, {
    fps: info.fps && info.fps > 1 ? +info.fps.toFixed(3) : 30, duration: info.duration, name: `${stem} captions`,
    spaced: state.transcript?.spaced ?? true,
  });
  const files = [];
  const wm = state.watermark;
  if (wm?.on) {
    const r = watermarkRect(wm, info.width, info.height);
    const png = new Uint8Array(await (await fetch(`/watermarks/${watermarkFile(wm, info.width, info.height)}`)).arrayBuffer());
    files.push({ name: 'watermark.png', data: png });
    data.watermark = { file: 'watermark.png', x: r.x, y: r.y, w: r.w, h: r.h, opacity: wm.opacity / 100 };
  }
  for (const f of data.fonts) {
    const res = await fetch(`/fonts/${encodeURIComponent(f.file)}`);
    if (res.ok) files.push({ name: `fonts/${f.file}`, data: new Uint8Array(await res.arrayBuffer()) });
  }
  const template = await (await fetch('/ae/capstudio-ae.jsx')).text();
  // JSON is a valid ES3 literal once the two line-separator characters are escaped
  const literal = JSON.stringify(data).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  const script = `${stem} captions.jsx`;
  files.unshift({ name: script, data: template.replace('/*CAPSTUDIO_DATA*/null', literal) },
    { name: 'README.txt', data: README(script, data.fonts) });
  const blob = zip(files);
  return { blob, file: `${stem} After Effects captions.zip`, size: blob.size, layers: data.layers.length, fonts: data.fonts.length };
}
