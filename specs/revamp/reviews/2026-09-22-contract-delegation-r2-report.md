**REVISE** — four concrete blocking findings.

---

**F1 — RV-08d dependency unresolvable: "RV-14 actual runner" names no subgate**

Ledger row RV-08d lists "RV-14 actual runner" as a dependency. RV-14 has six subgates (a–f). The rollout says evidence fixtures suffice for RV-08a but RV-08d needs *actual* runner-produced evidence. It never says which subgates (RV-14b? b+c? b–e?) satisfy that gate. A coordinator can gate-jump RV-08d with partial runner coverage. Require: list exact minimum RV-14 subgates in RV-08d's dependency cell.

---

**F2 — RV-05 undefined; RV-15 retirement gate can never formally close**

Retirement gate text: "RV-05 retains current inspector functionality." RV-05 has no ledger row, no owner, no dependency, no acceptance criteria. RV-15's "replacement acceptance evidence" requirement references an untracked gate. Retirement clearance is indefinitely undecidable. Require: add RV-05 as a named ledger entry (even if a single-row stub with BLOCKED status) or restate the RV-15 dependency on a concrete accepted gate that already exists.

---

**F3 — RV-14d/e serialization condition is unverifiable at dispatch time**

Ledger note: "RV-14d/e are serialized *if they touch the retained kernel.*" No mechanism records that determination. A brief writer could declare no kernel touch and dispatch both in parallel; a reviewer cannot falsify the claim without inspecting the diff—by which point the conflict has already occurred. Require: the brief for RV-14d must declare kernel-touch status as a boolean field before dispatch; RV-14e is serialized unconditionally until RV-14d is ACCEPTED, or the condition must be tightened to "always serialized."

---

**F4 — No ledger gate enforces Gemini write-preflight before first dispatch**

The rollout says (correctly): "Before any future write dispatch, perform a task-scoped no-edit read/ownership acknowledgement and an interruption/timeout rehearsal, then confirm intended write permissions/test commands." But this is prose instruction only. No ledger row, no gate cell, no explicit BLOCKED entry exists that a coordinator must flip before any subgate row moves from BLOCKED to IN_PROGRESS. The prior exit-0 permission-denial failure shows this gap is real. Require: add a `RV-00 Gemini write preflight` row (or equivalent named gate) in the ledger with status BLOCKED; it must reach ACCEPTED before any other row can leave BLOCKED.

---

No dependency cycles found. The apparent RV-08e ↔ RV-16b cycle is correctly broken: RV-08e → RV-16a only; RV-16b → RV-08 history (after RV-08e). The serialization of shared-schema before consumers is correctly stated. The three-process ceiling vs. five planned lanes is operationally manageable given the dependency ordering. F1–F4 are the only concrete blockers.
