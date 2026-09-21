Raw reviewer output; reviewed by Codex separately. Claims below are not automatically accepted.

---

# P2 Implementation Architecture Review

Reviewer: Claude Sonnet 4.6, read-only. No edits, no subagents. Evidence sourced from contracts and planning docs only.

---

## B1 / B2 Prior Finding Disposition

**B1 (preferences revision)** — `transactions.md` §Inspector Apply explicitly states: "Persist viewport/panel/dock preferences through a separate preferences repository with its own revision token; preferences writes never touch workingRevision or authored autosave." **Correctly amended. Closed.**

**B2 (scope closure)** — `execution-slices.md` §Delivery ordering gives a 5-step serial sequence; S05 bridge explicitly last. **Correctly closed.**

---

## Five Runnable Cases

### S01 (frontend state machine)
State union, context, guards, all six transition rows, and four fixtures fully specified. Logical/timed timeout distinction explicit. Deterministic. **No issues.**

### S02 (retained accounting + new semantics)
Business outcome mapping correctly layered on existing FIFO/queue/cache/broker kernel. Finite-horizon semantics explicitly preserved (`finished` ≠ every-request-drained). Transport retry fixture with max-2-retry bound is concrete. **Gap: the interface connecting existing `OpenSimulation`/`OpenSimulationAdapter` to the new per-root correlated trace hooks and finite external input scheduling is not yet specified.** Policy is correct; interface is absent. Correctly identified as RV-02 deliverable but must exist before RV-14 step 3 starts.

### S03 (data pipeline)
Operation vocabulary (validate, trim, map, filter, stable-dedup, group, sum) is bounded and complete for the fixture. Dedup order (first valid in declared input order), group sort (same UTF-16 comparator as identity), and sum overflow as explicit failure are all explicit. Provenance per row. **No issues.**

### S04 (infrastructure failover)
Primary fixture fully specified: t0–t5 arrival sequence, detection delays, round-robin cursor semantics, recovery restart at A is fixture-defined (not generalized). Route cursor on rejection is explicit. **Gap: "Separate boundary fixtures MUST cover an active/queued operation at outage" — the policy (explicit fail-at-outage: settle active failed, reject queued, free capacity, cancel completion callbacks) is stated but the fixture rows and expected outcome table are absent.** Must be in the contract before RV-14 step 4.

### S05 (fullstack composition)
Two fixtures (primary success, outage variant) are well-specified. Root correlation ID carried across all three layers. Exclusive refinement rule (select one, never both) is in the fingerprint. Optional S03 via schema-matched ports explicit. **Gap: the scheduler bridge interface (how S01 state-machine events correlate with S02 resource accounting through S04 placement constraints) is not yet specified.** Correctly sequenced last in delivery ordering (step 5), explicitly dependent on steps 1–4 interface freeze. This is an acknowledged dependency, not a plan defect.

---

## Retained Kernel vs New Semantics

Boundary is correctly described: `simulation/open/kernel.ts`, heap/RNG, FIFO/concurrency, retries, cache, broker, and accounting tests retained; per-root trace hooks and external input scheduling are new work under exclusive kernel ownership. Old `executionSignature` invalidation string explicitly retired in favour of full manifest fingerprint. `defaultBehavior()` processor fallback identified as modelling assumption, not measurement. **Kernel boundary is adequate for planning; exact TypeScript interface is the H1 gap.**

---

## Deterministic Scheduling and Bounded Scope

Logical mode ordering (declared position, FIFO internal), timed mode ordering (modeled time, phase priority then insertion sequence — outage/recovery before admissions, completions before new dispatches) are all explicit. Mixed composition uses timed scheduler only when all time-dependent effects have declared durations. Seed in fingerprint. **One gap: the compiler fixed-point dependency closure has no stated compute budget.** The contract specifies runtime step/event/time budgets but not a bound on compiler analysis complexity, which could lock the browser on large models.

---

## Reference Pinning / CAS / Run Evidence

`canonical-json-v1` encoding is rigorous: UTF-16 key sort independent of locale, no whitespace, NaN/Infinity/BigInt/sparse rejection, negative-zero normalization, mandatory default materialization, unknown fields reject rather than drop. The all-field projection test requirement and the schema-evolution synthetic-field-without-classification test (a coverage assertion, not just a golden vector) are excellent design. Required golden byte strings and digests are stated as frozen implementation deliverables.

CAS: one Dexie read-write transaction, no async operations inside, all writers (autosave, commit, publish, restore) use the same revision check. Quota/write failure leaves unsaved result visible with retry, never a durable qualifying record. Reference pinning prevents independent deletion of evidence required by commits.

