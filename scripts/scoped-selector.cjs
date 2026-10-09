/** Shared by Next and Vite; preserve keyframes and already-scoped selectors. */
module.exports = function scopedSelector(prefix, selector, prefixed, _file, rule) {
  if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return selector;
  if (selector.startsWith('.canvas-one-root')) return selector;
  return /^(?::root|:host|html|body)(?=\b|\s|$|:|\[)/.test(selector)
    ? selector.replace(/^(?::root|:host|html|body)/, prefix)
    : prefixed;
};
