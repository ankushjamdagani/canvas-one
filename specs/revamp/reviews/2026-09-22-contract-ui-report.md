Now I have everything needed. Conducting the full review.

---

## Senior Review: RV-02f (commands-and-panels.md) and RV-02g (parts-and-export.md)

**Verdict: REVISE — 14 findings. No scope invented. No implementation actions taken.**

---

### Orientation

Prior review reports are empty (placeholder files). This is a first-pass review. The two contracts are broadly well-structured and correctly defer browser/parser/spreadsheet QA as explicit future testing gates. The issues below are bounded schema/contract gaps that block safe implementation handoff to Gemini.

---

## Part I — commands-and-panels.md

### SEVERITY 2 — Must resolve before implementation

**[CP-1] `availability(context)` — context object has no typed shape**

Section: "Command registry and availability," line 7 ("Context is readonly selection/project/branch/revision/run/draft/storage state").

Prose describes what context *contains* but gives no named type. An implementer cannot write `availability(context)` for any command without knowing field names. Every availability function is a dead letter.

Fix: define `CommandContext` (or equivalent name) with explicit required fields — selected IDs, focused panel, projectId, branchId, workingRevision, activeRunId, draftStatus (`'clean'|'dirty'|'validating'|'saving'`), storageStatus — and reference it in the registry entry type.

---

**[CP-2] `Shortcut` type undefined**

Section: "Command registry and availability," registry entry description (`shortcut:null|Shortcut`).

`Shortcut` is used in the closed registry entry type but never defined. IME/focus guard logic depends on its structure. Is it `{key:string, modifiers:string[]}`, a string literal, or something else?

Fix: define `Shortcut = {key: string, modifiers: ('Meta'|'Ctrl'|'Shift'|'Alt')[]}` or equivalent concrete type in this contract.

---

**[CP-3] Mobile overlay replacement vs draft guard — ordering unspecified**

Section: "Panel state and geometry," width <768 block, "inspector/Library/History/results replace one another after draft guard."

"After draft guard" is stated but the trigger sequence is not: when `library.open` fires on mobile while the inspector has a dirty draft, does (a) availability block the command, (b) execute fires the guard dialog and aborts replacement on Stay, or (c) replacement happens then guard fires? Option (c) loses the draft. There is no explicit ordering contract.

Fix: add one sentence — "On narrow screens, commands that would replace the current overlay evaluate the inspector draft guard *before* any overlay transition; replacement proceeds only after a clean, successful Apply, or explicit Discard resolution."

---

**[CP-4] `branch.switch` draft guard location ambiguous**

Section: "Draft adapter," dirty-navigation guard; "Command registry," `branch.switch` payload.

The draft adapter defines a guard (clean→proceed; dirty→Apply/Discard/Stay), but `branch.switch` in the command table says only "parent/head or branchId and expected revision." It is unspecified whether the guard fires in `availability()` (returns `{enabled:false, reason:'dirty-draft'}`) or in `execute()` (async dialog). These are different UX contracts: the first prevents invocation, the second allows invocation then prompts.

Fix: choose one. Recommended: guard fires in `execute()` as an async pre-check dialog, matching the draft adapter description. State this explicitly in the `branch.switch` payload row and in the draft adapter guard section.

---

### SEVERITY 1 — Implementable but underspecified

**[CP-5] `panel.place` payload missing `index` for stack position**

Section: command table row `panel.place`, payload "panel ID and typed placement/size."

Reducer event `PLACE(panel, placement, index)` includes an `index` parameter for stacking order within a side. The command payload omits it. An implementer cannot route the command to the reducer without this field.

Fix: update payload to "panel ID, typed placement (`'left'|'right'|'floating'`), optional width, optional floatRect, optional stack index."

---

**[CP-6] `run.reset` behavioral scope not stated**

Section: command table row `run.reset`, "reset cancels first."

The runner contract (document-and-runner.md) says Reset = "cancel then clear current display, never delete saved evidence." The command table says only "reset cancels first" with no mention of display clearing. An implementer reading only this table has an incomplete contract.

Fix: add to payload column — "Reset cancels active run then clears live run display; does not delete saved evidence."

---

**[CP-7] `library.open` idempotency when already expanded and focused**

Section: "Command registry," `library.open` row; D30; R07.

D30 and R07 say "focus/expand the existing single instance." The command table says "focus/open singleton." Neither specifies behavior when Library is already expanded *and* focused. A no-op is the logical answer but is not stated.

Fix: add footnote or inline: "If Library is already expanded and focused, `library.open` is a no-op; the dock icon state does not change."

---

### PASS — explicitly deferred (not gaps)

- "Numeric geometry is an initial spec; visual/browser review must verify source fidelity" — correctly deferred to acceptance testing.
- "Acceptance: pure reducer transition matrix..." — correctly an implementation-time gate.
- F2 via visible button when OS captures it — correct future browser compatibility note.

---

## Part II — parts-and-export.md

### SEVERITY 2 — Must resolve before implementation

**[PE-1] Note `attachedElementIds` not covered in UUID remap list**

Section: "Capture and placement," first paragraph, "fresh UUID mapping for all independently identified members, including port/state/transition/effect/operation/schema-field/fixture/refinement/mapping/group/note IDs."

