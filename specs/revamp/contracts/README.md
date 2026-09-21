# Contract register

All contracts remain planning artifacts under the 2026-09-22 implementation hold. A reviewed delivery plan and an implementation-ready contract are distinct acceptance levels; see [review plan](../review-plan.md).

| Contract | Current artifact/status | Owner and acceptance gate |
|---|---|---|
| Canonical run identity | [run-identity.md](run-identity.md), revised draft | Codex authors; Claude reviews projection/closure/lifecycle; implementation golden vectors before runner acceptance |
| Atomic commands/history | [transactions.md](transactions.md), revised draft | Codex authors; Claude reviews CAS/state transitions/reference integrity |
| Five-family semantics | [execution-slices.md](execution-slices.md), draft | Codex authors; Claude verifies bounded fixtures and retained/new kernel partition |
| Foundation accessibility | [foundation-accessibility.md](foundation-accessibility.md), measured planning evidence | Claude review; actual computed-style/browser acceptance in RV-01 |
| Current document/schema and runner bridge | Not frozen | RV-02d: explicit TypeScript-shaped records/unions, relationship/port/refinement validators, all-field projection inventory, supported versions, finite-input/per-root kernel adapter and S05 scheduler bridge interfaces |
| Storage/portable/limits | Not frozen | RV-02e: one transaction-capable database namespace, table keys/references, portable version, measured fixture-size and trace budgets, quota recovery, operation retention and unsupported-format handling |
| Commands/panels/inspector | Not frozen | RV-02f: stable command IDs and shortcut collisions, placement reducer events, draft adapter interface, typed availability/errors, phone transitions |
| Parts/export | Not frozen | RV-02g: capture/remap inclusion/limits, current part format, CSV quoting/formula policy and Mermaid lossy mapping |

RV-02d/e/f/g are documentation/contract tasks owned by Codex with Claude review, not implementation. They must finish before the relevant future package is declared executable. No implementing agent may invent missing schema versions, limits or command semantics. Concrete shared TypeScript source creation is a later Gemini assignment after user hold release and contract acceptance.

Schema/storage dependency order: document fields → canonical executable projection → fixture-size measurement → budgets/current storage version → exact repository API. Run/transaction drafts can be reviewed in parallel but cannot be finally frozen against an unknown document schema. Existing source `executionSignature` is a worker reset string, not canonical versioned evidence; its array-order dependence and narrower old-model projection prohibit reusing it as the new run hash.
