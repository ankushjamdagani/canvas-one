import prefixSelector from 'postcss-prefix-selector';
import transform from './scoped-selector.cjs';

/** Vite loads ESM plugins; Next loads the CommonJS PostCSS wrapper. */
export function scopedCss() {
  return prefixSelector({ prefix: '.canvas-one-root', transform });
}
