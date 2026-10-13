# AI collaboration product and implementation plan

Updated: 2026-10-14. Status: confirmed product decisions, explicit design choices to resolve, CLI feasibility partially probed; complete three-agent verdict pending. Production implementation has not started.

This plan replaces earlier AI-flow preservation/migration assumptions. The current AI collaboration UI, setup and protocol may be removed or replaced. Existing code is reusable only when it satisfies the intended experience. Preserve recoverable user content and durable attribution; retaining an old interaction is not a requirement.

## Problem and desired outcome

A person should ask for help inside Canvas One, see an agent work on the board, understand the result, refine it and remain in control of changes. Setup, conversation, review, editing and recovery should form one coherent experience.

Canvas One is a general whiteboard. Architecture diagrams are the initial use case. Specialized validation and evidence are optional extensions; core structural integrity, permissions, review and commits work without simulation.

## Confirmed user decisions

| Topic | Requirement |
|---|---|
| Conversation | In-house panel; instructions and responses inside Canvas One |
| Agents | Claude, Codex and agy; local CLIs with existing sign-in |
| Initial scheduling | One active editing task per board; concurrent agent work is future scope |
| Initial execution devices | Desktop agent execution first; design mobile states now; phone-to-desktop execution is future scope |
| Credentials | No API credential management or custom model service now |
| Default permission | Suggest; no authored mutation until acceptance |
| Live permission | Explicit grant per task for the whole current board, including creation, modification and deletion |
| Human overlap | Pause the affected action and ask; independent work continues when safely separable |
| Stop | Block further board writes; keep completed changes |
| Undo | Separate Undo task; preserve subsequent human work or show a reviewed revert |
| Reload/leave | Save progress, prevent further writes and require explicit Resume |
| Identity | Brand logo-face cursor expressing actual activity |
| Saved versions | Commits; no additional user-facing checkpoint concept |
| Future scope | Multiple humans, concurrent role agents, custom agent, new shapes/freehand and optional specialized extensions |
| Existing AI flow | Free to replace/remove; no legacy-flow compatibility requirement |
| Open source | Optional, only when it simplifies the required work |

Supporting three integrations now does not mean implementing concurrent multi-agent orchestration. The user confirmed one active editing task per board on 2026-10-14. Multiple agents remain selectable; concurrent role workflows are future scope.

## Core interaction model

### Conversation, task and proposal

Conversation is the continuous interaction. A task is one bounded request with its agent, board, permission, progress and related changes. A proposal is a coherent candidate change set belonging to a task. Ordinary questions need not create an editing task.

Show a compact active-task anchor with agent identity, factual activity/status, starting context, permission and task controls. Keep it visible during conversation scrolling. Present proposal details in flat sections rather than nested cards or a separate task-management dashboard.

One feedback composer must visibly identify its target: ordinary conversation, new work or revision of a specific proposal. Request changes preserves the task/proposal lineage whichever composer placement is chosen. Sending a second instruction must not silently replace active work, queue new edits or inherit live permission; define its target and handling explicitly in the final interaction design.

### Context and authority

Show separate labels such as “Context: 3 selected items” and “Mode: Suggest” or “Live edits: entire board, including deletion.” Selection is starting context, not a restriction on the live-edit grant. Further permitted context retrieval is visible and omitted context is reported.

Explain board-wide authority when the user grants live permission. Do not add another deletion approval. Future tasks start in Suggest again. Bind authorization to task and board/project/branch identity; switching agents or boards cannot transfer it.

### Spatial review and revision

Display proposed additions, modifications and removals on a detached canvas layer alongside a semantic change list. Use shape, labels and line patterns as well as color. Removed content remains inspectable in the comparison instead of disappearing from the preview. Provide before/after and explicit fit-to-changes; never move the user's viewport automatically.

Accept applies a validated coherent change set. Reject preserves review history and writes nothing. Request changes shows delivery, acknowledgement or failure, then a linked revision. Acceptance is undoable. Avoid arbitrary partial acceptance unless a validated dependency-aware candidate is produced.

Validate acceptance against the current board. If intervening edits change the proposal's meaning, show the revised differences for another decision rather than applying an outdated preview.

### Live work and overlap

Apply coherent actions that leave a valid board, with attributable task history and truthful face focus. Keep Stop available. Show intended changes when actually reported; do not fabricate counts or internal reasoning.

When human work conflicts, use a non-blocking visible notice plus a persistent task indicator. Show the human version and agent intent. Offer keeping the human edit/replanning or explicitly reviewing the agent alternative. Do not make a generic “Resume agent” action authorize an overwrite. Revalidate after the decision. Pause the larger operation if independent actions cannot be separated safely.

The board authority enforces this pause by holding or rejecting the affected write. It does not depend on whether the CLI supports pausing model execution; provider Pause is a separate optional control.

### Stop, Undo and recovery

Stop immediately revokes board-write permission and separately reports whether agent execution cancellation is acknowledged. Completed edits remain; state that concisely without another confirmation. Disconnect is a connection control, not a substitute for Stop or Undo.

