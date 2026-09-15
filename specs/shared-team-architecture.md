# Shared team architecture workspaces

Status: implementation plan, saved 12 September 2026. Implementation has not started.

## Summary

Build a deploy-ready pilot supporting live architecture editing, private team workspaces and reviewed revisions.

Use **Supabase for Google authentication and PostgreSQL storage**, plus a **dedicated Node.js Hocuspocus/Yjs collaboration service**. Support 20 members per workspace and 10 simultaneous editors per architecture, with one collaboration server.

Extend the existing light docked editor. Local projects remain available without sign-in. Both diagrams and runnable architectures support collaboration; simulations execute independently against captured configurations.

## 1. Workspaces, identity and permissions

- Add a Local/Team switch to the project selector, workspace creation, architecture lists and member settings. Any authenticated user can create a workspace.
- Use four roles: **owner** manages membership and architectures; **reviewer** edits and approves revisions; **editor** edits and submits revisions; **viewer** reads and comments. All members can run simulations and export architecture copies.
- Owners create single-use invitation links bound to an email address and role, expiring after seven days. Acceptance requires Google sign-in with that verified email. Owners copy and distribute links; automated invitation emails are outside this release.
- Support role changes, member removal and ownership transfer. A workspace always retains one owner. Owners can archive architectures; permanent deletion and workspace deletion are deferred.
- Enforce membership and permissions in PostgreSQL row-level security and in every collaboration/API mutation. Client-side controls provide feedback but do not grant authority. Supabase supports combining Auth with database-enforced access rules. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Recheck permissions before accepting edits and disconnect removed members. Permission changes also invalidate active sessions; read-only connections cannot submit document changes.

## 2. Shared persistence and live editing

**Storage and interfaces**

- Add database entities for workspaces, memberships, invitations, architectures, document snapshots/update journals, immutable revisions, review events, comment threads and published results.
- Keep team data separate from the existing browser-local `Project` record. Introduce typed workspace roles, architecture references, collaboration connection state, team revisions and review status.
- Add authenticated HTTP operations for workspace management, invitations, architecture creation/archive, revision capture/submission/finalization, comments and result publishing. Mutations use request IDs for safe retries; authors and timestamps come from the server.
- Use one authenticated WebSocket document per architecture. PostgreSQL stores binary Yjs snapshots and an ordered update journal; immutable revision snapshots are stored separately as validated JSON.

**Editor integration**

