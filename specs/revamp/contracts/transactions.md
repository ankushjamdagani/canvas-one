# Mutations, history and merge (RV-02b)

How authored changes, commits, publication and merges are applied safely. Exact command payloads and results are in [commands.md](commands.md); records, the publish transaction's storage and limits are in [storage.md](storage.md).

## 1. Command boundary

- All authored edits go through one pure validator/reducer plus a repository adapter. The UI and any future AI use the same boundary; there is no raw patch or path API.
- The reducer computes a candidate without mutating current state. The editor shows it only after persistence succeeds. The initial UI disables controls while saving; optimistic display would need explicit pending/rollback behavior.
- **Actor.** `{actorId, kind:'local-human', displayName}`. The stable ID is separate from the self-reported name, and unknown kinds are rejected. Provenance grants no rights. Future actor kinds (e.g. AI) arrive as a versioned union extension; none are implemented now. Local timestamps are for display, never for ordering conflicts.
- **Idempotency.** Retrying a command reuses its `operationId`. The request hash is computed before the transaction and stored atomically with the result. The same ID with the same content returns the original result; with different content it fails (`operation-id-reused`). Receipts live as long as their durable operations; session undo is bounded separately. No server outbox yet.

## 2. Revisions and compare-and-set

- v1 uses one document-level revision per branch. Any authored change to the branch makes an open draft stale. This is conservative — it can reject unrelated concurrent edits — and that is preferable to silent overwrites.
- **Authored content** includes view layout (positions, notes, saved views). It increments `workingRevision` but stays out of the execution fingerprint.
- **Preferences** (camera, panels, dock) use their own repository and revision, and never touch `workingRevision`. Selection and live simulation ticks are transient.
- Every writer (autosave, checkpoint, commit, publish, restore) runs one read-write Dexie transaction over the affected tables. It reads current records, compares expected revisions/heads, rejects if stale, writes immutable rows, moves pointers and commits. An abort leaves every old row intact.
- Never await hashing, network, callbacks or workers inside a transaction.
- Cross-tab messages are advisory, sent after commit. If the current branch changed elsewhere, prompt reload/reconcile; never save an older in-memory graph over it.

## 3. Inspector Apply

- Opening a draft captures `{projectId, branchId, targetIds, baseWorkingRevision, baseValues}`.
- Apply parses the whole draft, checks target existence, cross-references and revision, then submits **one compound command = one undo entry**. Multi-selection works the same way.
- Invalid or stale Apply keeps the draft. Stale offers reload/discard/cancel; nothing is overwritten automatically.
- Cancel discards the draft only.
- Switching branch or project, or changing the target, with a dirty draft asks Apply / Discard / Stay. A failed Apply or save cancels the navigation.
- **Run requires a clean draft (D25).** Apply or Cancel first; there's no "run last applied version" option. Commit and publish review also resolve dirty drafts first. Drafts never become run inputs.

## 4. History transitions

| Action | Precondition | Atomic effect | On failure |
|---|---|---|---|
| New project | — | Main + open draft branch share the creation snapshot; nullable heads; revision 0 | No fabricated commit or run |
| Checkpoint | Storable snapshot (incomplete OK) | Immutable named snapshot, with no commit status | Working copy intact; retry |
| Commit | Non-main branch; passing evidence for every scenario ([run-identity.md §5](run-identity.md#5-eligibility)) | Commit with parent = branch head; advance head; revision++ | Empty scenario set, stale revision, failing or missing evidence reject everything |
| Prepare publish | Source has a committed head and no uncommitted changes; main has no uncommitted changes | Isolated merged candidate from the common ancestor, recording expected source/main heads, revisions and candidate snapshot | Missing or ambiguous merge base blocks; never invent ancestry |
| Publish | Candidate eligible; tokens unchanged | Merge commit + publication; advance main head and working snapshot together; both revisions++; close source (default) | Any token change or failing evidence rejects; source stays open; re-prepare |
| Reopen branch | Closed, non-main | Set open via revision check; branch revision++; work and history preserved | Stale rejects; main and publications unchanged |
| Restore snapshot | Non-main branch | Save current working state as a checkpoint, then replace working content | History heads unchanged; no qualifying evidence created |
| Switch branch | — | Flush source save, resolve draft, load target | Any failure keeps the source active |

- **Main** is changed only by publication. Direct commit or restore on main is rejected. To keep main working edits, create a branch from working content and switch to it.
- **No publication undo (D26).** There is no undo command, compensating record or main rewind. Corrections are new commits and publications through the same gate. Reopening a branch is not undo. Keeping the source branch open is an opt-in that defaults off (D29).
- **Pinning.** Committed/published snapshots and their evidence can't be deleted independently (`referenced-artifact`). Missing or corrupt content returns `missing` with IDs; restore content is never fabricated.
- **Titles.** `Project.title` is navigation metadata; `Document.title` is a per-branch caption. Rename updates both in one command without rewriting other branches or snapshots.

## 5. Merge

- Every independently referenced member has a stable ID: elements, ports, edges, views, placements, notes, scenarios, workloads/classes, transitions, assertions, and so on. Constructors generate UUIDs; edits and round trips preserve them; cloning and parts remap them all. Duplicate or dangling IDs are rejected before mutation.
- Three-way merge works by ID and schema field, never display position:
  - An identical change on both sides coalesces.
  - A one-sided change applies.
  - These become conflicts: competing scalars, delete vs edit, incompatible kinds, broken references.
  - Ordered sequences (transition priority, operations, event schedules) conflict as a whole field; there's no guessed interleaving. An explicit reorder is authored content.
- Run artifacts, preferences and undo stacks are not merged.
- **Conflict UI** shows base / ours / theirs with real branch names. Scalar and entity conflicts are resolved individually. A sequence conflict offers keep ours, keep theirs, or edit the sequence with normal validated controls (never raw JSON). Resolutions change only the isolated candidate, which must fully validate before it can run or publish.
- Every prepared token covers source/main heads, working revisions and the candidate snapshot ID; any change invalidates it.
- Existing `domain/revisions.ts` stays until its new history equivalents are reachable and tested.
