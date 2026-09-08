# Custom components and duplication result

## Delivered

- Added `custom` to the diagram component catalog with a neutral existing icon, an independent editable type label, instance name and responsibility or technology notes.
- Validated custom type metadata at graph and checkpoint import boundaries: labels are required, trimmed nonempty strings with a 60-character maximum.
- Kept custom components diagram-only. Existing runnable topology validation rejects them without adding simulation behavior.
- Added atomic single-node duplication for every diagram component. Copies preserve node configuration and metadata, receive a fresh ID and deterministic 40-unit stepped offset, and use a bounded `<name> copy` label.
- Copies start selected and unconnected, with no subsystem membership or expanded state. Undo removes the copy in one step; Redo restores the same node ID.
- Added a touch-sized inspector action and visible 100-component explanation. Long type and instance labels wrap inside the existing compact card design on mobile.
- Kept portable export version 7 and reused shared graph validation for current graphs and checkpoints.

## Changed files

- `src/domain/model.ts`, `src/domain/componentCatalog.ts`
- `src/state/editor.ts`
- `src/components/ArchitectureCanvas.tsx`, `src/components/Inspector.tsx`, `src/styles.css`
- Unit, persistence and Playwright tests for the new behavior
- `README.md`, `PRODUCT.md`, `DESIGN.md`, `HANDOFF.md`, `artifacts/VERIFICATION.md`

## Verification

- `npm test`: 93 passing tests across 18 files.
- `npm run build`: passed. Main entry 585.47 KB /184.62 KB gzip; the existing chunk-size warning remains.
- `TEST_PRODUCTION=1 npm run test:e2e`: 31 production Chromium journeys passed in 35.5 seconds.
- Focused post-inspection mobile rerun: 1 journey passed after the final long-caption wrapping adjustment.
- Desktop and mobile journeys write `artifacts/custom-component.png` and `artifacts/custom-component-mobile.png` for the new controls.

## Notes

No format migration, saved custom-type registry, templates, multi-node copy/paste, new simulation semantics, SVG export or automatic layout was added. No commit, push or deployment was performed.

Finalization resolved screenshot cleanup: restored eight unrelated test-regenerated screenshots after confirming they were clean before delegation. Retained the two updated architecture screenshots and the two new custom-component screenshots as feature evidence. No cleanup remains blocked.
