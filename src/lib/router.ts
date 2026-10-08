import * as React from 'react';

/** Routes the app understands. `branchId: null` means the project's main branch. */
export type Route =
  | { readonly kind: 'home' }
  | { readonly kind: 'brand' }
  | { readonly kind: 'projects' }
  | { readonly kind: 'project'; readonly projectId: string; readonly branchId: string | null };

export function parseRoute(pathname: string): Route | null {
  const parts = pathname.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  if (parts.length === 0) return { kind: 'home' };
  if (parts.length === 1 && parts[0] === 'brand') return { kind: 'brand' };
  if (parts.length === 1 && parts[0] === 'projects') return { kind: 'projects' };
  if (parts[0] !== 'project' || !parts[1]) return null;
  if (parts.length === 2) return { kind: 'project', projectId: parts[1], branchId: null };
  if (parts.length === 4 && parts[2] === 'branch' && parts[3]) {
    return { kind: 'project', projectId: parts[1], branchId: parts[3] };
  }
  return null;
}

export function formatRoute(route: Route): string {
  if (route.kind === 'home') return '/';
  if (route.kind === 'brand') return '/brand';
  if (route.kind === 'projects') return '/projects';
  const project = `/project/${encodeURIComponent(route.projectId)}`;
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
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  notify();
}

/** Current route; unknown paths read as home (the app rewrites the URL to `/`). */
export function useRoute(): { route: Route; known: boolean } {
  const pathname = React.useSyncExternalStore(subscribe, getPathname);
  return React.useMemo(() => {
    const parsed = parseRoute(pathname);
    return { route: parsed ?? { kind: 'home' }, known: parsed !== null };
  }, [pathname]);
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
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.hash) return;
      const next = parseRoute(url.pathname);
      if (!next) return;
      event.preventDefault();
      navigate(next);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}
