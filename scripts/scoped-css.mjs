import prefixSelector from 'postcss-prefix-selector';

/** Scope utilities, resets and vendor rules; leave keyframes and font faces intact. */
export function scopedCss() {
  return prefixSelector({
    prefix: '.canvas-one-root',
    transform(prefix, selector, prefixed, _file, rule) {
      if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return selector;
      if (selector.startsWith('.canvas-one-root')) return selector;
      return /^(?::root|:host|html|body)(?=\b|\s|$|:|\[)/.test(selector)
        ? selector.replace(/^(?::root|:host|html|body)/, prefix)
        : prefixed;
    },
  });
}
