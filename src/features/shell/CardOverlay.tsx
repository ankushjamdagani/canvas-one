import * as React from 'react';
import { animate } from 'motion/react';
import { CARD, EASE } from '@/lib/motion/tokens';
import { finalInset, insetClip, type Inset } from './overlayGeometry';

export type OverlayStage = 'grow' | 'hold' | 'fade' | 'cancel';
export interface OverlayState {
  bg: string;
  radius: number;
  inset: Inset;
  stage: OverlayStage;
}

/** Solid copy of the clicked card that grows to the sheet, then fades over the entering canvas. */
export function CardOverlay({
  state,
  onGrown,
  onDone,
}: {
  state: OverlayState;
  onGrown: () => void;
  onDone: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const from = insetClip(state.inset, state.radius);
  const to = insetClip(finalInset(window.innerWidth), 0);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active = true;
    if (state.stage === 'grow') {
      el.style.clipPath = from;
      el.style.opacity = '1';
      const c = animate(el, { clipPath: [from, to] }, { duration: CARD.growDuration, delay: CARD.growDelay, ease: EASE.inOut });
      void c.then(() => { if (active) onGrown(); });
      return () => { active = false; c.stop(); };
    }
    if (state.stage === 'fade') {
      const c = animate(el, { opacity: [1, 0] }, { duration: CARD.fadeDuration, ease: EASE.fade });
      void c.then(() => { if (active) onDone(); });
      return () => { active = false; c.stop(); };
    }
    if (state.stage === 'cancel') {
      const c = animate(el, { clipPath: from }, { duration: CARD.cancelDuration, ease: EASE.inOut });
      void c.then(() => { if (active) onDone(); });
      return () => { active = false; c.stop(); };
    }
    // `hold` keeps the final clip; the shell moves to `fade` when the workspace is ready.
  }, [state.stage, from, to, onGrown, onDone]);

  return (
    <div
      ref={ref}
      data-testid="route-card-overlay"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[100]"
      style={{ background: state.bg }}
    />
  );
}
