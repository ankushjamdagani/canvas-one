**PASS**

All four prior blockers close under the revised rules. One observation on serialization.

---

**B1 — CLOSED**

Revised rule: "Admission while the actual host is down rejects immediately with unavailable outcome, regardless of queue capacity." This covers req3's case explicitly. Reviewer's narrower suggestion (restrict to queue-full) was wrong; lead's broader rule (all admissions to actually-down hosts) matches scenario intent. S04a's `rejected:1` assertion is now grounded.

**B2 — CLOSED**

Rebuttal is correct. Conservation at roots: `generated = succeeded + rejected + failed + expired + inFlight`. With generated=6, succeeded=5, rejected=1, inFlight=0, all terms nonneg, the equation forces failed=expired=0. Asserting `failed:0` explicitly is editorial preference, not a correctness gate. Not a blocker.

**B3 — CLOSED**

Revised rule: "At both failure detection and recovery detection, update the router's eligible pool and reset a round-robin cursor to the first healthy outgoing edge in stable edge-ID order." Reset-at-recovery is now explicit and mandatory. Reviewer's suggestion (no reset on recovery) contradicts the rule; lead's choice is correct and documented.

**B4 — CLOSED**

Revised rule: "each slot's local service duration is 1000/capacity milliseconds … capacity=1 gives 1000ms local service." Service time basis is now explicit in the contract. S04b/c timing assumptions are grounded.

---

**Serialization budget — one finding, not a blocker**

The report proposes `semantic shape/expression/payload depth 8` but measures only raw container depth (7–17). No specimen directly validates that the semantic depth ceiling is sufficient for real authored expressions nested inside the raw structure. The report correctly assigns this to "implementation acceptance," but the text could mislead a reader into treating raw-depth measurements as evidence the semantic ceiling is safe. The caveat in the final paragraph ("unmeasured gates remain assigned to implementation acceptance") covers it; no budget number needs changing. Concrete flaws: none found.
