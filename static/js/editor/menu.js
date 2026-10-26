// A right-click menu: items with an optional shortcut hint, separators (null) and
// rows of small buttons. Closes on a click elsewhere, Escape or a scroll.
import { h } from '../app/ui.js';

let open = null;

export function closeMenu() {
  if (!open) return;
  open.el.remove();
  removeEventListener('pointerdown', open.away, true);
  removeEventListener('keydown', open.key, true);
  removeEventListener('wheel', open.away, true);
  open = null;
}

// items: [{ label, hint, run, disabled }] | null | { row: [{ label, run, on }] }
export function openMenu(x, y, items) {
  closeMenu();
  const el = h('div', { class: 'ctx-menu', role: 'menu' }, items.map((it) => {
    if (!it) return h('div', { class: 'ctx-sep', role: 'separator' });
    if (it.row) {
      return h('div', { class: 'ctx-row' }, it.title ? h('span', {}, it.title) : null, it.row.map((r) => h('button', {
        type: 'button', class: r.on ? 'on' : null, onclick: () => { closeMenu(); r.run(); } }, r.label)));
    }
    return h('button', { type: 'button', role: 'menuitem', disabled: it.disabled ? true : null, onclick: () => { closeMenu(); it.run(); } },
      h('span', {}, it.label), it.hint ? h('kbd', {}, it.hint) : null);
  }));
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(6, Math.min(x, innerWidth - r.width - 6))}px`;
  el.style.top = `${Math.max(6, Math.min(y, innerHeight - r.height - 6))}px`;
  const away = (e) => { if (!el.contains(e.target)) closeMenu(); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
  addEventListener('pointerdown', away, true);
  addEventListener('keydown', key, true);
  addEventListener('wheel', away, true);
  open = { el, away, key };
  el.querySelector('button:not([disabled])')?.focus();
}
