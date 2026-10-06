# Commands, inspector drafts and panels (RV-02f)

The single command registry, every command's exact payload and result, the inspector draft lifecycle and panel geometry. Placement and draft reducers are pure domain functions composed from existing Radix/shadcn primitives, not new overlay primitives.

## 1. Registry

- **Entry.** `{id, label, keywords, group, iconKey, shortcut:Shortcut|null, availability(context), execute(payload)}`. The registry is exhaustive over `CommandId`, with a typed payload per entry; there are no menu-local handlers and no arbitrary execute strings.
- **Availability** returns `{enabled:true}` or `{enabled:false, reason, code}`. Disabled commands show their reason. Unsupported future features are absent, not fake buttons.
- **Context** (read-only, never from the DOM): `CommandContext={projectId|null, branchId|null, workingRevision|null, selectedElementIds, selectedConnectionIds, activeViewId|null, focusedSurface:'canvas'|'inspector'|'library'|'history'|'results'|'text'|'dialog', activeRunId|null, runState:'idle'|'validating'|'running'|'paused'|'terminal', draftState:'clean'|'dirty'|'validating'|'saving'|'invalid'|'stale', storageState:'ready'|'saving'|'failed', branchState:'open'|'closed'|null, eligibility:'unknown'|'checking'|'eligible'|'ineligible'}`.
- **Shortcuts.** `Shortcut={key, modifiers:('Mod'|'Shift'|'Alt')[], scope:'global'|'canvas'}`, unique per scope. Mod = Meta on macOS, Ctrl elsewhere.
  - Only `edit.undo` Mod+Z, `edit.redo` Mod+Shift+Z, `selection.delete` Delete/Backspace (canvas focus only) and `commands.open` F2. F2 avoids browser Cmd/Ctrl+R/H/L and Ctrl+K collisions, and a visible button covers the case where the OS captures F2.
  - No global single-letter shortcuts. Shortcuts are ignored during IME composition, in editable fields and nested dialogs, and on modifier mismatch; native text undo stays native. `preventDefault` fires only after an enabled registry match.
  - Keyboard and menu share the same availability and validation, and tooltips/key hints come from the registry.
- **Escape** first closes the top overlay, then cancels an active placement gesture. It never discards a dirty draft.
- Payloads are closed schemas routed to the shared command boundary, never JSON patches. Navigation and read-only commands create no operation receipt. `edit.undo` can never target commits, publications or branch history.

## 2. Envelopes and results

Field types, where a payload or result doesn't show them inline:

- **UUIDs.** `…Id` fields, bare `id` and `fileToken` are `Id`; `…Ids`, `ids`, `changedIds`, `conflictIds` and `removals` are `Id[]`.
- **Not UUIDs** (these override the rule above):
  - `commandId` is a registry `CommandId`.
  - `panelId` is `PanelId`.
  - `orderedCommandIds`/`hiddenCommandIds` are `DockCommandId[]`.
  - `expectedHeadId` and `mainHeadId` are `ExpectedHead`.
  - `snapshotId` is `Hash`.
- **Revisions.** `…Revision` fields, and `expected`/`actual` in `stale`, are `Revision`. Artifact `revision` in `CommandValue` is `Revision|null`. Part `revision` is a safe integer, and `expectedLatestRevision` is a safe integer or null.
- **Records.** `issues` is `Issue[]`; `repairs` is `RecordChange[]`; `evidence` is `EvidenceRef[]`; `metadata` is `PublicationMetadata`; `initialDocument` is `Document`; `selection` is `Selection`.
- **Scalars.** `title`, `label`, `description`, `message` and `displayName` are strings; `x`, `y`, `width` and `height` are finite numbers; `keepSourceOpen` is boolean.

Types: `Id` = UUID; `Hash` = lowercase SHA-256 hex; `Revision` = non-negative safe integer; `Empty={}`; `Point={x,y}` (finite canvas coordinates); `ViewRef={projectId,branchId,viewId}`; `Selection={elementIds,connectionIds,groupIds,noteIds}` (unique, same view/document); `ExpectedHead=Id|null`.

