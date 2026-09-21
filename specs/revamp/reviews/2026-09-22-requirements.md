Raw reviewer output; reviewed by Codex separately. Claims below are not automatically accepted.

Now I have everything I need. Synthesizing findings.

---

# P1 Requirements Review — System Studio Revamp

**Reviewer:** Claude, read-only session  
**Date:** 2026-09-22  
**Scope:** `requirements.md`, `decisions.md`, `execution-model.md`, `design-evidence.md`, `ai-collaboration.md`, `README.md`, `delivery-plan.md`, `contracts/run-identity.md`, `contracts/transactions.md`, `contracts/execution-slices.md`  
**Verdict: REVISE** — plan is architecturally coherent; seven findings require resolution before implementation dispatch. No fabricated scope in major areas; two unconfirmed capabilities injected by lead require user decision. No critical data-loss contradiction found.

---

## CRITICAL

### F01 — Publication undo not user-confirmed (invented capability)

**Evidence:** `contracts/transactions.md` history transition table defines "Undo latest publication with expected current main → add compensating history record restoring previous published content; advance main to compensation; preserve original history." This is an elaborate lead-authored capability with its own lifecycle rules (descendant branch preservation, concurrent tab race, `no-previous-publication` error code, snapshot/evidence pinning for compensation).

**Gap:** Neither `decisions.md` D01–D22 nor `requirements.md` R08 mention publication undo. R08 says "History presents working edits, immutable commits and published versions" — "immutable published record" implies permanence. D11 says "Publish explicitly merges into local main; names are self-reported; nothing uploads." No user question about rollback was asked or answered.

**Classification:** Necessary **product question**, not a technical decision. Publication undo is user-visible workflow (design screen 22A–F covers history but not undo-publication). It affects whether the history panel has an undo control on published entries, and whether RV-08 and RV-11 must implement compensation logic.

**Action:** Ask the user: "Should a published version be undoable (compensating record, main rewound)? Or is publication permanent/immutable once on main, with forward corrections via new commit?" Remove the compensation subtable from transactions.md until confirmed.

---

### F02 — Inspector occupancy policy gated but absent from decisions register

**Evidence:** `requirements.md` R04 explicitly says "Inspector occupancy policy is decided before integration." `delivery-plan.md` records a lead default: "Desktop simultaneous inspector/history/library must preserve a usable canvas or collapse the least recently used auxiliary panel." This is a lead proposal only — no D-number assigned, no user confirmation.

**Gap:** RV-05 (inspector) and RV-12 (integration) both depend on this. Without a settled decision, Gemini cannot know whether the inspector is a dedicated always-visible region, a dockable panel sharing the panel host, or a stack slot. The lead default collapses LRU on narrow screens — that is a user-visible interaction model requiring user sign-off, not a purely technical call.

**Classification:** Necessary **product question**. How the inspector coexists with History/Library panels is a UX topology decision, not just implementation complexity.

**Action:** Add a D23 row to decisions.md. Ask user: "On desktop, when all three (inspector + history + library) are open simultaneously, what is the policy — auto-collapse LRU, preserve usable canvas with explicit minimum, or something else?"

---

## HIGH

### F03 — Run with unapplied inspector fields: behavior unspecified

**Evidence:** `requirements.md` R06: "A run must use committed editor values; never silently run unapplied fields." No requirement or acceptance criterion specifies what happens when a user has an open dirty inspector draft and triggers Run.

Three options exist: (a) alert/block Run until draft is Applied or Cancelled, (b) auto-Apply then Run, (c) Run against last Applied values without notice (silently ignoring draft). The requirement rules out (c). But (a) vs. (b) is a product-visible outcome: (a) interrupts the run flow; (b) could surprise users by applying a half-finished edit.

