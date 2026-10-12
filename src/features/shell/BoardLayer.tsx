import * as React from 'react';
import { animate } from 'motion/react';
import { DraftingFrame, DraftingGround } from '@/components/ui/drafting-board';
import { motionOff, useMotionEnv } from '@/lib/motion/env';
import { BOARD, EASE } from '@/lib/motion/tokens';
import { useSkipInitialEntrance } from '@/components/ui/initial-load';

export interface BoardShift {
  dir: -1 | 0 | 1;
  /** Increments on every page change so the same direction can replay. */
  n: number;
}

/**
 * Ground (dots) and double frame behind every page. Mounted once by `RouteShell`, so the
 * frame survives page swaps; only the animated dots fade on the project canvas.
 */
export function BoardLayer({
  visible,
  intro,
  shift,
  paused,
}: {
  visible: boolean;
  /** Decided once at first mount: play the load intro. */
  intro: boolean;
  shift: BoardShift;
  paused: boolean;
}) {
  const env = useMotionEnv();
  const skipInitialEntrance = useSkipInitialEntrance();
  const playIntro = intro && !env.reduced;
  const fadeSeconds = env.off ? 0.001 : env.reduced ? 0.12 : BOARD.fadeOut;
  const [mounted, setMounted] = React.useState(visible);
  React.useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), fadeSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [visible, fadeSeconds]);
  const dots = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    if (!playIntro || skipInitialEntrance() || window.matchMedia('(prefers-reduced-motion: reduce)').matches || motionOff()) return;
    const d = dots.current;
    const f = frame.current;
    if (!d || !f) return;
    const controls = [
      animate(d, { opacity: [0, 1], scale: [BOARD.dotsScale, 1] }, { duration: BOARD.dotsIntro, ease: EASE.enter }),
      ...Array.from(f.querySelectorAll<HTMLElement>('.drafting-frame-side')).map((side) =>
        animate(side, { [side.classList.contains('drafting-frame-top') || side.classList.contains('drafting-frame-bottom') ? 'scaleX' : 'scaleY']: [0, 1] },
          { duration: BOARD.frameIntro, delay: BOARD.frameDelay, ease: EASE.inOut })),
      animate(f.querySelector<HTMLElement>('.drafting-frame-ring')!, { opacity: [0, 1], scale: [0.995, 1] },
        { duration: BOARD.ringDuration, delay: BOARD.ringDelay, ease: EASE.enter }),
    ];
    return () => {
      controls.forEach((c) => c.stop());
      d.style.opacity = '1';
      d.style.transform = '';
      f.querySelectorAll<HTMLElement>('.drafting-frame-side, .drafting-frame-ring').forEach((el) => {
        el.style.transform = '';
        el.style.opacity = '1';
      });
    };
  }, [playIntro, skipInitialEntrance]);

  React.useEffect(() => {
    if (!shift.n || env.reduced) return;
    const d = dots.current;
    if (!d) return;
    const control = animate(
      d,
      { y: [0, 0, -BOARD.shiftPx * shift.dir], opacity: [1, 0.35, 1] },
      { duration: BOARD.shiftDuration, ease: EASE.inOut, times: [0, 0.45, 1] },
    );
    // The grid repeats every 24 px, so snapping back is invisible.
    void control.then(() => {
      d.style.transform = '';
    });
    return () => {
      control.stop();
      d.style.opacity = '1';
      d.style.transform = '';
    };
  }, [shift.n, shift.dir, env.reduced, mounted]);

  // Frame choreography continues even after the hidden dot canvas is released.
  React.useEffect(() => {
    if (!shift.n || env.reduced) return;
    const ring = frame.current?.querySelector<HTMLElement>('.drafting-frame-ring');
    if (!ring) return;
    const control = animate(ring, { opacity: [1, 0.25, 1] }, {
      duration: BOARD.shiftDuration, ease: EASE.inOut, times: [0, 0.45, 1],
    });
    return () => {
      control.stop();
      ring.style.opacity = '1';
    };
  }, [shift.n, env.reduced]);

  return (
    <div
      data-testid="route-board"
      data-intro={String(playIntro)}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      <div className="fixed inset-0 z-0 transition-opacity" style={{ opacity: visible ? 1 : 0, transitionDuration: `${fadeSeconds}s` }}>
        {mounted && <div ref={dots} className="absolute inset-0" style={{ opacity: 1 }}>
          <DraftingGround paused={paused || !visible} pointerSource="document" />
        </div>}
      </div>
      <div ref={frame} data-testid={visible ? 'route-frame' : 'workspace-frame'} className={`fixed inset-0 z-20 ${visible ? '' : 'max-[999px]:hidden'}`}>
        <DraftingFrame />
      </div>
    </div>
  );
}
