# Fixture-to-contract mapping audit

Planning evidence, not executable fixture acceptance. This audit prevents a named use-case family from being declared supported solely because a generic runner interface exists. The closed grammar must encode each row before schema freeze.

| Fixture | Required authored representation | Required observation |
|---|---|---|
| S01 invalid cart | machine context cart, nonEmpty/every/positiveInteger guard, trace-only self transition | zero create-order dispatches; editing state |
| S01 duplicate submit | submitting self-transition without emit; matching response binding | exactly one emitted order request and one UI success |
| S01 timeout/resubmit/stale response | request-id assignment, explicit logical timeout or timed schedule-event; active request comparison | two distinct request IDs; stale first response ignored |
| S02 denied order | validation plus payment decision routing to rejected reply | rejected root, no fulfillment message |
| S02 accepted order | accepted reply plus explicit message emission into broker/worker | one accepted user root and separately settled fulfillment message |
| S02 fulfillment failure | resource failure/retry profile on message path | accepted user request remains accepted; message failure recorded separately |
| S03 records | list record schema; validation, trim, dedup, group-sum operations | invalid r4 and duplicate r2 explicit; EU=1500/US=2500 with row provenance |
| S04 failover | deployed-on A/H1, B/H2; explicit arrival schedule and fault/detection schedule | exact t0–t5 routing from execution-slices.md |
| S04 active/queued outage | fail-active/reject-queued policy, cancelled completion callback | exactly one outcome each; released capacity; no orphan completion |
| S05 success | machine outbound call binding through service boundary; accepted reply; message root linked to user journey | one UI success, accepted root and completed message, not three user successes |
| S05 outage/retry | host rejection returned through call frame; explicit user resubmit | rejected UI then new request ID under same journey; no failed-attempt fulfillment |

Lead corrections now specified in document-and-runner.md: explicit InputBinding/response payload bindings reference generated request IDs; finite ResourceMetadata and relative ResourceCallMetadata avoid payload-name inference; rowOutcomes preserve provenance/errors; logical afterInputId boundary delivery makes duplicate/stale response scheduling explicit. These are proposed contract answers under peer review, not evidence the fixtures execute.

Before fixture freeze, check these specific constraints independently: S01 duplicate submit occurs before its boundary response; timeout/resubmit retains and settles both call frames; S03 input/error scalar-union accepts string `bad` while validate rejects it against the integer-only schema; S04 finite arrivals supply explicit class/operation/deadline metadata; S05 has separate root/message conservation and all payload ports match. Record each fixture's exact assertion inventory, not just a success label.

Sizing sequence after grammar closure: author five complete document/scenario JSON fixtures; validate by independent schema inventory; record canonical byte counts and hashes; combine into one multi-scenario document; generate a near-ceiling stress document and representative trace rows; distinguish encoded size from runtime heap/performance. No values in a sizing report may be presented as observed simulation results.
