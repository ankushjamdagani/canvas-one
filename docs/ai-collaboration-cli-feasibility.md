# Local AI collaboration feasibility and adapter contract

Updated: 2026-10-14. Technical spike, not production implementation. User is producing the visual design. All model/tool probes used a synthetic fixture; no user boards were read or modified.

## Confirmed scope

- Claude, Codex and agy through installed local CLIs and existing sign-in. No API credential management.
- Desktop agent execution first; mobile states are designed now. Authenticated phone-to-desktop execution is future work.
- One active editing task per board. Multiple selectable integrations; concurrent agent orchestration is future work.
- Suggest by default; task-bound, explicitly granted Live edits cover the whole current board, including deletion. Stop, safe task Undo and explicit interrupted Resume remain required.

## Evidence gathered

| Integration | Observed locally | Still needs proof |
|---|---|---|
| Codex CLI 0.155.1 | App-server runtime: initialize/model discovery. Generated schema only: thread/start/resume and turn/start/steer/interrupt. Exec runtime: streamed prompt/reply, explicit-ID cross-process continuation, synthetic MCP inspection/proposal submission with scoped tool permissions | App-server turns, active steering, interruption acknowledgement, interrupted resume and production board-tool integration |
| Claude Code 2.1.286 | claude.ai sign-in; streaming output; two structured input messages were acknowledged and answered; Opus 5.5 synthetic MCP inspection/proposal submission with only those tools allowed; explicit-ID cross-process continuation recalled the fixture label | Active feedback during an in-flight turn, interrupted resume, cancellation and production board-tool integration |
| agy language server 1.3.4 | Model discovery includes gemini-3.8-flash-high; streaming prompt/reply and explicit-ID cross-process continuation succeeded; synthetic inspection was attempted but denied by headless MCP permission; help advertises NDJSON input and MCP registration | Scoped MCP permission handling and successful board-tool loop, active feedback, cancellation and interrupted recovery; help alone does not establish working integration |

Both successful tool loops returned a pending synthetic proposal with zero authored writes. This demonstrates CLI-to-tool transport, not real board validation, proposal acceptance, persistence, conflict handling or Undo correctness. First Codex attempt was denied by its tool approval policy; success required permission scoped to the two fixture tools, not filesystem or global permission bypass.

agy's denied tool run exited zero and emitted `result.status: SUCCESS`, with an empty response and `denied_actions` containing `mcp`. Treat this as unsuccessful task work. A second isolated test temporarily added `mcp(<exact-fixture-server-name>)` to the existing permission allowlist, as suggested by the CLI diagnostic, but the tool remained denied. The settings were restored byte-for-byte and the uniquely named fixture server removed. No lasting agy permission change remains. A supported scoped-permission/control integration remains a blocker for claiming full support; do not assume the diagnostic's suggested rule fixes it.

Claude 2.1.191 rejected Opus 5.5 with a requirement for version 2.1.280 or newer. Its updater identified Homebrew ownership; a scoped cask upgrade installed 2.1.286 and the requested model then worked. Existing sign-in was retained. Homebrew also ran its automatic cache/old-version cleanup.

Gemini Flash High critic: initial headless review produced no output after a command permission denial; source-embedded no-tool retry timed out. No completed critique is claimed. A separate minimal streaming test succeeded. Model availability therefore does not establish reliable critic behavior for a repository-context prompt.

## Recommended adapter approach

Use Codex app-server for interactive control; keep exec JSON as a smoke-test path, not the proposed product conversation mechanism. Use Claude's local streaming CLI interface initially; evaluate the Agent SDK only if it simplifies control while retaining local sign-in. agy requires a pinned adapter based on its observed stream and tested MCP permission behavior. Do not assume a shared subprocess command or schema.

Codex uses JSON-RPC methods and notifications in app-server. Its exec stream uses `type`, Claude emits `type` records plus partial content, and observed agy output uses `event`, `step_update` and a nested `result.status`. An exit code of zero is insufficient: parse the terminal record, errors, denied tools and actual receipts. Do not expose internal reasoning as activity or fabricate progress.

The current Canvas One bridge only relays browser tool requests. It does not supervise CLI conversations or implement task permission fencing. Existing `proposal_submit` is review-only; do not relabel it as a live write tool. Reuse transaction validation, durable operation attribution and deduplication only where they satisfy the new contract.

## Common contract, version 1 — proposed, not implemented

