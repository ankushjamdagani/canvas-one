/** Exact latency statistics; each snapshot sorts only newly completed work. */
export class LatencyStats {
  private values: number[] = [];
  private sorted: number[] = [];
  private mean = 0;
  push(value: number) {
    this.values.push(value);
  }
  recentMean() {
    return this.values.length
      ? this.values.slice(-500).reduce((a, b) => a + b, 0) /
          Math.min(500, this.values.length)
      : 0;
  }
  snapshot() {
    if (this.sorted.length !== this.values.length) {
      const added = this.values.slice(this.sorted.length).sort((a, b) => a - b),
        prior = this.sorted;
      const merged = new Array<number>(prior.length + added.length);
      let i = 0,
        j = 0,
        total = 0;
      for (let k = 0; k < merged.length; k++) {
        const value =
          j === added.length || (i < prior.length && prior[i] <= added[j])
            ? prior[i++]
            : added[j++];
        merged[k] = value;
        total += value;
      }
      this.sorted = merged;
      this.mean = total / merged.length;
    }
    return {
      meanLatency: this.mean,
      p95Latency: this.sorted.length
        ? this.sorted[Math.ceil(this.sorted.length * 0.95) - 1]
        : 0,
    };
  }
}
