# Claude product-manager review — 2026-10-14

Reviewer: Claude Sonnet 4.6, invoked through the delegate CLI wrapper. Two read-only passes: plan-only, then repository-context consolidation after explicit user authorization. Tools disabled; supplied plan, audit, product context, whiteboard/history/agents/bridge documentation and current collaboration UI/controller. No live application, CLI compatibility or runtime verification performed.

Status: independent recommendations, not approved scope changes. The current plan retains all three required integrations and the confirmed live-edit/deletion policies.

## Lead assessment of review limitations

- Claude overstates acceptance failures as entirely silent: current proposal rows display issues and stale/conflict messages. The actual gap is consistent interpretation of proposal status and action-scoped feedback; validate it against source before fixing.
- The existing optional ModelProvider's missing cancellation signal is separate from the new local CLI adapter path. Do not make unrelated model-provider changes a prerequisite without a demonstrated dependency.
- Limited-mode agy or dropping an integration does not satisfy the confirmed three-agent scope. First verify real adapter capabilities; report a blocker and seek a scope decision if one cannot meet the contract.
- A terminal-free first run is an unapproved aspiration: the browser cannot start a local bridge by itself. Define the local installation/launch handoff honestly; do not expand into a desktop launcher implicitly.
- Additional permission confirmations, resume acknowledgement checkboxes, tap-count targets and numeric timing targets are Claude's proposals. User confirmed live permission including deletion, with no separate deletion approval; any design must honor that.
- Selection is one inspection option; context retrieval is not inherently limited to the initial selection. Disclosures should explain actual inspection and editing grants rather than claim the agent only sees selected content.
- Structural deletion validation protects record/reference integrity according to the active schema/extensions. It does not establish that a valid deletion is desirable or that legitimate whiteboard graph cycles should be prohibited.

## Consolidated review, verbatim

## PM Review: Canvas One AI Collaboration Plan — Consolidated (2026-10-14)

### Verdict

The plan's confirmed choices are principled: Suggest-default, one-active-agent, overlap-pause, stop-preserves. The prior review's structural assessment stands. Repository evidence adds material weight to three findings and surfaces four concrete shipped bugs that must be fixed before new development begins. The gap between the current `<Dialog>` UI and the planned side-panel architecture is larger than the plan acknowledges and is the second-largest Step 3 risk after the three-CLI adapter gap.

---

### Priority Findings

**Finding 1 — Four concrete bugs are prerequisites, not future tasks**

Source: `AgentCollaboration.tsx` `accept()` checks only `!result.ok`. `ProposalController.accept` can return `ok:true` with `proposal.status` as `conflict`, `invalid`, or `failed`. The UI reaches a broken silent state: "Applying…" resolves with no change and no user-visible error. Separately, `controller.ts:proposeWithModel` passes no cancellation signal to the model provider. MCP cancellation aborts the caller's wait but leaves the queued bridge request live — a cancelled `diagram_create` reappears as a proposal. Finally, `diagram_create` is annotated read-only despite writing to the proposal queue.

Scenario: User accepts a conflict-state proposal. UI shows nothing went wrong. Board is unchanged. User retries. Same result.

Fix: Patch `accept()` outcome handling and add an `AbortController` to `proposeWithModel` in Step 2. Fix the MCP `diagram_create` annotation in Step 1. Add explicit request-cancellation propagation before Step 3. These are blocking, not cosmetic.

---

**Finding 2 — Dialog-to-Panel is a full UI architectural replacement**

Source: The current collaboration surface is a `<Dialog>` in `AgentCollaboration.tsx`. The plan calls for a resizable side panel on desktop and a sheet on mobile — different component archetypes with different mount points, viewport preservation constraints, and keyboard focus models.

Scenario: Step 3 work begins assuming the Dialog can be adapted. Midway through, the modal overlay is found to block the canvas viewport-preservation requirement and the Panel anchor point conflicts with the existing toolbar layout. A full remount is required, invalidating Storybook stories and in-progress adapter work.

Fix: Declare "Dialog → Panel migration" as an explicit Step 3 prerequisite with a defined mount point and open/closed/minimized state contract. Storybook verification must cover both desktop and 390 px mobile viewports before adapters are connected. This is architecture, not a detail.

---

**Finding 3 — No adapter abstraction exists; three CLIs require building the pattern from scratch**

Source: `controller.ts` implements a single flat `handleTool` switch. There is no adapter interface, capability-discovery contract, or per-CLI event/cancellation protocol. The bridge protocol maps to the existing MCP CLI. Claude, Codex, and agy each have different execution, streaming, and cancellation interfaces.

Scenario: The team builds the Claude adapter, then discovers the capability-discovery contract needs revision for Codex. The agy adapter exposes a feedback-acknowledgement incompatibility. Step 3's acceptance gate requires all three to pass simultaneously — one failure holds all three.

Fix: The adapter capability-contract document (capability flags: messaging, streaming progress, cancellation, pause/resume) is the first Step 1 artifact, reviewed before any CLI-specific work. Define a limited-mode flag so a non-conforming CLI ships as explicitly unsupported rather than blocking the step. agy interface verification is the first Step 1 task; its outcome determines whether agy ships full or limited-mode.

---

**Finding 4 — Proposal persistence gap makes reload a data-loss event**

Source: Audit confirms pending proposals are in memory and cleared on controller disposal. No task or proposal metadata is persisted separately from authored content. On reload, the collaboration panel shows an empty list with no interrupted-task indicator.

Scenario: User reloads mid-task. On return, the panel is empty. No interrupted indicator, no resume prompt, no completed-changes summary. The user cannot tell whether their changes were applied.

