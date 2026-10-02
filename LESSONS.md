# Lessons

Rules learned from past failures, corrections and wasted effort. Loaded every session on every platform. Follow them; cite the rule when it changes your approach.

Maintenance (see `AGENTS.md` §6 and `/retro`):

- A rule lands here only if it would change what a future agent does. No history, no current state.
- Format: imperative rule, then `Why:` with the source `ACTION_LOG.md` date.
- Contradicted rule → replace it. Stale rule (tool fixed, invariant changed) → delete it.
- Hard cap: 50 rules. Over the cap → merge or drop the weakest.

---

## Environment and tools

- **Treat headless `agy` exit 0 with empty output as a failure.** In plan mode it auto-denies `read_file`/`command` and exits silently. Why: 2026-09-23 EXEC-PREFLIGHT.
- **Don't retry `agy` in a restricted sandbox.** It needs localhost binding and writes under `~/.gemini/antigravity-cli/`; request elevated permissions once or record the task as blocked. Why: 2026-09-10, three failed retries.
- **Don't rely on `timeout` or `agy --print-timeout` on macOS.** Use `perl -e 'alarm N; exec @ARGV' <cmd>`. Why: 2026-09-23, 25s timeout ran 79s.
- **`.claude/skills` and `.codex/skills` are symlinks into `.agents/skills`.** Check with `ls -l`; `diff -rq` follows the links and misleads. Why: 2026-09-16 wrong duplication finding.
- **Production e2e needs localhost binding, and Codex's sandbox can't run Chromium.** Ask for elevation up front or keep browser checks with the lead; if denied, report the browser check as blocked. Why: 2026-09-10, 2026-09-12, 2026-09-27 RV-12f/RV-12g.
- **Unit timeouts on a busy machine aren't failures until rerun.** Check `uptime`; rerun the timed-out files alone and record both results. Why: 2026-09-24 RV-08a, 2026-09-26 RV-11a, 2026-09-27 RV-12e (load average 16–25, different files each run).

## Verification

- **Before calling UI, CSS or app-shell work done, run `npm run build`, then the full production browser suite on an isolated port.** The isolated config serves the existing `dist` via `vite preview`, so skipping the build tests the old app (2026-09-30 RV-24). `playwright.config.ts` reuses any server on 5174 (possibly a stale build); use a throwaway config with its own port, `reuseExistingServer: false`, 2 workers and no retries. Fixing the named selectors isn't enough; CSS alone broke the export journey. Why: 2026-09-14, 2026-09-15, 2026-09-27 onward.
- **One passing run doesn't prove a flaky test is fixed.** Say so in the log. Why: 2026-09-10.
- **Keep every build chunk under Vite's 500 kB warning; a new size warning is a regression.** Check with `npm run build`. Why: 2026-09-29 bundle split removed the long-standing warning.
- **Custom colour utilities (`text-ink`, `bg-canvas`, `border-hairline`) only work if `--color-<name>` is defined in `src/styles.css` `@theme inline`.** In Tailwind CSS v4, `--color-*` variables declared only in `:root` do NOT generate utilities (`border-*`, `bg-*`, `text-*`). After using a new token class, grep `dist/assets/*.css` for it. Why: 2026-09-29 RV-17 and 2026-10-01 component discrepancy audit.
- **Unit tests must be `src/**/*.test.ts`; `.tsx` test files never run.** Render components with `React.createElement` + `renderToStaticMarkup`. Why: 2026-09-28 RV-11a review caught a `.test.tsx` file.
- **An axe-clean run isn't an accessibility pass; also probe keyboard focus and 320 px reflow.** Open each overlay with Enter, close it with Escape and read `document.activeElement`; check `scrollWidth` and clipped controls at 320×640. axe can't flag an overlay that lacks a dialog role. Why: 2026-09-29 accessibility pass (axe found 2 of 6 defects).
- **E2E screenshots and files go to `test.info().outputPath(...)`, never repo or absolute paths.** Why: 2026-09-29 RV-13 and debt cleanup (scratchpad paths from an old session, `artifacts/rv-12e/`).
- **In test specimen and review pages, ensure no non-target element captures initial keyboard Tab focus, and preserve DOM order.** When tests assert keyboard focus on the first button (`page.keyboard.press("Tab"); await expect(firstButton).toBeFocused()`), focusable elements like `<details><summary>` before the target intercept focus, and matrix tables placed before the primary variant shift `getByRole('button').first()`. Why: 2026-09-30 design system specimen alignment.
- **Keep Storybook/browser test plugins decoupled from core Vite/Vitest configs.** The `@storybook/addon-vitest` or `storybookTest` plugin injects browser/Playwright runners into Vitest; keeping Storybook testing in a dedicated `vitest.storybook.config.ts` prevents standard `npm test` from being intercepted and failing with browser timeouts. Why: 2026-10-01 Storybook setup.

