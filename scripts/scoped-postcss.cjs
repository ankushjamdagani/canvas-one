const prefixSelector = require('postcss-prefix-selector');
const transform = require('./scoped-selector.cjs');
/** Scope utilities, resets and vendor rules; leave keyframes and font faces intact. */
module.exports = () => prefixSelector({
  prefix: '.canvas-one-root',
  transform,
});
module.exports.postcss = true;
