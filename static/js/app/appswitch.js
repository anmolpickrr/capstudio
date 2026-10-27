// The switch between Capstudio's two workspaces, Captions and Editor, in the
// header of both. Each side is a real link (so it opens in a new tab too); a
// plain click hands over to `go`, which carries the current work across.
import { icon } from './icons.js';
import { h } from './ui.js';

export function appSwitch(active, { captions, editor } = {}) {
  const item = (id, label, ico, href, go) => h('a', {
    class: 'app-switch-item', href, 'data-app': id, 'aria-current': id === active ? 'page' : null,
    html: `${icon(ico)}<span>${label}</span>`,
    onclick: (e) => {
      if (id === active) { e.preventDefault(); return; }
      if (!go || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      go();
    },
  });
  return h('nav', { class: 'app-switch', 'aria-label': 'Workspace', 'data-active': active },
    item('captions', 'Captions', 'captions', '/', captions),
    item('editor', 'Editor', 'editor', '/edit', editor),
    h('i', { class: 'app-switch-glider', 'aria-hidden': 'true' }));
}

// Leave for the other workspace, with a cross-fade where the browser has it.
export function goTo(url) {
  document.documentElement.classList.add('leaving');
  location.href = url;
}
