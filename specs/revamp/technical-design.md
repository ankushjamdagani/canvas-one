# Technical design

Status: lead architecture proposal for Claude review. The implementation-ready contract gate must settle concrete schemas, limits and migration fixtures before Gemini changes persisted data.

## Current boundaries to preserve

`src/App.tsx` composes project boot/save/switch, editor selection, simulation and UI state. `src/state/editor.ts` owns graph changes/history and enforces archive read-only behavior. `src/persistence/projects.ts` stores projects in Dexie database `system-studio`, schema version 1. UI and canvas metadata do not belong in executable behavior fields. Keep the exact kernel/accounting unchanged during the reskin.

Current portable behavior verified in source: legacy graphs export format 7, `open-system/1` graphs export format 8; import accepts 7/8 with matching nested snapshots/results. `HANDOFF.md` contains older conflicting prose; do not use it to delete either path. Existing imports are structurally validated, not rerun or authenticated. The existing 2,000,000-character import bound is not a measured byte-size guarantee.

## Target modules and dependency direction

- `components/ui/`: accessible low-level controls only.
- `components/studio/`: shared appearance compositions (field, metric, panel header, status, node chrome).
- `features/workspace/`: command definitions, layout preferences, panel reducer and shell composition.
- `features/library/`: catalog/saved-part presentation and adapters.
- `features/history/`: branch/history/publish/merge presentation.
- `features/results/`: result presentation and measured-value adapters.
- `domain/versioning/` and `domain/parts/`: pure typed operations, validation and deterministic diff/merge; no React/Dexie.
- `persistence/`: validated local repositories, transactions and portable migration.

These are proposed destinations for new code, not a mandate to move every existing file. Reuse existing editors/canvas with adapters, then retire old surfaces only once their capability map is complete. Domain operations return success/error results; UI never mutates snapshots directly.

## Contracts to freeze in RV-02

| Contract | Required information / operations |
|---|---|
| Workspace commands | stable ID, accessible label, icon, shortcut, availability reason, execute; availability computed from typed context |
| Panel preferences | panel ID, placement, open/collapsed state, order/stack, per-side widths, floating rect; open/close/place/collapse/resize/reset |
| Inspector draft | target ID, base revision, editable draft, dirty/valid state, apply/cancel/conflict result |
| Branch workspace | stable branch ID, display name, base commit, head commit, working snapshot, revision token; switch/create/archive/reopen |
| Commit | immutable ID, parent(s), full architecture snapshot reference, message, timestamp, self-reported author, run evidence or diagram exemption |
| Published version | immutable ID/version, commit, previous published head, source branch, title/rationale/ticket, evidence; compare/restore |
| Merge result | common ancestor, ours/theirs, typed changes/conflicts/resolutions, validated candidate, expected-head token |
| Saved part | ID/version, name/description/category, copied graph subset/view metadata, provenance; save/place/update-copy |
| Run evidence | immutable completed result, executable fingerprint, engine version, workload/seed/duration, provenance, completion status |

Adapters keep existing `Project`, editor and saved results operational while feature UI is built from fixtures. Shared contract files have one owner. Branch or part IDs cannot be inferred from names or array order.

## Local versioning model

Use an immutable commit DAG with branch head pointers and separate autosaved working snapshots. Published main is immutable history; editing it creates a draft branch on first edit. Existing graph undo/redo remains an editing-session mechanism, not the commit history. Checkpoints/revisions remain available as legacy snapshots; don't silently turn them into verified commits.

Keep the active working graph exposed to the current editor/simulation through a narrow adapter. Switching branches flushes that branch's save queue, safely handles failure, then loads the other working state and its view metadata. Do not discard an unsaved completed run. Unapplied inspector edits are a separate transient draft: request Apply/discard/cancel before a switch. Save failures must never be represented as successful switching or publication.

For migration, retain original project records until a verified migration transaction succeeds; create a baseline branch and legacy-history references without inventing run evidence. Old format-7 archives keep read-only semantics. An explicit editable-copy operation, if added, is distinct from changing the archive.

### Run eligibility

