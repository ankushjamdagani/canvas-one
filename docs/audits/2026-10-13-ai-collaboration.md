# AI collaboration: current workflow and product direction

Date: 2026-10-13. Scope: Canvas One's local AI collaboration, model-provider hook, proposal review, transaction integration, CLI/MCP and future collaboration contracts. Source-based assessment with three independent native Codex review lanes; no fresh browser or visual verification. No product behavior changed.

## Main finding

The application has a working, guarded AI proposal pipeline. The interaction still asks users to manage a bridge, an external agent and a review dialog. The biggest opportunity is to make collaboration a continuous canvas workflow: choose context, ask, observe progress, inspect a spatial diff, request changes, accept, and verify the result.

## Current user journey

1. Start the app and open a project.
2. Start the local CLI bridge with the app's exact browser origin. It prints a bridge URL, a two-minute single-use pairing code, and a separate agent token.
3. Open AI collaboration from the desktop toolbar or command palette. Enter the URL and code.
4. Configure an external agent's stdio MCP server using the CLI and bridge environment variables. Prompt that agent in its own application.
5. The agent inspects authored board context and component schemas, then submits a readable diagram request or explicit record changes.
6. The browser validates the proposal and queues it. Authored content does not change yet.
7. Review a detached SVG candidate and expandable JSON changes. Accept or reject the entire proposal.
8. Acceptance checks project, branch and revision again, validates the changes, applies through the normal session transaction, stores agent attribution and creates one undo step. A stale proposal cannot overwrite intervening work. Editing main automatically creates a draft through existing session behavior.
9. The agent can poll proposal status. A stale/conflicted proposal requires a fresh inspection and new proposal.

The default app does not provide model chat. Hosts may inject a ModelProvider, which enables an instruction field and Generate proposal action. This is an optional integration contract, not an installed model service.

## Implementation map

| Owner | Responsibility |
|---|---|
| src/features/workspace/Workspace.tsx and TopBar.tsx | Entry points, dialog visibility, selected records/current view, host provider wiring |
| src/features/agents/AgentCollaboration.tsx | Pairing UI, optional model instruction, proposal list, SVG preview, accept/reject |
| src/features/agents/controller.ts | App binding, board projection, schema discovery, authenticated agent identity, proposal dispatch |
| packages/agents/src/index.ts | Headless queue, proposal states, bounded context, validation and preview ports, model contract |
| packages/agent-bridge/src/server.ts and browser.ts | Authenticated loopback relay and browser polling; no direct storage access |
| packages/cli/src/main.ts and index.ts | Bridge command, direct tool calls and stdio MCP lifecycle |
| packages/system-design/src/session/controller.ts | Authored state and reviewed transaction authority, draft behavior and undo |
| packages/collaboration/src/index.ts | Future hosted provider contracts; local provider explicitly has no presence or document synchronization |

## Six agent tools

| Tool | Behavior |
|---|---|
| board_inspect | Bounded authored context, project/branch scope, revision and current selection; optional selectionOnly |
| component_schemas | Built-in and registered custom schemas, readable diagram schema and operation guidance |
| document_validate | Validate a supplied document without editing |
| diagram_create | Plan readable aliases, connections, annotations and layout into a reviewable proposal |
| proposal_submit | Submit explicit insert/replace/remove records for review |
| proposal_status | Inspect review status, issues and available receipt |

This tool surface does not expose simulation runs, code-repository inspection, conversational messaging, agent-to-agent delegation, or direct acceptance. Those require additional capabilities.

## What is real, optional, and future

**Implemented:** local browser pairing, authenticated external agent inspection/proposals, readable diagram planning, custom component discovery, detached candidate preview, whole-proposal review, revision protection, provenance and atomic undo.

**Optional:** a host-provided model adapter. Model credentials stay in the host implementation. The app supplies no model by default.

**Future:** durable conversations and pending proposal history; request-changes feedback; canvas diffs; streaming task activity; evidence-grounded repository explanations; simulation tool access; coordinated multiple agents; hosted team invitations, presence, permissions and concurrent document synchronization. Multiple proposals/actors in a generic queue do not constitute a shipped multi-agent orchestrator.

## Important boundaries and lifecycle

- Pairing is exact-origin, IPv4-loopback, single-browser and single-use; default code expiry is 120 seconds and paired-session expiry is one hour.
- Browser and agent tokens are distinct and held in memory. The bridge transports requests; the paired browser owns validation and writes.
- Browser polling uses a 750 ms delay between cycles, with transient reconnect attempts. A stopped bridge, expired session or explicit disconnect requires fresh pairing; the existing bridge cannot mint another code through its current API.
- Bridge requests expire after 60 seconds; the CLI allows 65 seconds. Defaults cap bridge pending work at 100 unanswered requests and 1,000 retained requests.
- Proposal defaults cap a session at 100 retained proposals, 1,000 changes per proposal and 262,144 serialized characters per request. Completed entries count toward the cap; there is no queue pruning UI.
- Context defaults cap records at 200 and serialized context at 65,536 characters. Truncation is reported to the agent. The app currently supplies no asset references and no simulation evidence in this projection.
- Request IDs protect relay retry identity. Proposal operation IDs protect proposal identity. Semantic retries preserve generated identifiers; changed payloads cannot reuse an identity.
- Pending proposals are in memory and are cleared on controller disposal. Accepted changes and operation attribution use normal persistent storage. Closing the dialog alone does not dispose the mounted controller.
- A board or branch edit can invalidate all proposals prepared against its old revision. Acceptance of one proposal can therefore make another stale. The UI does not proactively explain this queue dependency.
- Selection-only context filters selected authored records/current view; it is not a semantic dependency closure. The optional model path calls full-board context and supplies no user context selector.

