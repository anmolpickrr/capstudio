// Every caption setting with its default. Templates override a subset; the
// editor's controls change the same keys. Sizes are px for a 1080px short side.
export const DEFAULT_STYLE = {
  // text
  font: 'Poppins-Bold',
  size: 64,
  textCase: 'none',          // none | upper | lower | title
  punctuation: 'keep',       // keep | strip
  letterSpacing: 0,
  lineHeight: 1,             // multiple of the natural line height
  align: 'center',           // left | center | right
  // fill
  color: '#FFFFFF',
  gradientTo: null,          // second colour for a top-to-bottom gradient
  opacity: 1,
  // outline, shadow, glow
  outline: 0,
  outlineColor: '#000000',
  shadowX: 0, shadowY: 0, shadowBlur: 0, shadowColor: '#000000', shadowOpacity: 0,
  glow: 0, glowColor: '#7C5CFF', glowOpacity: 0.85,
  // background shape
  bg: 'none',                // none | line | block | word
  bgColor: '#000000', bgOpacity: 0.75, bgRadius: 12, bgPadX: 18, bgPadY: 8,
  // keyword emphasis
  emphasis: 'none',          // none | auto | marked
  emphColor: null, emphScale: 1, emphFont: null, emphBg: false, emphBgColor: '#FFE14D',
  emphLine: false,           // the emphasised word gets a line of its own
  // emojis (word.emoji): drawn above or below the words, at this many times the text size
  emoji: 'above',            // off | above | below
  emojiSize: 1.6,
  stack: false,              // every word on its own line
  // spoken-word highlight
  highlight: 'none',         // none | color | pill | sweep | progressive
  hlColor: '#FFE14D', hlBgColor: '#7C5CFF', hlScale: 1,
  reveal: false,             // words appear as they're spoken
  // placement
  vPos: 'bottom', vOffset: 14, hPos: 'center', hOffset: 0, width: 82, stagger: 0, tilt: 0,
  // caption length
  maxWords: 6, maxLines: 2,
  // motion
  animIn: 'none', animOut: 'none', wordIn: 'none', cascade: false, speed: 1,
};

export const withDefaults = (style) => ({ ...DEFAULT_STYLE, ...style });
