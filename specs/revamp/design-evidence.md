# Design evidence and source map

## Source snapshot

- Archive: `artifacts/design/Copy of Elegant and modern design refresh.zip` (151 entries).
- SHA-256: `ebcca38cc0921456db6b811c02f5f16a0e98c017a040ec5f621d2c9a79511584`.
- Main canvas: `System Studio Directions.dc.html`.
- Foundation canvas: `System Studio Design System.dc.html`.
- Supporting reference: `readme.md`, `tokens/*.css`, `guidelines/*.card.html`, `components/**/*.jsx`, `ui_kits/system-studio/Studio.jsx`.
- Archive was user-provided and untracked at planning start. Preserve it. Temporary extraction/rendering is not a new source of truth.

Extract to a dedicated reference directory, reject archive paths escaping that directory, and never overwrite application source with the JSX specimens. The specimens demonstrate appearance; they are not audited production primitives. Do not import `support.js` into the app.

## Screen inventory

| Reference (full data-screen-label) | Meaning | Planned track |
|---|---|---|
| `18C Evergreen scheme` | Confirmed palette | Foundation |
| `2A workspace` | Node selection, configuration/measured separation, Apply/Cancel | Canvas + inspector |
| `2A new system` | Project entry, templates/import, proposed AI generation | Entry; generation gated D12 |
| `22A nav live`, `13A Project menu open`, `13A Rename editing` | Separate project rename and branch targets | Shell |
| `13B Branch popover` | Branch switch, unsaved-run warning | Local versioning |
| `14A Quick options open`, `14A Rename inside quick options` | Action search and nested rename | Shell commands |
| `18A Header menu open`, `18B Export submenu` | Project actions and transfer | Shell + export |
| `16A Resting dock`, `16B More popover open` | One canvas dock, overflow | Dock |
| `16C-3 Drag from tray`, `16C-4 Expanded dock`, `16D Selection scoped actions` | Customization and selection actions | Dock + canvas |
| `16E Library picker from dock` | Same library through dock entry | Library |
| `12A Library, list view`, `12B Library, grid view`, `12C Library, hover detail` | Search, lists/cards, part details | Library |
| `23A dock right`, `23B dock left`, `23C floating panel`, `23D dragging to dock` | Placement menu, float/drag states | Panels |
| `23E stacked docks`, `23F collapsed docks`, `23G both collapsed left` | Shared side, collapsed rails/peek | Panels |
| `22A history ladder`, `22B save checkpoint` | Working edits then commits then published versions; run evidence | Local versioning |
| `22C publish review`, `22D published`, `22E draft behind main`, `22F compare and resolve` | Publish, stale base and conflicts | Local versioning |
| Footer section `7A branching history` | Compact completed-run strip; label duplicated in Nav section | Results |
| `21B running simulation expanded`, `21D running expanded component first` | General/component results and observed-state labels | Results |

Excluded palette explorations: Ochre/indigo, fluorescent, cyanotype, tonal sage, nocturne, oxblood, flat triad, cool slate and terracotta. Board annotation typography is not automatically app typography.

## Verified visual facts

Four supplied frames were rendered and visually inspected in Chromium during planning: 23A placement menu, 22A history ladder, 21D component results and 2A workspace. These are reference renders, not app fidelity tests. Initial sandbox Chromium launch failed; an approved retry rendered successfully. All other inventory rows were identified from source, not individually visually certified.

The design uses a white dotted canvas, warm panels, compact hairline controls, green actions, purple branch/async identity and clay risk state. No generic hero cards, frosted surfaces, decorative gradients or entrance animations. The small app mark is the supplied gradient exception.

## Conflicts to resolve explicitly

- Source says all commits require runs, yet a history specimen includes “no run”. D20/D27/D28 resolve this: new commits/publication require completed passing exact-state evidence for every configured scenario; incomplete/failing work uses autosave/checkpoints. D19 drops legacy-history compatibility, and D09 is superseded. D26 removes the Undo publish action visible in 22D; the user decision overrides that design detail.
- `tokens/spacing.css` has panel width 300px; 23A uses 356px. Treat tokens as defaults and screen-specific geometry as contextual variants, not one universal width.
- Directions has earlier and later navigation treatments. Use the separately targeted project/branch interaction in `22A nav live`, with approved features only.
- README says no emoji; one menu specimen contains an emoji link icon. Apply consistent icon decision D13.
- README limits accents while node specimens contain additional kind stripes. Keep an explicit node-kind mapping; do not add arbitrary colors by node name.
- Snapshot counts (48/51 library items, 41 edits), team names, pressure labels, protocol strings and run numbers are illustrative.
- Desktop chrome dimensions and board positions do not specify responsive layout. Negative board coordinates are presentation of the design canvas, not production layout instructions.

## Current code anchors (verified source)

| Responsibility | Existing files |
|---|---|
| Composition, autosave, project lifecycle | `src/App.tsx` |
| Chrome | `src/components/layout/{TopBar,ActivityRail,CanvasFloatingDock,ResultsStrip}.tsx` |
| Canvas and projection | `src/components/ArchitectureCanvas.tsx`, `SubsystemNode.tsx`, `TrafficEdge.tsx`, `CanvasNotes.tsx`, `CanvasContextMenu.tsx`, `DiagramOrganization.tsx` |
| Editing | `src/components/OpenInspector.tsx`, `Inspector.tsx`, `OpenConnectionEditor.tsx`, `OpenWorkloadControls.tsx` |
| History/results | `src/components/RevisionsPanel.tsx`, `ResultsPanel.tsx`, `OpenMetricsPanel.tsx`, `StudioMenu.tsx` |
| State and data | `src/state/editor.ts`, `src/domain/model.ts`, `results.ts`, `revisions.ts`, `src/persistence/projects.ts` |
| Execution | `src/simulation/useSimulation.ts`, `src/simulation/open/kernel.ts`, `adapter.ts` |
| Foundations | `src/components/ui/*`, `src/styles.css`, `src/lib/utils.ts`, `vite.config.ts` |

The 17 September action log identifies older unlayered control rules. Current source has a `@layer base` around button/input/textarea rules, so do not report that historical defect as wholly unfixed. Remaining legacy rules, hard-coded colors and mixed token families still need computed-style validation.
