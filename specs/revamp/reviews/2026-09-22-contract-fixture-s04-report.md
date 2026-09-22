## REVISE — 4 blockers

---

### B1 · S04a: New-arrival-to-down-host outcome undefined (critical)

`activePolicy:'fail'` and `queuedPolicy:'reject'` are defined only for requests already in-flight or queued **at the moment the fault fires**. req3 arrives at service A (phase 3, t=2000) after H1 has already gone down (phase 0, same tick) but before the router detects it (t=3000). Neither policy clause covers this case. Whether req3's outcome is `rejected` (queue overflow, queueLimit=0) or `failed` (host-down) is unspecified. `S04a` asserts `rejected:1`; that assertion stands or falls on this gap. Contract must add: "A request admitted to a resource whose host is already down at admission time is rejected immediately when queueLimit=0 or when the queue is already full; `queuedPolicy` governs requests that were already in the queue when the fault fired."

---

### B2 · S04a: Missing `failed:0` assertion (important)

S04a asserts generated=6, succeeded=5, rejected=1, inFlight=0. No `failed` assertion. If B1 resolves as "failed" rather than "rejected," `rejected:1` would fail at runtime — correctly catching the error — but only because the expected count is wrong, not because `failed` is explicitly bounded. The intended conservation equation (5+1+0+0=6) is underdocumented. Add `{outcome:'failed', expected:0}` so the assertion set is closed over all terminal outcomes and the intent is unambiguous to the runner and any future fixture author.

---

### B3 · routeReset at recovery detection is unspecified

The contract says "S04 fixes the **initial** route reset policy; configurable alternatives need a later behavior version." The word "initial" is load-bearing but undefined. Does `routeReset:'first-healthy'` fire only when a failure is detected, or also when recovery is detected (t=5000 for S04a)? For S04a the arithmetic is unaffected either way — round-robin through two B's leaves A as the natural next route, so req6→A regardless. But the behavioral gap is real: a follow-on scenario with a three-way router or asymmetric weight state after recovery would produce different counts depending on interpretation. The contract needs a sentence: "routeReset triggers at failure detection; recovery detection restores the route to the healthy-route pool but does not reset the round-robin counter."

---

### B4 · S04b/c: service-time basis is implicit (important)

S04b and S04c depend on req1 (capacity=1, admitted at t=0) still being active when the fault fires at t=500ms and t=1000ms respectively. This requires ~1000ms service time, consistent with capacity=1 work-unit/sec at 1 work-unit per request. But the fixture declares no `workUnits`, `serviceTimeMs`, or equivalent field; the resource config only has `capacity`. The assumed "1 work-unit per request" is nowhere in the contract. If the retained kernel uses a different duration model (e.g., fixed 0ms for timed-mode resources, or slot-based), both S04b and S04c could produce req1 completing before the fault fires — inverting succeeded/failed counts and silently failing the assertions. The contract must state explicitly how service time is derived from `capacity` for authoring purposes (e.g., "each admitted call consumes one work-unit; service time = 1/capacity seconds per concurrency slot").
