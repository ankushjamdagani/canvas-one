import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute } from './router';

describe('router', () => {
  it('parses home, project and branch paths', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
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
    for (const path of ['/', '/projects', '/project/p1', '/project/p1/branch/b%202']) {
      expect(formatRoute(parseRoute(path)!)).toBe(path);
    }
  });
});
