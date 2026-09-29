# Visual design and components

What the supplied design is, how it maps to screens and code, and the component and token rules.

## Source

- **Archive:** `artifacts/design/Copy of Elegant and modern design refresh.zip` (151 entries, SHA-256 `ebcca38cc0921456db6b811c02f5f16a0e98c017a040ec5f621d2c9a79511584`), exported from claude.design (D01). Preserve it.
- **Main canvas:** `System Studio Directions.dc.html`. **Foundation canvas:** `System Studio Design System.dc.html`.
- **Supporting:** `readme.md`, `tokens/*.css`, `guidelines/*.card.html`, `components/**/*.jsx`, `ui_kits/system-studio/Studio.jsx`.
- Extract to a dedicated reference directory and reject paths that escape it. The JSX shows appearance only; it isn't audited production code. Never copy it over app source, and never import `support.js` into the app.
- Screen numbers repeat across sections (`22A`, `2A`), so always cite the full `data-screen-label` plus its section.

**Authority:** latest user answer > [decisions](decisions.md) > requirements/contracts > selected Directions screens (layout/interaction) and the Design System board (tokens/states) > package README/examples.

## Screen inventory

| Screen (full label) | Shows | Track |
|---|---|---|
| `18C Evergreen scheme` | Confirmed palette | Foundation |
| `2A workspace` | Node selection, config vs measured, Apply/Cancel | Canvas + inspector |
| `2A new system` | Entry: templates/import (AI generation deferred, D12) | Entry |
| `22A nav live`, `13A Project menu open`, `13A Rename editing` | Separate project-rename and branch targets | Shell |
| `13B Branch popover` | Branch switch, unsaved-run warning | Versioning |
| `14A Quick options open`, `14A Rename inside quick options` | Action search, nested rename | Commands |
| `18A Header menu open`, `18B Export submenu` | Project actions, transfer | Shell + export |
| `16A Resting dock`, `16B More popover open` | One canvas dock, overflow | Dock |
| `16C-3 Drag from tray`, `16C-4 Expanded dock`, `16D Selection scoped actions` | Customization, selection actions | Dock + canvas |
| `16E Library picker from dock` | Library via dock | Library |
| `12A` list, `12B` grid, `12C` hover detail | Search, lists/cards, details | Library |
| `23A` dock right, `23B` left, `23C` floating, `23D` dragging | Placement menu, float/drag | Panels |
| `23E` stacked, `23F` collapsed, `23G` both collapsed left | Shared side, rails/peek | Panels |
| `22A history ladder`, `22B save checkpoint` | Working edits → commits → publications; run evidence | Versioning |
| `22C publish review`, `22D published`, `22E draft behind main`, `22F compare and resolve` | Publish, stale base, conflicts | Versioning |
| Footer `7A branching history` | Compact completed-run strip (label duplicated in Nav) | Results |
| `21B running simulation expanded`, `21D running expanded component first` | General/component results | Results |

**Rendered and inspected in planning:** 23A, 22A history ladder, 21D, 2A workspace, 22D and 22F. The other rows were identified from source only.

