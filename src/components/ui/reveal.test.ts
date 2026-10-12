import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Reveal, RevealScope, revealVariants } from './reveal';

const spec = (y: number, blur: number, duration: number, delay: number) => ({ y, blur, duration, delay });
const custom = { enter: spec(18, 8, 0.9, 0.14), exit: spec(-16, 6, 0.42, 0) };

describe('Reveal', () => {
  it('renders the requested element with its props and no inline hidden style outside a page', () => {
    const html = renderToStaticMarkup(
      React.createElement(Reveal, { as: 'span', className: 'x', 'data-testid': 't' } as never, 'hi'),
    );
    expect(html).toBe('<span class="x" data-testid="t" data-reveal-kind="content" data-reveal-index="0">hi</span>');
  });

  it('inherits unspecified scope fields', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RevealScope,
        { contentCount: 2, baseDelay: 1 },
        React.createElement(RevealScope, { contentCount: 5 }, React.createElement(Reveal, { kind: 'chrome' }, 'a')),
      ),
    );
    expect(html).toContain('a');
  });

  it('keeps routed public content visible in server HTML', () => {
    const html = renderToStaticMarkup(React.createElement(RevealScope, { phase: 'enter', baseDelay: 1.4 },
      React.createElement(Reveal, {}, 'Searchable public content')));
    expect(html).toContain('Searchable public content');
    expect(html).not.toMatch(/opacity:0|visibility:hidden|blur\(/);
  });

  it('hidden/enter/exit variants resolve the spec', () => {
    expect(revealVariants.hidden(custom)).toEqual({ opacity: 0, y: 18, filter: 'blur(8px)' });
    expect(revealVariants.enter(custom)).toMatchObject({
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0.9, delay: 0.14 },
    });
    expect(revealVariants.exit(custom)).toMatchObject({
      opacity: 0,
      y: -16,
      filter: 'blur(6px)',
      transition: { duration: 0.42, delay: 0 },
    });
  });
});
