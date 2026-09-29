import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Input } from './input';
import { Textarea } from './textarea';

// Design System board: a field rests on shell and turns white once it holds a value.
// The fill rule keys on :placeholder-shown, which needs a placeholder attribute, so fields
// without one get an invisible single-space placeholder.
describe.each([
  ['Input', Input],
  ['Textarea', Textarea],
] as const)('%s filled state', (_name, Component) => {
  const render = (props: Record<string, unknown>) =>
    renderToStaticMarkup(React.createElement(Component as React.ElementType, props));

  it('adds an invisible placeholder when none is given', () => {
    expect(render({ 'aria-label': 'Name' })).toContain('placeholder=" "');
  });

  it('keeps an authored placeholder', () => {
    const html = render({ 'aria-label': 'Name', placeholder: 'Project name' });
    expect(html).toContain('placeholder="Project name"');
  });

  it('turns white only when the placeholder is not shown (i.e. the field has a value)', () => {
    const html = render({ 'aria-label': 'Name' });
    expect(html).toContain('bg-shell');
    expect(html).toContain('[&amp;[placeholder]:not(:placeholder-shown)]:bg-background');
  });
});
