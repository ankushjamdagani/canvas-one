---
trigger: always_on
description: Core frontend design and implementation guidelines for rich, empathetic, and ergonomic user interfaces.
---

# Frontend Guidance

Follow these instructions when building applications with a frontend experience:

## Build with Empathy

- **Respect Existing Conventions**: When working with an existing design or design framework in context, pay careful attention to existing conventions and ensure that what is built is consistent with the frameworks used and the design of the existing application.
- **Deep Audience Understanding**: Think deeply about the audience and use that to decide what features to build and when designing layout, components, visual style, on-screen text, and interaction patterns. Using the application should feel rich and sophisticated.
- **Domain & Subject Matter Tailoring**: Tailor the frontend design for the domain and subject matter of the application:
  - *SaaS, CRM, and operational tools* must feel quiet, utilitarian, and work-focused rather than illustrative or editorial: avoid oversized hero sections, decorative card-heavy layouts, and marketing-style composition, and instead prioritize dense but organized information, restrained visual styling, predictable navigation, and interfaces built for scanning, comparison, and repeated action.
  - *Games and creative apps* can be more illustrative, expressive, animated, and playful.
- **Ergonomic Workflows**: Ensure common workflows within the app are ergonomic, efficient, and comprehensive, so the user can seamlessly navigate in and out of different views and pages.

## Design Instructions

- **Control Semantics**:
  - Icons in buttons for tools.
  - Swatches for color.
  - Segmented controls for modes.
  - Toggles/checkboxes for binary settings.
  - Sliders/steppers/inputs for numeric values.
  - Menus for option sets.
  - Tabs for views.
  - Text or icon+text buttons only for clear commands (unless otherwise specified).
- **Cards & Border Radius**: Keep cards at 8px border radius or less unless the existing design system specifies otherwise. Do not put UI cards inside other cards. Do not style page sections as floating cards. Only use cards for individual repeated items, modals, and genuinely framed tools. Page sections must be full-width bands or unframed layouts with constrained inner content.
- **Icon Usage & Tooltips**:
  - Do not use rounded rectangular UI elements with text inside if a familiar symbol or icon exists (e.g. arrow icons for undo/redo, B/I icons for bold/italics, save/download/zoom icons).
  - Build tooltips that name/describe unfamiliar icons on hover.
  - Use Lucide icons inside buttons whenever one exists instead of manually-drawn SVG icons. If there is a library enabled in an existing application, use icons from that library.
- **Completeness & Polish**: Build feature-complete controls, states, and views that a target user would naturally expect.
- **No Descriptive In-App Clutter**: Do not use visible, in-app text to describe the application's features, functionality, keyboard shortcuts, styling, visual elements, or how to use the application.
- **First Screen Experience**: Do not build a landing page unless absolutely required; when asked for a site, app, game, or tool, build the actual usable experience as the first screen, not marketing or explanatory content.
- **Hero Page Principles (When Required)**:
  - Use a relevant image, generated bitmap image, or immersive full-bleed interactive scene as the background with text over it (not inside a card).
  - Never use a split text/media layout where a card is one side and text is on another. Never put hero text or primary experience in a card. Never use a gradient/SVG hero page or SVG hero illustration when a real or generated image can carry the subject.
  - For branded/product/venue/portfolio/object pages, ensure the subject is a first-viewport signal, not just tiny nav text or an eyebrow. Hero content must leave a hint of the next section's content visible on every mobile and desktop viewport.
  - Make the `h1` the brand/product/place/person name or literal offer/category; put descriptive value props in supporting copy, not the headline.
- **Visual Assets & 3D**:
  - Use real visual assets or generated bitmap images instead of SVGs (unless building a game). Primary media should reveal the actual product, place, object, state, gameplay, or person—avoid dark, blurred, cropped, stock-like, or purely atmospheric media.
  - For games or interactive tools with established rules/physics/parsing/AI engines, use proven existing libraries for core domain logic.
  - Use Three.js for 3D elements, making the primary 3D scene full-bleed or unframed (not in a decorative card/preview container). Verify with Playwright screenshots and canvas-pixel checks across desktop/mobile viewports that it is nonblank, correctly framed, interactive/moving, and assets render without overlapping.
- **Visual Hygiene & Layout Stability**:
  - Do not add discrete orbs, gradient orbs, or bokeh blobs as decoration or backgrounds.
  - Ensure text fits within parent UI elements on all viewports (wrap lines or use dynamic sizing). Text must never occlude preceding or subsequent content.
  - Match display text to container: reserve hero-scale type for true heroes, and use smaller, tighter headings inside compact panels, cards, sidebars, dashboards, and tool surfaces.
  - Define stable dimensions with responsive constraints (`aspect-ratio`, grid tracks, `min`/`max`, container-relative sizing) for fixed-format UI elements (boards, grids, toolbars, icon buttons, counters, tiles) so hover states, labels, icons, pieces, loading text, or dynamic content cannot resize or shift layout.
  - Do not scale font size with viewport width. Letter spacing must be 0, not negative.
  - Avoid one-note palettes (avoid dominant purple/purple-blue gradients, beige/cream/sand/tan, dark blue/slate, brown/orange/espresso); scan CSS colors before finalizing.
  - Prevent incoherent UI element and text overlap.
- **Server Lifecycle**: Start local dev server after implementation and provide URL when building a site/app needing a dev server. If port is occupied, use another. For static HTML where opening the file works, provide the file link directly.
