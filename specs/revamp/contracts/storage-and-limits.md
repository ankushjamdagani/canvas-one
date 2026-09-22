# RV-02e — Local storage, transfer and bounded work

Status: proposed contract, 2026-09-22; Claude review required. No database is created/reset by this plan. [Document](document-and-runner.md) and [transactions](transactions.md) are normative dependencies.

## Versions and records

New Dexie database name `system-studio-local-v1`, database version 1. Old `system-studio` remains untouched and is not auto-imported. Current-only portable envelope is `{format:'system-studio',version:9,project:ProjectBundle}`; reject 7, 8 and unknown versions with a clear unsupported-version message, preserving the file. Document schema is `studio-model/1`, preferences `studio-preferences/1`, part container `system-studio-part/1`, compiler `studio-compiler/1`, runner `studio-runner/1`, canonical encoding `canonical-json-v1`. These are proposed new versions, not descriptions of existing code.

IDs below are UUIDs unless content hashes; all tables except device-local preferences use composite project-scoped keys. Immutable rows use insert-if-absent plus canonical-content equality on collision, never overwrite. An import is validated entirely before any live project is made visible.

| Table / primary key | Record fields beyond key | Required secondary indexes |
|---|---|---|
| projects / id | `title,mainBranchId,initialSnapshotId,importSourceId:Id|null,createdAt,updatedAt` | updatedAt |
| branches / [projectId+id] | `label,state:'open'|'closed',headCommitId:null|Id,workingSnapshotId,workingRevision,createdAt` | projectId |
| snapshots / [projectId+id] | `document:Document` (id is snapshot hash) | projectId |
| commits / [projectId+id] | `snapshotId,parentIds:Id[],evidence:EvidenceRef[],actor,createdAt,message` | projectId |
| publications / [projectId+id] | `commitId,sourceBranchId,previousMainHeadId:null|Id,ordinal,actor,createdAt` | projectId; unique [projectId+ordinal] |
| checkpoints / [projectId+id] | `snapshotId,sourceBranchId,label,actor,createdAt` | projectId |
| runs / [projectId+id] | `snapshotId,manifest,fingerprint,status,provenance:'local'|'imported-unverified',checks,summary,traceState:'complete'|'pruned'|'not-saved',createdAt,completedAt:number` | projectId; [projectId+fingerprint] |
| traceChunks / [projectId+runId+index] | `firstSequence,events,payloads,byteLength` | [projectId+runId] |
| operations / [projectId+id] | `requestHash,result,createdAt` | projectId |
| parts / [projectId+id+revision] | `label,description,content,createdAt` | projectId; [projectId+id] |
| preferences / key | `schema,revision,value` | none |

EvidenceRef exact fields: `scenarioId,fingerprint,runId`. Evidence summaries and checks live in pinned run rows; eligibility reads those rows in the publication transaction. Actor has the current local-human contract; imported actor is descriptive stored metadata, never a permission grant. All timestamps finite epoch milliseconds, display only. Branch working snapshots reuse content-addressed snapshot rows, not mutable JSON embedded in every record. Main is a normal stored branch with protected publication head; it may have working edits, but publication rejects if main's workingSnapshot differs from its head snapshot. User must preserve those edits in a branch or discard explicitly first; never overwrite uncommitted main work. An unborn main uses a recorded initial empty snapshot as its merge base, not a fabricated commit.

New project creates main plus an open draft branch sharing the initial snapshot, nullable heads. Fork records ancestry through headCommitId (or shared initial snapshot for unborn branches); no merge base from titles/timestamps. Commit parent count 0 for first commit, 1 ordinary, 2 merge (deduplicate identical parent IDs). Publication from a source with no committed head rejects; source must have no uncommitted authored changes versus its head before prepare. Candidate resolutions form the new merge snapshot without mutating either working copy. Publish advances main head and workingSnapshot together, increments both source and main revisions, closes source by default, and preserves source snapshot/head. Reopening and future publication use DAG common ancestry, not prior publication timestamps. Multiple best merge bases reject with `ambiguous-merge-base` in v1; no arbitrary base selection.

