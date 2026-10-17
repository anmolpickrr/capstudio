// The caption engine used by the app: owns the scene cache and keeps fonts
// loaded, so the preview can redraw any frame cheaply.
import { ensureFonts } from './fonts.js';
import { fontsFor } from './layout.js';
import { clearMeasureCache } from './measure.js';
import { buildScene } from './scene.js';

export { toASS } from './ass.js';
export { toSRT, toTXT, toVTT } from './subs.js';
export { SvgRenderer } from './svg.js';

export class CaptionEngine {
  constructor() {
    this.captions = [];
    this.style = null;
    this.W = 1920; this.H = 1080;
    this.spaced = true;
    this.cache = new Map(); // caption -> scene
    this.styleKey = '';
  }

  // Update inputs; returns a promise that resolves once needed fonts are loaded.
  async set({ captions = this.captions, style = this.style, W = this.W, H = this.H, spaced = this.spaced }) {
    const key = JSON.stringify(style) + W + 'x' + H + spaced;
    if (key !== this.styleKey) { this.cache.clear(); this.styleKey = key; }
    this.captions = captions; this.style = style; this.W = W; this.H = H; this.spaced = spaced;
    if (!style) return;
    const newlyLoaded = await ensureFonts(fontsFor(captions, style));
    if (newlyLoaded) { clearMeasureCache(); this.cache.clear(); }
  }

  scene(caption) {
    let s = this.cache.get(caption);
    if (!s) {
      s = buildScene(caption, this.style, this.W, this.H, this.spaced);
      this.cache.set(caption, s);
      if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    }
    return s;
  }

  // Scenes on screen at time t.
  scenesAt(t) {
    const out = [];
    for (const c of this.captions) if (t >= c.start && t < c.end && c.words.length) out.push(this.scene(c));
    return out;
  }
}
