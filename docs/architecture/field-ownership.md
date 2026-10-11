# State and field ownership

Decision baseline: `0c4a439`, direct source inspection. This ledger specifies extraction ownership; it does not claim these packages already exist. All package names below use `@canvas-one/`. Contracts are exported by their owner, never by a central contracts/core/runtime package.

## Authored document

Current source for every row in this section: `src/domain/studio/model.ts`. Current `Document` has exactly the twelve fields listed by `DOCUMENT_FIELDS`. The transition maps these fields into one editable BoardDocument; it must not leave a second editable system snapshot beside it.

| Current symbol / fields | Target owner and representation |
| --- | --- |
| Document.schema, id, title | whiteboard authored envelope; old schema is a codec discriminator, not a new board schema |
| Document.elements | whiteboard reusable entity identity plus system-design namespaced semantic records |
| Element.id, label, description | whiteboard entity identity/common authored content |
| Element.visualKind | whiteboard namespaced component type; system-design owns catalog mapping from current kinds |
| Element.ports, behavior, linkedProjectId | system-design authored entity extension; linked ID remains a reference, never a copied project |
| Port.id, label, direction, channel, schemaId, responseSchemaId, protocol, settings, path | system-design; stable port ID is exposed through injected endpoint resolver |
| Endpoint.elementId, portId | system-design semantic endpoint; whiteboard connector contract uses entity/placement IDs and opaque endpoint ID |
| Document.connections; Connection.id, source, target | whiteboard connector identity/reference structure; system-design preserves semantic endpoint identity independently of view placement |
| Connection.kind, config | system-design extension; visual-only connectors require neither field |
| CallConnectionConfig.latencyMs, returnLatencyMs, linkClass, jitterMs, lossRate, bandwidthKbps, weight, condition, fallback | system-design authored link assumptions |
| MessageConnectionConfig.latencyMs, linkClass, jitterMs, lossRate, bandwidthKbps, weight, condition, fallback; DataConnectionConfig empty object | system-design authored link assumptions |
| RouteCondition.field, value | system-design authored routing predicate |
| Document.relations; Relation.id, label, kind, parentId, childId, elementId, hostId, sourceId, targetId (variant-specific) | system-design authored semantic relations; generic board must not interpret deployment/containment execution semantics |
| Document.schemas; PayloadSchema.id, label, shape | system-design payload schemas |
| Shape.type, nullable, fields, items, maxItems, types; RecordField.id, key, optional, shape | system-design recursive payload schema tree |
| Document.fixtures; Fixture.id, schemaId, value | system-design authored fixture data |
| Document.refinements; Refinement.id, ownerElementId, memberElementIds, portMappings | system-design authored refinement graph |
| PortMapping.id, outer, inner | system-design stable semantic endpoint mapping |
| Document.views; View.id, label | whiteboard pages |
| View.placements; Placement.id, elementId, x, y, width, expanded | whiteboard authored placements; expanded is persisted authoring state, not a React Flow flag |
| View.connectionIds, relationIds | whiteboard authored page membership references; system-design resolves semantic relations |
| View.groups; Group.id, label, elementIds, collapsed | whiteboard authored grouping; collapsed is persisted |
| View.notes; Note.id, text, x, y, width, tone, attachedElementIds | components-basic note schema/tool; spatial identity and referenced entities validated by whiteboard |
| Document.scenarios; Scenario.id, label, revision, mode, scopeElementIds, entryPorts, inputs, workloads, faults, boundaries, refinementSelections, initialContexts, assertions, seed, budgets, assumptions | system-design authored scenario extension, not execution artifacts |
| Input.id, entry, fixtureId, journeyId, atMs, payloadBindings, resource | system-design authored input |
| InputBinding.targetPath, source; InputBindingSource.port, journeyId, occurrence, path | system-design authored payload mapping |
| ResourceMetadata.requestClassId, operation, key, tags, deadlineMs | system-design authored workload metadata |
| Workload.id, entry, enabled, startDelayMs, emission, timeoutMs, classes | system-design authored workload |
| Emission.mode, requests, arrival, ratePerSecond, profile (variant-specific); WorkloadProfile.kind, peakRate, startMs, endMs, endRate, rampMs | system-design authored generation settings; BulkArrival structure originates in `src/domain/bulk-arrivals.ts` |
| RequestClass.id, name, weight, operation, tags, keyDistribution; KeyDistribution.kind, catalogSize, hotSubset, hotShare | system-design authored request classes |
| Fault.id, hostId, downAtMs, upAtMs, detectionDelayMs, recoveryDetectionDelayMs, activePolicy, queuedPolicy, routeReset | system-design authored fault assumptions |
| Boundary.id, source, schemaId, responses; BoundaryResponse.id, match, responseFixtureId, payloadBindings, delayMs, afterInputId, repeat, outcome; BoundaryPayloadBinding.targetPath, requestPath | system-design authored boundary behavior |
| Selection.refinementId, mode; InitialContext.elementId, fixtureId | system-design authored scenario refinement/context; this Selection is not canvas selection |
| Assertion.id, label, subject, operator, expected; subject.kind, elementId, path, port, scope, outcome, code, key (variant-specific) | system-design authored assertion schema; simulation produces check results |
| ScenarioBudgets.maxEvents, maxTraceRows, maxTraceBytes, maxScheduledEvents, maxLiveRoots | system-design authored execution bounds |
| Assumption.id, key, value, source, description | system-design authored provenance; measured assumption is not automatically a measured run |

