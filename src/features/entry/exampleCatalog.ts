import type { Document } from '../../domain/studio/model';

/**
 * Entry-screen list of the S01–S06 reference examples. Titles and counts are inline so
 * the entry screen renders without the fixture JSON; a document loads only when its
 * example is created. `exampleCatalog.test.ts` pins this list to the fixtures.
 */
export type ExampleCatalogEntry = {
  readonly id: 's01' | 's02' | 's03' | 's04' | 's05' | 's06';
  readonly key: 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06';
  readonly title: string;
  readonly componentCount: number;
  readonly scenarioCount: number;
  readonly load: () => Promise<Document>;
};

const asDocument = (module: { default: unknown }) => module.default as Document;

export const EXAMPLE_CATALOG: readonly ExampleCatalogEntry[] = Object.freeze([
  { id: 's01', key: 'S01', title: 'S01 Checkout', componentCount: 2, scenarioCount: 3,
    load: () => import('./examples/s01.json').then(asDocument) },
  { id: 's02', key: 'S02', title: 'S02 Order processing', componentCount: 6, scenarioCount: 2,
    load: () => import('./examples/s02.json').then(asDocument) },
  { id: 's03', key: 'S03', title: 'S03 Records pipeline', componentCount: 1, scenarioCount: 1,
    load: () => import('./examples/s03.json').then(asDocument) },
  { id: 's04', key: 'S04', title: 'S04 Infrastructure', componentCount: 7, scenarioCount: 3,
    load: () => import('./examples/s04.json').then(asDocument) },
  { id: 's05', key: 'S05', title: 'S05 Fullstack', componentCount: 9, scenarioCount: 2,
    load: () => import('./examples/s05.json').then(asDocument) },
  { id: 's06', key: 'S06', title: 'S06 Checkout under a traffic spike', componentCount: 8, scenarioCount: 2,
    load: () => import('./examples/s06.json').then(asDocument) },
] as const);