**Rendered screens (2026-09-25):** every target artboard is rendered at 1× in [`screens/`](screens/) (file = `data-screen-label`, e.g. `2A_workspace.png`, `22A_nav_live.png`; alternative palettes excluded, `18C_Evergreen_scheme.png` kept). `scenario_*.png` are the approved scenario UX (D41, lead-drafted in the same visual language; source canvas https://claude.ai/artifact/2c6vMhn9u47Yq4KbsozVvu). Rendered from the archive's Directions canvas in headless Chromium by shifting `.sc-host` so the off-screen artboards are in view. Executors building UI must open the matching PNGs; they are the layout and interaction reference under the authority order above (decisions still override, e.g. no prompt box on 2A new system, no Stop run, no p99, no "vs run" comparisons until contracted).

**Observed shell structure** (from the PNGs): no permanent activity rail — the left rail exists only for collapsed panels (23F/23G); the top bar (22A nav live) is app mark · `Project / branch [DRAFT] ▾` breadcrumb chip · Quick options ⌘K · History · (Library) · … menu · primary Run Simulation; the canvas dock (16A) is undo/redo · Select · pan · Component · Connect · Note · More · zoom % · fit, labelled, and holds no run controls; node cards (2A workspace) are compact with a kind icon, title, mono `kind · key config` caption and, after a run, a utilization bar and measured values; results (21B/21D) are a bottom region with a progress rule, a summary row and an expandable General/Components + event log area; the inspector (2A workspace) is a right dock with Configuration, Measured · last run and Apply/Cancel.

**Not targets:** the other palette explorations (ochre/indigo, fluorescent, cyanotype, tonal sage, nocturne, oxblood, flat triad, cool slate, terracotta) and the board annotation typography.

**Look and feel:** white dotted canvas, warm panels, compact hairline controls, green actions, purple branch/async, clay risk. No hero cards, frosted surfaces, gradients (except the supplied small app mark) or entrance animations.

## Design vs decisions

- **"No run" commits and Undo publish.** The history specimen shows a "no run" commit, and 22D shows Undo publish. The decisions override both: commits need passing runs (D20/D27/D28) and there is no publication undo (D26).
- **Panel width.** `tokens/spacing.css` says 300 px, 23A uses 356 px. Tokens are defaults; screen widths are contextual variants.
- **Navigation.** Use `22A nav live` over earlier navigation treatments.
- **Icons.** The one emoji link icon is replaced by Lucide (D13).
- **Node kinds.** Kind stripes use an explicit node-kind color map, never colors chosen by node name.
- **Illustrative values.** Library counts, 41 edits, team names, pressure labels, protocol strings and run numbers are illustrative (D15).
- **Layout.** Desktop chrome sizes and board coordinates don't define responsive layout.

## Tokens (Evergreen paper, light only — D02/D24)

Source values; implementation maps them to role variables in `src/styles.css`.

| Role | Value |
|---|---|
| Canvas / shell / panel / sunken | `#FFFFFF` / `#FBFAF7` / `#F7F5F1` / `#F2EFE9` |
| Ink / body / secondary | `#16201D` / `#4A544F` / `#6B7671` (→ `#626D68`, see below) |
| Primary / hover / pressed | `#0B5C54` / `#0A4E47` / `#083F3A` |
| Selected tint / edge | `#EAEFEC` / `#A8CBC5` |
| Branch/async / tint | `#7C5FC0` / `#F7F4FC` |
| Risk / tint | `#B4674A` (→ `#A15B40` for text) / `#FBF1EA` |
| Dividers / control border / hover border | `#E7E3DB` / `#DCD7CD` / `#C6C0B4` |
| Note / note edge | `#FBF6E8` / `#E6DAB8` |
| Radii: tag / control / node / popover / card / dock | 4 / 7 / 9 / 11 / 12 / 14 px |
| Topbar / rail / control / nominal node | 50–54 / 44 / 32 / 176 px |
| Fonts: UI / numeric / display | IBM Plex Sans / IBM Plex Mono / Newsreader |

- **Color roles.** Use shadcn `primary` for action green. `accent` is an interaction tint, not the export's overloaded `--accent` green. Define paired foregrounds plus warning, branch and node-kind roles. Keep the current `--muted` text color from colliding with shadcn's muted surface. Remove legacy aliases only after checking their consumers.
- **Fonts.** Package fonts locally with their licenses, used weights only, and no remote CDN. Spline Sans is board annotation only. Mono is for measurements and units, not body copy.
- **Nodes.** The 176 px node width is nominal and never a reason to truncate needed fields.

### Accessibility corrections

Measured 2026-09-22 on source tokens (sRGB relative luminance). Targets: text ≥ 4.5:1; meaningful control boundaries and state indicators ≥ 3:1 ([WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)).

| Pair | Ratio | Decision |
|---|---|---|
| Secondary `#6B7671` / panel `#F7F5F1` | 4.33 | Use `#626D68` on all paper surfaces (4.94 on panel) |
| Secondary / shell `#FBFAF7` | 4.52 | Passes, but the shared token takes the safer correction |
| Meta `#8A938F` / white | 3.16 | Not for informative text; use the corrected secondary |
| Purple `#7C5FC0` / purple tint | 4.54 | Keep for this pair; verify other states |
| Clay `#B4674A` / clay tint | 3.79 | Decorative only; risk text uses `#A15B40` (4.62) |
| Green `#0B5C54` / shell | 7.53 | Keep for actions and focus |
| Green edge `#A8CBC5` / white | 1.75 | Selection decoration only; never the sole focus/state cue |

- **Focus** is solid action green, thick and offset enough to stand out on any adjacent surface.
- **Field borders.** The light control border alone can't identify an enabled field: add a stronger control-border token or fill. Don't darken decorative dividers globally.
- **Opacity.** Never lower opacity on informative text without measuring the composite.
- **Text size.** The design's 9 px metadata isn't a required size. Everything must work at 200% zoom.
- **Touch targets.** Coarse-pointer targets are ≥ 44 px; the 32 px desktop controls aren't the phone spec.
- **Where fixes live.** Corrections apply centrally in tokens and components, never per screen. Browser verification still happens in RV-01.

## Components

Existing primitives use Radix, `cva`, `cn()` and Tailwind v4 (`@/` = `src`). `components.json` is absent.

**Adding components.**
- Configure shadcn deliberately: no `init --force` and no mass replacement.
- Use the official registry ([catalog](https://ui.shadcn.com/docs/components), [theming](https://ui.shadcn.com/docs/theming)) via `npx shadcn@latest info --json`, `docs`, `search @shadcn`, `add … --dry-run/--diff`.
- Record CLI and dependency versions, and inspect generated files.
- Only the foundation owner adds dependencies; no opportunistic upgrades.

| Design family | Foundation | Custom part |
|---|---|---|
| Button, IconButton | existing Button | semantic variants, 32 px size, icon labels |
| Tag, CountBadge, StatusDot, KeyHint | Badge; Kbd | status text/units; the dot is decorative beside its label |
| TextInput, SearchField | Input, Textarea; Field/InputGroup | unit suffix, clear, errors, description |
| Select, Checkbox, Radio, Toggle | Select/NativeSelect; Checkbox/RadioGroup/Switch | domain adapters; no hand-rolled popup keyboard logic |
| Stepper, Slider | Input + Button; Slider | clamping, empty/invalid draft, keyboard steps |
| Tabs, Segmented | Tabs; ToggleGroup | navigation vs setting |
| Breadcrumb, RailItem | Breadcrumb; Button/Tooltip | project/branch identity, active activity |
| Menu, Quick options | DropdownMenu; Command + Dialog | registry-driven, no duplicate handlers |
| InlineAlert, EmptyState, Toast | Alert; Empty; Radix toast | honest state-specific text |
| Meter | Progress | determinate vs indeterminate, units |
| Panel | ScrollArea, Tabs, DropdownMenu; Resizable | placement reducer, targets, bounds, stacks; not a Dialog when docked |
| Library row/detail | Button, Badge, Popover/HoverCard | search, focus/touch detail, place/save |
| Node, Boundary, StickyNote | XYFlow renderer + Button/Badge/Input | handles, selection, runtime data; no forced Card wrapper |
| Dock | Button, ToggleGroup, Tooltip, Separator, Popover | ordering, overflow, customization |
| Merge resolver/history | Tabs/ScrollArea/Alert/Dialog | typed diff/conflict views; no text-merge library |

**Rules:**
- **Dependencies:** `ui/` primitives never import domain, editor or persistence code. Compositions take typed values and events.
- **Styling:** variants own appearance; screen `className` owns layout only. No repeated palette, radius or type overrides.
- **Behavior:**
  - Buttons default to `type=button`, and `asChild` keeps link semantics.
  - Refs and composition work; controlled and uncontrolled both work; disabled and loading states behave correctly.
  - No nested interactive elements.
- **Forms and overlays:**
  - Labels and linked errors, visible focus.
  - Overlays have a title and description, focus return, and correct Escape and outside-click behavior.
  - Layering follows the tokens in [commands.md §7](contracts/commands.md#7-panels-and-geometry).
- **Touch:** hit areas may exceed the visual 32 px without blocking neighbors.
- **Global CSS:**
  - All states stay visible under the current global CSS.
  - Keep needed native fallbacks and remove conflicting broad rules.
  - `@layer base` already wraps the button/input rules. Remaining legacy rules and hard-coded colors still need computed-style checks.
- **Specimen:** one deterministic specimen page for review; no component-explorer framework.
- **Sign-off:** record provenance and upstream deviations. Claude accepts the foundation before other packages restyle.

## Code anchors

| Responsibility | Files |
|---|---|
| Composition, autosave, project lifecycle | `src/App.tsx` |
| Chrome | `src/components/layout/{TopBar,ActivityRail,CanvasFloatingDock,ResultsStrip}.tsx` |
| Canvas | `ArchitectureCanvas.tsx`, `SubsystemNode.tsx`, `TrafficEdge.tsx`, `CanvasNotes.tsx`, `CanvasContextMenu.tsx`, `DiagramOrganization.tsx` |
| Editing | `OpenInspector.tsx`, `Inspector.tsx` (legacy), `OpenConnectionEditor.tsx`, `OpenWorkloadControls.tsx` |
| History/results | `RevisionsPanel.tsx`, `ResultsPanel.tsx`, `OpenMetricsPanel.tsx`, `StudioMenu.tsx` |
| State/data | `src/state/editor.ts`, `src/domain/{model,results,revisions}.ts`, `src/persistence/projects.ts` |
| Execution | `src/simulation/useSimulation.ts`, `src/simulation/open/{kernel,adapter}.ts` |
| Foundations | `src/components/ui/*`, `src/styles.css`, `src/lib/utils.ts`, `vite.config.ts` |
