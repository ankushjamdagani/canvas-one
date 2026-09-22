# RV-02a — Canonical run identity

Status: lead contract draft for Claude review. No runtime implementation authorized until accepted. Implements D17/D20/D21 and R13; this replaces reuse of the current worker reset key.

## Identity domains

Use separate identities for authored snapshots, executable scenarios and persisted working-copy revisions. A presentation edit changes the authored snapshot but need not invalidate a run. An expected revision token prevents stale mutation; it is not a content hash.

- `snapshotId`: SHA-256 of the complete validated portable authored content, including views/notes but excluding history, artifacts, local preferences and timestamps of storage operations.
- `executionFingerprint`: SHA-256 of the validated execution manifest below, prefixed `ss-run-v1:`, lowercase hexadecimal digest.
- `runId`: independently generated UUID for one attempt. Equal fingerprints do not make attempts interchangeable records; eligibility can reference any trusted locally completed attempt of that fingerprint.
- `workingRevision`: non-negative safe integer incremented by each successful persisted working-document transaction. Revision overflow fails without mutation.

IDs refer to stable entities, never names or array indices. Rename changes snapshot identity. A rename can retain execution identity only if the label is presentation-only; any name used as a behavior lookup must instead become an explicit ID reference.

## Canonical encoding

Define `canonical-json-v1` over validated JSON values only. UTF-8 encode the resulting string without BOM or final newline, then SHA-256. Use browser Web Crypto behind an async hashing boundary; do not perform async hashing inside a database transaction.

1. Object keys sort by UTF-16 code units using a comparator, independent of locale. Encode each key/value recursively, with colon/comma separators and no whitespace.
2. Strings use ECMAScript `JSON.stringify` escaping. Reject unpaired surrogates in keys and string values; preserve valid Unicode exactly, without implicit normalization.
3. Numbers must be finite JSON numbers in the field's validated range. Serialize with ECMAScript `JSON.stringify`; normalize negative zero to zero. Integer fields require safe integers. Reject NaN, Infinity, BigInt, undefined, functions, sparse arrays and non-plain objects before encoding.
4. Arrays preserve order. The manifest builder explicitly sorts entity sets by stable ID before encoding; it never guesses that arbitrary arrays are sets. Ordered transitions, operations, input events and route priorities retain semantic order.
5. Materialize effective defaults before hashing. Missing optional values and explicit null are distinct unless that field's schema explicitly normalizes them. Unknown fields fail validation instead of disappearing from the hash silently.

Required vectors: reordered object keys equal; reordered semantic input events unequal; reordered entity storage equal; `-0`/`0` equal; executable field change unequal; layout-only change equal; invalid numeric/surrogate values rejected; default omitted/materialized equal. Golden byte strings and digests must be frozen in implementation tests independently of the implementation under test.

## Execution manifest v1

The compiler constructs a manifest from an immutable authored snapshot and a scenario ID. It contains:

| Field | Required meaning |
|---|---|
| `identityVersion` | Literal `1` |
| `modelSchemaVersion` | Literal `studio-model/1`, as specified in document-and-runner.md |
| `compilerVersion`, `runnerVersions` | Explicit semantic versions including resource-kernel adapter; sorted by runner ID |
| `scenario` | ID, scenario revision, mode, designated inputs/events, initial state, assertions, deterministic seed, step/event/time budgets and effective assumptions |
| `scope` | Sorted included element and behavioral-edge IDs, declared boundaries, excluded elements and boundary-response fixtures; no implicit traversal at runtime |
| `elements` | Included stable IDs, behavior kind/version/config, typed ports, effective resource configuration where used |
| `schemas` | Transitively referenced closed payload schemas, sorted by stable ID, including all typed shape/default/nullability fields |
| `connections` | Executable edge IDs, endpoints/ports, kind and config; sorted by ID, with explicit priority where order matters |
| `structuralConstraints` | Only relationships interpreted by compiler rules, including deployed-on constraints and outage targets; sorted by ID |
| `refinements` | Exactly one aggregate/refined choice per selected element, pinned model versions and boundary mappings |
| `fixtures` | Validated content-addressed payloads/mock schedules and their hashes; missing referenced content blocks readiness |

Assertions are included: changing an expectation requires running the new check. Assumption values and source classification are included so evidence does not quietly change from guessed to measured. Run wall-clock timestamps, playback speed, labels, view positions, selection, collapse and panel/dock preferences are excluded. Trace display limits that truncate evidence are included in budgets; purely visual row virtualization is excluded.

Scope includes every executable dependency required by the scenario. The compiler performs a fixed-point dependency closure from entry ports over every potentially reachable behavioral branch (not just branches observed in one run), refined submodels, payload-schema/fixture references and structural constraints interpreted by execution. Every crossing of the selected authored scope must resolve to an explicit typed boundary fixture or pinned submodel. Unresolved crossings, missing targets and unsupported relationship kinds reject readiness before fingerprinting. The compiler records declared scope and computed closure; inactive elements remain visibly uncovered. A structural relationship interpreted by fault compilation is executable; a descriptive arrow has no runtime effect.

