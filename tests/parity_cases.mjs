// Caption frames compared by tests/parity.mjs. Each exercises different engine
// features; times are chosen mid-animation and mid-highlight on purpose.
const words = (text, start = 0.2, step = 0.32) => text.split(' ').map((w, i) => ({
  text: w, start: start + i * step, end: start + i * step + step * 0.9,
}));
const cap = (text, opts = {}) => {
  const ws = words(text, opts.start, opts.step);
  if (opts.emph) opts.emph.forEach((i) => { ws[i].emph = true; });
  return { id: 'p1', start: ws[0].start, end: ws[ws.length - 1].end + 0.4, words: ws };
};

export const CASES = [
  { name: 'outline-shadow', W: 1280, H: 720, t: 1.0, caption: cap('Make every video count today'),
    style: { font: 'Montserrat-ExtraBold', size: 72, outline: 5, shadowY: 6, shadowBlur: 4, shadowOpacity: 0.6, textCase: 'upper' } },
  { name: 'glow-neon', W: 1280, H: 720, t: 1.0, caption: cap('Neon nights are back'),
    style: { font: 'Poppins-Bold', size: 76, outline: 2, outlineColor: '#00E5FF', glow: 10, glowColor: '#00E5FF', color: '#FFFFFF' } },
  { name: 'gradient-fill', W: 1280, H: 720, t: 1.0, caption: cap('Premium gradient captions'),
    style: { font: 'ArchivoExpanded-Black', size: 70, color: '#FFE14D', gradientTo: '#FF4FD8', outline: 0, shadowY: 4, shadowOpacity: 0.5, shadowBlur: 6 } },
  { name: 'line-box-rounded', W: 1280, H: 720, t: 1.2, caption: cap('A rounded box behind every line of text here'),
    style: { font: 'Inter-Bold', size: 52, bg: 'line', bgColor: '#111111', bgOpacity: 0.8, bgRadius: 14, bgPadX: 18, bgPadY: 8, width: 60 } },
  { name: 'active-pill', W: 720, H: 1280, t: 0.95, caption: cap('This word gets the pill'),
    style: { font: 'Poppins-ExtraBold', size: 78, highlight: 'pill', hlBgColor: '#7C5CFF', hlColor: '#FFFFFF', bgRadius: 16, bgPadX: 12, bgPadY: 4, hlScale: 1.12, textCase: 'upper', outline: 0, vPos: 'middle', vOffset: 8, width: 86 } },
  { name: 'emphasis-serif', W: 1280, H: 720, t: 1.3, caption: cap('The secret is consistency', { emph: [3] }),
    style: { font: 'Inter-Bold', size: 60, emphasis: 'marked', emphFont: 'InstrumentSerif-Italic', emphScale: 1.5, emphColor: '#FFD166' } },
  { name: 'karaoke-sweep', W: 1280, H: 720, t: 0.65, caption: cap('Sing along with every word'),
    style: { font: 'Poppins-Black', size: 70, highlight: 'sweep', hlColor: '#3DFF7A', outline: 4 } },
  { name: 'reveal-block', W: 720, H: 1280, t: 0.9, caption: cap('Words appear as they are spoken'),
    style: { font: 'Manrope-ExtraBold', size: 64, reveal: true, wordIn: 'pop', bg: 'block', bgColor: '#000000', bgOpacity: 0.7, bgRadius: 20, bgPadX: 22, bgPadY: 14, vPos: 'middle', vOffset: 10 } },
  { name: 'pop-in-mid', W: 1280, H: 720, t: 0.27, caption: cap('Pop goes the caption'),
    style: { font: 'Anton-Regular', size: 96, animIn: 'pop', outline: 6, textCase: 'upper' } },
  { name: 'tilt-stagger', W: 720, H: 1280, t: 1.2, caption: cap('Bold ideas need bold type'),
    style: { font: 'Bangers-Regular', size: 92, tilt: -6, stagger: 40, maxWords: 6, width: 60, outline: 6, color: '#FFE14D', vPos: 'middle', vOffset: 0 } },
  { name: 'left-align-hindi', W: 1280, H: 720, t: 1.0, caption: cap('यह बहुत आसान है let us start'),
    style: { font: 'Montserrat-ExtraBold', size: 64, align: 'left', hPos: 'left', hOffset: 6, outline: 4, width: 50 } },
  { name: 'word-boxes', W: 1280, H: 720, t: 1.0, caption: cap('Every word in its own tile'),
    style: { font: 'SpaceGrotesk-Bold', size: 56, bg: 'word', bgColor: '#FFFFFF', bgOpacity: 1, color: '#111111', bgRadius: 6, bgPadX: 10, bgPadY: 4 } },
];

// Every library template, on a vertical reel frame, mid-caption.
import { TEMPLATES } from '../static/js/templates/library.js';

// The caption a template would really show: as many words as it allows per caption.
const SAMPLE = 'Make every single video count 50% faster today'.split(' ');
for (const tpl of TEMPLATES) {
  const n = Math.min(tpl.style.maxWords, 5);
  const caption = cap(SAMPLE.slice(0, n).join(' '), { step: 0.3 });
  // after entrance animations, with the last-but-one word being spoken
  const t = caption.words[Math.max(0, n - 2)].start + 0.12 + (n === 1 ? 0.3 : 0);
  CASES.push({ name: `tpl-${tpl.id}`, W: 1080, H: 1920, t, caption, style: tpl.style, template: true });
}

// Every template again with Hindi: conjuncts (क्या), vowel signs before the
// consonant (कि, चि) and nukta (ड़) must shape the same in the export.
const HINDI = 'क्या आपको किचन चिमनी थोड़ा साफ़ करनी है'.split(' ');
for (const tpl of TEMPLATES) {
  const n = Math.min(tpl.style.maxWords, 4);
  const caption = cap(HINDI.slice(0, n).join(' '), { step: 0.3 });
  const t = caption.words[Math.max(0, n - 2)].start + 0.12 + (n === 1 ? 0.3 : 0);
  CASES.push({ name: `hi-${tpl.id}`, W: 1080, H: 1920, t, caption, style: tpl.style, template: true });
}
