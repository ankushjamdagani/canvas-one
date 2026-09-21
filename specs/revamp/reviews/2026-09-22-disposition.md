# Multi-review disposition

Codex lead disposition of three independent Claude Sonnet 4.6 read-only reviews. Raw outputs are preserved alongside this file; they contain some incorrect claims, corrected below. No reviewer implemented code or ran app tests. User implementation hold remains absolute.

## P1 requirements

| Findings | Disposition / evidence |
|---|---|
| F01 Undo publish is invented | Source claim rejected: original Directions HTML contains `Undo publish` inside `data-screen-label="22D published"`, verified directly. Scope confirmation still useful under D03; D26 question sent. Draft compensation remains conditional pending answer. |
| F02 inspector occupancy | Settled as D23 lead UX decision consistent with dedicated inspector and confirmed adaptive panels. Numeric widths/breakpoints gated in RV-02f. No new feature or extra user approval required. |
| F03 dirty Run | Accepted gap; R06/D25 now explicitly offer Apply and Run, Run applied version, Cancel. No implicit mutation/discard. |
| F04 ordered merge | Existing conservative technical choice made explicit in D25/transaction UI contract: compare base/ours/theirs, select a side or edit validated sequence. No guessed interleaving or forced raw JSON retyping. |
| F05 workload editing | Accepted; R06 explicitly preserves rate/profile/timeout/classes/tags/key-distribution editing with draft validation and round-trip/undo coverage. |
| F06 dark preference | D24 clarifies confirmed Evergreen paper as light-only. No basis for adding dark mode or asking another palette question. |
| F07 specific fixtures | R13 links execution-slices as normative acceptance examples. |
| F08 Mermaid useful subset | R10 now specifies topology/labels/representable boundaries and explicit omitted fields. Exact escaping remains RV-02g. |
| F09 single library instance | R07/D25 focus/expand existing instance from all entry points; no duplicate picker. |
| F10/F11 accessibility and panel undo | RV-09 includes R11; R04 clarifies graph undo exclusion and Escape cancellation. |

## P2 architecture

| Findings | Disposition / evidence |
|---|---|
| Prior B1 view preferences | Correctly closed: separate preferences repository/token, authored layout still content. |
| Prior B2 scope closure | Reviewer's cited S05 delivery ordering is not closure evidence. Actual correction is fixed-point potential dependency closure, typed boundaries and rejection of missing references in run-identity.md. P4 must check that text directly. |
| H1 resource adapter interface | Accepted pre-dispatch contract deliverable in RV-02d. Aggregate metrics adapter is insufficient; no implementation until finite-input/per-root interface is frozen. |
| H2 outage active/queued fixtures | Added explicit times/counts plus equal-time outage/completion case to execution-slices.md. |
| H3 S05 scheduler bridge | Gate tightened: conceptual interface must be frozen in RV-02d before dependent runtime work; actual integration follows accepted S01–S04 implementations. Do not wait until after incompatible implementations to design the bridge. |
| M1 field classification | Required exhaustive schema projection inventory in RV-02d, with synthetic-field failure test. Contracts retain draft/conditional status until matching schema exists. |
| M2 compiler budget | Added work-queue/visited bound, prevalidated counts, worker cancellation and analysis-limit outcome. Numeric expansion limits remain measured RV-02e gate. |
| M3 multi-tab detection | CAS correctness does not depend on notification. UI refresh mechanism is bounded RV-16 implementation detail after repository contract; missed messages cannot permit stale overwrite. |
| L1/L2 retention/hash failure | Dedup retention is explicit RV-02e deliverable; Web Crypto failure now blocks readiness/eligibility with typed reason and preserves authored work. |

## P3 execution/delegation

| Findings | Disposition / evidence |
|---|---|
| H1 empty-success/headless | Accepted failure class; reviewer misattributes the observed error to Claude: actual failed executor was agy. Headless review with explicit read tools is working. Implementation requires successful scoped preflight, not an unconditional ban on all headless use. |
| H2 durable state | Accepted; task-scoped durable records/prompts/full outputs required before acceptance, plus phase/attempt/base/contracts. Adding a generic --resume flag is not necessary: coordinator resumes from actual state, never blindly skips completed phases. |
| H3/H5 timeout/interruption | Accepted; generic skill loop is not approved dispatcher. Bounded review processes actually use subprocess timeout=300. Future executor must pass timeout/interruption preflight; terminate only tracked sessions/groups and preserve partial state. No global permission bypass. |
| H4 preflight | Explicit no-edit boundary acknowledgement, trusted-worktree/base/ownership/dependency/test check before any code prompt. CLI discovery alone is insufficient. |
| M1/M7 roles and bookkeeping | Project overrides skill defaults: Claude critic/reviewer, Gemini implementer, Codex lead. Coordinator records all ledger/log/handoff updates and validates raw outputs. |
| M2 retries | Accepted partial-state audit; rejected automatic reset recommendation. Preserve actual diff, retry only unaccepted scope after lock/base check. |
| M3 truncation | Full reports retained; state contains evidence paths/hashes, not truncated output as sole review input. |
| M4/M5 integration/versioning progress | Added package-ledger: RV-12 slot lock, RV-08a–f and RV-14a–f subgates. |
| M6 supposed OpenInspector retirement overlap | Source-plan claim rejected: RV-15 owns legacy Inspector, not OpenInspector. Added explicit boundary and accepted replacement/release condition for all genuine shared files. |
| L1/L2 runtime dependency and task size | RV-14a named evidence interface gate; top-level packages are never single generic executor prompts. Each dispatch is one bounded checkpoint. |

## Remaining gates

- D26 product answer: publication undo scope only; other planning continues.
- P4 verifies these revisions, records any remaining high-risk contradictions and distinguishes plan acceptance from unfinished RV-02d/e/f/g contracts.
- No implementation until a new explicit user instruction lifts the hold; no technical review verdict overrides it.