ProjectBundle: `{id,title,mainBranchId,initialSnapshotId,branches,snapshots,commits,publications,checkpoints,runs,parts}` with every referenced immutable record included once. initialSnapshotId is immutable, references the project's creation snapshot and remains pinned for unborn-branch merge ancestry even after all branches advance. Exclude operation receipts, preferences, trace chunks and device-local actors/credentials; run summaries explicitly say traces omitted. This is lossless for authored content/history/check summaries, not full trace archival. Export action states that boundary. Explicit full-run trace export can be added later, not implied here. Validate all schemas/hashes/references, branch heads, commit DAG and evidence inventory on import; stored local provenance always becomes imported-unverified. Existing imported history remains readable as imported history, not freshly certified local commits. New local commit/publication requires fresh trusted-local evidence even if imported summaries claim passing.

Import creates a fresh project ID namespace; preserves document/entity/branch/commit/run IDs and hash content within that namespace. It rewrites only table projectId scope, never authored content or immutable hashes. Store original project ID as import metadata outside Document (`projects.importSourceId:Id|null`, required with null for native projects). Importing twice creates independent project namespaces, no live link or merge. No cross-project ID lookup is permitted. Parts belong to their source project and can be transferred via explicit standalone part files.

## Repository boundary

Exportability invariant: canonical ProjectBundle bytes must stay <=64 MiB as well as total local project bytes <=128 MiB. Excluded trace chunks may use the difference; a history write that would exceed portable size rejects before mutation. Thus a project within accepted storage limits always has a complete authored/history recovery export. Deletion/pruning/export recovery never requires allocating a new operation receipt beyond the cap; deletion uses expected revision/head CAS and returns missing/already-absent on safe retries. No mutation other than deletion/pruning can bypass operation receipt retention.

UI never writes Dexie tables directly. Local adapter exposes `loadProject(projectId)`, `loadBranch(projectId,branchId)`, `execute(command)`, `savePreferences(expectedRevision,value)`, `saveRun(startToken,terminalResult,chunks)`, `importProject(validatedBundle)`, `exportProject(projectId)`, `pruneUnreferenced(projectId,selection)` and explicit `deleteProject(projectId,expectedMainHead)`. Queries return cloned/read-only records. Commands use [transactions](transactions.md); all authored writes resolve to one transaction and an idempotent operation receipt. Preferences have separate CAS. Run start token is minted by the local runner controller and bound to immutable manifest/snapshot/run ID; portable data cannot mint it.

Terminal run summary, manifest, checks and retained chunks commit atomically. Persisted status is exactly completed|invalid|failed|cancelled|incomplete; all are terminal and completedAt is the finite termination timestamp, including unsuccessful attempts. During execution batches are buffered under bounded memory; no durable passing badge until save succeeds. On quota error show unsaved outcome and retry/export authored project; do not release evidence eligibility or silently prune pinned rows. Repository errors: `not-found`, `invalid`, `stale`, `referenced-artifact`, `quota`, `unavailable`, `unsupported-version`, `operation-id-reused`, `limit`. Return structured issue paths/IDs. No browser exception text as the only recovery information.

