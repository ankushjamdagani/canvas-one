# Verification

## Baseline (2026-09-21, app source `fb4a1ff`)

| Command | Result |
|---|---|
| `rtk npm test` | PASS: 233 tests, 36 files |
| `rtk npm run build` | PASS; main JS 769.25 kB (236.27 kB gzip); existing >500 kB chunk warning |
| `TEST_PRODUCTION=1 rtk npm run test:e2e` | FAIL: 46/51 pass (Chromium only) |

The app source hasn't changed since; planning touched docs only. The e2e config reuses existing servers (`reuseExistingServer: true`), so acceptance runs must confirm the server/build under test isn't stale.

**Existing mobile failures.** These are symptoms, not diagnosed causes:

| Test | Symptom | Fixed by |
|---|---|---|
| `tests/diagram.spec.ts:58` palette on mobile | Connection config region missing after edge interaction | RV-03/04/05 |
| `tests/diagram.spec.ts:141` custom controls/long content | Catalog intercepts click on node; timeout | RV-03/04/06 |
| `tests/diagram.spec.ts:260` mobile templates | Load-example target 40 px, needs ≥ 44 | RV-01/10 |
| `tests/export.spec.ts:89` mobile PNG retry | Canvas height 0 at final assertion | RV-03/10 |
| `tests/internals.spec.ts:111` mobile internals | Rail/canvas intercept Expand click | RV-03/04 |

Fix the layout or interaction. Never remove assertions, force clicks or add sleeps to make tests pass.

## Evidence rules

- **Record:** base/head commits, exact commands, exit status, counts, viewport, fixture, model/runner version, reference frame and screenshot path. Keep design renders, fixture renders and integrated-app captures separate. Screenshots must show real states with the right fonts loaded.
- **Test levels:** unit tests for reducers and domain operations, focused browser tests for interactions, and the full suite at integration and release.
- **Config limits:** the unit config only picks up `src/**/*.test.ts`; TSX tests need deliberate setup. No tests that merely restate class strings.
- **Retired tests:** each maps to its retired requirement. Keep meaningful assertions about retained behavior.
- **Honesty:** never mark a skipped or blocked check as passed.

## Acceptance matrix

| Area | Cases |
|---|---|
| Foundations | All states; semantic tokens; readable at zoom; overlay stacking; focus return |
| Panels | 23A–G; side widths; float bounds; resize; stack; collapse/peek; Escape; keyboard/touch; reload; narrow |
| Canvas | Node states; handles; wiring; group/ungroup; notes; atomic move/undo; duplicate; camera kept through resize |
| Inspector | Multi-field Apply; invalid draft; Cancel; one undo; dirty close/switch; stale/removed target; live vs saved data; scenario-specific fields |
| Parts | Remapped references; visible external exclusions; independent copies; limits; no inherited results; one undo; import validation |
| Branches | Independent autosave; save failure blocks switch; reload; per-branch history; dirty-draft gate; editing main creates a branch |
| Run evidence | Exact fingerprint (scope, refinement, assumptions, inputs, seed, budget); visual-only changes; incomplete/imported evidence; no diagram exemption; every scenario and check passing; changed checks need rerun |
| Merge/publish | Unchanged/identical/disjoint/conflicting fields; delete vs edit; broken references; moved main; rerun merged candidate; atomic failure; default closure and reopen; no undo |
| Storage cutover | Fresh namespace; old DB untouched; unsupported formats rejected; round trip; bad IDs/references; quota and size limits |
| Results | Idle/running/paused/completed/saved/imported; root vs message; real samples; empty values; unmatched comparisons; reveal correct node |
| Export | SVG/PNG full view; lossless JSON; CSV units/provenance/formula safety; Mermaid escaping and loss notice; errors/retry |
| Responsive | Desktop reference sizes, 1024×768, 768×1024, 390×844; one overlay on phones; non-zero canvas; 200% text zoom; long names |
| Model families | S01–S05 success and failure traces (model-and-runner §11–12) |
| Local adapters | No remote dependency; shared/personal/artifact separation; author provenance; stale writes and failures; no secrets in portable data |
| AI seams (R15) | UI-independent validated commands; candidate diffs and revision checks; stable references; no bypass; no AI provider required |

## Visual acceptance

- **Method:** compare matched viewport and state crops, not whole boards. Check hierarchy, chrome sizes, spacing, font metrics, colors, radii, line weights, selected/disabled states, clipping and focus. Capture empty, populated and error states for each screen.
- **Pixel diffs** can flag a change but never replace semantic review.
- **No fidelity scores.** Claude lists concrete discrepancies, Gemini fixes the assigned ones and Codex verifies.

## Release gates

1. Decisions and contracts accepted; no ambiguous destructive behavior.
2. Unit tests, build and the full production e2e suite pass, including the five mobile failures above.
3. Source-to-screen coverage verified with real data; no fixture values in production.
4. Storage/recovery, unsupported-version and S01–S05 checks pass; no kernel changes hidden in UI commits.
5. No unresolved critical/high review findings; everything else has an explicit disposition.
6. Codex records acceptance on a clean checkpoint. Push and deploy are separate actions.
