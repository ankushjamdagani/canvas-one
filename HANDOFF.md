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
