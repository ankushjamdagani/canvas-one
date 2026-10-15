# AI collaboration implementation review

Status: implementation verified in `codex/ai-collaboration-analysis` and prepared for draft review. The full three-agent release remains blocked by agy's scoped board-tool transport. The supplied HTML design stays ignored and must never be committed.

## Implemented current scope

- In-app instructions and conversation through locally signed-in Claude/Codex CLIs, with factual logo-face presence and a shared AI/Inspector dock. Closing the dock preserves work and unsent drafts.
- Durable board-scoped tasks: Suggest by default, explicit attempt-bound Live permission including deletions, one editing task per board, separate read-only questions, and explicit Resume after departure.
- Reviewable proposals and detached before/after previews; overlap decisions protect human edits while validated independent work continues. Stop fences board writes before waiting for process-close acknowledgement.
- Atomic task journals for Live and accepted Suggest changes. Undo prepares a reviewed reversal and preserves subsequent and interleaved human edits.
- Additive IndexedDB version 4 archives complete conversation artifacts behind a bounded recent view. Open reviews, held actions, starting context and exact clarification identities survive compaction and reload. Older-history windows state their gaps and provide Return to recent.

Future multiplayer, concurrent role agents, custom agents, drawing tools and optional simulation/evidence extensions remain future work. No inactive future controls were added.

## Review and verification evidence

The lead used native implementation lanes with separate file ownership, plus the repository-configured Gemini critic and Claude Opus 5.5 reviewer. This was a mixed workflow, not a wrapper-dispatched executor run. Raw inputs, full outputs and diagnostics remain ignored under `.delegate/runs/20261014-implementation`.

Opus foundation review passed. Subsequent integration reviews found revision races, cancellation/reconnect defects, startup ownership loss, archived decision loss and paging gaps. These findings were incorporated. The last Opus verdict still reported three paging defects; the lead reviewed their corrections and regression tests. There is no final independent whole-release approval claim.

Final verification:

- Full units: 2,360 passed, 12 skipped; final controller recovery/Undo check: 51 passed.
- Production build, all 16 package builds, package-boundary/headless-import checks and final Storybook build passed.
- Fifteen final Chromium stories passed across the panel, dock and cursor, including provider unavailability, historical pending-review dismissal and questions surviving Return to recent.
- Seven production collaboration journeys passed together on the final frozen build (19.9 seconds). They cover Suggest provenance, Live creation/deletion, human overlap, independent edits, reviewed Undo including selection from task history, deferred process close, explicit Resume, phone restrictions and draft retention. They use a synthetic provider backend, without model inference.
- Desktop Suggest/Live and phone screenshots were inspected. Packed headless consumer passed without React, DOM, Dexie, Next.js or React Flow.
- Reusable React artifact and real Next consumer builds passed; all three embedding browser tests passed (10.1 seconds), covering trusted host commands/custom components, independent boards and host-owned navigation/styles/PWA.

The full production run completed with three failures: two obsolete close-button selectors after the shared dock change, and an unchanged connection-gesture test that has failed intermittently on the baseline as well. The selectors were corrected without weakening their behavioral assertions. All three passed together on the final frozen build (9.9 seconds). The earlier full run is not claimed green; its exact pass/skip counts were not retained when the output session expired. Final focused logs were retained explicitly.

## Limitations

agy remains unavailable because its isolated board-tool permission boundary has not been verified; no permission bypass was introduced. Remote phone-to-desktop execution is deferred. Local AI metadata relies on browser storage quota; the existing authored-project accounting does not include all conversation/journal bytes. Real-provider evidence and remaining adapter qualifications are recorded in [CLI feasibility](../ai-collaboration-cli-feasibility.md).
