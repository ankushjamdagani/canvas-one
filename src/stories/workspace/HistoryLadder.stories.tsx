import type { Meta, StoryObj } from '@storybook/react-vite';
import { HistoryLadder } from '@/features/history/HistoryLadder';
import type { CommitRecord, PublicationRecord } from '@/persistence/studio';

const actor = { actorId: 'u1', kind: 'local-human' as const, displayName: 'Dana' };
const at = (h: number, m: number) => Date.UTC(2026, 8, 11, h, m);

const commits: readonly CommitRecord[] = [
  { projectId: 'p', id: 'c3', parentIds: ['c2'], snapshotId: 's3', message: 'Concurrency 4 on checkout service', evidence: [{ scenarioId: 'a', fingerprint: 'f', runId: 'r' }], actor, createdAt: at(16, 20) },
  { projectId: 'p', id: 'c2', parentIds: ['c1'], snapshotId: 's2', message: 'Wired queue to provider', evidence: [], actor, createdAt: at(16, 4) },
  { projectId: 'p', id: 'c1', parentIds: [], snapshotId: 's1', message: 'Before adding Redis', evidence: [], actor, createdAt: at(14, 52) },
];

const publications: readonly PublicationRecord[] = [
  { projectId: 'p', id: 'pub', commitId: 'c0', sourceBranchId: 'b', previousMainHeadId: null, ordinal: 1, actor, createdAt: Date.UTC(2026, 8, 11), versionKey: '2.2.1', metadata: { title: 'Split gateway from storefront' } } as unknown as PublicationRecord,
];

const meta: Meta<typeof HistoryLadder> = {
  title: 'Workspace/HistoryLadder',
  component: HistoryLadder,
  decorators: [(Story) => (<div className="h-[760px] w-[358px] border border-border"><Story /></div>)],
};
export default meta;

export const Default: StoryObj<typeof HistoryLadder> = {
  name: 'Ladder',
  args: {
    hosted: true,
    branchName: 'async-fulfilment',
    isMain: false,
    aheadOfVersion: { aheadCount: 5, versionKey: '2.2.1' },
    workingEdits: ['Edit queue limit 500', 'Connect queue → provider', 'Add order queue', ...Array.from({ length: 38 }, (_, i) => `Edit ${i}`)],
    commits,
    publications,
    commitDiffSummaries: { c3: '2 fields changed', c2: '1 connection added', c1: '8 components' },
    canUndo: true,
    canRedo: false,
    onOpenCommit: () => {},
    onOpenPublish: () => {},
  },
};
