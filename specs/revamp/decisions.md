# Decisions

Only a user answer or an identified lead decision settles a row. To change one, append the date, ID, answer/rationale and what it supersedes. Never silently widen a task.

| ID | Source | Decision |
|---|---|---|
| D01 | User | The design source is the local claude.design ZIP, not Figma. |
| D02 | User | Evergreen paper palette on every screen; other palettes are not targets. |
| D03 | User (refined by D19) | Keep useful capabilities; obsolete code and old-data compatibility may go. New features are decided one by one. |
| D04 | User | Branch/commit/publish/merge are local-only first. No accounts, server or sync. |
| D05 | User | Include reusable saved parts, dock customization, and movable/stacked/collapsed panels. |
| D06 | User | Codex plans and verifies; Claude reviews; Gemini implements. |
| D07 | Lead | Keep React/Vite, TypeScript, Tailwind v4, Radix-backed primitives, XYFlow, Zustand, Dexie. No framework or primitive-library migration. |
| D08 | Lead | Official shadcn foundations first, custom compositions second. No generic dashboard blocks or unrelated presets. |
| D09 | — | Superseded by D20 (diagram exemption and legacy snapshots dropped). |
| D10 | User | Configuration edits are drafts with Apply/Cancel; a valid Apply is one undo step. |
| D11 | User | Autosave each branch's working state and keep it across switches. Publish explicitly merges into local main. Names are self-reported; nothing uploads. |
| D12 | User | Defer AI generation. Include CSV and Mermaid export. |
| D13 | User | Keep Lucide icons, styled to the design; keep the supplied mark and typography. |
| D14 | User | Full phone editing, with adaptive panels and alternatives to drag and hover. |
| D15 | Lead | Example names, authors, percentages, counts, run IDs and warnings in the design are fixture content, never production values. |
| D16 | Lead | No engine changes just for a visual. Unsupported telemetry needs its own metric definition, or is shown as unavailable. |
| D17 | User | Model-based runs first; real source execution later. All families matter: frontend, backend/fullstack, code/data flow, service flow, infrastructure. |
| D18 | User | Plan for local, hosted and self-hosted bundles and GitHub/server sync. Async review before live coediting. Nothing remote is built now. |
| D19 | User | Old data compatibility can be dropped: no legacy runtime, archive viewer, format-7/8 reader or converter. Existing local data isn't deleted. |
| D20 | User | Commits and publications require runs. Autosave/checkpoints hold incomplete work. No diagram-only exemption. |
| D21 | Lead | One system document with multiple views and explicit scenarios. Structural relations are separate from executable flows; numbers appear only when timing/resource assumptions exist. |
| D22 | User | A future AI assistant collaborates through the canvas using structured project records. No AI now; keep boundaries extensible. |
| D23 | User (2026-09-22) | The inspector is the dedicated contextual region and stays visible while editing; History/Library use the movable panel host. When desktop space runs out, collapse the least recently used auxiliary panel (with a notice). Phones show one overlay at a time. |
| D24 | Lead | Evergreen paper is light-only, whatever the OS preference. No dark theme. |
| D25 | User (2026-09-22) | Run is blocked while a configuration draft is dirty (Apply or Cancel first). Ordered-sequence merge conflicts offer base/ours/theirs or explicit editing, with no guessed interleaving. |
| D26 | User (2026-09-22) | Publications can't be undone. Remove the design's Undo publish; corrections are new verified publications. |
| D27 | User (2026-09-22) | Commits and publications need completed runs with passing checks. A failed check requires changing the system or the check and rerunning. No override or waiver. |
| D28 | User (2026-09-22) | Every configured scenario must pass (at least one scenario). No required-subset selector. |
| D29 | User (2026-09-22) | Close the source branch by default after publishing. It can be reopened; reopening doesn't undo anything. |
| D30 | User (2026-09-22) | Library entry points focus/expand the single existing Library instance. |
| D31 | User (2026-09-23) | Execution manifest v1 is a projection of the scope closure with every presentation (A) field removed; shape in [run-identity.md §3](contracts/run-identity.md#3-execution-manifest-v1). |
| D32 | User (2026-09-23) | Mode coherence (input `atMs`, completion kind, boundary `delayMs`/`afterInputId` vs scenario mode) is a readiness rule, not a storable one; the storable validator checks only per-field types and bounds. Supersedes the storable checks in RV-02b. |
| D33 | User (2026-09-23) | Recursive refinement ownership is a storable structural error (like a `contains` cycle), rejected at save time for the whole document. |
| D34 | User (2026-09-23) | Accepted readings: a compiler 'reference' is each resolved ID reference followed during closure expansion, counted once per referencing field; panel reducer gesture payloads, `activeOverlay` type and announce strings as implemented in RV-03a; toast layer z 80 (shared with tooltip); 'missing pipeline outputs' means an unresolvable output/error port — unconnected outputs are legal. |
| D35 | User (2026-09-23) | Node kind stripes use six dedicated muted hues by catalog layer, distinct from the semantic primary/branch/risk colours: clients #4F6D8F, edge #2B7A83, compute #56773A, messaging #8A6A1F, data #8A4F6E, operations #5F646B (each ≥ 4.5:1 on white and panel). Extends design.md "Node kinds" beyond the board's three examples. |
| D36 | User (2026-09-24) | A studio message delivered through a `broadcast` broker counts as one message root per delivered consumer copy, each linked to the emitting parent; each settles from its own kernel delivery facts. `competing` delivery keeps one message root per emission. |
| D37 | User (2026-09-24) | The whole old UI and its functionality are disposable (unstable, not a baseline). The cutover is a clean rebuild on the studio model: no adapters from the legacy `Graph`/editor/canvas, no coexistence period, no feature parity. Legacy files and their tests (unit and e2e) are deleted once the new app replaces them; a retired test needs no per-test justification. Kept: the new revamp code (studio model, runner, versioning, `persistence/studio`, `components/ui`, studio tokens, restyled layout/node/inspector/results visuals as reference) and the open kernel with its characterization/golden tests (the runner depends on it). Supersedes architecture.md §3 "reused through adapters" and the §6 per-file removal gates for legacy code. |
| D38 | User (2026-09-25) | The canvas dock follows screen 16A: undo, redo, Select, Pan, Component, Connect, Note, More, zoom out, zoom %, zoom in, fit. Run and History live only in the top bar (22A); `history.open`, `results.open` and `run.*` leave `DockCommandId`, and Connect joins it once connection defaults are contracted. Supersedes the commands.md dock inventory. |
| D39 | User (2026-09-25) | Library, add-component and Connect wait for a standard catalog contract (per entry: visualKind, behavior kind, ports, default config, what it claims to model; plus connection defaults per kind), drafted by the lead for user approval. |
| D40 | User (2026-09-25) | Main never holds unpublished edits: the first authored edit on main creates a draft branch from main's working content and switches to it (screen 22D "Edit main directly — creates a draft on first edit"). |
| D41 | User (2026-09-25) | Scenario UX approved as proposed (screens `screens/scenario_*.png`, rules in commands.md "Scenarios"): a project has one system and any number of scenarios; a blank project starts with none and shows a guided empty state (templates bring theirs); the scenario switcher sits beside Run in the top bar with per-scenario status and Run all; scenarios are edited in the inspector dock (Traffic over time = timed, Step by step = logical) with Apply/Cancel; new = empty or copy of an existing scenario, stored only on Apply; delete confirms and is undoable; the commit panel lists every scenario's status with Run actions. Closes design-revalidation gaps 2 and 3. |
| D42 | User (2026-09-25) | Standard catalog contract approved ([contracts/catalog.md](contracts/catalog.md), "Approved resolutions" 1–12): D35 gains three groups — state-machine indigo #5A5B8C, data-pipeline umber #7A5C3E, host charcoal #3A3F3C; thirdparty → Edge; custom has no stripe; per-placement generic schemas; 184 px placement width; message defaults ack 0 ms / ttl 10 s; hand-written truthful library tags; email/monitoring/analytics/secrets and traffic/client/mobile/device/scheduler are placeable but not simulated; connecting into a resource asks for class/operation/deadline before storing the edge; saved-part summary = first three kinds + count; node caption = kind · key setting until a run, then that run's measurements; dragging another connection from a router/broker adds a route port. Unblocks the library, add-component and Connect. |

## Lead defaults

Product details the lead set within confirmed scope. Contracts encode most of them.

- **Local publish.** The user picks the version explicitly; the title is required; rationale, author name and ticket are optional. No semantic-version inference from graph shape.
- **Merge.** Typed three-way, with explicit delete-vs-edit and reference conflicts. No last-write-wins by timestamp.
- **Saved parts.** Independent copies (not live links) of the selected nodes plus their internal edges. Whole subsystems and notes are included only when wholly selected or attached; excluded external links are shown before saving. No team library.
- **Dock.** Stable command IDs, ordered, restorable, keyboard reorder. Commands left out of the dock stay reachable via Quick options.
- **Panels.** Per-browser preferences, outside the portable model.
- **Run controls.** Keep Pause/Resume/Reset. No ambiguous Stop; a true stop/finalize command needs its own contract.
- **Metrics.** Omit pressure rankings, bottleneck claims, p99 and overflow predictions. Show only measured values; instrumentation is separate follow-up work.
- **New project.** Templates, blank canvas or import. No prompt box pretending to generate a system.
- **Contrast.** Corrected tokens are approved from measured evidence ([design.md](design.md#accessibility-corrections)).
