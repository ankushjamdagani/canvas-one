import * as React from 'react';
import { useReducedMotion } from 'motion/react';
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
  const prefersReduced = useReducedMotion() ?? false;
  return React.useMemo(() => {
    const off = motionOff();
    const coarse = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
    return { reduced: prefersReduced || off, off, coarse };
  }, [prefersReduced]);
}
