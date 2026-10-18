// The preview: the video with the live caption overlay, playback controls,
// safe-zone overlays, drag-to-position, and the processing overlay.
import { SvgRenderer } from '../engine/index.js';
import { icon } from './icons.js';
import { engine } from './session.js';
import { editCaption } from './captionops.js';
import { check, fitStyle, renderOverlay, zoneById, zoneFits, ZONES } from './safezones.js';
import { emit, setStyle, state } from './store.js';
import { $, fmtTime, h, toast } from './ui.js';

export class Stage {
  constructor(root) {
    this.root = root;
    this.onTime = null;
    this.video = h('video', { playsinline: true, preload: 'auto', crossorigin: 'anonymous' });
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'overlay grab');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.guides = h('div', { class: 'guides', hidden: true, 'aria-hidden': 'true' });
    this.processing = h('div', { class: 'processing', hidden: true });
    this.frame = h('div', { class: 'frame' }, this.video, this.svg, this.guides);
    this.stage = h('div', { class: 'stage' }, this.frame, this.processing);
    this.renderer = new SvgRenderer(this.svg);
    this.transport = this.buildTransport();
    this.zoneBar = this.buildZoneBar();
    root.replaceChildren(this.zoneBar, this.stage, this.transport);

    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.stage);
    this.video.addEventListener('loadedmetadata', () => { this.fit(); this.draw(); });
    this.video.addEventListener('loadeddata', () => { this.captureThumb(); this.draw(); });
    this.video.addEventListener('seeked', () => this.draw());
    this.video.addEventListener('timeupdate', () => { if (this.video.paused) this.draw(); });
    this.video.addEventListener('play', () => { this.syncPlay(); this.loop(); });
    this.video.addEventListener('pause', () => this.syncPlay());
    this.video.addEventListener('error', () => this.useProxy());
    this.bindDrag();
    this.refresh();
  }

  get W() { return state.project?.info?.width || this.video.videoWidth || 1920; }
  get H() { return state.project?.info?.height || this.video.videoHeight || 1080; }
  get duration() { return state.project?.info?.duration || this.video.duration || 0; }
  get time() { return this.video.currentTime; }

  destroy() { this.ro.disconnect(); this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.dead = true; }

  buildTransport() {
    this.playBtn = h('button', { class: 'play', 'aria-label': 'Play', 'data-tip': 'Play / pause (Space)', onclick: () => this.toggle() });
    this.timeEl = h('span', { class: 'time' });
    this.muteBtn = h('button', { class: 'btn ghost icon-only', 'data-tip': 'Mute', html: icon('volume'),
      onclick: () => { this.video.muted = !this.video.muted; this.muteBtn.innerHTML = icon(this.video.muted ? 'mute' : 'volume'); } });
    const rate = h('select', { class: 'select', style: { width: '74px', height: '30px' }, 'aria-label': 'Playback speed' },
      ['0.5', '0.75', '1', '1.25', '1.5'].map((r) => h('option', { value: r, selected: r === '1' ? true : null }, `${r}×`)));
    rate.addEventListener('change', () => { this.video.playbackRate = Number(rate.value); });
    return h('div', { class: 'transport' },
      this.playBtn,
      h('button', { class: 'btn ghost icon-only', 'data-tip': 'Previous frame (,)', html: icon('arrowLeft'), onclick: () => this.stepFrame(-1) }),
      h('button', { class: 'btn ghost icon-only', 'data-tip': 'Replay this caption', html: icon('replay'), onclick: () => this.replayCaption() }),
      this.timeEl, h('span', { class: 'grow' }), rate, this.muteBtn);
  }

  // ------------------------------------------------------------ source & sizing
  refresh() {
    const p = state.project;
    if (!p) return;
    if (p.src && this.src !== p.src) { this.src = p.src; this.proxyTried = false; this.video.src = p.src; }
    this.renderGuides();
    const busy = state.phase === 'uploading' || state.phase === 'generating';
    this.processing.hidden = !busy;
    if (busy) this.renderProcessing();
    this.renderer.setSize(this.W, this.H);
    this.fit();
    this.syncPlay();
  }

  fit() {
    const box = this.stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const ar = this.W / this.H;
    let w = box.width, hgt = w / ar;
    if (hgt > box.height) { hgt = box.height; w = hgt * ar; }
    this.frame.style.width = `${Math.floor(w)}px`;
    this.frame.style.height = `${Math.floor(hgt)}px`;
  }

  async useProxy() {
    const job = state.project?.job;
    if (this.proxyTried || !job) return;
    this.proxyTried = true;
    this.src = `/api/jobs/${job}/proxy`;
    this.video.src = this.src;
  }

  captureThumb() {
    try {
      const c = document.createElement('canvas');
      const scale = 320 / Math.max(this.video.videoWidth, 1);
      c.width = Math.round(this.video.videoWidth * scale); c.height = Math.round(this.video.videoHeight * scale);
      c.getContext('2d').drawImage(this.video, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.7);
      state.frameThumb = url;
      const t = $('#file-thumb');
      if (t) t.style.backgroundImage = `url(${url})`;
      emit('thumb');
    } catch { /* cross-origin or not ready */ }
  }

  renderProcessing() {
    const p = state.progress;
    const pct = state.phase === 'uploading' ? p.upload : p.transcribe;
    const title = state.phase === 'uploading' ? 'Uploading' : 'Generating captions';
    this.processing.replaceChildren(h('div', { class: 'processing-card', role: 'status', 'aria-live': 'polite' },
      h('h3', {}, h('span', { class: 'spinner' }), title),
      h('div', { class: `progress${pct > 0.02 ? '' : ' indeterminate'}` }, h('i', { style: { width: `${Math.round(pct * 100)}%` } })),
      h('p', {}, p.message || ''),
      h('p', { class: 'hint' }, 'While you wait, you can pick a style on the left.')));
  }

  // ------------------------------------------------------------ safe zones
  buildZoneBar() {
    this.zoneButtons = ZONES.map((z) => h('button', { type: 'button', class: 'zone-chip', 'data-zone': z.id, title: z.name && z.name !== z.label ? z.name : null,
      onclick: () => { state.safeZone = z.id; this.zoneKey = null; this.refresh(); } }, z.label));
    this.zoneStatus = h('div', { class: 'zone-status', role: 'status', 'aria-live': 'polite' });
    this.zoneSource = h('p', { class: 'zone-source' });
    return h('div', { class: 'zone-bar' },
      h('span', { class: 'zone-title' }, 'Safe zone'),
      h('div', { class: 'zone-chips', role: 'group', 'aria-label': 'Safe zone format' }, this.zoneButtons),
      this.zoneStatus, this.zoneSource);
  }

  renderGuides() {
    const fits = (z) => zoneFits(z, this.W, this.H);
    for (const b of this.zoneButtons) {
      const z = zoneById(b.dataset.zone);
      b.setAttribute('aria-pressed', String(b.dataset.zone === state.safeZone));
      b.disabled = !fits(z);
      b.title = fits(z) ? (z.name && z.name !== z.label ? z.name : '') : `${z.name}: made for 9:16 vertical videos`;
    }
    let zone = zoneById(state.safeZone);
    if (!fits(zone)) { state.safeZone = 'off'; zone = zoneById('off'); }
    this.guides.hidden = zone.id === 'off';
    this.zoneSource.textContent = zone.id === 'off' ? '' : `${zone.name}: ${zone.source}`;
    const key = [zone.id, this.W, this.H].join('|');
    if (key !== this.overlayKey) { this.overlayKey = key; renderOverlay(this.guides, zone, this.W, this.H); }
    this.renderZoneStatus(zone);
  }

  // Do any captions cross into covered areas? Recomputed only when something changed.
  renderZoneStatus(zone) {
    if (zone.id === 'off' || state.phase !== 'editing' || !state.captions.length) { this.zoneStatus.replaceChildren(); this.zoneKey = null; return; }
    if (this.zoneKey && this.zoneKey.style === state.style && this.zoneKey.captions === state.captions && this.zoneKey.zone === zone.id) return;
    this.zoneKey = { style: state.style, captions: state.captions, zone: zone.id };
    const { count } = check(state.captions, state.style, zone, this.W, this.H);
    if (!count) {
      this.zoneStatus.replaceChildren(h('span', { class: 'zone-ok' }, 'All captions are inside the safe zone'));
      return;
    }
    const fix = h('button', { class: 'btn sm', type: 'button', onclick: () => {
      const s = fitStyle(state.captions, state.style, zone, this.W, this.H);
      if (!s) { toast('These captions are too big to fit. Try a smaller size or fewer words per caption.', 'error'); return; }
      const patch = {};
      for (const k of ['vPos', 'vOffset', 'hPos', 'hOffset', 'width', 'align']) if (s[k] !== state.style[k]) patch[k] = s[k];
      setStyle(patch, 'fit-safe-zone');
      toast(`Moved inside the ${zone.name} safe zone. Undo with Ctrl+Z.`, 'ok', 3500);
    } }, 'Move inside');
    this.zoneStatus.replaceChildren(h('span', { class: 'zone-warn' },
      count === 1 ? '1 caption is in a covered area' : `${count} captions are in covered areas`), fix);
  }

  // ------------------------------------------------------------ playback
  toggle() { this.stopAt = this.restAt = null; if (this.video.paused) this.video.play().catch(() => {}); else this.video.pause(); }
  seek(t) { this.video.currentTime = Math.min(Math.max(0, t), this.duration || t); this.draw(); }
  seekBy(d) { this.seek(this.video.currentTime + d); }
  stepFrame(dir) { this.video.pause(); this.seek(this.video.currentTime + dir / (state.project?.info?.fps || 30)); }
  replayCaption() {
    const t = this.video.currentTime;
    const c = state.captions.find((x) => t >= x.start && t < x.end) || state.captions.find((x) => x.start >= t) || state.captions[0];
    if (!c) return;
    this.seek(c.start);
    this.video.play().catch(() => {});
    this.stopAt = c.end;
    // afterwards, rest on a frame where the caption is fully shown
    this.restAt = Math.max(c.start, c.end - Math.min(0.35, (c.end - c.start) / 3));
  }

  syncPlay() {
    const playing = !this.video.paused;
    this.playBtn.innerHTML = icon(playing ? 'pause' : 'play');
    this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  loop() {
    if (this.dead) return;
    this.draw();
    if (this.stopAt && this.video.currentTime >= this.stopAt) {
      this.video.pause();
      this.stopAt = null;
      if (this.restAt != null) { this.seek(this.restAt); this.restAt = null; }
    }
    if (!this.video.paused) requestAnimationFrame(() => this.loop());
  }

  redraw() { this.renderer.clear(); this.draw(); }

  draw() {
    if (this.dead || !state.project) return;
    const t = this.video.currentTime;
    const scenes = state.phase === 'editing' ? engine.scenesAt(t) : [];
    this.renderer.render(scenes, t);
    this.timeEl.textContent = `${fmtTime(t)} / ${fmtTime(this.duration)}`;
    this.onTime?.(t);
    const active = scenes[0]?.caption.id || null;
    if (active !== this.active) { this.active = active; state.activeCaption = active; emit('active'); }
  }

  // ------------------------------------------------------------ drag to move
  bindDrag() {
    let drag = null;
    this.svg.addEventListener('pointerdown', (e) => {
      if (state.phase !== 'editing') return;
      const r = this.svg.getBoundingClientRect();
      const scale = Math.min(r.width / this.W, r.height / this.H);
      drag = { x: e.clientX, y: e.clientY, scale, v: state.style.vOffset, hOff: state.style.hOffset, moved: false };
      this.svg.setPointerCapture(e.pointerId);
      this.svg.classList.add('grabbing');
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / drag.scale, dy = (e.clientY - drag.y) / drag.scale;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.moved = true;
      const s = state.style;
      const vSign = s.vPos === 'bottom' ? -1 : 1;
      const hSign = s.hPos === 'right' ? -1 : 1;
      const v = Math.round(Math.min(48, Math.max(-48, drag.v + vSign * (dy / this.H) * 100)) * 2) / 2;
      const hh = Math.round(Math.min(45, Math.max(-45, drag.hOff + hSign * (dx / this.W) * 100)) * 2) / 2;
      setStyle({ vOffset: v, hOffset: s.hPos === 'center' || Math.abs(hh) > 0 ? hh : s.hOffset }, 'drag');
    });
    const end = () => {
      if (drag && !drag.moved) {
        const t = this.video.currentTime;
        const c = state.captions.find((x) => t >= x.start && t < x.end);
        if (c) {
          // second click on the same caption: edit its text
          const now = performance.now();
          if (this.lastTap?.id === c.id && now - this.lastTap.at < 400) { this.lastTap = null; editCaption(c.id); }
          else { this.lastTap = { id: c.id, at: now }; state.selected = c.id; emit('selection'); }
        } else this.toggle();
      }
      drag = null;
      this.svg.classList.remove('grabbing');
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', end);
  }
}
