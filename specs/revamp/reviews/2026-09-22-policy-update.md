# User policy update after P4

The P4 verdict applies to the earlier baseline, not these revised product semantics. Implementation remains on hold. This document records the delta for a focused senior review.

- D26: no Undo publish, compensating publication or main rewind. Corrective work follows normal new commits/publications.
- D27: both commits and publications require completed passing checks. Change the system or checks and rerun when checks fail. Expected failure scenarios can pass checks asserting their expected outcomes.
- D28: every configured scenario must qualify; no required-subset selector or disabled-scenario bypass. Scenario inventory comes from the immutable candidate. At least one scenario remains required; empty-check verification policy is a concrete RV-02d contract gate, not a fabricated passing badge.
- D25: dirty configuration drafts block starting Run until Apply or Cancel; no run-last-applied bypass or automatic Apply. Conservative whole-sequence conflict resolution is confirmed.
- D23: preserve active inspector and collapse least recently used auxiliary panel when space is insufficient, with notice.
- D29: source branch closes by default atomically on publication success; it can reopen while preserving published history. Failed publish does not close it.
- D30: decision register directly records confirmed single Library instance; all entry commands focus/expand it. Preserve that user edit rather than asking again.

Historical reports remain unchanged as audit evidence. Current requirements, technical/execution contracts, delivery gates and HANDOFF supersede their earlier completion-only/undo proposals. No application code or dependencies changed. Unrelated untracked `debby.md` is excluded from the task.

## Focused review disposition

Claude Sonnet 4.6 returned **REVISE**, exit 0; see [unaltered report](2026-09-22-policy-review.md), [prompt](2026-09-22-policy-review-prompt.txt) and [process state](2026-09-22-policy-review-state.json). Its sole finding was D25's stale statement that D30 was pending. Codex replaced it with a reference to confirmed D30 and checked the active documents. The review found no other contradictions introduced by these policy choices. This is a lead-verified correction, not a subsequent Claude PASS. Detailed RV-02d/e/f/g contracts remain unfrozen; implementation remains on hold.
