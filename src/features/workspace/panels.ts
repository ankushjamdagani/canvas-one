/**
 * Workspace panel reducer and geometry calculations.
 *
 * Implements System Studio revamp task RV-03a.
 * Governed by specs/revamp/contracts/commands.md §7 "Panels and geometry"
 * and specs/revamp/architecture.md §3.
 *
 * Domain logic is pure TypeScript: no React, no DOM, no Dexie/storage access.
 */

// ============================================================================
// Types
// ============================================================================

export type PanelId = 'library' | 'history' | 'inspector';

/** Every panel the host can place, in a stable order. */
export const PANEL_IDS: readonly PanelId[] = ['library', 'history', 'inspector'];

/**
 * The user-opened panels. Below the desktop tier these are single overlays; the
 * inspector is draft-driven (it follows the selection) and keeps its own
 * dock/sheet below 1200 px.
 */
export const AUXILIARY_PANEL_IDS: readonly PanelId[] = ['library', 'history'];

function hiddenPanelModes(): Record<PanelId, PanelMode> {
  return { library: 'hidden', history: 'hidden', inspector: 'hidden' };
}

export type Placement = 'left' | 'right' | 'floating';

export interface FloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Exact panel preference shape from specs/revamp/contracts/commands.md §7.
 * PanelPreference={open, placement:'left'|'right'|'floating', collapsed, floatRect:{x,y,width,height}, stackOrder}.
 */
export interface PanelPreference {
  open: boolean;
  placement: Placement;
  collapsed: boolean;
  floatRect: FloatRect;
  stackOrder: number;
}

/**
 * Shared side widths for left and right docking areas (§7).
 */
export interface SideWidths {
  left: number;
  right: number;
}

/**
 * Panels and sideWidths parts of studio-preferences/1 (§7).
 */
export interface WorkspacePanelPreferences {
  panels: Record<PanelId, PanelPreference>;
  sideWidths: SideWidths;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Pre-gesture snapshot used to restore state on CANCEL_GESTURE / Escape.
 */
export interface GestureSnapshot {
  snapshot: {
    panels: Record<PanelId, PanelPreference>;
    sideWidths: SideWidths;
    focusedPanel: PanelId | null;
  };
  kind?: string;
}

export type PanelOverlayId = PanelId | 'inspector' | 'results';

/**
 * Complete runtime + persistent state managed by the panel reducer.
 */
export interface WorkspacePanelState {
  // studio-preferences/1 persistent parts
  panels: Record<PanelId, PanelPreference>;
  sideWidths: SideWidths;

  // Runtime-only state (§7)
  focusedPanel: PanelId | null;
  lastFocusedSequence: Record<PanelId, number>;
  activeOverlay: PanelOverlayId | null;
  gesture: GestureSnapshot | null;

