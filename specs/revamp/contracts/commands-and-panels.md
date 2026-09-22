# RV-02f — Commands, inspector drafts and adaptive panels

Status: proposed contract for Claude review, 2026-09-22. Planning only. Foundation uses existing Radix/shadcn compositions; placement and draft reducers are domain-specific pure functions, not new overlay primitives.

## Command registry and availability

Each entry is `{id,label,keywords,group,iconKey,shortcut:null|Shortcut,availability(context),execute(payload)}`. Stable IDs below, no menu-local alternative handler. Availability returns `{enabled:true}` or `{enabled:false,reason,code}`. Context is readonly selection/project/branch/revision/run/draft/storage state, no DOM inspection. Disabled commands display their reason; unsupported future features are absent, not fake enabled buttons.

| IDs | Payload / prerequisites | Shortcut |
|---|---|---|
| `project.create`, `.rename`, `.switch`, `.import`, `.export-json` | typed title/projectId/file; switch flushes save and resolves dirty draft | none |
| `branch.create`, `.switch`, `.reopen` | parent/head or branchId and expected revision | none |
| `history.checkpoint`, `.commit`, `.prepare-publish`, `.publish`, `.restore` | snapshot/candidate IDs and expected heads; commit/publish full eligibility and clean draft | none |
| `run.start`, `.pause`, `.resume`, `.cancel`, `.reset` | scenarioId for start; active runId otherwise; dirty drafts block start; reset cancels first | none |
| `edit.undo`, `.redo` | accepted command history only; blocked while persistence pending | Mod+Z / Mod+Shift+Z |
| `selection.duplicate`, `.delete`, `.group`, `.ungroup`, `.align`, `.distribute` | validated selected IDs; align axis/edge, distribute axis | Delete/Backspace for delete only when canvas focus |
| `canvas.select-tool`, `.pan-tool`, `.add-note`, `.zoom-in`, `.zoom-out`, `.fit`, `.expand`, `.collapse` | viewId, selected IDs where applicable | none |
| `library.open`, `.close`, `history.open`, `.close`, `results.open`, `.close` | focus/open singleton; explicit close separate | none |
| `part.capture`, `.place`, `.export`, `.import` | selection/part revision/anchor; [parts contract](parts-and-export.md) | none |
| `inspector.apply`, `.cancel`, `.open`, `.close` | active draft handle/target | none |
| `panel.place`, `.collapse`, `.expand`, `.resize`, `.reset-width` | panel ID and typed placement/size | none |
| `dock.configure`, `.restore-defaults` | ordered visible command IDs | none |
| `export.svg`, `.png`, `.csv`, `.mermaid` | view or immutable run ID | none |
| `commands.open` | searchable dialog | F2 |

Mod means Meta on macOS, Ctrl elsewhere. F2 is deliberate: avoid browser Cmd/Ctrl+R/H/L and Ctrl+K collisions. No global single-letter shortcuts. Ignore shortcuts during IME composition, editable controls/contenteditable, nested dialogs and modifier mismatches; native text undo must remain native. Only preventDefault after an enabled registry match. Escape first dismisses the top overlay, then cancels active placement gesture, never discards dirty configuration implicitly. Tooltip/key hints derive from registry. Keyboard and menu invoke identical availability and command payload validation. F2 remains accessible via visible command button if OS captures it.

All authored command payloads are closed schemas owned by document/feature types; registry routes to the shared command boundary, never arbitrary JSON patches. Read-only/navigation commands do not create operation receipts. Preferences commands use preferences CAS, not workingRevision. Mutation result `applied.undo` is null for commit/publish/branch-history operations, descriptive reversible metadata only for ordinary authored edits. Publication can never be targeted by edit.undo.

## Draft adapter

`openDraft(target:{projectId,branchId,kind:'element'|'connection'|'scenario'|'workload'|'selection',ids:Id[]},revision,values): DraftHandle`. Handle: `{draftId,target,baseWorkingRevision,baseValues,fields,dirty,issues,status:'clean'|'editing'|'validating'|'saving'|'invalid'|'stale'}`. Raw fields support incomplete strings; never store them in Document. `changeField(fieldId,rawValue)`, `validateDraft()`, `applyDraft()`, `cancelDraft()` are the only editor bridge methods. Field IDs are schema-owned known IDs, not unrestricted object paths. Multi-target drafts expose mixed values explicitly and apply only explicitly changed fields atomically.

Apply parses all edited fields, validates candidate and base revision, persists one compound command, then clears dirty state and creates one undo entry. Pending Apply disables duplicate submission and navigation. Storage/validation/stale error retains fields; no success toast until durable. Stale offers Reload (explicit discard), Keep editing (does not reset base), or Cancel navigation. It never silently rebases onto changed values. Cancel discards transient draft and reloads current accepted values. Deleting a draft target elsewhere marks stale/missing, keeps recoverable text until explicit discard.