All nested behavior fields remain authored system-design data. Specifically: Behavior.kind/version; unmodeled.reason; resource.config/entryPortId; machine.states/initialStateId/contextSchemaId/initialContextFixtureId/transitions/responseBindings; pipeline.inputSchemaId/outputSchemaId/errorSchemaId/inputPortId/outputPortId/errorPortId/operations; decision.inputSchemaId/inputPortId/cases/fallback; host.kind/version. ResourceConfig.type/capacity/concurrency/queueLimit/failureRate/maxRetries/retryDelayMs/serviceTime/serviceTimeCv/writeCapacity/strategy/mode/hitRate/entries/ttlMs/delivery stay together. Transition.id/fromStateId/eventPortId/guard/toStateId/effects; MachineState.id/label; MachineResponseBinding.id/callPortId/eventPortId; effect.id/kind/path/value/portId/correlation/delayMs/eventPortId/code/outcome; operation.id/kind/schemaId/path/fields/guard/keyPath/valuePath/keyName/sumName; MapOperationField.id/targetKey/value; DecisionCase.id/guard/outputPortId/value; DecisionFallback.outputPortId/value all belong to system-design. Recursive Value and Guard discriminants/operands are also system-design. They must not become generic commands or generic animation tracks.

Port settings likewise remain system-design: CallInSettings.expectedP95Ms/availabilityPct/idempotent/maxConcurrency/rateLimit.rps/burst/failureRate/serviceTimeMs/responseBytes; MessageInSettings.ackDelayMs/messageTtlMs/delivery/ordering; DataInSettings.throughputPerSec/maxStalenessMs; CallOutSettings.retry/circuitBreaker/maxInFlight/hedge.afterMs/requestBytes; MessageOutSettings.confirm/batch.size/windowMs/requestBytes; CallRetryPolicy.maxAttempts/backoffMs/backoffMultiplier/maxBackoffMs/jitter/attemptTimeoutMs; CircuitBreakerPolicy.failureThreshold/openMs/halfOpenProbes. Declared-only settings must remain declared-only.

Additional nested authored fields: Value.kind/value/source/path/fields/items and RecordValueField.key/value; Guard.op/left/right/value/guards/itemGuard; EmitCorrelation.kind/path all belong to system-design. BulkArrival is `null`, `{spreadMs}` or `{ramp:{spreadMs}}` in `src/domain/bulk-arrivals.ts`, also system-design. These are authored semantic values, not generated execution IDs.

## Durable records

Current source: `src/persistence/studio/types.ts`. Target storage owns envelopes/coordination, not the semantics of every payload. Immutable records retain their original payload/hash; ownership extraction alone is not a format migration.

| Record / all declared fields | Target ownership |
| --- | --- |
| Actor.actorId, kind, displayName | whiteboard transaction attribution; current local-human discriminator is explicitly extended for agents later, not silently widened during extraction |
| ProjectRecord.id, title, revision, mainBranchId, initialSnapshotId, importSourceId, createdAt, updatedAt, description, team | storage project lifecycle/metadata; title synchronizes with authored title through existing atomic rename behavior |
| ProjectRecord.exposures | system-design metadata contribution; storage persists it in project envelope |
| BranchRecord.projectId, id, label, state, headCommitId, workingSnapshotId, workingRevision, createdAt | history version mechanics; storage atomically coordinates working pointer/revision with whiteboard transaction |
| SnapshotRecord.projectId, id, document | history immutable snapshot reference; whiteboard document payload through codec; storage retains original bytes/value/hash provenance |
| CommitRecord.projectId, id, snapshotId, parentIds, evidence, evidenceManifest, actor, createdAt, message | history version record; evidence is opaque versioned reference/summary contract supplied by system-design policy |
| PublicationRecord.projectId, id, commitId, sourceBranchId, previousMainHeadId, ordinal, actor, createdAt, metadata, versionKey | history publication mechanics; policy belongs to system-design |
| PublicationMetadata.version, title, rationale, ticketUrl; SemanticVersion.major, minor, patch | history publication metadata |
| CheckpointRecord.projectId, id, snapshotId, sourceBranchId, label, actor, createdAt | history checkpoint mechanics |
| RunRecord.projectId, id, snapshotId, manifest, fingerprint, status, provenance, checks, summary, traceState, createdAt, completedAt | simulation-system-design artifact contract; storage artifact envelope/capability; imported-unverified stays unverified |
| TraceChunkRecord.projectId, runId, index, firstSequence, events, payloads, byteLength | simulation-system-design chunk payload; storage bounds/integrity/persistence |
| OperationRecord.projectId, id, requestHash, result, createdAt | storage durable idempotency receipt; whiteboard consumes transaction result |
| PartRecord.projectId, id, revision, label, description, content, createdAt | system-design reusable-part content/revision; storage persistence capability |
| PreferenceRecord.key, schema, revision, value | storage CAS preference envelope; value schema owned by the feature/app that writes it |

