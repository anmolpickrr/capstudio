// Font registry: the catalogue from the server, @font-face loading, script
// coverage, and per-word fallback. Every caption word is drawn with a font that
// can actually render it, in the preview and in the export alike.

let FONTS = [];
const BY_ID = new Map();
const loaded = new Set();
let base = '/fonts/';

export const SCRIPT_RANGES = {
  devanagari: [0x0900, 0x097f], bengali: [0x0980, 0x09ff], gurmukhi: [0x0a00, 0x0a7f],
  gujarati: [0x0a80, 0x0aff], oriya: [0x0b00, 0x0b7f], tamil: [0x0b80, 0x0bff], telugu: [0x0c00, 0x0c7f],
  kannada: [0x0c80, 0x0cff], malayalam: [0x0d00, 0x0d7f], sinhala: [0x0d80, 0x0dff], arabic: [0x0600, 0x06ff],
};
export const SCRIPT_LABELS = {
  latin: 'Latin', devanagari: 'हिन्दी / मराठी', bengali: 'বাংলা', gurmukhi: 'ਪੰਜਾਬੀ', gujarati: 'ગુજરાતી',
  oriya: 'ଓଡ଼ିଆ', tamil: 'தமிழ்', telugu: 'తెలుగు', kannada: 'ಕನ್ನಡ', malayalam: 'മലയാളം', arabic: 'اردو',
  sinhala: 'සිංහල',
};
export const CATEGORY_LABELS = {
  sans: 'Sans', display: 'Display', condensed: 'Condensed', serif: 'Serif & editorial', script: 'Handwritten',
  mono: 'Mono',
};

export function setCatalogue(list, fontBase = '/fonts/') {
  FONTS = list;
  base = fontBase;
  BY_ID.clear();
  for (const f of list) BY_ID.set(f.id, f);
  const css = list.map((f) => `@font-face{font-family:"cp-${f.id}";src:url("${base}${encodeURIComponent(f.file)}");font-display:block}`).join('\n');
  let style = document.getElementById('cp-fonts');
  if (!style) {
    style = Object.assign(document.createElement('style'), { id: 'cp-fonts' });
    document.head.appendChild(style);
  }
  style.textContent = css;
}

export const allFonts = () => FONTS;
export const fontById = (id) => BY_ID.get(id) || FONTS[0];
export const cssFamily = (font) => `"cp-${font.id}"`;

export function families() {
  const out = new Map();
  for (const f of FONTS) {
    if (!out.has(f.family)) out.set(f.family, { family: f.family, category: f.category, fonts: [] });
    out.get(f.family).fonts.push(f);
  }
  return [...out.values()];
}

function covers(font, cp) {
  const r = font.ranges;
  let lo = 0, hi = r.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < r[mid][0]) hi = mid - 1; else if (cp > r[mid][1]) lo = mid + 1; else return true;
  }
  return false;
}

const IGNORABLE = (cp) => cp <= 0x20 || (cp >= 0x200b && cp <= 0x200d) || cp === 0xfeff;

export function fontCovers(font, text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (!IGNORABLE(cp) && !covers(font, cp)) return false;
  }
  return true;
}

// The main script of a piece of text ('latin' when it has no Indic/Arabic letters).
export function scriptOf(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    for (const [name, [a, b]] of Object.entries(SCRIPT_RANGES)) if (cp >= a && cp <= b) return name;
  }
  return 'latin';
}

export function scriptsIn(texts) {
  const s = new Set();
  for (const t of texts) s.add(scriptOf(t));
  return [...s];
}

const fallbackCache = new Map();

// Font for one word: the chosen font if it can draw the word, otherwise the
// closest font (same style category, nearest weight, italic match) that can.
export function wordFont(fontId, text) {
  const font = fontById(fontId);
  if (fontCovers(font, text)) return font;
  const key = `${fontId}|${scriptOf(text)}`;
  const cached = fallbackCache.get(key);
  if (cached && fontCovers(cached, text)) return cached;
  let best = null, bestScore = -Infinity;
  for (const f of FONTS) {
    if (!fontCovers(f, text)) continue;
    let score = -Math.abs(f.weight - font.weight) / 100;
    if (f.category === font.category) score += 3;
    if (f.italic === font.italic) score += 1;
    if (f.family.startsWith('Baloo') && (font.category === 'display' || font.category === 'sans')) score += 1.5;
    if (f.family.startsWith('Noto')) score += 0.5;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  const result = best || font;
  fallbackCache.set(key, result);
  return result;
}

// Fonts that can draw every word of the captions (used to filter the picker).
export function fontsSupporting(texts) {
  const scripts = scriptsIn(texts);
  return FONTS.filter((f) => scripts.every((s) => f.scripts.includes(s)));
}

export function isLoaded(font) { return loaded.has(font.id); }

// Loads the given fonts (no-op for ones already loaded).
export async function ensureFonts(fonts) {
  const pending = [...new Set(fonts)].filter((f) => f && !loaded.has(f.id));
  await Promise.all(pending.map(async (f) => {
    try {
      await document.fonts.load(`32px ${cssFamily(f)}`);
      loaded.add(f.id);
    } catch { /* leave unloaded; measurement falls back and is redone later */ }
  }));
  return pending.length > 0;
}
