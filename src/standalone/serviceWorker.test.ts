import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';

async function worker(basePath = '') {
  // Evaluate generated source rather than duplicating the worker's routing rules.
  const generatorPath = '../../scripts/build-service-worker.mjs';
  const { serviceWorkerSource } = await import(generatorPath);
  const handlers = new Map<string, (event: unknown) => void>();
  const matches: string[] = [];
  const additions: string[][] = [];
  const cache = {
    addAll: async (urls: string[]) => { additions.push(urls); },
    match: async (url: string) => { matches.push(url); return 'cached'; },
  };
  runInNewContext(serviceWorkerSource({ basePath, version: 'test', assets: [`${basePath}/_next/static/lazy.js`] }), {
    URL, Response,
    self: { location: { origin: 'https://canvas.test' }, addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler) },
    caches: { open: async () => cache },
    fetch: async () => { throw new Error('Offline'); },
  });
  return { handlers, matches, additions };
}

describe('standalone offline worker', () => {
  it('precaches public shells and lazy assets inside its base path', async () => {
    const instance = await worker('/canvas');
    let installation: Promise<void> | undefined;
    instance.handlers.get('install')!({ waitUntil: (promise: Promise<void>) => { installation = promise; } });
    await installation;
    expect(Array.from(instance.additions[0])).toEqual(['/canvas/', '/canvas/projects', '/canvas/brand', '/canvas/_next/static/lazy.js']);
  });

  it.each([
    ['', '/project/local-id'],
    ['', '/project/local-id/branch/branch-id'],
    ['/canvas', '/project/local-id'],
    ['/canvas', '/project/local-id/branch/branch-id'],
  ])('reopens local project route %s%s through the projects shell while offline', async (basePath, route) => {
    const instance = await worker(basePath);
    let result: Promise<string> | undefined;
    instance.handlers.get('fetch')!({
      request: { url: `https://canvas.test${basePath}${route}`, method: 'GET', mode: 'navigate', headers: new Headers() },
      respondWith: (promise: Promise<string>) => { result = promise; },
    });
    expect(await result).toBe('cached');
    expect(instance.matches).toEqual([`${basePath}/projects`]);
  });

  it.each([
    ['https://canvas.test/canvas/api/private', 'navigate', {}],
    ['https://canvas.test/other/project/id/branch/branch-id', 'navigate', {}],
    ['https://canvas.test/canvas/projects/local-id', 'navigate', {}],
    ['https://canvas.test/canvas/projects?_rsc=123', 'navigate', {}],
    ['https://canvas.test/canvas/projects', 'cors', { RSC: '1' }],
    ['https://other.test/canvas/projects', 'navigate', {}],
  ])('does not intercept private, outside-scope or RSC requests: %s', async (url, mode, headers) => {
    const instance = await worker('/canvas');
    let intercepted = false;
    instance.handlers.get('fetch')!({
      request: { url, method: 'GET', mode, headers: new Headers(headers) },
      respondWith: () => { intercepted = true; },
    });
    expect(intercepted).toBe(false);
  });

  it('does not activate updates or reload clients during editing', async () => {
    const source = await readFile(new URL('../../scripts/build-service-worker.mjs', import.meta.url), 'utf8');
    expect(source).not.toContain('skipWaiting(');
    expect(source).not.toContain('.navigate(');
  });
});
