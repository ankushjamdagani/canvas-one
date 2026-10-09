'use client';

import { useEffect } from 'react';

/** Standalone shell only. Embedded CanvasOne delegates offline behavior to its host. */
export function PwaRegistration({ basePath = process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || '' }: { basePath?: string }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const base = basePath.replace(/\/+$/, '');
    // A waiting update activates after existing tabs close. Never reload an active canvas.
    void navigator.serviceWorker.register(`${base}/sw.js`, {
      scope: `${base}/`,
      updateViaCache: 'none',
    }).catch((error: unknown) => {
      console.warn('Canvas One offline setup failed; the online workspace remains available.', error);
    });
  }, [basePath]);
  return null;
}
