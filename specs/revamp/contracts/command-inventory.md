# RV-02f — Closed command payloads and results

Planning specification, 2026-09-22. This complements [commands/panels](commands-and-panels.md), [transactions](transactions.md) and [storage](storage-and-limits.md). No command is implemented by this document. Unknown commands/fields reject. All referenced records use the closed document schema, not generic JSON patches.

## Context and result boundary

`Id` is UUID, `Hash` is lowercase SHA-256 hex, `Revision` is a nonnegative safe integer. `Empty={}`. `Point={x:number,y:number}` uses finite canvas coordinates within document bounds. `ViewRef={projectId:Id,branchId:Id,viewId:Id}`. `Selection={elementIds:Id[],connectionIds:Id[],groupIds:Id[],noteIds:Id[]}` contains unique IDs belonging to that view/document.

An authored request is `{commandId,operationId:Id,projectId:Id,branchId:Id,expectedWorkingRevision:Revision,actor:Actor,payload}`. Actor is `{actorId:Id,kind:'local-human',displayName:string}`; empty displayName is allowed and rendered “Local user”, never authenticated. Project-scoped commands replace branchId/expectedWorkingRevision with `expectedProjectRevision`; bootstrap create/import has no existing revision. Preference commands use `{expectedPreferenceRevision,payload}`. Navigation/export/run controls are controller requests with explicit context, never persisted as authored operations. A context mismatch rejects rather than silently using whichever branch is currently active.

Result union: `{status:'applied',operationId,projectRevision:Revision,branchRevision:Revision|null,changedIds:Id[],undo:{entryId:Id,label:string}|null,value:CommandValue}`; `{status:'invalid',issues:Issue[]}`; `{status:'stale',scope:'project'|'branch'|'preferences',expected:Revision,actual:Revision}`; `{status:'missing',ids:Id[]}`; `{status:'failed',code:'quota'|'unavailable'|'referenced-artifact'|'operation-id-reused'|'limit'|'ineligible'|'conflict'|'unsupported-version'|'duplicate-version',issues:Issue[]}`. Persist the applied result with the operation receipt. No new durable undo entry is reconstructed on retry/reload; entryId only resolves in the originating live session.

Controller result union is `{status:'done',value:CommandValue}`, `{status:'cancelled'}`, or invalid/stale/missing/failed above. User cancellation is not a failed write. CommandValue is closed: `{kind:'none'}`, `{kind:'project',projectId,branchId}`, `{kind:'branch',branchId}`, `{kind:'artifact',artifactType:'checkpoint'|'commit'|'publication'|'part',id,revision:Revision|null}`, `{kind:'run',runId}`, `{kind:'candidate',candidateId,snapshotId:Hash,conflictIds:Id[]}`, `{kind:'draft',draftId}`, or `{kind:'download',downloadId:Id}`. DownloadId is a local completion receipt, never filesystem access or portable content. Each row below fixes its success value; no arbitrary return bag.

## Project, history and run commands

Common branch envelope above is implicit in authored rows. `ExpectedHead=Id|null`. A FileToken is a local opaque UUID bound to bytes selected by the user, content hash and size; tokens expire on reload and cannot be imported or supplied by future remote actors. The adapter hashes/validates bytes outside transactions. Retries reuse the same operation ID and chosen destination project/part ID.

