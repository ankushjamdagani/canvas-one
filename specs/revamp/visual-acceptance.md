# Visual acceptance against the design boards

2026-09-29, `master`. Sources: `System Studio Directions.dc.html` (screens, rendered in [`screens/`](screens/)) and `System Studio Design System.dc.html` plus its tokens and components (`artifacts/design/Copy of Elegant and modern design refresh/`). Authority order is design.md's: decisions and contracts override the boards.

## Method

- **Tokens:** the design system's `tokens/*.css` were compared with `src/styles.css` (colours, radii, shadows, focus rings, canvas texture).
- **Screens:** 15 board screens were captured in the matching app state at the board's pixel size and stacked board-over-app for review: 2A new system, 2A workspace, 16A, 16B, 16D, 16E, 12A, 13A, 13B, 18B, 14A, 22A, 21B, the scenario switcher and the traffic editor.
- **Computed styles** were checked where the pictures differed. Per verification.md, no fidelity scores are given; only concrete discrepancies are listed.

## Fixed (`9ed3fb3`, `0cf947b`)

| ID | Discrepancy | Fix |
|---|---|---|
| V1 | Unlayered element defaults for `p`, `h2`, `h3` and `select` beat every Tailwind class on those elements. Error text in a `<p>` rendered grey instead of clay, and all `p`/`h3` text was forced to 12 px. | Moved into `@layer base`, so classes win. |
| V2 | A legacy base rule boxed every raw `<button>` (border, fill, padding) and dimmed disabled ones to 40 %. Menu rows, tabs and text links (project menu, "Publish draft to main", "Run all", results tabs) looked like outlined buttons. | The base rule now sets only the cursor. |
| V3 | Filled text fields stayed on shell. The fill rule needs a placeholder, and 38 of 49 fields had none. `bg-canvas` overrides forced some empty fields white; the connect form used raw inputs. | Invisible default placeholder; overrides removed; connect form on the `Input` primitive. |
| V4 | Section labels came in 10–12 px variants with mixed weights. | One `text-meta` token: 10 px mono, 0.1em tracking, secondary text colour. |
| V5 | Canvas nodes were panel-filled with a resting shadow and 11 px captions. | White, hairline, no resting shadow, 10 px mono caption (authored Node). |
| V6 | The dot grid was 16 px `#DCD7CD`, where the board has 26 px `#EFEBE3`. | New `--hairline-soft` token; 26 px grid. |
| V7 | Entry cards were panel-filled with a shadow; counts were in sans. | White with hairline, no shadow; counts in mono. |

## Intentional deviations (kept)

- **Secondary text `#626D68`** instead of `#6B7671`; **stronger field border** `--input`; **solid focus outline** and a **2 px selected-node border**. These are design.md's accessibility corrections.
- **Entry layout** (no prompt box, no "Bring in what exists") per D12; the 16E picker has no Recent/Patterns/team chips per design-revalidation §2.
- **Panels overlay below 1200 px** (commands.md §7), so boards drawn at 1122–1132 px show docked panels where the app shows an overlay. At 1512 px they dock.
- **Top bar** has the scenario switcher and Run (D38) instead of "Run Simulation". Results content (charts, "vs run", p99, Stop run) follows the contracted metrics.

## Open → decided (D44, 2026-09-30)

O1: keep icon-only. O2: follow 16D. O3: follow the board, per-field choices by the lead. O4: follow the board. Work is planned in [plan-rv18-rv20.md](plan-rv18-rv20.md) (RV-20).

| ID | Board | App today | Note |
|---|---|---|---|
| O1 | Dock labels its main tools (Select, Pan, Component, Connect, Note, More). | Icon-only, with aria-labels and tooltips. | Flagged in design-revalidation; labels widen the dock, which already overflows on phones. |
| O2 | The selection toolbar (16D) floats just above the selection and has "Wrap in boundary" plus an overflow menu (Save as component, Export selection…). | Fixed bar at the canvas's top right; a multi-selection also opens a "2 selected" inspector with no controls. | Anchoring needs selection-bounds tracking; the empty inspector could simply stay closed. |
| O3 | The scenario editor shows compact summary rows ("Requests that failed · at most 0"), expanding one to edit, with a full-width footer ("Unsaved changes · Apply, then run again"). | Every field editor is expanded; small footer buttons. | Larger layout change in the D41 editor. |
| O4 | The inspector kind tag (`PROCESSOR`) is a green-tint tag. | Neutral tag. | The design system's Tag tones don't cover "kind"; needs a rule, not a guess. |

## Verification

1,429 unit tests; `npx tsc -b`; production build; isolated production Playwright 78 passed / 4 skipped; responsive sweep 45/45; touch audit 0 controls under 44 px; computed-style probes for V1 (`p.text-risk-text` → `rgb(161, 91, 64)`) and V3 (empty field shell, filled field white after the transition).
