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
| `modelSchemaVersion` | Current schema number, frozen with RV-02 storage contract |
| `compilerVersion`, `runnerVersions` | Explicit semantic versions including resource-kernel adapter; sorted by runner ID |
| `scenario` | ID, scenario revision, mode, designated inputs/events, initial state, assertions, deterministic seed, step/event/time budgets and effective assumptions |
| `scope` | Sorted included element and behavioral-edge IDs, declared boundaries, excluded elements and boundary-response fixtures; no implicit traversal at runtime |
| `elements` | Included stable IDs, behavior kind/version/config, typed ports, effective resource configuration where used |
| `connections` | Executable edge IDs, endpoints/ports, kind and config; sorted by ID, with explicit priority where order matters |
| `structuralConstraints` | Only relationships interpreted by compiler rules, including deployed-on constraints and outage targets; sorted by ID |
| `refinements` | Exactly one aggregate/refined choice per selected element, pinned model versions and boundary mappings |
| `fixtures` | Validated content-addressed payloads/mock schedules and their hashes; missing referenced content blocks readiness |

Assertions are included: changing an expectation requires running the new check. Assumption values and source classification are included so evidence does not quietly change from guessed to measured. Run wall-clock timestamps, playback speed, labels, view positions, selection, collapse and panel/dock preferences are excluded. Trace display limits that truncate evidence are included in budgets; purely visual row virtualization is excluded.

Scope includes every executable dependency required by the scenario. A structural relationship interpreted by fault compilation is executable; a descriptive arrow has no runtime effect. All-field projection tests must fail when a newly introduced executable schema field has no explicit inclusion/exclusion decision.

## Lifecycle and eligibility

`created → validating → running ↔ paused → completed`. Validation rejection ends `invalid`; cancellation/reset ends `cancelled`; uncaught runtime error ends `failed`; exhausted step/time/memory/trace budget ends `incomplete`. A modeled business failure is a trace outcome, not a runtime failure. The runner decides completion by scenario terminal conditions or declared finite workload horizon and drain policy, never by animation stopping.

Only `completed` local evidence may satisfy D20. `completed` includes assertion failures, shown explicitly. Invalid/failed/cancelled/incomplete/paused runs never qualify. Imported records are `imported-unverified` regardless of their claimed original status; preserving their source status is descriptive. Future trusted remote evidence requires a separately reviewed trust contract.

At commit/publish preparation, calculate fingerprints for the candidate's non-empty required scenario set. Each scenario needs an immutable local completed run whose fingerprint matches. Store an evidence manifest with scenario ID, fingerprint, run ID, completion, assertions summary and tested scope. No requirement to cover every element is inferred, but uncovered elements must be visible. Removing scenarios does not implicitly redefine the required set: editing that set is an explicit authored action shown in commit review.

Commit a complete authored snapshot even if only view metadata changed; existing matching evidence can qualify it. Reusing evidence does not claim the presentation was tested. Candidate merge snapshots are isolated; a changed fingerprint requires running that candidate before publish.

## Persistence integrity

The local repository owns evidence provenance; portable input cannot set a trusted-local flag. Run start binds an immutable snapshot and manifest. UI edits during the run never mutate them. Completion stores result and manifest atomically; quota/write failure leaves an unsaved result visible with retry, never a durable qualifying record.

Precompute validated candidate, identities and evidence outside the publish transaction. Inside the transaction recheck branch/main revision tokens, referenced immutable artifacts and completion/fingerprint eligibility, then write all records. Stale state rejects; no implicit retry using a different candidate. Store minimal completion/evidence summaries with referenced snapshots; bulk trace retention must not delete evidence required by a commit. User-requested deletion of required evidence is blocked or explicitly removes eligibility before any subsequent use.