## Highest-impact UX problems

1. **Setup is incomplete in the product.** Users must know terminal commands, origins, MCP configuration and token placement. The UI offers technical instructions but no copyable setup or connection test.
2. **The modal interrupts spatial work.** The board becomes harder to inspect alongside the agent's proposal. Toolbar active state means the dialog is open, not the agent is connected or proposals need review.
3. **Review is too technical.** A small static SVG plus raw JSON does not explain which fields, nodes, connections or views change. There is no before/after or fit-to-change interaction.
4. **Iteration has dead ends.** Reject has no feedback; stale review tells users to switch to the external agent and regenerate. Pairing failures collapse distinct causes into one message.
5. **Context is invisible.** Users cannot see what the agent receives, select board versus selection versus subsystem, or notice truncation in the UI.
6. **Work lacks continuity.** No task transcript, durable pending queue, filtering, progress timeline, cancellation button, resume flow or accepted/undone reconciliation is presented.

## Small source-confirmed issues to address first

- After explicit disconnect, the UI offers pairing again, but the bridge's code has already been consumed. Provide a fresh-code mechanism and explicit recovery instructions while preserving authorization.
- ProposalController.accept can return ok:true with proposal.status conflict, invalid or failed. The UI's action error handler only checks !result.ok. Rows show some issues, but model and review errors are also rendered inside the connection section, and state.error can hide actionError. Separate outcome status from successful API execution and scope errors to the action.
- The model contract has an optional signal, but proposeWithModel does not pass one and the UI has no cancellation. Add task cancellation and disposal-safe completion handling.
- MCP cancellation aborts the caller's wait, but does not remove the queued bridge request. A cancelled diagram request can still appear as a proposal later. Add explicit request cancellation propagation and distinguish cancelled, already completed and in-flight work.
- MCP tool annotations classify diagram_create as read-only even though it adds a proposal. Its annotation should reflect proposal-queue mutation, while retaining the guarantee that it does not edit the board directly.

## Recommended product direction

Keep the canvas dominant. A resizable AI side panel should contain a compact identity/status header, explicit context selection, requests and task activity. Connection settings move to a dedicated setup flow. A read-only canvas overlay should show added/changed/removed content with semantic diffs and before/after controls. Review actions become Accept, Request changes and Reject; accepted work provides attribution and an Undo affordance tied to the normal history path.

On phones, use an accessible bottom sheet or full-screen review surface with a stable canvas/review switch and reachable actions. Preserve the existing tokens and foundation components, zero negative letter spacing, fixed control dimensions and quiet operational layout.

## Delivery order

| Order | Scope | User outcome | Dependency |
|---|---|---|---|
| 1 | Recoverable pairing, exact-origin command/config copy, connection test, task-specific errors, truthful toolbar status | User gets connected and understands what is happening | Bridge code renewal and lifecycle contract |
| 2 | AI side panel, context control, spatial/semantic diffs, fit-to-change, pending badge | User reviews changes beside the board with confidence | Detached preview model and editor presentation |
| 3 | Task/feedback contract, Request changes, regenerate, cancellation, durable proposal/task history | User can iterate and resume work | New browser-to-agent messaging/provider contracts and scope-safe persistence |
| 4 | Proposal simulation, baseline/candidate comparisons, visible assumptions and evidence | User verifies an architecture before accepting it | Simulation capabilities and exact-revision evidence binding |
| 5 | Repository-grounded walkthroughs, alternative proposals, coordinated agent roles | Collaboration becomes a broader engineering workflow | Source/evidence connectors and task orchestration |
| Separate track | Hosted human collaboration | Shared teams and concurrent editing | Authentication, permissions, hosted sync and conflict resolution |

Do not silently rebase or partially accept arbitrary record arrays. Partial acceptance must build and validate a coherent new candidate with dependency-aware changes. A visual overlay must never become a second writable runtime. A simulation preview must bind evidence to the candidate fingerprint and assumptions; it must not imply real production benchmarks.

## Concrete target journey

Select API and database → Explain this flow → agent produces canvas annotations → ask for a caching alternative → inspect spatial diff → compare deterministic candidate and baseline simulations → request a correction → accept one coherent transaction → inspect attribution or undo.

## Success measures

Measure setup completion rate and time to first successful board inspection; time to first accepted proposal; review time and user ability to identify changed content; stale-proposal frequency; recovery completion after bridge loss; successful revision requests; resumed tasks after reload; accidental approvals and subsequent undo; mobile review action reachability. Establish a baseline before assigning numeric improvement targets. “100x” is an ambition, not a measured result.

## Verification and limits

Fresh focused verification: 11 tests passed across src/features/agents/controller.test.ts and bridge.test.ts. The first restricted run passed eight tests and blocked three loopback tests with listen EPERM; rerunning with loopback access passed all eleven. Mechanical UI detector returned no findings for AgentCollaboration.tsx. These checks do not prove usability or visual quality.

Existing browser sources cover phone setup bounds and a real pairing/preview/acceptance/conflict/undo journey. They were read, not rerun. Missing browser scenarios include reconnect, invalid/expired pairing, rejection, model generation/cancellation, populated mobile review, large queues, reload, project switching, keyboard/focus/screen-reader behavior and multiple browser engines. No full build, Storybook or full test suite was run for this documentation-only task.

Source authority: implementation and tests above; README.md local setup and docs/composables.md. PRODUCT.md still mixes older future-scope collaboration language with current local capabilities. The design sidecar is stale relative to DESIGN.md; refresh through Impeccable document in a separate requested task.