| Record or boundary | Required meaning |
|---|---|
| Connection | Agent identity, CLI/protocol versions, authenticated readiness, supported capabilities and concrete diagnostics; no model credentials in board data |
| Conversation | Canvas One conversation ID mapped to an explicit provider session/thread ID; never resume whichever session happens to be most recent |
| Task | Stable task ID, actor, board/project/branch identity, starting context, permission, durable status and related proposals/operations |
| Attempt | Execution attempt ID, provider turn/run ID, task reference and authorization generation; Resume/restart changes attempt without duplicating task effects |
| Message | Message ID, explicit target (conversation/task/proposal revision/clarification), delivery state and provider acknowledgement where available |
| Event | Version, event ID, sequence, task/attempt references and factual payload: text delta, activity/tool focus, question, proposal, receipt, error or terminal outcome |
| Proposal | Proposal ID and revision lineage, base snapshot/read dependencies, coherent candidate changes, validation outcome and explicit human review result |
| Tool request | Bound task/attempt/actor/scope, stable operation ID, payload fingerprint and current authorization generation; the gateway derives authority rather than trusting agent-supplied permissions |
| Write receipt | Applied/rejected/conflicted outcome, actual changes and before/after information sufficient for attributable, dependency-aware Undo |
| Capabilities | Verified support for streaming, active feedback, durable resume, cancellation acknowledgement and tools; unavailable features stay explicit |

One board authority validates and serializes writes. Check scope, current permission/generation and relevant dependencies again inside the atomic transaction, not merely when a tool request enters the queue. An MCP approval permits a tool invocation; it does not grant board-wide Live authority.

Stop establishes a serialized write fence: a transaction committed before the fence is completed work; no request may commit after it. Report cancellation separately. Navigation fences locally before context teardown; crash/lost-connection handling also needs bounded liveness expiry and a generation check on reconnect. Never renew an expired authorization merely because a process reconnects.

Persist task/proposal records and write receipts before reporting durable outcomes. Retrying the same operation/payload returns the existing receipt; reusing an operation ID with a different payload is rejected. Retain terminal history independently of the bounded active queue.

## Interaction recommendations while design is pending

- Show the second message's target. An answer to an agent question continues the same task; Request changes revises the named proposal. New work does not silently replace active work or inherit its Live grant.
- Route unrelated questions during active work through a separate read-only provider session with no write capability, or clearly offer waiting until active work finishes if this is unsupported. Do not send an ordinary question into the active task as implicit steering. This is a proposed routing policy to verify per adapter, not a demonstrated capability.
- With one editing task active, offer starting new work after it finishes or explicitly stopping it first. Do not implement an invisible task queue. If staging work is chosen later, make it visible and start it in Suggest.
- If an adapter cannot deliver active feedback, show that limitation and offer an explicit stop/restart boundary within the same task lineage. Do not label text as acknowledged until delivery is established. A stopped task's authorization cannot silently renew.
- Agent/board switching must visibly handle active work and preserve task identity. Merely opening a panel or selecting another agent neither starts work nor transfers permission.
- Recommend one manually launched local service that supervises provider processes and exposes a narrowly authenticated browser connection. This is a proposed bootstrap, not an existing command or a promise of terminal-free setup. Choose pairing details after a working secure prototype.
- Keep service binding on loopback for the desktop release, authenticate the browser origin/session, bind capabilities to the task and isolate board tools from unrelated shell/file capabilities. User sign-in stays owned by each CLI.
- The connection prototype must enforce Host and Origin allowlists, no wildcard CORS, authenticated state-changing requests, an out-of-band per-launch pairing secret, short-lived session capabilities and revocation/rotation. Test DNS rebinding and cross-origin/CSRF requests against the actual browser deployment origin; loopback alone is insufficient.
- On unsupported execution devices, show the local-host requirement. Mobile mockups do not imply phone-to-desktop transport exists.

## Proposed task transitions and liveness gate

Use durable states `requested`, `working`, `waiting`, `interrupted`, `completed`, `stopped`, `failed`. A waiting reason distinguishes review, clarification, overlap and feedback delivery; connection and cancellation acknowledgement are separate fields.

| Trigger | Transition or result |
|---|---|
| Start acknowledged | requested → working |
| Review/question/overlap blocks further relevant work | working → waiting, with explicit reason; safely independent actions may continue |
| Decision delivered and dependencies revalidated | waiting → working; rejected proposal may finish the task or lead to explicitly requested refinement |
| Validated work complete, no unresolved decisions/writes | working/waiting → completed; provider success alone is insufficient |
| Stop fence recorded | nonterminal → stopped; cancellation acknowledgement can remain pending independently |
| Departure, crash or expired liveness | nonterminal → interrupted; revoke attempt authority |
| Unrecoverable execution/delivery failure | nonterminal → failed, retaining completed changes and failure reason |
| Explicit Resume/retry | interrupted/failed → requested with a new attempt/generation and current-board validation; renew Live authority only through the explicit recovery action |

A finished provider attempt can leave a task waiting for proposal review. A cancelled/replaced attempt is not automatically a stopped task; its mapping depends on the explicit user action and durable task record. No completion with unresolved denied writes or feedback.

The board authority owns write eligibility and the lease/generation decision; the local supervisor enforces its issued capability before relaying requests. Renewal comes from the active authorized board session, not agent traffic. Stop, expiry and departure invalidate the old generation. Choose and test the heartbeat cadence, monotonic lease deadline, maximum transaction duration and suspended-tab policy in the connection prototype; these are unresolved numeric limits, not implemented guarantees. The gate cannot pass until an actual cutoff test proves no commit after the fence or expired deadline, including a transaction that began earlier. Minimized conversation alone does not revoke authority.