| Envelope | Shape | Used by |
|---|---|---|
| Branch | `{commandId, operationId, projectId, branchId, expectedWorkingRevision, actor, payload}` | authored model/selection actions; checkpoint, commit, restore, publish; branch create/reopen; part.capture/place; undo/redo |
| Project | the same, with `expectedProjectRevision` in place of branch/revision | project.rename (also carries branch envelope), part.import |
| Bootstrap | explicit new IDs + `operationId` + `actor` | project.create, project.import |
| Preference | `{expectedPreferenceRevision, payload}` | canvas zoom/fit, `panel.*`, `dock.*`; library/history open/close after the navigation guard |
| Controller | explicit context; never persisted as an authored operation | navigation, run controls, exports (including project.export-json, which is read-only but still checks `expectedProjectRevision`), history prepare/resolve, inspector, results, commands, branch.switch |

- `Actor={actorId, kind:'local-human', displayName}`. An empty name renders "Local user"; it is never authenticated.
- A context mismatch is rejected; the command never falls back to the currently active branch.
- A retry with the same operation ID is checked **before** stale checks and returns its original durable result.

**Authored results.**
- `{status:'applied', operationId, projectRevision, branchRevision|null, changedIds, undo:{entryId,label}|null, value}`
- `{status:'invalid', issues}`
- `{status:'stale', scope:'project'|'branch'|'preferences', expected, actual}`
- `{status:'missing', ids}`
- `{status:'failed', code:'quota'|'unavailable'|'referenced-artifact'|'operation-id-reused'|'limit'|'ineligible'|'conflict'|'unsupported-version'|'duplicate-version', issues}`

The applied result is stored with its receipt. `undo.entryId` resolves only in its originating live session; retries and reloads don't recreate undo entries. `undo` is null for commit, publish and branch-history operations.

**Controller results.** `{status:'done', value}`, `{status:'cancelled'}` (user cancel, not a failure), or invalid/stale/missing/failed as above.

**`CommandValue`:**
- `{kind:'none'}`
- `{kind:'project', projectId, branchId}`
- `{kind:'branch', branchId}`
- `{kind:'artifact', artifactType:'checkpoint'|'commit'|'publication'|'part', id, revision|null}`
- `{kind:'run', runId}`
- `{kind:'candidate', candidateId, snapshotId:Hash, conflictIds}`
- `{kind:'draft', draftId}`
- `{kind:'download', downloadId}`

`downloadId` is a local completion receipt, never file access.

**File tokens.** A FileToken is an opaque local UUID bound to user-selected bytes, their hash and size. It expires on reload and can't be imported or supplied remotely. Bytes are hashed and validated outside transactions. Retries reuse the same operation ID and destination ID.

## 3. Project, history and run commands