Selection/branch/project/inspector-close transition goes through one guard: clean→proceed; dirty→Apply / Discard / Stay. Apply proceeds only after success; Discard calls cancel then proceeds; Stay preserves focus/selection. Run start does **not** auto-open a save-and-run sequence: availability says “Apply or Cancel configuration changes before running.” Editing during a run is allowed on the working document, but active run remains pinned; Apply can make displayed run stale. Commit and candidate publication resolve drafts before preparing evidence. Browser tab close cannot guarantee saving transient drafts; show native unsaved-change handling where supported and never claim draft text durable.

## Panel state and geometry

Persistent preference schema: `{schema:'studio-preferences/1',revision,panels:{library:PanelPreference,history:PanelPreference},sideWidths:{left,right},dock:{orderedCommandIds,hiddenCommandIds},cameras:[{projectId,viewId,x,y,zoom}]}`. Camera collection bounded to 50 recent view refs. Selection/results playback/draft/panel focus recency are transient. PanelPreference: `{open,placement:'left'|'right'|'floating',collapsed,floatRect:{x,y,width,height},stackOrder}`. Exactly one Library and History; inspector is contextual fixed-right desktop occupancy, not a third arbitrary dockable panel. Results is bottom region. Runtime owns `focusedPanel,lastFocusedSequence,activeOverlay`, not authored state.

Reducer events: `OPEN(panel)`, `CLOSE(panel)`, `FOCUS(panel)`, `PLACE(panel,placement,index)`, `COLLAPSE(panel)`, `EXPAND(panel)`, `RESIZE_SIDE(side,width)`, `RESET_SIDE(side)`, `RESIZE_FLOAT(panel,rect)`, `VIEWPORT_CHANGED(width,height)`, `BEGIN_GESTURE`, `PREVIEW_GESTURE`, `COMMIT_GESTURE`, `CANCEL_GESTURE`. Only commit persists gesture changes; Escape/pointercancel restores original preferences. Transient responsive overrides never overwrite desktop preferences. Pure reducer returns state plus effect descriptors (save preferences, announce, focus target), no direct DOM/DB side effects.

Numeric lead decisions in CSS pixels:

- Width <768: single modal overlay at a time, full-width sheet under topbar, maximum height remaining viewport; inspector/Library/History/results replace one another after draft guard. Canvas tools remain reachable after dismissing overlay; no hover-only actions.
- Width 768–1199: auxiliary panels use one overlay at a time; inspector may reserve 320px only when canvas retains >=360px after 44px activity rail and 16px gutters, otherwise becomes overlay. Opening auxiliary overlay can cover inspector without losing its draft/target. Returning to inspector restores focus.
- Width >=1200: desktop docking/floating enabled. Side widths default 320, clamp 280–440; inspector 320; minimum canvas width 480; rail 44; gutters 16 total. If occupancy exceeds width, auto-collapse least recently focused auxiliary panel first; preserve inspector. Continue until feasible; if inspector alone cannot fit, use overlay as above. When width recovers, restore preferred expanded state without stealing focus.
- Collapsed rail occupies 44px. Both Library and History may stack on one side; shared side width, equal initial vertical split with accessible separators. Minimum expanded content height 160 plus 40 header; if viewport cannot fit stacks, show one active expanded panel and collapsed headers for the other. Inspector and results have their own scrollable content, not page scrolling.
- Floating defaults 360×480; minimum 280×240; maximum viewport minus 16px margins, with header/close fully inside usable viewport. When usable viewport is smaller than minima, switch to overlay. Topbar reserved 54px desktop, measured actual height mobile. Resizing/repositioning updates preference only on commit. Numeric positioning menu and keyboard resize (10px, Shift 1px) complement drag.

Panel order breaks equal recency by stable panel ID. Automatic collapse announces which panel moved and why; no disappearing content. Header placement menus expose left/right/floating/collapse/reset/close, and stack position up/down. Canvas camera stays stable on layout change; no automatic fit that loses deliberate zoom. Canvas receives correct measured container geometry after commit.

Dock defaults: select, pan, Library, note, group, undo, redo, zoom-out, zoom-in, fit. Registry IDs only; no duplicate IDs, maximum 16 visible actions; hidden actions remain available in command dialog. Rearrange with move-left/right buttons and keyboard; restore defaults is one preferences write. On narrow width, prioritize select/pan/Library and put others into an accessible overflow menu; ordering is deterministic and customization retained.

Overlay layering roles: canvas 0, dock 10, docked chrome 20, floating panels 30 (focus order inside this layer), modal backdrop/content 50/60, modal-owned popovers 70, tooltip 80. Use shared tokens/portal ownership, never screen-local escalating z-index. Docked panels are labelled complementary regions, not dialogs; modal overlays use shadcn Dialog/Sheet focus trap/title/description and return focus to invoker. Collapsed rail buttons remain labelled. Resize handles expose separator semantics/value/keyboard arrows.

Acceptance: pure reducer transition matrix and preference CAS failures; dirty navigation all entry points; two singleton panels stack/move/reload; viewport 1440/1200/1024/768/390, short height and 200% text zoom; keyboard-only placement/resize, Escape/pointercancel, focus return and screen-reader announcements. Numeric geometry is an initial spec; visual/browser review must verify source fidelity and usable controls before acceptance.