Undo task reverses that task's attributable changes against current state. Preserve interleaved human edits. When dependencies prevent a safe reversal, show a coherent revert for review rather than merely disabling Undo or restoring the entire old board.

Interrupted recovery shows task/agent identity, previous permission, completed changes with inspectable differences, pending reviews and relevant board changes since interruption. Resume itself acknowledges this summary; no read-detection or checkbox. Revalidate before renewing writes. Unsupported process continuation may require a new execution attempt with the same task identity and deduplicated effects.

Departure protection must handle crashes and lost connections as well as normal navigation. Use execution-side write fencing and a bounded liveness mechanism; verify its cutoff behavior rather than relying on a browser unload callback.

Task activity records progress and attributable changes automatically. Commits are intentional saved board versions; finishing a task does not require a commit, and Undo task records a reversal without deleting history.

## Required user journeys

| Journey | Outcome and essential states |
|---|---|
| First use | Understand local prerequisites, select an available agent, connect, see readiness and send an instruction |
| First suggestion | See starting context and Suggest mode, observe activity, inspect spatial differences and decide |
| Refinement | Target a proposal, send feedback, see delivery outcome and inspect its revision |
| Live task | Grant board-wide authority, observe valid actions, resolve overlaps, finish or Stop |
| Undo | Inspect completed task changes, reverse safely or review dependency-aware revert |
| Recovery | Return to interrupted work, understand what happened and explicitly Resume |
| Mobile design | Design composition with keyboard open, canvas/conversation/review switching and reachable controls; execution requires a compatible agent host, and phone-to-desktop connection is deferred |
| Agent/board switch | Understand active-work handling; authorization never follows silently |

Connection errors distinguish missing CLI, sign-in problem, unavailable local service, transport failure and incompatible version with a concrete next action. Pairing-code errors are relevant only if the chosen setup uses codes.

## Layout and state specification

The board stays dominant. Design how conversation, active-task summary, proposal review, library and inspector coexist so inspecting a node does not erase review context. Compare dock compositions with real content; no right-dock/tab-sharing pattern is presumed approved.

Define open, minimized and closed panel behavior, focus return and resizing. Panel visibility does not determine task execution. Show discoverable pending/activity indicators when minimized. Mobile uses a deliberate sheet or dedicated view, not a scaled desktop panel; grant disclosures and actions remain clear above the keyboard.

Specify observable task states including requested, working, waiting, interrupted, completed, stopped and failed. Keep connection diagnostics, feedback delivery and face activities separate from durable task state. Pause is offered only when supported. State taxonomy is a contract to design and verify, not a claim about existing CLIs.

Current-state coverage: first use/readiness/errors; idle composer; questions/clarifications; active work; suggestion/detailed differences; revision delivery; accepted/rejected; live grant/live work; overlap; stopping/stopped; undo/revert; interruption/resume; stale/invalid/failed; minimized/long content; switching agent/board. Verify desktop and 390 px mobile, keyboard/focus, non-color cues, screen-reader status, touch targets and reduced motion.

## Explicit choices and evidence gates

| Not yet established | How to resolve it |
|---|---|
| Desktop dock and inspector relationship | Compare layouts while inspecting and reviewing the same change; choose the clearest composition |
| Feedback placement and second-message behavior | Prototype targeted composer/inline feedback; specify clarify, revise, explicitly visible staged work or new-task behavior |
| Connection bootstrap and browser-to-CLI transport | Compare practical local service launch/connection options; verify secure authorization and recovery; existing bridge/code fields are not mandatory |
| CLI capability | Verify installed Claude/Codex/agy interfaces, sign-in, messaging, board tools, events, feedback, cancellation and restart; enforce the confirmed one-active-editing-task-per-board rule |
| Safe overlap reconciliation and task Undo | Prove with interleaved human edits, deletions and dependencies; do not claim unrelated work can always continue |
| Persistence and interrupted execution | Verify recoverable state, write revocation on abrupt departure, deduplication and explicit resume |
| Engine/runtime reuse | Reuse where contracts fit; do not introduce competing writable board authorities |

Local CLI access requires a local execution boundary; a browser cannot launch arbitrary local processes on its own. That constraint does not mandate today's manual pairing flow. Setup must honestly describe any necessary install, sign-in or terminal handoff. Desktop launcher/automatic installation is not confirmed scope.

A phone's loopback address reaches the phone, not the desktop running the CLI. Desktop execution is current scope; mobile design coverage does not imply a working remote execution connection. Prepare the provider boundary for future authenticated phone-to-desktop access without exposing the local service publicly now.

All three integrations must meet required in-app conversation and board-work behavior. An incapable adapter is a documented blocker needing a scope decision, not silently accepted limited mode. Optional progress/pause features may differ visibly. No unverified compatibility claims.

## Delivery sequence and completion evidence

