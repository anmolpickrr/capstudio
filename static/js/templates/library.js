// The caption template library. Each template sets its own typography,
// colour, shape, highlight and motion on top of DEFAULT_STYLE; sizes are px
// for a 1080px short side. Every setting used here is drawn identically by the
// preview and the export (see engine/).
import { withDefaults } from './base.js';

export const CATEGORIES = [
  { id: 'trending', name: 'Trending', badge: true },
  { id: 'kinetic', name: 'Kinetic typography' },
  { id: 'creator', name: 'Creator & influencer' },
  { id: 'bold', name: 'Bold social' },
  { id: 'minimal', name: 'Minimal & clean' },
  { id: 'cinematic', name: 'Cinematic' },
  { id: 'editorial', name: 'Editorial' },
  { id: 'gradient', name: 'Premium gradient' },
  { id: 'keyword', name: 'Keyword highlight' },
  { id: 'karaoke', name: 'Karaoke & word-by-word' },
  { id: 'ugc', name: 'UGC & product ads' },
  { id: 'corporate', name: 'Corporate & professional' },
  { id: 'experimental', name: 'Expressive & experimental' },
];

const T = (id, name, category, note, style) => ({ id, name, category, note, style: withDefaults(style) });

export const TEMPLATES = [
  // Trending: the looks top creators use right now. A small lead-in over one big
  // keyword, mixed fonts, words that build up as they're spoken, soft glow.
  T('two-tier', 'Two-tier', 'trending', 'Lead-in framing a big lime keyword', {
    font: 'Inter-Bold', size: 92, letterSpacing: -3, punctuation: 'strip', lineHeight: 0.94, align: 'keyword',
    emphasis: 'auto', emphLine: true, emphScale: 2.05, emphFont: 'Inter-Black', emphColor: '#D7FF3F',
    shadowY: 4, shadowBlur: 18, shadowOpacity: 0.5, reveal: true, wordIn: 'rise',
    maxWords: 4, maxLines: 3, width: 84, vPos: 'middle', vOffset: 10,
  }),
  T('serif-stack', 'Serif stack', 'trending', 'Clean sans framing a tall serif keyword', {
    font: 'Inter-Bold', size: 84, letterSpacing: -3, lineHeight: 0.96, align: 'keyword',
    emphasis: 'auto', emphLine: true, emphScale: 2.5, emphFont: 'InstrumentSerif-Regular',
    glow: 4, glowColor: '#FFFFFF', glowOpacity: 0.18, shadowY: 3, shadowBlur: 14, shadowOpacity: 0.45,
    reveal: true, wordIn: 'blur', maxWords: 5, maxLines: 3, width: 82, vPos: 'middle', vOffset: 10,
  }),
  T('scatter', 'Poster stack', 'trending', 'One heavy word a line, sizes mixed like a poster', {
    font: 'Inter-Black', size: 128, letterSpacing: -7, textCase: 'lower', punctuation: 'strip', lineHeight: 0.98,
    stack: true, align: 'left', emphasis: 'auto', emphScale: 1.75,
    shadowY: 6, shadowBlur: 22, shadowOpacity: 0.45, reveal: true, wordIn: 'pop',
    maxWords: 3, maxLines: 3, width: 90, vPos: 'middle', vOffset: 0,
  }),
  T('hook', 'Hook', 'trending', 'Bold italic caps, the punchline in red', {
    font: 'Poppins-ExtraBoldItalic', size: 120, textCase: 'upper', punctuation: 'strip', lineHeight: 0.96, align: 'keyword',
    emphasis: 'last', emphLine: true, emphColor: '#FF2D46', emphScale: 1.3,
    shadowY: 6, shadowBlur: 12, shadowOpacity: 0.7, animIn: 'pop',
    maxWords: 4, maxLines: 3, width: 88, vPos: 'middle', vOffset: 12,
  }),
  T('hype', 'Hype', 'trending', 'Violet italic lead-in, wide display keyword', {
    font: 'Poppins-ExtraBoldItalic', size: 84, textCase: 'upper', punctuation: 'strip', color: '#B98BFF', lineHeight: 0.96, align: 'keyword',
    emphasis: 'last', emphLine: true, emphScale: 1.95, emphFont: 'Unbounded-Black', emphColor: '#FFFFFF',
    glow: 6, glowColor: '#7C3AED', glowOpacity: 0.5, shadowY: 6, shadowBlur: 10, shadowOpacity: 0.6, animIn: 'zoom',
    maxWords: 3, maxLines: 3, width: 90, vPos: 'middle', vOffset: 12,
  }),
  T('big-word', 'Big word', 'trending', 'One word at a time; long words turn serif italic', {
    font: 'Inter-Black', size: 180, letterSpacing: -7, textCase: 'upper', punctuation: 'strip',
    emphasis: 'auto', emphFont: 'PlayfairDisplay-SemiBoldItalic', emphScale: 1,
    shadowY: 6, shadowBlur: 22, shadowOpacity: 0.55, animIn: 'blur',
    maxWords: 1, maxLines: 1, width: 92, vPos: 'middle', vOffset: -16,
  }),
  T('soft-glow', 'Soft glow', 'trending', 'Mixed case with a soft white glow, words blur in', {
    font: 'Inter-Bold', size: 116, letterSpacing: -4, lineHeight: 0.92,
    glow: 10, glowColor: '#FFFFFF', glowOpacity: 0.35, reveal: true, wordIn: 'blur',
    maxWords: 5, maxLines: 2, width: 80, vPos: 'middle', vOffset: 12,
  }),
  T('desi-tier', 'Desi marker', 'trending', 'Hindi and Hinglish, keyword on a saffron marker', {
    font: 'Mukta-Bold', size: 88, lineHeight: 1.12, align: 'keyword',
    emphasis: 'auto', emphLine: true, emphScale: 1.8, emphFont: 'Baloo2-ExtraBold', emphColor: '#1E1300',
    emphBg: true, emphBgColor: '#FFB627', bgRadius: 14, bgPadX: 18, bgPadY: 0,
    shadowY: 4, shadowBlur: 14, shadowOpacity: 0.55, reveal: true, wordIn: 'rise',
    maxWords: 4, maxLines: 3, width: 86, vPos: 'middle', vOffset: 10,
  }),

  // Kinetic typography
  T('punch', 'Punch', 'kinetic', 'One word at a time, stamped in', {
    font: 'Anton-Regular', size: 150, textCase: 'upper', punctuation: 'strip', maxWords: 1, maxLines: 1,
    shadowY: 10, shadowColor: '#000000', shadowOpacity: 0.9, animIn: 'stamp', vPos: 'middle', vOffset: 6, width: 90,
  }),
  T('cascade', 'Cascade', 'kinetic', 'Staggered lines, words rise in turn', {
    font: 'BricolageGrotesque-ExtraBold', size: 88, lineHeight: 0.92, align: 'left', hPos: 'center', stagger: 70,
    maxWords: 5, maxLines: 3, width: 58, cascade: true, wordIn: 'rise', shadowY: 4, shadowBlur: 10, shadowOpacity: 0.45,
    emphasis: 'auto', emphColor: '#B9F227', vPos: 'middle', vOffset: 4,
  }),
  T('bounce', 'Bounce', 'kinetic', 'Words drop in as they are spoken', {
    font: 'Rubik-Black', size: 96, textCase: 'upper', reveal: true, wordIn: 'drop', outline: 6, outlineColor: '#121212',
    emphasis: 'auto', emphColor: '#FFD23F', emphScale: 1.18, maxWords: 4, width: 80, vPos: 'middle', vOffset: 14,
  }),
  T('zoom-words', 'Zoom words', 'kinetic', 'Each word zooms from large', {
    font: 'Unbounded-Black', size: 70, textCase: 'upper', reveal: true, wordIn: 'zoom', color: '#F4F1FF',
    shadowY: 6, shadowBlur: 12, shadowOpacity: 0.55, maxWords: 4, vPos: 'middle', vOffset: 12, width: 84,
  }),

  // Creator & influencer
  T('hormozi', 'Spotlight word', 'creator', 'Thick outline, spoken word in yellow', {
    font: 'Montserrat-Black', size: 84, textCase: 'upper', punctuation: 'strip', outline: 7, outlineColor: '#000000',
    shadowY: 5, shadowOpacity: 0.6, highlight: 'color', hlColor: '#FFE14D', hlScale: 1.12, animIn: 'pop',
    maxWords: 3, vPos: 'bottom', vOffset: 28, width: 86,
  }),
  T('popstar', 'Pop pill', 'creator', 'A violet pill follows the voice', {
    font: 'Poppins-Black', size: 78, textCase: 'upper', punctuation: 'strip', highlight: 'pill', hlBgColor: '#7C5CFF',
    hlColor: '#FFFFFF', hlScale: 1.08, bgRadius: 18, bgPadX: 14, bgPadY: 4, shadowY: 4, shadowBlur: 8,
    shadowOpacity: 0.45, animIn: 'pop', maxWords: 3, vPos: 'bottom', vOffset: 26, width: 88,
  }),
  T('glowup', 'Glow up', 'creator', 'Soft pink glow, bright active word', {
    font: 'Urbanist-Black', size: 76, glow: 9, glowColor: '#FF4FD8', glowOpacity: 0.6, highlight: 'color',
    hlColor: '#FFB3F0', animIn: 'rise', maxWords: 4, vPos: 'bottom', vOffset: 24,
  }),
  T('desi', 'Desi bold', 'creator', 'Made for Hindi & Hinglish', {
    font: 'Baloo2-ExtraBold', size: 84, outline: 6, outlineColor: '#1A0F00', highlight: 'color', hlColor: '#FF9F1C',
    hlScale: 1.1, animIn: 'pop', maxWords: 4, vPos: 'bottom', vOffset: 24, width: 86,
  }),

  // Bold social
  T('sticker', 'Sticker', 'bold', 'Chunky outline, hard shadow, a little tilt', {
    font: 'LuckiestGuy-Regular', size: 92, outline: 8, outlineColor: '#111111', shadowX: 6, shadowY: 7,
    shadowColor: '#111111', shadowOpacity: 1, tilt: -3, emphasis: 'auto', emphColor: '#FF4D4D', emphScale: 1.15,
    animIn: 'pop', maxWords: 4, width: 80, vPos: 'middle', vOffset: 16,
  }),
  T('tiles', 'Tiles', 'bold', 'Every word on its own white tile', {
    font: 'SpaceGrotesk-Bold', size: 64, color: '#111111', bg: 'word', bgColor: '#FFFFFF', bgOpacity: 1, bgRadius: 8,
    bgPadX: 12, bgPadY: 6, reveal: true, wordIn: 'pop', maxWords: 5, vPos: 'bottom', vOffset: 22,
  }),
  T('blockbuster', 'Block', 'bold', 'Wide letters on a yellow block', {
    font: 'ArchivoExpanded-Black', size: 64, textCase: 'upper', color: '#111111', bg: 'block', bgColor: '#FFE14D',
    bgOpacity: 1, bgRadius: 4, bgPadX: 22, bgPadY: 12, animIn: 'zoom', maxWords: 4, width: 76, vPos: 'bottom', vOffset: 20,
  }),

  // Minimal & clean
  T('whisper', 'Whisper', 'minimal', 'Small, soft, out of the way', {
    font: 'Inter-Medium', size: 46, shadowY: 2, shadowBlur: 10, shadowOpacity: 0.55, animIn: 'fade', animOut: 'fade',
    maxWords: 10, width: 76, vOffset: 8,
  }),
  T('lowercase', 'Lowercase', 'minimal', 'lowercase, no punctuation, airy', {
    font: 'Manrope-Medium', size: 54, textCase: 'lower', punctuation: 'strip', letterSpacing: 0.5,
    shadowY: 2, shadowBlur: 8, shadowOpacity: 0.5, animIn: 'fade', maxWords: 6, vOffset: 12,
  }),
  T('clean-box', 'Clean box', 'minimal', 'Readable on any footage', {
    font: 'DMSans-Bold', size: 50, bg: 'line', bgColor: '#0E0E12', bgOpacity: 0.72, bgRadius: 10, bgPadX: 16,
    bgPadY: 7, maxWords: 9, width: 74, vOffset: 9,
  }),

  // Cinematic
  T('film', 'Film subtitle', 'cinematic', 'Classic serif, warm white', {
    font: 'CormorantGaramond-Bold', size: 54, color: '#F6F0E3', letterSpacing: 0.6, shadowY: 2, shadowBlur: 6,
    shadowOpacity: 0.8, animIn: 'fade', animOut: 'fade', maxWords: 10, width: 72, vOffset: 7,
  }),
  T('trailer', 'Trailer', 'cinematic', 'Tall caps, silver, blurred in', {
    font: 'BigShouldersDisplay-Black', size: 92, textCase: 'upper', letterSpacing: 9, color: '#FFFFFF',
    gradientTo: '#8D95A6', shadowY: 4, shadowBlur: 16, shadowOpacity: 0.7, animIn: 'blur', animOut: 'blur',
    maxWords: 4, width: 86, vPos: 'middle', vOffset: 0,
  }),
  T('noir', 'Noir', 'cinematic', 'Italic serif with a faint halo', {
    font: 'PlayfairDisplay-SemiBoldItalic', size: 62, glow: 6, glowColor: '#FFFFFF', glowOpacity: 0.22,
    animIn: 'fade', animOut: 'fade', maxWords: 7, width: 70, vOffset: 10,
  }),

  // Editorial
  T('magazine', 'Magazine', 'editorial', 'Sans with an italic serif keyword', {
    font: 'Inter-Bold', size: 58, emphasis: 'auto', emphFont: 'InstrumentSerif-Italic', emphScale: 1.55,
    emphColor: '#FFD166', shadowY: 3, shadowBlur: 10, shadowOpacity: 0.5, animIn: 'rise', maxWords: 6, vOffset: 14,
  }),
  T('fraunces', 'Feature', 'editorial', 'Heavy serif, left aligned', {
    font: 'Fraunces-Black', size: 74, color: '#F7EAD3', lineHeight: 0.95, align: 'left', hPos: 'left', hOffset: 7,
    emphasis: 'auto', emphFont: 'Fraunces-SemiBoldItalic', emphColor: '#FF8A5B', shadowY: 4, shadowBlur: 12,
    shadowOpacity: 0.5, animIn: 'rise', maxWords: 6, width: 70, vOffset: 12,
  }),
  T('column', 'Column', 'editorial', 'Cream card, dark serif type', {
    font: 'DMSerifDisplay-Regular', size: 58, color: '#1C1A17', bg: 'block', bgColor: '#F4EBDD', bgOpacity: 1,
    bgRadius: 3, bgPadX: 26, bgPadY: 14, animIn: 'fade', maxWords: 8, width: 66, vOffset: 10,
  }),
  T('rozha', 'Rozha', 'editorial', 'Display serif for Hindi & English', {
    font: 'RozhaOne-Regular', size: 72, color: '#FFF4E0', shadowY: 4, shadowBlur: 10, shadowOpacity: 0.55,
    emphasis: 'auto', emphColor: '#FFB347', animIn: 'fade', maxWords: 6, vOffset: 12,
  }),

  // Premium gradient
  T('aurora', 'Aurora', 'gradient', 'Gold-to-pink gradient, wide type', {
    font: 'ArchivoExpanded-Black', size: 70, color: '#FFE14D', gradientTo: '#FF4FD8', shadowY: 5, shadowBlur: 10,
    shadowOpacity: 0.5, animIn: 'zoom', maxWords: 4, vOffset: 18,
  }),
  T('chrome', 'Chrome', 'gradient', 'Metallic fill with a dark edge', {
    font: 'Unbounded-Black', size: 66, textCase: 'upper', color: '#FFFFFF', gradientTo: '#7F8899', outline: 3,
    outlineColor: '#1B1E27', shadowY: 6, shadowBlur: 8, shadowOpacity: 0.6, animIn: 'pop', maxWords: 4, vOffset: 18,
  }),
  T('sunset', 'Sunset', 'gradient', 'Warm gradient, white active word', {
    font: 'Syne-ExtraBold', size: 76, color: '#FFC371', gradientTo: '#FF4E6A', highlight: 'color', hlColor: '#FFFFFF',
    shadowY: 4, shadowBlur: 12, shadowOpacity: 0.5, animIn: 'rise', maxWords: 4, vOffset: 20,
  }),
  T('ocean', 'Ocean', 'gradient', 'Cyan-to-blue with a cool glow', {
    font: 'Outfit-Black', size: 78, color: '#7CF7FF', gradientTo: '#4F6BFF', glow: 8, glowColor: '#3D7BFF',
    glowOpacity: 0.45, animIn: 'blur', maxWords: 4, vOffset: 20,
  }),

  // Keyword highlight
  T('marker', 'Highlighter', 'keyword', 'Key word gets a marker swipe', {
    font: 'Poppins-ExtraBold', size: 70, outline: 5, outlineColor: '#111111', emphasis: 'auto', emphBg: true,
    emphBgColor: '#FFE14D', emphColor: '#111111', bgRadius: 6, bgPadX: 10, bgPadY: 2, animIn: 'pop', maxWords: 5, vOffset: 20,
  }),
  T('keyword-glow', 'Key glow', 'keyword', 'Key word bigger, mint and glowing', {
    font: 'Montserrat-ExtraBold', size: 66, shadowY: 4, shadowBlur: 10, shadowOpacity: 0.5, emphasis: 'auto',
    emphColor: '#00F0A8', emphScale: 1.35, animIn: 'rise', maxWords: 5, vOffset: 18,
  }),
  T('underdog', 'Headline', 'keyword', 'Condensed caps, italic red keyword', {
    font: 'BarlowCondensed-ExtraBold', size: 96, textCase: 'upper', outline: 4, outlineColor: '#0D0D0D',
    emphasis: 'auto', emphFont: 'BarlowCondensed-ExtraBoldItalic', emphColor: '#FF5A36', emphScale: 1.3,
    animIn: 'stamp', maxWords: 4, vOffset: 18,
  }),

  // Karaoke & word-by-word
  T('karaoke', 'Karaoke', 'karaoke', 'Colour sweeps through each word', {
    font: 'Poppins-Black', size: 74, outline: 5, outlineColor: '#000000', highlight: 'sweep', hlColor: '#3DFF7A',
    maxWords: 5, vOffset: 20,
  }),
  T('typewriter', 'Typewriter', 'karaoke', 'Mono type, words appear as spoken', {
    font: 'JetBrainsMono-ExtraBold', size: 56, align: 'left', reveal: true, bg: 'block', bgColor: '#0B0B10',
    bgOpacity: 0.85, bgRadius: 10, bgPadX: 20, bgPadY: 12, color: '#E8FFE8', maxWords: 7, width: 70, vOffset: 14,
  }),
  T('progressive', 'Read along', 'karaoke', 'Spoken words turn amber', {
    font: 'Figtree-Black', size: 70, highlight: 'progressive', hlColor: '#FFB020', shadowY: 4, shadowBlur: 8,
    shadowOpacity: 0.55, maxWords: 6, vOffset: 18,
  }),
  T('lime-pill', 'Lime pill', 'karaoke', 'Rounded lime pill on the spoken word', {
    font: 'Sora-ExtraBold', size: 64, highlight: 'pill', hlBgColor: '#C6FF3D', hlColor: '#101010', bgRadius: 30,
    bgPadX: 16, bgPadY: 6, shadowY: 3, shadowBlur: 8, shadowOpacity: 0.5, maxWords: 5, vOffset: 18,
  }),

  // UGC & product ads
  T('review', 'Review', 'ugc', 'White text boxes like a native post', {
    font: 'PlusJakartaSans-ExtraBold', size: 56, color: '#111111', bg: 'line', bgColor: '#FFFFFF', bgOpacity: 1,
    bgRadius: 12, bgPadX: 16, bgPadY: 8, animIn: 'pop', maxWords: 7, width: 76, vPos: 'middle', vOffset: 18,
  }),
  T('price', 'Price tag', 'ugc', 'Numbers and offers jump out in red', {
    font: 'ArchivoBlack-Regular', size: 70, textCase: 'upper', outline: 5, outlineColor: '#111111', emphasis: 'auto',
    emphBg: true, emphBgColor: '#FF3B3B', emphColor: '#FFFFFF', emphScale: 1.15, bgRadius: 8, bgPadX: 12, bgPadY: 4,
    animIn: 'pop', maxWords: 4, vOffset: 22,
  }),
  T('unboxing', 'Unboxing', 'ugc', 'Dark card, words rise in, gold accent', {
    font: 'Outfit-Black', size: 64, bg: 'block', bgColor: '#111111', bgOpacity: 0.86, bgRadius: 18, bgPadX: 22,
    bgPadY: 12, highlight: 'color', hlColor: '#FFD84D', reveal: true, wordIn: 'rise', maxWords: 5, vOffset: 18,
  }),

  // Corporate & professional
  T('boardroom', 'Boardroom', 'corporate', 'Navy bars, calm and legible', {
    font: 'Inter-Bold', size: 50, bg: 'line', bgColor: '#0B1F3A', bgOpacity: 0.88, bgRadius: 6, bgPadX: 16, bgPadY: 8,
    animIn: 'fade', animOut: 'fade', maxWords: 9, width: 72, vOffset: 9,
  }),
  T('lower-third', 'Lower third', 'corporate', 'Left-aligned white strap', {
    font: 'Manrope-ExtraBold', size: 52, color: '#0B1F3A', align: 'left', hPos: 'left', hOffset: 6, bg: 'block',
    bgColor: '#FFFFFF', bgOpacity: 1, bgRadius: 4, bgPadX: 20, bgPadY: 10, animIn: 'rise', maxWords: 8, maxLines: 1,
    width: 60, vOffset: 10,
  }),
  T('keynote', 'Keynote', 'corporate', 'Clean type, brand-colour keyword', {
    font: 'DMSans-Black', size: 60, shadowY: 3, shadowBlur: 10, shadowOpacity: 0.45, emphasis: 'auto',
    emphColor: '#8B7BFF', animIn: 'fade', maxWords: 7, vOffset: 12,
  }),

  // Expressive & experimental
  T('neon', 'Neon sign', 'experimental', 'Pink tube glow, cyan active word', {
    font: 'BricolageGrotesque-SemiBold', size: 80, outline: 2, outlineColor: '#FF4FD8', glow: 14, glowColor: '#FF4FD8',
    glowOpacity: 0.85, highlight: 'color', hlColor: '#7DF9FF', animIn: 'blur', maxWords: 4, vPos: 'middle', vOffset: 10,
  }),
  T('graffiti', 'Graffiti', 'experimental', 'Spray-paint letters, tilted', {
    font: 'SedgwickAveDisplay-Regular', size: 104, color: '#C6FF3D', outline: 6, outlineColor: '#111111', tilt: -4,
    reveal: true, wordIn: 'pop', maxWords: 4, vPos: 'middle', vOffset: 12,
  }),
  T('marker-pen', 'Marker pen', 'experimental', 'Hand-drawn, slightly askew', {
    font: 'PermanentMarker-Regular', size: 80, shadowX: 3, shadowY: 4, shadowOpacity: 0.7, tilt: -2, animIn: 'pop',
    maxWords: 5, vOffset: 18,
  }),
  T('arcade', 'Arcade', 'experimental', 'Retro 3D drop shadow', {
    font: 'Bungee-Regular', size: 80, color: '#FFD23F', shadowX: 5, shadowY: 5, shadowColor: '#E83F6F',
    shadowOpacity: 1, animIn: 'stamp', maxWords: 3, vOffset: 18,
  }),
];

export const DEFAULT_TEMPLATE = 'hormozi';
export const templateById = (id) => TEMPLATES.find((t) => t.id === id);
