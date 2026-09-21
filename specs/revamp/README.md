# System Studio revamp

Status: initial visual plan recorded; architecture reopened before execution. No application implementation authorized for Codex. Updated 2026-09-21.

Long-term product direction: [AI collaboration through the canvas](ai-collaboration.md). The future buddy participates in structured decisions, proposals, runs and implementation review anchored to the project. Current contracts must support that evolution; no AI implementation is included now.

## Architecture discussion takes precedence

The user expanded the planning questions after the initial checkpoint. Read [execution model](execution-model.md), [deployment and sync](deployment-and-sync.md), and [legacy retirement](legacy-retirement.md) first. Model-based runnable experiences must cover frontend/backend/fullstack, code/data flow, service flow and infrastructure. Actual source execution and live coediting are later capabilities; async collaboration comes first. Old-data compatibility can be dropped. Commits/publication still require runs; incomplete work uses autosave/checkpoints, with no diagram exception. No implementation package may start from the old assumptions.

## Working agreement

The user assigned Codex technical leadership, planning and verification; Claude senior engineering review; Gemini/agy implementation under bounded guidance. This overrides older platform-specialization preferences for this initiative. Codex dispatches installed CLIs directly, tracks results and verifies them. Claude's initial architecture review has returned; see the task ledger for acceptance and follow-up status.

The deliverable is the supplied design brought into the existing product without losing capabilities or inventing behavior. Evergreen paper is confirmed. Local branches/commits/publishing/merge, reusable saved parts, dock customization and movable/stacked/collapsed panels are confirmed scope. New features elsewhere in the boards require individual decisions.

## Read order

1. Repository `AGENTS.md` and `HANDOFF.md` for workflow and invariants.
2. [Decisions](decisions.md): confirmed choices and questions that gate work.
3. [Design evidence](design-evidence.md): exact source package, reference screens, contradictions.
4. [Requirements](requirements.md): behavior and acceptance criteria.
5. [Technical design](technical-design.md): boundaries, contracts, persistence and migration.
6. [Component foundations](components.md): shadcn mapping and component quality rules.
7. [Delivery plan](delivery-plan.md): dependencies, exclusive ownership and work packages.
8. [Verification](verification.md): baseline and acceptance gates.
9. [Task ledger](tasks.md) and [handoff protocol](handoffs.md): claim/resume/review work.

## Authority

Latest user answers > recorded decisions > approved requirements/contracts > selected Directions screens (layout/interaction) and Design System board (tokens/states) > package README/examples. Existing engine invariants remain binding unless explicitly changed. Do not treat screen numbers as global chronology: `22A` and `2A` identify multiple different frames. Use full `data-screen-label` plus enclosing section.

Planning documents distinguish **confirmed scope**, **technical decision**, **proposal**, and **blocked decision**. A confirmed feature is not an executable task until its contract, ownership, fixtures and acceptance criteria are ready. Gemini must not infer missing product semantics from decorative or example content.

## Resume in five minutes

Read decisions and task ledger, check `git status`, compare the current commit with the task's base, then open only the assigned source files and reference screens. Pick a READY task whose dependencies are accepted. Never pick work merely because another agent is slow. If a task blocks, checkpoint it and select another READY package; preserve ownership until an explicit transfer.

Shared integration files (`src/App.tsx`, editor state, persistence, global styles, package files) are serialized. Independent UI packages consume frozen contracts and fixtures before integration. Codex verifies integration; Gemini performs integration edits under a dedicated assignment; Claude reviews the resulting diff.
