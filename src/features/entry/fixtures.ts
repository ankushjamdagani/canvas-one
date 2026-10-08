import type { Document } from '../../domain/studio/model';
import s01 from './examples/s01.json';
import s02 from './examples/s02.json';
import s03 from './examples/s03.json';
import s04 from './examples/s04.json';
import s05 from './examples/s05.json';
import s06 from './examples/s06.json';

export type ReferenceExample = {
  readonly id: string;
  readonly key: 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06';
  readonly title: string;
  readonly fixture: Document;
};

export const REFERENCE_EXAMPLES: readonly ReferenceExample[] = Object.freeze([
  { id: 's01', key: 'S01', title: s01.title, fixture: s01 as unknown as Document },
  { id: 's02', key: 'S02', title: s02.title, fixture: s02 as unknown as Document },
  { id: 's03', key: 'S03', title: s03.title, fixture: s03 as unknown as Document },
  { id: 's04', key: 'S04', title: s04.title, fixture: s04 as unknown as Document },
  { id: 's05', key: 'S05', title: s05.title, fixture: s05 as unknown as Document },
  { id: 's06', key: 'S06', title: s06.title, fixture: s06 as unknown as Document },
]);
