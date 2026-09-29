import * as React from 'react';

/**
 * Code-split component without Suspense. React.lazy suspends on first render even when
 * its chunk is already cached, and React throttles Suspense reveals (~300 ms), which made
 * opening a project noticeably slower. This keeps the loaded component in a module-level
 * slot: once `preload()` has resolved, every render is synchronous; before that, the
 * `fallback` renders until the chunk arrives.
 */
export type LazyComponent<P extends object> = React.FC<P> & {
  /** Starts (or reuses) the chunk download; resolves once the component is available. */
  preload: () => Promise<React.ComponentType<P>>;
};

export function lazyComponent<P extends object>(
  load: () => Promise<React.ComponentType<P>>,
  fallback: React.ReactNode,
): LazyComponent<P> {
  let loaded: React.ComponentType<P> | null = null;
  let pending: Promise<React.ComponentType<P>> | null = null;
  const preload = () => {
    pending ??= load().then((component) => (loaded = component));
    return pending;
  };

  function LazyComponentView(props: P) {
    const [Component, setComponent] = React.useState<React.ComponentType<P> | null>(() => loaded);
    React.useEffect(() => {
      if (Component) return;
      let alive = true;
      void preload().then((component) => {
        if (alive) setComponent(() => component);
      });
      return () => {
        alive = false;
      };
    }, [Component]);
    return Component ? <Component {...props} /> : <>{fallback}</>;
  }

  return Object.assign(LazyComponentView, { preload });
}

/** Runs `task` when the browser is idle (or on the next tick where idle callbacks are unsupported). */
export function whenIdle(task: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task);
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 1);
  return () => window.clearTimeout(id);
}
