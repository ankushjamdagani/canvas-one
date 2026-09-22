# Serialization measurements and budget decision

2026-09-22; Node v24.5.0. Reproduce with `node specs/revamp/fixtures/measure.mjs`. Exact SHA-256 values and script hash are in [measurements.json](measurements.json). Whitespace in the review-friendly JSON files is excluded by canonical encoding; the actual future export serializer must use that same compact encoding.

| Specimen | Canonical UTF-8 bytes | Interpretation |
|---|---:|---|
| S01 frontend | 21,777 | Three declared machine/boundary scenarios |
| S02 backend/service | 17,836 | Allowed and denied order scenarios |
| S03 data flow | 5,319 | Original five-row malformed/duplicate/aggregate fixture |
| S04 infrastructure | 16,819 | Routing, active/queued outage and same-time outage |
| S05 fullstack | 31,483 | Causal success and unavailable host/retry |
| Combined authored document | 92,412 | 25 elements, 19 connections, 15 schemas, 11 scenarios, 48 expected assertions; about 4.4% of 2 MiB |
| Synthetic storable document | 2,096,128 | Exactly 1,024 bytes below 2 MiB, 100 elements and 100 schemas; intentionally unmodeled, not runnable |
| Synthetic 100k trace rows | 47,655,521 | Exceeds 16 MiB; row and byte budgets must be enforced together, stopping incomplete at the first limit |
| Synthetic recovery export | 148,164 | 100 branches/100 checkpoints, no fabricated commits or runs; includes full portable wrapper |

The combined document has raw container depth 13; the portable recovery envelope has depth 17. The earlier transfer-depth ceiling 16 was therefore incompatible with these legitimate examples. Proposed corrected simultaneous limits: semantic shape/expression/payload depth 8, raw document depth 32, raw portable envelope depth 40. The byte invariant now budgets the complete envelope rather than just ProjectBundle, so accepted exports cannot exceed the import cap merely because of wrapper overhead.

Retain the proposed 2 MiB document, 1 MiB fixture aggregate, 64 MiB portable envelope and 128 MiB local-project ceilings for implementation validation. These specimens establish room for the required examples, **not** a performance guarantee or proof every maximum can be combined. Count, byte, depth and compiler-expansion limits apply simultaneously. The synthetic near-ceiling document contains more independently identified fields than the compiler entity budget; it is storable incomplete work and is not evidence of run-readiness at that size.

Unmeasured gates remain assigned to implementation acceptance: actual runtime traces/payload table size, large commit/evidence histories, browser quota behavior, database transaction cost, compiler cancellation latency, main-thread responsiveness, mobile rendering and heap usage. No result in this report is an observed simulation outcome. Fixture assertions are specifications, not passing checks. No production budget should be raised based on this serialization exercise alone.
