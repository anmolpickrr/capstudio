// The inspector: settings of the selected clip (or of the project when nothing is
// selected). Properties that can animate have a keyframe button: on, it adds a
// keyframe at the playhead, and from then on changing the value there sets that
// keyframe. Values follow the playhead while animated.
import { fontButton } from '../app/fontpicker.js';
import { icon } from '../app/icons.js';
import { fmtTime, h } from '../app/ui.js';
import { TEMPLATES } from '../templates/library.js';
import {
  allKeyTimes, ANIMS_IN, ANIMS_LOOP, BLENDS, clipById, EASES, EFFECT_KEYS, EFFECTS, keyAt, LOOKS, makeClip, PRESETS, setSpeed, setValue, TEXT_ANIMS, TREND_KEYS,
  toggleKey, TRANSITIONS, valueAt, addClip, freeTrack,
} from './model.js';
import { ed, edit, on, selectedClips, setPlayhead } from './store.js';

const SWATCHES = ['#FFFFFF', '#111111', '#FFE14D', '#FF9F1C', '#FF4D4D', '#FF4FD8', '#7C5CFF', '#6037D7', '#4F6BFF', '#00E5FF', '#3DFF7A', '#F4EBDD'];
const TYPE_NAME = { video: 'Video', image: 'Image', audio: 'Audio', text: 'Text', shape: 'Shape', captions: 'Captions', adjust: 'Adjustment' };