- Refactor `src/state/editor.ts` behind local and shared editing adapters. Preserve local behavior; shared actions update individual document fields instead of replacing the entire project.
- Represent components, connections, notes and subsystems by stable IDs. Store positions atomically and configuration properties independently. Concurrent edits to different fields survive; simultaneous edits to the same scalar field converge using Yjs conflict resolution.
- Keep existing Apply/Cancel forms. If a field changes remotely while a form is dirty, require the user to review the new value before applying an overwrite.
- Keep viewport, selection, open panels and expanded views personal. Share authored content, layout, subsystem membership and configured workload. Presence displays authenticated names, cursors and selections without persisting them.
- Use per-session Yjs undo tracking. A drag or multi-component operation is one undo action; another member’s edits never enter the local undo stack. Yjs supports selective undo through transaction origins. [Yjs UndoManager documentation](https://docs.yjs.dev/api/undo-manager)

**Integrity and durability**

- Serialize document acceptance and revision capture on the server. Validate candidate updates before applying them: preserve existing structural limits, reject malformed payloads and prevent overlapping subsystem membership.
- Permit incomplete architectures while editing; executable validation still gates Run. Concurrent deletion removes affected connections, leaves unavailable note attachments explicit and preserves existing dormant subsystem-member behavior.
- Journal accepted updates durably before acknowledging them. Compact the journal into binary snapshots without losing its committed boundary. “Saved” means all local updates have a durable server acknowledgement.
- Implement authorization and update checks through Hocuspocus authentication/message hooks; do not rely solely on debounced document storage. [Hocuspocus hooks](https://tiptap.dev/docs/hocuspocus/server/hooks)
- On disconnection, disable further shared editing and preserve pending changes in a recovery outbox scoped to the signed-in account. Reconnect and reauthorize before retrying. Rejected changes remain recoverable as a local copy rather than silently disappearing.
- Whole-architecture replacement—restore, template or scenario change—requires confirmation and an unchanged server version. A stale request fails with a refresh message. Successful replacement is one undoable action; revision history remains intact.

## 3. Revisions, review and simulations

**Reviewed revisions**

- Capture revisions from a durable server state after pending edits are acknowledged. Record snapshot hash, authenticated “captured by” identity, server timestamp and existing revision details. This identifies the snapshot creator, not the sole contributor.
- Use the workflow **Draft → In review → Final**, with **Changes requested** as a review outcome.
- Submission assigns one current owner or reviewer other than the snapshot creator. That person can request changes or approve and finalize atomically. Self-approval is rejected server-side.
- Snapshot content is immutable. Addressing requested changes creates a linked replacement revision; comments and decisions remain attached to the original snapshot.
- Support revision-level and component/connection/note/subsystem comment threads, replies and resolution. Unresolved threads block finalization. Removed targets remain readable through the saved snapshot.
- Maintain one selected final revision per architecture while preserving previous finals. Finalization never freezes the live draft.
- Paginate team history instead of inheriting the local 20-revision limit. Reuse existing snapshot comparison logic, excluding personal viewing preferences from team change summaries.

**Independent simulations**

- Refactor `src/simulation/useSimulation.ts` so a shared-project run remains bound to its starting graph. Remote configuration changes do not reset that run.
- Display results with their captured architecture; label them when the live draft has changed. The next new run uses the latest configuration. Preserve existing local-project reset behavior.
- Keep active runs, playback and unsaved results personal. Editors and higher roles can explicitly publish a completed result with its exact graph and workload.
- Label published results as client-generated observations, not server-verified calculations. Preserve exact accounting, replay and comparison rules.

**Local projects and exports**

- “Copy to workspace” creates a new shared architecture from the current local configuration; it never moves or deletes the local project.
- Existing local revisions, checkpoints and results remain local. Publishing the current architecture does not convert self-reported history into authenticated team history.
- Retain version-7 local import/export. Shared current-state or selected-revision exports produce independent local copies without membership, credentials or team approval claims. Full team audit-history export is deferred.

## 4. Interface and delivery

- Add presence and connection/save status above the canvas, member settings beside the workspace selector, and a docked revision-review panel.
- Show clear states for connecting, saving, saved, reconnecting, read-only access and recoverable rejected edits. Disable unavailable actions with a reason.
- Preserve existing visual tokens and editor composition. On mobile, settings and review panels follow document flow; controls remain keyboard accessible and status changes are announced.
- Deliver Supabase migrations and access policies, local development fixtures, a collaboration-service container, environment examples, health/readiness endpoints and deployment instructions.
- Use one active collaboration instance, enforced through a database lease to prevent split-brain operation. Horizontal scaling is outside the pilot.
- Add structured operational logs for connection failures, denied actions, persistence failures and revision transitions; omit document contents and tokens.
- Live provisioning is separate. Google OAuth credentials, a Supabase project and production host settings are deployment inputs, not prerequisites for local integration tests.

## 5. Implementation order and acceptance

Implement in this order:

1. Shared contracts, database permissions and authentication.
2. Collaboration persistence, recovery and a two-client editing test.
3. Shared editor adapter, selective undo and personal simulation snapshots.
4. Workspace UI, invitations, revisions, comments and published results.
5. Full regression verification and deployment documentation.

Required acceptance checks:

- Two browser sessions converge after concurrent edits, dragging, deletion, undo and reconnect.
- Concurrent edits preserve structural limits and never overwrite an entire document accidentally.
- A server restart preserves every acknowledged change; storage failures never display “Saved.”
- Viewer writes, cross-workspace access, expired invitations, removed-member edits and self-approval fail through direct API/WebSocket attempts.
- Revision capture includes acknowledged edits exactly; later changes cannot alter the reviewed snapshot. Retrying finalization creates no duplicate final.
- Independent simulations retain their captured inputs and exact results while collaborators edit the live draft.
- Local projects, imports, exports, notes and existing revision behavior continue to work.
- Run unit tests, database-policy integration tests, production build and the complete production Playwright suite. Add multi-user desktop and mobile journeys.
- Exercise 10 concurrent editors on a maximum-size diagram, targeting p95 edit propagation below 500 ms under a documented 100 ms simulated network round trip.
- Document backup/restore and server restart procedures. Record verification results in `HANDOFF.md` and append the implementation summary to `ACTION_LOG.md`.
