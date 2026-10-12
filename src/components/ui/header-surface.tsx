import { useIsPresent } from 'motion/react';
import { useMotionEnv } from '@/lib/motion/env';
import { useBoardFrameReady } from '@/lib/motion/shell-context';
import { useSkipInitialEntrance } from './initial-load';

/** Header material fades only after the persistent page frame settles. */
export function HeaderSurface() {
  const ready = useBoardFrameReady();
  const env = useMotionEnv();
  const skip = useSkipInitialEntrance();
  const present = useIsPresent();
  const visible = present && (ready || env.reduced || skip());
  return <span aria-hidden="true" data-header-surface className="public-header-surface" style={{
    opacity: visible ? 1 : 0,
    transition: env.reduced || !visible && present ? 'none' : `opacity ${present ? 0.7 : 0.42}s cubic-bezier(0.22, 1, 0.36, 1)`,
  }} />;
}
