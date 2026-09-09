# Diagram SVG/PNG export result

## Implemented

- Added diagram-only SVG and PNG actions to the existing bottom guidance strip with 44px targets, responsive wrapping, disabled/pending states, success feedback, accessible errors and retry.
- Added a browser adapter that creates bounded safe filenames, downloads vector SVG, and rasterizes PNG from the same source with a white background.
- PNG dimensions are capped before the browser decodes the SVG image. Temporary anchors, canvases and every object URL are released on success and all tested failures.
- Export uses the complete graph and current subsystem collapse state while remaining independent of editor pan, zoom, selection and history. Existing JSON backup remains unchanged.

## Verification

- Parent-owned `diagramSvg` verification: 6 renderer tests pass.
- `npm test -- --run src/export/downloadDiagram.test.ts`: 7 adapter tests pass.
- `npm run build`: passes; main entry 608.58 KB / 192.18 KB gzip with the existing chunk-size warning.
- `TEST_PRODUCTION=1 npm run test:e2e -- tests/export.spec.ts`: 2 production Chromium journeys pass in 3.9 seconds.
- Final parent verification: all 115 unit tests across 22 files and all 37 production Chromium journeys passed (37.9 seconds).
- Parent reviewed the final raster and refined word wrapping and separate relationship/protocol lines. Export viewport assertions inspect the actual CSS transform. An initial full run exposed export framing/test targeting and a transient existing concurrency baseline failure; the final full run passed both.

Browser assertions inspect the downloaded data: SVG parses as XML and includes components outside the viewport; PNG has a valid signature and IHDR and decodes through `createImageBitmap`. Coverage also verifies collapsed boundary metadata, viewport/selection immutability, pending/error/retry behavior, and 1000px/mobile containment.

## Evidence and limits

Directly inspected `artifacts/diagram-export.png`, `artifacts/diagram-export-ui.png`, and `artifacts/diagram-export-mobile.png`; `artifacts/diagram-export.svg` is retained for source inspection. The raster contains the complete event-processing template with readable cards and classified paths.

This milestone does not add PDF, clipboard, cloud, selection-only, or simulation-result image export.

Export uses compact standard cards and system fonts, not pixel-identical DOM capture. Visible text is bounded; full names/notes remain in SVG element titles. PNG is capped at 8192 pixels per side and 16 million pixels total. Excessive diagram extents produce an actionable error.
