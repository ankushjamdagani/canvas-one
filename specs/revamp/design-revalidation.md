# Plan revalidation against the rendered screens (2026-09-25)

The plan was checked against every target artboard in [`screens/`](screens/), rendered from `System Studio Directions.dc.html` at 1×. Before this, only six screens had been rendered and looked at during planning. Authority order is unchanged: user decisions > [decisions](decisions.md) > requirements/contracts > screens.

## Verdict

- **Screen coverage is right.** Every screen maps to the right package (RV-03 shell, RV-04 dock/canvas, RV-05 inspector, RV-06 library, RV-07 results, RV-10 entry/transfer, RV-11 history), and the contracts already cover most of what they show.
- **Execution drifted.** c2 was briefed from `design.md` prose and diverges visibly: permanent rail, top bar layout, dock, node cards, entry page.
- **The screens show twelve behaviors the contracts don't define yet** (§3). They are user decisions and block parts of the remaining plan.
- **Decisions override eleven design elements** (§2). Those stay excluded.
- **The earlier visual-only restyles are superseded.** RV-03b/c, RV-04a–c, RV-05a and RV-07a restyled the legacy UI, which D37 deleted. Their CSS is reference only; the real work moves into the feature packages built on the new app (§4).

## 1. Screen → package coverage

| Screens | Package | State after c2 |
|---|---|---|
| 22A nav live, 7A nav | RV-03 shell (top bar) | Diverges: title input + Projects button + undo/redo; no breadcrumb, History, … menu or Run in the bar |
| 13A project menu / rename, 13B branch popover | RV-03 + RV-11 | Missing (rename is inline; branch picked on the entry screen) |
| 14A quick options (+ nested rename) | RV-03 commands | Missing (command registry not built) |
| 18A header menu, 18B export submenu | RV-03 + RV-10 | Missing |
| 23A–G panel placement | RV-03 panels (reducer on `claude/rv-03a-panel-reducer`, not merged into the app) | Missing; c2 added a permanent rail the design doesn't have |
| 16A resting dock, 16B More, 16C-3/4 customise, 16D selection actions | RV-04 dock | Diverges: icon-only, holds run controls, no labels, no zoom % |
| 2A workspace (nodes, edges, note, inspector) | RV-04 canvas + RV-05 inspector | Node cards diverge (wide, raw kind caption, no icon); inspector missing |
| 16E, 12A–C library | RV-06 | Missing |
| 21B, 21D, 7A footer | RV-07 results | Missing (c4 was building it) |
| 2A new system | RV-10 entry | Diverges: single long page |
| 22A history ladder, 22B–F | RV-11 history | Missing |
| 18C Evergreen | RV-01 tokens | Matches (the other palettes are alternatives) |

## 2. Design elements the decisions override (stay out)

| Design element | Screen | Overridden by |
|---|---|---|
| Prompt box "Describe the system…", question chips, "Build system" | 2A new system | D12, R10 |
| Share project, Copy link, Move to team, Platform team chip, "shared by Dana", Owner/Used-in on library detail | 18A, 13A, 2A new system, 12C, 16E | R03, R07 (no team/sharing) |
| Colour scheme submenu | 18A | D24 light only |
| Undo publish | 22D | D26 |
| "Stop run", "Stop and edit" | 21B, 21D | Lead default Run controls, R09 (Pause/Resume/Reset) |
| p99 captions, TIGHTEST LINK, BOTTLENECK, "sorted by pressure", headroom, "cap reached before the window closes" | 2A, 16A, 21D | Lead default Metrics, R09 |
| "vs run 11 · latency regressed", "VS RUN 13" deltas | 7A, 21B | Not contracted (compare needs R09 comparability rules) |
| "minor · fits the diff" version inference | 22C | Lead default Local publish |
| "no run" commit, single-workload "Run now" | 22A, 22B | D20/D27/D28 (every scenario needs a passing run) |
| ⌘K quick options, ⌘R rename, ⌘H history, ⌘B branch, ⌘L library, single-letter B/C/P | 13A, 14A, 16B, 16E | commands.md §1 (F2 + visible button; only Mod+Z, Mod+Shift+Z, Delete, F2) |
| Comment pin, External dependency, Flow probe, Replace part, "Changes on this part", Export selection, Publish to library | 16B, 16D, 18A | Not contracted: absent, not fake buttons (commands.md §1) |

## 3. Contract gaps the screens expose (need user decisions)

