# Local storage, transfer and limits (RV-02e)

Local records, the portable file format, publication metadata and numeric ceilings. This plan creates and resets no database. See [transactions.md](transactions.md) for write rules and [model-and-runner.md](model-and-runner.md) for the Document.

## 1. Versions

| Thing | Version |
|---|---|
| Database | new Dexie `system-studio-local-v1`, version 1. The old `system-studio` DB stays untouched and is not auto-imported. |
| Portable file | `{format:'system-studio',version:9,project:ProjectBundle}`. Versions 7, 8 and unknown ones are rejected with a clear message, and the file is left unchanged. |
| Document / preferences / part file | `studio-model/1`, `studio-preferences/1`, `system-studio-part/1` |
| Compiler / runner / encoding | `studio-compiler/1`, `studio-runner/1`, `canonical-json-v1` |

These are new versions, not descriptions of existing code.

## 2. Tables

All tables except preferences use project-scoped composite keys. Immutable rows are insert-if-absent; on a collision their canonical content must be equal, and they are never overwritten.

| Table / key | Fields | Indexes |
|---|---|---|
| projects / id | `title, revision, mainBranchId, initialSnapshotId, importSourceId:Id\|null, createdAt, updatedAt` | updatedAt |
| branches / [projectId+id] | `label, state:'open'\|'closed', headCommitId:Id\|null, workingSnapshotId, workingRevision, createdAt` | projectId |
| snapshots / [projectId+id] | `document` (id = content hash) | projectId |
| commits / [projectId+id] | `snapshotId, parentIds, evidence:EvidenceRef[], actor, createdAt, message` | projectId |
| publications / [projectId+id] | `commitId, sourceBranchId, previousMainHeadId\|null, ordinal, actor, createdAt, metadata:PublicationMetadata, versionKey` | projectId; unique [projectId+ordinal]; unique [projectId+versionKey] |
| checkpoints / [projectId+id] | `snapshotId, sourceBranchId, label, actor, createdAt` | projectId |
| runs / [projectId+id] | `snapshotId, manifest, fingerprint, status, provenance:'local'\|'imported-unverified', checks, summary, traceState:'complete'\|'pruned'\|'not-saved', createdAt, completedAt` | projectId; [projectId+fingerprint] |
| traceChunks / [projectId+runId+index] | `firstSequence, events, payloads, byteLength` | [projectId+runId] |
| operations / [projectId+id] | `requestHash, result, createdAt` | projectId |
| parts / [projectId+id+revision] | `label, description, content, createdAt` | projectId; [projectId+id] |
| preferences / key | `schema, revision, value` | — |

- `EvidenceRef={scenarioId, fingerprint, runId}`. Summaries and checks live in the pinned run rows; the publish transaction reads them there.
- Run `status` is one of `completed|invalid|failed|cancelled|incomplete`. All are terminal, and `completedAt` is the finite termination time.
- Timestamps are finite epoch ms, for display only.
- An imported actor is descriptive metadata, never a permission grant.
- Branch working states reuse content-addressed snapshot rows.
- **Main** is an ordinary branch with a protected publication head. It may hold working edits, but publish rejects while main's working snapshot differs from its head. The user must branch or discard those edits first.
- **Creation snapshot.** `initialSnapshotId` is the project's actual creation content (blank or template), immutable and always pinned. It is the merge base for unborn branches, not a fabricated commit.
- **Ancestry.**
  - A fork records ancestry through its head commit, or the creation snapshot if unborn. Forking from working content keeps the head.
  - Commits have 0 parents (first), 1 (ordinary) or 2 (merge; identical parents deduplicated).
  - Merge bases come from DAG ancestry only, never titles or timestamps. Multiple best merge bases are rejected with `ambiguous-merge-base`.
- **Publish** advances main's head and working snapshot together and increments both the source and main branch revisions. The source keeps its snapshot and head, and is closed by default.

## 3. Publication metadata

`PublicationMetadata={version:{major,minor,patch},title,rationale,ticketUrl|null}`.

