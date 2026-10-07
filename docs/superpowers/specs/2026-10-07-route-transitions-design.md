# Route transitions and page animation

Date: 2026-10-07. Source: `System Studio Transitions.html` (showcase only; its UI is not an exact match).

## Goal

Port the transition language from the supplied showcase to the real app: a persistent drafting board, an intro on load, choreographed enter/exit on `/`, `/projects`, `/project/:id[/branch/:id]`, and a card-to-canvas expansion when opening a project. Also update the project canvas header (static logo icon, then a back button to the projects list).

## Decisions

- **Library: Motion 14 (`motion`, MIT)**, React entry `motion/react`, with `LazyMotion` + `domAnimation` (plus `domMax` only if needed). Rejected: GSAP (non-OSS licence, imperative against React lifecycles, ~70 kB), hand-written WAAPI (most code to own), View Transitions API (no staggered exit, no clip-path grow, Chromium-heavy).
- **Router stays** (`src/lib/router.ts`). No router library; transitions don't need one.
- **Intro plays on every full load of `/` and `/projects`.** A deep link to `/project/...` skips the intro and plays only the canvas enter.
- Product is not live, so no compatibility shims for the old page-owned backgrounds.

## Showcase vocabulary (source of truth for timings)

Easings: `ENTER = cubic-bezier(0.22,1,0.36,1)`, `EXIT = cubic-bezier(0.55,0,0.75,0.2)`, `INOUT = cubic-bezier(0.65,0,0.35,1)`. Durations in ms.

| Role | Used for | Enter | Exit |
|---|---|---|---|
| `content` | hero lines, cards, section headings | y +18, blur 8 → rest, 900, stagger 70 | y −16, blur 6, 420, stagger 22 |
| `chrome` | page header items | y −10, blur 4 → rest, 700, starts after content (`n·70+260`), stagger 55 | y −8, blur 3, 420 |
| `node` | canvas nodes | y +10, scale .96, blur 6 → rest, 800, stagger 110 | opacity→0, blur 6, 380, delay 100 + 25/item |
| `edge` | canvas edges | `pathLength` 0→1, 750, delay 260 + 140/item, `INOUT` | with nodes |
| `bar` | top bar / playback bar containers | y ±28 → 0, 850, delay after edges (`260+edges·140+520`) | y ±28, opacity 0, 420 |
| `barItem` | children of a bar | y ±6, blur 3, 550, delay bar + 260, stagger 60 | with bar |

Board: dots fade + scale 1.06→1 over 1300; frame edges scaleX/scaleY 0→1 over 1000 at 450 delay (`INOUT`); inner ring fades in at 1150 (700); first page content starts at 1400. Page change shifts dots ±24 px over 1100 while dots/ring dip to 0.35/0.25 opacity at 45%.

## Architecture

### Units

