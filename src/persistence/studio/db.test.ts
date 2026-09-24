import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createStudioDatabase, DB_NAME, DB_VERSION } from './db';

describe('StudioDatabase schema introspection', () => {
  it('instantiates system-studio-local-v1 version 1 by default', () => {
    const db = createStudioDatabase();
    expect(db.name).toBe(DB_NAME);
    expect(db.verno).toBe(DB_VERSION);
    db.close();
  });

  it('matches specs/revamp/contracts/storage.md §2 table names and indexes exactly', async () => {
    const db = createStudioDatabase(`test-schema-${crypto.randomUUID()}`);
    await db.open();

    const tableNames = db.tables.map((t) => t.name).sort();
    const expectedTables = [
      'branches',
      'checkpoints',
      'commits',
      'operations',
      'parts',
      'preferences',
      'projects',
      'publications',
      'runs',
      'snapshots',
      'traceChunks',
    ].sort();

    expect(tableNames).toEqual(expectedTables);

    // 1. projects table
    const projectsTable = db.table('projects');
    expect(projectsTable.schema.primKey.name).toBe('id');
    expect(projectsTable.schema.primKey.compound).toBe(false);
    expect(projectsTable.schema.indexes).toEqual([
      expect.objectContaining({ name: 'updatedAt', keyPath: 'updatedAt', unique: false }),
    ]);

    // 2. branches table
    const branchesTable = db.table('branches');
    expect(branchesTable.schema.primKey.name).toBe('[projectId+id]');
    expect(branchesTable.schema.primKey.compound).toBe(true);
    expect(branchesTable.schema.primKey.keyPath).toEqual(['projectId', 'id']);
    expect(branchesTable.schema.indexes).toEqual([
      expect.objectContaining({ name: 'projectId', keyPath: 'projectId', unique: false }),
    ]);

    // 3. snapshots table
    const snapshotsTable = db.table('snapshots');
    expect(snapshotsTable.schema.primKey.name).toBe('[projectId+id]');
    expect(snapshotsTable.schema.primKey.compound).toBe(true);
    expect(snapshotsTable.schema.primKey.keyPath).toEqual(['projectId', 'id']);
    expect(snapshotsTable.schema.indexes).toEqual([
      expect.objectContaining({ name: 'projectId', keyPath: 'projectId', unique: false }),
    ]);

    // 4. commits table
    const commitsTable = db.table('commits');
    expect(commitsTable.schema.primKey.name).toBe('[projectId+id]');
    expect(commitsTable.schema.primKey.compound).toBe(true);
    expect(commitsTable.schema.primKey.keyPath).toEqual(['projectId', 'id']);
    expect(commitsTable.schema.indexes).toEqual([
      expect.objectContaining({ name: 'projectId', keyPath: 'projectId', unique: false }),
    ]);

    // 5. publications table (with unique compound indexes)
    const publicationsTable = db.table('publications');
    expect(publicationsTable.schema.primKey.name).toBe('[projectId+id]');
    expect(publicationsTable.schema.primKey.compound).toBe(true);
    expect(publicationsTable.schema.primKey.keyPath).toEqual(['projectId', 'id']);
    expect(publicationsTable.schema.indexes).toHaveLength(3);
    expect(publicationsTable.schema.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'projectId', keyPath: 'projectId', unique: false }),
        expect.objectContaining({
          name: '[projectId+ordinal]',
          keyPath: ['projectId', 'ordinal'],
          unique: true,
        }),
        expect.objectContaining({
          name: '[projectId+versionKey]',
          keyPath: ['projectId', 'versionKey'],
          unique: true,
        }),
      ]),
    );

    // 6. checkpoints table
    const checkpointsTable = db.table('checkpoints');
    expect(checkpointsTable.schema.primKey.name).toBe('[projectId+id]');
    expect(checkpointsTable.schema.primKey.compound).toBe(true);
    expect(checkpointsTable.schema.primKey.keyPath).toEqual(['projectId', 'id']);
    expect(checkpointsTable.schema.indexes).toEqual([
      expect.objectContaining({ name: 'projectId', keyPath: 'projectId', unique: false }),
    ]);

    // 7. runs table
    const runsTable = db.table('runs');
    expect(runsTable.schema.primKey.name).toBe('[projectId+id]');
    expect(runsTable.schema.primKey.compound).toBe(true);
    expect(runsTable.schema.primKey.keyPath).toEqual(['projectId', 'id']);
    expect(runsTable.schema.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'projectId', keyPath: 'projectId', unique: false }),
        expect.objectContaining({
          name: '[projectId+fingerprint]',
          keyPath: ['projectId', 'fingerprint'],
          unique: false,
        }),
      ]),
    );

    // 8. traceChunks table
    const traceChunksTable = db.table('traceChunks');
    expect(traceChunksTable.schema.primKey.name).toBe('[projectId+runId+index]');
    expect(traceChunksTable.schema.primKey.compound).toBe(true);
    expect(traceChunksTable.schema.primKey.keyPath).toEqual(['projectId', 'runId', 'index']);
    expect(traceChunksTable.schema.indexes).toEqual([
      expect.objectContaining({
        name: '[projectId+runId]',
        keyPath: ['projectId', 'runId'],
        unique: false,
      }),
    ]);

    // 9. operations table
    const operationsTable = db.table('operations');
    expect(operationsTable.schema.primKey.name).toBe('[projectId+id]');
    expect(operationsTable.schema.primKey.compound).toBe(true);
    expect(operationsTable.schema.primKey.keyPath).toEqual(['projectId', 'id']);
    expect(operationsTable.schema.indexes).toEqual([
      expect.objectContaining({ name: 'projectId', keyPath: 'projectId', unique: false }),
    ]);

    // 10. parts table
    const partsTable = db.table('parts');
    expect(partsTable.schema.primKey.name).toBe('[projectId+id+revision]');
    expect(partsTable.schema.primKey.compound).toBe(true);
    expect(partsTable.schema.primKey.keyPath).toEqual(['projectId', 'id', 'revision']);
    expect(partsTable.schema.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'projectId', keyPath: 'projectId', unique: false }),
        expect.objectContaining({
          name: '[projectId+id]',
          keyPath: ['projectId', 'id'],
          unique: false,
        }),
      ]),
    );

    // 11. preferences table
    const preferencesTable = db.table('preferences');
    expect(preferencesTable.schema.primKey.name).toBe('key');
    expect(preferencesTable.schema.primKey.compound).toBe(false);
    expect(preferencesTable.schema.indexes).toHaveLength(0);

    db.close();
  });
});
