const prefixSelector = require('postcss-prefix-selector');

function transform(prefix, selector, prefixed, _file, rule) {
  if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return selector;
  if (selector.startsWith('.canvas-one-root')) return selector;
  return /^(?::root|:host|html|body)(?=\b|\s|$|:|\[)/.test(selector)
    ? selector.replace(/^(?::root|:host|html|body)/, prefix)
    : prefixed;
}

/** Scope utilities, resets and vendor rules; leave keyframes and font faces intact. */
module.exports = () => prefixSelector({
  prefix: '.canvas-one-root',
  transform,
});
module.exports.postcss = true;