  // Viewport
  viewport: Viewport;
}

/**
 * Effect descriptors returned by the pure reducer.
 * §7: "The reducer is pure: it returns state plus effect descriptors (save, announce, focus), with no DOM or DB access."
 */
export type PanelEffect =
  | { type: 'save' }
  | { type: 'announce'; message: string }
  | { type: 'focus'; target: PanelId };

/**
 * Effective display mode per panel derived from preferences + viewport.
 * Modes: 'docked-left' | 'docked-right' | 'floating' | 'collapsed' | 'overlay' | 'hidden'.
 */
export type PanelMode =
  | 'docked-left'
  | 'docked-right'
  | 'floating'
  | 'collapsed'
  | 'overlay'
  | 'hidden';

/**
 * Effective display mode for the contextual inspector region.
 * Modes: 'docked' | 'overlay'.
 */
export type InspectorMode = 'docked' | 'overlay';

export interface EffectiveLayout {
  panels: Record<PanelId, PanelMode>;
  inspector: InspectorMode;
}

/**
 * Reducer events exactly as listed in specs/revamp/contracts/commands.md §7:
 * OPEN(panel), CLOSE(panel), FOCUS(panel), PLACE(panel,placement,index),
 * COLLAPSE(panel), EXPAND(panel), RESIZE_SIDE(side,width), RESET_SIDE(side),
 * RESIZE_FLOAT(panel,rect), VIEWPORT_CHANGED(width,height),
 * BEGIN_GESTURE, PREVIEW_GESTURE, COMMIT_GESTURE, CANCEL_GESTURE.
 */
export type WorkspacePanelAction =
  | { type: 'OPEN'; panel: PanelId }
  | { type: 'CLOSE'; panel: PanelId }
  /**
   * Mirrors a draft-driven panel's visibility (the inspector) without focusing it
   * or saving preferences: opening it must not steal focus from the canvas.
   */
  | { type: 'SYNC_OPEN'; panel: PanelId; open: boolean }
  | { type: 'FOCUS'; panel: PanelId }
  | { type: 'PLACE'; panel: PanelId; placement: Placement; index: number }
  | { type: 'COLLAPSE'; panel: PanelId }
  | { type: 'EXPAND'; panel: PanelId }
  | { type: 'RESIZE_SIDE'; side: 'left' | 'right'; width: number }
  | { type: 'RESET_SIDE'; side: 'left' | 'right' }
  | { type: 'RESIZE_FLOAT'; panel: PanelId; rect: FloatRect }
  | { type: 'VIEWPORT_CHANGED'; width: number; height: number }
  | { type: 'BEGIN_GESTURE'; kind?: string }
  | { type: 'PREVIEW_GESTURE'; action: WorkspacePanelAction }
  | { type: 'COMMIT_GESTURE' }
  | { type: 'CANCEL_GESTURE' };

export type WorkspacePanelEvent = WorkspacePanelAction;

// ============================================================================
// Exported Named Constants (specs/revamp/contracts/commands.md §7)
// ============================================================================

/** §7 Breakpoints: Mobile tier < 768 px */
export const BREAKPOINT_MOBILE = 768;

/** §7 Breakpoints: Desktop tier >= 1200 px (Tablet is 768–1199 px) */
export const BREAKPOINT_DESKTOP = 1200;

/** §7 Side widths: default 320 px */
export const DEFAULT_SIDE_WIDTH = 320;

/** §7 Side widths: clamped 280–440 px minimum */
export const MIN_SIDE_WIDTH = 280;

/** §7 Side widths: clamped 280–440 px maximum */
export const MAX_SIDE_WIDTH = 440;

/** §7 Inspector fixed contextual region width: 320 px */
export const INSPECTOR_WIDTH = 320;

/** §7 Canvas minimum width on desktop (>= 1200 px): 480 px */
export const CANVAS_MIN_WIDTH_DESKTOP = 480;

/** §7 Canvas minimum width on tablet (768–1199 px): 360 px */
export const CANVAS_MIN_WIDTH_TABLET = 360;

/** §7 Activity rail width: 44 px */
export const RAIL_WIDTH = 44;

/** §7 Collapsed rail width: 44 px */
export const COLLAPSED_RAIL_WIDTH = 44;

/** §7 Gutters: 16 px */
export const GUTTER_WIDTH = 16;

/** §7 Floating panel default width: 360 px */
export const DEFAULT_FLOAT_WIDTH = 360;

/** §7 Floating panel default height: 480 px */
export const DEFAULT_FLOAT_HEIGHT = 480;

/** §7 Floating panel minimum width: 280 px */
export const MIN_FLOAT_WIDTH = 280;

/** §7 Floating panel minimum height: 240 px */
export const MIN_FLOAT_HEIGHT = 240;

/** §7 Floating panel viewport margin: 16 px */
export const FLOAT_MARGIN = 16;

/** §7 Topbar reservation on desktop: 54 px */
export const TOPBAR_HEIGHT_DESKTOP = 54;

/** §7 Stacked panels: minimum expanded content: 160 px */
export const STACK_MIN_CONTENT_HEIGHT = 160;

/** §7 Stacked panels: header height: 40 px */
export const STACK_HEADER_HEIGHT = 40;

/** §7 Stacked panels: total minimum expanded height (160 px content + 40 px header = 200 px) */
export const STACK_MIN_EXPANDED_HEIGHT = STACK_MIN_CONTENT_HEIGHT + STACK_HEADER_HEIGHT;

/** §7 Keyboard resize step: 10 px */
export const KEYBOARD_RESIZE_STEP = 10;

/** §7 Keyboard resize fine step (Shift): 1 px */
export const KEYBOARD_RESIZE_STEP_FINE = 1;

// ============================================================================
// Utilities
// ============================================================================

function clonePreferences(prefs: WorkspacePanelPreferences): WorkspacePanelPreferences {
  return JSON.parse(JSON.stringify(prefs));
}

function cloneState(state: WorkspacePanelState): WorkspacePanelState {
  return JSON.parse(JSON.stringify(state));
}

function arePreferencesEqual(
  a: { panels: Record<PanelId, PanelPreference>; sideWidths: SideWidths },
  b: { panels: Record<PanelId, PanelPreference>; sideWidths: SideWidths }
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function clampSideWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_SIDE_WIDTH;
  }
  return Math.min(MAX_SIDE_WIDTH, Math.max(MIN_SIDE_WIDTH, Math.round(width)));
}

/**
 * Computes effective side width in a given viewport, clamped between MIN_SIDE_WIDTH (280)
 * and MAX_SIDE_WIDTH (440), but also constrained to what fits in the viewport without
 * violating minimum canvas, rail, gutter, and inspector reservations (§7).
 */
export function computeEffectiveSideWidth(
  side: 'left' | 'right',
  state: {
    viewport: Viewport;
    sideWidths: SideWidths;
    panels: Record<PanelId, PanelPreference>;
  },
  activeCandidateIds?: PanelId[]
): number {
  const preferred = clampSideWidth(state.sideWidths[side]);
  if (state.viewport.width < BREAKPOINT_DESKTOP) {
    return preferred;
  }

  const baseOcc0 = CANVAS_MIN_WIDTH_DESKTOP + RAIL_WIDTH + GUTTER_WIDTH;
  let baseOcc = baseOcc0;

  // If the other side also has docked candidates, it requires at least MIN_SIDE_WIDTH
  const otherSide = side === 'left' ? 'right' : 'left';
  const otherActive = activeCandidateIds
    ? activeCandidateIds.some((id) => state.panels[id]?.placement === otherSide)
    : false;

  if (otherActive) {
    baseOcc += MIN_SIDE_WIDTH;
  }

  const maxAvailable = state.viewport.width - baseOcc;
  if (maxAvailable < MIN_SIDE_WIDTH) {
    return preferred;
  }
  return Math.min(preferred, maxAvailable);
}

