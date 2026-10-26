# Canvas conversations

Experience proposal · 2026-10-26 · not a runtime implementation.

## Recommended experience

Use one conversation model for human and AI contributions. Remove Task, Question and Feedback from the interface. A message can ask, correct, clarify or request changes; execution requests remain distinct internally for permissions, cancellation and audit.

The editable OpenPencil file has four pages, in order: canvas conversation, Suggest review, Live consent/conflicts, and presence/motion alternatives. These are static wireframes rather than functioning permission controls. Textual tool placeholders should become the existing Lucide tools and face primitives during implementation. Preserve the supplied State 01 file separately; it is not part of this proposal's source.

| Control | Contract |
| --- | --- |
| Read | Inspect, explain and navigate. No mutation plans, canvas change previews, write leases or writes. If asked to edit, explain the boundary and offer an explicit switch to Write. |
| Write / Suggest | Default. Can answer questions normally. For edits, render a detached, labeled preview and exact change summary; nothing applies before approval. |
| Write / Live | Nested under Write. Choosing it does not grant permission. Each editing request needs an explicit scope-specific permission action before any writes. |

The composer uses a Read/Write segmented control, with Suggest/Live in the Write menu. Permission is visible in the thread and attached to each attempt. A plain question in a Write conversation requires neither a new mode nor Live consent. A follow-up edit is a new request even inside the same conversation. Switching to Read fences current writes first, revokes the Live grant and invalidates unapproved mutation previews. A thread cannot increase permissions merely because an AI message says it can.

## Panels and direct editing

Comments becomes a panel in the same PanelHost as History and Library: identical placement menu, drag/dock behavior, resizing, collapse-to-rail, closing, keyboard operation and persisted geometry. Do not reproduce the independent AI-specific floating shell. Closing any surface retains drafts and execution; Stop is a separate action. Restore focus to the invoking control when a surface closes.

Comments is a shared index of human and AI threads. Rows show title, linked target, contributor, latest summary, unread status and actionable state. Include search, All/Unread/Resolved filters, and Locate/Open actions. Opening a row locates its anchor and opens its canvas thread. Do not maintain a separate panel transcript or second composer. New conversation creates a canvas anchor, or a board-level thread if explicitly chosen.

Keep Configuration on demand. Chat context does not replace precise capacity/protocol/latency controls, multi-edit, validation errors, or the existing isolated Apply/Cancel draft workflow. Selection alone need not automatically open Configuration. Offer Configure on the selection toolbar and command menu. This follows the existing Inspector's draft contract in `src/features/inspector/InspectorPanel.tsx`; removing it would remove deterministic editing.

On narrow screens, Comments and the active thread use one bottom sheet with list/thread navigation and draft preservation. The canvas retains its anchor. This is an alternate viewport of the same conversation, not a new thread. Keep the composer above the keyboard, allow message scrolling independently, and return to the list with Back. At low zoom, keep bubbles legible in screen pixels and cluster nearby pins with an accessible list; do not render microscopic expanded chats.

## Comment objects

Introduce a conversation/comment annotation, distinct from a sticky note. Sticky notes remain authored board content; comment annotations own an ordered shared conversation, participants, scope and read/unread state. They never affect simulation manifests or graph connectivity.

- A thread has a stable ID, title, creator, participants, ordered messages, resolved state, anchor and target IDs. Messages include stable ID, author kind/identity, timestamp, safe Markdown source and structured activity/attempt references.
- Scope is one object, an explicit set of object IDs, or the whole board. A visual group is expanded into explicit target IDs for each request. Group membership changes do not silently expand an in-flight grant.
- The composer shows linked-target chips. New selection is offered as an explicit Use selection action; it never silently changes an existing thread's scope. Clicking a chip locates the target. Board context is explicitly labeled.
- A spatial anchor is presentation metadata. Moving it does not move diagram objects. Object anchors follow their targets; multi-target threads use a stable anchor and reveal the whole set on demand. A deleted target leaves an orphaned thread with its last known name and a Reattach action; never silently retarget or delete its history.
- A collapsed bubble shows thread identity, count/unread state, and an AI face when AI is working. Expanding opens the same thread with human and AI messages in chronological order. Resolve/reopen is separate from completion and never cancels work. Deletion/archive of an active thread requires stopping its attempt first.
- Input preserves raw Markdown while rendering safe formatted messages after send: headings, lists, emphasis, links, fenced code and tables. Sanitize rendered output; raw HTML and tool-supplied instructions are not executable. Tool results are data, not permission.
- Human-only comments do not automatically trigger AI. Provide an explicit Ask AI/mention action; an AI-engaged thread keeps that recipient visible in its composer. No Task/Question/Feedback categories are introduced.

## Expanded AI experience

Messages stream into one stable assistant turn with factual activity such as Inspecting Checkout API or Preparing 2 changes. Show brief tool summaries inline; disclose tool name, targets, timing, status and sanitized result on demand. Do not display hidden chain-of-thought or invent activity from elapsed time. Preserve operation IDs and result receipts for diagnosis without flooding the transcript.

The composer shows the current attempt's face and activity; Send becomes Stop for that represented running request. Users can still compose while work runs. Sending an edit while the scope is busy queues a new request. An independent question may run read-only against a clearly identified snapshot. A correction that changes the running request must stop/revise or queue explicitly; it cannot overwrite the original request and reuse its consent.

