// Actions on one caption, shared by the timeline, the preview and keyboard
// shortcuts: delete, edit its text, and make it bigger or smaller.
import { emit, set, setCaptions, state } from './store.js';
import { toast } from './ui.js';

export const SCALE_MIN = 0.5, SCALE_MAX = 2.5, SCALE_STEP = 0.1;

const byId = (id) => state.captions.find((c) => c.id === id);

export function deleteCaption(id = state.selected) {
  const i = state.captions.findIndex((c) => c.id === id);
  if (i < 0) return;
  setCaptions(state.captions.filter((c) => c.id !== id), `delete-${id}`);
  // keep a selection so Delete can be pressed again
  const next = state.captions[Math.min(i, state.captions.length - 1)];
  state.selected = next?.id || null;
  emit('selection');
  toast('Caption deleted. Press Ctrl+Z to bring it back.', 'ok', 2500);
}

// Open the Captions panel with this caption's text ready to type in.
export function editCaption(id = state.selected) {
  if (!byId(id)) return;
  state.selected = id;
  set({ tool: 'captions' }, 'tool');
  emit('selection');
  setTimeout(() => {
    const box = document.querySelector(`.cap[data-id="${id}"] textarea`);
    if (!box) return;
    box.scrollIntoView({ block: 'nearest' });
    box.focus();
    box.select();
  }, 60);
}

export function captionScale(id = state.selected) {
  return byId(id)?.scale || 1;
}

export function scaleCaption(delta, id = state.selected) {
  const c = byId(id);
  if (!c) return;
  const next = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, (c.scale || 1) + delta)) * 10) / 10;
  if (next === (c.scale || 1)) return;
  setCaptions(state.captions.map((x) => (x.id === id ? { ...x, scale: next === 1 ? undefined : next } : x)), `scale-${id}`);
}