/**
 * Clamps floating panel rect so header and close button stay inside bounds (§7).
 */
export function clampFloatRect(rect: FloatRect, viewport: Viewport): FloatRect {
  const maxW = Math.max(0, viewport.width - 2 * FLOAT_MARGIN);
  const maxH = Math.max(0, viewport.height - TOPBAR_HEIGHT_DESKTOP - FLOAT_MARGIN);

  const w = Math.min(maxW, Math.max(0, Math.round(rect.width)));
  const h = Math.min(maxH, Math.max(0, Math.round(rect.height)));

  const minX = FLOAT_MARGIN;
  const maxX = Math.max(minX, viewport.width - FLOAT_MARGIN - w);
  const minY = TOPBAR_HEIGHT_DESKTOP;
  const maxY = Math.max(minY, viewport.height - FLOAT_MARGIN - h);

  const x = Math.min(maxX, Math.max(minX, Math.round(rect.x)));
  const y = Math.min(maxY, Math.max(minY, Math.round(rect.y)));

  return { x, y, width: w, height: h };
}

/**
 * Creates default float rectangle centered in viewport (§5, §7).
 */
export function defaultFloatRect(viewport: Viewport): FloatRect {
  const w = DEFAULT_FLOAT_WIDTH;
  const h = DEFAULT_FLOAT_HEIGHT;
  const x = Math.round((viewport.width - w) / 2);
  const y = Math.round((viewport.height - h) / 2);
  return clampFloatRect({ x, y, width: w, height: h }, viewport);
}

/**
 * Factory creating initial valid workspace panel state.
 */
export type PanelStateOverrides = Partial<
  Omit<WorkspacePanelState, 'panels' | 'sideWidths' | 'lastFocusedSequence' | 'viewport'>
> & {
  panels?: Partial<Record<PanelId, PanelPreference>>;
  sideWidths?: Partial<SideWidths>;
  lastFocusedSequence?: Partial<Record<PanelId, number>>;
  viewport?: Partial<Viewport>;
};

export function createInitialPanelState(
  overrides?: PanelStateOverrides
): WorkspacePanelState {
  const defaultViewport: Viewport = { width: 1440, height: 900 };
  const base: WorkspacePanelState = {
    panels: {
      library: {
        open: false,
        placement: 'left',
        collapsed: false,
        floatRect: defaultFloatRect(defaultViewport),
        stackOrder: 0,
      },
      history: {
        open: false,
        placement: 'right',
        collapsed: false,
        floatRect: defaultFloatRect(defaultViewport),
        stackOrder: 1,
      },
      // Draft-driven: opened and closed with the selection, docked right by default.
      inspector: {
        open: false,
        placement: 'right',
        collapsed: false,
        floatRect: defaultFloatRect(defaultViewport),
        stackOrder: 0,
      },
    },
    sideWidths: {
      left: DEFAULT_SIDE_WIDTH,
      right: DEFAULT_SIDE_WIDTH,
    },
    focusedPanel: null,
    lastFocusedSequence: {
      library: 0,
      history: 0,
      inspector: 0,
    },
    activeOverlay: null,
    gesture: null,
    viewport: defaultViewport,
  };

  if (!overrides) {
    return base;
  }

  return {
    ...base,
    ...overrides,
    panels: {
      library: { ...base.panels.library, ...(overrides.panels?.library ?? {}) },
      history: { ...base.panels.history, ...(overrides.panels?.history ?? {}) },
      inspector: { ...base.panels.inspector, ...(overrides.panels?.inspector ?? {}) },
    },
    sideWidths: {
      ...base.sideWidths,
      ...(overrides.sideWidths ?? {}),
    },
    lastFocusedSequence: {
      ...base.lastFocusedSequence,
      ...(overrides.lastFocusedSequence ?? {}),
    },
    viewport: {
      ...base.viewport,
      ...(overrides.viewport ?? {}),
    },
  };
}

// ============================================================================
// Effective Layout Computation (§7)
// ============================================================================

/**
 * Pure function computing effective panel layout without mutating preferences.
 * Responsive overrides never overwrite desktop preferences (§7).
 */