Closure uses visited-ID sets/work queues with each reachable entity/reference processed once, and rejects recursive refinement before expansion. Validate schema counts first; enforce the RV-02e compiled-entity/reference limit during expansion, not only after allocating it. Compilation runs in a worker, checks cancellation between bounded batches and returns `analysis-limit`/`cancelled` rather than freezing the UI or accepting partial closure. Numeric limits and batch measurement are frozen with schema/fixture budgets before compiler dispatch. Web Crypto unavailable/rejected returns `identity-unavailable`, blocks qualifying runs/commit/publish, and preserves editable/autosaved content; no weaker hash fallback.

Validators use disjoint discriminated unions: call/message/data records are allowed only in behavioral connections; contains/deployed-on/descriptive relationships only in structural records. A compiler rule explicitly promotes relevant structural constraints into the manifest. Misfiled/unknown kinds reject validation; they cannot silently drop out of identity.

All-field projection tests must fail when a newly introduced executable schema field has no explicit inclusion/exclusion decision. Required schema-evolution test: add a synthetic executable field to the validator fixture without updating the exhaustive projection classification; the contract check must fail. After classifying it, changing only that field must change the fingerprint. This is a coverage assertion in addition to golden hash vectors.

## Lifecycle and eligibility

`created → validating → running ↔ paused → completed`. Validation rejection ends `invalid`; cancellation/reset ends `cancelled`; uncaught runtime error ends `failed`; exhausted step/time/memory/trace budget ends `incomplete`. A modeled business failure is a trace outcome, not a runtime failure. The runner decides completion by scenario terminal conditions or declared finite workload horizon and drain policy, never by animation stopping.

Only `completed` local evidence with every configured check evaluated and passing may satisfy D20/D27. Completion remains distinct from assertion outcome: a completed run with failing checks is retained for diagnosis but cannot qualify for commit/publication. Skipped, errored or unevaluated checks do not pass. A deliberately modeled failure can qualify when its checks correctly assert the expected failure outcome. Invalid/failed/cancelled/incomplete/paused runs never qualify. Imported records are `imported-unverified` regardless of their claimed original status; preserving their source status is descriptive. Future trusted remote evidence requires a separately reviewed trust contract.

At commit/publish preparation, enumerate every scenario configured in the immutable candidate (D28), with at least one scenario. Each needs an immutable local completed, passing run whose fingerprint matches its current inputs/checks/model. No required-subset or disabled-scenario bypass exists; an incomplete configured scenario blocks eligibility. Store an evidence manifest with complete scenario ID inventory, fingerprint, run ID, completion, check outcomes and tested scope. Adding/editing/removing a scenario is a visible authored change; recompute the candidate inventory and invalidate prepared eligibility. Every configured scenario is required, but full element coverage is not inferred; show uncovered elements honestly.

Changing the system or check definitions requires matching new evidence; never edit a saved run's assertion outcomes. RV-02d defines non-vacuous eligibility as at least one evaluated passing assertion and at least one consumed external input/generated workload root, with all assertion subjects in compiled scope. Diagnostic zero-check runs show “Completed · no checks” and cannot qualify. Autosave/checkpoints remain available for incomplete/failing work. This does not claim author-written checks prove correctness or full coverage.

Commit a complete authored snapshot even if only view metadata changed; existing matching evidence can qualify it. Reusing evidence does not claim the presentation was tested. Candidate merge snapshots are isolated; a changed fingerprint requires running that candidate before publish.

## Persistence integrity

The local repository owns evidence provenance; portable input cannot set a trusted-local flag. Run start binds an immutable snapshot and manifest. UI edits during the run never mutate them. Completion stores result and manifest atomically; quota/write failure leaves an unsaved result visible with retry, never a durable qualifying record.

Precompute validated candidate, identities and evidence outside the publish transaction. Inside the transaction recheck branch/main revision tokens and exact immutable candidate ID/scenario inventory. For every configured scenario require fingerprint equality with the candidate manifest, durable completed status, all configured checks evaluated and passing, trusted-local provenance and matching project scope. Reject omitted scenarios and stale check definitions. Evidence can originate on another local branch when the manifest matches; requiring identical branch ID would incorrectly prohibit reuse after a view-only merge. Recheck referenced immutable artifacts, then write all records including default source closure. Stale state rejects; no implicit retry with a different candidate. Store minimal completion/evidence summaries with referenced snapshots; bulk trace retention must not delete evidence required by a commit. Required snapshots/evidence are reference-pinned and cannot be independently deleted; deletion of a whole project is a separately explicit operation.
