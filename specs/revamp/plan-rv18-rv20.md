# Plan: RV-18 router bridges, RV-19 nested refinement, RV-20 board decisions

2026-09-30, `master` @ `d33b1d2`. Status: **proposed, awaiting approval** of the open questions below. Nothing here is implemented.

## RV-18: routers may route to non-resource elements

### Today

- A **bridge** is a call from a resource element to a non-resource element (for example a gateway calling a service's state machine). model-and-runner.md §8 defines bridge call frames: the resource waits, the child settles the frame once, and the parent adopts the child's outcome and payload.
- The kernel opens a bridge frame only when a *non-router* resource has no in-kernel outgoing edge (`src/simulation/open/kernel.ts` `dispatchDownstream`).
- The adapter builds bridges one per node (`bridgeConnByNode` in `src/domain/studio/runner/resource-adapter.ts`), and bridge connections never enter the router's candidate list. A router with a route to a non-resource element therefore settled roots without dispatching that route (RV-13 finding A1).
- Readiness now rejects that case with `router-bridge-unsupported` (`src/domain/studio/readiness.ts`). Gateway, balancer and firewall entries are routers, so "gateway → service machine" can't run.

### Contract change (model-and-runner.md §8, to write first)

1. **Candidates.** A router's candidates are its in-kernel call/message edges plus its bridge call routes, in one stable edge-ID order. Round-robin, weighted (the connection's `weight`) and conditional (the connection's `condition`/`fallback`) treat both kinds alike.
2. **Faults.** A bridge target has no host, so it is always eligible. Cursor reset at detection still goes to the first healthy edge in edge-ID order.
3. **Frames.** A selected bridge route opens a bridge frame exactly as for a non-router resource (wait, settle once, adopt outcome and payload, `returnLatencyMs`, outage-while-open).
4. **Readiness.**
   - Remove `router-bridge-unsupported`.
   - Keep `bridge-continuation-conflict` for non-routers.
   - Require each router bridge route to leave from its own out port (catalog rule 11 already places one port per route), since emissions are resolved by source endpoint.
5. **Message routes.** A router's *message* route to a non-resource element must be an ordinary message root (§8). Verify first; if it is silently dropped today, fix it in the same task.

### Implementation

| Layer | Change |
|---|---|
| Kernel | `KernelBridgeConfig` gains router routes `{nodeId, edgeId, latencyMs, returnLatencyMs, weight, condition, fallback}`. Router candidate lists are merged and sorted with in-kernel edges. In the dispatch loop a bridge edge opens a frame; the `bridge_dispatch` fact carries `edgeId`. The non-router path is untouched. |
| Adapter | Bridge lookup by edge ID for routers and by node for non-routers. The emission uses the selected connection's source port and latency. Edge metrics count bridge routes (`sent`, `responses`). |
| Scenario runner | Nothing expected: it resolves emissions by source endpoint. Confirm with tests. |
| Readiness | As above; update the tests that assert the rejection. |
| Closure | Verify router → non-resource routes are in scope (expected already). |

### Tests and acceptance

- **Kernel:**
  - round-robin alternates between a resource route and a bridge route;
  - a weighted split is seeded and deterministic;
  - conditional routing by class and by operation, with a fallback;
  - under faults the bridge stays eligible and the cursor resets;
  - a second settlement fails the run.
- **Characterization:** the 20 tests and 19 golden metric files stay byte-identical, because no existing fixture has a router bridge.
- **Scenario runner, end to end:** a gateway round-robins between a processor and a service machine. Outcomes and trace are counted per route, and assertions pass.
- **Readiness:** the old rejection tests become acceptance tests. A shared out port is rejected.
- **Browser (e2e):** in the UI, place a gateway, connect it to a processor and a machine, run, and the run passes.
- **Evidence:** documents that were rejected before couldn't run, so no stored evidence changes meaning. Check whether the runner version string is part of the fingerprint and bump it if so.

Size: medium, mostly kernel and adapter. The risk is kernel tie ordering; the golden files guard it.

## RV-19: nested refinement at runtime

### Today

- The compile-time closure (`src/domain/studio/closure.ts`) resolves refinement mappings transitively, in both directions:
  - outer → inner, through any number of levels;
  - inner → outer, so an emission on an inner mapped port also fires connections authored on the outer port.
- The runner (`scenario-runner.ts` `resolveRefinements`) maps one hop, outer → inner only. At two levels, a connection to the outer owner is remapped to a middle element that is itself excluded, and it is dropped. The closure and the runner then disagree about what runs, and the fingerprint describes a scope the trace doesn't match.
- Crossing validation checks only connections that literally touch the owner.
- **No UI authors refinements.** There is no command or panel; refinements arrive only through import or fixtures. Users won't see this fix until an authoring feature exists (question Q2).

### Contract change (model-and-runner.md §6 Refinement)

1. **Transitive mapping.** Mappings resolve transitively in both directions, exactly as the closure does.
2. **Precedence.** A selection whose owner is excluded by an outer *aggregate* selection is inert. The outer owner runs and nothing inside it does. Question Q3 asks whether an inert selection should be rejected instead.
3. **Crossing validation** runs at every level. Every connection crossing a refined owner's boundary, at any depth, needs a compatible mapping, reported as a readiness issue rather than a run failure.

### Implementation

- Extract one `resolveRefinementRouting(document, scenario)` in `src/domain/studio/` that returns:
  - the excluded element set;
  - transitive outer → inner resolution;
  - inner → outer fan-out;
  - crossing violations.
- The closure and the runner both call it, so they can't drift.
- The runner remaps each connection endpoint to its deepest inner endpoint, and mirrors inner-port emissions onto outer-authored connections.
- Readiness reports crossing violations under the existing `invalid-refinement-selection` path.

### Tests and acceptance

- **Two- and three-level fixtures,** all aggregate/refined combinations at two levels. The executed element set equals the closure's element set in every combination.
- **Parity property:** over generated nesting shapes, the runtime scope equals the closure scope.
- **Behaviour:** a refined chain whose members together behave like the aggregate owner gives the same outcome counts as the aggregate.
- **Unaffected cases:** view expand/collapse still changes neither the trace nor the fingerprint, and the existing S05 and closure tests are unchanged.
- **Budgets:** limits stay cumulative across nesting (storage.md §6); add a test near the limit.

Size: small to medium in code, but correctness-sensitive. The review should be done by an independent reviewer (LESSONS: self-review doesn't close).

## RV-20: board decisions D44 (O2–O4)

### O2: selection toolbar per 16D

- **Anchoring:**
  - The toolbar is centred above the selection's bounds (ReactFlow node bounds × viewport transform).
  - It flips below the selection when there's no room above, and is clamped inside the canvas.
  - It follows pan, zoom and drag.
  - On phones it stays pinned (the anchor would sit under the thumb and the dock).
- **Inspector:** a multi-selection no longer opens the empty "N selected" inspector.
- **Actions that already exist:** Group, Align (Distribute moves into the Align menu), Duplicate, Delete, and "Save as component" (`part.capture`) in the overflow menu.
- **Board actions with no contract** (design-revalidation §2 excluded them as "absent, not fake buttons"). Each needs a meaning before it ships; see question Q1.

### O3: compact scenario editor

The board decides the shape. The per-field choices:

| Field group | Choice | Why |
|---|---|---|
| Name, kind line | Inline, unchanged | Already matches |
| Traffic (workload) | Card: name, ON toggle, "Enters at" and "Rate" inline; request mix as one summary line ("browse 80% read · checkout 20% write · edit") that expands to the class editor; timeout and interval inside the expansion | Entry and rate are what people change; the mix is set once |
| Outage (fault) | Summary row "down 2.0 s → up 4.0 s · noticed after 1.0 s" with an OUTAGE tag; click expands the four fields | Four numbers read better as one sentence |
| Checks (assertions) | One row "subject · at most 0" with a check mark; click expands subject/operator/type/value | The expanded form is the tallest part of the editor today |
| Steps (logical inputs) | Same compact-row pattern ("step n · input · after …") | Consistent with checks |
| Units | Summaries show seconds (the board's "5.0 s"); inputs keep the contract's ms with a unit suffix | No unit conversion on edit, readable summary |
| Footer | Full-width "● Unsaved changes · Apply, then run again", full-width Apply/Cancel | Board |
| Canvas | "TRAFFIC ENTERS HERE" tag on the workload's entry node, plus the "Run waits until you Apply or Cancel" notice while the draft is dirty | Board. The notice text must match the existing D41 behaviour. |

Only one row is expanded at a time. Keyboard: a row is a button with `aria-expanded`, and Escape collapses it before the editor closes. Rows added with "+ Add …" open expanded.

### O4: kind tag

- The inspector's kind tag gets a tint of the element's D35 kind colour, which is the node stripe colour ("PROCESSOR" green on the board).
- Text stays on the tag's darker ink so it passes contrast. Add each tint to the token tests and check it with the axe audit.

### Verification (all RV-20)

- Board comparison of 16D, the traffic editor and 2A.
- The isolated e2e suite, the responsive sweep, the touch audit and `scripts/a11y-audit.mjs`. The audit gets new states for an expanded row and the anchored toolbar.

## Order

1. **RV-18.** It unblocks designs that people already try to draw (a gateway in front of a service).
2. **RV-20 O4, O3 and the O2 anchoring.** Visible now; independent of the runner.
3. **RV-19.** Invisible without refinement authoring; do it with or before any Q2 authoring feature.
4. **O2's uncontracted actions,** each after its Q1 answer.

Each item gets its own commit series on `master`, the checks in AGENTS.md §5, and entries in the ledger and `ACTION_LOG.md`.

## Questions (answered 2026-09-30: all as recommended)

Q1: build every proposed meaning. The ⊘ icon has no meaning to recommend, so it is dropped. Q2: pair RV-19 with "Wrap in boundary". Q3: inert. RV-18 is under discussion; see the ACTION_LOG entry for 2026-09-30.

- **Q1 — 16D's uncontracted actions.** For each, a proposed meaning; say which to build:
  - **Wrap in boundary:** create a new owner element that refines the selection (members = selection, crossing ports mapped automatically). This is the natural authoring entry for refinement (RV-19).
  - **Replace part…:** swap the element for a library entry, keeping connections whose ports are compatible and listing the dropped ones in a preview.
  - **Add flow probe:** add an `output` assertion stub on the selected element's out port, opened in the scenario editor.
  - **Changes on this part:** open History filtered to history steps that touched the selected elements.
  - **Export selection:** export the selection as a part file (`part.capture` + `part.export`, no Library save).
  - **⊘ icon** (unlabelled on the board): exclude the selection from the current scenario's scope? It needs a meaning, or it gets dropped.
- **Q2 — Refinement authoring.** Build RV-19 now as runtime parity only (invisible), or pair it with "Wrap in boundary" so refinement becomes usable?
- **Q3 — A selection inside an aggregated owner.** Inert (recommended; it lets people switch the outer level without clearing the inner ones), or a readiness error?
