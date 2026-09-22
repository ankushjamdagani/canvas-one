All eight defects closed. `afterInputId` present and sufficient.

---

**D1 — PASS.** `requestFixtureId` replaced by `match:Guard`. "Authors explicitly match business fields and may omit generated-ID comparisons" — authors never need to pre-declare generated strings.

**D2 — PASS.** Explicit separation: "Call-frame identity and application request identity are distinct. Every call creates a system-owned frame ID… `emit.correlation` selects the application request ID… never the frame ID, and never inserts a payload field."

**D3 — PASS.** `startRun` now takes `plan:{workerSessionId:Id; planId:Id}` — opaque handle only. "CompiledPlan never crosses its boundary… worker retains the validated snapshot, manifest and compiled plan." Single-worker topology made explicit.

**D4 — PASS.** "Both the call response schema and bound event schema must declare that field with identical shape; the responder must return it explicitly. No post-validation field injection occurs."

**D5 — PASS.** `decision inputPortId` added to the explicit emission wiring section. "Decision entry is an inbound data port with shape equal to inputSchemaId."

**D6 — PASS.** "Invalid rows route their original JSON value to the error port unchanged; errorSchemaId must accept those values, and a mismatch is a failed run rather than coercion." Format is now defined: original JSON, closed `errorCode` catalog.

**D7 — PASS.** "Logical mode rejects horizon/drain; timed mode rejects quiescent." Explicit rejection stated.

**D8 — PASS.** "A null metric assertion elementId is a schema error." Null prohibited, no ambiguous semantics remain.

---

**`afterInputId` scheduling — PASS.** Field present in `Boundary.responses`. "A non-null reference holds the response until that input and its causal queue finish; if already consumed, deliver on the next causal dispatch." Text explicitly names both target fixtures: duplicate-submit (response held until second submit), stale-response/timeout (first response held until resubmit, settles with stale payload ignored by active-request guard). Expressible without implementation evidence required.

---

**Overall verdict: PASS.** No remaining defects from D1-D8. Contract ready for implementation hold lift.
