# Five-family planning fixtures

These are authored specification data, **not executed simulations or saved passing results**. The application does not yet read studio-model/1. Expected assertions describe acceptance targets for Gemini's future implementation, with Claude review and Codex verification. No old user data was converted or deleted.

| File | Scenarios | What it exercises |
|---|---|---|
| [s01.json](s01.json) | Invalid cart; duplicate submit; timeout/retry/stale response | Machine guards/effects, explicit call boundary, logical response release, request-ID bindings |
| [s02.json](s02.json) | Allowed order; denied order | Call-entry machine, validation pipeline, decision/reply, broker/worker, separate request/message accounting |
| [s03.json](s03.json) | Five-row normalization | Mixed-type external amount, strict validation error, trim/deduplicate/group-sum, exact EU/US totals |
| [s04.json](s04.json) | Failover; active/queued outage; outage at completion | Explicit deployment, route detection/recovery, cancelled callbacks and exactly-once settlement |
| [s05.json](s05.json) | Accepted+fulfilled; unavailable host then retry | Frontend through a real modeled capacity stage into business reply/message work; transport outcome reaches UI |
| [combined.json](combined.json) | All 11 scenarios | Shared storage/size specimen containing all five authored models and views; each scenario keeps its explicit scope |

Every definition has a deterministic fixture UUID; production constructors still generate fresh UUIDs. S04's two route edge IDs are explicitly ordered A then B because retained routing sorts by edge ID. No schema dependency is inferred from labels.

Run the planning-only inventory with `node specs/revamp/fixtures/measure.mjs`. It reads these fixed files, checks duplicate UUID definitions, endpoint/channel/shape compatibility, fixture payloads, selected references and count/byte bounds, then prints canonical bytes/SHA-256. It is **not** the future full schema validator, executable compiler, kernel or browser test. Independent semantic reviews use exact data with consistent UUID aliases to reduce reviewer noise; full original data and measurement hashes remain authoritative.

The script also recreates a storable near-2-MiB document, a synthetic 100k-row trace encoding and a 100-branch/100-checkpoint recovery export in memory. Synthetic trace rows are sizing specimens only and are never saved as run evidence. The recovery export contains no fabricated commits or passing runs. These stress recipes measure serialization, not heap usage, event-loop responsiveness or database transaction performance.

Implementation acceptance still requires all cases in [execution-slices](../contracts/execution-slices.md), including fulfillment failure/retry limits, malformed references, cancellation, refinement exclusivity and chunk-independent scheduling. The 11 fixtures are concrete representability/sizing witnesses, not an assertion that these other regression cases have already passed. S03 provenance and S04 exact per-arrival route/timestamp oracles must be checked directly in runtime trace tests in addition to authored scalar assertions.

Review status: S01–S04 and sizing PASS; S05 PASS after contract corrections ([review](../reviews/2026-09-23-contract-fixture-s05-report.md), [closure](../reviews/2026-09-23-contract-fixture-s05-closure-report.md)). Review and measured evidence are linked from the [contract register](../contracts/README.md). A reviewer PASS on a fixture's semantics cannot lift the user implementation hold.
