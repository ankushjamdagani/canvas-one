# Review history

All planning reviews were read-only. Raw prompts, reports and process state were removed on 2026-09-23. They are preserved in git at commit `09d2c8b` under `specs/revamp/reviews/`.

## Plan reviews (2026-09-21 → 22)

| Round | Verdict | Main outcome |
|---|---|---|
| RV-00 initial architecture | Findings | Split retained vs new execution work; define run fingerprint and storage cutover in RV-02. |
| P1 requirements | REVISE → fixed | Undo publish exists in design 22D, and the user later removed it (D26). Dirty-draft Run rule (D25). Workload editing kept. Light-only theme (D24). Single Library (D30). Mermaid subset defined. |
| P2 architecture | PASS with conditions | Resource-adapter interface, S04 outage cases, S05 bridge and projection inventory made RV-02 gates. |
| P3 execution/delegation | REVISE → fixed | Durable task records, preflight before dispatch, timeout/interruption rules, integration lock, RV-08/14/16 sub-steps. |
| P4 closure (baseline `6824bae`) | PASS | Plan accepted; detailed contracts named as remaining gates. |
| Policy review (D25–D30) | REVISE → fixed | One stale D30 reference corrected. |

## Contract reviews (RV-02, 2026-09-22 → 23)

| Scope | Verdict | Main outcome |
|---|---|---|
| Schema/runner (D1–D8) | REVISE → PASS | Request bindings, separate call-frame vs request IDs, worker plan handles, response schemas, row errors, metric subjects. |
| Storage (D1–D2) | REVISE → PASS | Pinned initial snapshot; non-null terminal timestamps; retained-run snapshot protection. |
| UI/parts/export (CP-1–7, PE-1–7) | REVISE → PASS | Typed command context, draft guards, panel placement rules, reference remapping, export encodings. |
| Delegation (F1–F4) | REVISE → PASS | RV-08d waits on all RV-14 slices; RV-14d/e serialized; EXEC-PREFLIGHT gate. |
| Command inventory + publication metadata (11) | REVISE → PASS | EvidenceRef defined; publish checks project revision; duplicate-version code; main direct commit/restore rejected. |
| Fixtures S01, S02, S03 | PASS | — |
| Fixture S04 + sizing | REVISE → PASS | Down-host admission rejects; round-robin reset at failure and recovery detection; service time = 1000/capacity ms; transfer depth limits 32/40. |
| Fixture S05 | REVISE → PASS | Bridge call-frame settlement (`settleCall`); transport-only settlement echoes the request payload; one bridge call per non-router resource. |

Several review attempts timed out (300 s, no output). They were retried with narrower scope; no verdict was inferred from a timeout.

## Consolidation review (2026-09-23)

The plan was restructured from 127 files to 24. An independent reviewer compared it against `09d2c8b` and found 20 dropped or changed rules: payload types, the pipeline port-channel rule, S01's "set error" step, branch-reopen revision, storage measurement gate, and several nuances. All 20 were fixed and then confirmed in a second pass; one wording slip that the fix itself introduced was corrected.

## Known reviewer errors (corrected by lead)

- P1 claimed Undo publish was invented. It exists in the 22D design frame.
- P3 attributed the headless permission failure to Claude. It was agy.
- One delegation review claimed RV-05 was missing. It existed in the task ledger.

## Still open

Nothing in planning. Runtime, browser, parser, quota and performance checks happen during implementation acceptance. The implementation hold stays until the user lifts it.
