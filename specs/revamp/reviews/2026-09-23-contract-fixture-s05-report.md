# S05 fixture review — REVISE (2 blockers)

2026-09-23. Claude Opus 5.5, inline read-only review in the coordinator session (not a separate CLI process; replaces the timed-out 2026-09-22 S05 attempt). Inputs: `fixtures/s05.json` (unchanged since 15:33 on 2026-09-22; aliased copy in `2026-09-22-contract-fixture-s05-prompt.txt`) against current `contracts/document-and-runner.md` and `execution-slices.md` S05. Source check: `src/simulation/open/kernel.ts` `dispatchDownstream`/`handleChildResponse`.

## Trace summary

**Accepted and fulfilled.** submit@0 → Checkout `editing→submitting`, request-id R1, emit call (Order, correlation R1) → API capacity (processor, 10 ms) → continuation call → Order entry (frame F2) → data list → Validate (success batch) → Payment decision `allow` → Order reply: emit fulfillment message, reply `succeeded` to F2 → … → Checkout response port, guard `requestId==active ∧ outcome==succeeded` → `succeeded`, `ui-success`. One user root (the first call promotes the submit), one message root (broker → worker, 100 ms). Assertions ui-success=1, root succeeded=1, message generated=1/succeeded=1, inFlight=0 follow, **given B1**.

**Outage then explicit retry.** Fault phase 0 precedes input phase 3 at t=0, so API host is down at admission → immediate unavailable rejection → Checkout `id32` (requestId match, outcome≠succeeded) → `failed`, `ui-failed`; root rejected=1, no message. Host up at 1000; submit@1100 from `failed` (`id21`) mints R2 under the same journey and repeats the success path. Assertions ui-failed=1, rejected=1, ui-success=1, succeeded=1, message 1/1, inFlight=0 follow, **given B1 and B2**.

## Blockers

**B1 — Resource → non-resource call return path is undefined.** API capacity is a retained resource whose continuation is a *call* into a machine (`id105`). In the retained kernel the parent op waits in `phase:'waiting'` until child `onDone` callbacks settle it (kernel.ts `dispatchDownstream`/`handleChildResponse`). The planned adapter (`admit/peekNext/stepNext/interruptHost/snapshot`) has no way to feed the bridge-side settlement of F2 back into that waiting op. The contract also doesn't say which payload/outcome the resource returns to its own caller: the unchanged request, or the child reply. S01–S04 never exercise this (S02 resources sit downstream of machines), so S05 is the first fixture that needs it. Required: a frame handle on bridge emissions, a single settle entry point, returnLatency applied by the kernel, and an explicit payload/outcome propagation rule.

**B2 — No payload for transport-only settlement.** `Admission` is `{accepted, events}`, so a rejected admission has no response payload. Checkout reaches `ui-failed` only if the bound response event carries `requestId` (guard `id32`). Otherwise it falls to `id42` (stale) and stays `submitting`, and the outage scenario fails. The same gap applies to outage failure, deadline expiry and retry exhaustion. The contract must define that these settlements echo the original request payload with the transport outcome, and that "unavailable" maps to outcome `rejected` (as S04a already assumes).

## Non-blocking observations

- Assertions don't check that the retry used a distinct request ID, that both submits share journey `id134`, or that the message root links to the user root. Those are trace-level oracles for runtime tests, like the S03 provenance and S04 per-arrival notes in `fixtures/README.md`.
- Payment decision has `visualKind:'state-machine'` but `decision` behavior. Legal (`visualKind` never selects behavior), but misleading. Fix when fixtures are next regenerated. Changing it now would change the measured hashes.
- `execution-slices.md` S05 says "use declared explicit placement from S04". The fixture uses its own single API host with S04 fault semantics. Consistent with `fixture-mapping.md`; wording only.

## Lead disposition (same session)

B1 and B2 are accepted as contract gaps, not fixture errors; `s05.json` is unchanged. Corrections were added to `document-and-runner.md` ("Bridge call frames and transport-only settlement"). They are lead corrections and **need an independent closure review** (a fresh Codex or Claude session) before S05 counts as PASS.