Hash/validate/compile before transaction; re-read/CAS inside. No network/Web Crypto/worker awaits inside. This follows [Dexie transaction guidance](https://dexie.org/docs/Dexie/Dexie.transaction%28%29). DB transaction abort must leave no partially created project/publication. Cross-tab notification occurs only after commit and is advisory.

## Initial limits and measurement gate

These are conservative v1 **product ceilings**, not measured browser performance guarantees. Byte means UTF-8 canonical JSON bytes, MiB means 1,048,576 bytes. Reject over-limit before cloning/expanding; no silent truncation. RV-02e can freeze representation/ceilings now, but release acceptance requires actual implementation measurements at these bounds on supported desktop and 390px mobile browsers. Lower ceilings require a recorded contract revision, not an agent's hidden clamp.

| Scope | Limit |
|---|---|
| Document | 2 MiB; 100 elements; 200 behavioral connections; 200 relations; 10 views |
| Nested content | 16 ports/element; 100 schemas; schema/guard/JSON depth 8; 100 fields/schema; 1,000 nodes per guard tree; 100 transitions/machine; 100 operations/pipeline |
| Authored strings | labels/title 1–80 code points; descriptions/note text 0–4,000; keys 1–80; string fixture values <=16 KiB UTF-8 |
| View | 100 placements; 50 notes; 50 groups; finite coordinates abs<=1e6; width 80–2,000 |
| Scenarios | 20/document; 100 assertions/scenario; 1,000 explicit inputs/scenario; 100 faults; 100 boundaries; 20 workloads with 20 classes each |
| Fixtures | 1 MiB aggregate; 256 KiB/value; 10,000 list items maximum (schema may choose smaller) |
| Compiler | <=2,000 expanded entities and <=10,000 references; batch <=100 work items; check cancellation after every batch |
| Run defaults / maxima | 100,000 / 1,000,000 processed events; 10,000 / 100,000 trace rows; 4 / 16 MiB trace+payload bytes; 100,000 live scheduled events; 10,000 simultaneous roots |
| Time | timed horizon 1–300 seconds; drain deadline >arrival horizon and <=600 seconds; logical has no modeled time limit |
| Worker | <=1,000 events or 8ms wall time per yield, whichever first; 100ms main-thread watchdog acknowledgement target, not an assertion of current performance |
| Local project | 100 branches; 1,000 commits; 100 checkpoints; 200 run summaries; 100 part revisions; 100,000 operation receipts; 128 MiB accounted canonical content |
| Transfer | 64 MiB file byte cap before parse; 100,000 total records; 16 nesting depth envelope; one project per file |

Budgets exact fields in Scenario: `maxEvents,maxTraceRows,maxTraceBytes,maxScheduledEvents,maxLiveRoots`. Values positive integers <= maxima; defaults materialize into manifest. Array count/byte/depth limits are cumulative across nested refinements, not multiplied per selected view. Memory accounting is conservative canonical byte accounting plus collection ceilings, not a promise of exact JavaScript heap usage. Trace exhaustion stops as incomplete, no hidden sampling of qualification evidence. Display virtualization never changes stored trace/check results. Resource admission limits remain modeled outcomes; global infrastructure budgets mean incomplete, not simulated overload success.

Accounted local project bytes are checked transactionally using per-record canonical sizes; browser quota can still reject earlier. At the local project limit, edits/runs needing more space fail with recovery; deleting unpinned artifacts or explicit project export/deletion is user-directed. No retention policy silently deletes authored snapshots, history or checks. First-run defaults are not an automatic request to browser persistent-storage permission.

Run retention: keep 20 latest unpinned runs by `(completedAt,id)`; offer explicit prune before storing the 21st (cancel preserves unsaved result), plus any pinned run rows within project ceilings. A run is pinned when any retained commit references it through EvidenceRef. Pruning trace chunks is explicit and changes traceState only; it cannot change checks/status. Pin closure includes projects.initialSnapshotId, all branch working/head snapshots, commit ancestry/evidence, publications, checkpoints and snapshots referenced by every retained run (including unpinned runs). Pruning a run may release its snapshot only after all other references are checked. Part revisions pinned by transfer/capture operation are independent detached artifacts. Unreferenced snapshots may be removed only in an explicit prune transaction after rechecking references. Operation receipts are retained for project lifetime within their cap; exceeding it blocks further persisted operations with export/recovery, never silently removes dedup protection. Session undo stack is 100 accepted authored commands and clears on branch change/reload; undo issues a new CAS command rather than rewinding history.

Before implementation acceptance, measure canonical bytes for every S01–S05 fixture, the combined five-scenario project, a near-ceiling document, 100k-row trace and a history export. Record fixtures, SHA-256, measurement script/runtime, byte counts and peak-memory/latency separately; serialized size alone is not performance evidence. These measurements are a named acceptance gate, not fabricated numbers. The planning fixture envelope measurement in the review evidence may size conservative headroom but cannot substitute for implemented runner profiling.
