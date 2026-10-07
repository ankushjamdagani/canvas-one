import { describe, expect, it } from 'vitest';
import { pageDirection } from './direction';

describe('pageDirection', () => {
  it.each([
    ['home', 'projects', 1],
    ['projects', 'project', 1],
    ['home', 'project', 1],
    ['projects', 'home', -1],
    ['project', 'projects', -1],
    ['project', 'home', -1],
    ['projects', 'projects', 0],
  ] as const)('%s -> %s is %i', (from, to, expected) => {
    expect(pageDirection(from, to)).toBe(expected);
  });
});
