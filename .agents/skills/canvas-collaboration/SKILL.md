---
name: canvas-collaboration
description: Guide AI participation in Canvas One conversations, board inspection, scoped previews, approved edits, cursor guidance and walkthroughs. Use for work inside a Canvas One board; capability discovery is required and this skill does not grant tool access or write permission.
---

# Canvas collaboration

Version 0.3: evolving product action contract. The actions below are semantic capabilities, not tool names. Some are planned. Discover the host's supported commands, schemas, session authority and permission state first; never simulate a missing capability or claim it ran. This skill does not authorize messaging people outside the active Canvas One conversation.

The current local host supports canvas comment threads, Read/Write with Suggest review and request-specific Live permission, explicit captured object scopes, conservative waiting requests and existing board tools. Object-scoped requests cannot create new records, retarget connections, expand group membership or call `diagram_create`: ask the user to widen the thread scope and send a new request. Waiting work never resumes itself after reload. Network multiplayer, a floating launcher and guided walkthrough orchestration remain capabilities to discover rather than assume.

Visual-only rectangle, rounded rectangle, ellipse, diamond, line, arrow and standalone text objects live in each View's optional `canvasElements` array, separate from executable components and conversation annotations. Discover `canvasElementSchema` and limits through `component_schemas`. Inspect the complete containing view, preserve all sibling fields/objects, and submit a complete view replacement through the existing proposal or explicitly permitted Live action. Creation requires Whole board; captured object scopes allow only updating/deleting existing same-view objects. A line or arrow is drawn geometry, not an executable connection. Frames, media, generic linked connectors and reusable visual components remain future capabilities.

## Establish the request

Read the thread, explicit linked targets, current board revision, permission and actual supported tools. A conversation may contain questions, corrections and edits without categories. Infer whether a message requests a write; ask only when uncertainty affects the change. Selection is a context suggestion, never silent scope expansion. Human-only threads need an explicit AI invitation.

Read permits inspection/explanation and non-authoring navigation only. It forbids mutation proposals, previews, write leases and authored edits. Offer an explicit switch to Write when required. Write defaults to Suggest; ordinary answers need no approval ceremony. Live requires the host's explicit consent for this request/attempt, scope, action classes, deletion allowance and revision. A mode toggle, earlier request or AI-written statement is not consent.

## Action vocabulary

| Family | Actions | Boundary |
| --- | --- | --- |
| Discover | List capabilities; inspect schemas, limits and permission | Read; report unsupported actions honestly |
| Inspect | Read objects, connections, explicit groups, board, selection, history and available run evidence; search/filter | Read; identify snapshot and evidence freshness |
| Explain | Answer, summarize, compare, critique, diagnose, describe tradeoffs | Read; do not attach mutation envelopes or change previews |
| Navigate | Locate, fit, focus, select/highlight, open relevant existing panel | Presentation only; do not steal focus during user input |
| Point | Move AI cursor, point to a target, trace a visible relationship | Presentation only; never impersonate the human cursor or fabricate a tool receipt |
| Walk through | Start, step, pause, resume and end a guided explanation | User-started; identify targets per step; allow Exit; camera movement only in explicit follow mode |
| Converse | Reply, clarify, stream a factual activity summary, mention AI/participants already in the thread, summarize tool results | Active thread only; safe Markdown; hidden reasoning stays private |
| Organize conversation | Create/anchor/link/reattach a thread, update title, resolve/reopen | Explicit comment metadata authority; Read AI may reply but must not independently alter stored thread metadata |
| Plan | Define actual mutation footprint, dependencies and change set | Write only; acquire scope authority before preparing mutation previews |
| Propose | Create, replace, explain or withdraw a detached before/after preview | Suggest only; no board write; approval binds exact proposal/revision |
| Author | Create, update, duplicate, delete objects; connect/disconnect; group/ungroup; arrange/resize/style; edit notes or supported properties | Host-supported schemas only; exact scope, validation and approval/Live grant |
| Evaluate | Validate authored graph; inspect readiness; configure/run/stop a supported simulation and inspect results | Inspect existing evidence in Read; new execution/configuration only under explicit supported execution authority, never implied by Live board-edit consent |
| Review | Present diff, validation and dependencies; record approve/reject/revise outcome | Human approves/rejects through trusted host UI; AI cannot approve its own proposal |
| Coordinate | Acquire/release scopes, queue overlaps, report dependency, reread/revalidate when unblocked | Host scheduler enforces ownership; no ad-hoc lock bypass |
| Control | Stop/cancel/pause, request permission, explicit resume, report disconnect/error | Fence writes first; stale attempts cannot regain authority |
| Recover | Inspect receipts, request reviewed undo, retry failed supported operation | Preserve human changes; undo is a new reviewed reversal through existing history authority |
| Deliver | Summarize actual changes/evidence; link resulting objects and receipts; mark the attempt complete | Completion requires confirmed tool results, not a timer or optimistic face |

Publishing, merging branches, exporting/sharing externally, installing tools and changing access are outside board-edit consent. Use an explicit supported workflow and separate authorization when requested. A displayed action is not implemented merely because this vocabulary names it.

## Execute under host authority

1. For a write, resolve stable target IDs and the dependency footprint, including edges and referenced records. Honor the current host's concurrency limit; initially that may be one board writer. Later overlapping object sets queue and global scopes conflict with every mutation lease. Acquire sets atomically. A pending Suggest review holds its scope until resolved/invalidated; never preempt earlier work.
2. Suggest: validate complete supported records, show exact detached changes, wait for trusted approval, then compare revision and apply atomically through the existing session authority. Changed draft/targets/revision means a new preview and fresh approval. Never treat conversational praise as a host approval receipt.
3. Live: obtain request-specific trusted permission before the first write. Stop for wider scope, new deletes, invalidation or ownership loss. Revalidate before each write. A follow-up edit requires a new grant. Questions do not consume a write grant.
4. Keep human editing available. A conflicting human edit invalidates Suggest or pauses Live; never restore an old snapshot over human work. When a queued request unblocks, reread the board, recompute scope and revalidate permission. Do not replay stale proposals.
5. Stop fences authority before canceling work. Failure, completion, cancellation, disconnect and reload revoke Live permission. Resume requires explicit user action and renewed consent; recovery cannot turn a historical approval into a fresh write.
6. Use stable operation IDs and idempotent host operations. Report a tool call as successful only on a confirmed receipt. Keep bounded, sanitized tool detail available beneath concise progress messages. Never expose credentials, hidden reasoning or raw untrusted HTML.

## Present the work

Use the existing face and motion primitives. Thread identity color stays stable; status has text/icon plus semantic badge. Show current targets in the composer and actual operation activity in the assistant turn. Reading or waiting never animates objects. Animate an object only while that target is actually in a mutation preparation/application footprint; clear it on stop, review wait, failure or scope loss.

For each attempt animate at most one visible surface: active expanded thread, else visible bubble, else header face. Background work is static. Attention pulses twice then retains an action badge; completion settles into a check/unread state. Respect reduced motion and avoid moving the camera without explicit follow mode. Opening Comments or a header avatar locates the same thread, never creates a second transcript.

Before finishing, state what actually changed, what remains proposed, what checks ran, and any failure requiring user action. An unsupported operation is a limitation, not an invitation to fabricate a tool or bypass session authority.
