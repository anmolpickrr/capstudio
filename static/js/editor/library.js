// The library on the left: your media, text styles, shapes, transitions, looks and
// captions. Everything can be clicked (added at the playhead) or dragged onto
// the timeline.
import { cssFamily, ensureFonts, fontById } from '../engine/fonts.js';
import { icon } from '../app/icons.js';
import { fmtTime, h, toast } from '../app/ui.js';
import { ANIMS_IN, ANIMS_LOOP, LOOKS, TRANSITION_STYLES, TRANSITIONS, TREND_PRESETS } from './model.js';
import { addAdjustment, addAsset, addShape, addText, applyLook, applyTransition, applyTrend, SHAPES, TEXT_PRESETS } from './actions.js';
import { animateSelection, animateTitles, applyTransitionStyle, clearBeats, cutToBeat, detectBeats, kenBurnsPhotos, removeTransitions } from './auto.js';
import { importFiles, thumbnails } from './media.js';
import { ed, edit, on } from './store.js';

const TABS = [
  ['media', 'Media', 'film'], ['text', 'Text', 'text'], ['shapes', 'Shapes', 'shapes'],
  ['transitions', 'Transitions', 'transition'], ['effects', 'Effects', 'effects'], ['animate', 'Animate', 'motion'],
  ['auto', 'Auto', 'wand'], ['captions', 'Captions', 'captions'],
];

