# Storage

Headless immutable insertion, operation-receipt replay and atomic row-store ports.
Call receipt replay before CAS checks, and write receipts in the same transaction
as authored mutations. Consumers supply payload types, canonical equality and
domain error policies. MemoryBackend serializes transactions, rolls back failures
and clones reads/writes. Transaction handles expire when their callback returns.

Stores expose delete, bounded primary-key scans with exclusive continuation keys,
partial updates and bounded equality/inclusive-range queries over host-declared indexes. Pages explicitly report
truncation. Both backends return detached records and expire transaction handles.

ProjectCatalogReader owns project lookup and complete paginated title/id ordering;
the current app delegates its catalog reads to this service. ProjectRecord owns
generic catalog fields while the host supplies additional metadata.
ProjectCatalog provides create/rename/delete with receipt replay before CAS.
Hosts supply request fingerprints, metadata codecs, and required related-row
transaction participants. Deletion retains its receipt so retry can replay after
the project disappears. Hosts must scope and authorize lifecycle requests before
dispatch; the catalog does not authenticate actors. Hashes/network/worker work
must finish before entering the transaction.

PreferenceService owns independent preference CAS and detached values. Its schema,
optional value validator and failure mapper are supplied by the host. Preferences
never change authored snapshots or project revisions. RepositoryError,
mapStorageError and save-recovery contracts/mechanics are headless; backend error
classification and domain issue construction are injected by application bindings.
SnapshotRecord, OperationReceipt and PreferenceRecord own generic storage row
contracts without importing system documents or execution artifacts.

AtomicDocumentCoordinator owns prepared snapshot writes: receipt replay precedes
branch CAS; snapshots, required metadata participants, branch/project revisions
and receipts commit together. Hosts inject immutable equality/collision policy,
limits/preconditions and typed result/error constructors. Prepared requests are
cloned and frozen. Domain validation and snapshot/request hashing happen before
dispatch. The current application's model.apply-records uses this coordinator
over its unchanged complete IndexedDB transaction table set.

ProjectLifecycleCoordinator owns project creation, revision-CAS updates and
protected deletion. Receipt replay precedes existence and revision checks;
project rows and immutable receipts share one transaction with injected domain
initialization, limits, branch/snapshot changes and cleanup. The current app uses
this coordinator for create, rename, details and delete. Deletion deliberately
does not add a receipt: its host preserves the existing deletion contract and
removes all project-scoped records, including historical receipts. Related domain
writes and cleanup use portable row-store ports. Limits and semantic
reference validation still read the current domain rows through host policies.

ImmutableArtifactCoordinator commits heterogeneous immutable artifact batches
through host-provided equality and collision policies. It clones prepared rows
before entering the transaction. The application's run save uses it for snapshots,
run metadata and trace chunks. Archive import uses insertImmutableRecords inside
ProjectLifecycleCoordinator so imported rows and their receipt share atomicity.
Archive validation and imported-run provenance remain host domain policy.

ArtifactPruningCoordinator owns revision checks, trace-page deletion, retained-run
trace-state changes, complete run/snapshot deletion and the project revision bump.
The host checks live reference protection inside the transaction before mutation.
The current application supplies history pin-closure policy, which permits trace
pruning of pinned evidence while preventing deletion of referenced evidence rows.

The current app consumes these catalog reads and authored transaction primitives.
Its repository binds database/domain policy to the generic coordinators; the part
repository remains a concrete IndexedDB binding. Inject a repository for another
complete-app backend. This package does not import system semantics or simulation.

AtomicOperationCoordinator applies prepared immutable/add/update/put row plans and
their immutable operation receipt in one transaction. Receipt replay precedes
planning, so stale retries do not rerun policies. Current branch create, checkpoint,
restore, reopen, commit and publication writes use this coordinator; pure branch
effects and revision transitions come from history's HistoryTransitionPlanner.
