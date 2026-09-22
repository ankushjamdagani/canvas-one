**REVISE** — two blocking defects.

---

## Defect 1 — Pin closure omits `projects.initialSnapshotId` (blocking)

**Location:** `storage-and-limits.md`, run-retention paragraph.

Stated pin closure:
> "Pin closure includes all branch working/head snapshots, commit ancestry/evidence, publications and checkpoints."

Stated invariant (same document):
> "initialSnapshotId is immutable…remains pinned for unborn-branch merge ancestry **even after all branches advance**."

Once every branch has at least one commit, no branch's `workingSnapshotId` or head-commit `snapshotId` equals the creation snapshot. At that point the initial snapshot falls outside the pin closure and an explicit prune transaction would legally delete it — breaking the merge-base invariant for any future unborn branch created from that project.

**Smallest correction:** Add `projects.initialSnapshotId` as an explicit snapshot pin source in the pin closure definition.

---

## Defect 2 — `runs.completedAt` nullability conflicts with terminal-only save semantics (blocking for retention ordering)

**Location:** `storage-and-limits.md`, runs table definition + run-retention paragraph.

Schema: `completedAt:null|number`

Save semantics: "Terminal run summary, manifest, checks and retained chunks commit atomically."

Retention key: `(completedAt, id)` — undefined sort order when `completedAt` is null.

If only terminal runs are ever persisted (as the save semantics imply), null is unreachable and the nullable type is misleading. If a non-terminal status can be stored (e.g., `status='incomplete'`), the contract must enumerate which statuses permit null `completedAt` and how they order against non-null values in the retention sort.

**Smallest correction (choose one):**
- Change type to `completedAt:number` and state all persisted runs are terminal (completedAt always set on save); or
- Enumerate the `status` values, state which permit null `completedAt`, and specify retention sort behavior for nulls (e.g., "null sorts last, treated as never-completed").

---

## Non-blocking observations (no REVISE required)

- **Implicit pin definition for runs:** "pinned run" is never defined operationally; readers must infer it means "referenced by a commit's `EvidenceRef`". A one-line definition would remove ambiguity.
- **Byte accounting location:** Contract says "checked transactionally using per-record canonical sizes" but names no stored running total. Implementation would be forced to sum all project records on every write. Not a correctness gap but a performance contract gap worth a note.
- **`pruneUnreferenced` must traverse `projects.initialSnapshotId`:** Falls out of Defect 1 fix; just noting the implementation must include this join.
