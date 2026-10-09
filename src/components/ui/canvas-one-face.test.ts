import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CanvasOneFace, FACE_EXPRESSIONS, type FaceExpression } from './canvas-one-face';

const face = (expression:FaceExpression, animate=false) => renderToStaticMarkup(React.createElement(CanvasOneFace, {expression, animate}));

describe('supplied brand face geometry', () => {
  it('keeps every expression on one fixed view box without hidden placeholder shapes', () => {
    for (const expression of Object.keys(FACE_EXPRESSIONS) as FaceExpression[]) {
      const html = face(expression);
      expect(html).toContain('viewBox="0 0 48 48"');
      expect(html).not.toContain('opacity:0;');
      expect(html).not.toContain('height:0.01');
    }
  });
  it('uses the round chat silhouette and authored eye positions', () => {
    const html = face('round');
    expect(html).toContain('M24 6 A18 18 0 1 1 24 42 A18 18 0 1 1 24 6 Z M6 42 V31 L17 42 Z');
    expect(html).toContain('cx="18" cy="23" r="4.5"');
    expect(html).toContain('cx="30" cy="23" r="4"');
    expect(face('listen')).toContain('cx="18" cy="19" r="4.2"');
  });
  it('moves or blinks only the inset pupils while the reading/waiting eyes stay fixed', () => {
    const reading = face('look', true);
    expect(reading).toContain('cx="18" cy="23" r="5.5"');
    expect(reading).toMatch(/<g style="animation:cf-look[^>]*><circle cx="19.6" cy="21.4" r="2.6"/);
    expect(face('wait', true)).toMatch(/<g style="animation:cf-blink[^>]*><circle cx="16.2" cy="23.8" r="2.6"/);
  });
  it('keeps the head inside whole-face error and offline animations', () => {
    expect(face('error', true)).toMatch(/<g style="animation:cf-shake[^>]*><path d="M17 6/);
    expect(face('sleep', true)).toMatch(/<g style="animation:cf-fade[^>]*><path d="M17 6/);
    expect(face('sleep')).toContain('M14.5 23 H21.5 M26.5 23 H33.5');
    expect(face('empty')).toContain('stroke-linejoin="round"');
  });
});
