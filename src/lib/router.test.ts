import { describe, expect, it, vi } from 'vitest';
import { acquireRouter, formatRoute, navigate, normalizeBasePath, parseRoute } from './router';

describe('router', () => {
  it('parses home, project and branch paths', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('/brand')).toEqual({ kind: 'brand' });
    expect(parseRoute('/projects')).toEqual({ kind: 'projects' });
    expect(parseRoute('/project/p1')).toEqual({ kind: 'project', projectId: 'p1', branchId: null });
    expect(parseRoute('/project/p1/branch/b%202')).toEqual({ kind: 'project', projectId: 'p1', branchId: 'b 2' });
  });

  it('rejects unknown paths', () => {
    expect(parseRoute('/nope')).toBeNull();
    expect(parseRoute('/project')).toBeNull();
    expect(parseRoute('/project/p1/branch')).toBeNull();
    expect(parseRoute('/project/p1/other/x')).toBeNull();
  });

  it('round-trips through formatRoute', () => {
    for (const path of ['/', '/brand', '/projects', '/project/p1', '/project/p1/branch/b%202']) {
      expect(formatRoute(parseRoute(path)!)).toBe(path);
    }
  });

  it('scopes embedded routes to a complete path prefix', () => {
    expect(parseRoute('/tools/canvas', '/tools/canvas')).toEqual({ kind: 'home' });
    expect(parseRoute('/tools/canvas/project/p%20one/branch/b%2Ftwo', '/tools/canvas')).toEqual({
      kind: 'project', projectId: 'p one', branchId: 'b/two',
    });
    expect(parseRoute('/projects', '/tools/canvas')).toBeNull();
    expect(parseRoute('/tools/canvas-other/projects', '/tools/canvas')).toBeNull();
    expect(formatRoute({ kind: 'projects' }, '/tools/canvas/')).toBe('/tools/canvas/projects');
  });

  it('validates prefixes and normalizes root and trailing slashes', () => {
    expect(normalizeBasePath('/')).toBe('');
    expect(normalizeBasePath('/canvas/')).toBe('/canvas');
    for (const prefix of ['canvas', '//canvas', '/canvas?x=1', '/canvas#x', '/a/../b', '/a%2Fb']) {
      expect(() => normalizeBasePath(prefix)).toThrow(TypeError);
    }
  });

  it('owns controller routing until unmount and prevents simultaneous ownership', () => {
    const release = acquireRouter('/canvas');
    try {
      expect(formatRoute({ kind: 'brand' })).toBe('/canvas/brand');
      expect(parseRoute('/canvas/projects')).toEqual({ kind: 'projects' });
      expect(() => acquireRouter('/other')).toThrow('Only one');
    } finally {
      release();
      release();
    }
    expect(formatRoute({ kind: 'projects' })).toBe('/projects');
    const releaseAgain = acquireRouter('/other');
    release();
    expect(formatRoute({ kind: 'home' })).toBe('/other/');
    releaseAgain();
  });

  it('keeps host history state while navigating within the configured mount', () => {
    const state = { __NA: true, host: 'retained' };
    const pushState = vi.fn();
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/canvas/' },
      history: { state, pushState, replaceState },
    });
    const release = acquireRouter('/canvas');
    try {
      navigate({ kind: 'projects' });
      const { __NA: _nextMarker, ...customState } = state;
      expect(pushState).toHaveBeenCalledWith(customState, '', '/canvas/projects');
      navigate({ kind: 'brand' }, { replace: true });
      expect(replaceState).toHaveBeenCalledWith(customState, '', '/canvas/brand');
      navigate({ kind: 'home' });
      expect(pushState).toHaveBeenCalledTimes(1);
    } finally {
      release();
      vi.unstubAllGlobals();
    }
  });

  it('opens projects at the embedded root and uses document navigation for public pages', () => {
    const assign = vi.fn();
    const replace = vi.fn();
    const pushState = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/canvas/project/p1', assign, replace },
      history: { state: null, pushState, replaceState: vi.fn() },
    });
    const release = acquireRouter('/canvas', { entryRoute: 'projects', publicNavigation: 'document' });
    try {
      expect(parseRoute('/canvas/')).toEqual({ kind: 'projects' });
      navigate({ kind: 'brand' });
      expect(assign).toHaveBeenCalledWith('/canvas/brand');
      navigate({ kind: 'home' }, { replace: true });
      expect(replace).toHaveBeenCalledWith('/canvas/');
      navigate({ kind: 'projects' });
      expect(pushState).toHaveBeenCalledWith({}, '', '/canvas/projects');
    } finally {
      release();
      vi.unstubAllGlobals();
    }
  });
});
