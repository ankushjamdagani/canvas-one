import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  it('uses the decorative neutral face for the logo', () => {
    const html = renderToStaticMarkup(React.createElement(BrandMark, { className: 'size-5' }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('size-5');
    expect(html).toContain('data-expression="base"');
    expect(html).toContain('viewBox="0 0 48 48"');
  });
});