| Command | Exact payload | Success value / rules |
|---|---|---|
| project.create | `{newProjectId:Id,title:string,initialDocument:Document}` | project; bootstrap transaction, validated blank/template document, main+draft, operation receipt in new project namespace; duplicate ID with different request rejects |
| project.rename | `{title:string,expectedProjectRevision:Revision}` (branch envelope) | none; update project navigation title and active Document.title atomically; other branch/historical captions unchanged |
| project.switch | `{projectId:Id,branchId:Id|null}` | project; null selects main; guarded navigation, missing target rejects |
| project.import | `{fileToken:Id,newProjectId:Id,operationId:Id}` | project; validate complete bundle, idempotent namespace allocation, imported evidence never trusted |
| project.export-json | `{projectId:Id,expectedProjectRevision:Revision}` | download; consistent read snapshot, stale rejects; complete authored/history bundle |
| branch.create | `{newBranchId:Id,label:string,source:'working'|'head',expectedHeadId:ExpectedHead}` | branch; working copies current snapshot and current head ancestry, head copies head snapshot (or initial snapshot if unborn); neither commits nor erases source work |
| branch.switch | `{projectId:Id,branchId:Id}` | branch; guarded navigation |
| branch.reopen | `{expectedHeadId:ExpectedHead}` | branch; closed non-main branch only; revision++, no history/main rewrite |
| history.checkpoint | `{checkpointId:Id,label:string}` | artifact checkpoint; incomplete storable snapshot allowed |
| history.commit | `{commitId:Id,expectedHeadId:ExpectedHead,message:string,evidence:EvidenceRef[]}` | artifact commit; all-scenario eligibility, no main branch direct commit |
| history.prepare-publish | `{projectId:Id,sourceBranchId:Id,sourceRevision:Revision,sourceHeadId:Id,mainRevision:Revision,mainHeadId:ExpectedHead}` | candidate; isolated controller candidate, source/main cleanliness and common ancestry required |
| history.resolve-conflict | `{candidateId:Id,conflictId:Id,resolution:{kind:'ours'|'theirs'}|{kind:'edited',record:EditableRecord|null}}` | candidate; edit whole owning typed record; null is explicit deletion; ordered field conflicts edited through that record's normal editor, not free-form JSON |
| history.publish | `{candidateId:Id,publicationId:Id,mergeCommitId:Id,metadata:PublicationMetadata,evidence:EvidenceRef[],keepSourceOpen:boolean,expectedProjectRevision:Revision}` | artifact publication; false default, atomic source/main/project CAS, no undo |
| history.restore | `{snapshotId:Hash,checkpointId:Id,label:string}` | artifact checkpoint; first preserve current working snapshot as named checkpoint then replace working content in same transaction; history heads unchanged |
| run.start | `{projectId:Id,target:{kind:'branch',branchId:Id,expectedWorkingRevision:Revision}|{kind:'candidate',candidateId:Id},scenarioId:Id,runId:Id}` | run; immutable pinned target, clean inspector, compile/readiness, fresh local start token |
| run.pause / resume / cancel / reset | `{runId:Id}` | none; stale/non-current IDs reject; reset waits for cancellation then clears live display; saved evidence retained |
| edit.undo / redo | `{entryId:Id}` | none; branch envelope and live-session ownership required; ordinary reversible authored edit only |

Candidate IDs address immutable controller-owned candidate revisions. Every conflict resolution creates a new candidateId/snapshotId and invalidates the old candidate's eligibility, never mutates a running candidate. A candidate retains expected project/source/main revisions, both heads, merge base and unresolved conflicts. It cannot be accepted from portable input. A resolved candidate may run only when it passes readiness. Reload discards unpublished candidates; branch working copies are unaffected. User can prepare again from durable heads. Superseded candidate IDs return failed/ineligible; unknown or reload-expired IDs return missing. branch.create always validates expectedHeadId for both source choices; head mismatch returns failed/conflict with code HEAD_MOVED in its issues, while revision mismatch returns stale.

Project revision increments on every durable project mutation (including branch writes, metadata, runs, parts and pruning); preferences are separate. Branch commands ordinarily compare only branch revision, then atomically increment the current project revision, avoiding unnecessary conflicts across branches. Rename additionally compares its supplied project revision. Publication compares project/source/main tokens; this conservative policy may require reprepare after unrelated project writes. Saving candidate runs must not itself invalidate the candidate: the candidate's structural token tracks source/main revisions and heads, while publication takes a fresh expected project revision after evidence save. Immutable candidate snapshot and evidence fingerprints remain pinned. Project title is navigation metadata; Document.title is a branch/historical snapshot caption, and switching branches never overwrites project.title.

## Model authoring and selection

`EditableRecord` is a discriminated wrapper `{recordKind:'element',record:Element}` or connection/Relation/PayloadSchema/Fixture/Refinement/Scenario/View with matching recordKind (`connection|relation|schema|fixture|refinement|scenario|view`). This is a finite typed union, not arbitrary fields/paths. `model.apply-records` accepts `{changes:RecordChange[]}` where RecordChange is `{kind:'insert'|'replace',value:EditableRecord}` or `{kind:'remove',recordKind,id:Id}`. Replacements must keep definition IDs. Existing nested IDs remain stable; new members get fresh UUIDs. Missing replace/remove targets, duplicate change targets, unknown IDs/fields and invalid cross-references reject the entire command. At most 1,000 changes, also final-document byte/count limits; reducer validates the complete candidate before persistence. Each user gesture/form Apply is one compound command/undo entry.

