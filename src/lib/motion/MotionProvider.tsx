import * as React from 'react';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';

/** One feature bundle (`domAnimation`) for the whole app; `m` components only (`strict`). */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
