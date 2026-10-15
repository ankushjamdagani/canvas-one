# AI collaboration: current workflow and product direction

Date: 2026-10-13. Scope: Canvas One's local AI collaboration, model-provider hook, proposal review, transaction integration, CLI/MCP and future collaboration contracts. Source-based assessment with three independent native Codex review lanes; no fresh browser or visual verification. No product behavior changed.

## Main finding

The application has a working, guarded AI proposal pipeline. The interaction still asks users to manage a bridge, an external agent and a review dialog. The biggest opportunity is to make collaboration a continuous canvas workflow: choose context, ask, observe progress, inspect a spatial diff, request changes, accept, and verify the result.

## Planning clarification — 2026-10-14

The current implementation draft is maintained in [AI collaboration plan](../ai-collaboration-plan.md). Its confirmed scope and pending decisions supersede the research roadmap below.

User subsequently authorized replacing/removing the existing AI flow. The current plan is problem-led; historical dialog, pairing and proposal-list behavior below is implementation evidence, not a requirement to preserve. Connection/setup and layout choices require explicit design and capability verification.

User confirmed in-app instructions through one specifically supported external agent, Suggest as the task default, and Stop preserving applied changes with a separate Undo task action. A bidirectional adapter is therefore current scope; a custom Canvas One agent remains future work.

Subsequent clarification expands the required integrations to Claude, Codex and agy, initially one active agent at a time. Explicit live-edit permission covers the whole current board for that task. Overlapping human edits pause the affected action for a decision; independent work continues. These choices supersede the earlier single-integration assumption.

Final flow choices: use local CLIs with existing sign-in and no API credential management; live permission includes deletion; reload/leave stops further board writes, saves progress and requires explicit resume. The plan records these as confirmed product decisions; technical CLI compatibility still needs verification.

The agent conversation/collaboration panel will be built in-house. Current work targets one human and one external agent on the existing canvas. Multiple humans, additional role agents, a custom model-backed agent, new drawing tools and simulation extensions remain future work. Earlier delivery-order suggestions below are research options, not approved implementation scope. Open-source adoption is optional and must simplify the current work.

### Hosting and model cost boundaries

| Scenario | Where costs apply |
|---|---|
| Current app, local bridge and an existing external agent | No additional collaboration-service subscription is inherently required. Existing app hosting, if used, and the external agent's subscription/API usage remain separate. |
| Collaboration server running on an existing computer | No cloud-hosting subscription is required; electricity, hardware and availability remain local responsibilities. |
| Future internet-accessible multiplayer | Compute for the collaboration server, database, asset storage, bandwidth and backups may incur costs. Existing infrastructure or suitable free tiers may cover early usage; do not assume they remain free at scale. |
| Future custom agent calling a model API | The selected provider's inference charges apply. An open-source agent SDK does not include free model inference. |
| Future custom agent using a local model | Hardware capacity, memory, electricity and possibly rented compute apply instead of a model API charge. |

Using open-source synchronization or agent libraries does not itself require purchasing the vendor's hosted service. No paid hosting, provider or pricing plan has been selected. Current work does not introduce a custom model service or hosted multiplayer deployment.

### Task terminology and minimal lifecycle

A task is one bounded piece of work assigned to an agent, such as “organize these selected notes.” It records the request, agent identity, board/context scope, permissions, progress/outcome and related proposals or applied changes. It is not a project-management ticket, a board commit, a chat message or an individual tool call. A task may produce several tool calls and several coherent editing actions; a conversation can contain several tasks.

Proposed minimal lifecycle: requested → working → waiting for input/review when necessary → completed. Stopped and failed are alternative outcomes. Requesting stop first prevents new actions and cancels queued/in-flight work where supported; report stopped only after acknowledgement. Already-applied changes remain until explicitly undone. A suggested task completes after its review outcome is resolved; a rejected proposal can close without board changes or lead to a revised attempt. Connection state is separate from task state; losing contact does not establish success or safe cancellation.

Pause/resume is optional and should only be presented when the connected agent supports it. Reading/thinking/checking are activity labels for the face, not separate durable task states. This lifecycle is proposed work and must not be described as an existing capability of every external agent.

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