`Note.attachedElementIds:Id[]` are element ID references inside notes. The remap list says "note IDs" (i.e., the note's own `id`), not the element references *within* notes. After placement, `attachedElementIds` would point to old element UUIDs if not explicitly rewritten — creating dangling references in the placed copy.

Fix: append to the remap list — "note `attachedElementIds` are rewritten using the element UUID mapping."

---

**[PE-2] Refinement `portMappings` Endpoint fields not covered in remap**

Section: "Capture and placement," remap list.

`Refinement.portMappings[{id, outer:Endpoint, inner:Endpoint}]` — each `Endpoint` is `{elementId, portId}`. The remap list says "refinement/mapping" IDs — this covers the mapping record's own `id`, but not the `elementId`/`portId` fields inside `outer`/`inner`. After placement with fresh element and port UUIDs, stale Endpoint values in portMappings break refinement execution.

Fix: add — "portMapping `outer` and `inner` Endpoint fields (`elementId`, `portId`) are rewritten using the corresponding element and port UUID mappings."

---

### SEVERITY 1 — Implementable but underspecified

**[PE-3] Relation element reference fields not explicitly listed in remap**

Section: "Capture and placement," remap list.

`contains.parentId/childId`, `deployed-on.elementId/hostId`, `descriptive.sourceId/targetId` are element ID references in relations. The remap list omits them. "Schema-owned reference descriptors" is the stated mechanism, which implies they're covered — but an implementer doing exhaustive coverage testing ("unknown new reference fields fail coverage") cannot verify without explicit enumeration.

Fix: add to remap list — "relation element references (parentId, childId, elementId, hostId, sourceId, targetId) are rewritten using the element UUID mapping."

---

**[PE-4] CSV `run_status` column — values not enumerated**

Section: "CSV v1," fixed column list, `run_status`.

The storage contract defines run `status` as `completed|invalid|failed|cancelled|incomplete`. The CSV contract lists `run_status` as a fixed column but never states its value domain. An implementer must cross-reference the storage contract to discover the values — fragile for a closed schema column.

Fix: inline the value set — "`run_status`: `completed|invalid|failed|cancelled|incomplete`."

---

**[PE-5] CSV `provenance` column — values not enumerated**

Section: "CSV v1," fixed column list, `provenance`.

Storage contract defines `provenance:'local'|'imported-unverified'`. CSV lists `provenance` as a fixed column with no value domain stated.

Fix: inline — "`provenance`: `local|imported-unverified`."

---

**[PE-6] CSV formula-prefix rule — "fullwidth equivalent" not enumerated**

Section: "CSV v1," formula-safe encoding paragraph.

"First non-whitespace code point is `=`, `+`, `-`, `@` or a fullwidth equivalent" — "fullwidth equivalent" names a concept but not code points. Implementers must guess which fullwidth forms are in scope (U+FF1D `＝`, U+FF0B `＋`, U+FF0D `－`, U+FF20 `＠`). This is a schema contract gap, not a QA testing gap. The downstream QA testing gate is separate and correctly deferred. ✓

Fix: replace "or a fullwidth equivalent" with "or their fullwidth equivalents (U+FF1D, U+FF0B, U+FF0D, U+FF20)."

---

**[PE-7] Mermaid subgraph nesting — "one-level" constraint not stated as absolute**

Section: "Mermaid v1," subgraph paragraph.

"One-level view groups are supported" describes what the implementation handles. It does not explicitly prohibit generating nested subgraphs when multiple wholly-selected groups exist. If an implementer tries to detect group containment and emit nested subgraphs, they'd produce invalid Mermaid for this scope.

Fix: add — "Subgraphs are always emitted at the top level; this generator never produces nested subgraph declarations regardless of group membership."

---

### PASS — explicitly deferred (not gaps)

- "implementation QA must test the chosen encoding in target spreadsheet readers and strengthen it if needed" — spreadsheet formula safety testing correctly deferred. ✓
- "implementation must parse adversarial golden outputs using a pinned dev-only Mermaid parser" — Mermaid parser verification correctly deferred. ✓
- "Existing `src/export/diagramSvg.ts` and `downloadDiagram.ts` are source evidence, not automatic acceptance for new view semantics" — ✓
- "A syntax promise without parser evidence is not acceptance" — ✓
- OWASP CSV link and application-dependent note — correctly scoped. ✓

---

## Scope check

All 14 findings are bounded to v1 contracts. No AI, sync, or remote seams were touched. No new milestones or features invented. AI/sync extension seams in document-and-runner.md (actor kind union, future `ai-agent`) and storage-and-limits.md (`importSourceId` provenance) are correctly gated as future-only and were not disturbed.

---

## Summary

| File | Severity 2 | Severity 1 | Explicit future deferred |
|---|---|---|---|
| commands-and-panels.md | 4 (CP-1–4) | 3 (CP-5–7) | 3 |
| parts-and-export.md | 2 (PE-1–2) | 5 (PE-3–7) | 5 |

**Verdict: REVISE.** The four Severity 2 items (CP-1, CP-2, CP-3, CP-4, PE-1, PE-2) must be resolved before these contracts are implementation-ready. Severity 1 items can be resolved in the same pass. No implementation work should proceed against the current drafts.
