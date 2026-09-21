# Decision register

Updated 2026-09-21. Only user answers or explicitly identified lead decisions settle a row.

| ID | Status | Decision / consequence |
|---|---|---|
| D01 | Confirmed by user | Source is the local ZIP exported from claude.design, not Figma. |
| D02 | Confirmed by user | Evergreen paper across screens. Other palette explorations are not implementation targets. |
| D03 | Confirmed; refined by D19 | Preserve useful current capabilities; obsolete implementations and old-data compatibility may be removed. Decide new features individually. |
| D04 | Confirmed by user | Branch, commit, publish and merge workflows are local-only first. No accounts/server/sync implied. |
| D05 | Confirmed by user | Reusable saved parts, dock customization, movable/stacked/collapsed panels are included. |
| D06 | Confirmed by user | Codex plans/verifies; Claude is senior reviewer; Gemini implements. |
| D07 | Lead decision | Keep React/Vite, TypeScript, Tailwind v4, current Radix-backed primitives, XYFlow, Zustand and Dexie. No framework or primitive-library migration in the revamp. |
| D08 | Lead decision | Use official shadcn foundations first, custom compositions second. Do not install a generic dashboard block or apply an unrelated visual preset. |
| D09 | Superseded by D20 | Original decision exempted diagrams and preserved legacy snapshots. The user subsequently removed that exemption and old-data compatibility. |
| D10 | Confirmed by user | Configuration drafts use Apply/Cancel; valid Apply is one atomic undo step. |
| D11 | Confirmed by user | Autosave each branch's working state and preserve it across switching. Publish explicitly merges into local main; names are self-reported; nothing uploads. |
| D12 | Confirmed by user | Defer AI generation; include CSV and Mermaid exports. |
| D13 | Confirmed by user | Retain consistent Lucide icons, styled to the design; preserve supplied mark and typography. |
| D14 | Confirmed by user | Full phone editing with adaptive panels and alternatives to dragging/hover. |
| D15 | Lead decision | Examples' names, authors, percentages, component counts, run IDs and warnings are fixture content, never fabricated production values. |
| D16 | Lead decision | No engine changes justified solely by a visual specimen. Unsupported telemetry needs a separate metric definition and instrumentation task, or is omitted with an honest unavailable state. |
| D17 | Confirmed by user | Model-based runs first; real source execution later. All frontend, backend/fullstack, code/data-flow, service-flow and infrastructure use cases matter. |
| D18 | Confirmed by user | Plan for local, hosted and self-hosted bundles and GitHub/server sync. Async branches/review/merge precede live coediting. Future services are not authorized for implementation in this planning task. |
| D19 | Confirmed by user | Old data compatibility can be dropped. No legacy runtime, archive viewer, format-7/8 reader or converter is a required target capability. This planning task does not delete existing local data. |
| D20 | Confirmed by user | Keep run-required commits/publication. Autosave and checkpoints preserve incomplete work. No diagram-only commit exemption in the target model. |
| D21 | Lead proposal for review | One system document, multiple views and explicit model scenarios. Structural relationships are distinguished from executable flows; numeric performance appears only when timing/resource assumptions are provided. |
| D22 | Confirmed by user | Future AI buddy collaborates on app development through the canvas, including discussions, decisions and changes. Structured project content should replace reliance on external Markdown/chat history. No AI implementation now; enforce extensible, validated, provider-independent boundaries in current work. |

2026-09-21 revision: D17–D20 record the user's pre-execution architecture discussion and supersede conflicting initial plan constraints. Runtime semantics and future deployment interfaces need Claude review before implementation. Keep the historical baseline as evidence, not as a requirement to retain abandoned code.

## Lead defaults requiring Claude contract review before implementation

- Local publish: explicit version selection; title required, rationale/author/ticket optional; close draft is opt-in and recoverable. No automatic semantic-version inference from graph shape. Retention/storage budgets require fixture-size analysis in RV-02 before choosing limits.
- Merge: typed three-way merge with explicit delete-versus-edit and reference conflicts; no timestamp-based last-write-wins. See technical proposal.
- Saved parts: independent copies on placement, not live-linked instances; selected nodes plus internal edges. Include only wholly selected subsystems and notes explicitly selected or attached wholly inside the selection; show excluded external links before saving. Local library ownership must not imply a team backend.
- Dock customization: stable command IDs, ordered groups, restore defaults, keyboard reorder; commands omitted from the dock remain reachable through Quick options. Overflow is responsive.
- Panel placement: per-browser preferences excluded from portable model export, widths per side, recovery after viewport shrink. Inspector remains a dedicated contextual region; History/Library share a panel host. On narrow screens one overlay is open at a time. Desktop simultaneous inspector/history/library must preserve a usable canvas or collapse the least recently used auxiliary panel with an accessible notice.
- Run controls: preserve Pause/Resume/Reset; do not add an ambiguous Stop action. A later true stop/finalize command requires a separate contract.
- Metrics: omit unsupported pressure rankings, bottleneck claims, p99 and overflow predictions from initial production UI; use existing measured values. Instrumentation is a separately scoped follow-up, not authorized by this revamp.
- New project semantics: templates/manual creation/import replace the deferred generation surface; no prompt box that pretends to generate a system.
- Contrast and size: some tiny muted metadata and focus-ring colors may need documented accessibility corrections; approve changed tokens using measured contrast evidence.

## Recording a change

Append date, decision ID, user answer or lead rationale, affected requirements/tasks, and superseded text. Never silently broaden a READY task. A scope answer does not approve a storage migration design or declare review complete.
