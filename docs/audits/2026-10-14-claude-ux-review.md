# Claude UI/UX designer review — 2026-10-14

Reviewer: Claude Sonnet 4.6, invoked through the delegate wrapper with tools disabled. Input: full current plan/future work, PM review, design/frontend rules, Brand page and face assets, current collaboration UI, whiteboard contracts. Source/document assessment only; no browser, visual screenshot or runtime verification. User authorized repository content. Run exited 0 with completion marker.

## Lead qualifications

- Findings about missing current UI are gaps relative to the proposed feature, not proof that the plan itself lacks those requirements. Several requirements already exist in the updated plan.
- Selected context is starting context; the agent can retrieve further permitted context. Do not claim selection is an inspection-access boundary.
- Acceptance is undoable, not permanent. Rejection does not imply deleting durable task/history; preserving review records is part of the proposed plan.
- A visible task summary is useful; nested task cards containing proposal cards can violate the existing flat operational layout. Keep a compact task anchor and unframed sections.
- Right-dock tab sharing is a design candidate, not a confirmed choice. Compare it with other dock compositions and preserve the ability to inspect content while reviewing proposals.
- Request changes belongs to a proposal/task through explicit targeting. Using the main composer does not inherently create a new task; placement and semantics are separate.
- Resume is the explicit acknowledgement. Do not introduce read-detection, checkboxes or an extra gate that was not agreed.
- Overlap resolution must explain keeping the human edit/replanning or explicitly reviewing the agent's alternative. A generic Resume agent button must not imply permission to overwrite newer work.
- Dependency-aware Undo should offer a reviewed revert rather than simply disabling all Undo affordances. Stop's keep-changes message is informative, not an extra confirmation.
- The inventory mixes UI substates and domain states. Feedback delivery and connection diagnostics need not become proposal/connection enum values. Design Interrupt/Resume visibly while keeping durable state ownership coherent.
- One active agent is current scope; future states must also cover actual concurrent roles, drawing, general whiteboarding and optional extensions, not merely hidden labels.

## Claude review, verbatim

## Verdict

The confirmed interaction choices are principled: Suggest-default, task-bound authority, stop-preserves, overlap-pause form a coherent and honest permission model. The design execution has not caught up. The current Dialog surface is a prototype — no task container, no authority disclosure, no revision loop, no spatial diff, no interrupted-task state. The panel migration is the most consequential design risk in the plan, not an implementation detail. Six of eight findings block Step 3 acceptance if unaddressed.

---

## Top 8 Prioritized UX Findings

**1 — Task and conversation are visually indistinguishable** `[High]`

The current Dialog renders proposals in a flat list with no task container. A user cannot tell what permission governs the session, which proposals belong to the active task, or what lifecycle state the task is in.

Scenario: User sends a second instruction while the first task is waiting. A new proposal appears in the list with no visual parent and no permission badge. User accepts it without knowing the authorization context has changed.

Remedy: A task card is the panel's primary visual anchor. It carries permission labels, face + activity label, Stop, and Undo task. Proposals nest inside it. The instruction thread is a secondary rail below.

---

**2 — Context/authority asymmetry has no surface** `[High]`

Selection controls what the agent reads; the live-edit grant covers the whole board. Nothing communicates this distinction. The two-label solution is in the plan but absent from the design.

Scenario: User selects 3 nodes, grants live edit, watches the agent modify 3 nodes, then discovers an unrelated component was deleted. Every action was authorized; nothing disclosed the scope discrepancy.

Remedy: Persistent dual label on the task card: "Context · 3 selected" and "Authority · Suggest" or "Live edits · entire board." These labels are independent and always visible while a task is active.

---

**3 — Revision loop is undesigned and unimplemented** `[High]`

Request changes is not present. Without it, the only options after review are accept (permanent) or reject (lose all work). All iteration is forced outside the panel.

