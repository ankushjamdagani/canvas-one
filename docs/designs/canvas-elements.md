# Canvas authoring: shapes and text

First implementation slice, stacked on the canvas conversations change. Later slices are frames and connections, media, then reusable visual components. Stop after each review PR.

## Experience

The dock's Shapes and text tool creates a rectangle, rounded rectangle, ellipse, diamond, line, arrow or standalone text at the visible canvas centre. These are persistent visual objects, distinct from simulation components, sticky notes and conversations. Select or Shift-select them, drag to move, resize using handles or numeric dimensions, edit literal multiline text, set fill/stroke and text size, duplicate or delete. Text editing has explicit Save/Cancel and retains the draft on a failed save. Creation cannot discard dirty Configuration/scenario drafts.

New objects are centred within the viewport. Transparent text and standalone marks take the active theme's readable ink at creation; existing authored colors are preserved when themes change.

Selected objects can anchor a conversation. Existing Read, Suggest, Live, lease/revision checks and explicit approvals remain authoritative. Whole-board conversations can propose new visual objects; object-scoped conversations may update/delete only their captured, existing same-view objects. Untouched siblings remain motionless during AI activity.

## Storage and contracts

`View.canvasElements` is an optional keyed collection, validated in the system-design package. Existing documents retain absent fields; new data uses the same view replacement transactions, immutable snapshots, provenance, Undo/Redo and three-way field merging. No second board authority or database migration. Each view allows up to 200 visual objects; bounds are finite, width32–2000, height24–2000, text4000 characters, font size8–96 and stroke width0–12. Colors are six-digit hex values or transparent.

Generic board projections use the basic-component schemas/renderers and preserve the complete source document. Portable project JSON archives retain visual objects; SVG/PNG exports include their actual bounds and escaped text. Executable scenario manifests and fingerprints remain unchanged.

## Boundaries

Lines and arrows are standalone horizontal marks; endpoint attachment, routing and rotation are not implemented in this slice. Frames, containers, richer connections, images/files, reusable visual library capture and mixed semantic/visual duplication follow in later slices. Component-only operations reject selections containing visual objects instead of silently dropping them. Existing local-only conversation and multiplayer limits remain unchanged. Old clients reject the new view field instead of silently stripping it.