Suggest renders before/after previews in a detached presentation layer. Additions, updates and deletions have text/icon distinctions, not color alone. Selecting a preview focuses its exact change. Approve applies the whole reviewed set atomically; Reject removes that preview and releases its lease. A reply requesting revision produces a new proposal and approval identity. Avoid partial approval until dependencies between changes are supported.

Live consent names the request, target IDs/current names, allowed action classes, deletion allowance and current revision. Provide Allow Live for this request and Use Suggest instead. Scope expansion or a newly required delete pauses for fresh permission. Stop revokes authority before cancellation. Completion, failure, cancellation, ownership loss and disconnect revoke the grant. Reload/reconnect never silently resumes Live. Resume rereads the board and asks again.

## Concurrency and human edits

Comments do not lock objects. Read-only work can run concurrently. Acquire a mutation lease for the actual planned write scope before preparing mutation previews or applying writes. The contract can initially remain conservative with one board writer, as current execution does; parallel disjoint writers are a future capability, not claimed support.

For the evolving model: object-set writes conflict when their footprints overlap; a global mutation lease conflicts with every mutation lease. Connections, group descendants and referenced records count in the dependency footprint. Acquire a set atomically to avoid deadlocks. The later conflicting request waits with a link to the earlier thread; it does not preempt earlier work. A pending Suggest approval holds its write scope until approved, rejected, revised, invalidated or explicitly canceled. No automatic timeout may apply it.

When released, queued work must reread targets and revision, recompute its footprint and validate again. A global request does not begin its mutation plan until prior writes and pending approvals finish. Human edits remain available: a human edit to the relevant footprint invalidates the preview or pauses Live before its next write; it must never be overwritten by a stale AI snapshot. Compare-and-set validation remains the last line of defense even when leases are held. Stop/failure releases runnable leases after write fencing; unresolved review/held-action records remain explicit and cannot become active writes on recovery.

## Presence and motion

Prefer two labeled groups in the same header: People (photo/initial avatars) and AI (existing face primitive). A thread color is stable across its avatar, bubble, activity and preview; reserve amber/error/completion badges for state so identity colors do not change meaning. Each active AI conversation has its own avatar, even when the provider is the same. Tooltip/accessibility name includes thread title, provider, targets and state. Clicking locates/opens its thread. Overflow becomes +N with a searchable thread list.

| State | Bubble and avatar | Object behavior |
| --- | --- | --- |
| Idle/read-only | Static identity/unread badge; working read activity may animate the face | No object animation |
| Preparing/applying a scoped mutation | Factual working expression and activity | Only actual write targets get a subtle bounded treatment |
| Needs approval/clarification/permission | Two soft pulses on entry, then persistent action icon and label | Stop working motion; preview stays static |
| Waiting for conflict | Static pause expression and dependency label | No animation |
| Complete | One brief transition to success tint, check icon and unread marker | Settle immediately |
| Failed/stopped/disconnected | Static error/stopped status with relevant Retry/Resume action | Clear mutation animation immediately |

Motion priority: expanded active thread, otherwise its visible bubble, otherwise its header avatar. Only one of these animates for a given attempt; header badges still update. Globally limit simultaneous working motion to the foreground conversation, with static states for background work. No repeated bouncing, whole-object scaling, viewport panning or focus stealing. Use existing motion tokens and face components, a bounded pulse around 600ms repeated twice, and a completion tint transition around 250ms. Reduced motion uses static icons/text. Announce meaningful state changes politely, not every token or tool event. Persist action-required until answered and completion-unread until the thread is opened; color alone never carries meaning.

Alternatives: (1) one AI avatar/count opens an active-thread list, quieter at high concurrency but hides individual expressions; (2) a compact AI activity rail, clearer for many threads but consumes canvas space; (3) optional floating AI launcher, useful for Ask about selection, Start conversation, Locate active work and Walk through. The launcher always routes into the same threads and permission flow. It is not a free-roaming mascot, second transcript or global Live switch. Recommend grouped header avatars first and the launcher as an optional shortcut.

## Implementation boundaries and acceptance

Source inspection confirmed PanelHost/PanelHeader already own docking, placement, collapse, close and keyboard routes. Inspector owns isolated drafts. Current collaboration uses durable requests, exact-attempt Live permission and one board editing task. Reuse those authorities; multiple avatars in a mockup do not imply concurrent mutation support.

Before shipping, demonstrate: a question inside Write; Read rejecting mutation previews; approval changing no data before click; stale approval rejected; Live consent not reused by a follow-up; scope/delete expansion requesting permission; Stop fencing writes; human edit conflict; overlapping and global requests waiting; disjoint behavior matching implemented scheduler capability; close/reopen preserving execution and drafts; orphan anchors; Markdown sanitization; long transcripts and tool errors; reload requiring Resume; keyboard/screen-reader and reduced-motion flows; narrow-sheet keyboard bounds; no animated objects during read or wait. Additive persistence must preserve authored documents, IDs, provenance, existing approvals, undo and database names. Comment data stays outside simulation fingerprints/manifests. Real multiplayer ownership and conflict scheduling need implementation and validation before being advertised.

The action contract is in `.agents/skills/canvas-collaboration/SKILL.md`. Its planned capabilities are proposals, not newly installed tools. Extend that contract as capabilities ship rather than inventing undocumented tool calls.
