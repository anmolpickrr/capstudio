// The library on the left: your media, text styles, shapes, transitions, looks and
// captions. Everything can be clicked (added at the playhead) or dragged onto
// the timeline.
import { cssFamily, ensureFonts, fontById } from '../engine/fonts.js';
import { icon } from '../app/icons.js';
import { fmtTime, h, toast } from '../app/ui.js';
import { LOOKS, TRANSITIONS } from './model.js';
import { addAsset, addShape, addText, applyLook, applyTransition, SHAPES, TEXT_PRESETS } from './actions.js';
import { importFiles, thumbnails } from './media.js';
import { ed, edit, on } from './store.js';

const TABS = [
  ['media', 'Media', 'film'], ['text', 'Text', 'text'], ['shapes', 'Shapes', 'shapes'],
  ['transitions', 'Transitions', 'transition'], ['looks', 'Looks', 'effects'], ['captions', 'Captions', 'captions'],
];

export function mountLibrary(root, { captionsPanel }) {
  let tab = 'media';
  const nav = h('nav', { class: 'lib-tabs', role: 'tablist' }, TABS.map(([id, label, ico]) => h('button', {
    type: 'button', role: 'tab', 'data-tab': id, html: `${icon(ico)}<span>${label}</span>`, onclick: () => { tab = id; render(); },
  })));
  const body = h('div', { class: 'lib-body' });
  root.replaceChildren(nav, body);

  const drag = (el, data) => {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-capstudio', JSON.stringify(data));
      e.dataTransfer.effectAllowed = 'copy';
    });
    return el;
  };

  // ---------------------------------------------------------------- media

  const picker = h('input', { type: 'file', multiple: true, accept: 'video/*,audio/*,image/*', hidden: true });
  picker.addEventListener('change', () => { importInto([...picker.files]); picker.value = ''; });
  root.append(picker);

  async function importInto(files) {
    if (!files.length) return;
    toast(`Adding ${files.length} file${files.length > 1 ? 's' : ''}…`, 'info', 1500);
    const { added, skipped } = await importFiles(files);
    if (added.length) edit((p) => { for (const a of added) p.assets[a.id] = a; });
    if (skipped.length) toast(`Couldn’t add: ${skipped.join('; ')}`, 'error', 8000);
    tab = 'media';
    render();
    return added;
  }

  function mediaTab() {
    const assets = Object.values(ed.project.assets).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const used = new Set(ed.project.clips.map((c) => c.asset));
    const grid = h('div', { class: 'lib-grid media' }, assets.map((a) => {
      const thumb = h('div', { class: `lib-thumb k-${a.kind}`, html: a.kind === 'audio' ? icon('music') : '' });
      if (a.kind !== 'audio') thumbnails(a, 90).then((ts) => { if (ts[0]) { const cv = h('canvas', { width: ts[0].img.width, height: ts[0].img.height }); cv.getContext('2d').drawImage(ts[0].img, 0, 0); thumb.replaceChildren(cv); } });
      const card = h('div', { class: `lib-card${used.has(a.id) ? ' used' : ''}`, title: `${a.name}${a.width ? ` · ${a.width}×${a.height}` : ''}` },
        thumb,
        a.duration ? h('span', { class: 'lib-dur' }, fmtTime(a.duration, 0)) : null,
        h('span', { class: 'lib-name' }, a.name),
        h('button', { class: 'lib-add', type: 'button', 'aria-label': `Add ${a.name} at the playhead`, html: icon('plus'), onclick: () => addAsset(a) }),
        h('button', { class: 'lib-remove', type: 'button', 'aria-label': `Remove ${a.name}`, html: icon('close'), onclick: () => {
          const n = ed.project.clips.filter((c) => c.asset === a.id).length;
          if (n && !confirm(`${a.name} is used by ${n} clip${n > 1 ? 's' : ''}. Remove it and ${n > 1 ? 'them' : 'it'}?`)) return;
          edit((p) => { p.clips = p.clips.filter((c) => c.asset !== a.id); delete p.assets[a.id]; });
        } }));
      card.addEventListener('dblclick', () => addAsset(a));
      return drag(card, { kind: 'asset', id: a.id });
    }));
    return [
      h('button', { class: 'btn brand lib-import', type: 'button', html: `${icon('upload')}<span>Import media</span>`, onclick: () => picker.click() }),
      h('p', { class: 'hint' }, 'Videos, music, voice-overs and images. Or drop files anywhere in the editor. They stay in this browser with the project.'),
      assets.length ? grid : h('div', { class: 'lib-empty', html: `${icon('film')}<p>No media yet</p>` }),
    ];
  }

  // ---------------------------------------------------------------- text, shapes

  function textTab() {
    ensureFonts(TEXT_PRESETS.map((p) => fontById(p.text.font)));
    return [h('p', { class: 'hint' }, 'Click to add at the playhead, or drag onto the timeline. Edit the words and style on the right.'),
      h('div', { class: 'lib-grid tiles' }, TEXT_PRESETS.map((pr) => drag(h('button', { type: 'button', class: 'lib-tile text', onclick: () => addText(pr) },
        h('span', { class: 'lib-sample', style: { fontFamily: cssFamily(fontById(pr.text.font)), color: pr.text.bg ? pr.text.color || '#fff' : pr.text.color || '#fff',
          background: pr.text.bg ? pr.text.bgColor : 'none', WebkitTextStroke: pr.text.outline ? `1px ${pr.text.outlineColor}` : null } }, pr.sample),
        h('small', {}, pr.label)), { kind: 'text', id: pr.id })))];
  }

  function shapesTab() {
    return [h('p', { class: 'hint' }, 'Boxes, bars and colour fills for backgrounds, highlights and lower thirds.'),
      h('div', { class: 'lib-grid tiles' }, SHAPES.map((s) => drag(h('button', { type: 'button', class: 'lib-tile', onclick: () => addShape(s) },
        h('i', { class: `lib-shape ${s.id}`, style: { background: s.shape.fill } }), h('small', {}, s.label)), { kind: 'shape', id: s.id })))];
  }

  function transitionsTab() {
    return [h('p', { class: 'hint' }, 'Select a clip and click a transition, or drag one onto a clip. It plays at the clip’s start, blending with the clip before it.'),
      h('div', { class: 'lib-grid tiles small' }, Object.entries(TRANSITIONS).map(([id, t]) => drag(h('button', { type: 'button', class: 'lib-tile trans', onclick: () => applyTransition(id) },
        h('i', { class: `lib-trans ${id.split('-')[0]} ${id.split('-')[1] || ''}` }, h('b'), h('b')), h('small', {}, t.label)), { kind: 'transition', id })))];
  }

  function looksTab() {
    return [h('p', { class: 'hint' }, 'Colour looks for the selected clips. Fine-tune exposure, contrast, temperature and more on the right.'),
      h('div', { class: 'lib-grid tiles small' }, Object.entries(LOOKS).map(([id, l]) => h('button', { type: 'button', class: 'lib-tile look', onclick: () => applyLook(id) },
        h('i', { class: 'lib-look', style: { filter: cssLook(l.fx) } }), h('small', {}, l.label))))];
  }

  function render() {
    nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const kids = { media: mediaTab, text: textTab, shapes: shapesTab, transitions: transitionsTab, looks: looksTab, captions: captionsPanel }[tab]();
    body.replaceChildren(...[kids].flat().filter(Boolean));
  }

  on((what) => { if (['open', 'assets'].includes(what) || (what === 'project' && tab === 'media')) render(); });
  render();
  return { importInto, show: (t) => { tab = t; render(); } };
}

// An approximation of a look as a CSS filter, for its swatch.
function cssLook(fx) {
  const p = [];
  if (fx.exposure) p.push(`brightness(${(100 + fx.exposure) / 100})`);
  if (fx.contrast) p.push(`contrast(${(100 + fx.contrast) / 100})`);
  if (fx.saturation) p.push(`saturate(${(100 + fx.saturation) / 100})`);
  if (fx.mono) p.push(`grayscale(${fx.mono / 100})`);
  if (fx.temperature > 0) p.push(`sepia(${fx.temperature / 200})`);
  if (fx.temperature < 0) p.push(`hue-rotate(${fx.temperature / 4}deg)`);
  return p.join(' ') || 'none';
}
