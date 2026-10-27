// The phone view of the preview: an iPhone screen at its real proportions (393 × 852
// points) with the status bar, the Dynamic Island, and the app's own interface around
// the video: Instagram or Facebook Reels, YouTube Shorts, TikTok, or a story. Sizes
// are in points, drawn with --u (one point in pixels), so the interface sits where it
// does on a real phone at any size. The video fills the space the app gives it (it's
// cropped a little at the sides, as in the apps), and the live captions move with it.
import { h } from './ui.js';

export const SCREEN = { w: 393, h: 852 };
const NAV = 83;       // bottom navigation, with the home indicator
const STATUS = 54;    // status bar

// where each app shows the video: { top, bottom } insets in points, and its style
export const PLATFORMS = {
  'ig-reels': { kind: 'reels', name: 'Reels', top: 0, bottom: NAV },
  'fb-reels': { kind: 'reels', name: 'Reels', top: 0, bottom: NAV },
  'yt-shorts': { kind: 'shorts', name: 'Shorts', top: 0, bottom: NAV },
  tiktok: { kind: 'tiktok', name: 'For You', top: 0, bottom: NAV },
  'ig-stories': { kind: 'story', name: 'Stories', top: STATUS, bottom: 82 },
  'fb-stories': { kind: 'story', name: 'Stories', top: STATUS, bottom: 82 },
  whatsapp: { kind: 'story', name: 'Status', top: STATUS, bottom: 82 },
};
export const platformOf = (zoneId) => PLATFORMS[zoneId] ? zoneId : 'ig-reels';

// Where the video goes on the screen (in points): filling the app's space, or, for a
// video much wider than it, fitted across it (as the apps do with landscape videos).
export function videoBox(platform, W, H) {
  const p = PLATFORMS[platform];
  const area = { x: 0, y: p.top, w: SCREEN.w, h: SCREEN.h - p.top - p.bottom };
  const wide = W / H > (area.w / area.h) * 1.25;
  const k = wide ? Math.min(area.w / W, area.h / H) : Math.max(area.w / W, area.h / H);
  const w = W * k, hh = H * k;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - hh) / 2, w, h: hh, area };
}

const I = {
  heart: '<path d="M12 20.5s-7.5-4.6-7.5-10.4A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.7c0 5.8-7.5 10.4-7.5 10.4z"/>',
  heartFill: '<path fill="currentColor" stroke="none" d="M12 21s-8-4.9-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 6.1-8 11-8 11z"/>',
  comment: '<path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.3L3.5 20.5l1.6-4.4A8.4 8.4 0 1 1 20.5 11.6z"/>',
  commentFill: '<path fill="currentColor" stroke="none" d="M12 3.2c-5 0-9 3.5-9 7.9 0 2.4 1.2 4.6 3.1 6l-.6 3.7 3.9-2.1c.8.2 1.7.3 2.6.3 5 0 9-3.5 9-7.9s-4-7.9-9-7.9z"/>',
  send: '<path d="M21.5 3.5 10.6 13.4M21.5 3.5l-6.9 17.3-4-7.4-7.4-4z"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  moreV: '<circle cx="12" cy="5.5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="18.5" r="1.4" fill="currentColor"/>',
  camera: '<rect x="3" y="6.5" width="18" height="13.5" rx="3.5"/><circle cx="12" cy="13.2" r="3.6"/><path d="M8.5 6.5 10 4h4l1.5 2.5"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
  homeFill: '<path fill="currentColor" stroke="none" d="M12 3.5 3.5 10.4V20a1.5 1.5 0 0 0 1.5 1.5h4.5v-6h5v6H19a1.5 1.5 0 0 0 1.5-1.5v-9.6z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  plusSq: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M12 8v8M8 12h8"/>',
  reels: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M3.5 8.5h17M8.5 3.5l3 5M14 3.5l3 5"/><path fill="currentColor" stroke="none" d="M10.5 11.5v5l4.3-2.5z"/>',
  bookmark: '<path fill="currentColor" stroke="none" d="M6 3.5h12a1 1 0 0 1 1 1v16.2l-7-4.4-7 4.4V4.5a1 1 0 0 1 1-1z"/>',
  shareFill: '<path fill="currentColor" stroke="none" d="M13.5 4.5 21 11.6l-7.5 7.1v-4.2c-5.1-.1-8.3 1.4-10.5 5 .6-5.6 3.8-9.5 10.5-10.2z"/>',
  thumbUp: '<path fill="currentColor" stroke="none" d="M3 10h3.5v10.5H3zM8.5 20.5V10l4.6-6.4c.5-.7 1.7-.4 1.9.5.2.9.1 1.8-.2 2.6L14 10h5.6c1.2 0 2.1 1.2 1.8 2.4l-1.8 6.6c-.3 1-1.1 1.5-2.1 1.5z"/>',
  thumbDown: '<path fill="currentColor" stroke="none" d="M21 14h-3.5V3.5H21zM15.5 3.5V14l-4.6 6.4c-.5.7-1.7.4-1.9-.5-.2-.9-.1-1.8.2-2.6L10 14H4.4c-1.2 0-2.1-1.2-1.8-2.4l1.8-6.6c.3-1 1.1-1.5 2.1-1.5z"/>',
  remix: '<path d="M7 7h9a4 4 0 0 1 0 8h-1M17 17H8a4 4 0 0 1 0-8h1"/><path d="m14 4 3 3-3 3M10 14l-3 3 3 3"/>',
  shorts: '<path fill="currentColor" stroke="none" d="M16.6 2.8c1.9-1 4.3-.3 5.3 1.6 1 1.9.3 4.3-1.6 5.3l-1.4.8c1.2.1 2.3.8 2.9 1.9 1 1.9.3 4.3-1.6 5.3l-8.6 4.6c-1.9 1-4.3.3-5.3-1.6-1-1.9-.3-4.3 1.6-5.3l1.4-.8c-1.2-.1-2.3-.8-2.9-1.9-1-1.9-.3-4.3 1.6-5.3z"/><path fill="#000" stroke="none" d="m10 8.8 5.2 3.2-5.2 3.2z"/>',
  subs: '<rect x="3.5" y="7.5" width="17" height="13" rx="2.5"/><path d="M6 4.5h12M8 2h8"/><path fill="currentColor" stroke="none" d="M10.5 11v6l5-3z"/>',
  you: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  friends: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16 14.5a5 5 0 0 1 6 5"/>',
  inbox: '<path d="M4 6.5h16v11H4z"/><path d="M4 13.5h4.5l1.5 2h4l1.5-2H20"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  signal: '<path fill="currentColor" stroke="none" d="M2 16h3v4H2zM7 12h3v8H7zM12 8h3v12h-3zM17 4h3v16h-3z"/>',
  wifi: '<path d="M2.5 9.5a14 14 0 0 1 19 0M5.8 13a9 9 0 0 1 12.4 0M9.2 16.4a4 4 0 0 1 5.6 0"/><circle cx="12" cy="19.5" r="1.2" fill="currentColor" stroke="none"/>',
};
const ico = (name, cls = '') => `<svg class="ph-i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`;
const el = (cls, html = '', kids = []) => { const e = h('div', { class: cls, html: html || null }); e.append(...kids.filter(Boolean)); return e; };
const action = (icon, count, cls = '') => el(`ph-act ${cls}`, `${ico(icon)}${count ? `<span>${count}</span>` : ''}`);