## Delegation and review

- **Check delegate output against source before integrating.** Delegates repeatedly got FIFO/reservation accounting, cancellation order and random draws wrong. Why: 2026-09-13.
- **Verify reviewer claims before applying them.** Reviewers have cited wrong callers and stale decisions. Why: 2026-09-22.
- **For UI lanes, probe the changed interaction in a browser before trusting a review.** A Sonnet review passed a multi-select change that cleared the selection; a 20-line Playwright probe caught it. Why: 2026-09-30 RV-20.
- **Headless agy won't respect command allow-lists or prompt-level shell limits; pick skip-permissions (with user approval), another executor, or a source-embedded patch-only prompt before dispatch.** Patch-only keeps implementation delegated without granting blanket shell access; the lead must apply, test and independently review it. Why: 2026-09-30 RV-20 and composite-board revalidation.
- **Self-reviewed corrections don't close a review.** Closure needs an independent reviewer (fresh session or subagent). Why: 2026-09-23 S05.
- **Start every executor prompt with "you are an executor: don't use /delegate or spawn agents".** AGENTS.md §2 tells every agent to delegate, and Codex started a nested `/delegate` run instead of implementing. Why: 2026-09-30 RV-19 lane.
- **Don't run `state.py dispatch` while any lane of the round is live.** It treats a `.pid` as orphaned and kills that lane. Re-dispatch only after the round has finished. Why: 2026-09-30.
- **If agy fails with `failed to create PTY`, check `lsof /dev/ptmx` before blaming the sandbox.** A leaking process had taken 509 of 511 PTYs. Why: 2026-09-30 (`traycer-host`).
- **Smoke-test an executor with a no-edit prompt before dispatching real lanes.** Why: 2026-09-23 preflight caught a blocked executor cheaply.
- **Reject invented defaults in delegate code.** Grep delegate diffs for fallbacks such as `?? 'unknown'`, `|| 'main'`, success inferred from a missing outcome, zero-filled counts, placeholder labels and `as unknown as` casts; the contract needs an explicit value or a typed rejection. Why: review rounds on 2026-09-24 (RV-14d/e/f, RV-08c/e, RV-16b), 2026-09-26 (RV-11a), 2026-09-28 (RV-05c).
- **Run each executor lane in its own git worktree and commit partial work.** Quota and rate-limit hits interrupted Gemini, Sonnet and Codex lanes about 10 times; intact worktrees let another executor resume. Why: 2026-09-24 → 2026-09-29.

## Workflow

- **On long tasks, record status in `ACTION_LOG.md`/`HANDOFF.md` as you go, not only at the end.** A session that runs out of tokens leaves work unrecorded. Why: 2026-09-23 Codex round.
- **Before deleting a branch, prove it is merged into the intended target with `git merge-base --is-ancestor <branch> <target>` (or `git cherry` for rebased work).** `git branch -d` only checks the current checkout, and this repo has no remote, so a deleted unmerged branch is gone. Why: 2026-09-29 cleanup.
- **In zsh, unquoted `$VAR` holding several paths is one word; loop over them explicitly.** A multi-file `cp`/`checkout` silently did nothing. Why: 2026-09-29 RV-17 before/after build.

## Code

- **Give every retried or redelivered kernel operation its own path (`~n`, `#n`).** Seeded draws are keyed by unit, path and attempt, so a reused path replays the same failure on every retry. Why: 2026-09-30 RV-25 (redelivery failed the same messages forever).

- **Build test and audit graphs through the app's own planners (`placeEntry`, `planConnection`), not hand-built records or `behaviorDefaults.ts`.** `behaviorDefaults` is test-only and differs from the catalog, and hand-built fixtures hide connect rules the canvas enforces. Why: 2026-09-30 realism phase 3 (phase 1 probed defaults the app never loads; G1 and B1–B8 surfaced only through the planners).

