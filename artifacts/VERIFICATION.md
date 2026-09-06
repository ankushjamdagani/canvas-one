# Prototype verification

Verified on 6 September 2026 with Chromium through Playwright, plus Vitest and a production build.

## Observed seeded experiment

30 simulated seconds, seed 42, mean traffic 700 requests/s, service capacity 2,000 requests/s, database capacity 500 lookups/s, queues 500, deadline 2,000 ms. Cache: capacity 5,000 requests/s and 80% fixed hit probability.

| Observed result | Without cache | With cache |
|---|---:|---:|
| Generated requests | 20,845 | 20,845 |
| Successful responses | 14,995 | 20,837 |
| Throughput, rounded | 500/s | 695/s |
| Successful-response p95 | 1,010.5 ms | 11.4 ms |
| Queue-full rejections | 5,346 | 0 |
| Timed out | 0 | 0 |
| In flight at observation end | 504 | 8 |
| Database arrivals, average | 694.8/s | 140.8/s |
| Cache hits | — | 16,622 |

These are simulator results, not measured real-system performance. The configured expected cache-miss demand is 140/s; the observed 140.8/s comes from the seeded sample. Arrival sequences are identical across both runs. Screenshots `desktop-overload.png` and `desktop-cache.png` show these runs.

## Checks

- Vitest: baseline, overload, conservation of request counts, deadlines, queue bounds, zero queue slots, 100% hits, deterministic replay, incremental stepping, invalid graphs, versioned import/export, unfinished portable drafts.
- Playwright: complete baseline/overload/cache journey, comparison, automatic before/after checkpoints, restore and local reopen, pause/reset, invalid topology/undo, project naming and export/import, connection deletion/restore, viewport persistence, narrow-screen overflow, readable mobile nodes and checkpoint creation.
- Production TypeScript and Vite build.
- Independent bounded visual review: **Pass**. Resolved cache clipping, mobile readability, mobile checkpoint access, heading spacing and secondary-caption contrast. Review confirms visual evidence; interaction behavior is covered by the browser tests. This is not a claim of full accessibility conformance.
- Mechanical design detector: one font-preference warning for Inter. Kept intentionally to match the user-selected crisp sans-serif reference.

## Known limits

The simulator supports a single linear URL lookup path; no nested submodels, branching execution, retries, replication, eviction, writes or realistic hardware/network modeling. Black boxes have explicit models; no hidden model substitution. Projects are browser-local, with no cloud sync. In-progress runs and previous measured comparisons are ephemeral. Build currently emits a ~505 KB minified main chunk (~161 KB gzip); code splitting is a future performance improvement.

## Final visual-review verdict

**Pass** — bounded review of the selected light docked workspace.

| Original material finding | Final verdict |
|---|---|
| Cache spacing and database clipping | Resolved |
| Mobile graph legibility | Resolved |
| Mobile checkpoint access | Resolved |
| Heading spacing | Resolved |
| Faint secondary captions | Resolved |
