export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 100) / 100;

export function insetFromRect(
  rect: { left: number; top: number; right: number; bottom: number },
  vw: number,
  vh: number,
): Inset {
  return {
    top: round(clamp(rect.top, 0, vh)),
    left: round(clamp(rect.left, 0, vw)),
    right: round(clamp(vw - rect.right, 0, vw)),
    bottom: round(clamp(vh - rect.bottom, 0, vh)),
  };
}

export const insetClip = (i: Inset, radius: number) =>
  `inset(${i.top}px ${i.right}px ${i.bottom}px ${i.left}px round ${radius}px)`;

/** The sheet frame sits 22 px in on wide viewports; narrow layouts have no frame. */
export function finalInset(vw: number): Inset {
  const m = vw >= 1000 ? 22 : 0;
  return { top: m, right: m, bottom: m, left: m };
}

export function opaqueColor(css: string): string {
  return css === 'transparent' || css === 'rgba(0, 0, 0, 0)' ? 'var(--card, #fff)' : css;
}
