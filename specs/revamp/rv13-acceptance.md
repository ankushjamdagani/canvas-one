# RV-13 release acceptance

Audit of `claude/rv-01a-tokens` against the [release gates](verification.md#release-gates) on 2026-09-29. It started at `5ba97bd` and fixed what it found, ending at `d58d03d`. Claude ran this as lead, with no subagents. The **recommendation is to accept**, subject to the user decisions listed under gate 6. Nothing is pushed or deployed.

## Evidence at `d58d03d`

| Check | Command / method | Result |
|---|---|---|
| Unit | `npx vitest run` | 1,415 passed, 122 files |
| Types | `npx tsc -b` | no errors |
| Build | `npm run build` | passes; main JS 1,633 kB (440 kB gzip), CSS 114.93 kB (21.05 kB gzip); existing large-chunk warning |
| Production e2e | `TEST_PRODUCTION=1 npx playwright test` with a throwaway config: port 5213, `reuseExistingServer:false`, 2 workers, no retries | 73 passed, 4 skipped (dev-only specimen) |
| Whitespace | `git diff --check` | clean |
| Responsive sweep | Playwright script over the production build. 8 states (entry, S05 workspace, inspector, Library, History, project menu, S04 results with Details, long project name) at 1512×982, 1024×768, 768×1024, 756×491 (200% page zoom of the desktop reference) and 390×844 | 40/40 states: no page-level horizontal scroll, non-zero canvas, at most one overlay on the phone, no page errors |
| Touch targets | Playwright, iPhone 13 profile (coarse pointer) at 390×844, 6 states, every visible control outside canvas cards | 0 under 44 px. The one exception is Library's `Import part file`, a 1×1 visually hidden file input driven by a full-size button |

## Gates

| # | Gate | Status | Evidence / notes |
|---|---|---|---|
| 1 | Decisions and contracts accepted; no ambiguous destructive behavior | **Pass, with open decisions** | Node delete previews its reference repairs, confirms, and is undoable. Scenario delete confirms. Publish needs an explicit irreversible confirm (D26). Restore requires a pre-restore checkpoint label. Project delete and prune are repository-only, with no UI. Open decisions are listed under gate 6. |
| 2 | Unit, build and the full production e2e suite pass, including the five mobile failures | **Pass** | See evidence. The five legacy mobile specs (`diagram`, `export`, `internals`) were retired with the legacy UI in RV-12c2 (`c7a5a12`, D37). Their concerns are now covered on the new app: phone palette/Library and node interaction (`studio-library`, `studio-authoring` 390 checks), the ≥44 px entry targets (touch audit, entry 0 under 44 px), a non-zero canvas (responsive sweep, `studio-phone`) and mobile run controls (`studio-runs`, `studio-phone`). |
| 3 | Source-to-screen coverage with real data; no fixture values in production | **Pass** | The only production fixture import is the S01–S05 reference examples on the entry screen (`features/entry/fixtures.ts`). That is intentional product content (RV-12c2 entry 2A), not placeholder data. `features/scenarios/mockDocument.ts` and `ScenariosPreview.tsx` are unreferenced dev harnesses; the production bundle contains 0 occurrences. Results, metrics and CSV come from saved runs (RV-10a/12d reviews). |
| 4 | Storage/recovery, unsupported-version and S01–S05 checks; no kernel changes hidden in UI commits | **Pass (after fixes)** | 20 persistence test files: recovery, quota, CAS/stale, export/import, prune, reload and S01–S05 candidates. Five-family runner acceptance is in `runner/acceptance.test.ts`. Unsupported v7/v8 imports are covered by `studio-transfer` and `studio-entry`. **Added:** `studio-storage-cutover` proves the retired `system-studio` database keeps its version, store and record and is never listed. Kernel: the only UI-line commit touching `src/simulation/open` since the runner merge is `c7a5a12`, which deleted the legacy worker adapter as stated in its message; kernel logic and goldens are unchanged. |
| 5 | No unresolved critical/high findings; everything else has a disposition | **Pass (after fixes)** | See findings. Both high findings are fixed; the carried gaps have dispositions below. |
| 6 | Acceptance recorded on a clean checkpoint; push/deploy separate | **Awaiting user** | Clean checkpoint `d58d03d`. The only uncommitted files are pre-existing `artifacts/*.png` captures from before this audit, which were left alone. Needs the user's sign-off (the plan names Codex as recorder) and decisions on: (a) 16E `LibraryPicker` stays unmounted (singleton Library, D30/R07); (b) RV-02 open gap, whether scenario `entryPorts` is a set or ordered; (c) the design debt below. |

## Findings from this audit

| ID | Severity | Finding | Disposition |
|---|---|---|---|
| A1 | **High** (R13 truthful results) | Readiness did not enforce the §8 bridge rule. A router with a call route to a non-resource element settled roots `succeeded` without dispatching that route. A non-router resource with a bridge plus another call took the resource edge and skipped the bridge. Both reproduced against `ResourceAdapter`. | **Fixed** `189fcb1`: `router-bridge-unsupported` and `bridge-continuation-conflict` readiness issues, with 4 tests. Router + bridge execution itself remains the accepted RV-14f limitation, now rejected rather than silently skipped. |
| A2 | **High** (D14 full phone editing) | At 390 px the top bar overflowed its clipped container. The breadcrumb was pushed off-screen, so the project menu (rename, export, branches) was unreachable, and Run was clipped. | **Fixed** `d58d03d`: phone-compact top bar. Guarded by `studio-phone` for S04 and S05. |
| A3 | Medium (design.md touch targets) | Many coarse-pointer controls were under 44 px. The breadcrumb project button was 15 px tall and the branch button 12×12. | **Fixed** `d58d03d`. |
| A4 | Medium | At 756×491 (200% page zoom) the expanded results details left a 10 px canvas. | **Fixed** `d58d03d`: details cap at `min(380px, 40vh)`, giving a 194 px canvas. Desktop and tablet are unchanged. |
| A5 | Medium | On phones, the results Details button started off-screen inside the scrolling strip. | **Fixed** `d58d03d`: save status and Details stay pinned; only the run metrics scroll. |
| A6 | Low | The entry screen's blank-project name input collapsed to 25 px in the phone column layout (`flex-1` in `flex-col`). | **Fixed** `d58d03d`. |
| A7 | Low | No browser proof that the old database stays untouched. | **Fixed** `7fa24c0`. |
| A8 | Low | Five e2e screenshots were written to a hard-coded scratchpad path from an earlier session. | **Fixed** `7fa24c0`: now written to each test's `outputPath`. |
| A9 | Low | At 768 px the breadcrumb truncates the project name ("S05 F…") and hides the branch label text; the DRAFT/MAIN badge and branch icon stay. | **Accepted**: the full name is in the button title and the project menu. |
| A10 | Low | `ScenariosPreview.tsx` and `mockDocument.ts` are unreferenced dev harnesses. | **Accepted**: tree-shaken out, 0 bundle occurrences. Delete in a cleanup task if wanted. |

## Carried gaps from the ledger (disposition)

- **Accepted limitations, explicit at runtime or in the contract:**
  - RV-14f runtime refinement maps one level of ports (the compile-time closure walks the full depth).
  - RV-14c pipeline error-row semantics (the original row goes to the error output; only the overflowing row fails).
  - RV-14b request-ID format and `trace` effects recorded as `state`.
  - RV-14a `buildManifest` has no AbortSignal (cancellation is observed between steps), `identity-unavailable` maps to invalid, and there is no scheduled-events/live-roots default/max pair.
  - RV-08b checkpoints don't bump the branch revision.
  - RV-08d commit message and `evidenceManifest` go beyond storage.md's commit row; closed branches can't commit.
  - RV-16a preferences use the single key `user`.
  - RV-12c1 empty undo/redo returns `{status:'empty'}`.
- **Superseded by later work:**
  - RV-12e request-class labels (fixed by RV-12f).
  - RV-09a saved parts, Library save and part files (done in RV-09b). Replace part stays omitted because no precise command is contracted.
  - RV-03a/RV-03p panel gaps (RV-03t registry, RV-12j preferences).
  - RV-05b multi-select (one inspector, no bulk edit, as designed).
- **Design debt, not release-blocking, owned by a design package:**
  - Legacy `--line`/`--ink`/`--teal` values in base button/input rules.
  - Selected-edge stroke `#c48212`.
  - The unused `.dark` token block (RV-01).
  - RV-01 residuals: button text colour, `filled` field placeholder, loading+asChild spinner, toast layering token.

## Not verified here

- **Visual acceptance against the design boards** (verification.md "Visual acceptance"). This pass checked layout, reachability and sizing, not board fidelity.
- **Browser text-only zoom at 200%.** It isn't scriptable, so page zoom was approximated with a 756×491 viewport.
- **Screen-reader behaviour** beyond accessible names, and focus return per overlay (partially covered by the existing e2e).
- **The AI seams (R15) and local-adapter matrix rows,** beyond the existing unit suites.
- **Performance and bundle splitting.** The large-chunk warning remains.
