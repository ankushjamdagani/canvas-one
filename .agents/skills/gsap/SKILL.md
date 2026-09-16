---
name: gsap
description: Official GSAP AI skill suite for GreenSock Animation Platform. Covers gsap.to(), from(), fromTo(), timeline(), ScrollTrigger, @gsap/react (useGSAP), plugins (Flip, Draggable, etc.), performance optimization, and utils.
license: MIT
---

# GSAP (GreenSock Animation Platform)

Official GreenSock animation skill suite for performant web animations, UI micro-interactions, timelines, and scroll-driven experiences.

## Modules in this Suite
- **gsap-core**: Core API — `gsap.to()`, `gsap.from()`, `gsap.fromTo()`, easing, durations, staggers, and `gsap.matchMedia()`.
- **gsap-react**: Official React integration using `@gsap/react` and `useGSAP()` hook with automatic scoping and cleanup.
- **gsap-timeline**: Sequencing animations with `gsap.timeline()`, position parameter (`"<"`, `"+=0.2"`), labels, and nesting.
- **gsap-scrolltrigger**: Scroll-driven animation, parallax, scrubbing, pinning, and viewport triggers.
- **gsap-plugins**: ScrollToPlugin, Flip, Draggable, Observer, SplitText, ScrambleText, etc.
- **gsap-performance**: GPU transforms (`x`, `y`, `scale`), will-change, avoiding layout thrashing.
- **gsap-utils**: Helper utilities (`clamp`, `mapRange`, `normalize`, `interpolate`, `random`, `snap`, `toArray`, `wrap`).

## React Quick Reference (@gsap/react)
```tsx
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useRef } from 'react';

export function AnimatedBox() {
  const container = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.to('.box', { x: 100, duration: 1, ease: 'power2.out' });
  }, { scope: container });

  return (
    <div ref={container}>
      <div className="box">Animated</div>
    </div>
  );
}
```

See the dedicated skills (`gsap-core`, `gsap-react`, `gsap-timeline`, `gsap-scrolltrigger`, `gsap-performance`) for in-depth rules and architecture patterns.
