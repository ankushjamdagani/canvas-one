# Technical design

Status: lead architecture proposal for Claude review. The implementation-ready contract gate must settle current-only schemas, semantic run contracts, limits and storage cutover before Gemini changes persisted data.

Read with [execution-model.md](execution-model.md), [deployment-and-sync.md](deployment-and-sync.md) and [legacy-retirement.md](legacy-retirement.md). D17–D20 supersede the initial diagram exemption, old-data preservation and narrow traffic-only assumptions. Detailed schemas remain an RV-02 gate.

## Current boundaries to preserve

`src/App.tsx` composes project boot/save/switch, editor selection, simulation and UI state. `src/state/editor.ts` owns graph changes/history and currently enforces archive read-only behavior. `src/persistence/projects.ts` stores projects in Dexie database `system-studio`, schema version 1. These are current-state facts, not a requirement to preserve legacy architecture. Keep pure view metadata outside executable behavior; protect retained exact resource accounting while adding separately specified semantic run capabilities.

Current source exports legacy graphs as format 7 and open-system graphs as format 8. D19 allows both old readers/converters to be retired at the redesigned schema cutover. New imports remain structurally validated, never implicitly authenticated or verified by parsing. Choose explicit byte/record limits; the old 2,000,000-character check is not a byte-size contract.

## Target modules and dependency direction

- `components/ui/`: accessible low-level controls only.
- `components/studio/`: shared appearance compositions (field, metric, panel header, status, node chrome).
- `features/workspace/`: command definitions, layout preferences, panel reducer and shell composition.
- `features/library/`: catalog/saved-part presentation and adapters.
- `features/history/`: branch/history/publish/merge presentation.
- `features/results/`: result presentation and measured-value adapters.
- `domain/versioning/` and `domain/parts/`: pure typed operations, validation and deterministic diff/merge; no React/Dexie.
- Domain scenario/behavior/compiler interfaces plus versioned runners: model-based execution across S01–S05; exact files reserved in RV-02.
- `persistence/`: validated local repositories, transactions and current portable format; future sync adapters stay outside domain logic.

These are proposed destinations for new code, not a mandate to move every existing file. Reuse existing editors/canvas with adapters, then retire old surfaces only once their capability map is complete. Domain operations return success/error results; UI never mutates snapshots directly.

## Future AI buddy boundary

Follow [ai-collaboration.md](ai-collaboration.md): domain commands and candidate validation must be callable independently of React, with expected revisions, stable references, atomic operations and structured outcomes. A future AI adapter is another client of those operations, not a privileged path into editor/storage state. Reserve conceptual extension points for versioned decision/proposal/discussion/code-evidence records separate from executable behavior and personal presentation. Implement only presently used contracts; do not add AI providers, agent services or generic plugin frameworks now. Markdown is a possible report/export, not the future product database.

## Contracts to freeze in RV-02

| Contract | Required information / operations |
|---|---|
| Workspace commands | stable ID, accessible label, icon, shortcut, availability reason, execute; availability computed from typed context |
| Panel preferences | panel ID, placement, open/collapsed state, order/stack, per-side widths, floating rect; open/close/place/collapse/resize/reset |
| Inspector draft | target ID, base revision, editable draft, dirty/valid state, apply/cancel/conflict result |
| Branch workspace | stable branch ID, display name, base commit, head commit, working snapshot, revision token; switch/create/archive/reopen |
| Commit | immutable ID, parent(s), full system snapshot, message, timestamp, author provenance, complete non-empty configured-scenario inventory and exact-state passing evidence |
| Published version | immutable ID/version, commit, previous published head, source branch, title/rationale/ticket, evidence; compare/restore |
| Merge result | common ancestor, ours/theirs, typed changes/conflicts/resolutions, validated candidate, expected-head token |
| Saved part | ID/version, name/description/category, copied graph subset/view metadata, provenance; save/place/update-copy |
| Run evidence | immutable completed result, executable fingerprint, scenario/scope/refinement, runner/behavior versions, fixture/assumptions/seed, trace/assertions/metrics and provenance |

Adapters keep existing `Project`, editor and saved results operational while feature UI is built from fixtures. Shared contract files have one owner. Branch or part IDs cannot be inferred from names or array order.

## Local versioning model

Use an immutable commit DAG with branch head pointers and separate autosaved working snapshots. Published main is immutable history; editing it creates a draft branch on first edit. Graph undo/redo remains an editing-session mechanism, not commit history. New autosave/checkpoints preserve incomplete work without pretending it is committed. A fresh project may have a working branch with no qualifying commit yet.

Keep the active working graph exposed to the current editor/simulation through a narrow adapter. Switching branches flushes that branch's save queue, safely handles failure, then loads the other working state and its view metadata. Do not discard an unsaved completed run. Unapplied inspector edits are a separate transient draft: request Apply/discard/cancel before a switch. Save failures must never be represented as successful switching or publication.