Scenario: Agent proposes an architecture change but misnames a component. User wants the topology and needs one label corrected. Reject discards the structure; accept-then-fix is error-prone with live-edit authority.

Remedy: Inline "Request changes" field on each pending proposal card — a compact text input + Send that delivers feedback through the adapter and shows delivery status (delivering / acknowledged / failed) on the card. This is distinct from the task-level instruction input.

---

**4 — Spatial diff is a static post-change SVG** `[High]`

`ProposalDiagram` renders the final document state, not what changed. Additions, modifications, and removals are visually indistinguishable. The plan requires identifiable change types; this does not exist.

Scenario: Agent adds 2 nodes and removes 1. Preview shows 6 nodes. User counts before and after, notices the delta, cannot locate which node is gone.

Remedy: Change-type markers on proposal canvas items: addition (dashed ring), modification (underline), removal (strikethrough + dimmed). Shape and pattern, not color alone — colorless-accessible. Fit-to-changed-region on open; before/after toggle available.

---

**5 — Panel mount conflicts with Inspector; right-dock position unspecified** `[Medium-High]`

The plan says "side panel, use existing docking patterns" without specifying which side. The Inspector is already right-docked and actively used during any board-editing task.

Scenario: User selects a node while reviewing an AI proposal. Inspector activates. Both demand right-dock real estate. One silently displaces the other; the user loses proposal context every time they inspect a node.

Remedy: Define the mount before Step 3 begins. A right-dock tab bar sharing space with Inspector is lowest-risk given the existing dual-tab `InspectorPanel` pattern. Specify which panel takes focus priority when both are active. Storybook must cover this at desktop and 390px before adapters are attached.

---

**6 — Interrupted-task state is undesigned** `[Medium-High]`

On reload, the plan requires: task identity, completed-change count, pending proposals, board delta, explicit Resume. None of this is modeled or designed. The controller disposes on unmount and loses all pending state.

Scenario: User reloads during a live-edit task. Returns to an empty panel. Applies changes manually, duplicating what the agent already completed, because no applied-change summary was shown.

Remedy: Interrupted is a distinct panel state — different visual treatment from active, completed, and failed. Task card shows an "Interrupted" badge and: "N changes applied · M pending proposals · Board has changed." Resume is disabled until the user explicitly reads the summary.

---

**7 — Overlap interruption has no UI surface** `[Medium]`

The plan specifies pause-and-ask with independent work continuing. There is no design for where and how this ask appears. A blocking modal violates the "independent work continues" constraint. An easy-to-miss inline notice risks a silent overwrite.

Scenario: User draws a connector while the agent rearranges nearby nodes. The overlap check triggers. If the prompt is in the panel, the user misses it. If it's a modal, it blocks the canvas action they just initiated.

Remedy: A non-blocking banner anchored above the canvas dock (never over canvas center), face at `wait`, one-sentence conflict description, two actions: Resume agent / Cancel this agent action. Collapses on explicit choice, never on timer.

---

**8 — Stop and Undo task are orphaned from their semantic home** `[Medium]`

Neither exists as a task-level control. Stop is implied by Disconnect; Undo task is absent entirely. Users will conflate Stop with disconnect and not understand that completed changes persist.

Scenario: User clicks Disconnect expecting the board to revert. Completed changes remain. User applies a manual undo, stacking it on top of completed AI work without knowing it.

Remedy: Stop and Undo task live on the task card only. Stop shows a confirmation label ("N changes already applied will remain"). Undo task is disabled until stopped/completed and grayed when dependency conflicts exist. Disconnect stays in the connection section.

---

## Recommended IA and Control Semantics

Panel sections, top to bottom (desktop):

1. **Connection bar** — face + agent display name, status, agent selector (Claude / Codex / agy), Disconnect. Compact when task is active.
2. **Task card** — status badge, dual-label (Context · N / Authority · Mode), face + activity label, Stop, Undo task.
3. **Proposal rail** — pending first; each card: diff thumbnail, change summary, Request changes inline field, Accept / Reject. Completed/rejected below a disclosure fold.
4. **Thread** — prompt and reply history. Instruction textarea + Send pinned at panel bottom.

