# Impeccable technical audit — 2026-10-07

Implementation integrity: **Pass**. The warm drafting surface, typography roles, reusable controls and domain-specific canvas form a coherent product system. Detector scan of `src` produced one warning (`kbd.tsx:43`, rounded element with `border-b-2`); this is a deliberate physical keycap cue, not a card accent defect. Excluded as a false positive.

## Health score

| Dimension | Score | Key finding |
| --- | --- | --- |
| Accessibility | 3/4 | Phone DRAFT badge contrast fails AA |
| Performance | 3/4 | Paused decorative ground continues drawing |
| Responsive design | 3/4 | Reflow passes; phone heading landmark absent |
| Theming | 3/4 | Feature CSS bypasses existing semantic tokens |
| Implementation integrity | 4/4 | Coherent system; detector warning intentionally justified |
| **Total** | **16/20 — Good** | Address the verified gaps below |

Five findings: **P0: 0; P1: 1; P2: 4; P3: 0**. Scores describe sampled routes and states, not whole-product certification. No UI changes were made.

## Prioritized findings

### [P1] Phone branch badge fails text contrast

- Location: `src/features/workspace/TopBar.tsx:369–389`; shared `src/components/ui/badge.tsx:16`.
- Category: Accessibility.
- Evidence: Chromium, S04 editor, 320×640: Axe measured DRAFT text `#7c5fc0` on `#fbf1ea` at **4.43:1**, 11.5px normal weight; required minimum is 4.5:1. Desktop sampled state did not report it.
- Impact: The only compact branch-state cue becomes harder to read on phones. Violates WCAG 1.4.3.
- Recommendation: Inspect computed inherited branch-button color and badge token precedence; ensure the shared badge's intended foreground wins, and test both MAIN/DRAFT in open/closed phone menus. Adjust semantic foreground if required, then verify the actual rendered pair.
- Suggested command: `$impeccable harden`.

### [P2] Landing ignores reduced-motion changes during a session

- Location: `src/features/entry/LandingPage.tsx:52–59`.
- Category: Accessibility.
- Evidence: Preference is captured once in a ref without a change listener. After loading with normal motion and switching Chromium to reduced motion, the demo figure's text continued changing over 1.5 seconds. Initial reduced-motion load correctly presents a static accepted state.
- Impact: Users who turn motion reduction on while the page is open still receive the timed sequence until reload. A pause control exists, so this is not a task blocker or an asserted AA failure.
- Recommendation: Subscribe to the media-query change event and stop the interval immediately; preserve the static state alternative already used on initial load.
- Suggested command: `$impeccable animate`.

### [P2] Paused and hidden drafting ground keeps repainting

- Location: `src/components/ui/drafting-board.tsx:130–147, 276`; `src/features/shell/BoardLayer.tsx:111`.
- Category: Performance.
- Evidence: `paused` sets elapsed delta to zero, but normal-motion `draw` continues scheduling itself. Every callback clears the canvas, reads computed grid color and rebuilds the full dot path. The shared board passes `paused || !visible` when the editor hides the ground.
- Impact: Repeated decorative work consumes CPU/battery even when paused or visually absent, competing with editor work. No frame-rate loss or battery delta was measured; this finding is verified code-path inefficiency.
- Recommendation: Paint once at rest, cancel RAF while paused/hidden, resume on state changes, and invalidate static drawing on resize or theme changes. Cache the computed grid color rather than reading it every frame.
- Suggested command: `$impeccable optimize`.

### [P2] Phone editor lacks a level-one heading

- Location: `src/features/workspace/TopBar.tsx:213` and the workspace's accessible page structure.
- Category: Accessibility / Responsive design.
- Evidence: Axe `page-has-heading-one` appears in the 320×640 editor state. Public pages have an H1. This is an Axe best-practice finding, not independently a WCAG failure.
- Impact: Heading navigation cannot identify the current editor/project at phone widths.
- Recommendation: Add one persistent accessible project/editor H1, visually hidden where necessary, independent of panel visibility and responsive title truncation.
- Suggested command: `$impeccable harden`.

### [P2] Feature-level colors bypass semantic tokens

- Location: `src/features/entry/landing-page.css:24–30, 56–62, 123–135`; `src/features/workspace/TopBar.tsx:369–380`.
- Category: Theming.
- Evidence: Repeated literal teal/purple/paper values duplicate existing primary, branch and surface tokens in `src/styles.css`. Branch button text literals participate in the badge color context described above.
- Impact: Contrast corrections and palette updates must be repeated across feature code, allowing foreground/background pairs to drift.
- Recommendation: Preserve the approved palette while replacing repeated semantic literals with foundation tokens. Retain deliberate artifact-specific accents only where their role differs. Dark mode is not an approved product requirement and its absence is not scored as a defect.
- Suggested command: `$impeccable extract`.

## Positive findings

- Production TypeScript/Vite build passes; largest JS chunks are Workspace 492.31 kB and index 474.75 kB, below the repository's 500 kB ceiling. This is bundle evidence, not a Core Web Vitals measurement.
- Axe found no violations on landing/projects at 1440×900 and 320×900, or in the sampled desktop editor.
- Document horizontal overflow measured zero in every sampled public state and the 320×640 editor. Screenshots confirm public reflow and compact editor chrome; panning architecture beyond the viewport is intentional infinite-canvas behavior.
- Foundation Button supplies coarse-pointer target enlargement and visible keyboard focus styles. Landing drag surfaces declare `touch-action: none` and have pointer-cancel cleanup.
- Initial reduced motion provides a meaningful static demo state, while DraftingGround responds to media-query changes.
- Local fonts, split production modules, shared control primitives and explicit illustrative demo semantics are maintained.

## Verification and limits

Ran the Impeccable context loader once, Graphify navigation, source inspection, detector once over `src`, production build, and one isolated Chromium audit probe against freshly built `dist` on port 5196. The probe completed successfully and logged findings rather than asserting Axe cleanliness. Desktop/phone landing and editor captures were inspected; projects captures were generated. Temporary probe/config removed. Browser evidence remains in ignored `test-results/audit-temp-audit-measured-public-and-editor-states/` until the next test run.

This pass did not execute the full unit/e2e suite, Lighthouse, keyboard overlay focus-return journeys, 200% text scaling, running simulation states, physical-device touch, or synthesized touch gestures. A phone viewport demonstrates layout only. The working tree's unrelated transition changes were preserved. Existing handoff reports remain historical evidence and are not counted as checks run by this audit.

## Recommended actions

1. **[P1] `$impeccable harden`** — repair badge contrast, then retain an accessible editor H1 on phones.
2. **[P2] `$impeccable animate`** — honor live reduced-motion changes on the landing demo.
3. **[P2] `$impeccable optimize`** — stop decorative redraws when paused/hidden.
4. **[P2] `$impeccable extract`** — consolidate duplicated semantic colors into foundation tokens.
5. **Final: `$impeccable polish`** — check the corrected states in one bounded visual pass.

You can ask me to run these one at a time, all at once, or in any order you prefer. Re-run `$impeccable audit` after fixes to see your score improve.
