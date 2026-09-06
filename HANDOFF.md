# Development checkpoint

## Milestone 1 — domain and simulation
- Empty project inspected; selected user reference is light docked workspace A.
- Stable dependency versions verified against npm registry; exact versions recorded in package.json/lockfile.
- Independent graph domain, validation, deterministic discrete-event engine, worker protocol, Dexie repository and Zustand editor authored.
- Model: seeded Poisson arrivals; deterministic serial service time 1/capacity; bounded FIFO queues; global request deadlines; 8 ms response overhead; deterministic per-request cache hits on a separate random stream. Cache has its own capacity and queue. Timed-out active work occupies its server until completion; expired queued work is discarded. Window ends at configured duration with in-flight requests explicitly counted.
- User requested Git milestone commits; repository initialization requires sandbox escalation and is next.

## Resume
1. `npm install` if needed; `npm test` to verify engine and import/export.
2. Build React Flow workspace, inspector, controls, metrics, project/checkpoint UI and worker hook.
3. Run `npm run build`; launch `npm run dev`; verify journey with Playwright and visual desktop/mobile inspection.
4. Update this file and commit each meaningful milestone. No remote push or deployment.

## Decisions
Only linear traffic → service → optional cache → database graphs execute in this milestone. Unsupported editor graphs remain editable with explicit validation. Expansion of internals is future work and must preserve simulation semantics.

## Milestone 2 — working docked workspace
- Canvas nodes/connections editable with keyboard deletion; unsupported paths disable Run and explain repair. Undo/redo, configurable component properties and workload settings.
- Worker run/pause/reset/replay, observed metrics, queue chart, request accounting and previous-run comparison.
- Dexie autosave, named local project switcher, JSON import/export, manual checkpoints plus automatic before/after-cache snapshots.
- Self-hosted Inter, Lucide line icons, light docked design matching selected reference; responsive small-screen stacking.
- Verification: `npm test` passed 9 tests; `npm run build` passed. Initial bundle is ~503 KB minified (160 KB gzip); optional chunk splitting remains a performance improvement.
- Preview running at http://localhost:5173/.
- Next: browser journey tests and screenshot review, fix functional/visual findings, commit verified milestone.

## Milestone 3 — verified prototype (current)

Completed the first working milestone. The latest commit contains final fixes and these handoff documents; no remote push or deployment.

### Git checkpoints
- `c4feeb1`: independent domain, simulation engine, worker, persistence and editor state.
- `91ad86a`: docked UI, replay, metrics, local projects and browser journeys.
- Final milestone: canvas framing, mobile checkpoint access/readability, connection selection/deletion, persisted viewport restoration, formatted source, portable unfinished drafts, documentation and verification screenshots.

### Verification and evidence
- `npm test`: 10 simulation/persistence tests pass.
- `npm run build`: passes TypeScript and production bundling.
- Playwright: four journeys pass (full experimental replay, persistence/import/export/editor controls, mobile access, connection deletion and saved viewport). Matching Chromium runtime installed.
- Independent visual finish review: **Pass**, all five identified material items resolved. DESIGN.md and .impeccable sidecar document the implemented system.
- Exact observed run table and screenshots: `artifacts/VERIFICATION.md`, `artifacts/desktop-overload.png`, `artifacts/desktop-cache.png`, `artifacts/mobile-baseline.png`.
- 700 req/s, seed 42, 30 seconds: same 20,845 generated requests in both runs. No cache: 14,995 successes, 5,346 rejections, p95 1,010.5 ms. Cache: 20,837 successes, zero rejections, p95 11.4 ms, database arrivals 140.8/s. In-flight counts explicitly reconcile totals.

### Start/resume
1. Worktree: `/Users/ankushjamdagani/personal/system-design-planner`.
2. `npm ci` if dependencies are absent, then `npm run dev` (preview http://localhost:5173/; confirmed HTTP 200 at handoff).
3. Read README.md for model semantics and editing controls, PRODUCT.md for user commitments, DESIGN.md for visual authority.
4. Run `npm test`, `npm run build`, `npm run test:e2e` for verification. Browser runtime install: `npx playwright install chromium`.
5. Preserve the selected light docked design. Treat nested subsystem expansion as presentation over explicit modeling, never a silent replacement.

### Future work (not required to use this milestone)
- Expand model support deliberately beyond the supported single linear request path, with corresponding validation and engine tests.
- Add nested subsystem presentation without changing model semantics.
- Consider main bundle splitting (~505 KB minified / 161 KB gzip) and larger-workload profiling before adding more simulation complexity.
- More comprehensive keyboard/screen-reader audits and additional browser coverage; current tests use Chromium and basic accessible controls, not a formal conformance audit.
- Simulation results are not persisted; local projects save model, settings, viewport and named checkpoints only. No cloud sync.
