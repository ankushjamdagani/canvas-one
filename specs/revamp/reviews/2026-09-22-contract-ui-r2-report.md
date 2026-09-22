Reading all three artifacts now before rendering findings.

## Closure review: RV-02f / RV-02g vs prior report

Checking all 14 prior findings against the revised drafts.

---

### Part I — commands-and-panels.md

| Finding | Fix required | Status |
|---|---|---|
| **CP-1** `availability(context)` no typed shape | Define `CommandContext` | **CLOSED** — `CommandContext={projectId,branchId,workingRevision,selectedElementIds,selectedConnectionIds,activeViewId,focusedSurface,activeRunId,runState,draftState,storageState,branchState,eligibility}` now in Draft adapter |
| **CP-2** `Shortcut` undefined | Concrete type | **CLOSED** — `Shortcut={key:string,modifiers:('Mod'\|'Shift'\|'Alt')[],scope:'global'\|'canvas'}` defined; `Mod` platform-resolved per contract |
| **CP-3** Mobile overlay replacement ordering | Guard fires before transition | **CLOSED** — Draft adapter: "Its execute handler invokes the asynchronous draft guard **before** changing selection, branch, project or overlay" covers mobile case |
| **CP-4** `branch.switch` guard location ambiguous | Guard in `execute()` async | **CLOSED** — Same execute-handler guard sentence establishes async pre-check for navigation including branch switch |
| **CP-5** `panel.place` missing stack index | Add optional index | **CLOSED** — Payload now `{panelId,placement:'left'\|'right'\|'floating',index:0\|1}` |
| **CP-6** `run.reset` scope incomplete | State display-clear, no evidence delete | **CLOSED** — Row now reads "reset cancels then clears live display, never saved evidence" |
| **CP-7** `library.open` idempotency | No-op when already expanded+focused | **CLOSED** — "Library/History open is a no-op if already expanded and focused; otherwise expands/focuses the existing singleton without toggling it closed" |

All 7 CP findings closed.

---

### Part II — parts-and-export.md

| Finding | Fix required | Status |
|---|---|---|
| **PE-1** Note `attachedElementIds` missing from remap | Append to remap list | **CLOSED** — Remap list now leads with "Note.attachedElementIds and Group.elementIds" |
| **PE-2** Refinement portMapping Endpoint fields missing | Explicit outer/inner elementId+portId | **CLOSED** — "every portMapping outer/inner elementId+portId" now in remap list |
| **PE-3** Relation element references not enumerated | Explicit list | **CLOSED** — "Relation parentId/childId/elementId/hostId/sourceId/targetId" now explicit |
| **PE-4** CSV `run_status` values absent | Inline value set | **CLOSED** — "CSV enums are exact: `run_status=completed\|invalid\|failed\|cancelled\|incomplete`" |
| **PE-5** CSV `provenance` values absent | Inline value set | **CLOSED** — "`provenance=local\|imported-unverified`" same sentence |
| **PE-6** Fullwidth formula triggers not enumerated | List code points | **CLOSED** — Now "fullwidth U+FF1D, U+FF0B, U+FF0D, U+FF20" explicit |
| **PE-7** Mermaid top-level-only constraint implicit | Absolute prohibition | **CLOSED** — "Subgraphs always emit at top level, never nested" plus schema-rejection gate for future overlap |

All 7 PE findings closed.

---

### New issues introduced by revisions

None blocking. One observation worth recording:

`panel.place` with `placement:'floating'` has no `floatRect` in its payload — the contract relies on "Floating defaults 360×480" for size and is silent on initial x,y position. This is not a regression from the prior draft (the gap predates it) and is not a new finding introduced by the revision; the numeric geometry note covers it as initial spec subject to visual review. Not blocking.

---

**Verdict: PASS**

All 14 prior findings are closed by targeted, minimal edits with no scope creep. Explicitly deferred gates (browser/spreadsheet/Mermaid-parser QA) remain intact. Contracts are implementation-ready.
