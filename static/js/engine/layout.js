// Caption layout: line breaks, word positions and boxes, in video pixels.
// Computed once per caption and style, then shared by the SVG preview and the
// ASS export, so both place every word in exactly the same spot.
import { displayWord } from './chunk.js';
import { captionEmoji } from './emoji.js';
import { fontById, wordFont } from './fonts.js';
import { textWidth } from './measure.js';

const STOP = new Set(('a an the and or but if of to in on at for with by from as is are was were be been it its this that '
  + 'these those i you he she we they me my your our their his her them us so do does did not no yes just very really '
  + 'can will would should could have has had what when where who how why all any some more most than then there here '
  + 'about into over also too only like get got go going gonna im i\'m you\'re it\'s that\'s don\'t '
  + 'है हैं था थे की का के को में से पर और भी तो ये यह वो वह हम तुम आप मैं ना नहीं क्या कि एक').split(' '));

const ref = (W, H) => Math.min(W, H) / 1080;

// Words to emphasise: the editor's marks, else (in auto mode) the most
// meaningful word of the caption: numbers and money first, then the longest
// non-filler word.
export function emphasisSet(caption, style) {
  const set = new Set();
  if (style.emphasis === 'none' || !style.emphasis) return set;
  caption.words.forEach((w, i) => { if (w.emph) set.add(i); });
  // A one-word caption is emphasised when it's a number or a long word (for
  // styles that switch font on the big words).
  if (style.emphasis === 'auto' && !set.size && caption.words.length === 1) {
    const core = caption.words[0].text.replace(/[^\p{L}\p{N}%₹$]/gu, '');
    if (/[\d%₹$]/.test(core) || [...core].length >= 8) set.add(0);
  }
  // 'last': the punchline, i.e. a number if there is one, else the last meaningful word
  if (style.emphasis === 'last' && !set.size) {
    const core = (w) => w.text.replace(/[^\p{L}\p{N}%₹$]/gu, '').toLowerCase();
    let pick = caption.words.findIndex((w) => /[\d%₹$]/.test(core(w)));
    if (pick < 0) for (let i = caption.words.length - 1; i >= 0; i--) { const c = core(caption.words[i]); if (c && !STOP.has(c)) { pick = i; break; } }
    if (pick >= 0) set.add(pick);
  }
  if (style.emphasis === 'auto' && !set.size && caption.words.length > 1) {
    let best = -1, score = -1;
    caption.words.forEach((w, i) => {
      const core = w.text.replace(/[^\p{L}\p{N}%₹$]/gu, '').toLowerCase();
      if (!core || STOP.has(core)) return;
      const s = (/[\d%₹$]/.test(core) ? 100 : 0) + [...core].length;
      if (s > score) { score = s; best = i; }
    });
    if (best >= 0) set.add(best);
  }
  return set;
}

// Scripts whose letters join or reorder (Indic, Arabic, Hebrew, Thai and others).
// Letter spacing would pull their vowel signs off the consonants, and libass
// stops shaping them when \fsp is set, so these words get no extra tracking.
const SHAPED = /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF]/;
export const needsShaping = (text) => SHAPED.test(text);

function wordSpec(caption, style, W, H) {
  const r = ref(W, H);
  const fs = style.size * r;
  const tracking = style.letterSpacing * r;
  const emph = emphasisSet(caption, style);
  // Shapes around single words need room so neighbours don't touch them.
  // (a keyword on its own line has no neighbours to keep clear of)
  const boxed = style.bg === 'word' || style.highlight === 'pill' || (style.emphBg && !style.emphLine);
  const extraGap = (!boxed ? 0 : (style.bg === 'word' ? 1.2 : 1.0) * style.bgPadX * r
    + Math.max(0, (style.hlScale || 1) - 1) * fs * 0.6)
    + style.outline * r; // thick outlines would otherwise fill the gap between words
  const specs = caption.words.map((w, i) => {
    const text = displayWord(w.text, style) || w.text;
    const isEmph = emph.has(i);
    const font = wordFont(isEmph && style.emphFont ? style.emphFont : style.font, text);
    const size = fs * (isEmph ? style.emphScale || 1 : 1);
    const spacing = needsShaping(text) ? 0 : tracking;
    return {
      i, text, font, size, emph: isEmph, spacing,
      w: textWidth(text, font, size, spacing),
      space: textWidth(' ', font, size, 0) + spacing + extraGap,
      asc: size * font.ascent,
      desc: size * (1 - font.ascent),
    };
  });
  // A word wider than the caption area (a long keyword at a big size) is scaled
  // down to fit, so it never runs off the screen.
  const maxW = maxTextWidth(style, W);
  for (const sp of specs) {
    if (sp.w <= maxW) continue;
    const k = maxW / sp.w;
    sp.size *= k; sp.w *= k; sp.space *= k; sp.asc *= k; sp.desc *= k;
  }
  // When the spoken word grows, it grows into its neighbours: leave room for the
  // larger of each pair (shapes around words already get room above).
  const grow = style.highlight !== 'none' && !boxed ? Math.max(0, (style.hlScale || 1) - 1) / 2 : 0;
  if (grow) specs.forEach((sp, i) => { if (specs[i + 1]) sp.space += grow * Math.max(sp.w, specs[i + 1].w); });
  return specs;
}