export function mountInspector(root) {
  let syncs = [], shape = '';

  const localT = (c) => Math.min(Math.max(ed.playhead - c.start, 0), c.dur);
  const change = (id, fn, key) => edit((p) => { const c = clipById(p, id); if (c) fn(c, p); }, key);

  // ---------------------------------------------------------------- controls

  function section(title, ...kids) {
    return h('section', { class: 'ins-sec' }, h('h3', {}, title), ...kids);
  }

  // A number with a slider; `prop` makes it keyframable (clip property).
  function numRow(c, { label, min, max, step = 1, get, set, prop, unit = '', toView = (v) => v, fromView = (v) => v, digits = 0 }) {
    const range = h('input', { type: 'range', class: 'range', min, max, step, 'aria-label': label });
    const num = h('input', { type: 'number', class: 'ins-num', min, max, step, 'aria-label': label });
    const keyBtn = prop ? h('button', { class: 'ins-key', type: 'button', 'aria-label': `Keyframe ${label}`, html: icon('diamond') }) : null;
    const read = () => (prop ? valueAt(clipById(ed.project, c.id), prop, localT(clipById(ed.project, c.id))) : get());
    const write = (view) => {
      const v = fromView(Math.min(max, Math.max(min, view)));
      if (prop) change(c.id, (x) => setValue(x, prop, v, localT(x)), `${c.id}-${prop}`);
      else set(v);
    };
    range.addEventListener('input', () => { write(Number(range.value)); num.value = (+range.value).toFixed(digits); paintFill(); });
    num.addEventListener('change', () => { if (num.value !== '') write(Number(num.value)); });
    keyBtn?.addEventListener('click', () => change(c.id, (x) => toggleKey(x, prop, localT(x))));
    const paintFill = () => range.style.setProperty('--fill', `${((Number(range.value) - min) / (max - min)) * 100}%`);
    syncs.push(() => {
      const cur = clipById(ed.project, c.id);
      if (!cur) return;
      const v = toView(read());
      if (document.activeElement !== range) range.value = v;
      if (document.activeElement !== num) num.value = (+v).toFixed(digits);
      paintFill();
      if (keyBtn) {
        const animated = !!cur.keys?.[prop]?.length;
        keyBtn.classList.toggle('animated', animated);
        keyBtn.classList.toggle('on', !!keyAt(cur, prop, localT(cur)));
        keyBtn.dataset.tip = animated ? (keyAt(cur, prop, localT(cur)) ? 'Remove this keyframe' : 'Add a keyframe here') : 'Animate: add a keyframe at the playhead';
      }
    });
    return h('div', { class: 'ins-row' }, h('label', {}, label, unit ? h('small', {}, unit) : null), h('div', { class: 'ins-ctl' }, range, num), keyBtn || h('span', { class: 'ins-key-space' }));
  }

  function selectRow(label, options, get, set) {
    const sel = h('select', { class: 'select', 'aria-label': label }, options.map(([v, t]) => h('option', { value: v }, t)));
    sel.addEventListener('change', () => set(sel.value));
    syncs.push(() => { sel.value = get(); });
    return h('div', { class: 'ins-row wide' }, h('label', {}, label), sel);
  }

  function segRow(label, options, get, set) {
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label }, options.map(([v, t]) => h('button', { type: 'button', 'data-v': v, onclick: () => set(v) }, t)));
    syncs.push(() => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(get())))));
    return h('div', { class: 'ins-row wide' }, h('label', {}, label), seg);
  }

  function switchRow(label, get, set) {
    const i = h('input', { type: 'checkbox', role: 'switch' });
    i.addEventListener('change', () => set(i.checked));
    syncs.push(() => { i.checked = !!get(); });
    return h('label', { class: 'switch ins-switch' }, h('span', {}, label), i);
  }

  function colorRow(label, get, set) {
    const input = h('input', { type: 'color', 'aria-label': label });
    const sw = h('span', { class: 'swatch' }), hex = h('span', { class: 'hex' });
    input.addEventListener('input', () => set(input.value.toUpperCase()));
    const row = h('div', { class: 'swatches' }, SWATCHES.map((col) => h('button', { type: 'button', style: { background: col }, 'aria-label': col, title: col, onclick: () => set(col) })));
    syncs.push(() => { const v = get() || '#000000'; input.value = v.toLowerCase(); sw.style.background = v; hex.textContent = v; });
    return h('div', { class: 'ins-row wide' }, h('label', {}, label), h('div', {}, h('label', { class: 'color' }, sw, hex, input), row));
  }

  // ---------------------------------------------------------------- sections

  function keyNav(c) {
    const prev = h('button', { class: 'btn ghost xs icon-only', type: 'button', 'aria-label': 'Previous keyframe', 'data-tip': 'Previous keyframe', html: icon('stepBack'),
      onclick: () => { const cur = clipById(ed.project, c.id); const ts = allKeyTimes(cur).filter((k) => k < localT(cur) - 1e-3); if (ts.length) setPlayhead(cur.start + ts[ts.length - 1]); } });
    const next = h('button', { class: 'btn ghost xs icon-only', type: 'button', 'aria-label': 'Next keyframe', 'data-tip': 'Next keyframe', html: icon('stepFwd'),
      onclick: () => { const cur = clipById(ed.project, c.id); const ts = allKeyTimes(cur).filter((k) => k > localT(cur) + 1e-3); if (ts.length) setPlayhead(cur.start + ts[0]); } });
    const ease = h('select', { class: 'select xs', 'aria-label': 'Easing into this keyframe' }, Object.entries(EASES).map(([v, e]) => h('option', { value: v }, e.label)));
    ease.addEventListener('change', () => change(c.id, (x) => {
      for (const keys of Object.values(x.keys || {})) for (const k of keys) if (Math.abs(k.t - localT(x)) < 1 / 60) k.ease = ease.value;
    }));
    const easeBox = h('label', { class: 'ins-ease' }, 'Easing', ease);
    const label = h('span', { class: 'hint' });
    syncs.push(() => {
      const cur = clipById(ed.project, c.id);
      if (!cur) return;
      const lt = localT(cur);
      const here = Object.values(cur.keys || {}).flat().find((k) => Math.abs(k.t - lt) < 1 / 60);
      easeBox.hidden = !here;
      if (here) ease.value = here.ease || 'linear';
      const n = allKeyTimes(cur).length;
      label.textContent = n ? `${n} keyframe${n > 1 ? 's' : ''}` : 'Press ◇ next to a setting to animate it';
    });
    return h('div', { class: 'ins-keynav' }, prev, next, label, easeBox);
  }

  function transform(c) {
    const media = c.type === 'video' || c.type === 'image';
    return section('Transform',
      keyNav(c),
      numRow(c, { label: 'Position X', min: -ed.project.W, max: ed.project.W, prop: 'x', unit: 'px' }),
      numRow(c, { label: 'Position Y', min: -ed.project.H, max: ed.project.H, prop: 'y', unit: 'px' }),
      numRow(c, { label: 'Scale', min: 1, max: 400, prop: 'scale', unit: '%', toView: (v) => v * 100, fromView: (v) => v / 100 }),
      numRow(c, { label: 'Rotation', min: -360, max: 360, prop: 'rotation', unit: '°' }),
      numRow(c, { label: 'Opacity', min: 0, max: 100, prop: 'opacity', unit: '%', toView: (v) => v * 100, fromView: (v) => v / 100 }),
      media ? segRow('Fit', [['contain', 'Fit'], ['cover', 'Fill'], ['none', 'Original']], () => clipById(ed.project, c.id).fit, (v) => change(c.id, (x) => { x.fit = v; })) : null,
      selectRow('Blend', BLENDS, () => clipById(ed.project, c.id).blend, (v) => change(c.id, (x) => { x.blend = v; })),
      h('button', { class: 'linkish', type: 'button', onclick: () => change(c.id, (x) => {
        for (const k of ['x', 'y', 'scale', 'rotation', 'opacity']) { delete x.keys[k]; x.props[k] = k === 'scale' || k === 'opacity' ? 1 : 0; }
      }) }, 'Reset transform'));
  }

  function effects(c) {
    const looks = h('div', { class: 'ins-looks' }, Object.entries(LOOKS).map(([id, l]) => h('button', { type: 'button', class: 'ins-look', 'data-look': id,
      onclick: () => change(c.id, (x) => { x.look = id; }) }, l.label)));
    syncs.push(() => looks.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.look === (clipById(ed.project, c.id)?.look || 'none')))));
    return section('Colour & effects', h('div', { class: 'ins-sub' }, 'Look'), looks,
      ...EFFECT_KEYS.map((k) => numRow(c, { label: EFFECTS[k].label, min: EFFECTS[k].min, max: EFFECTS[k].max,
        get: () => clipById(ed.project, c.id).fx?.[k] || 0, set: (v) => change(c.id, (x) => { x.fx = { ...x.fx, [k]: v }; }, `${c.id}-fx-${k}`) })),
      h('div', { class: 'ins-sub' }, 'Trending'),
      ...TREND_KEYS.filter((k) => !EFFECTS[k].adjustOnly || c.type === 'adjust').map((k) => numRow(c, { label: EFFECTS[k].label, min: EFFECTS[k].min, max: EFFECTS[k].max,
        get: () => clipById(ed.project, c.id).fx?.[k] || 0, set: (v) => change(c.id, (x) => { x.fx = { ...x.fx, [k]: v }; }, `${c.id}-fx-${k}`) })),
      h('button', { class: 'linkish', type: 'button', onclick: () => change(c.id, (x) => { x.fx = {}; x.look = 'none'; }) }, 'Reset colour'));
  }

  function textSection(c) {
    const t = () => clipById(ed.project, c.id).text;
    const setT = (patch, key) => change(c.id, (x) => { x.text = { ...x.text, ...patch }; if (patch.content !== undefined) x.name = patch.content.split('\n')[0].slice(0, 40) || 'Text'; }, key);
    const area = h('textarea', { class: 'input ins-text', rows: 3, 'aria-label': 'Text' });
    area.addEventListener('input', () => setT({ content: area.value }, `${c.id}-text`));
    syncs.push(() => { if (document.activeElement !== area) area.value = t()?.content || ''; });
    const font = fontButton({ value: () => t()?.font, onPick: (id) => setT({ font: id }) });
    syncs.push(() => font.paint());
    return section('Text', area,
      h('div', { class: 'ins-row wide' }, h('label', {}, 'Font'), font),
      numRow(c, { label: 'Size', min: 12, max: 400, get: () => t().size, set: (v) => setT({ size: v }, `${c.id}-size`), unit: 'px' }),
      colorRow('Colour', () => t().color, (v) => setT({ color: v }, `${c.id}-color`)),
      segRow('Align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], () => t().align, (v) => setT({ align: v })),
      numRow(c, { label: 'Line height', min: 0.7, max: 2, step: 0.05, digits: 2, get: () => t().lineHeight, set: (v) => setT({ lineHeight: v }, `${c.id}-lh`) }),
      numRow(c, { label: 'Outline', min: 0, max: 20, get: () => t().outline, set: (v) => setT({ outline: v }, `${c.id}-ol`), unit: 'px' }),
      t().outline ? colorRow('Outline colour', () => t().outlineColor, (v) => setT({ outlineColor: v })) : null,
      numRow(c, { label: 'Shadow', min: 0, max: 100, get: () => t().shadow * 100, set: (v) => setT({ shadow: v / 100 }, `${c.id}-sh`), unit: '%' }),
      switchRow('Background box', () => t().bg, (v) => setT({ bg: v })),
      ...(t().bg ? [
        colorRow('Box colour', () => t().bgColor, (v) => setT({ bgColor: v })),
        numRow(c, { label: 'Box opacity', min: 0, max: 100, get: () => t().bgOpacity * 100, set: (v) => setT({ bgOpacity: v / 100 }, `${c.id}-bgo`), unit: '%' }),
        numRow(c, { label: 'Padding', min: 0, max: 120, get: () => t().pad, set: (v) => setT({ pad: v }, `${c.id}-pad`), unit: 'px' }),
        numRow(c, { label: 'Corners', min: 0, max: 120, get: () => t().radius, set: (v) => setT({ radius: v }, `${c.id}-rad`), unit: 'px' }),
      ] : []),
      selectRow('Animate in', Object.entries(TEXT_ANIMS), () => t().animIn, (v) => setT({ animIn: v })),
      selectRow('Animate out', Object.entries(TEXT_ANIMS).filter(([k]) => k !== 'typewriter'), () => t().animOut, (v) => setT({ animOut: v })));
  }

  function shapeSection(c) {
    const s = () => clipById(ed.project, c.id).shape;
    const setS = (patch, key) => change(c.id, (x) => { x.shape = { ...x.shape, ...patch }; }, key);
    return section('Shape',
      segRow('Shape', [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['full', 'Full frame']], () => s().kind, (v) => setS({ kind: v })),
      colorRow('Fill', () => s().fill, (v) => setS({ fill: v }, `${c.id}-fill`)),
      ...(s().kind !== 'full' ? [
        numRow(c, { label: 'Width', min: 2, max: ed.project.W * 2, get: () => s().w, set: (v) => setS({ w: v }, `${c.id}-w`), unit: 'px' }),
        numRow(c, { label: 'Height', min: 2, max: ed.project.H * 2, get: () => s().h, set: (v) => setS({ h: v }, `${c.id}-h`), unit: 'px' }),
      ] : []),
      s().kind === 'rect' ? numRow(c, { label: 'Corners', min: 0, max: 400, get: () => s().radius, set: (v) => setS({ radius: v }, `${c.id}-r`), unit: 'px' }) : null);
  }

  const toDb = (g) => (g <= 0.001 ? -60 : Math.max(-60, 20 * Math.log10(g)));
  const fromDb = (db) => (db <= -59.9 ? 0 : 10 ** (db / 20));

  function audioSection(c) {
    const a = () => clipById(ed.project, c.id).audio;
    const asset = ed.project.assets[c.asset];
    if (c.type === 'video' && asset?.hasAudio === false) return section('Audio', h('p', { class: 'hint' }, 'This video has no sound.'));
    if (c.type === 'video' && c.audio?.detached) {
      return section('Audio', h('p', { class: 'hint' }, 'The sound of this clip is on its own audio clip.'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => change(c.id, (x, p) => {
          p.clips = p.clips.filter((o) => o.linkedTo !== x.id);
          x.audio = { ...x.audio, detached: false };
        }) }, 'Put the sound back on the video'));
    }
    return section('Audio',
      numRow(c, { label: 'Volume', min: -60, max: 12, step: 0.5, digits: 1, prop: 'volume', unit: 'dB', toView: toDb, fromView: fromDb }),
      numRow(c, { label: 'Fade in', min: 0, max: Math.min(10, c.dur), step: 0.05, digits: 2, get: () => a().fadeIn, set: (v) => change(c.id, (x) => { x.audio = { ...x.audio, fadeIn: v }; }, `${c.id}-fi`), unit: 's' }),
      numRow(c, { label: 'Fade out', min: 0, max: Math.min(10, c.dur), step: 0.05, digits: 2, get: () => a().fadeOut, set: (v) => change(c.id, (x) => { x.audio = { ...x.audio, fadeOut: v }; }, `${c.id}-fo`), unit: 's' }),
      switchRow('Mute this clip', () => a().mute, (v) => change(c.id, (x) => { x.audio = { ...x.audio, mute: v }; })),
      c.type === 'video' ? h('button', { class: 'btn sm', type: 'button', html: `${icon('music')}<span>Separate the sound</span>`, onclick: () => edit((p) => {
        const x = clipById(p, c.id);
        const ac = makeClip('audio', { name: `${x.name} (sound)`, asset: x.asset, dur: x.dur, in: x.in, speed: x.speed,
          audio: { ...x.audio }, keys: x.keys.volume ? { volume: JSON.parse(JSON.stringify(x.keys.volume)) } : {}, props: { volume: x.props.volume }, linkedTo: x.id });
        addClip(p, ac, { track: freeTrack(p, 'audio', x.start, x.dur).id, at: x.start });
        x.audio = { ...x.audio, detached: true };
      }) }) : null);
  }

  function animSection(c) {
    const a = () => clipById(ed.project, c.id)?.anim || {};
    const setA = (patch, key) => change(c.id, (x) => { x.anim = { inDur: 0.5, outDur: 0.4, loopAmt: 50, ...(x.anim || {}), ...patch }; }, key);
    return section('Animation',
      selectRow('In', Object.entries(ANIMS_IN), () => a().in || 'none', (v) => setA({ in: v })),
      a().in && a().in !== 'none' ? numRow(c, { label: 'In length', min: 0.1, max: 3, step: 0.05, digits: 2, get: () => a().inDur ?? 0.5, set: (v) => setA({ inDur: v }, `${c.id}-aid`), unit: 's' }) : null,
      selectRow('Out', Object.entries(ANIMS_IN), () => a().out || 'none', (v) => setA({ out: v })),
      a().out && a().out !== 'none' ? numRow(c, { label: 'Out length', min: 0.1, max: 3, step: 0.05, digits: 2, get: () => a().outDur ?? 0.4, set: (v) => setA({ outDur: v }, `${c.id}-aod`), unit: 's' }) : null,
      selectRow('On screen', Object.entries(ANIMS_LOOP), () => a().loop || 'none', (v) => setA({ loop: v })),
      a().loop && a().loop !== 'none' ? numRow(c, { label: 'Strength', min: 0, max: 150, get: () => a().loopAmt ?? 50, set: (v) => setA({ loopAmt: v }, `${c.id}-ala`), unit: '%' }) : null,
      h('p', { class: 'hint' }, 'Works on top of keyframes and transitions.'));
  }

  function speedSection(c) {
    const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
    return section('Speed',
      h('div', { class: 'ins-speeds' }, speeds.map((s) => {
        const b = h('button', { type: 'button', 'data-s': s, onclick: () => edit((p) => setSpeed(p, c.id, s)) }, `${s}×`);
        syncs.push(() => b.setAttribute('aria-pressed', String(clipById(ed.project, c.id)?.speed === s)));
        return b;
      })),
      numRow(c, { label: 'Custom', min: 0.1, max: 8, step: 0.05, digits: 2, get: () => clipById(ed.project, c.id).speed, set: (v) => edit((p) => setSpeed(p, c.id, v), `${c.id}-speed`), unit: '×' }),
      h('p', { class: 'hint' }, 'The sound speeds up or slows down with the picture.'));
  }

  function transSection(c) {
    const opts = [['', 'None'], ...Object.entries(TRANSITIONS).map(([k, v]) => [k, v.label])];
    const tr = (side) => clipById(ed.project, c.id)?.[side];
    const setTr = (side, patch, key) => change(c.id, (x) => {
      const cur = x[side] || { type: '', dur: 0.5 };
      const next = { ...cur, ...patch };
      x[side] = next.type ? next : null;
    }, key);
    return section('Transitions',
      selectRow('In', opts, () => tr('transIn')?.type || '', (v) => setTr('transIn', { type: v })),
      tr('transIn') ? numRow(c, { label: 'In length', min: 0.1, max: 3, step: 0.05, digits: 2, get: () => tr('transIn').dur, set: (v) => setTr('transIn', { dur: v }, `${c.id}-ti`), unit: 's' }) : null,
      selectRow('Out', opts, () => tr('transOut')?.type || '', (v) => setTr('transOut', { type: v })),
      tr('transOut') ? numRow(c, { label: 'Out length', min: 0.1, max: 3, step: 0.05, digits: 2, get: () => tr('transOut').dur, set: (v) => setTr('transOut', { dur: v }, `${c.id}-to`), unit: 's' }) : null,
      h('p', { class: 'hint' }, 'A transition in, with a clip right before it on the same track, blends the two at the cut. Otherwise it’s an entrance or exit.'));
  }

  function captionsSection(c) {
    const cur = () => clipById(ed.project, c.id);
    const grid = h('div', { class: 'ins-looks' }, TEMPLATES.slice(0, 36).map((t) => h('button', { type: 'button', class: 'ins-look', 'data-id': t.id,
      onclick: () => change(c.id, (x) => { x.style = { ...t.style }; x.templateId = t.id; }) }, t.name)));
    syncs.push(() => grid.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === cur()?.templateId))));
    return section('Captions', h('p', { class: 'hint' }, `${c.captions.length} captions. Pick a style:`), grid);
  }

  function projectSection() {
    const p = ed.project;
    const set = (patch, key) => edit((x) => Object.assign(x, patch), key);
    const name = h('input', { class: 'input', 'aria-label': 'Project name' });
    name.addEventListener('input', () => set({ name: name.value || 'Untitled video' }, 'name'));
    syncs.push(() => { if (document.activeElement !== name) name.value = ed.project.name; });
    return [
      section('Project',
        h('div', { class: 'ins-row wide' }, h('label', {}, 'Name'), name),
        h('div', { class: 'ins-presets' }, PRESETS.map((pr) => {
          const b = h('button', { type: 'button', class: 'ins-preset', onclick: () => set({ W: pr.W, H: pr.H }) },
            h('i', { style: { aspectRatio: `${pr.W} / ${pr.H}` } }), h('b', {}, pr.label), h('small', {}, `${pr.W} × ${pr.H}`));
          syncs.push(() => b.setAttribute('aria-pressed', String(ed.project.W === pr.W && ed.project.H === pr.H)));
          return b;
        })),
        segRow('Frame rate', [['24', '24'], ['25', '25'], ['30', '30'], ['60', '60']], () => String(ed.project.fps), (v) => set({ fps: Number(v) })),
        colorRow('Background', () => ed.project.bg, (v) => set({ bg: v }, 'bg'))),
      section('Shortcuts', h('dl', { class: 'ins-keys' },
        ...[['Space', 'Play / pause'], ['S', 'Split at the playhead'], ['Del', 'Delete'], ['Shift+Del', 'Delete and close the gap'], ['V / C', 'Select / razor tool'],
          ['← →', 'One frame (Shift: one second)'], ['Ctrl+D', 'Duplicate'], ['Ctrl+C / V', 'Copy / paste at the playhead'], ['Ctrl+Z', 'Undo (Ctrl+Shift+Z redo)'],
          ['Ctrl+wheel', 'Zoom the timeline'], ['Double-click a gap', 'Close the gap']].flatMap(([k, d]) => [h('dt', {}, k), h('dd', {}, d)]))),
      h('p', { class: 'hint ins-note' }, `${p.clips.length} clips · ${fmtTime(Math.max(0, ...p.clips.map((c) => c.start + c.dur)))}`),
    ];
  }

  // ---------------------------------------------------------------- build

  function build() {
    syncs = [];
    const sel = selectedClips();
    let kids;
    if (!sel.length) kids = projectSection();
    else if (sel.length > 1) {
      kids = [section(`${sel.length} clips selected`,
        h('p', { class: 'hint' }, 'Drag any of them on the timeline to move them together.'),
        h('div', { class: 'ins-looks' }, Object.entries(LOOKS).map(([id, l]) => h('button', { type: 'button', class: 'ins-look',
          onclick: () => edit((p) => { for (const s of sel) clipById(p, s.id).look = id; }) }, l.label))))];
    } else {
      const c = sel[0];
      const head = h('div', { class: 'ins-head' },
        h('span', { class: `ins-type t-${c.type}` }, TYPE_NAME[c.type]),
        h('b', {}, c.type === 'text' ? 'Text' : c.name),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn ghost xs icon-only', type: 'button', 'aria-label': 'Duplicate', 'data-tip': 'Duplicate (Ctrl+D)', html: icon('copy'),
          onclick: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true })) }),
        h('button', { class: 'btn ghost xs icon-only', type: 'button', 'aria-label': 'Delete', 'data-tip': 'Delete', html: icon('trash'),
          onclick: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })) }));
      kids = [head,
        h('p', { class: 'hint ins-when' }, `${fmtTime(c.start)} – ${fmtTime(c.start + c.dur)} · ${fmtTime(c.dur)}`),
        c.type === 'text' ? textSection(c) : null,
        c.type === 'shape' ? shapeSection(c) : null,
        c.type === 'captions' ? captionsSection(c) : null,
        c.type !== 'audio' && c.type !== 'captions' && c.type !== 'adjust' ? transform(c) : null,
        c.type === 'adjust' ? section('Adjustment layer', h('p', { class: 'hint' }, 'Its colour and effects change everything on the tracks below it while it lasts. Its opacity sets how strongly.'),
          numRow(c, { label: 'Opacity', min: 0, max: 100, prop: 'opacity', unit: '%', toView: (v) => v * 100, fromView: (v) => v / 100 })) : null,
        ['video', 'image', 'text', 'shape', 'adjust'].includes(c.type) ? effects(c) : null,
        ['video', 'image', 'text', 'shape'].includes(c.type) ? animSection(c) : null,
        c.type === 'video' || c.type === 'audio' ? audioSection(c) : null,
        c.type === 'video' || c.type === 'audio' ? speedSection(c) : null,
        c.type !== 'audio' && c.type !== 'captions' ? transSection(c) : null];
    }
    root.replaceChildren(h('div', { class: 'ins-body' }, ...kids.flat().filter(Boolean)));
    syncs.forEach((s) => s());
  }

  // rebuild when what's shown changes shape; otherwise refresh values
  const shapeOf = () => {
    const sel = selectedClips();
    if (sel.length !== 1) return `${sel.length}|${sel.map((c) => c.id).join()}|${ed.project?.W}x${ed.project?.H}`;
    const c = sel[0];
    return [c.id, c.type, c.text?.bg, c.text?.outline ? 1 : 0, c.shape?.kind, !!c.transIn, !!c.transOut, c.audio?.detached, c.captions?.length,
      c.anim?.in, c.anim?.out, c.anim?.loop].join('|');
  };
  // values are refreshed at most once a frame, and a few times a second while playing
  let queued = false, lastPlaySync = 0;
  const syncSoon = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; syncs.forEach((f) => f()); });
  };
  on((what) => {
    if (!ed.project) return;
    if (['selection', 'open', 'project'].includes(what)) {
      const s = shapeOf();
      if (s !== shape || what !== 'project') { shape = s; build(); } else syncSoon();
    } else if (what === 'time') {
      if (ed.playing && performance.now() - lastPlaySync < 150) return;
      lastPlaySync = performance.now();
      syncSoon();
    }
  });
  return { build };
}
