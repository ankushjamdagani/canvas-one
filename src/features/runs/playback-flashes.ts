import type { CycleOutcome } from '../../domain/studio/runner/types';

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
type Fact = Omit<FlashAt, 'count' | 'age'> & { readonly atMs: number };

/** A cursor visits only newly visible facts; backwards reads binary-search the small flash window. */
export class FlashIndex {
  private facts: Fact[] = [];
  private sorted = true;
  private cursor = 0;
  private at = -Infinity;
  private active: Fact[] = [];

  add(fact: Fact): void {
    const last = this.facts[this.facts.length - 1];
    if (last && last.atMs > fact.atMs) this.sorted = false;
    this.facts.push(fact);
    if (fact.atMs <= this.at) this.at = Infinity;
  }

  read(atMs: number): readonly FlashAt[] {
    if (!this.sorted) { this.facts.sort((a, b) => a.atMs - b.atMs); this.sorted = true; }
    if (atMs < this.at) { this.cursor = this.after(atMs - FLASH_MS); this.active = []; }
    while (this.cursor < this.facts.length && this.facts[this.cursor].atMs <= atMs) this.active.push(this.facts[this.cursor++]);
    this.at = atMs;
    this.active = this.active.filter(f => f.atMs > atMs - FLASH_MS);
    const groups = new Map<string, FlashAt>();
    for (const f of this.active) {
      const key = JSON.stringify([f.connectionId, f.elementId, f.kind, f.progress, f.outcome]);
      const previous = groups.get(key);
      groups.set(key, { connectionId: f.connectionId, elementId: f.elementId, kind: f.kind,
        progress: f.progress, outcome: f.outcome, count: (previous?.count ?? 0) + 1,
        age: (atMs - f.atMs) / FLASH_MS });
    }
    return [...groups.values()];
  }

  evict(start: number): void {
    if (!this.sorted) { this.facts.sort((a, b) => a.atMs - b.atMs); this.sorted = true; }
    const cut = this.after(start - FLASH_MS);
    this.facts.splice(0, cut);
    this.cursor = Math.max(0, this.cursor - cut);
    if (this.at < start) this.at = Infinity;
  }

  private after(t: number): number {
    let lo = 0; let hi = this.facts.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.facts[mid].atMs <= t) lo = mid + 1; else hi = mid; }
    return lo;
  }
}
