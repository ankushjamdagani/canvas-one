import * as React from 'react';

/** Routes the app understands. `branchId: null` means the project's main branch. */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'brand' }
  | { readonly kind: 'projects' }
  | { readonly kind: 'project'; readonly projectId: string; readonly branchId: string | null };

let activeBasePath = '';
const RouterSnapshotContext = React.createContext<{ pathname: string; basePath: string } | null>(null);
export const RouterSnapshotProvider = RouterSnapshotContext.Provider;
let routerOwner: symbol | null = null;
export interface RouterOptions {
  publicNavigation?: 'document' | 'client';
  entryRoute?: 'home' | 'projects';
}
let activeOptions: RouterOptions = {};

/** A URL path prefix, never an origin, query string, or encoded path. */
export function normalizeBasePath(basePath = ''): string {
  if (basePath === '' || basePath === '/') return '';
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\/?$/.test(basePath)) {
    throw new TypeError('Canvas One basePath must contain only URL path segments (for example /tools/canvas).');
  }
  return basePath.replace(/\/$/, '');
}

/** Controllers share one address bar, so only one routed workspace may own it. */
export function acquireRouter(basePath = '', options: RouterOptions = {}): () => void {
  const normalized = normalizeBasePath(basePath);
  if (routerOwner) throw new Error('Only one Canvas One router can be mounted per page.');
  const owner = Symbol('Canvas One router');
  routerOwner = owner;
  activeBasePath = normalized;
  activeOptions = options;
  notify();
  return () => {
    if (routerOwner !== owner) return;
    routerOwner = null;
    activeBasePath = '';
    activeOptions = {};
    notify();
  };
}

export function parseRoute(pathname: string, basePath = activeBasePath): Route | null {
  const prefix = normalizeBasePath(basePath);
  if (prefix && pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  const localPath = prefix ? pathname.slice(prefix.length) : pathname;
  const parts = localPath.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (parts.length === 0) return { kind: basePath === activeBasePath ? activeOptions.entryRoute ?? 'home' : 'home' };
  if (parts.length === 1 && parts[0] === 'brand') return { kind: 'brand' };
  if (parts.length === 1 && parts[0] === 'projects') return { kind: 'projects' };
  if (parts[0] !== 'project' || !parts[1]) return null;
  if (parts.length === 2) return { kind: 'project', projectId: parts[1], branchId: null };
  if (parts.length === 4 && parts[2] === 'branch' && parts[3]) {
    return { kind: 'project', projectId: parts[1], branchId: parts[3] };
  }
  return null;
}

export function formatRoute(route: Route, basePath = activeBasePath): string {
  const prefix = normalizeBasePath(basePath);
  if (route.kind === 'home') return `${prefix}/`;
  if (route.kind === 'brand') return `${prefix}/brand`;
  if (route.kind === 'projects') return `${prefix}/projects`;
  const project = `${prefix}/project/${encodeURIComponent(route.projectId)}`;
  return route.branchId ? `${project}/branch/${encodeURIComponent(route.branchId)}` : project;
}

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const getPathname = () => window.location.pathname;

/** Pushes (or replaces) the browser location; a no-op when already there. */
export function navigate(route: Route, options: { replace?: boolean } = {}) {
  const path = formatRoute(route);
  if (path === window.location.pathname) return;
  if (activeOptions.publicNavigation === 'document' && (route.kind === 'home' || route.kind === 'brand')) {
    if (options.replace) window.location.replace(path);
    else window.location.assign(path);
    return;
  }
  const state = { ...window.history.state };
  // Next's native History API adapter copies its bookkeeping itself. Passing its
  // internal marker back bypasses that adapter and leaves its canonical URL stale.
  delete state.__NA;
  delete state._N;
  if (options.replace) window.history.replaceState(state, '', path);
  else window.history.pushState(state, '', path);
  notify();
}

/** Current route; unknown paths read as home (the app rewrites the URL to `/`). */
export function useRoute(): { route: Route; known: boolean } {
  const snapshot = React.useContext(RouterSnapshotContext);
  const pathname = React.useSyncExternalStore(subscribe, getPathname, () => snapshot?.pathname ?? '/');
  return React.useMemo(() => {
    const parsed = parseRoute(pathname, snapshot?.basePath ?? activeBasePath);
    return { route: parsed ?? { kind: 'home' }, known: parsed !== null };
  }, [pathname, snapshot?.basePath]);
}

/**
 * Turns plain `<a href>` clicks on known app routes into client-side navigations, so the
 * shell can animate between pages instead of the browser reloading the document.
 */
export function useInternalLinks() {
  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      if (routerOwner && !anchor.closest('.canvas-one-root')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.hash || url.search) return;
      const next = parseRoute(url.pathname);
      if (!next) return;
      if (activeOptions.publicNavigation === 'document' && (next.kind === 'home' || next.kind === 'brand')) return;
      event.preventDefault();
      navigate(next);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}
