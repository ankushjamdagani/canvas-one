import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CompletionPolicy, Document } from './model';
import { checkReadiness } from './readiness';
import { validateDocument } from './validate';

const S06 = JSON.parse(readFileSync(resolve(__dirname, '../../../specs/revamp/fixtures/s06.json'), 'utf8')) as Document;

function withCompletion(completion: unknown, scenarioIndex = 0): Document {
  return { ...S06, scenarios: S06.scenarios.map((s, i) => (i === scenarioIndex ? { ...s, completion } : s)) } as unknown as Document;
}

describe('count and open completion (D55)', () => {
  it('accepts a request count with a drain deadline and the open policy', () => {
    expect(validateDocument(withCompletion({ kind: 'count', requests: 500, deadlineMs: 30000 })).ok).toBe(true);
    expect(validateDocument(withCompletion({ kind: 'open' })).ok).toBe(true);
  });

  it('rejects a count out of range, not whole, or with a deadline outside 1–600 s, and an open policy with extra keys', () => {
    for (const bad of [
      { kind: 'count', requests: 0, deadlineMs: 30000 },
      { kind: 'count', requests: 100001, deadlineMs: 30000 },
      { kind: 'count', requests: 1.5, deadlineMs: 30000 },
      { kind: 'count', requests: 10, deadlineMs: 999 },
      { kind: 'count', requests: 10, deadlineMs: 600001 },
      { kind: 'count', requests: 10 },
      { kind: 'open', deadlineMs: 5 },
    ]) {
      expect(validateDocument(withCompletion(bad)).ok).toBe(false);
    }
  });

  it('a timed scenario can use them, a logical one cannot, and neither blocks readiness on its own', () => {
    for (const completion of [{ kind: 'count', requests: 100, deadlineMs: 60000 }, { kind: 'open' }] as CompletionPolicy[]) {
      const doc = withCompletion(completion);
      const readiness = checkReadiness(doc, doc.scenarios[0].id);
      expect(readiness.ready).toBe(true);
    }
    const logical = { ...S06, scenarios: S06.scenarios.map((s, i) => (i === 0 ? { ...s, mode: 'logical', completion: { kind: 'open' } } : s)) } as unknown as Document;
    const result = checkReadiness(logical, logical.scenarios[0].id);
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.issues.some((i) => i.code === 'completion-mode-mismatch')).toBe(true);
  });
});