1. **`src/lib/motion/tokens.ts`**: easings, durations, stagger values and role specs above. Single source; no inline curves elsewhere.
2. **`src/lib/motion/MotionProvider.tsx`**: `LazyMotion` + `MotionConfig reducedMotion="user"`, plus a `useMotionSpeed()` context (default 1) so tests can set speed ≈ 0 via `window.__STUDIO_MOTION__ = 'off'` read at mount. Reduced motion collapses transform/blur to opacity-only with near-zero durations.
3. **`src/components/ui/reveal.tsx`**: `<Reveal role="content|chrome|node|bar|barItem" index? dir?>` rendering `m.div`/`m.span` with the role's variants. Orchestration (stagger counters, "chrome after content" delay) comes from a `RevealGroup` context that counts registered children per role, so pages declare roles only. `Reveal` is the only place feature code touches Motion.
4. **`src/components/ui/drafting-board.tsx` (extend)**: `DraftingBoard` becomes the persistent shell layer: ground (dots), double frame, inner ring. Exposes `useBoard()` with `intro()` and `shift(dir)` imperative handles, implemented with `animate()` on refs.
5. **`src/features/shell/RouteShell.tsx`**: renders the board once and `AnimatePresence mode="wait"` around the current page, keyed by `route.kind` (`home | projects | project`; project id/branch changes do **not** re-key, so branch switching doesn't replay page transitions). Owns direction (`home→projects` = +1, reverse = −1, anything→project = +1, project→projects = −1), the intro-on-load decision, and the shared-card overlay.
6. **`src/features/shell/cardTransition.ts` + `<CardOverlay>`**: on project open, captures the clicked element's rect (in board coordinates, accounting for board scale), computed background and border radius, mounts a fixed overlay with `clip-path: inset(...)`, animates to `inset(22px round 0)` (760, delay 120, `INOUT`), holds until the workspace reports ready, then fades (700) while the canvas enter plays. The source card is hidden (opacity 0) for the duration.
7. **Page changes**: `LandingPage`, `EntryScreen`, `Workspace` stop rendering their own ground/frame and wrap their regions in `Reveal`s. Workspace's own `workspace-frame` and `p-[23px]` are replaced by the shell frame at ≥1000 px; below 1000 px the shell hides the frame, as today.

### Route flow

`App.tsx` keeps its URL↔session effects. The branches in `AppRoutes` (`workspace-loading-screen`, `project-route-error`, `Workspace`) move into a single `project` page component so the `AnimatePresence` child is stable while the session opens. The "Opening project…" state renders inside the board (quiet, no enter animation) and swaps to the canvas enter when `Workspace` mounts.

Open-project sequence (`/projects` → card click):
1. `EntryScreen` calls `openProject` via `onOpen(card element)`; shell starts overlay grow and page exit (non-clicked content only) immediately.
2. Session open resolves in parallel. Overlay waits for both grow end and session ready; if session fails, overlay reverses (shrink to card) and the existing error banner shows.
3. Shell navigates to `project`, dots shift +1, overlay fades, canvas roles enter (`node`→`edge`→`bar`→`barItem`).

Direct project link: no overlay, no intro; `AnimatePresence initial` plays the canvas enter only.

Back (`← Projects`): canvas roles exit (`bar`, then `node`/`edge`), shift −1, `projects` content enters. Guarded navigation (`runGuarded`) still runs before exit begins; an abandoned guard must not start the exit.

### Interaction guard

A `busy` flag from the showcase is replaced by AnimatePresence + a shell-level `transitioning` state: new navigation requests during a transition are queued (last wins) and run after enter completes, rather than dropped. Browser Back/Forward during a transition is handled by the same queue.

## Header change (Project Canvas)

`TopBar.tsx` leading cluster becomes: static logo mark (non-interactive, `aria-hidden` SVG, no text) → `← Projects` ghost button (`ArrowLeft` Lucide icon, label "Projects", `aria-label="All projects"`, calls `onAllProjects`) → 1 px divider → project title/branch chip. The wordmark and version label leave the canvas header (still on landing/projects). `data-testid="brand"` moves to the logo; the back button gets `data-testid="topbar-back"`. Foundation-first: logo mark extracted to a shared `BrandMark` in `src/components/ui/`, with a Storybook story; the button uses the existing `Button` ghost variant.

## Accessibility and reduced motion

- `prefers-reduced-motion`: opacity-only fades ≤120 ms, no blur/translate, no clip-path grow (overlay skipped; plain crossfade), no board intro (board appears complete).
- Focus: on route enter, focus moves to the page `<h1>`/main landmark after enter completes (not during), so screen readers aren't talking over transforms. Exiting content gets `inert` and `aria-hidden` for its duration; the entering page is not interactive until its enter ends for pointer events only (keyboard focus is not blocked).
- Blur is skipped on `node`/`edge` roles when more than 12 are present, and on devices where `matchMedia('(pointer: coarse)')` matches, to avoid mobile jank.

## Testing

- Unit (`src/**/*.test.ts`, per LESSONS): token table values; role→variant mapping; direction resolver (`from→to` pairs); queue behaviour (last-wins, ignore same route); card rect → clip-path string at board scales ≠ 1. Render components with `renderToStaticMarkup`.
- E2E (production, isolated port): navigation flows with `__STUDIO_MOTION__='off'` for deterministic assertions; one dedicated spec runs at real speed asserting an overlay element exists mid-open and is removed after; reduced-motion spec asserts no overlay and no transform on content. Existing selectors (`open-project-*`, `entry-screen-root`, `workspace-root`, `brand`) must keep working or be migrated across shared fixtures. Deep-link spec asserts the intro is skipped.
- Manual/browser: 1440×900, 1000, 800, 390, 320 widths; board scale <1; interrupted navigation (rapid clicks, browser Back mid-transition).
- Bundle: `npm run build`; no chunk over 500 kB (LESSONS). Motion in the main chunk with `LazyMotion` should be ~5–18 kB; if the build warns, split `domMax` features.
- Storybook: `Reveal` roles and `BrandMark` stories; TopBar story updated for the new header.

## Risks and open points

- **Page-owned backgrounds.** Landing uses `DraftingBoard`; `EntryScreen` and `Workspace` style their own backgrounds/frames. Lifting them into the shell must keep the existing landing animated ground and the "static editor dots" choice from HANDOFF (workspace dots stay static; landing/projects animated). First implementation step is a read-only audit of how each page paints its background, before any move.
- **Workspace height model** (`h-screen`, `p-[23px]`, `--topbar-inset`) must survive being nested in a shell; verify panels, dock and canvas bounds after the move (LESSONS: measure real node bounds after responsive changes).
- **Overlay accuracy** under board scale <1 and scrolled `/projects` pages (card may be partly off-screen; clamp the start rect to the viewport).
- **Blur cost.** Mitigations above; measure with a baseline build (LESSONS: time affected interaction). Project open must not regress beyond the animation itself: the session open runs in parallel with the grow.
- **`AnimatePresence` + `useSyncExternalStore` router.** Keyed children rely on `route.kind` only; verify popstate mid-transition.
- Traffic/canvas playback animations are unaffected and out of scope; node/edge `Reveal` wraps only the initial mount of the canvas layer, not ReactFlow's per-node internals (apply to the viewport layer groups, or CSS-class-based variants on the node/edge wrappers if the layer approach conflicts with ReactFlow measurement).

## Out of scope

Traffic/playback transitions; dialog/popover/panel motion; scroll-linked effects; a router library; per-branch switch animation; new landing content.