// Line breaks for a caption. `stack` styles put every word on its own line;
// `emphLine` styles give the emphasised word a line of its own (a small lead-in
// above or below a big keyword); others break for balanced line lengths.
function captionLines(words, style, maxWidth, spaced) {
  if (!words.length) return [];
  if (style.stack) return words.map((_, i) => [i, i + 1]);
  if (style.emphLine && words.some((w) => w.emph)) {
    const out = [];
    let a = 0;
    const run = (b) => { if (b > a) for (const [x, y] of breakLines(words.slice(a, b), maxWidth, spaced)) out.push([a + x, a + y]); };
    words.forEach((w, i) => { if (w.emph) { run(i); out.push([i, i + 1]); a = i + 1; } });
    run(words.length);
    return out;
  }
  return breakLines(words, maxWidth, spaced);
}

// Balanced line breaks: fewest lines that fit maxWidth, then even line lengths.
function breakLines(words, maxWidth, spaced) {
  const n = words.length;
  const width = (a, b) => {
    let s = 0;
    for (let k = a; k < b; k++) s += words[k].w + (k > a && spaced ? words[k - 1].space : 0);
    return s;
  };
  // greedy count of needed lines
  let needed = 1, cur = 0;
  for (let k = 0; k < n; k++) {
    const add = words[k].w + (cur > 0 && spaced ? words[k - 1].space : 0);
    if (cur > 0 && cur + add > maxWidth) { needed++; cur = words[k].w; } else cur += add;
  }
  if (needed === 1) return [[0, n]];
  const memo = new Map();
  const solve = (start, lines) => {
    const key = start * 64 + lines;
    if (memo.has(key)) return memo.get(key);
    let res;
    if (lines === 1) res = { cost: width(start, n), cuts: [] };
    else {
      res = { cost: Infinity, cuts: [] };
      for (let cut = start + 1; cut <= n - lines + 1; cut++) {
        const sub = solve(cut, lines - 1);
        const wl = width(start, cut);
        // longest line, with a small preference for bottom-heavy layouts
        const cost = Math.max(wl, sub.cost) + (wl > sub.cost ? 1 : 0);
        if (cost < res.cost) res = { cost, cuts: [cut, ...sub.cuts] };
      }
    }
    memo.set(key, res);
    return res;
  };
  const { cuts } = solve(0, Math.min(needed, n));
  const ranges = [];
  let prev = 0;
  for (const c of [...cuts, n]) { ranges.push([prev, c]); prev = c; }
  return ranges;
}

export function maxTextWidth(style, W) {
  const padX = style.bg === 'line' || style.bg === 'block' ? style.bgPadX * ref(W, W) : 0;
  return Math.max(40, (style.width / 100) * W - 2 * padX);
}

// Whether these words fit in one caption at this style (used when splitting
// the transcript into captions).
export function fitsCaption(words, style, W, H) {
  const spec = wordSpec({ words }, style, W, H);
  const lines = captionLines(spec, style, maxTextWidth(style, W), true);
  return lines.length <= style.maxLines;
}

