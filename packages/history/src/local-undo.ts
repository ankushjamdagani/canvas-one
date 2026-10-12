export type UndoEntry<Change> = {
  readonly label: string;
  readonly inverseChanges: readonly Change[];
  readonly forwardChanges: readonly Change[];
};
export type UndoDirection = 'undo' | 'redo';
export type UndoTicket<Change> = {
  readonly direction: UndoDirection;
  readonly revision: number;
  readonly entry: UndoEntry<Change>;
};
export type UndoSnapshot<Change> = {
  readonly undo: readonly UndoEntry<Change>[];
  readonly redo: readonly UndoEntry<Change>[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
};
declare const structuredClone: <T>(value: T) => T;

/** Local undo mechanics; a host commits a prepared ticket only after its write succeeds. */
export class LocalUndoHistory<Change> {
  private undo: UndoEntry<Change>[] = [];
  private redo: UndoEntry<Change>[] = [];
  private revision = 0;
  private readonly maxEntries: number;
  private readonly clone: (entry: UndoEntry<Change>) => UndoEntry<Change>;
  private readonly tickets = new WeakSet<UndoTicket<Change>>();

  constructor(options: {
    readonly maxEntries?: number;
    readonly clone?: (entry: UndoEntry<Change>) => UndoEntry<Change>;
  } = {}) {
    this.maxEntries = options.maxEntries ?? 100;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new RangeError('maxEntries must be a positive safe integer');
    }
    // Native Window.structuredClone rejects a class instance as its receiver.
    this.clone = options.clone ?? (entry => structuredClone(entry));
  }

  getSnapshot(): UndoSnapshot<Change> {
    return Object.freeze({
      undo: Object.freeze(this.undo.map((entry) => this.clone(entry))),
      redo: Object.freeze(this.redo.map((entry) => this.clone(entry))),
      canUndo: this.undo.length > 0,
      canRedo: this.redo.length > 0,
    });
  }

  get canUndo(): boolean { return this.undo.length > 0; }
  get canRedo(): boolean { return this.redo.length > 0; }

  /** Record a normal accepted edit; failed or rejected writes must not call this. */
  recordAccepted(entry: UndoEntry<Change>): void {
    this.push(this.undo, this.clone(entry));
    this.redo = [];
    this.revision++;
  }

  prepare(direction: UndoDirection): UndoTicket<Change> | null {
    const stack = direction === 'undo' ? this.undo : this.redo;
    const entry = stack[stack.length - 1];
    if (!entry) return null;
    const ticket = Object.freeze({ direction, revision: this.revision, entry: this.clone(entry) });
    this.tickets.add(ticket);
    return ticket;
  }

  /** Receipt acknowledgement; stale, duplicate or foreign tickets leave both stacks unchanged. */
  commit(ticket: UndoTicket<Change>): boolean {
    if (!this.tickets.has(ticket) || ticket.revision !== this.revision) return false;
    const source = ticket.direction === 'undo' ? this.undo : this.redo;
    const target = ticket.direction === 'undo' ? this.redo : this.undo;
    const entry = source.pop();
    if (!entry) return false;
    this.push(target, entry);
    this.tickets.delete(ticket);
    this.revision++;
    return true;
  }

  clear(): void {
    this.undo = [];
    this.redo = [];
    this.revision++;
  }

  private push(stack: UndoEntry<Change>[], entry: UndoEntry<Change>): void {
    stack.push(entry);
    if (stack.length > this.maxEntries) stack.shift();
  }
}