`ProjectBundle`, `PortableFile` and archive validation are storage portability contracts, with injected domain codecs. Version records are never agent input. Database name `system-studio-local-v1`, actor keys and database version remain unchanged in the first extraction. No separate asset table exists in the inspected record inventory; a future asset capability must not claim current assets are already persisted.

`src/domain/studio/exposure.ts` ProjectExposure.channel/protocol/path/contract and ExposedContract.expectedP95Ms/availabilityPct/idempotent/delivery/ordering/throughputPerSec/maxStalenessMs belong to system-design project metadata, not authored branch documents. `ProjectBundle` fields id/title/createdAt/updatedAt/mainBranchId/initialSnapshotId/branches/snapshots/commits/publications/checkpoints/runs/parts and `PortableFile` fields format/version/project belong to storage portability. The current portable bundle excludes receipts, preferences, trace chunks, credentials/device actors, project revision and importSourceId; preserving full storage does not mean silently widening that export format.

## Local and ephemeral state

| Source / symbol / fields | Target owner |
| --- | --- |
| `src/features/session/types.ts` SessionState.status, projectId, branchId, mainBranchId, projectRevision, workingRevision, workingSnapshotId, document, lastError, needsReload | whiteboard editing-session facade; storage supplies scoped revisions/load results, history supplies branch identity; exactly one authoritative document |
| SessionState.canUndo/canRedo; UndoEntry.label/inverseChanges/forwardChanges | history local UndoController, exposed through whiteboard-owned narrow port |
| `src/features/session/controller.ts` isInFlight/listeners | whiteboard per-instance queue/subscriptions; dispose must fence late results |
| `src/features/workspace/Workspace.tsx` activeViewId, selectedNoteIds, selection plans | whiteboard local navigation/selection, never authored data or presence |
| Workspace draft/scenarioDraft, pending guard/apply decisions | system-design draft validation/planning plus whiteboard navigation guard arbitration; form field focus/dialog visibility remains app presentation |
| Workspace selectedScenarioId | system-design local session preference; not scenario authored revision |
| Workspace runController, lastRunSnapshotId, scenarioStatusResult, inspectionEvent | simulation-system-design execution/inspection session; selected inspection is ephemeral |
| Workspace resultsRequested/resultsDismissed/detailsOpen, viewport measurements, historyView/libraryView/publishOpen/quickOptionsOpen, focus IDs, notices, menus/dialog presentation | apps/web; no mandatory feature UI contract |
| `src/features/workspace/panelPreferences.ts` panel open/placement/collapsed/stackOrder/floatRect and sideWidths; dock configuration | apps/web owns presentation value schema; storage owns preference CAS envelope; never board authored geometry |
| `src/lib/theme` palette/mode and motion preferences | ui/browser presentation binding; persistence adapter injected where required |
| `src/features/runs/RunController.ts` RunControllerState.phase/queue/current/issues/events/stopping; CurrentRunState.scenarioId/runId/terminal/saveStatus/measured; TerminalResult.status/checks/summary/reason/measured | simulation-system-design per-instance execution state; persisted run is distinct |
| `src/features/runs/playback.ts` PlaybackStore playhead/computed/windowStart/endAt/speed/playing/following/range | generic playback owns clock/transport/range; simulation recording adapter owns frontier/retention and supplies bounds |
| PlaybackStore flow/cycle indexes/checkpoints/resultDeltas/traffic/flashes/inspection caches; StateAt checkpoint/cycles/nodes/legs/flashes | simulation-system-design recording queries/projection, not generic playback |
| RunController PlaybackClock.now/schedule/cancel | playback injected environment-neutral clock port; worker transport remains simulation-owned |
| Future participant cursor/selection/status | collaboration ephemeral presence, explicitly distinct from local selection and authored fields |
| Future proposal preview/status/model credentials | agents local proposal state; credentials host-owned outside document/storage archive; no implemented baseline fields |

## Conversion gate

Before changing in-memory document shape, the implementation must add bidirectional fixture coverage for every table row above, including multiple placements of one entity, groups/notes/attachments, scenarios, refinements and linked IDs. Core references and system endpoint references validate separately. Unknown namespaced JSON preserves its data values; known schema migrations are explicit. Simulation manifest/fingerprint characterization proves visual fields are excluded as before. This ledger is the minimum migration surface, not permission to rewrite persisted immutable snapshots.
