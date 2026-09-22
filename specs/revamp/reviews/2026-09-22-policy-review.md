Reading complete. Checking all seven policy points against each file.

---

## Review findings

### D26 — No publication undo
Consistent across all four files. `transactions.md` history table has no undo-publication row; "No undo-publication command, compensation record or main-rewind action exists." R08 states "corrections use new verified commits/publications." No contradiction.

### D27 — Both commit and publish require passing checks
Consistent. `run-identity.md`: "Only `completed` local evidence with every configured check evaluated and passing may satisfy D20/D27." `transactions.md` table Commit row and Publish row both gate on this. "Deliberately modeled failure can qualify when its checks correctly assert the expected failure outcome" matches the policy's "expected failure scenarios can pass checks asserting their expected outcomes." No contradiction.

### D28 — Every configured scenario; no subset selector; at least one; empty-check is RV-02d gate
Consistent. `run-identity.md`: "No required-subset or disabled-scenario bypass exists; an incomplete configured scenario blocks eligibility." "No-check/empty-check scenarios cannot display passing verification: RV-02d must define non-vacuous success criteria before implementing eligibility." This correctly treats RV-02d as a pre-existing gate, not a new defect. No contradiction.

### D25 — Dirty draft blocks Run; Apply or Cancel; no bypass; whole-sequence ours/theirs/edit

**DEFECT — stale cross-reference.** `decisions.md` D25 line 31 reads:

> "Supersedes Run applied version option. Library interaction is separately pending D30."

D30 was confirmed 2026-09-22 in the same document (line 36): "Library commands focus/expand the existing single instance." The "separately pending D30" text is now stale and will mislead implementers into treating D30 as open.

The rest of D25 is consistent. `transactions.md`: "there is no last-applied-version bypass." R06: "No Run applied version bypass, implicit Apply, or silent discard." Whole-sequence conflict in `transactions.md`: "A sequence conflict offers keep ours, keep theirs, or edit the ordered sequence using normal validated controls" — all three options the policy requires are present.

### D23 — Preserve inspector; collapse LRU auxiliary panel; accessible notice
Consistent in `decisions.md` and R04. `transactions.md` (RV-02b) does not address panel layout — expected, as RV-02f is the pending gate for numeric breakpoints/geometry. Pre-existing deferred gate, not a new defect.

### D29 — Source branch closes by default atomically; can reopen; failed publish leaves it open
Consistent. `transactions.md` Publish candidate row: "close source branch by default in one transaction" (atomic). "source stays open on failure." R08: "Failure/cancel leaves branch closure unchanged." Reopen row: "does not change main or any publication." `decisions.md` lead defaults: "Optional keep-open selection, if exposed, defaults off under D29." No contradiction.

### D30 — Single Library instance; all entry commands focus/expand
Consistent in R07 and D30 as recorded. The defect is the stale forward-reference in D25 described above, not in D30's own text.

---

## Verdict: REVISE

Single concrete defect requiring correction:

**`decisions.md` D25 (line 31)** — Remove or replace "Library interaction is separately pending D30." D30 is confirmed in the same document. Leaving it implies D30 is still open, which is incorrect and creates an implementation risk.

No other contradictions found across the seven policy choices. All pre-existing RV-02 gates (d empty-check, e entity limit, f panel geometry, g Mermaid escaping) remain correctly deferred and are not defects introduced by D25–D30.