| Step | Deliverable | Gate |
|---|---|---|
| 1 | User journeys, state map, layout/composer exploration and three-CLI feasibility | Resolve choices above that affect architecture; versioned common adapter contract with evidence |
| 2 | Local connection/execution boundary, task authority, persistence and cancellation | Reliable diagnostics; revoked tasks cannot write; recoverable records and deduplication |
| 3 | In-house conversation, active-task anchor, three integrations and face presence | In-app prompts/responses/feedback; truthful state and accessible desktop/mobile composition |
| 4 | Spatial review, revision loop and interruption recovery | Clear added/changed/removed content; no Suggest writes; explicit decisions and validated Resume |
| 5 | Live editing and overlap resolution | Board-wide create/update/delete within task authority; no silent human overwrite |
| 6 | Task Undo, commits/history, retention and complete flow checks | Safe revert preserves human work; no history-driven queue exhaustion; all three integrations pass |

Remove or replace superseded AI UI/controllers/protocol pieces when a replacement satisfies these gates. Repair an old bug only if the affected path is retained or its risk also exists in the new design; legacy fixes are not blanket prerequisites. Preserve user data and operation provenance, use one authored authority, and reuse established foundation/brand assets. Engine replacement and unrelated workspace redesign are not justified merely by replacing AI flow.

Verify proportional unit, production build, Storybook and browser checks for actual changes. Focus on correctness and complete journeys rather than tests that mirror implementation.

## Success and acceptance measures

Required: Suggest never writes before acceptance; task permission never leaks across scopes; Stop/departure prevents queued or late writes; feedback outcomes are truthful; recovery never resumes silently; Undo does not erase subsequent independent human edits; all controls stay reachable on desktop/mobile.

Establish user-testing baselines for first-proposal time, setup completion, decision/abandonment rate, successful revision, conflict friction, recovery completion and reasons for Stop/Undo. Do not impose invented percentage/timing targets or assume Undo indicates failure. No external telemetry platform is required.

## Future work: design seams, not current controls

| Future capability | Prepare now | Defer |
|---|---|---|
| Human multiplayer | Participant attribution, conflict/Undo contracts and provider boundary | Hosting, synchronization and concurrent editing |
| Concurrent role agents | Separate identity/role/permission, task references and explicit handoff targets | Role orchestration and parallel-agent UI |
| Custom agent | Versioned discoverable board tools and neutral conversation/task adapter | Model service and agent-specific training/knowledge work |
| Shapes/freehand/general domains | Neutral extensible content/editor contracts; generic review and history | New drawing tools, engine migration and domain features |
| Specialized evidence | Optional extension discovery and validation/evidence slots | Simulator and domain evidence integrations |
| Hosted accounts | Explicit authorization boundary | Account platform, invitations and deployment |
| Phone-to-desktop execution | Explicit agent-host availability and transport boundary | Authenticated remote connection and desktop-host lifecycle |

Future designs include participant density/offscreen cursors, role handoffs, shared history and dependency-aware reversals, drawing alongside agents, optional/unavailable evidence and offline recovery. Keep them in a separately labelled concept set. Do not put inactive future controls into the current interface or build unused frameworks.

## Open-source options and costs

Retain existing components when they serve the new experience. Evaluate official MCP SDK for protocol plumbing only if useful; it does not choose setup or permissions. No forced library adoption.

Future shortlist: Yjs/Hocuspocus or authoritative command server; Plait/Excalidraw or existing-editor extensions; perfect-freehand; Dagre/ELK; AI SDK; LangGraph; Better Auth. The panel remains in-house.

Existing external-agent subscriptions/usage and any app hosting remain separate. Public multiplayer may add compute/database/assets/bandwidth/backup costs; local services use local hardware/electricity. A future custom agent adds inference or local compute costs. Open-source libraries do not mandate vendor hosting. See [cost notes](audits/2026-10-13-ai-collaboration.md#hosting-and-model-cost-boundaries).

## Review traceability and status

[CLI feasibility and adapter contract](ai-collaboration-cli-feasibility.md) records local evidence, integration recommendations and remaining proof obligations. Recommendations about bootstrap and second-message handling are distinct from confirmed product choices.

[Claude PM review](audits/2026-10-14-claude-pm-review.md) and [Claude UX review](audits/2026-10-14-claude-ux-review.md) inform this plan. Adopted: complete journeys, active-task anchor, separate context/authority labels, targeted feedback, accessible spatial differences, explicit panel/inspector design, non-blocking overlap and recovery presentation.

Qualified: no dropped integration, separate deletion approval, task-card nesting requirement, read-confirmation checkbox, invented progress, terminal-free setup promise or assumed right-dock pattern. Archived reviews are historical evidence, not current requirements.

Current AI-flow replacement is authorized. Current work adds planning, delegation configuration and isolated CLI feasibility checks; no production implementation, deployment or project dependency installation has occurred. The installed Claude Code CLI was upgraded via Homebrew to use the requested Opus 5.5 reviewer; Homebrew also ran automatic cleanup. The design-generation prompt is supplied in conversation and is not retained as a repository file. Remote Git publication remains subject to the earlier rejected push; authorization to share content with Claude does not authorize a Git push.
