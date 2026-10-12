import * as React from 'react';
import { CanvasOneFace } from './canvas-one-face';
import { useMotionEnv } from '@/lib/motion/env';
import { cn } from '@/lib/utils';

export const LOADING_FACE_SIZE = 128;

/** Shared visual loading state; the label remains available to screen readers. */
export function LoadingFace({ label = 'Loading Canvas One', className, ...props }: React.HTMLAttributes<HTMLDivElement> & { label?: string }) {
  const env = useMotionEnv();
  return (
    <div {...props} role="status" aria-label={label} className={cn('loading-face', className)}>
      <CanvasOneFace size={LOADING_FACE_SIZE} expression="wink" transition={false} animate={!env.reduced} />
    </div>
  );
}
