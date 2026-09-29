import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Alert } from './alert';
import { Badge } from './badge';

describe('semantic warning primitives', () => {
  it('uses warning role tokens for warning and legacy amber badges', () => {
    for (const variant of ['warning', 'amber'] as const) {
      const html = renderToStaticMarkup(
        React.createElement(Badge, { variant }, 'Needs review'),
      );

      expect(html).toContain('border-warning-edge');
      expect(html).toContain('bg-warning-tint');
      expect(html).toContain('text-warning-text');
      expect(html).not.toMatch(/amber-\d/);
    }
  });

  it('uses warning role tokens for warning alerts', () => {
    const html = renderToStaticMarkup(
      React.createElement(Alert, { variant: 'warning' }, 'Needs review'),
    );

    expect(html).toContain('border-warning-edge');
    expect(html).toContain('bg-warning-tint');
    expect(html).toContain('text-warning-text');
    expect(html).toContain('[&amp;&gt;svg]:text-warning');
    expect(html).not.toMatch(/amber-\d/);
  });
});
