# @canvas-one/history

`CandidateService` owns preparation through a narrow version store, ancestry/CAS/head checks, ephemeral candidate registration and conflict resolution/supersession. Hosts inject document merge, conflict enumeration, resolution, snapshot hashing, freezing and error classification; no document schema or execution engine is assumed. Generic publication tickets share one private in-memory issuer between history consumers and storage bindings, so portable copies cannot forge publication authority.

`evaluateCandidateState` owns candidate state gates and evidence coordination through injected readiness, evidence lookup and qualification policies. `publishCandidate` validates publication envelopes and exact candidate scope, then issues a ticket and dispatches a single injected publication write. Hosts supply actor/ID/revision validation and their transactional storage capability. System design supplies its independent scenario manifest/readiness policy; candidate execution is an optional simulator capability.

Headless local undo and version graph mechanics. No UI, storage, editor or domain dependency.

`LocalUndoHistory<Change>` stores cloned forward/inverse entries with labels and a configurable bound (100 by default). Prepare an undo/redo ticket, execute the corresponding changes through your authoritative transaction service, then call `commit(ticket)` after a successful receipt. Failed writes leave stacks unchanged. New accepted edits clear redo; `clear()` invalidates pending tickets on branch changes or reload. Snapshots and tickets isolate consumer mutation from retained history.

`findMergeBase` uses injected commit lookup and DAG ancestry. `computePinClosure` reports deterministic retention references and dangling IDs from supplied history records. Semantic document diff, merge, publication policy and interface presentation belong to their consuming packages/apps.

`VersioningService` coordinates checkpoint, restore and commit transactions through injected scope, execute and receipt callbacks. `PublicationService` validates publication metadata and constructs candidate publication transactions; the host supplies its atomic candidate/evidence policy. Immutable branch, checkpoint, commit and publication contracts belong to this package; evidence and actor types remain generic.

Evidence qualification reads minimal supplied checks and summary facts. `buildEvidenceManifest` accepts an artifact converter, allowing the existing simulation provider or a different execution provider without importing a simulator. The root exports have no React, IndexedDB, DOM or simulation dependency.

`HistoryTransitionPlanner` owns branch fork, restore, reopen, commit and publication
effects, revision increments and publication parent deduplication. The current
application supplies actor, head/revision and executable evidence policies and
commits the resulting plans through storage's atomic operation coordinator.
