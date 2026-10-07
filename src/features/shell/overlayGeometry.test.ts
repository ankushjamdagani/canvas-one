import { describe, expect, it } from 'vitest';
import { finalInset, insetClip, insetFromRect, opaqueColor } from './overlayGeometry';

describe('overlay geometry', () => {
  it('converts a client rect to viewport insets', () => {
    expect(insetFromRect({ left: 100, top: 200, right: 300, bottom: 360 }, 1000, 800)).toEqual({
      top: 200,
      left: 100,
      right: 700,
      bottom: 440,
    });
  });

  it('clamps a card scrolled partly off screen', () => {
    expect(insetFromRect({ left: -20, top: 700, right: 300, bottom: 900 }, 1000, 800)).toEqual({
      top: 700,
      left: 0,
      right: 700,
      bottom: 0,
    });
  });

  it('formats a rounded inset clip-path', () => {
    expect(insetClip({ top: 1, right: 2, bottom: 3, left: 4 }, 9)).toBe('inset(1px 2px 3px 4px round 9px)');
  });

  it('ends at the frame inset on wide viewports and full-bleed on narrow ones', () => {
    expect(finalInset(1440)).toEqual({ top: 22, right: 22, bottom: 22, left: 22 });
    expect(finalInset(800)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('replaces transparent backgrounds with the card colour', () => {
    expect(opaqueColor('rgba(0, 0, 0, 0)')).toBe('var(--card, #fff)');
    expect(opaqueColor('rgb(11, 92, 84)')).toBe('rgb(11, 92, 84)');
  });
});
