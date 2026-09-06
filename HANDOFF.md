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
