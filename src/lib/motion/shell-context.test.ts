import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RouteShellContext, ShellReady, useRouteShell, type RouteShellApi } from './shell-context';

function Probe() {
  return React.createElement('i', null, useRouteShell() ? 'in' : 'out');
}

describe('route shell context', () => {
  it('is null outside a shell', () => {
    expect(renderToStaticMarkup(React.createElement(Probe))).toBe('<i>out</i>');
  });

  it('exposes the api inside a shell', () => {
    const api: RouteShellApi = { beginOpen() {}, cancelOpen() {}, markReady() {}, setGroundPaused() {} };
    const html = renderToStaticMarkup(
      React.createElement(RouteShellContext.Provider, { value: api }, React.createElement(Probe), React.createElement(ShellReady)),
    );
    expect(html).toBe('<i>in</i>');
  });
});