export function layoutCaption(caption, style, W, H, spaced = true) {
  // a caption can be made bigger or smaller than the rest (caption.scale)
  if (caption.scale && caption.scale !== 1) style = { ...style, size: style.size * caption.scale };
  const r = ref(W, H);
  const fs = style.size * r;
  const words = wordSpec(caption, style, W, H);
  const ranges = captionLines(words, style, maxTextWidth(style, W), spaced);
  const gap = (style.lineHeight - 1) * fs;

  // vertical metrics per line. Stacked styles (a keyword on its own line, or one
  // word per line) pack lines by the letters themselves rather than the font's
  // full line box, which carries a lot of padding at big sizes. Indic and other
  // shaped scripts keep more room above for their vowel signs.
  const tight = style.emphLine || style.stack;
  let y = 0;
  const lines = ranges.map(([a, b], li) => {
    const ws = words.slice(a, b);
    const shaped = ws.some((w) => needsShaping(w.text));
    const ka = tight ? (shaped ? 0.9 : 0.8) : 1, kd = tight ? (shaped ? 0.7 : 0.5) : 1;
    const asc = Math.max(...ws.map((w) => w.asc)) * ka;
    const desc = Math.max(...ws.map((w) => w.desc)) * kd;
    const top = y;
    y += asc + desc + gap;
    let width = 0;
    ws.forEach((w, k) => { width += w.w + (k > 0 && spaced ? ws[k - 1].space : 0); });
    return { index: li, a, b, top, asc, desc, baseline: top + asc, bottom: top + asc + desc, width };
  });
  const blockH = lines.length ? lines[lines.length - 1].bottom : 0;
  const blockW = Math.max(0, ...lines.map((l) => l.width));
  // an emoji above or below the words; the words move over to keep both where the
  // caption is anchored (on screen, and out of the safe zones)
  const emoji = captionEmoji(caption, style);
  const E = emoji ? fs * (style.emojiSize || 1.6) : 0, eGap = E * 0.14;
  const below = style.emoji === 'below';
  let shift = 0;
  if (emoji) {
    const room = E + eGap;
    if (style.vPos === 'top') shift = below ? 0 : room;
    else if (style.vPos === 'middle') shift = below ? -room / 2 : room / 2;
    else shift = below ? -room : 0;
  }

  // place the block
  let blockLeft;
  if (style.hPos === 'left') blockLeft = (style.hOffset / 100) * W;
  else if (style.hPos === 'right') blockLeft = W - (style.hOffset / 100) * W - blockW;
  else blockLeft = W / 2 + (style.hOffset / 100) * W - blockW / 2;
  let blockTop;
  if (style.vPos === 'top') blockTop = (style.vOffset / 100) * H;
  else if (style.vPos === 'middle') blockTop = H / 2 + (style.vOffset / 100) * H - blockH / 2;
  else blockTop = H - (style.vOffset / 100) * H - blockH;
  blockTop += shift;

  // 'keyword' alignment: the keyword line is centred in the block, lines before
  // it start at the keyword's left edge and lines after it end at its right edge,
  // so a lead-in and a tail frame the keyword like a typeset title.
  const kw = style.align === 'keyword' ? lines.find((l) => words.slice(l.a, l.b).some((w) => w.emph)) : null;
  const kwLeft = kw ? blockLeft + (blockW - kw.width) / 2 : 0;
  for (const l of lines) {
    l.top += blockTop; l.baseline += blockTop; l.bottom += blockTop;
    let left = blockLeft;
    if (kw) {
      if (l === kw) left = kwLeft;
      else if (l.index < kw.index) left = Math.min(kwLeft, blockLeft + blockW - l.width);
      else left = Math.max(blockLeft, kwLeft + kw.width - l.width);
    } else if (style.align === 'center' || style.align === 'keyword') left = blockLeft + (blockW - l.width) / 2;
    else if (style.align === 'right') left = blockLeft + blockW - l.width;
    if (style.stagger && lines.length > 1) left += (l.index % 2 ? 1 : -1) * style.stagger * r;
    l.left = left;
    l.right = left + l.width;
    let x = left;
    for (let k = l.a; k < l.b; k++) {
      const w = words[k];
      if (k > l.a && spaced) x += words[k - 1].space;
      w.x = x;
      w.cx = x + w.w / 2;
      w.line = l.index;
      w.baseline = l.baseline;
      w.bottom = l.baseline + w.desc;          // libass \an2 anchor for this word
      w.lineTop = l.top;
      w.lineBottom = l.bottom;
      x += w.w;
    }
  }
  const block = {
    left: Math.min(...lines.map((l) => l.left)), right: Math.max(...lines.map((l) => l.right)),
    top: lines.length ? lines[0].top : blockTop, bottom: lines.length ? lines[lines.length - 1].bottom : blockTop,
  };
  let emojiRect = null;
  if (emoji) {
    const cx = (block.left + block.right) / 2;
    emojiRect = { x: cx - E / 2, y: below ? block.bottom + eGap : block.top - eGap - E, w: E, h: E };
    block.left = Math.min(block.left, emojiRect.x); block.right = Math.max(block.right, emojiRect.x + E);
    block.top = Math.min(block.top, emojiRect.y); block.bottom = Math.max(block.bottom, emojiRect.y + E);
  }
  // Origin of caption-level scaling: the block's centre, on its anchored edge.
  const origin = {
    x: (block.left + block.right) / 2,
    y: style.vPos === 'top' ? block.top : style.vPos === 'middle' ? (block.top + block.bottom) / 2 : block.bottom,
  };
  return { ref: r, fs, words, lines, block, origin, font: fontById(style.font), emoji: emoji && { ...emoji, rect: emojiRect } };
}

// All fonts a set of captions will use at this style (to load before layout).
export function fontsFor(captions, style) {
  const out = new Set([fontById(style.font)]);
  if (style.emphFont) out.add(fontById(style.emphFont));
  for (const c of captions) {
    for (const w of c.words) {
      const text = displayWord(w.text, style);
      out.add(wordFont(style.font, text));
      if (style.emphFont) out.add(wordFont(style.emphFont, text));
    }
  }
  return [...out];
}