**Classification:** Necessary **product question** for R06 acceptance. Also affects the inspector dirty-navigation spec (Apply/discard/cancel path applies to Run trigger, but isn't listed there).

**Action:** Add explicit behavior to R06: "When Run is triggered with a dirty inspector draft, [block/prompt/auto-Apply]." This must be answered before RV-05 and RV-14 are dispatched.

---

### F04 — Merge conflict resolution UX not user-confirmed

**Evidence:** `contracts/transactions.md`: "Ordered sequences (transition priority, data operations, event schedule) are whole-field conflicts initially; no guessed interleaving." `requirements.md` R08: "Resolves conflicts" is stated as an acceptance criterion but the interaction model for conflict resolution is not specified.

Design screen `22F compare and resolve` exists in `design-evidence.md` screen inventory but was not visually certified (design-evidence.md confirms only four frames were rendered: 23A, 22A, 21D, 2A). The whole-field conflict policy for ordered sequences is aggressive: users editing a "transition priority" array on two branches get a conflict requiring manual resolution of the entire sequence. Whether the product presents field-by-field or whole-element conflicts is user-visible.

**Classification:** Necessary **product question** for RV-08/RV-11 scope. The lead defaulted to whole-field conflicts for ordered sequences — reasonable but needs explicit user acceptance since it directly drives the R08 conflict-resolution UX.

**Action:** Confirm with user: "For ordered sequences in conflict (e.g., event order, operation priority), the initial policy is treat the whole sequence as a conflict requiring manual re-authoring — not auto-interleaving. Acceptable?" Record as D-decision. Render screen 22F before assuming the design answers this.

---

### F05 — Workload editing UI: omitted from explicit requirements

**Evidence:** `design-evidence.md` code anchors: `OpenWorkloadControls.tsx`. `requirements.md` R01: "Preserve useful capabilities: scenario/workload editing." R06 covers configuration/validation editors referencing screen `2A workspace`. R13 covers scenario execution. But no requirement ID has an acceptance criterion specifically for the workload editor UI — rates, profiles, request classes, key distribution, tags.

`execution-slices.md` S02 fixture references "order workload with named request classes, inventory/payment response fixtures" as inputs. These must be editable. But which requirement governs the workload editing surface, its inspector placement, and its acceptance tests?

**Classification:** **Omitted current capability** from the explicit requirements. Implied by R01 preservation and R13 scenario inputs, but no named acceptance criterion exists. Delivery plan RV-05 owns `OpenWorkloadControls.tsx` but lists "configuration surfaces; measured section; dirty-navigation coordination" — workload controls are listed in ownership but not in the exit criteria.

**Action:** Add explicit workload-editing acceptance to R06 or R13, or create R16. Ensure RV-05 exit criteria reference it.

---

### F06 — Dark mode / prefers-color-scheme: decision absent, blocks RV-01 token architecture

**Evidence:** `requirements.md` R11: "No introduction of a dark theme based solely on an alternative board." This rules out implementing a dark mode from the Ochre/nocturne/etc. palette explorations. But it does not address whether OS-level `prefers-color-scheme: dark` should be respected.

`design-evidence.md` describes the design as "white dotted canvas, warm panels" — light-mode only. `delivery-plan.md` RV-01 owns `src/styles.css` and the full token architecture. If dark mode is in-scope, the token system must use CSS variable light/dark layers from the start. If it's out-of-scope, only light-mode values are needed. This is an RV-01 blocker.

**Classification:** Necessary **product question** that must precede RV-01 dispatch, not a deferred decision. R11's wording about "alternative boards" specifically is ambiguous about system preference.

**Action:** Add a D24 row: "Does the app force light mode regardless of system preference, or respect prefers-color-scheme: dark?" If light-force, document the reasoning (design is light-only, user confirmed). If dark-mode-capable, scope the token work.

---

## MEDIUM

### F07 — R13 acceptance criteria do not reference execution-slices.md fixture specs

**Evidence:** `requirements.md` R13: "each family has a deterministic input/output fixture and a failure case" — written when S01–S05 were described as "lead proposals for requirements review." `contracts/execution-slices.md` now contains explicit fixture rows, state tables, expected outcomes and accounting checks for all five scenarios.

R13's acceptance criterion is now too coarse to be an acceptance gate. It would pass if an implementer delivered one input/output pair per family, while the contracts require the specific fixture rows in execution-slices.md. Forward reference gap: R13 does not link to execution-slices.md.

**Classification:** Requirements precision gap. Not a contradiction, but would allow an under-specified implementation to claim acceptance.

**Action:** Update R13 acceptance to reference `contracts/execution-slices.md` S01–S05 explicitly, or note "fixtures are defined in execution-slices.md and take precedence over this summary."

---

### F08 — Mermaid export: "explicitly lossy" stated as limitation, not as spec

**Evidence:** `requirements.md` R10: "Mermaid is an explicitly lossy diagram representation." `decisions.md` D12: "include CSV and Mermaid exports." No requirement specifies what Mermaid export must contain (minimum viable element and edge representation) or what is acknowledged as lost (behavior semantics, scenarios, metrics, subsystem nesting).

"Explicitly lossy" as an acceptance criterion means nothing is verifiable. A Mermaid export of node names only could claim compliance. Users presumably want at minimum: element names, connection topology, possibly subsystem boundaries.

**Classification:** **Ambiguous user outcome**. R10 acceptance says "export feature limitations are stated at the action" — but those limitations can't be stated until the useful subset is defined.

**Action:** Add to R10: minimum Mermaid export content (elements, labeled connections, subsystem boundaries if representable) and explicitly listed losses (no behavior, no metrics, no scenario, no resource config). This is a product clarification, not a technical design question.

---

### F09 — Panel/dock dual-entry state: Library docked + dock icon interaction unspecified

**Evidence:** `requirements.md` R07: "Dock entry and panel entry use the same content/actions." R04: Library can dock left/right, float, stack. R05: no duplicate global dock. Design screen `16E Library picker from dock` and `12A–C Library panel` are separate screens.

When the Library panel is already docked (e.g., left rail), clicking the Library icon in the canvas dock: does it (a) focus/expand the already-docked panel, (b) open a second floating instance, or (c) hide the dock icon when panel is docked? R05 says "no duplicate global dock" — so option (b) is probably out. But the visible state of the dock icon and the interaction are not specified.

**Classification:** **Product UX gap** affecting RV-03 (panel host) and RV-04 (dock). This is a state-machine question, not a technical decision.

**Action:** Specify: when Library/History panel is docked, the dock icon [shows/hides/transforms to a focus-scroll-to indicator]. Add to R04 or R07 acceptance.

---

## LOW

### F10 — RV-09 exit criteria missing R11

**Evidence:** `delivery-plan.md` RV-09: "Exit: R07" — all other feature packages include R11 accessibility. Parts placement and library interactions require accessible focus management, keyboard operation, and touch.

**Action:** Change RV-09 exit to "R07/R11."

---

### F11 — Panel undo scope: Cmd+Z behavior for panel placement not stated

**Evidence:** `requirements.md` R04: "Panel operations do not create graph undo entries or reset simulation." This specifies what panel ops don't do, not what they do. Is panel placement (dock/float/collapse) undoable at all? Preferences repo is separate (transactions.md), so Cmd+Z on the graph stack does not undo panel placement. But is there a panel-local undo, or is it simply not undoable?

**Classification:** Missing positive assertion. Low risk — most users expect panel state to be manual/persistent — but the acceptance test "keyboard placement/resize" in R04 should clarify.

**Action:** Add one sentence to R04: "Panel placement is not undoable via Cmd+Z; Escape during drag/keyboard placement cancels back to prior state."

---

## Summary table

| # | Severity | File(s) | Product Q or Tech | Finding |
|---|---|---|---|---|
| F01 | **CRITICAL** | `transactions.md`, `requirements.md` R08, `decisions.md` | Product Q | Publication undo not user-confirmed; invented capability |
| F02 | **CRITICAL** | `requirements.md` R04, `decisions.md`, `delivery-plan.md` | Product Q | Inspector occupancy policy gated in R04 but absent from decisions register |
| F03 | **HIGH** | `requirements.md` R06 | Product Q | Run-with-dirty-inspector behavior unspecified |
| F04 | **HIGH** | `contracts/transactions.md`, R08 | Product Q | Whole-field conflict policy for ordered sequences not user-confirmed |
| F05 | **HIGH** | `requirements.md` R01/R13, `design-evidence.md`, RV-05 | Omitted capability | Workload editing UI has no explicit acceptance criterion |
| F06 | **HIGH** | `requirements.md` R11, `decisions.md` | Product Q | Dark mode / prefers-color-scheme not decided; blocks RV-01 token architecture |
| F07 | **MEDIUM** | `requirements.md` R13, `contracts/execution-slices.md` | Precision gap | R13 acceptance too coarse; doesn't reference execution-slices.md fixtures |
| F08 | **MEDIUM** | `requirements.md` R10, `decisions.md` D12 | Ambiguous outcome | Mermaid export useful subset unspecified; "lossy" is a limitation not a spec |
| F09 | **MEDIUM** | `requirements.md` R04/R07, design screens 16E/12A–C | Product Q | Library docked + dock icon interaction state unspecified |
| F10 | **LOW** | `delivery-plan.md` RV-09 | Consistency | Missing R11 in exit criteria |
| F11 | **LOW** | `requirements.md` R04 | Precision gap | Panel placement undo scope not positively stated |

---

## Verdict: REVISE

**Pass conditions:** F01 and F02 require explicit user answers before any implementation dispatch. F03, F04, F06 must be decided before RV-01/RV-05/RV-08 dispatch respectively. F05 must be added to requirement coverage. F07–F11 can be fixed editorially in the next planning revision.

**No implementation-invented features found** beyond F01 (publication undo). S01–S05 fixtures, canonical encoding, three-way merge and run-identity contracts are lead technical decisions, not user-scope fabrication — all anchored to D17/D20/D21. AI seam boundaries in `ai-collaboration.md` are correctly scoped as extension points, not speculative infrastructure. Legacy retirement and old-data drop are confirmed by D19. Dark mode is a boundary case in R11 wording, not introduced speculation.

**No current useful capability appears dropped** except: workload editing (F05) — currently shipped in `OpenWorkloadControls.tsx`, covered by R01 prose but lacking an explicit acceptance criterion and RV-05 exit gate.

