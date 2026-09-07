export class Heap<T extends { time: number; seq: number }> {
  values: T[] = [];
  before(a: T, b: T) {
    return a.time < b.time || (a.time === b.time && a.seq < b.seq);
  }
  push(e: T) {
    const a = this.values;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop() {
    const a = this.values,
      first = a[0],
      last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && this.before(a[c + 1], a[c])) c++;
        if (!this.before(a[c], a[i])) break;
        [a[c], a[i]] = [a[i], a[c]];
        i = c;
      }
    }
    return first;
  }
}
export function randomGenerator(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