function statusBar() {
  return el('ph-status', `<b>9:41</b><span class="ph-island"></span><span class="ph-sys">${ico('signal')}${ico('wifi')}<i class="ph-batt"><i></i></i></span>`);
}

function nav(items, active) {
  return el('ph-nav', '', [el('ph-nav-row', '', items.map(([icon, label], i) => el(`ph-nav-item${i === active ? ' on' : ''}`,
    `${icon === 'avatar' ? '<i class="ph-me"></i>' : icon === 'tiktokPlus' ? '<i class="ph-tt-plus"><i></i></i>' : ico(icon)}${label ? `<small>${label}</small>` : ''}`))),
  el('ph-home')]);
}

// The app's interface for the platform, as an element to lay over the screen.
export function phoneChrome(platform, { caption = 'Your video', handle = 'yourbrand' } = {}) {
  const p = PLATFORMS[platform];
  const kids = [statusBar()];
  if (p.kind === 'reels') {
    kids.push(
      el('ph-head', `<b>${p.name}</b>${ico('chevron', 'sm')}<span class="grow"></span>${ico('camera')}`),
      el('ph-side', '', [action('heart', '12.4K'), action('comment', '318'), action('send', '1,204'), action('more'), el('ph-album')]),
      el('ph-meta', '', [
        el('ph-user', `<i class="ph-avatar"></i><b>${handle}</b><span class="ph-follow">Follow</span>`),
        el('ph-cap', '', [h('span', {}, caption)]),
        el('ph-audio', `${ico('music', 'sm')}<span>${handle} · Original audio</span>`)]),
      nav([['homeFill'], ['search'], ['plusSq'], ['reels'], ['avatar']], 3));
  } else if (p.kind === 'tiktok') {
    kids.push(
      el('ph-tt-tabs', `<span>Following</span><b>For You</b><span class="ph-tt-search">${ico('search')}</span>`),
      el('ph-side tt', '', [el('ph-tt-avatar', '<i class="ph-avatar"></i><i class="ph-tt-follow">+</i>'),
        action('heartFill', '24.8K'), action('commentFill', '512'), action('bookmark', '3,018'), action('shareFill', '1,960'), el('ph-disc')]),
      el('ph-meta tt', '', [el('ph-user', `<b>${handle}</b>`), el('ph-cap', '', [h('span', {}, caption)]),
        el('ph-audio', `${ico('music', 'sm')}<span>original sound · ${handle}</span>`)]),
      nav([['homeFill', 'Home'], ['friends', 'Friends'], ['tiktokPlus'], ['inbox', 'Inbox'], ['you', 'Profile']], 0));
  } else if (p.kind === 'shorts') {
    kids.push(
      el('ph-head shorts', `<span class="grow"></span>${ico('search')}${ico('moreV')}`),
      el('ph-side yt', '', [action('thumbUp', '18K', 'disc'), action('thumbDown', 'Dislike', 'disc'), action('commentFill', '402', 'disc'),
        action('shareFill', 'Share', 'disc'), action('remix', 'Remix', 'disc'), el('ph-album sq')]),
      el('ph-meta', '', [
        el('ph-user', `<i class="ph-avatar"></i><b>@${handle}</b><span class="ph-sub">Subscribe</span>`),
        el('ph-cap', '', [h('span', {}, caption)])]),
      nav([['home', 'Home'], ['shorts', 'Shorts'], ['plusSq'], ['subs', 'Subscriptions'], ['you', 'You']], 1));
  } else {
    kids.push(
      el('ph-story-bars', '<i class="on"></i><i></i><i></i>'),
      el('ph-story-head', `<i class="ph-avatar"></i><b>${handle}</b><small>2h</small><span class="grow"></span>${ico('more')}${ico('close')}`),
      el('ph-story-foot', `<span class="ph-reply">${platform === 'whatsapp' ? 'Reply' : 'Send message'}</span>${platform === 'whatsapp' ? '' : ico('heart')}${ico('send')}`),
      el('ph-home'));
  }
  return el(`ph-ui ph-${p.kind}`, '', kids);
}