Control mapping: Stop is task-scoped. Undo task is task-scoped. Accept/Reject are proposal-scoped. Request changes delivers via adapter and reports acknowledgement on the card. Live-edit grant is a full-width disclosure banner on the task card at grant time — not a separate dialog, per confirmed choices.

---

## Current State Inventory + Future State Families

**Current (from source):** Connection: `pairing | connected | reconnecting | disconnected | error`. Proposal: `pending | accepting | conflict | accepted | rejected | stale`. Task: none modeled in UI.

**Required additions:** Task durable: `requested | working | waiting | completed | stopped | failed | interrupted`. Proposal: `delivering-feedback | feedback-acknowledged | feedback-failed | invalid | failed` (distinct from connection failure). Connection: `missing-cli | cli-signed-out | incompatible-version | bridge-missing | expired-code`.

**Future state families (seams only, no controls added now):** Multi-participant: attributed participant list — neutral slot in task card data, hidden at zero. Role agents: task role label — single slot, hidden when one agent. Custom agent: adapter capability flags — `limited` badge on agent selector, no panel restructuring.

---

## Recommended Changes

1. Design the task card before writing any adapter code. Its presence communicates stop-preserves and authority visually without new flows.
2. Add dual-label context/authority to the task card in Step 3. No new permission model — labeling what is already true.
3. Replace the static SVG proposal preview with change-typed overlays in Step 4. No partial acceptance, no new approval steps.
4. Design the interrupted-task panel state as a named deliverable before Step 6. Read-only until Resume; no new permission concept.
5. Relocate Stop and Undo task to the task card. Storybook covers both desktop and 390px with keyboard inset simulated.
6. Specify panel mount point (right-dock tab alongside Inspector) and verify in Storybook before Step 3 adapters are attached.

---

## Essential Questions

1. **Which dock side is confirmed for the collaboration panel?** Right-dock tab-sharing with Inspector is lowest-risk but changes the Inspector's visual chrome. Needs explicit approval before Step 3 begins.
2. **What pattern marks a removal in the spatial diff?** Deletion requires unmistakably distinct, colorless-accessible treatment. The confirmed no-extra-deletion-approval means the visual burden of "this will be removed" falls entirely on the marker.
3. **On mobile at 390px with the keyboard open, where does the live-edit grant disclosure render?** It must clear the keyboard inset. Top-of-sheet or pre-keyboard-open moment must be specified before Step 5.
4. **Is Request changes inline on the proposal card or routed to the main instruction field?** Inline means revision within the same task (same task ID, same attribution). Routing to the instruction field implies a new task. The answer determines grouping and history attribution.

---

## Critique: What a Design-Generation Prompt Must Require

**Standalone readable states**: Each state — active task, interrupted, overlap interruption, first-run setup, empty panel, mobile proposal review — must be a self-contained frame with its own specimen data. A prompt asking for "the collaboration panel" produces only the happy-path active state.

**Coherent specimen data**: Task IDs, agent names, proposal labels, change counts, and instruction text must be consistent across all frames in a set. Mismatched node names between the proposal card and the diff thumbnail signals fabricated UI and makes design review unreliable.

**Desktop and mobile both required**: 1280px canvas-visible desktop and 390px sheet mobile are different surface archetypes, not responsive variants. A single-viewport prompt produces a non-functional phone layout.

**Distinct current vs future labeling**: Each frame must be marked "current scope" or "future / not in scope." Without this, generated panels will include multi-agent tabs, role selectors, and custom-agent inputs that contradict confirmed single-agent scope and require rejection.

**Brief motion notes per transition**: Face sequence on connect (antenna → look → wink), overlap banner entrance, proposal diff loading. One sentence each. "Animate as appropriate" produces either no spec or over-specified keyframes.

---
