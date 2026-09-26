import { describe, expect, it } from 'vitest';
import type { Document, ResourceBehavior } from '../../domain/studio/model';
import type { CommitRecord, PublicationRecord } from '../../persistence/studio';
import {
  computeAheadOfVersion,
  computeChangesList,
  computeEvidenceSummary,
  computeFieldsChanged,
  formatCommitTime,
  formatPublicationDate,
} from './diffSummary';

function resourceConfig(capacity: number): ResourceBehavior {
  return {
    kind: 'resource',
    version: 1,
    entryPortId: 'port-in',
    config: {
      type: 'processor',
      capacity,
      concurrency: 1,
      queueLimit: 10,
      failureRate: 0,
      maxRetries: 0,
      retryDelayMs: 0,
    },
  };
}

const baseDoc: Document = {
  schema: 'studio-model/1',
  id: 'doc-1',
  title: 'Test System',
  elements: [
    {
      id: 'elem-queue',
      label: 'Order queue',
      description: '',
      visualKind: 'queue',
      ports: [],
      behavior: resourceConfig(2),
    },
    {
      id: 'elem-service',
      label: 'Checkout service',
      description: '',
      visualKind: 'service',
      ports: [],
      behavior: resourceConfig(2),
    },
  ],
  connections: [],
  relations: [],
  schemas: [],
  fixtures: [],
  refinements: [],
  scenarios: [],
  views: [],
};

describe('diffSummary view-model helpers', () => {
  it('computeChangesList detects added, modified and removed records with labels and details', () => {
    const workingDoc: Document = {
      ...baseDoc,
      elements: [
        // queue modified: capacity 2 -> 4
        {
          ...baseDoc.elements[0],
          behavior: resourceConfig(4),
        },
        // service removed
        // new connection added
      ],
      connections: [
        {
          id: 'conn-1',
          label: 'Queue → payment provider',
          kind: 'call',
          source: { elementId: 'elem-queue', portId: 'p1' },
          target: { elementId: 'elem-service', portId: 'p2' },
          config: {
            latencyMs: 5,
            returnLatencyMs: 5,
            weight: 1,
            condition: null,
            fallback: false,
            resource: null,
          },
        },
      ],
    };

    const changes = computeChangesList(baseDoc, workingDoc);

    // Should detect:
    // 1. modified queue with slots 2 -> 4
    // 2. removed service
    // 3. added connection
    const queueChange = changes.find((c) => c.id === 'elem-queue');
    expect(queueChange).toBeDefined();
    expect(queueChange?.change).toBe('modified');
    expect(queueChange?.label).toBe('Order queue');
    expect(queueChange?.detail).toBe('capacity 2 → 4');

    const serviceChange = changes.find((c) => c.id === 'elem-service');
    expect(serviceChange).toBeDefined();
    expect(serviceChange?.change).toBe('removed');
    expect(serviceChange?.label).toBe('Checkout service');
    expect(serviceChange?.detail).toBe('removed component');

    const connChange = changes.find((c) => c.id === 'conn-1');
    expect(connChange).toBeDefined();
    expect(connChange?.change).toBe('added');
    expect(connChange?.label).toBe('Queue → payment provider');
    expect(connChange?.detail).toBe('new connection');
  });

  it('computeChangesList handles empty or identical documents cleanly', () => {
    expect(computeChangesList(null, baseDoc)).toEqual([]);
    expect(computeChangesList(baseDoc, null)).toEqual([]);
    expect(computeChangesList(baseDoc, baseDoc)).toEqual([]);
  });

  it('computeFieldsChanged returns n fields changed or null if omitted', () => {
    const modifiedDoc: Document = {
      ...baseDoc,
      title: 'New Title',
      elements: [
        {
          ...baseDoc.elements[0],
          description: 'Updated description',
        },
        baseDoc.elements[1],
      ],
    };

    const fieldsChanged = computeFieldsChanged(baseDoc, modifiedDoc);
    expect(fieldsChanged).toBe('2 fields changed');

    // Identical documents -> omitted (null)
    expect(computeFieldsChanged(baseDoc, baseDoc)).toBeNull();
    // Missing document -> omitted (null)
    expect(computeFieldsChanged(null, baseDoc)).toBeNull();
    expect(computeFieldsChanged(baseDoc, null)).toBeNull();
  });

  it('computeAheadOfVersion computes n ahead of version strictly from ancestry', () => {
    const pubCommitId = 'commit-pub-1';
    const c1: any = { id: pubCommitId, parentIds: [] };
    const c2: any = { id: 'commit-2', parentIds: [pubCommitId] };
    const c3: any = { id: 'commit-3', parentIds: ['commit-2'] };
    const c4: any = { id: 'commit-4', parentIds: ['commit-3'] };

    // Commits in DAG order newest first: c4, c3, c2, c1
    const branchCommits: CommitRecord[] = [c4, c3, c2, c1];

    const publications: PublicationRecord[] = [
      {
        projectId: 'proj-1',
        id: 'pub-1',
        commitId: pubCommitId,
        sourceBranchId: 'branch-1',
        previousMainHeadId: null,
        ordinal: 1,
        actor: { actorId: 'u1', kind: 'local-human', displayName: 'User' },
        createdAt: 1000,
        metadata: {
          version: { major: 2, minor: 2, patch: 1 },
          title: 'Split gateway from storefront',
          rationale: '',
          ticketUrl: null,
        },
        versionKey: '2.2.1',
      },
    ];

    const ahead = computeAheadOfVersion(branchCommits, publications);
    expect(ahead).not.toBeNull();
    // c1 is at index 3 in branchCommits, so branch is 3 ahead of 2.2.1
    expect(ahead?.aheadCount).toBe(3);
    expect(ahead?.versionKey).toBe('2.2.1');

    // When publication commit is head (index 0) -> not ahead -> returns null
    const headAtPub: CommitRecord[] = [c1];
    expect(computeAheadOfVersion(headAtPub, publications)).toBeNull();

    // When publication commit is not in branch ancestry -> returns null
    const unrelatedCommits: CommitRecord[] = [c4, c3];
    expect(computeAheadOfVersion(unrelatedCommits, publications)).toBeNull();
  });

  it('computeEvidenceSummary formats passed scenarios without p95 or burst', () => {
    const commitWithManifest: any = {
      id: 'c1',
      evidenceManifest: {
        scenarioIds: ['s1', 's2', 's3'],
        entries: [{}, {}, {}],
      },
      evidence: [],
    };

    const summary = computeEvidenceSummary(commitWithManifest);
    expect(summary).toBe('3 scenarios passed');
    expect(summary).not.toContain('p95');
    expect(summary).not.toContain('burst');

    const commitWithEvidence: any = {
      id: 'c2',
      evidence: [{ scenarioId: 's1', fingerprint: 'fp1', runId: 'r1' }],
    };
    expect(computeEvidenceSummary(commitWithEvidence)).toBe('1 scenario passed');

    const emptyCommit: any = {
      id: 'c3',
      evidence: [],
    };
    expect(computeEvidenceSummary(emptyCommit)).toBeNull();
  });

  it('formatCommitTime and formatPublicationDate format timestamps cleanly', () => {
    // 2026-09-11 16:20 UTC
    const date = new Date(2026, 8, 11, 16, 20, 0); // Month is 0-indexed (8 = Sep)
    const timeStr = formatCommitTime(date.getTime());
    expect(timeStr).toBe('16:20');

    const dateStr = formatPublicationDate(date.getTime());
    expect(dateStr).toBe('11 Sep');
  });
});
