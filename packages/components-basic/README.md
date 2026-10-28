# Basic components

Headless schemas, validation and atomic creation planners for text, rectangle,
rounded rectangle, ellipse, diamond, standalone line/arrow, frame, asset-referenced image and freehand entities. Register
`basicComponentsExtension` through the whiteboard extension registry.
The optional `/react` entry supplies overridable renderers; semantic contracts
do not import React. Image bytes remain host-owned: the default image renderer
uses the URI resolved by Board from the document's asset references; hosts can
override it for authenticated or asynchronously resolved assets.

Freehand points use placement-local coordinates. The creation planner accepts
completed strokes; pointer capture/drawing tools can use the same schema without
changing the document kernel. These components do not add simulation semantics.
