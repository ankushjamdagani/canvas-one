import * as React from 'react';
import { animate } from 'motion/react';
import { DraftingFrame, DraftingGround } from '@/components/ui/drafting-board';
import { cn } from '@/lib/utils';
import { useMotionEnv } from '@/lib/motion/env';
import { BOARD, EASE } from '@/lib/motion/tokens';

export interface BoardShift {
  dir: -1 | 0 | 1;
  /** Increments on every page change so the same direction can replay. */
  n: number;
}

/**
 * Ground (dots) and double frame behind every page. Mounted once by `RouteShell`, so the
 * board survives page swaps; it fades out on the project canvas, which paints its own sheet.
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
  const playIntro = intro && !env.reduced;
  // Once faded out on the project canvas the ground stops running and leaves the DOM.
  const [mounted, setMounted] = React.useState(visible);
  React.useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), BOARD.fadeOut * 1000);
    return () => window.clearTimeout(id);
  }, [visible]);
  const dots = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!playIntro) return;
    const d = dots.current;
    const f = frame.current;
    if (!d || !f) return;
    const controls = [
      animate(d, { opacity: [0, 1], scale: [BOARD.dotsScale, 1] }, { duration: BOARD.dotsIntro, ease: EASE.enter }),
      animate(
        f,
        { opacity: [0, 1], clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'] },
        { duration: BOARD.frameIntro, delay: BOARD.frameDelay, ease: EASE.inOut },
      ),
    ];
    void controls[1].then(() => {
      f.style.clipPath = '';
    });
    return () => controls.forEach((c) => c.stop());
  }, [playIntro]);

  React.useEffect(() => {
    if (!shift.n || env.reduced) return;
    const d = dots.current;
    const f = frame.current;
    if (!d || !f) return;
    const controls = [
      animate(
        d,
        { y: [0, 0, -BOARD.shiftPx * shift.dir], opacity: [1, 0.35, 1] },
        { duration: BOARD.shiftDuration, ease: EASE.inOut, times: [0, 0.45, 1] },
      ),
      animate(f, { opacity: [1, 0.25, 1] }, { duration: BOARD.shiftDuration, ease: EASE.inOut, times: [0, 0.45, 1] }),
    ];
    // The grid repeats every 24 px, so snapping back is invisible.
    void controls[0].then(() => {
      d.style.transform = '';
    });
    return () => controls.forEach((c) => c.stop());
  }, [shift.n, shift.dir, env.reduced]);

  return (
    <div
      data-testid="route-board"
      data-intro={String(playIntro)}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 z-0 transition-opacity',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ transitionDuration: `${BOARD.fadeOut}s` }}
    >
      {mounted && (
        <>
          <div ref={dots} className="absolute inset-0" style={{ opacity: playIntro ? 0 : 1 }}>
            <DraftingGround paused={paused || !visible} pointerSource="document" />
          </div>
          <div ref={frame} className="absolute inset-0" style={{ opacity: playIntro ? 0 : 1 }}>
            <DraftingFrame />
          </div>
        </>
      )}
    </div>
  );
}