## Redacted reproducibility summary

All inference probes used the repo's `run-agent.sh <prefix> <timeout> <cli> <model> -- <args>` wrapper, with source-embedded/no-tool prompts or a synthetic Python stdio MCP server exposing `board_inspect` and `proposal_submit`. Commands used temporary paths and fixture provider IDs, not user board identifiers.

| Probe | Relevant arguments and result |
|---|---|
| Codex discovery | `codex app-server --stdio -c mcp_servers={}`; initialize and model/list returned results. `generate-ts --experimental --out <temp>` inspected without treating schema as runtime proof |
| Codex stream/continuation | model `gpt-6-luna`; `--json --sandbox read-only -c mcp_servers={} --skip-git-repo-check`; continuation used `resume <fixture-thread-id>`; both returned `CLI_STREAM_OK`, exit 0 |
| Codex tools | Temporary stdio fixture config plus `mcp_servers.canvas_fixture.tools.board_inspect.approval_mode="approve"` and matching `proposal_submit` override; two completed tool events, proposal pending, zero authored writes, exit 0 |
| Claude tools/continuation | model `claude-opus-5-5`; `--output-format stream-json --verbose --include-partial-messages --tools ''`, strict temporary MCP config and allowlist of the two fixture tools; terminal `is_error: false`, no denials; `--resume <fixture-session-id> --safe-mode --tools ''` returned `After`, exit 0 |
| Claude structured input | Two synthetic user NDJSON messages with `--input-format stream-json --output-format stream-json --replay-user-messages --safe-mode --tools ''`; two echoed user messages and successful `FIRST_ACK`/`SECOND_ACK` results, exit 0; not proof of active-turn steering |
| agy stream/continuation | model `gemini-3.8-flash-high`; `--output-format stream-json --disable-slash-commands`; `--conversation <fixture-id>` retained earlier reply; both terminal responses `CLI_STREAM_OK`, exit 0 |
| agy tools | Temporary uniquely named MCP registration; call attempted, terminal `status: SUCCESS`, empty response, `denied_actions: [{action: mcp}]`, exit 0; classified unsuccessful; registration removed |
| agy scoped-rule probe | Same denial after a temporary exact-server `mcp(...)` allow rule; original settings restored byte-for-byte and fixture registration removed |

These are redacted command/terminal summaries, not a shipped test harness. All cited documentation URLs were opened during research. CLI-generated usage/cost counters are provider-reported accounting, not new API credential setup or proof of an additional bill.

## Implementation gates and next sequence

1. Prove each adapter's multi-turn prompt, targeted feedback, tool result, cancellation and explicit resume using an isolated fixture. agy MCP/control behavior is an open gate, not a reason to drop support silently.
2. Finalize a versioned adapter/event contract and a minimal local-service bootstrap from that evidence. Keep dock/composer placement for the user's design; message meaning does not depend on placement.
3. Implement durable task/proposal storage, attempt fencing and the single-active-editing-task rule through the existing authored authority.
4. Prove Suggest non-mutation, stale acceptance, Stop racing with writes, abrupt departure, retry deduplication, and Undo with subsequent human edits before wiring live controls.
5. Integrate the approved design and complete each CLI's actual connect → prompt → propose → revise → accept journey. Then complete live editing, overlaps and recovery.

No complete three-agent feasibility verdict is claimed yet. No production adapter, agent conversation UI or new live-write path has been implemented by this spike.

The requested reviewer and critic model IDs were updated in `.agents/delegate.json`. Its existing executor target/accept-edits setting was not added or changed, and no executor was dispatched for this task. These are repository delegation defaults, separate from the product's task/board permissions. Opus 5.5 completed a source-embedded review; its findings were qualified against the actual diff before incorporation.

[Archived Opus review and qualifications](audits/2026-10-14-claude-cli-feasibility-review.md): the final independent check passed for documentation consistency and truthful scope. This is not an implementation or complete feasibility approval.

## Primary references

- [Codex app-server](https://learn.chatgpt.com/docs/app-server): interactive protocol, steering, interrupt and resume. The locally generated 0.155.1 schema is the version-specific evidence.
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference): per-server/per-tool MCP approval configuration.
- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference) and [programmatic usage](https://code.claude.com/docs/en/headless): streaming, session and MCP interfaces. Current online documentation may describe newer versions; local probes determine this machine's behavior.
- agy: installed `--help`, `models`, `mcp add --help`, actual streaming events and run outcomes. No public API stability is inferred.

Raw smoke-test evidence is temporary in `/tmp/canvas-one-cli-feasibility-20261014`; the failed critic run/state is under the dedicated worktree's ignored `.delegate/runs/20261014-cli-feasibility`. Neither location is a durable published artifact.
