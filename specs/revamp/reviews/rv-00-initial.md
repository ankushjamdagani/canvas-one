# RV-00 initial review disposition

Reviewer: Claude Sonnet 4.6, actual CLI session 8739, exited 0. Reviewed planning/source; no implementation or test execution. This is a coordinator summary, not verbatim output. Full design/source coverage receives a follow-up review.

| Finding | Lead disposition |
|---|---|
| CR-1: D21 must receive another user confirmation | Rejected approval gate. User assigned architectural decisions to Codex; one document/model-view separation implements confirmed scope. D21 recorded as lead decision, contracts still peer-reviewed. |
| CR-2: partition existing/new execution capabilities | Accepted for RV-02. Frontend state/data transforms/fault scheduling are explicit new runtime work; existing timed accounting is reused. |
| CR-3: canonical execution fingerprint unspecified | Accepted RV-02 deliverable; draft `contracts/run-identity.md` now gives encoding/projection/lifecycle. Not a blocker for independent UI tokens. |
| CR-4: diagram path active and retirement unowned | Corrected: no production callers of `useScenario` found by graph/source search. Legacy scenario branches remain and need retirement. RV-15 scope now explicitly names symbols; RV-12 serializes shared file edits. |
| H-1: publication CAS needs a revision column | Accepted transactional CAS requirement; an index/column migration in old storage is unnecessary. New record schema plus read-check-write transaction is specified in `contracts/transactions.md`. |
| H-2: stable IDs need inventory | Accepted. Current UUID constructors/round trips provide evidence; new current-only validators enforce uniqueness and clone remapping. No old-data conversion required. |
| H-3: undo-publish transition table missing | Accepted and drafted. Reviewer's old-format-loss example is inapplicable under D19; descendants and multi-tab races remain real cases. |
| H-4: inspector base revision ambiguous | Accepted. Conservative authored-document revision explicitly chosen; unrelated authored edits can produce visible stale state, no silent overwrite. |
| M-1/M-2/M-4: command IDs, storage budgets, provenance | Accepted contract work. Provenance draft added; numeric budgets still need fixture evidence. |
| M-3: revisions.ts unaccounted | Accepted. Live editor/persistence/RevisionsPanel consumers verified; retain useful capability until replacement and then retire implementation. |
| L-1/L-3: inspector/integration and acceptance dependencies | Corrected delivery prose: RV-02 owns API definition; RV-12 wiring; RV-13 explicitly requires RV-14. |
| L-2: CSV injection policy | Accepted exporter contract work before RV-10. |

Source validation used existing graphify query, read-only scout and lead direct reads of editor/revisions/persistence. Scout output is navigation evidence, not substitute for source checks. No new application tests ran.

Follow-up Claude session 34863 exited 0 and explicitly cleared bounded RV-01a config/tokens/Button/Input/Badge. Foundation may proceed without claiming full RV-00 acceptance. Reviewer did not inspect original HTML in this pass; visual foundation acceptance still requires source/reference comparison and measured contrast. Its claim that active revisions.ts can never be retired is rejected: preserve the capability, then replace superseded implementation when the new history is integrated. No deletion is currently authorized by RV-01a. Fonts and field composites are subsequent RV-01 slices, not additions to RV-01a ownership.
