import { parseTaskLedger, type TaskLedger, type TaskScope, type TaskStorage } from '@canvas-one/agents';
import type { StudioDatabase } from './db';
import type { AgentTaskLedgerRecord } from './types';

const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const sameScope = (a: TaskScope, b: TaskScope) => a.projectId === b.projectId && a.branchId === b.branchId && a.boardId === b.boardId;

/** A collision-free tuple encoding. Actor is intentionally absent: agents share one board reservation. */
export function agentTaskLedgerKey(scope: TaskScope): string {
  if (!scope || !text(scope.projectId) || !text(scope.branchId) || !text(scope.boardId)) throw new TypeError('Invalid task storage scope');
  return JSON.stringify(['canvas-one/tasks/1', scope.projectId, scope.branchId, scope.boardId]);
}

/** Uses the existing Studio database; it never writes authored documents or creates another database. */
export class StudioTaskStorage implements TaskStorage {
  readonly key: string;
  private readonly scope: TaskScope;
  constructor(private readonly db: StudioDatabase, scope: TaskScope) {
    this.key = agentTaskLedgerKey(scope);
    this.scope = Object.freeze({ ...scope });
  }
  private ledger(serialized: unknown): TaskLedger {
    if (typeof serialized !== 'string') throw new TypeError('Invalid task ledger encoding');
    const ledger = parseTaskLedger(serialized);
    if (!ledger || ledger.tasks.some(task => !sameScope(task.scope, this.scope))) throw new TypeError('Invalid or cross-board task ledger');
    return ledger;
  }
  private row(record: AgentTaskLedgerRecord): TaskLedger {
    if (!record || record.key !== this.key || !revision(record.revision)) throw new TypeError('Invalid task ledger row');
    const ledger = this.ledger(record.serializedLedger);
    if (ledger.revision !== record.revision) throw new TypeError('Task row revision does not match ledger');
    return ledger;
  }
  async load(): Promise<string | null> {
    return this.db.transaction('r', this.db.agentTaskLedgers, async () => {
      const record = await this.db.agentTaskLedgers.get(this.key);
      if (!record) return null;
      this.row(record);
      return record.serializedLedger;
    });
  }
  async compareAndSwap(expectedRevision: number | null, serializedLedger: string): Promise<boolean> {
    if (expectedRevision !== null && !revision(expectedRevision)) throw new TypeError('Invalid expected task revision');
    const next = this.ledger(serializedLedger);
    if (next.revision <= (expectedRevision ?? 0)) return false;
    // Read, validate, compare and write share one read-write IndexedDB transaction.
    // Resolving the outer Dexie transaction means its commit has completed.
    return this.db.transaction('rw', this.db.agentTaskLedgers, async () => {
      const current = await this.db.agentTaskLedgers.get(this.key);
      if (current) {
        this.row(current);
        if (expectedRevision === null || current.revision !== expectedRevision) return false;
      } else if (expectedRevision !== null) return false;
      await this.db.agentTaskLedgers.put({ key: this.key, revision: next.revision, serializedLedger });
      return true;
    });
  }
}
