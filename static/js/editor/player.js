// The preview: plays the timeline in real time on a canvas. Each media clip near
// the playhead gets its own video or audio element, kept in step with the
// timeline (position, speed) and routed through a gain for its volume, fades and
// keyframes. Frames are drawn by the same compositor as the export.
import { CaptionEngine } from '../engine/index.js';
import { ensureFonts } from '../engine/fonts.js';
import { fontById } from '../engine/fonts.js';
import { AUDIBLE, duration, gainAt, prevAdjacent, transitionsFor } from './model.js';
import { bitmapOf, cachedBitmap, urlOf } from './media.js';
import { drawFrame, mediaTime } from './render.js';
import { ed, emit, setPlayhead } from './store.js';

const POOL = 16;

export class Player {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.els = new Map();         // clip id → { el, gain, asset, lastUsed }
    this.engines = new Map();     // clip id → { key, engine, ready }
    this.audio = null;
    this.raf = 0;
    this.dirty = true;
    // 'auto': drawn at the size it's shown (sharp, and far less work); 'full': every pixel
    this.quality = 'auto';
    this.display = null;
    this.scale = 1;
    this.src = {
      frame: (c) => {
        const e = this.els.get(this.keyOf(c));
        if (!e) return null;
        // while a frame is being fetched, keep showing the last one (no black flashes)
        if (e.el.readyState < 2 || !e.el.videoWidth || e.el.seeking) return e.snap ? { img: e.snap, w: e.snap.width, h: e.snap.height } : null;
        return { img: e.el, w: e.el.videoWidth, h: e.el.videoHeight };
      },
      image: (id) => {
        const b = cachedBitmap(id);
        if (!b) bitmapOf(id).then(() => this.invalidate()).catch(() => {});
        return b;
      },
      captions: (c) => this.captionEngine(c),
    };
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const e of this.els.values()) { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); }
    this.els.clear();
    this.audio?.close().catch(() => {});
  }

  invalidate() { this.dirty = true; }

  // The size the preview is shown at, in CSS pixels.
  setDisplay(w, h) { this.display = { w, h }; this.resize(); }

  setQuality(q) { this.quality = q; this.resize(); }

  resize() {
    const p = ed.project;
    const dpr = devicePixelRatio || 1;
    this.scale = this.quality === 'full' || !this.display ? 1 : Math.min(1, Math.max(0.1, (this.display.w * dpr) / p.W));
    const w = Math.max(2, Math.round(p.W * this.scale)), h = Math.max(2, Math.round(p.H * this.scale));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.invalidate();
  }

  // ---------------------------------------------------------------- transport

  play() {
    const p = ed.project;
    if (!p) return;
    if (!this.audio) {
      try { this.audio = new AudioContext(); } catch { this.audio = null; }
      for (const e of this.els.values()) this.wire(e);
    }
    this.audio?.resume?.();
    if (ed.playhead >= duration(p) - 0.01) setPlayhead(0);
    ed.playing = true;
    this.base = ed.playhead;
    this.t0 = performance.now();
    emit('play');
  }

  pause() {
    ed.playing = false;
    for (const e of this.els.values()) e.el.pause();
    emit('play');
    this.invalidate();
  }

  toggle() { if (ed.playing) this.pause(); else this.play(); }

  // ---------------------------------------------------------------- media elements

  wire(e) {
    if (!this.audio || e.gain || !e.audible) return;
    try {
      const node = this.audio.createMediaElementSource(e.el);
      e.gain = this.audio.createGain();
      node.connect(e.gain).connect(this.audio.destination);
      e.el.muted = false;
    } catch { /* already wired */ }
  }

  // Pieces of one video cut apart (same file and speed, continuing where the last
  // one stopped, no transition) share a video element, so playback runs straight
  // through those cuts without loading or seeking.
  keyOf(c) {
    const p = ed.project;
    if (this.chainRev !== p.rev || this.chainProject !== p) { this.chains = new Map(); this.chainRev = p.rev; this.chainProject = p; }
    let k = this.chains.get(c.id);
    if (k) return k;
    k = c.id;
    const prev = prevAdjacent(p, c);
    if (prev && prev.asset === c.asset && prev.type === c.type && prev.speed === c.speed && !c.transIn?.type
      && Math.abs(prev.in + prev.dur * prev.speed - c.in) < 0.05) k = this.keyOf(prev);
    this.chains.set(c.id, k);
    return k;
  }

  element(c) {
    const key = this.keyOf(c);
    let e = this.els.get(key);
    if (e && e.asset === c.asset) { e.lastUsed = performance.now(); return e; }
    if (e) { e.el.pause(); this.els.delete(key); }
    // an idle element already playing this file is reused (no new load)
    const idle = [...this.els.entries()].find(([k, x]) => x.asset === c.asset && !this.wanted?.includes(k) && !this.wantedNow?.has(k));
    if (idle) { this.els.delete(idle[0]); this.els.set(key, idle[1]); idle[1].lastUsed = performance.now(); return idle[1]; }
    const asset = ed.project.assets[c.asset];
    const el = document.createElement(c.type === 'audio' ? 'audio' : 'video');
    el.preload = 'auto';
    el.playsInline = true;
    el.muted = true;           // until it's routed through the mixer
    el.preservesPitch = false; // the export changes pitch with speed too
    e = { el, gain: null, asset: c.asset, audible: AUDIBLE.has(c.type) && asset?.hasAudio !== false, lastUsed: performance.now() };
    urlOf(c.asset).then((u) => { el.src = u; }).catch(() => {});
    const redraw = () => {
      this.invalidate();
      // a copy of the frame shown, for while the next one is on its way
      if (el.paused && el.videoWidth && c.type === 'video') {
        if (!e.snap || e.snap.width !== el.videoWidth || e.snap.height !== el.videoHeight) e.snap = new OffscreenCanvas(el.videoWidth, el.videoHeight);
        try { e.snap.getContext('2d').drawImage(el, 0, 0); } catch { e.snap = null; }
      }
    };
    el.addEventListener('loadeddata', redraw);
    el.addEventListener('seeked', redraw);
    this.els.set(key, e);
    this.wire(e);
    if (this.els.size > POOL) this.trim();
    return e;
  }

  trim() {
    const keep = new Set(this.wanted || []);
    const old = [...this.els.entries()].filter(([id]) => !keep.has(id)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (this.els.size > POOL && old.length) {
      const [id, e] = old.shift();
      e.el.pause(); e.el.removeAttribute('src'); e.el.load();
      try { e.gain?.disconnect(); } catch { /* gone */ }
      this.els.delete(id);
    }
  }

  // Keep each media clip near the playhead in step.
  sync(t) {
    const p = ed.project;
    const wanted = [];
    this.wantedNow = new Set();
    // the clip playing now claims its element before ones being readied ahead
    const near = [];
    for (const c of p.clips) {
      if (c.type !== 'video' && c.type !== 'audio') continue;
      const w = transitionsFor(p, c);
      // ready a second before it's needed
      if (t < w.from - 1 || t > w.to) continue;
      near.push({ c, w, inside: t >= w.from && t < w.to });
    }
    near.sort((a, b) => (b.inside - a.inside) || (a.w.from - b.w.from));
    for (const { c, w, inside } of near) {
      const key = this.keyOf(c);
      // a shared element follows the piece that's on screen
      if (this.wantedNow.has(key) && !inside) continue;
      wanted.push(key);
      this.wantedNow.add(key);
      const e = this.element(c);
      const el = e.el;
      if (el.readyState < 1) continue;
      const st = mediaTime(p, c, Math.max(t, w.from));
      if (e.gain) e.gain.gain.value = inside ? gainAt(p, c, t) : 0;
      if (ed.playing && inside) {
        const rate = Math.min(16, Math.max(0.0625, c.speed));
        if (el.playbackRate !== rate) el.playbackRate = rate;
        if (Math.abs(el.currentTime - st) > 0.2 || el.paused) {
          if (Math.abs(el.currentTime - st) > 0.05) el.currentTime = st;
          if (el.paused) el.play().catch(() => {});
        }
      } else {
        if (!el.paused) el.pause();
        const frame = 1 / (p.assets[c.asset]?.fps || 30);
        if (Math.abs(el.currentTime - st) > frame / 2 && !el.seeking) el.currentTime = st;
      }
    }
    for (const [id, e] of this.els) if (!wanted.includes(id) && !e.el.paused) e.el.pause();
    this.wanted = wanted;
  }

  // ---------------------------------------------------------------- captions and fonts

  captionEngine(c) {
    const key = JSON.stringify([c.style, c.captions.length, c.captions[0]?.start, c.captions.at(-1)?.end, ed.project.W, ed.project.H]);
    let e = this.engines.get(c.id);
    if (!e || e.key !== key || e.captions !== c.captions) {
      const engine = new CaptionEngine();
      e = { key, engine, ready: false, captions: c.captions };
      this.engines.set(c.id, e);
      const args = { captions: c.captions, style: c.style, W: ed.project.W, H: ed.project.H, spaced: c.spaced ?? true };
      engine.set(args).then(() => engine.set(args)).then(() => { e.ready = true; this.invalidate(); }).catch(() => {});
    }
    return e.ready ? e.engine : null;
  }

  // Load the fonts text clips use, then redraw.
  prepareFonts() {
    const ids = [...new Set(ed.project.clips.filter((c) => c.type === 'text').map((c) => c.text.font))];
    const key = ids.join();
    if (!ids.length || key === this.fontKey) return;
    this.fontKey = key;
    ensureFonts(ids.map(fontById)).then((fresh) => { if (fresh) this.invalidate(); });
  }

  // ---------------------------------------------------------------- frame loop

  tick() {
    const p = ed.project;
    if (!p) return;
    if (ed.playing) {
      const t = this.base + (performance.now() - this.t0) / 1000;
      const end = duration(p);
      if (t >= end) { setPlayhead(end); this.pause(); } else setPlayhead(t);
      this.dirty = true;
    }
    this.sync(ed.playhead);
    if (!this.dirty) return;
    this.dirty = false;
    drawFrame(this.ctx, p, ed.playhead, this.src, this.canvas.width / p.W);
    emit('frame');
  }
}
