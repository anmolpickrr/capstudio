// Caption templates. Sizes are in px for a 1080px short side (see geometry()).
export const BASE_STYLE = {
  fontId: 'Poppins-Bold',
  size: 56,
  color: '#FFFFFF',
  highlightColor: '#FFE600',
  outline: 3,
  outlineColor: '#000000',
  shadow: 0,
  shadowColor: '#000000',
  shadowOpacity: 0.6,
  blur: 0,
  box: false,
  boxColor: '#000000',
  boxOpacity: 0.7,
  boxPadding: 10,
  letterSpacing: 0,
  textCase: 'none',
  stripPunctuation: false,
  placement: 'bottom',
  offset: 8,
  animation: 'none',
  wordEffect: 'none',
  maxWords: 10,
  maxCharsPerLine: 38,
  maxLines: 2,
};

export const TEMPLATES = [
  {
    id: 'clean', name: 'Clean Subtitle', tag: 'Broadcast',
    style: { fontId: 'NotoSans-Bold', size: 50, outline: 3, maxCharsPerLine: 42, maxWords: 14 },
  },
  {
    id: 'cinema', name: 'Cinema', tag: 'Film',
    style: { fontId: 'NotoSans-Regular', size: 48, outline: 1.5, shadow: 3, shadowOpacity: 0.7, offset: 7, maxCharsPerLine: 42, maxWords: 14, animation: 'fade' },
  },
  {
    id: 'boxed', name: 'Boxed', tag: 'Accessible',
    style: { fontId: 'Poppins-SemiBold', size: 48, outline: 0, box: true, boxOpacity: 0.75, boxPadding: 12, maxCharsPerLine: 36, offset: 9 },
  },
  {
    id: 'bold-pop', name: 'Bold Pop', tag: 'Reels / Shorts',
    style: {
      fontId: 'Poppins-Black', size: 82, outline: 7, shadow: 4, shadowOpacity: 0.5, textCase: 'upper', stripPunctuation: true,
      highlightColor: '#FFE600', wordEffect: 'highlight', animation: 'pop', maxWords: 3, maxCharsPerLine: 16, maxLines: 2,
      placement: 'bottom', offset: 28,
    },
  },
  {
    id: 'karaoke', name: 'Karaoke Fill', tag: 'Word sync',
    style: {
      fontId: 'Poppins-ExtraBold', size: 70, outline: 5, highlightColor: '#3DFF7A', wordEffect: 'progressive',
      maxWords: 6, maxCharsPerLine: 24, offset: 22, stripPunctuation: true,
    },
  },
  {
    id: 'one-word', name: 'One Word', tag: 'Punchy',
    style: {
      fontId: 'Anton-Regular', size: 128, outline: 8, textCase: 'upper', stripPunctuation: true, animation: 'pop',
      maxWords: 1, maxCharsPerLine: 14, maxLines: 1, placement: 'middle', offset: 12,
    },
  },
  {
    id: 'typewriter', name: 'Typewriter', tag: 'Word reveal',
    style: {
      fontId: 'Poppins-Bold', size: 64, outline: 0, box: true, boxOpacity: 0.85, boxPadding: 14,
      wordEffect: 'reveal', maxWords: 6, maxCharsPerLine: 22, offset: 22,
    },
  },
  {
    id: 'neon', name: 'Neon Glow', tag: 'Night',
    style: {
      fontId: 'Poppins-Bold', size: 70, color: '#FFFFFF', outline: 5, outlineColor: '#00E5FF', blur: 6,
      highlightColor: '#FF4FD8', wordEffect: 'highlight', animation: 'zoom', maxWords: 4, maxCharsPerLine: 18, offset: 24,
      textCase: 'upper', stripPunctuation: true,
    },
  },
  {
    id: 'news', name: 'News Strap', tag: 'Lower third',
    style: {
      fontId: 'BebasNeue-Regular', size: 72, color: '#111111', outline: 0, box: true, boxColor: '#FFD400', boxOpacity: 1,
      boxPadding: 12, letterSpacing: 2, textCase: 'upper', animation: 'slide', maxCharsPerLine: 40, maxLines: 1, offset: 10,
    },
  },
  {
    id: 'minimal', name: 'Minimal', tag: 'Aesthetic',
    style: {
      fontId: 'Poppins-Medium', size: 52, outline: 0, shadow: 2, shadowOpacity: 0.55, textCase: 'lower', stripPunctuation: true,
      animation: 'fade', maxWords: 5, maxCharsPerLine: 26, offset: 14,
    },
  },
  {
    id: 'comic', name: 'Comic', tag: 'Fun',
    style: {
      fontId: 'Bangers-Regular', size: 90, color: '#FFE600', outline: 7, letterSpacing: 2, shadow: 6, shadowOpacity: 1,
      highlightColor: '#FF3B3B', wordEffect: 'highlight', animation: 'pop', maxWords: 3, maxCharsPerLine: 16, offset: 22,
      textCase: 'upper',
    },
  },
  {
    id: 'desi', name: 'Desi Bold', tag: 'Hindi / Hinglish',
    style: {
      fontId: 'Mukta-ExtraBold', size: 78, outline: 6, highlightColor: '#FF9F1C', wordEffect: 'highlight', animation: 'pop',
      maxWords: 4, maxCharsPerLine: 20, offset: 24,
    },
  },
];

export function templateStyle(id) {
  const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
  return { ...BASE_STYLE, ...t.style };
}
