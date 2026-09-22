# Detailed contract rollout and delegation checks

Planning only, 2026-09-22. No owner is authorized to implement. Read [review plan](../review-plan.md) before any dispatch. This refines the high-level delivery graph without adding product scope.

## Contract review checkpoint

Draft checkpoint `1697d42` contains RV-02d/e/f/g; subsequent corrections have targeted Claude PASS results for schema, storage, UI/transfer and delegation findings. Read [current disposition](../reviews/2026-09-22-contract-disposition.md) for exact scope and remaining schema/fixture gates. Reports, embedded prompts, input hashes and terminal process states are under `../reviews/2026-09-22-contract-*`. A draft checkpoint or scoped closure PASS does not make every package executable.

## Implementation dependency order after release of the hold

1. **Shared schema checkpoint**: Gemini implements only accepted document/command/result schemas and validators, plus exhaustive reference/projection metadata and golden fixtures. Exact new paths/tests are assigned by Codex; no editor integration. Claude verifies closed types, discriminated unions and S01–S05 representability. Do not assign consumer code in parallel with changing these types.
2. **Independent lanes**: foundation, pure compiler/runner contracts, and local repository base can proceed only with disjoint exact files. Three is a ceiling, not a requirement to keep three agents occupied.
3. **RV-16a repository base**: new namespace/table keys, immutable snapshot storage, command CAS/receipts, preference CAS, import namespace and quota failures. One owner holds DB configuration. Pure versioning tests can use an accepted repository port; durable RV-08a acceptance requires the real RV-16a adapter. This removes the apparent cycle between RV-08e and the broad RV-16 package.
4. **RV-14a manifest/evidence**: compiler and run envelope fixtures precede RV-08a eligibility consumers. They do not certify real run outcomes. RV-14b/c run independently; retained kernel RV-14d then faults RV-14e stay serialized; S05 RV-14f joins them.
5. **UI lanes**: shell/panel reducer, canvas/dock, inspector/library/results use accepted typed fixtures with no production pretend actions. A reviewer may accept component behavior but must mark product integration pending. Commands with missing adapters stay unavailable with reasons.
6. **Versioning lane**: RV-08a/b/c can develop after shared schema, evidence interface and repository ports; actual candidate-run gate RV-08d waits for relevant runner slices, and final acceptance requires all S01–S05. RV-08e integrates only after RV-16a transaction tests. RV-16b is recovery/import/export integration, not remote sync implementation.
7. **Integration slots**: reserve exact shared-file subset and dependency commit hashes per RV-12 slice. Integrate accepted code only. No second writer in another worktree touches the same shared files concurrently. Schema cutover/legacy retirement wait for replacement acceptance, not merely source compilation.

## Bounded brief requirements

Each Gemini brief includes one concrete checkpoint, exact owned files/test paths, accepted contract hashes, fixture IDs, exclusions, commands permitted for validation, and stop conditions. For example, a machine interpreter assignment excludes kernel, persistence and App; a repository assignment excludes frontend and compiler. “Implement RV-14” is not a valid bounded brief. Codex remains the only writer to task ledger/HANDOFF/ACTION_LOG.

Each Claude implementation review receives actual diff/base, full test outputs and relevant accepted contract hashes. A review is not tasked with silently implementing repairs. Codex checks claimed evidence and assigns any fix as a new bounded task to Gemini. A new semantic finding returns to Codex planning; the junior engineer does not invent missing behavior.

Read-only review process preflight is proven by actual returned reports; Gemini's implementation preflight is still **not proven**. Before any future write dispatch, perform a task-scoped no-edit read/ownership acknowledgement and an interruption/timeout rehearsal, then confirm intended write permissions/test commands. Do not reuse the previous headless exit-0 permission-denial as success. No blanket global tool grants.

## Remaining evidence classes

Contract prose can establish types, policies and limits. Concrete fixture-size measurements are needed before accepting the storage budget gate; runtime memory/latency, mobile/browser geometry, Mermaid parser and spreadsheet-reader tests occur only after the corresponding implementation exists. Never relabel future checks as passed. Each gate records its own status, so a slow core package does not prevent planning or reviewing an independent UI slice.