Define a canonical executable fingerprint using normalized graph execution configuration, workload, seed, duration and engine/model version. Exclude camera, panel placement, selection and purely visual metadata. Store full snapshot content separately for visual history. Do not reuse the existing worker reset key without auditing its inclusion rules.

A completed run qualifies only for the same fingerprint. Paused, aborted, stale, failed-to-complete or imported/unverified evidence cannot silently satisfy a fresh local-run gate. Legacy imported results remain viewable. A diagram-only snapshot carries an explicit non-executable reason rather than fake metrics. An engine completion with observed request failures is still a completed run; do not demand zero failures unless the user defines a separate quality policy.

Apply/merge changes invalidate eligibility when the executable fingerprint changes. A publish candidate formed by combining main and draft changes must itself have a qualifying completed run; running the old draft tip is insufficient. This often means resolve → validate → run merged candidate → review → publish, with candidate editing isolated from source branches.

### Three-way merge and publish

Use a common ancestor and stable entity IDs. Non-overlapping changes can merge; identical changes coalesce. Conflicting fields, delete-versus-edit, incompatible behavior-type changes, and invalid references become explicit conflicts. Treat executable configuration separately from notes/layout; do not silently drop the latter. Compare arrays by stable IDs where available, never by display order.

Validate candidate topology, bounds, references, subsystems, notes, workloads and model compatibility after resolutions. Mixed engine/archive models are rejected rather than coerced. Ours/theirs/edit actions must state which branch is which; bulk resolution still validates and can be undone in the merge session.

Publish transaction checks expected current main head, unique version and eligibility, writes immutable records, advances main, and optionally closes the draft. If main changed in another tab, reject the transaction and recompute merge; don't overwrite. Use local revision tokens and transactional compare-and-set. Cross-tab notifications are an enhancement; correctness cannot depend on receiving one.

“Undo publish” is a compensating operation available only while its expected head remains current, with descendants/branch closure handled explicitly. Older history is never erased. Restore makes a new working state, preserving immutable history. Claude must review these state transitions with table-driven edge cases before implementation.

## Parts and view state

Saved parts instantiate detached copies. Build a complete ID map before insertion, remap internal connections and attachments, validate limits, then commit one editor action. Saving a part must not mutate the canvas. Placement cannot bring old run metrics along as fresh results. A new library version affects future placement only.

Panel/dock preferences live in a separately versioned browser-local preferences record with defaults and validation. They are excluded from graph serialization/fingerprints/undo. Resizing never changes node positions. At small widths adapt panel presentation without permanently overwriting desktop preferences; recover floating bounds on return.

## Inspector transaction

Draft fields allow intermediate text, including an empty numeric field, without corrupting domain state. Apply parses/validates the whole patch, checks the target still exists and base revision has not changed, and commits one editor history entry. Render measured data from the chosen live/saved run separately; do not update displayed measurements to imply a draft configuration has run. Selection changes cannot silently discard a dirty draft.

## Persistence and portable migration gate

Branch/commit/part data requires explicit schema design. Do not stuff it into notes or silently extend format 8 in a way old readers drop history. RV-02 must specify the next portable version, validation rules, import behavior, byte/record budgets and Dexie migration strategy; the number is deliberately unassigned here until actual schema review. Preserve existing 7/8 readers and archive policies. Formats for standalone part transfer, if needed, are separately identified.

Test empty/large legacy projects, revisions/checkpoints/results, interrupted migration, quota failure, malformed references, duplicate IDs, stale writes, multi-tab main movement and round-trip exports. Record original-record retention and recovery behavior. Account for existing import size limits when storing full snapshots; choose deduplication/retention from measured fixture sizes, not arbitrary unlimited arrays.

## Performance and integration

Keep simulation in its worker. Subscribe narrowly to editor/runtime state so panel drags and metric ticks don't rerender every node. Throttle view updates independently of deterministic execution. Lazy-load history/merge/results when practical. The current main build chunk is about 769 kB minified; record size deltas and investigate material growth rather than adding chart/editor packages by default.

`App.tsx` integration is one serialized task per wave. Feature workers deliver typed components/adapters and fixture evidence; the integrator connects real data/actions. Do not leave duplicate old/new navigation or mixed immediate/draft field behavior behind a half-finished screen.
