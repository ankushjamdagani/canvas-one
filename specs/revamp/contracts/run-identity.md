# Run identity and eligibility (RV-02a)

How a run is tied to the exact model it tested, and when runs qualify a commit or publication (D20/D27/D28). Replaces reuse of the current worker reset key (`executionSignature`), which depends on array order and covers only the old model.

## 1. Identities

| Identity | Definition |
|---|---|
| `snapshotId` | SHA-256 of the complete validated authored content, including views and notes. Excludes history, artifacts, preferences and storage timestamps. |
| `executionFingerprint` | `ss-run-v1:` + lowercase hex SHA-256 of the execution manifest (§3). |
| `runId` | Fresh UUID per attempt. Equal fingerprints don't merge attempts; eligibility may cite any trusted local completed attempt with that fingerprint. |
| `workingRevision` | Safe integer incremented by each persisted working-document transaction. Overflow fails without mutation. It's a staleness token, not a hash. |

A presentation-only edit changes `snapshotId` but not the fingerprint. IDs refer to stable entities, never names or array positions. A rename keeps the fingerprint only if the label is presentation-only; any name used for behavior lookup must become an ID reference.

## 2. `canonical-json-v1`

Defined over validated JSON only. UTF-8, no BOM, no trailing newline, then SHA-256 via Web Crypto behind an async boundary (never inside a DB transaction).

1. Object keys are sorted by UTF-16 code units (not locale), with no whitespace.
2. Strings use `JSON.stringify` escaping. Unpaired surrogates are rejected; valid Unicode is preserved exactly (no normalization).
3. Numbers must be finite and in their validated range, serialized with `JSON.stringify`, with `-0` → `0`. Integer fields need safe integers. NaN, Infinity, BigInt, undefined, functions, sparse arrays and non-plain objects are rejected.
4. Arrays keep their order. The manifest builder sorts entity *sets* by ID explicitly; ordered data (transitions, operations, inputs, route priority) keeps its order.
5. Defaults are materialized before hashing. Missing ≠ null unless a field's schema normalizes it. Unknown fields fail validation; they never silently vanish from the hash.

Required golden vectors, frozen in tests independently of the implementation:
- Equal hash: reordered keys; reordered entity storage; `-0` vs `0`; layout-only change; omitted vs materialized default.
- Different hash: reordered input events; any executable field change.
- Rejected: invalid numbers and unpaired surrogates.

## 3. Execution manifest v1

The compiler builds a manifest from an immutable snapshot plus one scenario ID.

| Field | Contents |
|---|---|
| `identityVersion` | `1` |
| `modelSchemaVersion` | `studio-model/1` |
| `compilerVersion`, `runnerVersions` | Semantic versions, including the resource-kernel adapter; sorted by runner ID |
| `scenario` | ID, revision, mode, inputs/events, initial state, assertions, seed, budgets, effective assumptions |
| `scope` | Sorted included element and behavioral-edge IDs, declared boundaries, excluded elements, boundary-response fixtures |
| `elements` | Included IDs, behavior kind/version/config, typed ports, effective resource config |
| `schemas` | Transitively referenced payload schemas, sorted by ID |
| `connections` | Executable edges, sorted by ID; explicit priority where order matters |
| `structuralConstraints` | Only relations interpreted by compiler rules (e.g. `deployed-on`, outage targets) |
| `refinements` | One aggregate/refined choice per selected element, pinned versions, boundary mappings |
| `fixtures` | Content-addressed payloads/mock schedules and hashes; missing content blocks readiness |

**Included:** assertions, so changing a check requires a rerun; assumption values and sources, so evidence can't quietly change from "guessed" to "measured"; and trace limits that could truncate evidence.

**Excluded:** wall-clock times, playback speed, labels, view positions, selection, collapse state, panel/dock preferences, display-only virtualization. The full field-by-field split is in [model-and-runner.md §7](model-and-runner.md#7-projection-inventory).

**Scope closure.**
- A fixed-point closure runs from the entry ports over every *potentially* reachable behavioral branch (not only the branches one run observed), refined submodels, schema/fixture references and interpreted structural constraints.
- Every crossing of the authored scope must resolve to an explicit boundary fixture or pinned submodel. Unresolved crossings, missing targets and unsupported relation kinds fail readiness before fingerprinting.
- Declared scope and computed closure are both recorded; inactive elements show as uncovered.
- Closure processes each entity once (visited sets or work queues). It rejects recursive refinement before expansion and enforces the compiled-entity/reference limits *during* expansion.
- Compilation runs in a worker, checks cancellation between batches, and returns `analysis-limit` or `cancelled` rather than freezing or accepting partial closure.

**Hash unavailable.** If Web Crypto is unavailable or fails, return `identity-unavailable`. This blocks qualifying runs, commit and publish, and editing and autosave keep working. There is no weaker fallback hash.

**Record separation.** Behavioral connections (call/message/data) and structural relations (contains/deployed-on/descriptive) are disjoint unions. Misfiled or unknown kinds are rejected; they can't drop out of identity.

**Coverage test.** Adding a synthetic executable field without classifying it must fail the contract test. Once classified, changing only that field must change the fingerprint.

## 4. Run lifecycle

`created → validating → running ⇄ paused → completed`. Other terminal states:
- `invalid`: validation rejected
- `cancelled`: cancel or reset
- `failed`: uncaught runtime error
- `incomplete`: step, time, memory or trace budget exhausted

A modeled business failure is a trace outcome, not `failed`. Completion comes from scenario terminal conditions or the declared horizon/drain policy, never from an animation stopping.

## 5. Eligibility

A run qualifies a scenario only if **all** of the following hold:
- status `completed`
- provenance `local` (imported runs are always `imported-unverified`; their original status is kept for display only)
- the fingerprint matches the candidate's manifest for that scenario
- every configured check was evaluated and passed (skipped, errored or unevaluated checks count as not passing)
- non-vacuous: ≥1 passing assertion and ≥1 consumed input or workload root, with all assertion subjects in compiled scope

A completed run with failing checks is kept for diagnosis but never qualifies. A modeled failure can qualify when its checks assert that failure.

At commit/publish preparation:
- Enumerate every scenario in the immutable candidate. There must be at least one, and there is no required subset and no disabled-scenario bypass. An incomplete scenario blocks eligibility.
- Store an evidence manifest: full scenario inventory, fingerprint, run ID, completion, check outcomes and tested scope.
- Adding, editing or removing a scenario is an authored change: recompute the inventory and invalidate prepared eligibility.
- Every scenario is required, but full element coverage isn't inferred; uncovered elements are shown honestly.

Evidence may come from another local branch if the manifest matches. A view-only change can reuse matching evidence; the commit still stores the full snapshot, and reuse doesn't claim the presentation was tested. A merged candidate with a changed fingerprint must be run itself before publishing. Saved run outcomes are never edited.

## 6. Persistence integrity

- Only the local repository sets provenance; portable input can't claim trusted-local.
- A run binds an immutable snapshot and manifest at start. Edits during the run don't touch them.
- Completion stores result + manifest atomically. On quota or write failure the result stays visible, unsaved, with a retry; it never becomes a durable qualifying record.
- Publish: compute the candidate, identities and evidence *outside* the transaction. *Inside* it, recheck branch/main revision tokens, candidate ID, scenario inventory, and each scenario's fingerprint, completion, checks, provenance and scope. Then write everything, including default source closure. Stale state rejects; there's no implicit retry with a different candidate.
- Evidence required by a commit is reference-pinned; trace pruning can't delete it. Deleting a whole project is a separate explicit operation.
- Future trusted remote evidence needs its own trust contract.