Recommendations are the lead's; nothing below is applied until the user decides. **Decided 2026-09-25:** gap 1 → D38 (dock follows 16A), gap 4 → D39 (catalog contract first), gap 5 → D40 (auto-draft on first main edit). Gaps 2 and 3 → D41 (scenario UX approved; screens `scenario_*.png`).

1. **Dock inventory.** 16A dock = undo, redo, Select, Pan, Component, Connect, Note, More, zoom out, zoom %, zoom in, fit. Run, History and results live in the top bar. commands.md's `DockCommandId` also contains `history.open`, `results.open` and `run.*` and has no Connect. *Recommend:* adopt the screen and remove the three from the dock inventory.
2. **Scenario selection for Run.** One "Run Simulation" button, but a document holds several scenarios and commit/publish need all of them passing. No screen shows a scenario picker. *Recommend:* a split button (run the current scenario / pick a scenario / "Run all scenarios"), with the results header naming the scenario.
3. **Scenario and workload editing.** R01/R06 keep them; no screen shows where. *Recommend:* the inspector with nothing selected shows the scenario (inputs/workloads, assertions); needs a design pass.
4. **Adding components.** The library (12A/12C/16E) shows standard entries with defaults ("DEFAULTS · concurrency 4 · http") and "Place on canvas". That is the element constructor c2 had to skip. *Recommend:* a new contract for the standard catalog (per entry: visualKind, behavior kind, ports, default config, what it claims to model — R01), plus connection defaults per kind for the Connect tool.
5. **Editing main.** 22D offers "Edit main directly — creates a draft on first edit". transactions.md only says to branch to keep main working edits. *Recommend:* adopt the screen — the first authored edit on main creates and switches to a draft branch.
6. **Project switching.** R01/R03 keep it, but no screen shows a project list or switcher (13A has rename/duplicate/settings/archive). *Recommend:* "All projects" in the 13A menu and quick options, leading to the entry screen; the entry's left column lists your projects in place of the prompt box.
7. **Panel tabs vs stacks.** 23A docks History and Library as tabs on one side; 23E stacks them. The contract has only `index 0|1` (stack). *Recommend:* stacks only, with the 23A header menu items (Dock right/left, Float, Collapse to rail, Reset width, Close).
8. **Duplicate and Archive project** (13A), **Project settings** (13A, 14A, 18A), **Snap to grid / Minimap** (16B), **Keyboard shortcuts** (18A). None are contracted. *Recommend:* archive = the existing `deleteProject` with confirmation; duplicate = export + import in-app; shortcuts = a registry-driven list; settings, snap and minimap stay absent for now.
9. **Results extras.** An event log (21B) can come from real trace events. "Save result" is moot because terminal runs save automatically. "Compare" needs comparability rules. *Recommend:* event log in; Save result out; Compare as a later contract.
10. **Commit message "suggested from your edits"** (22B). *Recommend:* out (no generated text) unless a deterministic rule is contracted.
11. **Kind stripes for state-machine, data-pipeline, host** (D35 gap from c2). Still open.
12. **Scenario families in the screens.** Every screen shows resource-flow systems (services, queues, capacity); none show frontend state machines, data pipelines or composed (S01–S05-style) models. *Recommend:* node captions and the inspector get per-behavior layouts, designed during RV-05 from the 2A pattern.

## 4. Plan changes (proposed)

- **c4** (runs) can resume: gaps 1 and 2 are decided (D38, D41). Re-brief it with the scenario switcher + Run in the top bar, Run all, derived scenario status, and results per 7A/21B/21D minus §2.
- **Replace c5 with feature packages on the new app**, each briefed with its PNGs and §2 as an explicit exclusion list:
  1. RV-03 shell — 22A top bar, 13A/13B menus, 18A/18B, command registry + quick options (14A), panels 23A–G (merge the RV-03a reducer), rail only for collapsed panels.
  2. RV-04 canvas/dock — 16A–D, 2A node cards and edges; add/connect after gap 4.
  3. RV-06 library — 12A–C, 16E, after the catalog contract (gap 4).
  4. RV-05 inspector — 2A workspace, Apply/Cancel drafts.
  5. RV-07 results — 21B/21D/7A (with c4).
  6. RV-10 entry/transfer — 2A new system, JSON/SVG/PNG/CSV/Mermaid (18B).
  7. RV-11 history — 22A–F.
- **Mark the legacy restyles superseded** (RV-03b/c, 04a–c, 05a, 07a, 12a) in the ledger.
- **Every UI brief** names its screens by file, lists the §2 exclusions, and requires a side-by-side screenshot comparison in review.
