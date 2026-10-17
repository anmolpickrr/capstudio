// Timeline: audio waveform, caption blocks you can move and trim, and word
// markers (for the selected caption) you can drag to fix word timing.
import { moveWordStart, retime } from '../engine/chunk.js';
import { api } from './api.js';
import { icon } from './icons.js';
import { checkpoint, emit, state } from './store.js';
import { h } from './ui.js';

const MIN_CAP = 0.2;

export class Timeline {
  constructor(root, stage) {
    this.root = root;
    this.stage = stage;
    this.zoom = 1;
    this.scroll = h('div', { class: 'tl-scroll' });
    this.content = h('div', { class: 'tl-content' });
    this.ruler = h('div', { class: 'tl-ruler' });
    this.wave = h('canvas', { class: 'tl-wave' });
    this.track = h('div', { class: 'tl-track' });
    this.head = h('div', { class: 'tl-head-line' });
    this.content.append(this.ruler, this.wave, this.track, this.head);
    this.scroll.append(this.content);
    this.info = h('span', { class: 'hint' });
    root.replaceChildren(
      h('div', { class: 'tl-head' },
        h('span', { class: 'label' }, 'Timeline'),
        this.info,
        h('span', { style: { flex: 1 } }),
        h('button', { class: 'btn ghost sm icon-only', 'data-tip': 'Zoom out', html: icon('zoomOut'), onclick: () => this.setZoom(this.zoom / 1.6) }),
        h('button', { class: 'btn ghost sm icon-only', 'data-tip': 'Zoom in', html: icon('zoomIn'), onclick: () => this.setZoom(this.zoom * 1.6) }),
        h('button', { class: 'btn ghost sm', onclick: () => this.setZoom(1) }, 'Fit')),
      this.scroll);
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.scroll);
    this.ruler.addEventListener('pointerdown', (e) => this.seekFromEvent(e));
    this.track.addEventListener('pointerdown', (e) => { if (e.target === this.track) this.seekFromEvent(e); });
    this.scroll.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    }, { passive: false });
  }

  destroy() { this.ro.disconnect(); }

  get duration() { return this.stage.duration || 1; }
  get pps() { return (this.scroll.clientWidth / this.duration) * this.zoom; } // pixels per second
  x(t) { return t * this.pps; }

  setZoom(z) {
    const centerT = (this.scroll.scrollLeft + this.scroll.clientWidth / 2) / this.pps;
    this.zoom = Math.min(80, Math.max(1, z));
    this.layout();
    this.scroll.scrollLeft = centerT * this.pps - this.scroll.clientWidth / 2;
  }

  seekFromEvent(e) {
    const r = this.content.getBoundingClientRect();
    this.stage.seek((e.clientX - r.left) / this.pps);
  }

  refresh(what) {
    if (!what || ['captions', 'project', 'selection', 'active', 'style', 'history'].includes(what)) this.layout();
    if (state.project?.job && this.waveJob !== state.project.job) this.loadWave(state.project.job);
  }

  async loadWave(job) {
    this.waveJob = job;
    try {
      const w = await api(`/api/jobs/${job}/waveform`);
      if (this.waveJob === job) { this.peaks = w; this.drawWave(); }
    } catch { /* waveform is optional */ }
  }

  layout() {
    const width = Math.max(this.scroll.clientWidth, this.duration * this.pps);
    this.content.style.width = `${width}px`;
    this.drawRuler();
    this.drawWave();
    this.drawCaptions();
    this.setTime(this.stage.time);
  }

  drawRuler() {
    const pps = this.pps;
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((s) => s * pps >= 70) || 600;
    const ticks = [];
    for (let t = 0; t <= this.duration + 0.001; t += step) {
      const m = Math.floor(t / 60), s = t % 60;
      ticks.push(h('span', { class: 'tick', style: { left: `${this.x(t)}px` } }, `${m}:${String(Math.floor(s)).padStart(2, '0')}${step < 1 ? `.${Math.round((s % 1) * 10)}` : ''}`));
    }
    this.ruler.replaceChildren(...ticks);
  }

  drawWave() {
    const c = this.wave;
    const w = Math.max(1, Math.round(this.content.clientWidth || this.scroll.clientWidth));
    const hgt = 36;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.min(32000, w * dpr); c.height = hgt * dpr;
    c.style.width = `${w}px`;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (!this.peaks?.peaks?.length) return;
    const { peaks, rate } = this.peaks;
    let loudest = 0.05;
    for (const v of peaks) if (v > loudest) loudest = v;
    const norm = 1 / loudest; // quiet recordings still show their shape
    g.fillStyle = '#9a9aa3';
    const cols = c.width;
    for (let px = 0; px < cols; px++) {
      const t0 = (px / cols) * (w / this.pps), t1 = ((px + 1) / cols) * (w / this.pps);
      let m = 0;
      for (let i = Math.floor(t0 * rate); i < Math.min(peaks.length, Math.ceil(t1 * rate)); i++) m = Math.max(m, peaks[i]);
      const bh = Math.max(1, Math.min(1, m * norm) * c.height * 0.95);
      g.fillRect(px, (c.height - bh) / 2, 1, bh);
    }
  }

  drawCaptions() {
    const frag = document.createDocumentFragment();
    state.captions.forEach((c, idx) => {
      const el = h('div', {
        class: `tl-cap${c.id === state.activeCaption ? ' active' : ''}${c.id === state.selected ? ' selected' : ''}`,
        style: { left: `${this.x(c.start)}px`, width: `${Math.max(4, this.x(c.end) - this.x(c.start))}px` },
        title: c.words.map((w) => w.text).join(' '),
      }, c.words.map((w) => w.text).join(' '));
      const l = h('span', { class: 'edge l' }), r = h('span', { class: 'edge r' });
      el.append(l, r);
      el.addEventListener('pointerdown', (e) => this.dragCaption(e, idx, e.target === l ? 'start' : e.target === r ? 'end' : 'move'));
      if (c.id === state.selected) {
        c.words.forEach((w, i) => {
          if (i === 0) return;
          const tick = h('span', { class: 'tl-word', style: { left: `${this.x(w.start) - this.x(c.start)}px` }, title: `“${w.text}” starts here — drag to adjust` });
          tick.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.dragWord(e, idx, i); });
          el.append(tick);
        });
      }
      frag.append(el);
    });
    this.track.replaceChildren(frag);
    const sel = state.captions.find((c) => c.id === state.selected);
    this.info.textContent = sel ? 'Drag the block to move it, its edges to trim, and the white lines to fix word timing.' : 'Click a caption to adjust its timing.';
  }

  dragCaption(e, idx, mode) {
    e.preventDefault();
    const caps = state.captions;
    const c0 = caps[idx];
    state.selected = c0.id;
    emit('selection');
    const startX = e.clientX;
    const prevEnd = idx > 0 ? caps[idx - 1].end : 0;
    const nextStart = idx + 1 < caps.length ? caps[idx + 1].start : this.duration;
    const touchPrev = idx > 0 && Math.abs(caps[idx - 1].end - c0.start) < 0.02;
    const touchNext = idx + 1 < caps.length && Math.abs(caps[idx + 1].start - c0.end) < 0.02;
    let moved = false;
    const move = (ev) => {
      const d = (ev.clientX - startX) / this.pps;
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      if (!moved) { moved = true; checkpoint(`tl-${Date.now()}`); }
      let s = c0.start, en = c0.end;
      if (mode === 'move') {
        const len = c0.end - c0.start;
        s = Math.min(Math.max(prevEnd, c0.start + d), nextStart - len);
        en = s + len;
      } else if (mode === 'start') {
        // a boundary shared with the previous caption moves both (like a cut point)
        const lo = touchPrev ? caps[idx - 1].start + MIN_CAP : prevEnd;
        s = Math.min(Math.max(lo, c0.start + d), c0.end - MIN_CAP);
      } else {
        const hi = touchNext ? caps[idx + 1].end - MIN_CAP : nextStart;
        en = Math.max(Math.min(hi, c0.end + d), c0.start + MIN_CAP);
      }
      const next = mode === 'move' ? retime(c0, s, en) : trim(c0, s, en);
      state.captions = caps.map((c, i) => {
        if (i === idx) return next;
        if (mode === 'start' && touchPrev && i === idx - 1) return trim(c, c.start, s);
        if (mode === 'end' && touchNext && i === idx + 1) return trim(c, en, c.end);
        return c;
      });
      emit('captions');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) this.stage.seek(c0.start + 0.01);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  dragWord(e, idx, wi) {
    e.preventDefault();
    checkpoint(`tlw-${Date.now()}`);
    const r = this.content.getBoundingClientRect();
    const move = (ev) => {
      const t = (ev.clientX - r.left) / this.pps;
      state.captions = state.captions.map((c, i) => (i === idx ? moveWordStart(c, wi, t) : c));
      emit('captions');
      this.stage.seek(t + 0.01);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  setTime(t) {
    this.head.style.left = `${this.x(t)}px`;
    if (!this.stage.video.paused) {
      const x = this.x(t), sl = this.scroll.scrollLeft, w = this.scroll.clientWidth;
      if (x < sl || x > sl + w - 40) this.scroll.scrollLeft = x - w * 0.2;
    }
  }
}

// Trimming keeps word timings where they are, clamped into the new range.
function trim(c, start, end) {
  const words = c.words.map((w) => ({ ...w, start: Math.min(Math.max(w.start, start), end - 0.02), end: Math.min(Math.max(w.end, start + 0.02), end) }));
  return { ...c, start, end, words };
}