export function effectiveLayout(state: WorkspacePanelState): EffectiveLayout {
  const { viewport, panels, sideWidths, activeOverlay, focusedPanel, lastFocusedSequence } = state;

  // --------------------------------------------------------------------------
  // Tier 1: Mobile (< 768 px)
  // §7: "One modal overlay at a time: a full-width sheet under the topbar,
  // max remaining height. Inspector, Library, History and results replace one another"
  // --------------------------------------------------------------------------
  if (viewport.width < BREAKPOINT_MOBILE) {
    const inspector: InspectorMode = 'overlay';
    const resultPanels = hiddenPanelModes();

    let chosenOverlay: PanelId | null = null;
    if (activeOverlay === 'library' || activeOverlay === 'history') {
      if (panels[activeOverlay].open) {
        chosenOverlay = activeOverlay;
      }
    } else if (activeOverlay === null) {
      if (focusedPanel && panels[focusedPanel].open) {
        chosenOverlay = focusedPanel;
      } else {
        const openPanels = AUXILIARY_PANEL_IDS.filter((id) => panels[id].open);
        if (openPanels.length === 1) {
          chosenOverlay = openPanels[0];
        } else if (openPanels.length > 1) {
          // Choose most recently focused; tie broken by panelId
          openPanels.sort((a, b) => {
            const seqDiff = (lastFocusedSequence[b] ?? 0) - (lastFocusedSequence[a] ?? 0);
            if (seqDiff !== 0) return seqDiff;
            return a.localeCompare(b);
          });
          chosenOverlay = openPanels[0];
        }
      }
    }

    if (chosenOverlay) {
      resultPanels[chosenOverlay] = 'overlay';
    }

    return {
      panels: resultPanels,
      inspector,
    };
  }

  // --------------------------------------------------------------------------
  // Tier 2: Tablet (768–1199 px)
  // §7: "Auxiliary panels are single overlays. The inspector may take 320 px only
  // if the canvas keeps ≥360 px (after the 44 px rail and 16 px gutters); otherwise
  // it becomes an overlay too."
  // --------------------------------------------------------------------------
  if (viewport.width < BREAKPOINT_DESKTOP) {
    const remainingForCanvas = viewport.width - INSPECTOR_WIDTH - RAIL_WIDTH - GUTTER_WIDTH;
    const inspector: InspectorMode =
      remainingForCanvas >= CANVAS_MIN_WIDTH_TABLET ? 'docked' : 'overlay';

    const resultPanels = hiddenPanelModes();

    // Auxiliary panels are single overlays
    const openAuxiliary = AUXILIARY_PANEL_IDS.filter((id) => panels[id].open);

    if (activeOverlay === 'library' || activeOverlay === 'history') {
      if (panels[activeOverlay].open) {
        resultPanels[activeOverlay] = 'overlay';
      }
    } else if (openAuxiliary.length > 0) {
      // Pick active overlay: focusedPanel if open, else most recently focused
      let activeId: PanelId;
      if (focusedPanel && panels[focusedPanel].open) {
        activeId = focusedPanel;
      } else {
        openAuxiliary.sort((a, b) => {
          const seqDiff = (lastFocusedSequence[b] ?? 0) - (lastFocusedSequence[a] ?? 0);
          if (seqDiff !== 0) return seqDiff;
          return a.localeCompare(b);
        });
        activeId = openAuxiliary[0];
      }

      if (panels[activeId].collapsed) {
        resultPanels[activeId] = 'collapsed';
      } else {
        resultPanels[activeId] = 'overlay';
      }
    }

    return {
      panels: resultPanels,
      inspector,
    };
  }

  // --------------------------------------------------------------------------
  // Tier 3: Desktop (>= 1200 px)
  // §7: "Docking and floating. Side widths default 320, clamped 280–440; inspector 320;
  // canvas min 480; rail 44; gutters 16. If occupancy exceeds width, collapse the
  // least-recently-focused auxiliary panel (ties by panel ID) and repeat. The inspector
  // is kept; if it alone doesn't fit, it becomes an overlay. When width returns,
  // restore the preferred state without stealing focus."
  // --------------------------------------------------------------------------
  const resultPanels = hiddenPanelModes();

  // 1. Process floating panels and closed panels
  for (const id of PANEL_IDS) {
    const pref = panels[id];
    if (!pref.open) {
      resultPanels[id] = 'hidden';
      continue;
    }
    if (pref.placement === 'floating') {
      if (pref.collapsed) {
        resultPanels[id] = 'collapsed';
      } else {
        const maxW = viewport.width - 2 * FLOAT_MARGIN;
        const maxH = viewport.height - TOPBAR_HEIGHT_DESKTOP - FLOAT_MARGIN;
        if (
          maxW < MIN_FLOAT_WIDTH ||
          maxH < MIN_FLOAT_HEIGHT ||
          pref.floatRect.width < MIN_FLOAT_WIDTH ||
          pref.floatRect.height < MIN_FLOAT_HEIGHT
        ) {
          resultPanels[id] = 'overlay';
        } else {
          resultPanels[id] = 'floating';
        }
      }
    }
  }

  // 2. On desktop the inspector is a regular panel (docks, floats, collapses and
  // stacks like Library and History); it only ever counts toward the occupancy.
  const inspector: InspectorMode = 'docked';

  // 3. Docked candidate auxiliary panels that are open and not explicitly collapsed
  const dockedCandidates = PANEL_IDS.filter((id) => {
    const pref = panels[id];
    return pref.open && !pref.collapsed && pref.placement !== 'floating';
  });

  // Handle explicitly collapsed docked panels
  for (const id of PANEL_IDS) {
    const pref = panels[id];
    if (pref.open && pref.collapsed && pref.placement !== 'floating') {
      resultPanels[id] = 'collapsed';
    }
  }

  // Helper calculating horizontal width needed for a subset of docked panels
  const computeDockedOccupancy = (candidateIds: PanelId[]): number => {
    let occ = CANVAS_MIN_WIDTH_DESKTOP + RAIL_WIDTH + GUTTER_WIDTH;
    const hasLeft = candidateIds.some((id) => panels[id].placement === 'left');
    const hasRight = candidateIds.some((id) => panels[id].placement === 'right');
    if (hasLeft) {
      occ += computeEffectiveSideWidth('left', state, candidateIds);
    }
    if (hasRight) {
      occ += computeEffectiveSideWidth('right', state, candidateIds);
    }
    return occ;
  };

  // If occupancy exceeds width, repeatedly collapse least-recently-focused auxiliary panel
  const activeDocked = [...dockedCandidates];
  // The inspector is kept (it is the thing being edited); only the others collapse.
  while (
    activeDocked.some((id) => id !== 'inspector') &&
    computeDockedOccupancy(activeDocked) > viewport.width
  ) {
    // Sort so least recently focused is at index 0
    const collapsible = activeDocked
      .filter((id) => id !== 'inspector')
      .sort((a, b) => {
        const seqA = lastFocusedSequence[a] ?? 0;
        const seqB = lastFocusedSequence[b] ?? 0;
        if (seqA !== seqB) {
          return seqA - seqB; // lower sequence = least recently focused
        }
        // Ties broken deterministically by panel id ('history' before 'library')
        return a.localeCompare(b);
      });

    const toCollapse = collapsible[0];
    activeDocked.splice(activeDocked.indexOf(toCollapse), 1);
    resultPanels[toCollapse] = 'collapsed';
  }

  // 4. Stacks vertical height check (§7):
  // "Stacks: Library and History can stack on one side, sharing its width with an
  // equal initial split and accessible separators. The minimum expanded content is
  // 160 px plus a 40 px header; if both don't fit, show one expanded panel and the
  // other as a collapsed header."
  const checkSideStack = (side: 'left' | 'right') => {
    const sidePanels = activeDocked.filter((id) => panels[id].placement === side);
    const availableHeight = viewport.height - TOPBAR_HEIGHT_DESKTOP;
    const kept = [...sidePanels];
    // While the stack cannot give every panel its minimum, collapse the
    // least-recently-focused one (never the inspector) to a header.
    while (kept.length > 1 && availableHeight < STACK_MIN_EXPANDED_HEIGHT * kept.length) {
      const candidates = kept
        .filter((id) => id !== 'inspector')
        .sort((a, b) => {
          const seqA = lastFocusedSequence[a] ?? 0;
          const seqB = lastFocusedSequence[b] ?? 0;
          if (seqA !== seqB) return seqA - seqB;
          // Tie-break by stackOrder (higher stackOrder collapses first, or by id)
          if (panels[a].stackOrder !== panels[b].stackOrder) {
            return panels[b].stackOrder - panels[a].stackOrder;
          }
          return a.localeCompare(b);
        });
      const toCollapse = candidates[0];
      if (!toCollapse) break;
      kept.splice(kept.indexOf(toCollapse), 1);
      resultPanels[toCollapse] = 'collapsed';
    }

    for (const id of kept) {
      resultPanels[id] = side === 'left' ? 'docked-left' : 'docked-right';
    }
  };

  checkSideStack('left');
  checkSideStack('right');

  return {
    panels: resultPanels,
    inspector,
  };
}