No legacy migration or archive support is required. Lead rollout proposal uses a new storage namespace, leaves old records untouched but unsupported and rejects incompatible imports. Do not create fake baseline commits to make an old project appear verified.

### Run eligibility

Define a canonical executable fingerprint using normalized behavior, scenario inputs/initial state/scope, refinement selections, active assumptions, workload/resource model, seed/budgets and runner/model versions. Exclude camera, panel placement, selection and purely visual metadata. Deployment relationships that affect a fault scenario are executable, even though they appear in a structural view. Store full authored snapshot content separately. Do not reuse the existing worker reset key without auditing inclusion rules and canonical ordering.

A completed run qualifies only for the same fingerprint with all checks passing (D27). Every configured scenario must qualify (D28); no subset selector or disabled-scenario bypass. Paused, aborted, stale, truncated or imported/unverified evidence cannot satisfy the gate. No diagram exception. Modeled failure outcomes may satisfy checks expecting them; failed checks require system/check changes and new matching runs.

Apply/merge changes invalidate eligibility when the executable fingerprint changes. A publish candidate formed by combining main and draft changes must itself have a qualifying completed run; running the old draft tip is insufficient. This often means resolve → validate → run merged candidate → review → publish, with candidate editing isolated from source branches.

### Three-way merge and publish

Use a common ancestor and stable entity IDs. Non-overlapping changes can merge; identical changes coalesce. Conflicting fields, delete-versus-edit, incompatible behavior-type changes, and invalid references become explicit conflicts. Treat executable configuration separately from notes/layout; do not silently drop the latter. Compare arrays by stable IDs where available, never by display order.

Validate candidate topology, bounds, typed ports/relationships, scenarios, behavior, subsystems and notes after resolutions. Unsupported schema/behavior versions are rejected rather than coerced. Ours/theirs/edit actions must state which branch is which; bulk resolution still validates and can be undone in the merge session.

Publish transaction checks expected current main head, unique version and eligibility, writes immutable records, advances main, and closes the source branch by default (explicit keep-open opt-out only). If main changed in another tab, reject the transaction and recompute merge; don't overwrite. Use local revision tokens and transactional compare-and-set. Cross-tab notifications are an enhancement; correctness cannot depend on receiving one.

Publication cannot be undone (D26): no compensating-publish or main-rewind command. Restore makes a working draft; corrections use ordinary new passing commits/publications. Source branch closes by default atomically with successful publish and can explicitly reopen without changing main/history (D29). Failed publication never closes it. Claude reviews these transitions and strict all-scenario evidence gates before implementation.

## Parts and view state

Saved parts instantiate detached copies. Build a complete ID map before insertion, remap internal connections and attachments, validate limits, then commit one editor action. Saving a part must not mutate the canvas. Placement cannot bring old run metrics along as fresh results. A new library version affects future placement only.

Panel/dock preferences live in a separately versioned browser-local preferences record with defaults and validation. They are excluded from graph serialization/fingerprints/undo. Resizing never changes node positions. At small widths adapt panel presentation without permanently overwriting desktop preferences; recover floating bounds on return.

## Inspector transaction

Draft fields allow intermediate text, including an empty numeric field, without corrupting domain state. Apply parses/validates the whole patch, checks the target still exists and base revision has not changed, and commits one editor history entry. Render measured data from the chosen live/saved run separately; do not update displayed measurements to imply a draft configuration has run. Selection changes cannot silently discard a dirty draft.

## Persistence and portable cutover gate

System/view/scenario/branch/commit/part data requires explicit schema design. Do not stuff new semantics into notes or silently reuse format 8. RV-02 specifies the new portable version, strict supported-version behavior, byte/record budgets and fresh Dexie namespace; version numbers are unassigned until schema review. No backward-compatible reader/converter is required. Future sync references, artifact manifests and author provenance must fit the model without embedding vendor credentials. Standalone part transfer, if needed, has an explicit format.

Test current empty/large projects, scenarios/checkpoints/results, interrupted writes, quota failure, malformed references, duplicate IDs, stale writes, multi-tab main movement and round-trip exports. Test old-version rejection and that startup leaves the previous database untouched. Choose snapshot/trace retention from measured fixture sizes, not unlimited arrays. Future async sync uses idempotent outbox delivery and expected-head updates, as specified in deployment-and-sync.md.

## Performance and integration

Keep simulation in its worker. Subscribe narrowly to editor/runtime state so panel drags and metric ticks don't rerender every node. Throttle view updates independently of deterministic execution. Lazy-load history/merge/results when practical. The current main build chunk is about 769 kB minified; record size deltas and investigate material growth rather than adding chart/editor packages by default.

`App.tsx` integration is one serialized task per wave. Feature workers deliver typed components/adapters and fixture evidence; the integrator connects real data/actions. Do not leave duplicate old/new navigation or mixed immediate/draft field behavior behind a half-finished screen.