| Command | Payload | Result / rules |
|---|---|---|
| project.create | `{newProjectId, title, initialDocument}` | project. Validated blank or template document; creates main + draft and a receipt in the new namespace. The same ID with a different request is rejected. |
| project.rename | `{title, expectedProjectRevision}` | none. Updates project title and the active `Document.title` together; other branches and snapshots are untouched. |
| project.switch | `{projectId, branchId\|null}` | project. Null = main. Runs the navigation guard, and flushes save / resolves the dirty draft first. |
| project.import | `{fileToken, newProjectId, operationId}` | project. Full bundle validation; idempotent namespace; imported evidence is never trusted. |
| project.export-json | `{projectId, expectedProjectRevision}` | download. Consistent read; stale is rejected. |
| branch.create | `{newBranchId, label, source:'working'\|'head', expectedHeadId}` | branch. `working` copies current content and head ancestry; `head` copies the head snapshot (or the creation snapshot if unborn). The source is never altered. A head mismatch returns `failed/conflict` (issue `HEAD_MOVED`); a revision mismatch returns `stale`. |
| branch.switch | `{projectId, branchId}` | branch. Runs the navigation guard. |
| branch.reopen | `{expectedHeadId}` | branch. Closed, non-main branches only; branch revision++; no history or main change. |
| history.checkpoint | `{checkpointId, label}` | artifact. Incomplete snapshots are allowed. |
| history.commit | `{commitId, expectedHeadId, message, evidence:EvidenceRef[]}` | artifact. All-scenario eligibility; not on main. |
| history.prepare-publish | `{projectId, sourceBranchId, sourceRevision, sourceHeadId, mainRevision, mainHeadId}` | candidate. Isolated; source and main clean; common ancestry required. |
| history.resolve-conflict | `{candidateId, conflictId, resolution:{kind:'ours'\|'theirs'}\|{kind:'edited', record:EditableRecord\|null}}` | candidate. Edits the whole owning typed record; null = explicit deletion. Ordered fields are edited through the record's normal editor. |
| history.publish | `{candidateId, publicationId, mergeCommitId, metadata, evidence, keepSourceOpen, expectedProjectRevision}` | artifact. `keepSourceOpen` defaults false; atomic source/main/project compare-and-set; no undo. |
| history.restore | `{snapshotId, checkpointId, label}` | artifact. Checkpoints current work first, then replaces it in the same transaction. Not on main. |
| run.start | `{projectId, target:{kind:'branch', branchId, expectedWorkingRevision}\|{kind:'candidate', candidateId}, scenarioId, runId}` | run. Pinned immutable target, clean draft, readiness, fresh start token. |
| run.pause / resume / cancel / reset | `{runId}` | none. Stale IDs are rejected. Reset waits for cancel, then clears the display; saved evidence stays. |
| run.start-all | `{projectId, target:{kind:'branch', branchId, expectedWorkingRevision}, scenarioIds, runIds}` | run. D41. Runs every listed scenario one after another in document order against the same pinned target, each with its own start token and saved result. A failing scenario doesn't stop the rest; pause/reset act on the whole sequence. `scenarioIds` must equal the document's scenario set at start. |
| edit.undo / redo | `{entryId}` | none. Live-session ownership; ordinary reversible authored edits only; blocked while a save is pending. |

**Candidates** are immutable, controller-owned revisions.
- Each resolution creates a new candidate and snapshot and invalidates the old candidate's eligibility.
- A candidate keeps the expected project/source/main revisions, both heads, the merge base and its conflicts. It can't come from portable input, and it runs only once it passes readiness.
- Reload discards unpublished candidates, leaving branch working copies unaffected. A superseded ID returns `failed/ineligible`; an unknown or expired one returns `missing`.

**Revision policy.**
- The project revision increments on every durable project mutation (branch writes, metadata, runs, parts, pruning). Branch commands compare only the branch revision, then bump the project revision, which avoids cross-branch conflicts. Rename also compares the project revision.
- Publish compares project, source and main tokens, so unrelated writes may force a re-prepare. Saving candidate runs doesn't invalidate the candidate (its token tracks source/main revisions and heads); publish takes a fresh expected project revision after evidence is saved.
- Main can't be committed to or restored directly; see [transactions.md §4](transactions.md#4-history-transitions).

## 4. Model authoring and selection

`EditableRecord` is `{recordKind, record}` for `element | connection | relation | schema | fixture | refinement | scenario | view`: a finite typed union, not paths.

**`model.apply-records {changes:RecordChange[]}`**, where `RecordChange` is `{kind:'insert'|'replace', value:EditableRecord}` or `{kind:'remove', recordKind, id}`.
- Replacements keep definition IDs and existing nested IDs; new members get fresh UUIDs.
- The whole command is rejected on any of: a missing target, duplicate targets, unknown IDs or fields, invalid cross-references.
- At most 1,000 changes; the final document must also fit document limits.
- One gesture or Apply = one compound command = one undo entry.
- Internal plumbing, not necessarily in command search.

Domain intents (add component, connect, edit settings, scenarios, notes, views, drags) compile to this boundary. A future AI proposes the same typed changes for preview, with no bypass. Whole-document replacement is allowed only for create, import and restore.

