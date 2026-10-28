// Small UI building blocks. Controls bound to a style key read their value from
// the store and write edits back through setStyle (which records undo steps).
import { icon } from './icons.js';
import { setStyle, state } from './store.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

// Controls register an update() so a panel can refresh values without rebuilding.
export class Controls {
  constructor() { this.updates = []; }
  add(el, update) { if (update) { this.updates.push(update); update(); } return el; }
  sync() { this.updates.forEach((u) => u()); }
}

const fmtDefault = (v) => (Math.round(v * 100) / 100).toString();

export function slider(ctrls, { label, key, min, max, step = 1, format = fmtDefault, disabled }) {
  const input = h('input', { type: 'range', class: 'range', min, max, step, 'aria-label': label });
  const value = h('span', { class: 'value' });
  const el = h('label', { class: 'field has-range' }, h('span', { class: 'label' }, label, value), input);
  const paint = () => {
    const v = Number(input.value);
    input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    value.textContent = format(v);
  };
  input.addEventListener('input', () => { setStyle({ [key]: Number(input.value) }, `slider:${key}`); paint(); });
  return ctrls.add(el, () => {
    if (document.activeElement !== input) input.value = state.style[key];
    input.disabled = !!disabled?.();
    paint();
  });
}

const SWATCHES = ['#FFFFFF', '#111111', '#FFE14D', '#FF9F1C', '#FF4D4D', '#FF4FD8', '#7C5CFF', '#4F6BFF', '#00E5FF', '#3DFF7A', '#C6FF3D', '#F4EBDD'];

export function colorField(ctrls, { label, key, swatches = true }) {
  const input = h('input', { type: 'color', 'aria-label': label });
  const sw = h('span', { class: 'swatch' });
  const hex = h('span', { class: 'hex' });
  const box = h('label', { class: 'color' }, sw, hex, input);
  input.addEventListener('input', () => setStyle({ [key]: input.value.toUpperCase() }, `color:${key}`));
  const row = swatches ? h('div', { class: 'swatches' }, SWATCHES.map((c) => h('button', {
    type: 'button', style: { background: c }, 'aria-label': c, title: c,
    onclick: () => setStyle({ [key]: c }),
  }))) : null;
  const el = h('div', { class: 'field' }, h('span', { class: 'label' }, label), box, row);
  return ctrls.add(el, () => {
    const v = state.style[key] || '#000000';
    input.value = v.toLowerCase(); sw.style.background = v; hex.textContent = v;
    row?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.title.toUpperCase() === v.toUpperCase())));
  });
}

export function segmented(ctrls, { label, key, options, onChange }) {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': label || key });
  for (const [value, text, ico, tip] of options) {
    seg.append(h('button', {
      type: 'button', 'data-v': String(value), 'data-tip': tip, html: `${ico ? icon(ico) : ''}${text ? `<span>${text}</span>` : ''}`,
      'aria-label': text || tip,
      onclick: () => (onChange ? onChange(value) : setStyle({ [key]: value })),
    }));
  }
  const el = label ? h('div', { class: 'field' }, h('span', { class: 'label' }, label), seg) : seg;
  return ctrls.add(el, () => {
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(state.style[key]))));
  });
}

export function toggle(ctrls, { label, key, on = true, off = false }) {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.addEventListener('change', () => setStyle({ [key]: input.checked ? on : off }));
  const el = h('label', { class: 'switch' }, h('span', {}, label), input);
  return ctrls.add(el, () => { input.checked = state.style[key] === on || (on === true && !!state.style[key] && state.style[key] !== off); });
}

export function selectField(ctrls, { label, key, options }) {
  const sel = h('select', { class: 'select', 'aria-label': label },
    options.map(([v, t]) => h('option', { value: v }, t)));
  sel.addEventListener('change', () => setStyle({ [key]: sel.value }));
  const el = h('label', { class: 'field' }, h('span', { class: 'label' }, label), sel);
  return ctrls.add(el, () => { sel.value = state.style[key]; });
}

export function section(title, ...children) {
  return h('section', { class: 'section' }, title ? h('h3', {}, title) : null, ...children);
}

export function more(title, ...children) {
  return h('details', { class: 'more' }, h('summary', { html: `${icon('chevron')}${title}` }), h('div', { class: 'more-body' }, ...children));
}

// ---------------------------------------------------------------- toasts
export function toast(message, kind = 'info', ms = 4000) {
  let host = $('.toasts');
  if (!host) { host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  const ico = kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info';
  const t = h('div', { class: `toast ${kind}`, html: `${icon(ico)}<span></span>` });
  t.querySelector('span').textContent = message;
  host.append(t);
  setTimeout(() => t.remove(), ms);
}

export const fmtTime = (s, dec = 2) => {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(dec).padStart(dec ? 3 + dec : 2, '0');
  return `${m}:${sec}`;
};

export function parseTime(v) {
  const parts = String(v).trim().split(':').map(Number);
  if (!parts.length || parts.some(Number.isNaN)) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function download(name, text, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