- Version parts are safe integers 0–999999. The title is trimmed, 1–80 code points. The rationale is 0–4000.
- `ticketUrl` is an absolute http(s) URL of ≤2048 characters, with no credentials. Opening it is an explicit external-link action.
- The first publication proposes `0.1.0`. Later ones offer a major/minor/patch bump with a preview and manual entry. A major bump resets minor and patch; a minor bump resets patch. An overflowing suggestion is disabled.
- The user confirms the version; graph shape never decides it. No pre-release or build tags.
- Displayed as `vM.m.p`. `versionKey` is `M.m.p` with no leading zeros. It is derived and validated, never edited separately.
- Versions must strictly increase numerically (`0.10.0 > 0.9.9`). Uniqueness is enforced in the same transaction as the ordinal and head update.
  - A duplicate returns `failed/duplicate-version`.
  - A lower version returns `invalid` at `metadata.version`.
  - Concurrent attempts are rejected, never silently bumped.
  - A reopened branch can only publish a higher version.
  - Published versions can't be reused, edited or deleted.
- The merge commit message = the title. Metadata is included in history export and request hashing, and excluded from execution fingerprints. Editing draft metadata doesn't require a rerun.
- The author is the command's actor. A display name never implies authentication.

## 4. Portable bundle

- **Fields.** `ProjectBundle={id,title,createdAt,updatedAt,mainBranchId,initialSnapshotId,branches,snapshots,commits,publications,checkpoints,runs,parts}`. Each referenced immutable record appears once, with its `id` (plus revision for parts). Snapshots use their hash ID. Arrays omit `projectId`; import supplies it.
- **Excluded:** operation receipts, preferences, trace chunks, device-local actors and credentials, project revision and `importSourceId`. Every exported run has `traceState:'not-saved'`, and its checks/status/summary/manifest are unchanged. The export action says traces are left out: the bundle is lossless for authored content, history and check summaries, not for traces.
- **Export** reads from one consistent read-only transaction.
- **Import.**
  - Validate schemas, hashes, references, branch heads, commit DAG, version order and evidence inventory before anything becomes visible.
  - Create a fresh project namespace. Keep all document/entity/branch/commit/run IDs and hashes, and rewrite only the table `projectId`.
  - Set `importSourceId` to the source bundle ID and revision to 0.
  - Mark every run `imported-unverified`. Imported history reads as imported; new commits and publications need fresh local evidence.
  - Importing the same file twice creates two independent projects. There are no cross-project ID lookups.
  - Parts move only via standalone part files.

## 5. Repository API

The UI never writes tables directly. The local adapter exposes:

`loadProject(projectId)`, `loadBranch(projectId,branchId)`, `execute(command)`, `savePreferences(expectedRevision,value)`, `saveRun(startToken,terminalResult,chunks)`, `importProject(validatedBundle)`, `exportProject(projectId)`, `pruneUnreferenced(projectId,selection)`, `deleteProject(projectId,expectedMainHead)`.