// ============================================================================
// Pure Reducer Implementation (§7)
// ============================================================================

function getNextSequence(seqs: Record<PanelId, number>): number {
  const currentMax = Math.max(0, ...Object.values(seqs));
  return currentMax + 1;
}

export interface ReducerResult {
  state: WorkspacePanelState;
  effects: PanelEffect[];
}

/**
 * Pure panel reducer: (state, action) => { state, effects }.
 * Effects are descriptors only:
 * - { type: 'save' } on committed preference changes
 * - { type: 'announce', message }
 * - { type: 'focus', target }
 */
export function panelReducer(
  state: WorkspacePanelState,
  action: WorkspacePanelAction
): ReducerResult {
  const prevState = state;

  switch (action.type) {
    // ------------------------------------------------------------------------
    // OPEN(panel)
    // §5: "Open on an already-expanded, focused panel is a no-op; otherwise it
    // expands and focuses the panel and never toggles it closed."
    // ------------------------------------------------------------------------
    case 'OPEN': {
      const panel = action.panel;
      const current = state.panels[panel];
      const currentLayout = effectiveLayout(state);
      const isEffectivelyExpanded =
        currentLayout.panels[panel] !== 'collapsed' &&
        currentLayout.panels[panel] !== 'hidden';
      if (current.open && !current.collapsed && state.focusedPanel === panel && isEffectivelyExpanded) {
        return { state, effects: [] };
      }

      const nextPanels = {
        ...state.panels,
        [panel]: {
          ...current,
          open: true,
          collapsed: false,
        },
      };

      const nextSeq = getNextSequence(state.lastFocusedSequence);
      const nextFocusedSequence = {
        ...state.lastFocusedSequence,
        [panel]: nextSeq,
      };

      const nextActiveOverlay =
        state.viewport.width < BREAKPOINT_DESKTOP ? panel : state.activeOverlay;

      const nextState: WorkspacePanelState = {
        ...state,
        panels: nextPanels,
        focusedPanel: panel,
        lastFocusedSequence: nextFocusedSequence,
        activeOverlay: nextActiveOverlay,
      };

      const effects: PanelEffect[] = [];
      effects.push({ type: 'focus', target: panel });

      if (state.gesture === null) {
        effects.push({ type: 'save' });
      }

      // Check if auto-collapse occurred on any other auxiliary panel
      const autoAnnounces = detectAutoCollapseAnnounce(state, nextState);
      effects.push(...autoAnnounces);

      return { state: nextState, effects };
    }

    // ------------------------------------------------------------------------
    // SYNC_OPEN(panel, open): draft-driven visibility, no focus and no save
    // ------------------------------------------------------------------------
    case 'SYNC_OPEN': {
      const { panel, open } = action;
      if (state.panels[panel].open === open) return { state, effects: [] };
      const nextState: WorkspacePanelState = {
        ...state,
        panels: { ...state.panels, [panel]: { ...state.panels[panel], open } },
        focusedPanel: !open && state.focusedPanel === panel ? null : state.focusedPanel,
        activeOverlay: !open && state.activeOverlay === panel ? null : state.activeOverlay,
      };
      return { state: nextState, effects: detectAutoCollapseAnnounce(state, nextState) };
    }

    // ------------------------------------------------------------------------
    // CLOSE(panel)
    // ------------------------------------------------------------------------
    case 'CLOSE': {
      const panel = action.panel;
      const current = state.panels[panel];
      if (!current.open) {
        return { state, effects: [] };
      }

      const nextPanels = {
        ...state.panels,
        [panel]: {
          ...current,
          open: false,
        },
      };

      const nextState: WorkspacePanelState = {
        ...state,
        panels: nextPanels,
        focusedPanel: state.focusedPanel === panel ? null : state.focusedPanel,
        activeOverlay: state.activeOverlay === panel ? null : state.activeOverlay,
      };

      const effects: PanelEffect[] = [];
      if (state.gesture === null) {
        effects.push({ type: 'save' });
      }

      return { state: nextState, effects };
    }

    // ------------------------------------------------------------------------
    // FOCUS(panel)
    // ------------------------------------------------------------------------
    case 'FOCUS': {
      const panel = action.panel;
      if (state.focusedPanel === panel) {
        return { state, effects: [] };
      }

      const nextSeq = getNextSequence(state.lastFocusedSequence);
      const nextFocusedSequence = {
        ...state.lastFocusedSequence,
        [panel]: nextSeq,
      };

      const nextState: WorkspacePanelState = {
        ...state,
        focusedPanel: panel,
        lastFocusedSequence: nextFocusedSequence,
        activeOverlay:
          state.viewport.width < BREAKPOINT_DESKTOP && state.panels[panel].open
            ? panel
            : state.activeOverlay,
      };

      // Focus does not mutate preferences -> no save effect
      return {
        state: nextState,
        effects: [{ type: 'focus', target: panel }],
      };
    }

    // ------------------------------------------------------------------------
    // PLACE(panel, placement, index)
    // §5: "Floating reuses a valid floatRect, otherwise 360×480 centered, then clamped;
    // index is ignored when floating"
    // ------------------------------------------------------------------------
    case 'PLACE': {
      const { panel, placement, index } = action;
      const current = state.panels[panel];

      let nextFloatRect = current.floatRect;
      if (placement === 'floating') {
        if (
          !nextFloatRect ||
          nextFloatRect.width < MIN_FLOAT_WIDTH ||
          nextFloatRect.height < MIN_FLOAT_HEIGHT
        ) {
          nextFloatRect = defaultFloatRect(state.viewport);
        } else {
          nextFloatRect = clampFloatRect(nextFloatRect, state.viewport);
        }
      }

      const nextPanels = {
        ...state.panels,
        [panel]: {
          ...current,
          placement,
          floatRect: nextFloatRect,
          stackOrder: placement === 'floating' ? current.stackOrder : index,
        },
      };

      // If docked on a side shared with others, keep stack orders unique and
      // contiguous: the moved panel sits at `index`, the rest keep their order.
      if (placement !== 'floating') {
        const others = PANEL_IDS.filter((id) => id !== panel && state.panels[id].placement === placement)
          .sort((a, b) => state.panels[a].stackOrder - state.panels[b].stackOrder);
        const slot = Math.min(Math.max(index, 0), others.length);
        const ordered: PanelId[] = [...others];
        ordered.splice(slot, 0, panel);
        ordered.forEach((id, order) => {
          nextPanels[id] = { ...nextPanels[id], stackOrder: order };
        });
      }

      const nextSeq = getNextSequence(state.lastFocusedSequence);
      const nextFocusedSequence = {
        ...state.lastFocusedSequence,
        [panel]: nextSeq,
      };

      const nextState: WorkspacePanelState = {
        ...state,
        panels: nextPanels,
        focusedPanel: panel,
        lastFocusedSequence: nextFocusedSequence,
      };

      const effects: PanelEffect[] = [{ type: 'focus', target: panel }];
      if (state.gesture === null) {
        effects.push({ type: 'save' });
      }

      const autoAnnounces = detectAutoCollapseAnnounce(state, nextState);
      effects.push(...autoAnnounces);

      return { state: nextState, effects };
    }

    // ------------------------------------------------------------------------
    // COLLAPSE(panel)
    // ------------------------------------------------------------------------
    case 'COLLAPSE': {
      const panel = action.panel;
      const current = state.panels[panel];
      if (current.collapsed) {
        return { state, effects: [] };
      }

      const nextPanels = {
        ...state.panels,
        [panel]: {
          ...current,
          collapsed: true,
        },
      };

      const nextState: WorkspacePanelState = {
        ...state,
        panels: nextPanels,
        focusedPanel: state.focusedPanel === panel ? null : state.focusedPanel,
      };

      const effects: PanelEffect[] = [];
      if (state.gesture === null) {
        effects.push({ type: 'save' });
      }

      return { state: nextState, effects };
    }

    // ------------------------------------------------------------------------
    // EXPAND(panel)
    // ------------------------------------------------------------------------
    case 'EXPAND': {
      const panel = action.panel;
      const current = state.panels[panel];
      const currentLayout = effectiveLayout(state);
      const isEffectivelyExpanded =
        currentLayout.panels[panel] !== 'collapsed' &&
        currentLayout.panels[panel] !== 'hidden';
      if (current.open && !current.collapsed && state.focusedPanel === panel && isEffectivelyExpanded) {
        return { state, effects: [] };
      }

      const nextPanels = {
        ...state.panels,
        [panel]: {
          ...current,
          open: true,
          collapsed: false,
        },
      };

      const nextSeq = getNextSequence(state.lastFocusedSequence);
      const nextFocusedSequence = {
        ...state.lastFocusedSequence,
        [panel]: nextSeq,
      };

      const nextState: WorkspacePanelState = {
        ...state,
        panels: nextPanels,
        focusedPanel: panel,
        lastFocusedSequence: nextFocusedSequence,
      };

      const effects: PanelEffect[] = [{ type: 'focus', target: panel }];
      if (state.gesture === null) {
        effects.push({ type: 'save' });
      }

      const autoAnnounces = detectAutoCollapseAnnounce(state, nextState);
      effects.push(...autoAnnounces);

      return { state: nextState, effects };
    }

    // ------------------------------------------------------------------------
    // RESIZE_SIDE(side, width)
    // ------------------------------------------------------------------------
    case 'RESIZE_SIDE': {
      const { side, width } = action;
      const clamped = clampSideWidth(width);
      if (state.sideWidths[side] === clamped) {
        return { state, effects: [] };
      }

      const nextSideWidths = {
        ...state.sideWidths,
        [side]: clamped,
      };

      const nextState: WorkspacePanelState = {
        ...state,
        sideWidths: nextSideWidths,
      };

      const effects: PanelEffect[] = [];
      if (state.gesture === null) {
        effects.push({ type: 'save' });
      }

      const autoAnnounces = detectAutoCollapseAnnounce(state, nextState);
      effects.push(...autoAnnounces);

      return { state: nextState, effects };
    }

    // ------------------------------------------------------------------------
    // RESET_SIDE(side)
    // §5: "Reset affects the shared side width when docked"
    // ------------------------------------------------------------------------
    case 'RESET_SIDE': {
      const side = action.side;
      if (state.sideWidths[side] === DEFAULT_SIDE_WIDTH) {
        return { state, effects: [] };
      }

      const nextSideWidths = {
        ...state.sideWidths,
        [side]: DEFAULT_SIDE_WIDTH,
      };

      const nextState: WorkspacePanelState = {
        ...state,
        sideWidths: nextSideWidths,
      };

      const effects: PanelEffect[] = [];
      if (state.gesture === null) {
        effects.push({ type: 'save' });
      }

      const autoAnnounces = detectAutoCollapseAnnounce(state, nextState);
      effects.push(...autoAnnounces);

      return { state: nextState, effects };
    }

    // ------------------------------------------------------------------------
    // RESIZE_FLOAT(panel, rect)
    // ------------------------------------------------------------------------
    case 'RESIZE_FLOAT': {
      const { panel, rect } = action;
      const clamped = clampFloatRect(rect, state.viewport);
      const currentRect = state.panels[panel].floatRect;

      if (
        currentRect &&
        currentRect.x === clamped.x &&
        currentRect.y === clamped.y &&
        currentRect.width === clamped.width &&
        currentRect.height === clamped.height
      ) {
        return { state, effects: [] };
      }

      const nextPanels = {
        ...state.panels,
        [panel]: {
          ...state.panels[panel],
          floatRect: clamped,
        },
      };

      const nextState: WorkspacePanelState = {
        ...state,
        panels: nextPanels,
      };

      const effects: PanelEffect[] = [];
      if (state.gesture === null) {
        effects.push({ type: 'save' });
      }

      return { state: nextState, effects };
    }

    // ------------------------------------------------------------------------
    // VIEWPORT_CHANGED(width, height)
    // §7: "responsive overrides never overwrite desktop preferences"
    // "When width returns, restore the preferred state without stealing focus."
    // "auto-collapse emits an announce effect naming the panel and reason;
    // restoring width does not emit a focus effect."
    // ------------------------------------------------------------------------
    case 'VIEWPORT_CHANGED': {
      const { width, height } = action;
      if (state.viewport.width === width && state.viewport.height === height) {
        return { state, effects: [] };
      }

      const nextState: WorkspacePanelState = {
        ...state,
        viewport: { width, height },
      };

      // Responsive changes NEVER emit save effects and NEVER emit focus effects
      const effects: PanelEffect[] = [];
      const autoAnnounces = detectAutoCollapseAnnounce(state, nextState);
      effects.push(...autoAnnounces);

      return { state: nextState, effects };
    }

    // ------------------------------------------------------------------------
    // BEGIN_GESTURE
    // ------------------------------------------------------------------------
    case 'BEGIN_GESTURE': {
      if (state.gesture !== null) {
        return { state, effects: [] };
      }

      const snapshot: GestureSnapshot = {
        snapshot: {
          panels: JSON.parse(JSON.stringify(state.panels)),
          sideWidths: { ...state.sideWidths },
          focusedPanel: state.focusedPanel,
        },
        kind: action.kind,
      };

      const nextState: WorkspacePanelState = {
        ...state,
        gesture: snapshot,
      };

      return { state: nextState, effects: [] };
    }

    // ------------------------------------------------------------------------
    // PREVIEW_GESTURE
    // Carries the action being previewed. State updates preview, no save effect.
    // ------------------------------------------------------------------------
    case 'PREVIEW_GESTURE': {
      const gesture =
        state.gesture ?? {
          snapshot: {
            panels: JSON.parse(JSON.stringify(state.panels)),
            sideWidths: { ...state.sideWidths },
            focusedPanel: state.focusedPanel,
          },
        };

      const intermediateState: WorkspacePanelState = {
        ...state,
        gesture,
      };

      const inner = panelReducer(intermediateState, action.action);

      // Filter out save effect during gesture preview
      const previewEffects = inner.effects.filter((e) => e.type !== 'save');

      return {
        state: {
          ...inner.state,
          gesture, // Preserve original gesture snapshot
        },
        effects: previewEffects,
      };
    }

    // ------------------------------------------------------------------------
    // COMMIT_GESTURE
    // Only COMMIT persists (§7).
    // ------------------------------------------------------------------------
    case 'COMMIT_GESTURE': {
      if (state.gesture === null) {
        return { state, effects: [] };
      }

      const prefChanged = !arePreferencesEqual(
        { panels: state.panels, sideWidths: state.sideWidths },
        { panels: state.gesture.snapshot.panels, sideWidths: state.gesture.snapshot.sideWidths }
      );

      const nextState: WorkspacePanelState = {
        ...state,
        gesture: null,
      };

      const effects: PanelEffect[] = [];
      if (prefChanged) {
        effects.push({ type: 'save' });
      }

      return { state: nextState, effects };
    }

    // ------------------------------------------------------------------------
    // CANCEL_GESTURE
    // §7: "Escape and pointercancel restore the original state."
    // Cancel restores exactly, with no save effect.
    // ------------------------------------------------------------------------
    case 'CANCEL_GESTURE': {
      if (state.gesture === null) {
        return { state, effects: [] };
      }

      const restoredPanels = JSON.parse(JSON.stringify(state.gesture.snapshot.panels));
      const restoredSideWidths = { ...state.gesture.snapshot.sideWidths };
      const restoredFocused = state.gesture.snapshot.focusedPanel;

      const nextState: WorkspacePanelState = {
        ...state,
        panels: restoredPanels,
        sideWidths: restoredSideWidths,
        focusedPanel: restoredFocused,
        gesture: null,
      };

      return { state: nextState, effects: [] };
    }

    default: {
      const _exhaustive: never = action;
      return { state: prevState, effects: [] };
    }
  }
}

