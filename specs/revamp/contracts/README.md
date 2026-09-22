# Contracts (RV-02)

Implementation-level specs. They are planning artifacts: no TypeScript exists yet, and the user's implementation hold still applies. Every named review finding is closed ([review history](../reviews.md)).

| Contract | Covers |
|---|---|
| [model-and-runner.md](model-and-runner.md) | `studio-model/1` schema, behaviors, scenarios, runner/kernel interface, results, S01–S05 reference scenarios |
| [run-identity.md](run-identity.md) | Canonical encoding, execution fingerprint, run lifecycle, commit/publish eligibility |
| [transactions.md](transactions.md) | Command boundary, revisions and compare-and-set, inspector Apply, history transitions, three-way merge |
| [storage.md](storage.md) | Tables, portable bundle v9, publication metadata, repository API, limits, retention |
| [commands.md](commands.md) | Command registry, every payload/result, draft lifecycle, panel geometry and layering |
| [parts-and-export.md](parts-and-export.md) | Saved parts, and JSON/SVG/PNG/CSV/Mermaid export |

Accessibility token decisions are in [design.md](../design.md#accessibility-corrections). Fixtures and size measurements are in [fixtures/](../fixtures/README.md).

## Rules

- Implementers must not invent schema versions, limits or command semantics that are missing here. They stop and ask.
- Dependency order: document fields → execution projection → size measurement → budgets and storage version → repository API. Consumers are built only after the shared types they use are frozen.
- A contract PASS doesn't cover runtime behavior. Golden hash vectors, runtime traces, browser geometry, Mermaid parsing, spreadsheet readers, quota, memory and latency are checked when the matching code exists ([verification.md](../verification.md)).
