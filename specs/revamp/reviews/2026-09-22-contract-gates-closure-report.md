**Storage findings (D1, D2) — 2 of 2 PASS**

**D1 — Pin closure missing `initialSnapshotId`**
Fixed. Revised pin closure now reads: "Pin closure includes `projects.initialSnapshotId`, all branch working/head snapshots, commit ancestry/evidence, publications, checkpoints and snapshots referenced by every retained run (including unpinned runs)." Explicit anchor present. **PASS**

**D2 — `completedAt` nullability vs. terminal-only save**
Fixed. Runs table now types `completedAt:number` (non-nullable). Prose confirms: "all are terminal and completedAt is the finite termination timestamp, including unsuccessful attempts." **PASS**

---

**Delegation findings (F1–F4) — 4 of 4 PASS**

**F1 — RV-08d dependency unresolvable**
Fixed. Dependency cell now reads `RV-08c; RV-14a–f all ACCEPTED`. Exact minimum subgates enumerated; no partial-coverage gate-jump possible. **PASS**

**F2 — RV-05 undefined / retirement undecidable**
Fixed by delegation. Ledger now states: "RV-05 (inspector) is tracked there [main tasks.md], with package scope and acceptance in delivery plan; retirement requires that package's actual ACCEPTED replacement checkpoint." Single authoritative tracking location named. **PASS**

**F3 — RV-14d/e serialization condition unverifiable**
Fixed. Condition removed entirely. Ledger now reads: "RV-14d/e are always serialized: RV-14e starts only after RV-14d is ACCEPTED, regardless of proposed files." No per-brief kernel-touch assertion required. **PASS**

**F4 — No gate enforcing Gemini write-preflight**
Fixed. `EXEC-PREFLIGHT` named global gate added in BLOCKED state with explicit enforcement: "No implementation claim may enter IN_PROGRESS until EXEC-PREFLIGHT is ACCEPTED." Satisfies F4's requirement for a named gate a coordinator must flip. **PASS**

---

**Regressions introduced by fixes: none**

- D2 fix (`completedAt:number`) is strictly stronger — no path to a null-in-practice type confusion.
- F3 fix (unconditional serialization) is more conservative than the prior conditional; no consumer subgate is unlocked earlier than before.
- F4's EXEC-PREFLIGHT is prose-level, not a table row. Finding accepted "or equivalent named gate"; the enforcement clause is unambiguous and blocks all subgates uniformly. No structural gap from non-table form.
- D1 fix's incidental expansion ("including unpinned runs" in pin closure) strengthens retention, does not weaken any invariant.