export function mountLibrary(root, { captionsPanel }) {
  let tab = 'media';
  const nav = h('nav', { class: 'lib-tabs', role: 'tablist' }, TABS.map(([id, label, ico]) => h('button', {
    type: 'button', role: 'tab', 'data-tab': id, html: `${icon(ico)}<span>${label}</span>`, onclick: () => switchTo(id),
  })));
  const body = h('div', { class: 'lib-body' });
  // each tab keeps its scroll position
  const scrolls = {};
  const switchTo = (id) => { scrolls[tab] = body.scrollTop; tab = id; render(); body.scrollTop = scrolls[id] || 0; };
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
      h('div', { class: 'lib-grid tiles small' }, Object.entries(TRANSITIONS).map(([id, t]) => drag(h('button', { type: 'button', class: `lib-tile trans${t.trend ? ' trend' : ''}`, onclick: () => applyTransition(id) },
        h('i', { class: `lib-trans ${id.split('-')[0]} ${id.split('-')[1] || ''} t-${id}` }, h('b'), h('b')), h('small', {}, t.label)), { kind: 'transition', id }))),
      h('button', { class: 'linkish', type: 'button', onclick: () => switchTo('auto') }, 'Put a transition on every cut at once →')];
  }

  function effectsTab() {
    return [
      h('h4', { class: 'lib-h' }, 'Trending effects'),
      h('p', { class: 'hint' }, 'On the selected clips; with nothing selected, on the whole video (as an adjustment layer).'),
      h('div', { class: 'lib-grid tiles small' }, Object.entries(TREND_PRESETS).map(([id, t]) => h('button', { type: 'button', class: `lib-tile fx fx-${id}`, onclick: () => applyTrend(id) },
        h('i', { class: 'lib-fx' }), h('small', {}, t.label)))),
      h('h4', { class: 'lib-h' }, 'Colour looks'),
      h('div', { class: 'lib-grid tiles small' }, Object.entries(LOOKS).map(([id, l]) => h('button', { type: 'button', class: 'lib-tile look', onclick: () => applyLook(id) },
        h('i', { class: 'lib-look', style: { filter: cssLook(l.fx) } }), h('small', {}, l.label)))),
      h('h4', { class: 'lib-h' }, 'Adjustment layers'),
      h('p', { class: 'hint' }, 'A layer whose colour and effects change everything on the tracks below it, for as long as it lasts.'),
      h('div', { class: 'lib-grid tiles' },
        h('button', { type: 'button', class: 'lib-tile', onclick: () => addAdjustment() }, h('i', { class: 'lib-adjust' }), h('small', {}, 'Adjustment layer')),
        h('button', { type: 'button', class: 'lib-tile', onclick: () => addAdjustment({ bars: 70 }, 'Cinema bars', !ed.selection.length) }, h('i', { class: 'lib-adjust bars' }), h('small', {}, 'Cinema bars'))),
    ];
  }

  function animateTab() {
    const tiles = (list, key, skip = 'none') => h('div', { class: 'lib-grid tiles small' }, Object.entries(list).filter(([k]) => k !== skip).map(([id, label]) =>
      h('button', { type: 'button', class: 'lib-tile anim', onclick: () => { const n = animateSelection({ [key]: id }); if (n) toast(`${label} on ${n} clip${n > 1 ? 's' : ''}.`, 'ok', 1400); } },
        h('i', { class: `lib-anim a-${key}-${id}` }, h('b')), h('small', {}, label.replace(/ \(.*\)/, '')))));
    return [
      h('p', { class: 'hint' }, 'Select clips on the timeline, then pick how they come in, go out, and move while on screen. Hover to preview.'),
      h('h4', { class: 'lib-h' }, 'In'), tiles(ANIMS_IN, 'in'),
      h('h4', { class: 'lib-h' }, 'Out'), tiles(ANIMS_IN, 'out'),
      h('h4', { class: 'lib-h' }, 'While on screen'), tiles(ANIMS_LOOP, 'loop'),
      h('button', { class: 'linkish', type: 'button', onclick: () => animateSelection({ in: 'none', out: 'none', loop: 'none' }) }, 'Remove animations from the selected clips'),
    ];
  }

  function autoTab() {
    const ends = h('label', { class: 'checkline' }, h('input', { type: 'checkbox' }), h('span', {}, 'Also fade in at the start and out at the end'));
    const beatInfo = h('p', { class: 'hint' }, ed.project.beats ? `${ed.project.beats.bpm} BPM · ${ed.project.beats.times.length} beats marked on the timeline` : 'Finds the beat of your music, marks it on the timeline and makes clips snap to it.');
    let every = 2;
    const everySeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Cut every' }, [[1, 'Every beat'], [2, 'Every 2'], [4, 'Every 4']].map(([v, t]) =>
      h('button', { type: 'button', 'aria-pressed': String(v === every), onclick: (e) => { every = v; everySeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t)));
    const find = h('button', { class: 'btn', type: 'button', html: `${icon('music')}<span>Find the beat</span>`, onclick: async () => {
      find.disabled = true; beatInfo.textContent = 'Listening…';
      try { const r = await detectBeats(ed.selection[0]); toast(`${r.bpm} BPM: ${r.beats.length} beats marked.`, 'ok', 3000); } catch (e) { toast(e.message, 'error', 5000); }
      find.disabled = false; render();
    } });
    return [
      h('h4', { class: 'lib-h' }, 'A transition on every cut'),
      h('p', { class: 'hint' }, 'One click styles every cut in the edit. Ctrl+Z undoes it.'),
      h('div', { class: 'lib-grid tiles' }, Object.entries(TRANSITION_STYLES).map(([id, st]) => h('button', { type: 'button', class: 'lib-tile style', onclick: () => {
        const n = applyTransitionStyle(id, { ends: ends.querySelector('input').checked });
        toast(n ? `${st.label}: ${n} cut${n > 1 ? 's' : ''} styled.` : 'No cuts yet: put clips end to end on a track.', n ? 'ok' : 'info', 2400);
      } }, h('b', {}, st.label), h('small', {}, st.note)))),
      ends,
      h('button', { class: 'linkish', type: 'button', onclick: removeTransitions }, 'Remove all transitions'),
      h('h4', { class: 'lib-h' }, 'Cut to the music'),
      beatInfo, find,
      ed.project.beats ? h('div', { class: 'lib-beats' }, everySeg,
        h('button', { class: 'btn brand', type: 'button', html: `${icon('scissors')}<span>Cut the main track to the beat</span>`, onclick: () => {
          try { const n = cutToBeat(every); toast(`${n} clip${n === 1 ? '' : 's'} cut to the beat.`, 'ok', 2500); } catch (e) { toast(e.message, 'error', 5000); }
        } }),
        h('button', { class: 'linkish', type: 'button', onclick: () => { clearBeats(); render(); } }, 'Clear the beat markers')) : null,
      h('h4', { class: 'lib-h' }, 'Motion everywhere'),
      h('div', { class: 'lib-grid tiles' },
        h('button', { type: 'button', class: 'lib-tile style', onclick: () => { const n = kenBurnsPhotos(); toast(n ? `Slow zoom on ${n} photo${n > 1 ? 's' : ''}.` : 'No photos on the timeline.', n ? 'ok' : 'info', 2000); } },
          h('b', {}, 'Ken Burns'), h('small', {}, 'Slow zoom on every photo')),
        h('button', { type: 'button', class: 'lib-tile style', onclick: () => { const n = animateTitles(); toast(n ? `${n} title${n > 1 ? 's' : ''} animated.` : 'No titles on the timeline.', n ? 'ok' : 'info', 2000); } },
          h('b', {}, 'Animate titles'), h('small', {}, 'Pop in, fade out'))),
      h('button', { class: 'linkish', type: 'button', onclick: () => switchTo('captions') }, 'Caption the edit automatically →'),
    ];
  }

  function render() {
    nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const kids = { media: mediaTab, text: textTab, shapes: shapesTab, transitions: transitionsTab, effects: effectsTab, animate: animateTab, auto: autoTab, captions: captionsPanel }[tab]();
    body.replaceChildren(...[kids].flat().filter(Boolean));
  }

  // the media grid is rebuilt only when the media or what's used changes (not on every edit)
  let mediaKey = '';
  const keyOfMedia = () => `${Object.keys(ed.project.assets).join()}|${[...new Set(ed.project.clips.map((c) => c.asset))].join()}`;
  on((what) => {
    if (['open', 'assets'].includes(what)) { mediaKey = keyOfMedia(); render(); return; }
    if (what === 'project' && tab === 'media') { const k = keyOfMedia(); if (k !== mediaKey) { mediaKey = k; render(); } }
  });
  render();
  return { importInto, show: switchTo };
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
