// Tool panels. Each panel builds its controls once and refreshes their values
// on edits; it rebuilds only when its layout depends on what changed.
import { captionsPanel } from './captions.js';
import { effectsPanel } from './effects.js';
import { motionPanel } from './motion.js';
import { positionPanel } from './position.js';
import { templatesPanel } from './templates.js';
import { textPanel } from './text.js';
import { watermarkPanel } from './watermark.js';

export const PANELS = {
  templates: templatesPanel,
  text: textPanel,
  effects: effectsPanel,
  motion: motionPanel,
  position: positionPanel,
  watermark: watermarkPanel,
  captions: captionsPanel,
};

export function renderPanel(container, tool) {
  Object.values(PANELS).forEach((p) => p.unmount?.());
  PANELS[tool].mount(container);
}
