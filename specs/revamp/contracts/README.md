# Contract register

All contracts remain planning artifacts under the 2026-09-22 implementation hold. A reviewed delivery plan and an implementation-ready contract are distinct acceptance levels; see [review plan](../review-plan.md).

| Contract | Current artifact/status | Owner and acceptance gate |
|---|---|---|
| Canonical run identity | [run-identity.md](run-identity.md), revised draft | Codex authors; Claude reviews projection/closure/lifecycle; implementation golden vectors before runner acceptance |
| Atomic commands/history | [transactions.md](transactions.md), revised draft | Codex authors; Claude reviews CAS/state transitions/reference integrity |
| Five-family semantics | [execution-slices.md](execution-slices.md), draft | Codex authors; Claude verifies bounded fixtures and retained/new kernel partition |
| Foundation accessibility | [foundation-accessibility.md](foundation-accessibility.md), measured planning evidence | Claude review; actual computed-style/browser acceptance in RV-01 |
| Current document/schema and runner bridge | [document-and-runner.md](document-and-runner.md), D1–D8 closure PASS; S01–S05 fixtures PASS (S05 after bridge-frame corrections) | RV-02d: ready to freeze; runtime golden vectors are implementation acceptance |
| Storage/portable/limits | [storage-and-limits.md](storage-and-limits.md) + [publication-metadata.md](publication-metadata.md), closure PASS; [fixture sizing](../fixtures/size-review.md) PASS | RV-02e: ceilings frozen for implementation validation; runtime/quota measurement is implementation acceptance |
| Commands/panels/inspector | [commands-and-panels.md](commands-and-panels.md) + [command-inventory.md](command-inventory.md), CP-1–7 and inventory closure PASS | RV-02f: browser verification during implementation |
| Parts/export | [parts-and-export.md](parts-and-export.md), PE-1–7 closure PASS | RV-02g: remapping depends on final document-schema freeze; parser/spreadsheet/browser verification later |

RV-02d/e/f/g are documentation/contract tasks owned by Codex with Claude review, not implementation. They must finish before the relevant future package is declared executable. No implementing agent may invent missing schema versions, limits or command semantics. Concrete shared TypeScript source creation is a later Gemini assignment after user hold release and contract acceptance.

Latest exact review scope and outstanding gates: [contract disposition](../reviews/2026-09-22-contract-disposition.md). [Fixture mapping](fixture-mapping.md) is a planning inventory, not executed fixture evidence. Targeted reviewer PASS closes the named findings; it does not silently accept unmeasured limits or lift the user hold.

Schema/storage dependency order: document fields → canonical executable projection → fixture-size measurement → budgets/current storage version → exact repository API. Run/transaction drafts can be reviewed in parallel but cannot be finally frozen against an unknown document schema. Existing source `executionSignature` is a worker reset string, not canonical versioned evidence; its array-order dependence and narrower old-model projection prohibit reusing it as the new run hash.
