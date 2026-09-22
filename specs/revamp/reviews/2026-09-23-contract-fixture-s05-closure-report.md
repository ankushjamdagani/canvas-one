# S05 closure review — PASS

2026-09-23. Independent Claude subagent (fresh context, read-only, no edits), dispatched by the coordinator session. Two rounds on the same agent.

## Round 1 — REVISE

- **B1** (bridge call-frame return path): CLOSED. A bridge PortEmission carries a `frameId`, `settleCall` is the only way to settle that frame, the kernel applies `returnLatencyMs`, and the parent adopts the child's outcome and payload.
- **B2** (payload on transport-only settlement): CLOSED. `Admission.response` echoes the request payload, and unavailable maps to `rejected`, which matches S04a.
- Re-traced both S05 scenarios; every declared assertion follows.
- **New blocker:** when a resource has several bridge call continuations (for example, a non-router processor), the payload returned to the caller was undefined.
- Notes:
  - Make the equal request/response shape requirement an explicit readiness rule.
  - Define the bridge outcome counter and the handling of a nested resource → resource → bridge chain.
  - Define what happens to an open bridge frame whose parent was already settled.
  - Say that emission `atMs` includes the edge's `latencyMs`.

## Round 2 — PASS

- The new blocker is CLOSED by a readiness rule: a non-router resource with a bridge call continuation can have no other selectable call continuation. Routers are allowed several bridge edges because the retained `selectOutgoing` returns exactly one edge for a router.
- The notes are addressed without contradicting `handleChildResponse`, root settlement precedence or drain completion.
- A script check of the fixtures: every call port in S01–S05 has identical normalized request/response shapes. The only resource with a bridge continuation is S05 API capacity, which has exactly one. All fixtures stay valid.
- Non-blocking: the rule also stops a `competing` broker from having several consumer call edges to non-resource targets. That is stricter than needed, not contradictory, and no fixture uses it.