Publish transaction correctly: precomputes candidate/identities/evidence outside the transaction, rechecks expected head/revision tokens and immutable candidate ID inside. Stale state rejects; no implicit retry with a different candidate.

**One gap: the field-by-field classification of what is executable vs presentation-only vs excluded from the canonical hash is not yet documented.** The contract states "Unknown fields fail validation" and requires the all-field projection test, but the classification table itself must accompany the schema. This is the correctness surface for fingerprint stability.

---

## Future AI / Sync Boundaries

AI adapter correctly positioned as another client of domain commands; cannot write Zustand/Dexie directly. Unknown actor kinds fail command validation now; `ai-agent` authorization deferred. Proposal records (base revision, scope, operations, rationale, evidence references) are designed as structured content, not Markdown strings. Stale proposals rejected/rebased.

Sync: local-first correctness does not depend on cross-tab notification receipt. Expected-head checks on all writers. GitHub sync correctly uses `Studio commit ID ≠ Git SHA` with stored mapping. Multi-remote reconciliation correctly deferred. The interface boundary between local repository and future sync adapter is described in `deployment-and-sync.md` but not yet captured as a concrete TypeScript interface — correctly deferred to RV-16.

---

## Severity-Ranked Findings

| # | Severity | Finding | Location | Action |
|---|---|---|---|---|
| H1 | HIGH | S02 kernel adapter interface absent | `execution-slices.md` §Reuse table, §S02 | Add TypeScript interface for per-root trace hooks and finite external input scheduling to RV-02 before RV-14 step 3 |
| H2 | HIGH | S04 outage boundary fixtures required but unspecified | `execution-slices.md` §S04 | Write fixture rows and expected outcome table for active/queued work at outage time; must be in RV-02 before RV-14 step 4 |
| H3 | HIGH (sequenced) | S05 scheduler bridge interface absent | `execution-slices.md` §S05, §Delivery ordering | Correctly last in delivery ordering; interface must be frozen after S01–S04. Not a plan defect; acknowledged dependency. |
| M1 | MEDIUM | Canonical hash field classification table absent | `contracts/run-identity.md` §Canonical encoding | Exhaustive executable/presentation/excluded classification per schema field required in RV-02; must accompany all-field projection test |
| M2 | MEDIUM | Compiler closure has no compute budget | `contracts/run-identity.md` §Execution manifest | Add node/edge count budget or async-cancellable design requirement to RV-02 scope |
| M3 | MEDIUM | Multi-tab stale detection mechanism unspecified | `contracts/transactions.md` §Local CAS | Policy is correct; mechanism (BroadcastChannel, storage events, polling) deferred to RV-16. Acceptable deferral. |
| L1 | LOW | `operationId` dedup record retention/cleanup unspecified | `contracts/transactions.md` §Shared command boundary | Include in storage budget specification in RV-02 |
| L2 | LOW | Web Crypto failure path for fingerprinting not addressed | `contracts/run-identity.md` §Canonical encoding | Fail-readiness is appropriate default; explicit test recommended |

---

## Contract Verdicts

| Contract | Verdict | Condition |
|---|---|---|
| `run-identity.md` | **Accepted** | M1 (field classification table) is a required RV-02 completion, not a defect in the contract design |
| `transactions.md` | **Accepted** | L1 (dedup retention) should be in storage budget spec; no structural issues |
| `execution-slices.md` | **Conditionally accepted** | H2 (S04 outage boundary fixtures) must be added before RV-14 step 4; H3 correctly sequenced last |

---

## Overall Plan Verdict

**Plan accepted with conditions.**

No fatal design problems. Architecture can express all five modeled cases. Retained exact kernel is protected. Deterministic scheduling is concrete. CAS/fingerprinting/evidence-integrity design is sound. AI and sync seams are correctly positioned without speculative infrastructure.

Conditions required before dependent implementation starts:

1. **RV-02 must deliver** (in addition to current draft content): kernel adapter TypeScript interface (H1), S04 outage boundary fixture table (H2), exhaustive canonical hash field classification table (M1), and compiler closure compute budget (M2).
2. H3 (S05 bridge) is correctly last in delivery ordering — no action needed at RV-02.
3. M3 (multi-tab detection) is correctly deferred to RV-16.
4. D21 disposition from RV-00 (lead decision, contracts peer-reviewed) stands; no additional user gate required on that architectural choice per prior recorded disposition.