- Queries return cloned, read-only records.
- Authored commands resolve to one transaction plus an operation receipt. Preferences have their own compare-and-set.
- The run start token is minted by the local runner controller and bound to the manifest, snapshot and run ID. Portable data can't mint one.
- `saveRun` commits the terminal summary, manifest, checks and retained chunks atomically. While a run executes, batches are buffered in bounded memory, and no durable "passing" badge shows until the save succeeds. On a quota error, show the unsaved outcome with retry and export options; never release eligibility or silently prune pinned rows.
- Errors: `not-found | invalid | stale | referenced-artifact | quota | unavailable | unsupported-version | operation-id-reused | limit`, with structured issue paths and IDs (never raw browser exception text alone).
- Hashing, validation and compiling happen before the transaction (see [transactions.md §2](transactions.md#2-revisions-and-compare-and-set)); an aborted transaction leaves no partial project or publication.

**Export always fits.** The complete canonical envelope must stay ≤ 64 MiB, and total accounted local bytes ≤ 128 MiB; excluded traces may use the difference. A history write that would break the export cap is rejected before mutation, so any project within limits can always be exported and reimported. Deletion and pruning need no new receipt beyond the cap, and no other mutation can bypass receipt retention. Accounted project bytes are checked transactionally using per-record canonical sizes. Deletion uses expected revision/head compare-and-set and returns missing/already-absent on retry.

## 6. Limits

These are v1 product ceilings, not measured performance. Bytes are UTF-8 canonical JSON; MiB = 1,048,576. Over-limit input is rejected before cloning or expansion, and nothing is truncated silently. Lowering a ceiling needs a contract revision, not a hidden clamp.

| Scope | Limit |
|---|---|
| Document | 2 MiB; 100 elements; 200 behavioral connections; 200 relations; 10 views |
| Nested content | 16 ports/element; 100 schemas; 100 fields/schema; semantic shape/expression/payload depth 8; raw document depth 32; 1,000 nodes per expression tree; 100 transitions/machine; 100 operations/pipeline |
| Strings | labels/title 1–80 code points; descriptions and notes 0–4,000; keys 1–80; string fixture values ≤16 KiB |
| View | 100 placements; 50 notes; 50 groups; coordinates abs ≤1e6; width 80–2,000 |
| Scenarios | 20/document; 100 assertions, 1,000 inputs, 100 faults, 100 boundaries, 20 workloads × 20 classes per scenario |
| Fixtures | 1 MiB aggregate; 256 KiB/value; 10,000 list items |
| Compiler | ≤2,000 expanded entities, ≤10,000 references (each resolved ID reference followed during closure expansion, once per referencing field — D34); batches ≤100 items; cancellation checked after every batch |
| Run defaults / maxima | events 100k / 1M; trace rows 10k / 100k; trace+payload bytes 4 / 16 MiB; live scheduled events 100k; simultaneous roots 10k |
| Time | timed horizon 1–300 s; drain deadline > arrival horizon and ≤600 s; logical has no time limit |
| Worker | yield every ≤1,000 events or 8 ms; 100 ms main-thread watchdog target |
| Local project | 100 branches; 1,000 commits; 100 checkpoints; 200 run summaries; 100 part revisions; 100,000 receipts; 128 MiB |
| Transfer | 64 MiB file cap (checked before parse); 100,000 containers; raw depth 40; one project per file |

- **Depth.** Scalar payload depth is 0; each object or list adds 1. Shape depth counts shape nodes, and expression depth counts Guard/Value nodes. Raw depth counts every serialized container, with the root at 1. All limits apply at once. Inventory walks are iterative and happen after the byte check, never recursive over untrusted depth.
- **Budgets.** Scenario budgets are positive integers ≤ the maxima. Defaults are materialized into the manifest. Limits are cumulative across nested refinements. Memory accounting is conservative byte accounting, not an exact heap measure.
- **Trace.** The row and byte caps are independent: 100k synthetic rows exceed 16 MiB. The run stops `incomplete` at the first cap hit, and readiness and results diagnostics show both budgets. There is no sampling or hidden truncation, and display virtualization never changes stored results. Resource admission limits are modeled outcomes; hitting global budgets means incomplete, not simulated success.
- **At the project limit,** edits and runs that need space fail with recovery. The user chooses to delete unpinned artifacts, export or delete the project. Authored snapshots, history and checks are never silently removed, and there's no automatic persistent-storage permission request.

## 7. Retention

- Keep the 20 latest unpinned runs by `(completedAt,id)`. Before storing a 21st, offer an explicit prune; cancelling keeps the result unsaved.
- A run is pinned when a retained commit references it.
- Pruning trace chunks changes only `traceState`, never checks or status.
- Pin closure: the creation snapshot, all branch head and working snapshots, commit ancestry and evidence, publications, checkpoints, and snapshots referenced by any retained run. A snapshot is released only after all references are rechecked inside an explicit prune transaction.
- Part revisions are independent detached artifacts.
- Operation receipts last for the project's lifetime. Reaching the receipt cap blocks further persisted operations (offer export/recovery); dedup protection is never dropped.
- The session undo stack holds 100 accepted commands and clears on branch change or reload. Undo issues a new compare-and-set command; it never rewinds history.

## 8. Measurement status

Serialization was measured on the planning fixtures ([size measurements](../fixtures/README.md#size-measurements)): the combined five-family document is 92 KB (~4.4% of 2 MiB), and the 100-branch recovery export has raw depth 17.

**Implementation acceptance gate.** On supported desktop browsers and at 390 px mobile, measure canonical bytes for:
- every S01–S05 fixture
- the combined project
- a near-ceiling document
- a 100k-row trace
- a history export

Record the fixture, SHA-256, script and runtime, byte counts, and peak memory/latency separately; serialized size alone is not performance evidence. Also measure runtime trace and payload sizes, large histories, browser quota, transaction cost, compiler cancellation latency, main-thread responsiveness and heap. Planning measurements can size headroom but never replace these.

## 9. Acceptance

- **Publication versions:** collisions and concurrent publish; the `0.1.0` default; numeric ordering; overflow; hostile URL schemes; missing author name; metadata-only edits reuse evidence.
- **Export/import:** record-key and reference inventory; immutable publications; retries of create/import keep their identity; project/branch compare-and-set races.
- **Storage:** quota failure; stale writes; old DB untouched; unsupported versions rejected; round-trip reload; malformed IDs and references.