Domain intents (add component, draw connection, change settings, scenarios, notes, saved views, drag placements) compile to this boundary through schema-aware adapters. Deletion first previews the complete dependency closure; no implicit cascade outside the confirmed set. Future AI must propose the same typed changes for preview/review and cannot bypass validators, revisions or authorization. Record-level updates conservatively share one branch revision; no speculative live-edit patch protocol.

| Registry action | Exact payload | Rules / result |
|---|---|---|
| selection.duplicate | `{viewId:Id,selection:Selection,offset:Point}` | none; complete fresh ID/reference mapping and one undo; refuse external required dependencies unless explicit closure approved |
| selection.delete | `{viewId:Id,selection:Selection,dependencyPreviewId:Id}` | none; token binds exact branch revision and enumerated removal/reference repairs; stale token rejects |
| selection.group | `{viewId:Id,elementIds:Id[],groupId:Id,label:string}` | none; nonempty wholly ungrouped selection |
| selection.ungroup | `{viewId:Id,groupIds:Id[]}` | none; removes presentation groups only |
| selection.align | `{viewId:Id,elementIds:Id[],edge:'left'|'center-x'|'right'|'top'|'center-y'|'bottom'}` | none; >=2 placed elements; bounding-box alignment |
| selection.distribute | `{viewId:Id,elementIds:Id[],axis:'x'|'y'}` | none; >=3; endpoints fixed, equal gaps, stable-ID tie break |
| canvas.add-note | `{viewId:Id,note:Note}` | none; complete typed note, one undo |
| canvas.expand / collapse | `{viewId:Id,target:{kind:'placement'|'group',id:Id}}` | none; authored presentation only, no runner/refinement change |
| canvas.select-tool / pan-tool | `Empty` | none; transient mode |
| canvas.zoom-in / zoom-out / fit | `{view:ViewRef}` | none; preferences only; factor 1.2 / reciprocal, zoom clamp 0.1–2, center anchored; fit bounds all placements/notes with 32px padding |

All authored selection actions use the branch envelope. Model mutation success uses CommandValue.none. Whole-document replacement is allowed only for project bootstrap/import/history restore, not as a provider shortcut.

## Inspector, panels, parts and exports

`PanelId='library'|'history'`; results and inspector are separate contextual regions, never floating PanelIds. `DraftTarget={kind:'element'|'connection'|'scenario'|'workload'|'selection',ids:Id[]}`. Empty selections reject inspector.open. Inspector form edits are transient local controller operations; applying compiles complete typed records to model.apply-records with the captured branch revision. Raw invalid form strings never enter a domain command.

| Registry action | Exact payload | Success / constraints |
|---|---|---|
| inspector.open | `{projectId:Id,branchId:Id,target:DraftTarget,expectedWorkingRevision:Revision}` | draft; resolve dirty navigation first |
| inspector.apply / cancel | `{draftId:Id}` | none; known local handle only; Apply validation/storage error preserves draft |
| inspector.close | `{draftId:Id|null}` | none; dirty guard then close, null means already closed |
| library.open / close; history.open / close | `Empty` | none; singleton preferences, dirty guard before overlay replacement |
| results.open | `{projectId:Id,runId:Id|null}` | none; null selects current live run, missing run shows empty state without fake data |
| results.close; commands.open | `Empty` | none; transient navigation |
| panel.place | `{panelId:PanelId,placement:'left'|'right'|'floating',index:0|1}` | none; prefer existing valid floatRect, otherwise center 360×480 in usable viewport then clamp; index ignored when floating |
| panel.collapse / expand / reset-width | `{panelId:PanelId}` | none; reset affects shared side width if docked; floating resets size to clamped default |
| panel.resize | `{panelId:PanelId,width:number,height:number|null}` | none; null height docked, required floating; command rejects out-of-bounds/nonfinite values; gesture preview clamps before submitting; persisted preference load separately validates |
| panel.move-floating | `{panelId:PanelId,x:number,y:number}` | none; keyboard/menu and drag use same committed preference action |
| dock.configure | `{orderedCommandIds:DockCommandId[],hiddenCommandIds:DockCommandId[]}` | none; unique/disjoint and exact allowed inventory, <=16 visible |
| dock.restore-defaults | `Empty` | none; one preference write |
| part.capture | `{partId:Id,revision:number,expectedLatestRevision:number|null,viewId:Id,elementIds:Id[],noteIds:Id[],label:string,description:string,dependencyPreviewId:Id}` | artifact part; capture token binds branch revision/closure, detached artifact, no authored undo |
| part.place | `{partId:Id,revision:number,viewId:Id,anchor:Point}` | none; branch envelope, atomic remap/insert one undo |
| part.export | `{projectId:Id,partId:Id,revision:number}` | download |
| part.import | `{projectId:Id,fileToken:Id,partId:Id,operationId:Id,expectedProjectRevision:Revision}` | artifact part revision 1; fresh identity |
| export.svg / png / mermaid | `{view:ViewRef,snapshotId:Hash}` | download; explicitly pinned authored view, validate named branch/snapshot relationship or select stored snapshot context |
| export.csv | `{projectId:Id,runId:Id}` | download; immutable saved terminal run only |