/**
 * Detects if any auxiliary panel transitioned into an auto-collapsed state
 * because available width or height was exceeded (§7).
 */
function detectAutoCollapseAnnounce(
  prevState: WorkspacePanelState,
  nextState: WorkspacePanelState
): PanelEffect[] {
  const prevLayout = effectiveLayout(prevState);
  const nextLayout = effectiveLayout(nextState);
  const effects: PanelEffect[] = [];

  for (const id of PANEL_IDS) {
    // Only announce if the panel is preferred expanded in preferences
    // but effective layout collapsed it, and it was not collapsed before.
    const pref = nextState.panels[id];
    if (pref.open && !pref.collapsed) {
      const wasCollapsed = prevLayout.panels[id] === 'collapsed';
      const isCollapsed = nextLayout.panels[id] === 'collapsed';

      if (!wasCollapsed && isCollapsed) {
        let reason = 'to preserve minimum canvas width';
        if (nextState.viewport.width >= BREAKPOINT_DESKTOP) {
          const sharedSide = PANEL_IDS.filter(
            (other) =>
              nextState.panels[other].open &&
              nextState.panels[other].placement === nextState.panels[id].placement,
          ).length;
          const availableH = nextState.viewport.height - TOPBAR_HEIGHT_DESKTOP;
          if (sharedSide > 1 && availableH < STACK_MIN_EXPANDED_HEIGHT * sharedSide) {
            reason = 'to fit available height in stack';
          }
        }
        effects.push({
          type: 'announce',
          message: `Auto-collapsed panel "${id}" ${reason}.`,
        });
      }
    }
  }

  return effects;
}
