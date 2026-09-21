# Verification and acceptance

Scope revision, 2026-09-21: the baseline below is historical evidence for the starting app. D17–D20 now require model scenarios across S01–S05, permit dropping old-data compatibility and keep run-required commits without diagram exemptions. Do not retain obsolete tests merely to preserve their count; map each removed test to the retired requirement, and preserve meaningful retained-behavior assertions.

## Baseline recorded 2026-09-21

Application source at `fb4a1ff` (`fix: improve TopBar responsiveness and add UI review regression tests`). Only design/planning files were added during this task; no app fixes were made.

| Command | Actual outcome |
|---|---|
| `rtk npm test` | PASS: 233 tests, 36 files, 2.46s |
| `rtk npm run build` | PASS: TypeScript + Vite; main JS 769.25 kB / 236.27 kB gzip; existing >500 kB chunk warning |
| `TEST_PRODUCTION=1 rtk npm run test:e2e` | FAIL: 46 passed, 5 failed out of 51, about 1.1m; Chromium, five workers |
| Local reference render script via Node/Playwright | Four supplied HTML frames rendered; initial sandbox launch failed, approved retry succeeded |

Earlier HANDOFF/ACTION_LOG reports of 45 passing browser tests are historical and are not the current baseline. The E2E suite uses its existing `reuseExistingServer: true` configuration; future acceptance must verify server/build identity rather than accidentally test a stale preview. No browser-family coverage beyond Chromium was run.

### Existing mobile failures

| Test | Observed failure | Owning revamp acceptance |
|---|---|---|
| `tests/diagram.spec.ts:58` palette usable on mobile | Connection configuration region missing after edge interaction | RV-03/04/05 integration |
| `tests/diagram.spec.ts:141` custom controls/long content | Catalog intercepts click on custom node; timeout | RV-03/04/06 |
| `tests/diagram.spec.ts:260` mobile templates | Load example target 40px high, assertion requires at least 44px | RV-01/10 |
| `tests/export.spec.ts:89` mobile PNG failure/retry | Canvas bounding-box height is zero at final assertion | RV-03/10 |
| `tests/internals.spec.ts:111` mobile expanded internals | Rail/canvas intercept Expand Chat client click; timeout | RV-03/04 |

These are observed symptoms, not completed root-cause diagnoses. Do not remove assertions, use forced clicks or add arbitrary sleeps to turn the suite green. Resolve the underlying layout/interaction or document an approved interaction change with equivalent coverage.

## Evidence per task

Record base/head commits, exact command, exit status, result counts, viewport, fixture name, engine/model version where relevant, reference frame and screenshot path. Screenshots used as acceptance evidence must load the intended fonts and represent real component states. Separate design-source renders, fixture/component renders and integrated-app captures.

Use scoped unit tests for reducers/domain operations, focused browser tests for interactions, and the full suite at integration/release gates. Existing test configuration only includes `src/**/*.test.ts`; don't assume a new TSX test file runs without deliberate configuration. No tests that merely restate class strings or mirror implementation.

## Required acceptance matrix

| Area | Required cases |
|---|---|
| Foundations | rest/hover/pressed/focus/disabled/invalid/loading; semantic tokens; readable zoom; overlay stacking and focus return |
| Panels | 23A–G; side widths; float bounds; resize; stack; collapse/peek; Escape drag cancel; keyboard/touch equivalents; reload and narrow viewport |
| Canvas | selected/unselected nodes; handles; free wiring; group/ungroup; notes; atomic move/undo; copy/duplicate; camera preserved through UI resize |
| Inspector | valid multi-field Apply; invalid draft; Cancel; one undo; dirty close/switch; removed/stale target; live vs saved data; scenario-specific behavior |
| Parts | internal references remapped; external links excluded visibly; independent placement; limits; no inherited observed results; one undo; import validation |
| Branches | independent autosaved work; save failure blocks switch; reload; per-branch history; dirty inspector gate; main edit creates draft |
| Run evidence | exact scenario/scope/refinement/assumption fingerprint; input/seed/budget mismatch; visual-only changes; incomplete/imported evidence; no diagram exemption; completion distinct from assertions |
| Merge/publish | unchanged/identical/disjoint/conflicting fields; delete/edit; invalid edge/route/attachment; changed main; merged-state rerun; atomic failure; recoverable close/undo |
| Storage cutover | fresh current namespace; old database untouched; unsupported format rejected; current round-trip/reload; bad IDs/references; quota/size limits |
| Results | idle/running/paused/completed/saved/imported; root vs message rates; real chart samples; empty values; unmatched comparisons; reveal correct node |
| Export | full SVG/PNG view; JSON lossless; CSV units/provenance/formula safety; Mermaid escaping/loss disclosure; errors/retry |
| Responsive | reference desktop widths, 1024×768, 768×1024, 390×844; one overlay on phones; non-zero canvas; 200% text zoom and long names |
| Model families | S01 UI states/events, S02 service flow, S03 data transformations, S04 deployment failures, S05 fullstack/refinement; deterministic success/failure traces |
| Local adapters | no remote dependency; personal/shared/artifact separation; author provenance; stale write/failure handling; no secrets in portable model |

## Visual acceptance

Compare matched viewport/state crops, not whole exploration boards. Check layout hierarchy, chrome dimensions, spacing, font metrics, colors, radii, line weights, selected/disabled states, clipping and focus. Capture each new screen's empty/populated/error state and key interaction states. Pixel diffs may flag change but do not replace semantic review; antialiasing/font differences require manual assessment.

No invented percentage score declares fidelity. Claude records concrete discrepancies; Gemini fixes assigned findings; Codex verifies against source and decisions. Accessibility deviations from source are measured, documented and applied at token/component level.

## Release gates

1. Accepted decisions and contracts; no ambiguous destructive behavior.
2. Unit tests, production build and full production E2E pass, including resolution of baseline mobile failures.
3. Source-to-screen coverage and real-data actions verified; no prototype fixture values in production.
4. Current storage/recovery, unsupported-version and S01–S05 checks pass; no worker/kernel changes hidden in UI commits.
5. Claude review has no unresolved critical/high findings; remaining issues have explicit disposition.
6. Codex records acceptance, scoped diff review and clean checkpoint. Push/deployment are separate actions.

## Architecture follow-up verification

The architecture follow-up performed read-only graph queries and direct source/caller checks, including corrections to the initial scout's reachability claims. Only planning documents changed. Application tests were not rerun; the baseline above is not a new pass claim. Documentation links, requirement references and whitespace are checked before checkpointing this revision. Claude review/Gemini execution remain pending.
