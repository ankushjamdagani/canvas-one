import * as React from 'react';

/**
 * Side offset that places a header menu below the header bar, `gap` px under its bottom edge,
 * instead of just under its trigger (which sits inside the bar). Radix marks the open trigger
 * with `aria-expanded="true"`, so the trigger is found without threading a ref through `asChild`.
 */
export function useHeaderSideOffset(open: boolean, gap = 8, fallback = 6): number {
  const [offset, setOffset] = React.useState(fallback);
  React.useLayoutEffect(() => {
    if (!open) return;
    const trigger = document.querySelector('header [aria-expanded="true"]');
    const header = trigger?.closest('header');
    if (!trigger || !header) return;
    const below = header.getBoundingClientRect().bottom - trigger.getBoundingClientRect().bottom;
    setOffset(Math.max(fallback, Math.round(below + gap)));
  }, [open, gap, fallback]);
  return offset;
}
