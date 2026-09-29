# Accessibility pass

2026-09-29, `master` @ `cb8792b`. Target: WCAG 2.2 AA and design.md's accessibility requirements (overlays have a title, focus return, Escape and outside-click behaviour; visible focus; 44 px coarse-pointer targets). Automated checks plus scripted keyboard probes; no screen-reader session was run.

## Method

| Check | How | Result |
|---|---|---|
| Automated rules | `npm run build && node scripts/a11y-audit.mjs`: axe-core, WCAG 2.0/2.1/2.2 A and AA tags, 11 states (entry, workspace, inspector, 16E picker, Library, History, project menu, Quick options, scenario switcher, scenario editor, results details) at 1512×982 and 390×844 touch | No violations |
| Focus return | Open each overlay from its trigger with the keyboard, close with Escape, read `document.activeElement` | All return to the opener |
| Panel focus | `history.open` / `library.open` | Focus lands on the panel header (labelled "History panel") |
| Reflow (1.4.10) | 9 states at 320×640 touch: page `scrollWidth`, and any control outside the viewport not inside a scroll container | No horizontal scroll, nothing clipped |
| Resize text (1.4.4) | 200 % zoom approximated by a 756×491 viewport (e2e "short viewport") | Usable canvas with results expanded |
| Touch targets (2.5.8, design.md 44 px) | iPhone 13 coarse pointer, 7 states | 0 targets under 44 px (the 1×1 hidden file input behind "Import part file" is not a target) |
| Contrast | axe `color-contrast` in every state above; tokens already carry design.md's darker secondary text | Pass |

## Fixed (`cb8792b`)

| ID | Finding | Fix |
|---|---|---|
| A1 | `nested-interactive`: each scenario row was a clickable `role`ed element containing its own "⋯" menu button. | The row is a plain container; selection is an inner `<button aria-pressed>`, the menu sits beside it. |
| A2 | `scrollable-region-focusable`: the results strip, checks, event log and details panel scrolled but could not be reached by keyboard. | Each is a focusable, labelled `region`. |
| A3 | Opening History or Library did not move focus, though commands.md says open "expands and focuses the panel". | The panel header is focusable (`tabIndex=-1`, visible focus ring) and receives focus unless focus is already inside the panel. |
| A4 | Quick options and the 16E picker are opened without a Radix trigger, so Escape left focus on `<body>`. | Both restore focus to their opener unless a command moved focus on purpose. |
| A5 | Below 1200 px, History and Library open as a backdrop overlay that was not a dialog: no focus trap, Escape and a backdrop press did nothing, focus was not returned. | A non-portalled Radix dialog: titled, modal, Escape and backdrop close it, focus returns to the top-bar History button or the dock's Component button (Quick options when History's button is hidden). |
| A6 | At 320 px the scenario switcher and Run button (also at 360 px), the selection toolbar and the Quick options search field ran off screen. | History's top-bar button steps back below 390 px (Quick options lists "Open history"); the project name caps at 48 px below 360 px; the selection toolbar wraps within the canvas; the Quick options list no longer widens its dialog. |

New acceptance: `tests/studio-phone.spec.ts` "320×640 touch (WCAG 1.4.10 reflow)" covers A5 and A6.

## Not covered

- No screen-reader walkthrough (VoiceOver/NVDA); announcements of run progress and save status are unverified beyond their markup.
- Keyboard-only canvas editing (moving and connecting parts without a pointer) was not assessed.
- Text-spacing overrides (1.4.12) and forced-colours mode were not tested.
- 200 % zoom was simulated by viewport size, not by browser zoom.
