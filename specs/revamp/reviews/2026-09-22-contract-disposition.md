# Detailed contract review disposition

Implementation hold remains. Initial four-contract draft checkpoint: 1697d42.

## First pass

- UI/transfer Claude Sonnet 4.6 review returned exit 0, REVISE, CP-1–7 and PE-1–7. Explicit command context/shortcut types, pre-transition draft guards, placement index/reset/singleton rules, enumerated reference remapping and export enums/encoding clarify all requested items in the revised drafts. These are lead corrections awaiting closure, not an unearned PASS.
- PE-1/2/3 requested individual reference enumeration; the original already required all schema-owned references to remap. Accepted enumeration as useful coverage evidence, not evidence that implemented copying had lost data (there is no implementation).
- UI report's opening claim that prior review reports were empty is inaccurate: historical P1–P4/policy reports exist. The simultaneously running core output was empty. Its final “four Severity 2” count lists six items. Raw report remains unchanged; neither editorial error changes substantive corrections.
- Core attempt timed out at 300 seconds, exit 124, empty output. Its process group was terminated and waited for; no findings or acceptance inferred. Retry is split into bounded schema/runner and storage reviews. Prompts, actual state and input hashes are preserved.

## Lead source/contract checks

- src/simulation/open/kernel.ts scheduleNextArrival rejects times strictly greater than duration; arrival at horizon is included. Corrected new draft's erroneous strictly-before phrase.
- Added record/list Value constructors, explicit machine call-response bindings and timer/reply effects, pipeline/resource entry ports, causal invocation rules and closed result records. These are new proposed grammar details requiring core review, not presumed executable behavior.
- Added schema dependency manifest field, source/main cleanliness and revision requirements, full authored-export size invariant and recovery operations at receipt cap.
- Added [rollout protocol](../work/contract-rollout.md): RV-16a repository base precedes durable versioning acceptance; pure independent lanes remain possible. No Gemini preflight or implementation is claimed.

## Resumed review results

The prior schema review returned REVISE (eight findings); storage and UI closure attempts timed out at 300 seconds without output. Their state/report files are retained. A second broad schema attempt also timed out; no approval is inferred. Subsequent reviews used embedded frozen artifacts with tools disabled and bounded process groups. No delegate was permitted to edit files. All processes are now terminal.

| Scope | Final evidence | Lead disposition |
|---|---|---|
| UI/parts, CP-1–7 and PE-1–7 | [UI r2](2026-09-22-contract-ui-r2-report.md), PASS | All 14 original findings closed. Accept this scoped review, not its broader assertion that all implementation dependencies are ready. |
| Schema D1–D8 | [schema closure](2026-09-22-contract-schema-closure-report.md), PASS | Explicit request bindings, separate call/application identities, same-worker plan handles, response schemas, decision entry ports, row errors, completion-mode validation and metric subjects now specified. Logical afterInputId scheduling also passed. |
| Storage D1/D2 | [gates closure](2026-09-22-contract-gates-closure-report.md), PASS | Initial snapshot explicitly pinned; terminal timestamps non-null. Added retained-run snapshot protection and explicit evidence pin definition. |
| Delegation F1–F4 | [delegation findings](2026-09-22-contract-delegation-r2-report.md), then [closure](2026-09-22-contract-gates-closure-report.md), PASS | Exact RV-14a–f dependency for RV-08d, unconditional d/e serialization and named EXEC-PREFLIGHT gate. F2's claim RV-05 did not exist was incorrect: it already existed in tasks.md/delivery-plan.md, omitted from that focused prompt. Added explicit cross-reference rather than duplicate ownership. |

Other lead corrections: initialSnapshotId is now a real project/export field; S03 permits explicit scalar-union external values and preserves typed row provenance; finite resource inputs/bridge connections declare routing and deadline metadata; CSV enum paragraph moved into its correct section. Source/dependencies/tests remain unchanged from fb4a1ff.

Review transport: schema/storage/UI r2 and delegation r2 used Claude Sonnet 4.6, tools disabled, no session persistence, 300-second bound. Final gates/schema closure additionally requested medium effort. Each exact embedded prompt is saved; state files record input hashes/base/PID/timing/status. Base commit alone does not identify uncommitted reviewed drafts; use embedded prompt content and hashes. Later edits invalidate only the affected review scope.

## Remaining contract freeze evidence

Known findings above are closed; full RV-02 is not yet ACCEPTED. Before final freeze, author and independently inventory complete S01–S05 serialized fixtures, measure canonical byte sizes and budget headroom, and reconcile the consolidated closed schemas. The latter must include publication-form metadata from decisions.md (version/title/rationale/ticket) and the exact per-command payload/result inventory currently described by registry rows. These are existing RV-02d/e/f deliverables, not new product scope and not permission for an implementer to guess.

Runtime performance, browser panel behavior and parser/spreadsheet tests are future implementation acceptance checks. Conservative specified ceilings are not measured runtime guarantees. Claude's “ready for implementation hold lift” is a reviewer's scoped conclusion, not user authorization or completion of the remaining fixture/schema gates.
