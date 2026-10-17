// Shared panel scaffolding: a header, a scrolling body, and a rebuild when the
// set of visible controls depends on a style value ("shape").
import { Controls, h } from '../ui.js';

export function stylePanel({ title, shape = () => '', build, extraUpdate }) {
  let root = null, body = null, ctrls = null, lastShape = null, pending = false;
  const rebuild = () => {
    ctrls = new Controls();
    lastShape = shape();
    body.replaceChildren(...build(ctrls));
  };
  return {
    mount(container) {
      body = h('div', { class: 'panel-body' });
      body.addEventListener('change', () => {
        if (!pending) return;
        pending = false;
        const top = body.scrollTop; rebuild(); body.scrollTop = top;
      });
      root = h('div', { style: { display: 'contents' } }, h('div', { class: 'panel-head' }, h('h2', {}, title)), body);
      container.replaceChildren(root);
      rebuild();
    },
    unmount() { root = null; },
    update(what) {
      if (!root) return;
      if (shape() !== lastShape) {
        // Don't pull a slider out from under the pointer: rebuild on release.
        const a = document.activeElement;
        if (a?.type === 'range' && body.contains(a)) { pending = true; ctrls.sync(); }
        else { const top = body.scrollTop; rebuild(); body.scrollTop = top; }
      } else ctrls.sync();
      extraUpdate?.(what);
    },
  };
}
