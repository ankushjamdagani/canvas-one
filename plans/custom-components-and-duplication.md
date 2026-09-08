# Implementation plan: custom components and duplication

## Goal and scope

Let users represent systems outside the built-in 28-component catalog and quickly repeat configured diagram components. Implement this milestone in Architecture diagram mode only. Preserve existing URL lookup, load balancing, finite-cache and background-job execution exactly.

Deliver a generic custom component with an editable type label, instance name and responsibility/technology notes, plus single-node duplication for all diagram components. Reusing a configured custom component through duplication is sufficient for this milestone. A saved cross-project custom-type registry, templates, multi-node copy/paste, new simulation semantics, SVG export and automatic layout are out of scope.

## Current baseline

- Feature checkpoint: a942f8c.
- 88 unit tests and 29 production Chromium journeys pass; TypeScript/Vite build passes.
- Main entry has an existing chunk-size warning (583.57 KB /184.15 KB gzip).
- Existing uncommitted README.md, HANDOFF.md and artifacts/VERIFICATION.md updates belong to the progress audit. Preserve them.
- Graph history stores Graph snapshots; checkpoints also contain Graph. Prefer node-local custom metadata so both work without project-level history changes.
- Portable export is version 7; browser-local records must never be deleted. No old-format compatibility work is required.

## 1. Domain representation and validation

Files: src/domain/model.ts, src/domain/componentCatalog.ts, their tests.

1. Add `custom` to ComponentKind and its display label. Give it a neutral existing icon and a catalog entry (Operations is acceptable), searchable as Custom component.
2. Add optional `customType?: string` to ModelNode. For custom nodes, initialize it to `Custom component`; expose a distinct type label instead of overloading the instance name.
3. Use existing name limit (80) and notes limit (240). Limit custom type to 60 characters; require a trimmed nonempty value on custom nodes. Reject wrong types, whitespace-only labels and overlong values at import/validation boundaries. Keep ordinary existing nodes valid without this field.
4. Custom components remain non-executable. Existing topology validation must reject them in runnable lookup/jobs models; all UI creation controls are diagram-only. Do not change the simulation engine to invent behavior.
5. Audit exhaustive ComponentKind mappings and componentDefinition lookups so no undefined icon/definition crashes are introduced.

## 2. Atomic duplication action

Files: src/state/editor.ts, src/state/editor.test.ts; optional small pure domain helper.

1. Add a store action `duplicateNode(id)` guarded by diagram mode and the 100-node limit. Return a usable result or failure indication for UI feedback.
2. Clone all source node configuration and metadata, generate a fresh UUID, and offset position by roughly 40 canvas units on each axis. Avoid exact position collisions with repeated copies by stepping the offset deterministically.
3. Name copies `<name> copy`, truncating the source portion to preserve the 80-character limit. Keep custom type and notes unchanged.
4. Select the new node and record the insertion as one history operation. Undo removes it and Redo restores it with the same ID. Follow existing selection repair conventions when undoing.
5. Do not copy incident connections, subsystem membership, expanded state or saved results. The duplicate starts as an independent unconnected component. Existing edges retain all labels/protocols/flow types.
6. Missing IDs, subsystem IDs, non-diagram mode and full diagrams must be safe no-ops with no spurious history entries. Enforce limits in the store, not only in controls.

## 3. User interface

Files: src/App.tsx (library), src/components/Inspector.tsx, src/components/ArchitectureCanvas.tsx, src/styles.css and relevant component renderer mappings.

1. Add Custom component to the searchable diagram palette. Creating one uses the existing add-and-select/recenter behavior.
2. For a selected custom node show Type label, Name, and Responsibility / technology fields. Do not show capacity, queue, workers, cache or other simulation settings.
3. Render the custom type as the component's type caption and its instance name as the main label. Use plain text rendering, wrap long words, and preserve readable bounded cards.
4. Add a visible Duplicate component button in the selected diagram node inspector. Support keyboard focus and touch targets at least 44px high. Disable at 100 nodes with a visible explanation. No keyboard shortcut is required.
5. After duplication reveal/select the copy using established canvas behavior. Keep connection editing accessible and simulation controls disabled in diagram mode.
6. Preserve the approved light docked workspace, restrained teal/amber and mobile inspector layout. Avoid a new modal when inline fields suffice.

## 4. Persistence and compatibility

Files: src/persistence/projects.ts, src/persistence/projects.test.ts.

1. Prove custom nodes and duplicates survive autosave/reload, checkpoints, Undo/Redo and JSON export/import.
2. Retain version 7 for the additive node metadata/type extension, consistent with the existing catalog extension. Existing v7 non-custom projects remain valid; older application builds may reject the new custom kind. Do not claim backward reader compatibility.
3. Validate custom metadata in the current graph and every checkpoint through the shared graph validator. Reject malformed data safely without touching stored projects.
4. Preserve imported connections, subsystems and saved runs under existing rules. No database reset or migration deleting local records.

## 5. Verification and acceptance criteria

Add meaningful tests covering:

- Custom-node construction, valid/invalid labels and catalog lookup.
- Runnable topology rejection for custom components.
- Duplicate independence, all copied configuration/metadata, fresh identity, bounded naming, position offset, preserved original connections and no implicit subsystem membership.
- One-step Undo/Redo and missing-ID/non-diagram/100-node guards.
- Current-format round-trip with custom nodes in graphs and checkpoints; malformed custom metadata rejection.
- Desktop browser journey: create custom component, edit type/name/notes, connect it, duplicate, confirm copy has no edges, Undo/Redo, checkpoint, reload and export/import.
- Mobile journey: creation and duplication controls accessible without horizontal overflow; long labels/notes remain inside cards.
- Built-in diagram node duplication and visible node-limit feedback.

Run npm test, npm run build, then TEST_PRODUCTION=1 npm run test:e2e. Inspect desktop/mobile screenshots of the new controls. Existing 29 journeys must continue to pass. Report exact totals, failures and any checks blocked by environment restrictions; do not call an unrun check passed.

## 6. Documentation and delivery

Update README.md with user instructions and the diagram-only scope. Update PRODUCT.md, DESIGN.md, HANDOFF.md and artifacts/VERIFICATION.md as appropriate to the final implementation and actual evidence. Preserve current audit edits. Add a completion report at plans/custom-components-and-duplication-result.md with changed files, decisions, test results and outstanding issues.

Do not commit, push, deploy, change account configuration or invoke unrelated external services. Leave the implementation reviewable as local changes. Follow applicable repository instructions and relevant frontend skill instructions if available. If scope or a tool permission blocks execution, record the precise blocker instead of bypassing it.
