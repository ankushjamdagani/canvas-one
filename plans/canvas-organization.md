# Canvas organization implementation plan

## Goal

Make larger architecture diagrams easier to organize through multiple component selection, moving the selection together, alignment and distribution, and clearer subsystem boundaries. Implement a bounded diagram-only editing milestone, preserving existing executable simulations and the approved light docked workspace.

Baseline: b39da9e; 96 unit tests, production build, 33 full browser journeys plus 7 final reviewed diagram journeys pass. Worktree is clean before this plan. Delegate implementation to ChatGPT Sol with low reasoning effort. No commit, push or deployment by delegate.

## Scope and interaction contract

1. Diagram users can select multiple real component nodes using Shift-click on desktop. Provide a visible selection mode or checkbox-based component selection panel for touch and keyboard users; modifiers must not be the only route. Show selected count, clear selection and a short usage hint.
2. Keep single-node inspector editing working. For multiple nodes show organization controls and selection summary rather than ambiguously editing one component. Pane click clears selection; edge selection clears component selection, and component selection clears selected edges. Editable fields must retain normal text-selection and delete-key behavior.
3. Drag selected components together with a single undoable position edit. Maintain existing ordinary pan behavior and single-node movement. Selection itself is transient UI state: it must not autosave model changes, reset simulation, or add history.
4. Add align left/right/top/bottom for 2+ selected components and distribute horizontally/vertically for 3+. Use measured node dimensions with stable default card sizes before measurement. Alignment uses bounding edges; distribution uses equal gaps within the outer span, preserving first/last bounding anchors. If there is insufficient span for non-overlapping equal gaps, disable distribution with a concise reason rather than silently overlapping cards.
5. Alignment/distribution changes positions only, atomically, with one Undo/Redo entry. A no-op should not add history. Do not alter connections, metadata or simulation parameters.
6. Multiple selection is restricted to visible real diagram components. Subsystem shells and members hidden by collapse are excluded. Expanded members may participate and boundaries must recompute. Do not introduce nested groups or multi-group movement semantics; retain existing independent header dragging for a subsystem. Avoid double-translating a member when React Flow reports both group and child changes.
7. Multiple-node duplication and deletion are out of scope. Explicitly preserve single-component duplication/delete in single selection; disable diagram React Flow native bulk deletion if it would cause repeated-history or partial deletes. Explain available organization actions without exposing a dead delete control. Existing edge deletion remains supported.

## Data and state

- Extend editor transient selection coherently (e.g. selectedNodeIds plus existing selected inspector ID) instead of maintaining conflicting React Flow and Zustand selections. Define and test how select(), load(), scenario/template changes, delete, undo/redo, group collapse and project reopen clear/prune stale IDs.
- Keep changes compatible with existing graph-only history. No schema/export version bump or database migration is required.
- Put alignment/distribution in a small pure domain module (e.g. src/domain/canvasLayout.ts). Input is nodes/selection IDs and measured sizes; output is bounded finite position updates or a non-actionable result. Never read DOM in domain code.
- Add a store action that applies validated position updates in one history transaction and only in diagram mode. Guard unknown/duplicate/stale IDs and inappropriate selection counts.
- New selection state must never enter the worker simulation signature. Single selection and subsystem behavior in executable experiments must remain unchanged.

## Likely files

src/state/editor.ts and tests; src/components/ArchitectureCanvas.tsx; a focused DiagramOrganization component if useful; src/components/Inspector.tsx; src/components/SubsystemNode.tsx and subsystemProjection.ts; src/styles.css; new pure domain layout module/tests; tests/diagram.spec.ts or a new organization.spec.ts.

## Subsystem clarity

Improve existing boundaries using the current neutral/teal system: clear named header and component count, visible border and enough header/content separation. Diagram collapsed groups should describe components, not display meaningless waiting/active simulation counters. Keep those observed counters in executable modes. Changes to group appearance are presentation-only; preserve exact underlying graph identity, existing grouping limits and save behavior.

## Verification

Unit tests must cover varied widths/heights, negative coordinates, reversed selection order, equal-gap calculations, insufficient-span guard, no-op and invalid IDs, atomic history, transient selection behavior and unchanged graph content apart from positions. Verify collapsed member exclusion and no double movement of grouped components.

Browser tests use real pointer/keyboard input, not dispatchEvent shortcuts. Cover Shift selection and touch-accessible selection; align and distribute visibly; multi-drag displacement and one Undo/Redo; selection clearing and inspector transitions; field key protection; subsystem collapse/expand and boundary resizing; persistence of layout after reload/checkpoint/export-import; mobile containment. Verify automatic viewport stability when aligning (do not unexpectedly fit the whole graph for position-only changes).

Run npm test, npm run build, and complete TEST_PRODUCTION=1 npm run test:e2e. Use focused reruns for review fixes rather than broad repetition without cause. Wait for settled layout before screenshots; inspect a clean desktop selection/organization state and mobile controls. Preserve generated artifact hygiene: record clean baseline and restore only unrelated test outputs proven generated by this run.

## Delivery

Update README, PRODUCT, DESIGN, HANDOFF and artifacts/VERIFICATION with actual behavior and measured checks. Add plans/canvas-organization-result.md describing implementation, decisions, verification and remaining limitations. Follow applicable frontend skills and repository instructions. Scope is complete when the above workflow works with existing templates and custom components, and simulation regression checks pass. Leave local changes for parent review; do not launch later milestones.