**Dependency preview.** `previewDependencies({projectId, branchId, expectedWorkingRevision, intent:'delete'|'capture', viewId, selection})` returns `{dependencyPreviewId, boundRevision, removals, repairs:RecordChange[], includedElementIds, excludedConnectionIds, issues}`.
- The controller keeps the immutable record; callers pass only its ID. The UI shows all removals, repairs and inclusions before confirming.
- A revision mismatch returns `stale(branch)`; an unknown or expired ID returns `missing`; an intent or selection mismatch returns `invalid`.
- No receipt, no mutation.

| Action | Payload | Rules |
|---|---|---|
| selection.duplicate | `{viewId, selection, offset:Point}` | Full fresh ID/reference mapping; one undo; refuses external required dependencies unless an explicit closure is approved |
| selection.delete | `{viewId, selection, dependencyPreviewId}` | The preview binds the exact revision and the removals/repairs |
| selection.group | `{viewId, elementIds, groupId, label}` | Nonempty, wholly ungrouped selection |
| selection.ungroup | `{viewId, groupIds}` | Presentation groups only |
| selection.align | `{viewId, elementIds, edge:'left'\|'center-x'\|'right'\|'top'\|'center-y'\|'bottom'}` | ≥2 placed elements; bounding-box alignment |
| selection.distribute | `{viewId, elementIds, axis:'x'\|'y'}` | ≥3; endpoints fixed, equal gaps, stable-ID tie-break |
| canvas.add-note | `{viewId, note:Note}` | One undo |
| canvas.expand / collapse | `{viewId, target:{kind:'placement'\|'group', id}}` | Presentation only; no runner or refinement change |
| canvas.select-tool / pan-tool | `Empty` | Transient mode |
| canvas.zoom-in / zoom-out / fit | `{view:ViewRef}` | Preferences only. Factor 1.2 / its reciprocal, clamped 0.1–2, center-anchored. Fit covers all placements and notes with 32 px padding. |

### Scenarios (D41)

