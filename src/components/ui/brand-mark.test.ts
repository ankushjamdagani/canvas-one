import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  it('is a decorative gradient square', () => {
    const html = renderToStaticMarkup(React.createElement(BrandMark, { className: 'size-5' }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('size-5');
    expect(html).toContain('to-[#2e7d6b]');
  });
});
