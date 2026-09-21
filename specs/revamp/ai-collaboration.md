# Future AI collaboration through the canvas

Status: future product direction confirmed by the user on 2026-09-21. No AI implementation is in the current scope. The contracts below are lead recommendations for review, intended to avoid expensive changes later without building speculative infrastructure now.

## Product intent

System Studio should become the shared place where a person and an AI buddy reason about and develop an application. Goals, questions, alternatives, decisions, proposed changes, scenario evidence and implementation progress should be understandable and actionable through the canvas. Users should not have to reconstruct project intent from separate Markdown documents or a long chat transcript.

The structured project is the durable source of truth; the canvas and its contextual panels are its primary interface. Conversation can help explain and explore, but an accepted decision or change must have a durable project record. Markdown may remain an export/report format. The current repository planning documents remain the implementation guide until product-native equivalents exist.

## Intended future workflow

1. Select a component, flow, scenario or subsystem and discuss a goal or problem in that context.
2. The buddy reads a versioned view of the relevant system, requirements, decisions and evidence; missing context is explicit.
3. It proposes scoped alternatives or a typed change set, with rationale, assumptions, affected elements and expected checks.
4. The user compares alternatives on the canvas, edits or rejects a proposal, and runs scenarios on a candidate snapshot.
5. Accepted changes use the same validated domain operations as direct editing. New executable changes invalidate stale run evidence.
6. Implementation work can later reference the accepted model/decision and return code changes and verification evidence. The canvas shows what is proposed, accepted, implemented or verified without conflating those states.

Human approval and delegated autonomy policies will be designed with the AI feature. No new per-action approval prompts or autonomous execution policy are imposed on the current app by this document.

## Architectural constraints now

| Boundary | Require in current contracts | Defer until the feature is scoped |
|---|---|---|
| Stable references | IDs for system elements, relationships, scenarios, snapshots and history; revision-aware links | Full requirement/decision/discussion/proposal entities and their UI |
| Domain operations | UI-independent typed commands, validation, atomic change groups, expected revision and structured outcomes | External agent API, MCP/HTTP tools and orchestration |
| Evidence | Immutable run/snapshot identity, scope, assumptions and provenance; no claim beyond tested coverage | AI experiment planning and automatic interpretation |
| Change review | Reusable domain diff/merge and candidate-state validation; do not tie these to one React screen | Agent proposal queues, alternative comparison and policy controls |
| Actor identity | Origin/author provenance distinct from authorization and display names | Agent identities, permissions and delegated credentials |
| Storage | Versioned structured content; separate personal layout, discussion/content and run artifacts from execution configuration | Conversation storage, retrieval indexes and context budgeting |
| Integrations | Provider-independent adapters and portable references | Model providers, code agents, source ingestion and repository write-back |

These are boundary requirements, not permission to create unused plugin systems, generic workflow engines, empty agent services or speculative tables. RV-02 records how extensions can be added; Gemini implements only the contracts needed by current features.

## Future project-native records

Plan for goals/requirements, decisions, questions, alternatives, proposals and review threads to be separately typed, versioned records. They can link to multiple elements/scenarios and to a specific snapshot; they are not all sticky-note strings or executable nodes. Distinguish rationale and assumptions from accepted facts and measured evidence.

Acceptance/rejection/supersession should preserve history. If an element is deleted, its discussion/evidence link remains resolvable against the referenced snapshot or explicitly indicates a missing current target. View rearrangement must not break those links. Proposal states are independent of commit/publication states: an accepted design is not automatically implemented or verified.

The existing run-required commit rule remains. Incomplete reasoning and sketches can live in autosave/checkpoints. Discussion-only or visual changes should not rerun an unchanged executable fingerprint; actual behavior/scenario changes must invalidate corresponding evidence.

## Shared command and proposal boundary

An AI adapter must not bypass validation by writing Zustand/Dexie directly or manipulating rendered canvas elements. Both human and AI-originated edits use the same domain operations. Read, propose, run, apply, commit and publish are distinct capabilities governed by the eventual policy.

A proposed change records its base revision, intended scope, operations, rationale and evidence references. Validate a candidate before applying it; reject/rebase stale proposals rather than overwriting intervening human work. Preserve atomicity, cancellation, undo and idempotent retries. Partial acceptance must be revalidated as a new candidate, not treated as the already-tested original proposal.

Model output, imported project prose and repository text are data, not authority to grant permissions or execute commands. Credentials remain outside portable project data. External inference must respect the chosen local/hosted/self-hosted data policy; local editing cannot require an AI service. No provider or protocol is selected now.

## Connection to application development

Future source references should identify repository, revision, path and symbol where available. Code artifacts and tests link back to the proposal, model snapshot and decisions they implement. Track model/code drift explicitly; changing a diagram does not prove code changed, and a passing model scenario does not prove an actual application passed its tests.

Bidirectional model/code synchronization, automatic code generation, execution sandboxes and conflict resolution need their own feature contracts. Do not promise lossless code round-tripping or reinterpret the deferred real-source runner as already available.

## Review gate and future acceptance

Claude RV-00/RV-02 review must identify any current choice that forces a future buddy to scrape UI text, parse Markdown as its database, bypass domain validation or replace the entire persistence model. Reject those couplings while keeping speculative AI machinery out of scope.

Current verification checks the implemented boundaries as they arrive: pure domain commands, deterministic diffs, stable references, origin metadata and evidence identity. Future AI acceptance will cover a proposal based on an old revision, human edits during generation, partial acceptance, undo, cancelled/failed runs, missing references and an accepted proposal whose implementation/test evidence is still absent. No AI capability is claimed from architecture review alone.
