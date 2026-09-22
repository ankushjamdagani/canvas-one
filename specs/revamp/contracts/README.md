# Contract register

All contracts remain planning artifacts under the 2026-09-22 implementation hold. A reviewed delivery plan and an implementation-ready contract are distinct acceptance levels; see [review plan](../review-plan.md).

| Contract | Current artifact/status | Owner and acceptance gate |
|---|---|---|
| Canonical run identity | [run-identity.md](run-identity.md), revised draft | Codex authors; Claude reviews projection/closure/lifecycle; implementation golden vectors before runner acceptance |
| Atomic commands/history | [transactions.md](transactions.md), revised draft | Codex authors; Claude reviews CAS/state transitions/reference integrity |
| Five-family semantics | [execution-slices.md](execution-slices.md), draft | Codex authors; Claude verifies bounded fixtures and retained/new kernel partition |
| Foundation accessibility | [foundation-accessibility.md](foundation-accessibility.md), measured planning evidence | Claude review; actual computed-style/browser acceptance in RV-01 |
| Current document/schema and runner bridge | [document-and-runner.md](document-and-runner.md), review draft | RV-02d: closed records/unions, port/refinement validation, projection inventory and causal runner interfaces; core review required |
| Storage/portable/limits | [storage-and-limits.md](storage-and-limits.md), review draft | RV-02e: namespace/tables, proposed v9 portable schema, product ceilings and retention; measured fixture sizing remains a separate acceptance gate |
| Commands/panels/inspector | [commands-and-panels.md](commands-and-panels.md), revised after first UI review | RV-02f: stable commands/types, placement reducer, draft adapter, numeric responsive transitions; closure review required |
| Parts/export | [parts-and-export.md](parts-and-export.md), revised after first UI review | RV-02g: capture/remapping/limits and transfer/CSV/Mermaid contracts; closure review required |

RV-02d/e/f/g are documentation/contract tasks owned by Codex with Claude review, not implementation. They must finish before the relevant future package is declared executable. No implementing agent may invent missing schema versions, limits or command semantics. Concrete shared TypeScript source creation is a later Gemini assignment after user hold release and contract acceptance.

Schema/storage dependency order: document fields → canonical executable projection → fixture-size measurement → budgets/current storage version → exact repository API. Run/transaction drafts can be reviewed in parallel but cannot be finally frozen against an unknown document schema. Existing source `executionSignature` is a worker reset string, not canonical versioned evidence; its array-order dependence and narrower old-model projection prohibit reusing it as the new run hash.
