import { describe, expect, it } from 'vitest';
import { EXAMPLE_CATALOG } from './exampleCatalog';
import { REFERENCE_EXAMPLES } from './fixtures';

describe('EXAMPLE_CATALOG', () => {
  it('matches the reference fixtures it lazily loads (titles, counts, order)', async () => {
    expect(EXAMPLE_CATALOG.map((e) => e.id)).toEqual(REFERENCE_EXAMPLES.map((e) => e.id));
    for (const entry of EXAMPLE_CATALOG) {
      const reference = REFERENCE_EXAMPLES.find((e) => e.id === entry.id)!;
      expect(entry.key).toBe(reference.key);
      expect(entry.title).toBe(reference.fixture.title);
      expect(entry.componentCount).toBe(reference.fixture.elements.length);
      expect(entry.scenarioCount).toBe(reference.fixture.scenarios.length);
      expect(await entry.load()).toEqual(reference.fixture);
    }
  });
});
