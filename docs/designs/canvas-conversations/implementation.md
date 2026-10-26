# Canvas conversations implementation

The OpenPencil proposal is now connected to the existing application. This document distinguishes the shipped local experience from the broader collaboration roadmap.

## Experience

- Comments uses the same `PanelHost` as History, Library and Configuration, including docking, floating, resizing, collapse, keyboard placement and persisted geometry. It indexes threads rather than maintaining another transcript.
- A conversation is an annotation separate from sticky notes and diagram records. Create one for the selection or whole board, post safe Markdown comments, and explicitly invite AI. Open the same thread from its pin, Comments, or its AI header avatar. Closing a surface preserves draft text and execution.
- The composer offers Read and Write. Write defaults to Suggest; its menu contains Live. Task, Question and Feedback are no longer user-facing categories. A normal message can answer a question, clarify an outstanding request, revise a proposal, or start new work.
- Suggest retains the existing detached before/after comparison, atomic approval, revision validation and reviewed undo. A pending proposal also appears as a labeled detached canvas preview on sufficiently wide screens.
- Live permission identifies the exact request, attempt, captured scope and displayed board revision. Follow-ups start with Suggest authority. Read downgrade fences existing editing attempts before asynchronous cancellation and removes pending mutation previews. Returning an active Live request to Suggest stops its grant before the behavior control changes; the next message starts a fresh request.
- People and AI have separate header groups. The current local actor is real; the previous illustrative avatars and Live indicator were removed. Every AI-engaged thread has a stable identity color and factual status. The foreground face, finite attention pulse, completion tint and reduced-motion state avoid repeated background motion. Objects receive working treatment only for an actual applying operation on those targets.

On phones, one fixed-size collaborator control opens separate People and AI groups in a portal menu. This keeps four or more conversations reachable at 320px without displacing the project, draft, History, theme or Quick options controls. Node cards explicitly refresh their engine handle measurements after presentation/selection changes, so an unchanged outer card size cannot leave a visible connection handle unregistered.

## Storage and authority

`CanvasConversationStore` owns local annotation metadata in the additive `canvas-one-conversation-annotations-v1` IndexedDB database. It does not change authored board IDs, simulation inputs, manifests, fingerprints, history or the existing task/action databases. Human messages, last-known target names, anchors, task links, resolution, unread and queued requests survive reload. Transactions reread the board metadata before changing it; BroadcastChannel refreshes other tabs.

Comments are project/board scoped so creating a draft preserves the thread and composer. AI tasks remain branch scoped under the existing controller. Waiting editing requests capture their original branch and targets; a different branch cannot silently consume them. Attachment and queue consumption commit before provider launch. Recovery shows failed/interrupted work rather than launching it automatically.

The existing one-board-writer authority remains conservative: another editing conversation waits, including while a Suggest review is pending. Once released, the user explicitly sends the waiting request. Its new task rereads current board state and needs fresh Live permission. A Read thread can inspect concurrently. There is no claim of disjoint parallel mutation support.

Object-scoped requests capture explicit IDs, selected group membership and existing dependent connections once. Mutation tools and acceptance enforce that footprint, including view placement changes. Changing selection does not expand it. New objects, retargeted connections, expanded group membership and `diagram_create` require an explicit wider/whole-board conversation and a new request. Missing targets require reattachment. These conservative restrictions intentionally reject scope expansion rather than guessing permission.

## Boundaries

This remains a local-first application. Comments and presence are not a new network multiplayer service; other signed-in people's avatars and cross-device comment delivery are not fabricated. Annotation metadata is not included in the existing authored-document export format. A supplied custom canvas host must implement the optional conversation render slot to display pins and threads. Configuration retains its deterministic Apply/Cancel editing workflow.

The action skill remains an evolving semantic vocabulary. Capability discovery is mandatory. Guided walkthrough orchestration, a floating AI launcher, clustered pins and collaborative server synchronization are not newly installed tools or advertised working features.

## Verification

Production/browser evidence covers setup, Suggest and stale review, exact receipts, Live/human conflicts, Stop, recovery, Markdown safety, independent Read work, shared panel behavior, human comment persistence, queued conflicts and object scope. Unit and Storybook checks exercise authority, additive storage and permission controls. Final command results and limitations are recorded in `ACTION_LOG.md`; the opt-in paid-provider browser test is not represented as real-inference coverage when skipped.
