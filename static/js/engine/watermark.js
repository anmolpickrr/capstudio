// The fastrr watermark: a full-frame transparent overlay in a light or dark
// variant, made for 1:1 and 9:16 frames. The preview, the browser export and the
// server export all place it with watermarkRect, so it sits in the same spot.

export const WATERMARK_DEFAULT = { on: false, tone: 'light', format: 'auto', size: 100, opacity: 100 };

// 'auto' picks the variant that fits the video: 9:16 for tall videos, 1:1 otherwise.
export function watermarkFormat(wm, W, H) {
  if (wm.format === '1x1' || wm.format === '9x16') return wm.format;
  return W / H < 0.8 ? '9x16' : '1x1';
}

export function watermarkFile(wm, W, H) {
  return `fastrr-${wm.tone === 'dark' ? 'dark' : 'light'}-${watermarkFormat(wm, W, H)}.png`;
}

// The overlay is fitted inside the frame (never cropped), centred, then scaled by size.
export function watermarkRect(wm, W, H) {
  const ar = watermarkFormat(wm, W, H) === '9x16' ? 9 / 16 : 1;
  let w = Math.min(W, H * ar), h = w / ar;
  const k = Math.max(0.2, Math.min(1, (wm.size ?? 100) / 100));
  w *= k; h *= k;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
