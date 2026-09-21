# RV-02b — Mutation and history contracts

Status: lead draft for Claude review; detailed portable schema and measured storage budgets remain separate RV-02 gates. No compatibility conversion is required.

## Shared command boundary

All authored edits use one pure command validator/reducer with a repository adapter. UI and future AI invoke the same boundary. Request: `commandId`, `operationId` UUID, `projectId`, `branchId`, `expectedWorkingRevision`, `actor`, typed payload. Result is a discriminated union: `applied` (new revision, changed IDs, undo description), `invalid` (field/element issues), `stale` (expected/current revision), `missing`, or `storage-failed`. No raw patch/path API is exposed to future providers.

Current actor provenance: `{actorId, kind: 'local-human', displayName}`. Persist stable local actor ID separate from mutable display text; display names are self-reported. Do not implement `ai-agent` authorization now. Future actor kinds use a versioned union extension. Identity/provenance conveys no access rights. Local timestamps are display metadata, never conflict ordering.

`operationId` is reused for retrying the exact same command, with request hash recorded atomically. Matching operation returns the original result; reuse with different content fails. Keep dedup records referenced by durable operations; transient session undo history is separately bounded. No server outbox is implemented in this phase.

## Inspector Apply

Use a conservative document-level revision for v1. Capture `{projectId, branchId, targetIds, baseWorkingRevision, baseValues}` on opening a draft. Any authored change to that branch makes Apply stale; selection, viewport, panels and simulation ticks do not increment the authored revision. This can reject unrelated concurrent edits, which is preferable to silently overwriting them. No per-element revision subsystem is required initially.

Apply parses the complete draft, validates target existence and all cross-references, validates expected branch/project and revision, then submits one compound command and one undo entry. Invalid or stale results preserve the draft. Stale UI offers reload/discard/cancel; no automatic overwrite. Cancel discards draft only. Branch/project switch or dirty-target change requests Apply/discard/cancel; failed Apply or save cancels navigation. Multi-selection uses the same single base revision and atomic validation.

The reducer computes a candidate without mutating current state. Persistence success publishes the accepted candidate to editor state. If optimistic display is later desired it requires explicit pending/error/rollback behavior; initial implementation uses pending controls during save.

## Local compare-and-set

New database namespace and schema are frozen by the storage contract, independent of old `system-studio`. `workingRevision` and branch/main head values live in records; no index on revision is needed solely for CAS. Use one read-write Dexie transaction covering affected branch/project/commit/publication/run-evidence/operation tables. Read current records, compare expected values, reject if stale, write immutable rows and update pointers, then commit. Database abort leaves all old rows/pointers intact.

Never await hashing, network, arbitrary callbacks or worker responses inside the transaction. Cross-tab messages update views after commit; the transaction is authoritative. Every writer—including autosave, checkpoint, commit, publish and restore—uses the same revision check. An externally changed current branch prompts reload/reconcile; never silently saves an older in-memory graph over it.

## History transition table

| Action / precondition | Atomic effect | Rejection / recovery |
|---|---|---|
| New project | Create branch working copy with nullable head and revision 0 | No fabricated initial commit or run |
| Checkpoint incomplete model | Save named immutable authored snapshot, no commit status | Quota failure leaves working copy; show retry |
| Commit with completed required scenarios | Add immutable commit with parent current branch head; advance branch head; increment branch revision | Stale working revision or missing evidence rejects everything |
| Prepare publish | Resolve common ancestor and isolated merged candidate with expected source/main heads and revisions | Missing merge base blocks; do not invent common ancestry |
| Publish candidate | Validate candidate/evidence; add merge commit/publication, advance main, record prior state and optional source closure | Any changed expected head/revision rejects; recompute candidate |
| Undo latest publication with expected current main | Add compensating history record restoring previous published content; advance main to compensation; preserve original history | Moved main rejects; user can instead create a new restore branch |
| Restore historical snapshot | Create/update an explicit working draft with source provenance; increment revision | Does not rewind immutable history or manufacture qualifying evidence |
| Switch branch | Finish save of source working state, resolve inspector draft, then load target | Any save/conflict failure keeps source active |

Undo publication uses stored previous-content snapshot and its matching completed evidence. It passes the same D20 gate: if evidence is unavailable, create a restore draft requiring a run instead. Source branch reopening is permitted only if its closure was performed by that publication and its recorded closure revision still matches; otherwise preserve its newer state and report that reopening was skipped. Descendant branches keep their existing immutable parent references; compensation does not erase or reparent descendants. A later main commit makes direct undo unavailable. First publication with no prior published content has no direct undo-to-empty commit; offer restore draft. Concurrent tabs race on expected main, so only one compensation can succeed.

## Merge identity rules

All mutable collection members that can be referenced independently have stable IDs: elements, ports, behavioral/structural edges, views and placements, notes, scenarios, workloads/classes, subsystems, transition rules and assertions. Constructors generate UUIDs; edits and round trips preserve IDs; cloning/part placement creates a complete remapping. Duplicate IDs or dangling references reject import/command before mutation.

Three-way merge operates by ID and schema field, never display position. Both sides same change coalesce; one-sided changes apply; competing scalar values, delete/edit, incompatible kinds and reference breaks are conflicts. Ordered sequences (transition priority, data operations, event schedule) are whole-field conflicts initially; no guessed interleaving. An explicit reorder is authored content. Run artifacts, personal preferences and undo stacks are not merged as model fields.

Legacy ID stability is audit evidence only; the current-only schema enforces new invariants instead of preserving malformed old IDs. Existing `domain/revisions.ts` supports current snapshot/compare/finalize workflows and cannot be deleted until their new history equivalents are reachable and tested.
