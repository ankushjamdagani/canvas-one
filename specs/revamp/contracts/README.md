# Contract register

All contracts remain planning artifacts under the 2026-09-22 implementation hold. A reviewed delivery plan and an implementation-ready contract are distinct acceptance levels; see [review plan](../review-plan.md).

| Contract | Current artifact/status | Owner and acceptance gate |
|---|---|---|
| Canonical run identity | [run-identity.md](run-identity.md), revised draft | Codex authors; Claude reviews projection/closure/lifecycle; implementation golden vectors before runner acceptance |
| Atomic commands/history | [transactions.md](transactions.md), revised draft | Codex authors; Claude reviews CAS/state transitions/reference integrity |
| Five-family semantics | [execution-slices.md](execution-slices.md), draft | Codex authors; Claude verifies bounded fixtures and retained/new kernel partition |
| Foundation accessibility | [foundation-accessibility.md](foundation-accessibility.md), measured planning evidence | Claude review; actual computed-style/browser acceptance in RV-01 |
| Current document/schema and runner bridge | [document-and-runner.md](document-and-runner.md), D1–D8 closure PASS | RV-02d: consolidate complete schema and inventory S01–S05 serialized fixtures before final freeze |
| Storage/portable/limits | [storage-and-limits.md](storage-and-limits.md), storage findings closure PASS | RV-02e: publication metadata consolidation and measured fixture sizing remain acceptance gates; ceilings are proposed |
| Commands/panels/inspector | [commands-and-panels.md](commands-and-panels.md), CP-1–7 closure PASS | RV-02f: per-command closed payload/result inventory still required before consumer dispatch; browser verification later |
| Parts/export | [parts-and-export.md](parts-and-export.md), PE-1–7 closure PASS | RV-02g: remapping depends on final document-schema freeze; parser/spreadsheet/browser verification later |

RV-02d/e/f/g are documentation/contract tasks owned by Codex with Claude review, not implementation. They must finish before the relevant future package is declared executable. No implementing agent may invent missing schema versions, limits or command semantics. Concrete shared TypeScript source creation is a later Gemini assignment after user hold release and contract acceptance.

Latest exact review scope and outstanding gates: [contract disposition](../reviews/2026-09-22-contract-disposition.md). [Fixture mapping](fixture-mapping.md) is a planning inventory, not executed fixture evidence. Targeted reviewer PASS closes the named findings; it does not silently accept unmeasured limits or lift the user hold.

Schema/storage dependency order: document fields → canonical executable projection → fixture-size measurement → budgets/current storage version → exact repository API. Run/transaction drafts can be reviewed in parallel but cannot be finally frozen against an unknown document schema. Existing source `executionSignature` is a worker reset string, not canonical versioned evidence; its array-order dependence and narrower old-model projection prohibit reusing it as the new run hash.
