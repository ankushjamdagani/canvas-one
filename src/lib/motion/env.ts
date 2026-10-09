import * as React from 'react';
import type { RevealEnv } from './tokens';

const STORAGE_KEY = 'studio:motion';

/** E2E and debugging switch: `localStorage['studio:motion'] = 'off'` makes motion near-instant. */
export function motionOff(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'off';
  } catch {
    return false;
  }
}

export function useMotionEnv(): RevealEnv {
  return React.useSyncExternalStore(subscribe, clientSnapshot, () => SERVER_ENV);
}

const SERVER_ENV: RevealEnv = { reduced: false, off: false, coarse: false };
let currentEnv = SERVER_ENV;
let media: { reduced: MediaQueryList; pointer: MediaQueryList } | undefined;
function mediaQueries() {
  return media ??= { reduced: window.matchMedia('(prefers-reduced-motion: reduce)'), pointer: window.matchMedia('(pointer: coarse)') };
}
function clientSnapshot(): RevealEnv {
  const queries = mediaQueries();
  const off = motionOff();
  const reduced = queries.reduced.matches || off;
  const coarse = queries.pointer.matches;
  if (currentEnv.off !== off || currentEnv.reduced !== reduced || currentEnv.coarse !== coarse) currentEnv = { off, reduced, coarse };
  return currentEnv;
}
function subscribe(listener: () => void) {
  const queries = mediaQueries();
  queries.reduced.addEventListener('change', listener);
  queries.pointer.addEventListener('change', listener);
  return () => { queries.reduced.removeEventListener('change', listener); queries.pointer.removeEventListener('change', listener); };
}
