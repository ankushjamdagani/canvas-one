import type { CycleOutcome } from '../runner/types.js';

export const FLASH_MS = 240;
export type FlashAt = {
  readonly connectionId: string | null;
  readonly elementId: string | null;
  readonly kind: 'sent' | 'arrived' | 'outcome';
  readonly progress: number;
  readonly outcome: CycleOutcome | null;
  readonly count: number;
  /** Simulated age; grouped facts use the newest constituent's age. */
  readonly age: number;
};
type Group = Omit<FlashAt, 'count' | 'age'>;
type Fact = Group & { readonly atMs: number };
type StoredFact = { readonly atMs: number; readonly group: Group };

/** A cursor visits only newly visible facts; backwards reads binary-search the small flash window. */
export class FlashIndex {
  private times: number[] = [];
  private readonly buckets = new Map<number, StoredFact[]>();
  private readonly groupKeys = new Map<string, Group>();
  private cursor = 0;
  private at = -Infinity;
  private active: StoredFact[] = [];

  add(fact: Fact): void {
    const key = JSON.stringify([fact.connectionId, fact.elementId, fact.kind, fact.progress, fact.outcome]);
    let group = this.groupKeys.get(key);
    if (!group) {
      group = { connectionId: fact.connectionId, elementId: fact.elementId, kind: fact.kind,
        progress: fact.progress, outcome: fact.outcome };
      this.groupKeys.set(key, group);
    }
    const stored = { atMs: fact.atMs, group };
    const bucket = this.buckets.get(fact.atMs);
    if (bucket) bucket.push(stored);
    else {
      this.buckets.set(fact.atMs, [stored]);
      // Recorded return arrivals can precede the next batch's departures.
      // Insert a timestamp bucket rather than sorting every historical fact.
      const insertion = this.after(fact.atMs);
      this.times.splice(insertion, 0, fact.atMs);
    }
    if (fact.atMs <= this.at) this.at = Infinity;
  }

  read(atMs: number): readonly FlashAt[] {
    if (atMs < this.at) { this.cursor = this.after(atMs - FLASH_MS); this.active = []; }
    while (this.cursor < this.times.length && this.times[this.cursor] <= atMs) {
      for (const fact of this.buckets.get(this.times[this.cursor++])!) this.active.push(fact);
    }
    this.at = atMs;
    this.active = this.active.filter(f => f.atMs > atMs - FLASH_MS);
    const groups = new Map<Group, { count: number; age: number }>();
    for (const f of this.active) {
      const age = (atMs - f.atMs) / FLASH_MS;
      const previous = groups.get(f.group);
      if (previous) { previous.count++; previous.age = Math.min(previous.age, age); }
      else groups.set(f.group, { count: 1, age });
    }
    return [...groups].map(([group, count]) => ({ ...group, ...count }));
  }

  evict(start: number): void {
    const cut = this.after(start - FLASH_MS);
    for (let i = 0; i < cut; i++) this.buckets.delete(this.times[i]);
    this.times.splice(0, cut);
    this.cursor = Math.max(0, this.cursor - cut);
    if (this.at < start) this.at = Infinity;
  }

  private after(t: number): number {
    let lo = 0; let hi = this.times.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.times[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo;
  }
}