Fix: Step 6 must treat the resume screen as a first-class product deliverable: show completed-change count, pending proposal count, and require explicit acknowledgement before new edits are enabled. Before Step 6, add a visible cap warning when the session approaches the 100-proposal limit — no queue-pruning UI currently exists.

---

**Finding 5 — Context/permission boundary has no UI surface; confirmed asymmetry creates a trust risk**

Source: `controller.ts:context()` filters records by selection; `proposal_submit` and the live-edit grant apply board-wide. Nothing in `AgentCollaboration.tsx` communicates this distinction. The plan confirms this is intentional (selection = context, not permission) but provides no product surface for it.

Scenario: User selects three nodes, sees "3 items selected" in the panel, assumes the agent will only touch those nodes. Agent proposes board-wide changes. User accepts. Discovers the scope was wider than expected after the fact.

Fix: For Suggest mode, a persistent panel label — "Agent sees selected context; suggestions may cover the full board" — is sufficient and must be a Step 3 acceptance gate. For live-edit, a confirmation dialog with explicit scope disclosure is mandatory and must be a Step 5 acceptance gate. Neither exists today.

---

**Finding 6 — Bridge code renewal is a known API gap, not a behavioral change**

Source: Audit confirms the existing bridge cannot mint another code through its current API after a code is consumed or expires. The plan calls for "renewal after consumed/expired codes" in Step 2. This is a concrete bridge API addition, not a behavior tweak.

Fix: Design the renewal endpoint as a Step 2 scope item explicitly; it is the most common first-run failure path and blocks productive onboarding until fixed.

---

### Delivery Order (Retaining Confirmed Scope)

| Phase | Scope | Acceptance gates |
|---|---|---|
| Pre-Step 1 (prerequisite) | Fix four concrete bugs; define adapter capability-contract; verify agy CLI interface | Patched tests for each bug; contract document reviewed; agy capability flags documented |
| Step 1 | Task/permission/adapter contracts | Capability flags for all three CLIs; limited-mode documented for non-conforming CLIs; MCP annotation fixed |
| Step 2 | Bridge recovery, cancellation, code renewal | Re-pair without restart; Stop and departure fence writes; cancelled requests do not ghost as proposals; renewal endpoint available |
| Step 3 | Panel migration, three adapters, face presence | Panel accepted in Storybook at desktop and 390 px; each agent delivers in-app requests and reviewable proposals; context disclosure label present; keyboard and mobile reachability verified |
| Step 4 | Suggestion overlays and iteration | Before/after, semantic diff, accept/reject, feedback handoff; no authored mutation before acceptance |
| Step 5 | Live-edit authorization | Pre-execution scope disclosure dialog; task-bound create/update/delete; overlaps pause; branch switches fenced |
| Step 6 | Durable task history and grouped undo | Resume screen with acknowledged-state gate; cap visibility; dependency-aware revert verified |

---

### Future Seams

| Future capability | Establish now |
|---|---|
| Multiple humans | Participant identity in operation attribution; conflict-aware undo contract boundary; no sync transport |
| Custom agent | Adapter capability contract from Step 1 must be versioned and discoverable; no CLI-specific encoding in the adapter boundary |
| Simulation evidence | Optional extension capability flag in adapter contract; no simulation requirement on core review path |
| Accounts / hosted auth | Authorization interface named but not implemented; no credential storage added in this scope |
| Shapes / freehand | Neutral content/editor contracts already confirmed; no engine migration now |

---

### Essential Product Questions

1. What is the confirmed limited-mode fallback if agy cannot satisfy the feedback-acknowledgement contract? Without a defined answer, agy becomes an undeclared Step 3 gate risk.
2. What does the user see on resume — a completed-changes diff, a count summary, or only a button? This determines whether interrupted tasks are recoverable in practice and sets Step 6 scope.
3. Is mobile live-edit grant in scope for this release? If yes, the grant-confirmation interaction must be specified before Step 5. If no, it must be explicitly disabled in the panel UI, not silently absent.
4. What is the minimum bar for "actionable diagnostics" on a missing CLI or sign-in — guided in-app install with a copy-command, or a link to external documentation? This is the first-run quality gate for Step 3.
5. Does "structural validation" for live-edit deletions protect against orphaned connections and dependency cycles, or only schema conformance? The current `validateDocument` scope must be explicitly bounded so the team knows what the safeguard covers and what it leaves open.

---

### Measurable Acceptance Criteria

- **No silent accept failure**: A proposal with `ok:true` and `status: conflict | invalid | failed` surfaces a scoped error in the proposal card, not in the connection section. Verified by unit tests for each conflict outcome.
- **Stop fences writes within one round-trip**: User stops a task; bridge confirms request cancellation was propagated (not only local wait aborted); no further board writes occur. Verified by integration test.
- **First-run without terminal**: A user with a freshly installed CLI and valid sign-in completes a first suggestion task without opening a terminal or external documentation. Verified by Playwright walkthrough on a clean profile.
- **Context disclosure always visible**: Panel displays the context/permission boundary label whenever a task is active, on both desktop and 390 px mobile viewports. Verified in Storybook at both breakpoints.
- **Resume requires acknowledged state**: 100% of interrupted tasks display completed-change count and board-state indicator on resume; Resume is disabled until the user explicitly acknowledges. No task resumes silently after reload.
- **Mobile review reachability**: Accept, Reject, and Request Changes are each reachable within two taps on a 390 px viewport, touch targets ≥ 44 px, no horizontal scroll. Verified in Storybook and Playwright.

---
