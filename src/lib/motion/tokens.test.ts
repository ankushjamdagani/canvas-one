import { describe, expect, it } from 'vitest';
import { BOARD, EASE, revealSpec } from './tokens';

const scope = { contentCount: 3, baseDelay: 0 };
const full = { reduced: false, off: false, coarse: false };

describe('motion tokens', () => {
  it('keeps the showcase easings', () => {
    expect(EASE.enter).toEqual([0.22, 1, 0.36, 1]);
    expect(EASE.exit).toEqual([0.55, 0, 0.75, 0.2]);
    expect(EASE.inOut).toEqual([0.65, 0, 0.35, 1]);
  });

  it('staggers content by 70 ms and rises 18 px with 8 px blur', () => {
    const s = revealSpec('content', 'enter', 2, scope, full);
    expect(s).toMatchObject({ y: 18, blur: 8, duration: 0.9 });
    expect(s.delay).toBeCloseTo(0.14, 5);
  });

  it('starts chrome after all content: contentCount*70 + 260 ms, then 55 ms apart', () => {
    const s = revealSpec('chrome', 'enter', 1, scope, full);
    expect(s).toMatchObject({ y: -10, blur: 4, duration: 0.7 });
    expect(s.delay).toBeCloseTo(3 * 0.07 + 0.26 + 0.055, 5);
  });

  it('adds the shell base delay to enters but not exits', () => {
    const base = { contentCount: 1, baseDelay: 1.4 };
    expect(revealSpec('content', 'enter', 0, base, full).delay).toBeCloseTo(1.4, 5);
    expect(revealSpec('content', 'exit', 0, base, full)).toMatchObject({ y: -16, blur: 6, duration: 0.42, delay: 0 });
    expect(revealSpec('chrome', 'exit', 2, base, full).delay).toBeCloseTo(0.044, 5);
  });

  it('drops blur on coarse pointers', () => {
    expect(revealSpec('content', 'enter', 0, scope, { ...full, coarse: true }).blur).toBe(0);
  });

  it('collapses to a short opacity fade when reduced, and to ~zero when off', () => {
    expect(revealSpec('content', 'enter', 4, scope, { ...full, reduced: true })).toEqual({ y: 0, blur: 0, duration: 0.12, delay: 0 });
    expect(revealSpec('chrome', 'exit', 4, scope, { reduced: true, off: true, coarse: false })).toEqual({ y: 0, blur: 0, duration: 0.001, delay: 0 });
  });

  it('exposes the board intro timeline', () => {
    expect(BOARD).toMatchObject({ dotsIntro: 1.3, frameIntro: 1, frameDelay: 0.45, pageDelay: 1.4, shiftPx: 24, shiftDuration: 1.1, shiftDelay: 0.22 });
  });
});