Screens: `screens/scenario_*.png` (approved proposal). A scenario is a named test setup for the one system document ([model-and-runner.md §6](model-and-runner.md#6-scenarios)); the UI calls `mode:'timed'` **Traffic over time** and `mode:'logical'` **Step by step**.

| Action | Payload | Rules |
|---|---|---|
| scenario.select | `{projectId, branchId, scenarioId}` | Controller; per-browser preference keyed by project + branch. Missing or deleted selection falls back to the first scenario in document order; none → no selection. Never an authored change. |
| scenario.new | `{projectId, branchId, expectedWorkingRevision, mode:'timed'\|'logical', from:{kind:'empty'}\|{kind:'copy', scenarioId}, label}` | draft. Opens the scenario editor on an unsaved draft; nothing is stored until Apply, which inserts the scenario as one `model.apply-records` command and one undo. Cancel stores nothing. A copy remaps every nested ID (workloads, classes, inputs, faults, boundaries, assertions, assumptions) with fresh UUIDs; `mode` must equal the copied scenario's mode. |
| scenario.duplicate | `{projectId, branchId, expectedWorkingRevision, scenarioId}` | = `scenario.new` with `from:{kind:'copy'}`, label "Copy of <label>". |
| scenario.delete | `{projectId, branchId, expectedWorkingRevision, scenarioId}` | Confirmation first (screen `scenario_delete_scenario`): its saved runs stay; the commit gate then covers the remaining scenarios. One `model.apply-records` remove; one undo. |
| scenario.edit | `{projectId, branchId, scenarioId, expectedWorkingRevision}` | = `inspector.open` with `DraftTarget{kind:'scenario', ids:[scenarioId]}`. Rename happens in the editor header. |

**Empty drafts invent nothing.** An empty draft starts with no workloads, inputs, faults, boundaries or assertions and scope = every element in the document at draft time. Fields the record requires but the user hasn't given yet (timed `completion`, anything readiness needs) block Apply with linked field errors. The only prefilled values are the contracted budget defaults (storage.md §6), `completion:{kind:'quiescent'}` for step-by-step (the only legal value), and a seed drawn at random when the draft opens, shown and editable.

**Editor sections** (inspector dock, Apply/Cancel per §6): header (name, mode shown, not editable after creation); *What goes in* (timed: workloads with entry, rate and request mix; logical: ordered steps = inputs, with initial states); *What happens during the run* (timed only: faults; logical: replies from outside = boundaries); *What should be true* (assertions; last-run pass/fail marks per check); *Run settings* (timed: horizon or drain, seed; logical: fixed note, no timing). A scenario with no checks shows "Completed · no checks" after a run and never passes (§6 of model-and-runner).

**Switcher** (screen `scenario_switcher`): a segmented control beside Run in the 22A top bar (D38) — scenario name with status dot and mode icon, then the green Run. Its list shows every scenario with status (Passed on this version · Needs a rerun (ran on an earlier version) · Failed n of m checks · Not run yet), "Run all n", the commit line ("Commit needs all n passing · k passing now"), and New / Duplicate / Edit. Per-row menu: Rename, Duplicate, Delete…. No scenario → the control reads "No scenario" and Run is disabled with the reason "Add a scenario to run" (screen `scenario_blank_project`).

**Status** is derived, never stored: *Passed* = a saved qualifying run exists for the scenario's current fingerprint ([run-identity.md §5](run-identity.md#5-eligibility)); *Needs a rerun* = the latest saved run's fingerprint differs from the current one; *Failed* = the latest saved run for the current fingerprint didn't qualify; *Not run yet* = no saved run; *Can't run · n issues* (`not-ready`) = the scenario's current manifest can't be built (validation or readiness issues) — Run is disabled for it with the first issue as the reason, and Run all is disabled while any scenario is not-ready (lead reading, 2026-09-25).

**Unified simulation panel (2026-10-05).** The current workspace places the existing switcher/menu in the compact bottom simulation bar instead of the top header. Joined Run becomes Stop during execution, using the active run's mode even if the selected scenario changes. Reset is separate; it cancels an active run and clears its in-memory recording while preserving saved runs. Timed playback transport is ordered previous cycle, slower, Play/Pause, playback Stop, faster, next cycle, Loop; streaming recordings also expose Go live. Playback Stop pauses/seeks to range/history start and does not drain execution. Icon tools retain keyboard labels, tooltips and unavailable-state explanations.

The single main timeline supports seek, draggable playhead, direct replacement range selection (including inside an existing highlight), endpoint handles, anchored pinch/trackpad zoom, pan and fit. Zoom changes presentation only. The full-width “Inspect Request Cycles” disclosure remains above its content. Selecting an interval opens cycles on the left and interval activity on the right; selecting a cycle puts Overview, Components and Event log inspection in the right pane. Recorded event details seek/highlight actual endpoints without changing authoring selection or opening configuration editing. A separate Run results view preserves existing metrics/checks/event log and provenance. Phone inspection uses a bounded sheet with list/detail navigation; configuration drafts remain intact and only one sheet is visible. Narrow hosts use their measured width for inspection layout.

**Commit panel** (screen `scenario_commit_gate`) lists every scenario's status on the exact working version with a Run action per non-passing scenario and "Run the n remaining"; Commit stays disabled until all pass (D27/D28).

### Selection-scoped actions (board 16D, D44/D46)

The 16D toolbar shows Group, Wrap in boundary, Align, Duplicate and Delete, and an overflow menu ("Selection") with Save as component, Replace part…, Add flow probe, Changes on this part and Export selection. Each is a registry command with an availability reason; none exists only as a button.

| Action | Payload | Rules |
|---|---|---|
| selection.wrap-in-boundary | `{viewId, elementIds, ownerElementId, refinementId, label}` | ≥1 placed element in the active view; none is already a refinement member (D33, one owner). One compound model change, one undo, **behaviour-preserving**: (1) a new owner element (`visualKind:'custom'`, `unmodeled` with reason "Aggregate behaviour not configured"); (2) one owner port per distinct member port that has a connection crossing the selection boundary, copying direction, channel and schemas, labelled "<member> · <port>"; (3) a `Refinement` with the selection as members and one mapping per owner port; (4) every crossing connection re-pointed from the member port to its owner port (IDs kept); (5) every scenario that could reach a member gets `{refinementId, mode:'refined'}`, and the owner joins its `scopeElementIds` where a member is in scope, so every scenario executes the same element set and trace as before; (6) an owner placement whose frame covers the members' bounds plus 24 px. |
| selection.replace-part | `{viewId, elementId, entryId, replacementElementId, dependencyPreviewId}` | Exactly one placed element; refused if it owns or belongs to a refinement. The replacement is built from the catalog entry's defaults at the same placement position and keeps the old label. Each connection and scenario reference (workload/input entry, assertion subject, boundary, fault placement) moves to the first compatible port of the replacement (same direction and channel, compatible shapes, stable port order); anything that can't move is listed in the dependency preview (`intent:'replace'`) and removed on confirm. One undo. |
| selection.add-probe | `{scenarioId, elementId}` | Opens the scenario editor for the selected scenario with one new check on this element, expanded and unsaved until Apply: logical scenarios get `{kind:'output', port:<first non-event out port>, path:[]}`, `equals`, expected empty; timed scenarios get `{kind:'metric', elementId, key:'throughput'}`, `at-least`, expected empty. Disabled with a reason when there is no scenario, the element isn't in the scenario's scope, or (logical) it has no out port. |
| history.show-changes | `{elementIds}` | Read-only, no receipt. Opens History filtered to steps whose change from their parent (`diffDocuments`) touches any of the elements: the element record, its connections, relations or refinements, or scenario references to it. A filter chip names the parts and clears the filter. |
| selection.export | `{viewId, elementIds, noteIds, dependencyPreviewId}` | download. The same content and preview as `part.capture` (dependency preview `intent:'capture'`), written as a part file without storing a Library part or changing any revision. |

**Canvas: boundary frames.** A placed element that owns a refinement whose members are placed in the same view renders as a labelled frame around those members, with its ports on the frame edge; connections to its ports attach to the frame. The frame's size follows the members (24 px padding), so it isn't independently resizable, and moving the frame moves its members. Collapsing it (`canvas.collapse`) shows it as an ordinary node and hides the members, which is presentation only.

## 5. Inspector, panels, parts and exports

`PanelId = 'library' | 'history'`. The inspector and results are separate contextual regions, never floating panels. `DraftTarget={kind:'element'|'connection'|'scenario'|'workload'|'selection', ids}`.

| Action | Payload | Rules |
|---|---|---|
| inspector.open | `{projectId, branchId, target:DraftTarget, expectedWorkingRevision}` | draft. An empty target is rejected; dirty navigation is resolved first. |
| inspector.apply / cancel | `{draftId}` | A failed Apply keeps the draft |
| inspector.close | `{draftId\|null}` | Dirty guard, then close; null = already closed |
| library.open / close, history.open / close | `Empty` | Singleton; dirty guard before replacing an overlay. Open on an already-expanded, focused panel is a no-op; otherwise it expands and focuses the panel and never toggles it closed. |
| results.open | `{projectId, runId\|null}` | Null = current live run. A missing run shows an empty state, never fake data. |
| results.close, commands.open | `Empty` | Transient |
| panel.place | `{panelId, placement:'left'\|'right'\|'floating', index:0\|1}` | Floating reuses a valid `floatRect`, otherwise 360×480 centered, then clamped; `index` is ignored when floating |
| panel.collapse / expand / reset-width | `{panelId}` | Reset affects the shared side width when docked, or restores the clamped default size when floating |
| panel.resize | `{panelId, width, height\|null}` | Height is null when docked and required when floating. Out-of-bounds or non-finite values are rejected; gestures clamp before submitting. |
| panel.move-floating | `{panelId, x, y}` | Drag, keyboard and menu share this action |
| dock.configure | `{orderedCommandIds, hiddenCommandIds}` | Unique, disjoint, exact inventory; ≤16 visible |
| dock.restore-defaults | `Empty` | One preference write |
| part.capture | `{partId, revision, expectedLatestRevision\|null, viewId, elementIds, noteIds, label, description, dependencyPreviewId}` | artifact. Branch envelope binds the source; the project transaction stores the part. Increments the project revision, not `workingRevision`; no undo. |
| part.place | `{partId, revision, viewId, anchor:Point}` | Atomic remap and insert; one undo |
| part.export | `{projectId, partId, revision}` | download |
| part.import | `{projectId, fileToken, partId, operationId, expectedProjectRevision}` | artifact, revision 1; fresh identity |
| export.svg / png / mermaid | `{view:ViewRef, snapshotId}` | download. Pinned authored view; the branch/snapshot relationship is validated. |
| export.csv | `{projectId, runId}` | download. Saved terminal run only. |

- **Part revisions** must equal `expectedLatestRevision + 1` (or 1 when null). A mismatch is `invalid` at `payload.revision`, and concurrent edits return `stale`.
- **Dock inventory** (`DockCommandId`, D38 / screen 16A), in order: edit.undo, edit.redo, canvas.select-tool, canvas.pan-tool, library.open ("Component"), canvas.connect-tool ("Connect"; enabled once connection defaults are contracted, D39), canvas.add-note, selection.group, canvas.zoom-out, canvas.zoom-in, canvas.fit. The zoom level shows between zoom out and in. Run, scenario choice and History are top-bar commands (22A, D41), never dock items.
  - The first ten are visible by default, and visible + hidden partition the list.
  - Parameterized actions take the current context or open their form; payloads are never stored in preferences.
  - Rearranging uses move-left/right buttons or the keyboard. On narrow widths, select/pan/Library stay and the rest go into an accessible overflow menu. Hidden actions remain in the command dialog.
- **Preference conflicts.** A stale preference write is retried only after showing the current state; it never overwrites another tab's customization.
- Adding a command requires a reviewed closed schema and exhaustive registry/validator coverage.

## 6. Draft lifecycle

- `openDraft(target, revision, values): DraftHandle`, where `DraftHandle={draftId, target, baseWorkingRevision, baseValues, fields, dirty, issues, status:'clean'|'editing'|'validating'|'saving'|'invalid'|'stale'}`.
- The only bridge methods are `changeField(fieldId, rawValue)`, `validateDraft()`, `applyDraft()` and `cancelDraft()`. Field IDs are schema-owned. Raw strings (including incomplete ones) never enter the Document.
- A multi-target draft shows mixed values and applies only changed fields.
- **Apply** parses, validates the candidate and revision, persists one compound command, clears dirty state and adds one undo entry.
  - While pending, duplicate submits and navigation are blocked. On a storage, validation or stale error the fields stay. No success toast before durability.
  - Stale offers Reload (explicit discard), Keep editing (base unchanged) or Cancel navigation; it never silently rebases.
  - If the target is deleted elsewhere, the draft is marked stale/missing and its text is kept until discarded.
- **Cancel** discards the draft and reloads accepted values.
- **Navigation guard.** Selection, branch, project and inspector-close all pass through one guard. Clean → proceed. Dirty → Apply / Discard / Stay: Apply proceeds only on success, Discard cancels then proceeds, and Stay keeps focus and selection. Navigation stays *enabled* while dirty; the guard runs before any change. On narrow screens, swapping the inspector for Library, History or results goes through the same guard, and a failed Apply leaves the overlay and focus unchanged.
- **Run is disabled** while dirty, with the reason "Apply or Cancel configuration changes before running." There is no save-and-run shortcut.
- Editing during a run is allowed. The run stays pinned, and Apply may make the displayed run stale.
- Commit and publish resolve drafts first.
- Closing a browser tab can't guarantee saving draft text. Use native unsaved-change prompts where supported, and never claim drafts are durable.

## 7. Panels and geometry

**Preferences** `studio-preferences/1`:
- `{schema, revision, panels:{library, history, inspector}, sideWidths:{left, right}, dock:{orderedCommandIds, hiddenCommandIds}, cameras:[{projectId, viewId, x, y, zoom}]}`, with at most 50 cameras.
- `PanelPreference={open, placement:'left'|'right'|'floating', collapsed, floatRect:{x, y, width, height}, stackOrder}`.
- There is exactly one Library, one History and one inspector. From 1200 px the inspector is a hosted panel like the other two (dock left/right, float, collapse, resize, stack; default docked right); its `open` follows the selection's draft and is never persisted. Below 1200 px it keeps its own dock or sheet. Older stored values without `inspector` load with its default. Results sit in the bottom region.
- Runtime-only state: `focusedPanel`, `lastFocusedSequence`, `activeOverlay`, selection, playback, drafts.

**Reducer events:** `OPEN(panel)`, `CLOSE(panel)`, `FOCUS(panel)`, `PLACE(panel,placement,index)`, `COLLAPSE(panel)`, `EXPAND(panel)`, `RESIZE_SIDE(side,width)`, `RESET_SIDE(side)`, `RESIZE_FLOAT(panel,rect)`, `SYNC_OPEN(panel,open)` (draft-driven visibility: no focus, no save), `VIEWPORT_CHANGED(width,height)`, `BEGIN_GESTURE`, `PREVIEW_GESTURE`, `COMMIT_GESTURE`, `CANCEL_GESTURE`.
- Only COMMIT persists. Escape and pointercancel restore the original state.
- Responsive overrides never overwrite desktop preferences.
- The reducer is pure: it returns state plus effect descriptors (save, announce, focus), with no DOM or DB access.

**Breakpoints** (CSS px):

| Width | Behavior |
|---|---|
| < 768 | One modal overlay at a time: a full-width sheet under the topbar, max remaining height. Inspector, Library, History and results replace one another (after the draft guard). Canvas tools stay reachable; nothing is hover-only. |
| 768–1199 | Auxiliary panels are single overlays. The inspector may take 320 px only if the canvas keeps ≥360 px (after the 44 px rail and 16 px gutters); otherwise it becomes an overlay too. An auxiliary overlay can cover the inspector without losing its draft; focus returns afterwards. |
| ≥ 1200 | Docking and floating. Side widths default 320, clamped 280–440 (the inspector shares its side's width); canvas min 480; rail 44; gutters 16. If occupancy exceeds width, collapse the least-recently-focused auxiliary panel (ties by panel ID) and repeat. The inspector is never auto-collapsed. When width returns, restore the preferred state without stealing focus. |

- **Collapsed rail:** 44 px.
- **Scrolling.** The inspector and results scroll their own content, never the page.
- **Stacks.** Up to three panels (Library, History, inspector) can stack on one side, sharing its width with an equal initial split and accessible separators. The minimum expanded content is 160 px plus a 40 px header each; if they don't all fit, collapse the least-recently-focused panel (never the inspector) to a header and repeat.
- **Floating.** Default 360×480, minimum 280×240, maximum = viewport minus 16 px margins, with the header and close button always inside. Below the minimum, switch to an overlay. The topbar reserves 54 px on desktop (measured height on mobile).
- Keyboard resize steps are 10 px (Shift: 1 px), alongside a numeric positioning menu.
- **Auto-collapse** announces which panel moved and why.
- **Header menus** offer left/right/floating/collapse/reset/close and stack up/down.
- The canvas camera stays put on layout change (no automatic fit), and the canvas gets correct geometry after each commit.

**Layering:**

| Layer | z |
|---|---|
| canvas | 0 |
| dock | 10 |
| docked chrome | 20 |
| floating panels (focus order within) | 30 |
| modal backdrop / modal | 50 / 60 |
| modal-owned popovers | 70 |
| tooltip / toast | 80 |

- Shared tokens and portal ownership only; no screen-local z-index escalation.
- Docked panels are labelled complementary regions, not dialogs. Modals use shadcn Dialog/Sheet (focus trap, title, description, focus return).
- Rail buttons are labelled. Resize handles expose separator semantics, their value and arrow keys.

## 8. Acceptance

- Reducer transition matrix; preference compare-and-set failures.
- Dirty navigation from every entry point.
- Singleton panels: stack, move, reload.
- Viewports 1440 / 1200 / 1024 / 768 / 390, plus short heights and 200% text zoom.
- Keyboard-only placement and resize; Escape/pointercancel; focus return; screen-reader announcements.

The geometry numbers are an initial spec; a browser review confirms source fidelity before acceptance.
