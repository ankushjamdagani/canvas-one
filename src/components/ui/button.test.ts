import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from './button';

const render = (props: React.ComponentProps<typeof Button>) =>
  renderToStaticMarkup(React.createElement(Button, props));

describe('Button loading state', () => {
  it('shows a spinner, sets aria-busy and disables a native button', () => {
    const html = render({ loading: true, children: 'Save' });
    expect(html).toMatch(/^<button[^>]*aria-busy="true"/);
    expect(html).toContain('disabled=""');
    expect(html).toContain('animate-spin');
    expect(html).toContain('Save');
  });

  it('renders the spinner inside an asChild element and marks it aria-disabled', () => {
    const html = render({
      loading: true,
      asChild: true,
      children: React.createElement('a', { href: '/runs' }, 'Open runs'),
    });
    // One anchor, carrying the button attributes, with the spinner and label inside it.
    expect(html).toMatch(/^<a[^>]*href="\/runs"[^>]*>/);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('<button');
    expect(html).toMatch(/<a[^>]*>.*animate-spin.*Open runs<\/a>$/);
  });

  it('shows no spinner when not loading', () => {
    expect(render({ children: 'Save' })).not.toContain('animate-spin');
    expect(render({ asChild: true, children: React.createElement('a', { href: '/x' }, 'Go') })).not.toContain('animate-spin');
  });
});