- **Don't split with `React.lazy`/Suspense on user-facing paths; use `src/lib/lazyComponent.tsx`, and time the affected interaction against a baseline build.** React 19 throttles Suspense reveals ~300 ms even for cached chunks. Why: 2026-09-29 bundle split made project open 830 ms.
- **Put element-level defaults in `src/styles.css` inside `@layer base`.** An unlayered `p`/`h3`/`select`/`button` rule beats every Tailwind utility on that element, so the classes silently do nothing. Why: 2026-09-29 board comparison (error text grey, all `p`/`h3` forced to 12 px, menu rows boxed).
- **Before deleting superseded code, port its tests to the replacement.** The ported budget tests exposed a status bug in the production runner. Why: 2026-09-29 logical runner retirement.
- **Assert `checkReadiness(...).ready` before `runScenario` in tests.** `runScenario` doesn't run readiness, so a scenario the app's Run would refuse can still pass. Why: 2026-09-30 RV-26 (S06 first draft had an unmodeled element in scope).
- **Run studio graphs under a workload as well as with finite inputs.** Without enabled workloads the kernel skips structural validation (`requireRunnable: false`), so S05's broker call route passed while the same graph under traffic threw. Why: 2026-09-30 RV-22.
- **In `ScenarioRunner` budget tests, account for the terminating attempt and the next step-boundary check.** `processedEvents` can include the attempt that crosses `maxEvents`, while an exact event count still needs headroom for the runner to observe quiescence. Why: 2026-09-30 RV-19 near-limit test needed two corrections.
- **Do not render Radix `DropdownMenu.Item` outside an active `DropdownMenu.Root`.** Radix throws at runtime if items are mounted statically or outside a menu context (`MenuItem must be used within Menu`); for static previews or declarative menu panels, render styled DOM elements with `role="menuitem"`. Why: 2026-09-30 dropdown component standardization.
- **When expanding a compact toolbar into an in-place multi-row container, handle nested drag-and-drop targets gracefully.** Dragging to the container from an outer or child element targets the container's geometric center (often landing in a middle shelf/row); ensure drop handlers differentiate item sources (e.g. moving dock item to shelf to hide vs dropping an available item anywhere on the dock to add) without dropping or swallowing events. Why: 2026-10-01 16C-4 dock expansion implementation.
- **Foundation-first UI edits: check `src/components/ui/` and tokens before styling feature code.** When changing borders, radii, shadows, surfaces, or states, update the foundation primitive so all views stay aligned; avoid local ad-hoc overrides in feature files. Verify with `npm run build-storybook`. Why: 2026-10-01 Dialog/QuickOptions and Component Discrepancy audits.
- **Do not combine `aria-pressed` with `role="tab"` on segmented or toggle elements.** WAI-ARIA and Axe treat `aria-pressed` on a `tab` as a critical `aria-allowed-attr` violation (tabs allow only `aria-selected`). For segmented tool switchers or toggle groups, default to `role="group"` with native buttons using `aria-pressed`, and reserve `role="tablist"`/`role="tab"` strictly for tabbed view switchers with `aria-selected`. Why: 2026-10-01 Canvas dock toolbar segmented toggle.
- **In panel actions and layout calculations, evaluate `effectiveLayout(state)` instead of stored preferences (`panel.collapsed === false`).** Responsive constraints can auto-collapse panels when viewport bounds or dock occupancy cannot fit them. In user actions (`OPEN`, `EXPAND`), evaluate effective layout visibility before early-returning, and dynamically clamp effective side widths to available space (`computeEffectiveSideWidth`) rather than letting oversized preferred widths push candidate panels permanently into the collapsed rail. Why: 2026-10-01 side panels at 1225px.
- **Do not bind ReactFlow's internal `onSelectionChange` directly to top-level app selection when an application enforces guarded navigation invariants (`Workspace.runGuarded`).** ReactFlow's internal store fires `onSelectionChange` on every single click/drag, which will unintentionally wipe out Shift+click multi-selections and fight with the navigation guard. Instead, capture marquee box selection gestures specifically between `onSelectionStart` and `onSelectionEnd`, translating the captured placement IDs to element IDs on gesture release. Why: 2026-10-01 marquee selection vs Shift+click guard conflict.
- **Give every cmdk `Command` list an explicit word-prefix `filter`.** cmdk's default scoring is a subsequence match, so a short query like "note" matched nearly every row. Why: 2026-10-02 Quick options search.
- **Typecheck with `npx tsc -b`, not `tsc --noEmit -p .`.** The root tsconfig is solution-style, so `-p .` passes without checking `src/`. Why: 2026-10-02 checkpoint removal (the false pass hid six test type errors).