DockCommandId is exactly canvas.select-tool, canvas.pan-tool, library.open, canvas.add-note, selection.group, edit.undo, edit.redo, canvas.zoom-out, canvas.zoom-in, canvas.fit, history.open, results.open, run.start, run.pause, run.resume, run.reset. Parameterized actions obtain current validated context or open their normal form; they never persist payloads in preferences. Hidden and visible arrays partition this inventory; defaults show the first ten in the listed order. All preference writes use the explicit preference revision envelope; controller may retry a stale geometry change only after showing current state, never silently overwrite another tab's customization.

Part revision must be expectedLatestRevision+1, or 1 when null; mismatch is invalid with issue path payload.revision. Concurrent edits reject with stale. Project-scoped capture/export creates no branch undo. Main direct commits and restore into main are disabled: preserve edits by branch.create(source=working), then switch; only publication advances main history. Ordinary main working edits may autosave but cannot be silently overwritten by publish.

Registry adds history.resolve-conflict, model.apply-records and panel.move-floating to the earlier inventory. These are required plumbing for already-approved flows, not additional features. User-visible command search need not expose internal model.apply-records. Future command extensions require reviewed closed schemas and exhaustive registry/validator coverage.

EvidenceRef is `{scenarioId:Id,fingerprint:string,runId:Id}` from storage-and-limits.md; fingerprint uses ss-run-v1 plus the canonical digest. It deliberately does not require identical snapshot IDs: view-only changes may reuse matching executable evidence. No server is involved in these local-only checks.

Dependency preview is an explicit local controller method `previewDependencies({projectId,branchId,expectedWorkingRevision,intent:'delete'|'capture',viewId,selection:Selection})`. It returns `{dependencyPreviewId:Id,boundRevision:Revision,removals:Id[],repairs:RecordChange[],includedElementIds:Id[],excludedConnectionIds:Id[],issues:Issue[]}` or the controller error union. The controller retains the exact immutable record; consumers pass only its ID, never an editable token body. The confirmation UI displays all removals/repairs/inclusions before execution. Revision mismatch returns stale(branch); expired/unknown preview ID returns missing. Delete/capture verifies intent and complete selection equality; mismatches return invalid. Preview creates no durable operation receipt and runs no mutation.

Envelope classification is explicit: canvas.zoom-in/zoom-out/fit, all panel.* and dock.* use the preference envelope. library/history open/close perform guarded navigation and then a preference command; their controller accepts expectedPreferenceRevision. Transient canvas tools/results/commands/inspector controls use controller requests. All selection/model authored actions use branch envelopes. Part.capture uses the branch envelope to bind the source and a project artifact transaction to store the part; it never increments workingRevision or creates authored undo, but increments project revision. Part.import uses its explicit project fields. Exports use readonly controller payloads. History prepare/resolve and run actions use controller payloads; history commit/checkpoint/restore/publish use branch envelopes (publish additionally carries project revision and candidate tokens). Project create/import use their explicit bootstrap IDs and operation receipts; project.create also receives operationId and actor in its bootstrap envelope. Branch switch/reopen/create are distinguished by the table (switch controller, others branch). Same ID retry is checked before stale checks, returning its original durable result.
