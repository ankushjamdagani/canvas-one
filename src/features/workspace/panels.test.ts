import { describe, it, expect } from 'vitest';
import type { WorkspacePanelPreferences } from './panels';
import {
  BREAKPOINT_MOBILE,
  BREAKPOINT_DESKTOP,
  DEFAULT_SIDE_WIDTH,
  MIN_SIDE_WIDTH,
  MAX_SIDE_WIDTH,
  INSPECTOR_WIDTH,
  CANVAS_MIN_WIDTH_DESKTOP,
  CANVAS_MIN_WIDTH_TABLET,
  RAIL_WIDTH,
  COLLAPSED_RAIL_WIDTH,
  GUTTER_WIDTH,
  DEFAULT_FLOAT_WIDTH,
  DEFAULT_FLOAT_HEIGHT,
  MIN_FLOAT_WIDTH,
  MIN_FLOAT_HEIGHT,
  FLOAT_MARGIN,
  TOPBAR_HEIGHT_DESKTOP,
  STACK_MIN_CONTENT_HEIGHT,
  STACK_HEADER_HEIGHT,
  STACK_MIN_EXPANDED_HEIGHT,
  KEYBOARD_RESIZE_STEP,
  KEYBOARD_RESIZE_STEP_FINE,
  // Functions
  createInitialPanelState,
  clampSideWidth,
  computeEffectiveSideWidth,
  clampFloatRect,
  defaultFloatRect,
  effectiveLayout,
  panelReducer,
} from './panels';

describe('Workspace Panel Reducer & Geometry', () => {
  // ==========================================================================
  // 1. Exported Named Constants
  // ==========================================================================
  describe('Exported Named Constants', () => {
    it('has exact breakpoint numbers', () => {
      expect(BREAKPOINT_MOBILE).toBe(768);
      expect(BREAKPOINT_DESKTOP).toBe(1200);
    });

    it('has exact side width constants', () => {
      expect(DEFAULT_SIDE_WIDTH).toBe(320);
      expect(MIN_SIDE_WIDTH).toBe(280);
      expect(MAX_SIDE_WIDTH).toBe(440);
    });

    it('has exact inspector and canvas minimums', () => {
      expect(INSPECTOR_WIDTH).toBe(320);
      expect(CANVAS_MIN_WIDTH_DESKTOP).toBe(480);
      expect(CANVAS_MIN_WIDTH_TABLET).toBe(360);
    });

    it('has exact rails and gutter numbers', () => {
      expect(RAIL_WIDTH).toBe(44);
      expect(COLLAPSED_RAIL_WIDTH).toBe(44);
      expect(GUTTER_WIDTH).toBe(16);
    });

    it('has exact floating geometry numbers', () => {
      expect(DEFAULT_FLOAT_WIDTH).toBe(360);
      expect(DEFAULT_FLOAT_HEIGHT).toBe(480);
      expect(MIN_FLOAT_WIDTH).toBe(280);
      expect(MIN_FLOAT_HEIGHT).toBe(240);
      expect(FLOAT_MARGIN).toBe(16);
      expect(TOPBAR_HEIGHT_DESKTOP).toBe(54);
    });

    it('has exact stack geometry numbers', () => {
      expect(STACK_MIN_CONTENT_HEIGHT).toBe(160);
      expect(STACK_HEADER_HEIGHT).toBe(40);
      expect(STACK_MIN_EXPANDED_HEIGHT).toBe(200);
    });

    it('has exact keyboard resize steps', () => {
      expect(KEYBOARD_RESIZE_STEP).toBe(10);
      expect(KEYBOARD_RESIZE_STEP_FINE).toBe(1);
    });
  });

  // ==========================================================================
  // 2. Transition Matrix Covering Each Event
  // ==========================================================================
  describe('Transition Matrix (all 14 events)', () => {
    it('OPEN: opens closed panel, focuses, and emits save + focus effects', () => {
      const state = createInitialPanelState();
      expect(state.panels.library.open).toBe(false);

      const result = panelReducer(state, { type: 'OPEN', panel: 'library' });
      expect(result.state.panels.library.open).toBe(true);
      expect(result.state.panels.library.collapsed).toBe(false);
      expect(result.state.focusedPanel).toBe('library');
      expect(result.state.lastFocusedSequence.library).toBeGreaterThan(0);
      expect(result.effects).toContainEqual({ type: 'focus', target: 'library' });
      expect(result.effects).toContainEqual({ type: 'save' });
    });

    it('OPEN: is a no-op on already-expanded, focused panel', () => {
      const state = createInitialPanelState({
        focusedPanel: 'library',
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const result = panelReducer(state, { type: 'OPEN', panel: 'library' });
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    });

    it('OPEN: expands and focuses panel if already open but collapsed', () => {
      const state = createInitialPanelState({
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: true,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const result = panelReducer(state, { type: 'OPEN', panel: 'library' });
      expect(result.state.panels.library.collapsed).toBe(false);
      expect(result.state.focusedPanel).toBe('library');
      expect(result.effects).toContainEqual({ type: 'focus', target: 'library' });
      expect(result.effects).toContainEqual({ type: 'save' });
    });

    it('CLOSE: closes open panel, clears focus, and emits save effect', () => {
      const state = createInitialPanelState({
        focusedPanel: 'library',
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const result = panelReducer(state, { type: 'CLOSE', panel: 'library' });
      expect(result.state.panels.library.open).toBe(false);
      expect(result.state.focusedPanel).toBeNull();
      expect(result.effects).toEqual([{ type: 'save' }]);
    });

    it('CLOSE: is a no-op on already-closed panel', () => {
      const state = createInitialPanelState();
      const result = panelReducer(state, { type: 'CLOSE', panel: 'library' });
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    });

    it('FOCUS: updates focusedPanel and sequence without save effect', () => {
      const state = createInitialPanelState({
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
        },
        focusedPanel: 'history',
        lastFocusedSequence: { library: 1, history: 2 },
      });

      const result = panelReducer(state, { type: 'FOCUS', panel: 'library' });
      expect(result.state.focusedPanel).toBe('library');
      expect(result.state.lastFocusedSequence.library).toBe(3);
      expect(result.effects).toEqual([{ type: 'focus', target: 'library' }]);
    });

    it('FOCUS: is a no-op if already focused', () => {
      const state = createInitialPanelState({ focusedPanel: 'library' });
      const result = panelReducer(state, { type: 'FOCUS', panel: 'library' });
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    });

    it('PLACE: docked side placement updates placement and stackOrder and emits save', () => {
      const state = createInitialPanelState({
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const result = panelReducer(state, {
        type: 'PLACE',
        panel: 'library',
        placement: 'right',
        index: 0,
      });

      expect(result.state.panels.library.placement).toBe('right');
      expect(result.state.panels.library.stackOrder).toBe(0);
      expect(result.state.focusedPanel).toBe('library');
      expect(result.effects).toContainEqual({ type: 'focus', target: 'library' });
      expect(result.effects).toContainEqual({ type: 'save' });
    });

    it('PLACE: placing into same side adjusts other panel stackOrder', () => {
      const state = createInitialPanelState({
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const result = panelReducer(state, {
        type: 'PLACE',
        panel: 'history',
        placement: 'left',
        index: 0,
      });

      expect(result.state.panels.history.stackOrder).toBe(0);
      expect(result.state.panels.library.stackOrder).toBe(1);
    });

    it('PLACE: floating placement reuses or centers valid floatRect and ignores index', () => {
      const state = createInitialPanelState();
      const result = panelReducer(state, {
        type: 'PLACE',
        panel: 'library',
        placement: 'floating',
        index: 1,
      });

      expect(result.state.panels.library.placement).toBe('floating');
      expect(result.state.panels.library.floatRect.width).toBeGreaterThanOrEqual(MIN_FLOAT_WIDTH);
      expect(result.state.panels.library.floatRect.height).toBeGreaterThanOrEqual(MIN_FLOAT_HEIGHT);
      expect(result.effects).toContainEqual({ type: 'save' });
    });

    it('COLLAPSE: collapses panel and clears focus if focused', () => {
      const state = createInitialPanelState({
        focusedPanel: 'library',
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const result = panelReducer(state, { type: 'COLLAPSE', panel: 'library' });
      expect(result.state.panels.library.collapsed).toBe(true);
      expect(result.state.focusedPanel).toBeNull();
      expect(result.effects).toEqual([{ type: 'save' }]);
    });

    it('COLLAPSE: is a no-op if already collapsed', () => {
      const state = createInitialPanelState({
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: true,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const result = panelReducer(state, { type: 'COLLAPSE', panel: 'library' });
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    });

    it('EXPAND: uncollapses panel, opens if needed, focuses and emits save', () => {
      const state = createInitialPanelState({
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: true,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const result = panelReducer(state, { type: 'EXPAND', panel: 'library' });
      expect(result.state.panels.library.collapsed).toBe(false);
      expect(result.state.panels.library.open).toBe(true);
      expect(result.state.focusedPanel).toBe('library');
      expect(result.effects).toContainEqual({ type: 'focus', target: 'library' });
      expect(result.effects).toContainEqual({ type: 'save' });
    });

    it('RESIZE_SIDE: updates side width with clamping and emits save', () => {
      const state = createInitialPanelState();
      const result = panelReducer(state, {
        type: 'RESIZE_SIDE',
        side: 'left',
        width: 380,
      });

      expect(result.state.sideWidths.left).toBe(380);
      expect(result.effects).toEqual([{ type: 'save' }]);
    });

    it('RESET_SIDE: restores default 320 px and emits save', () => {
      const state = createInitialPanelState({
        sideWidths: { left: 400, right: 320 },
      });

      const result = panelReducer(state, { type: 'RESET_SIDE', side: 'left' });
      expect(result.state.sideWidths.left).toBe(320);
      expect(result.effects).toEqual([{ type: 'save' }]);
    });

    it('RESET_SIDE: is a no-op if already 320 px', () => {
      const state = createInitialPanelState({
        sideWidths: { left: 320, right: 320 },
      });

      const result = panelReducer(state, { type: 'RESET_SIDE', side: 'left' });
      expect(result.state).toBe(state);
      expect(result.effects).toEqual([]);
    });

    it('RESIZE_FLOAT: updates float rect with clamping and emits save', () => {
      const state = createInitialPanelState();
      const result = panelReducer(state, {
        type: 'RESIZE_FLOAT',
        panel: 'library',
        rect: { x: 100, y: 120, width: 400, height: 500 },
      });

      expect(result.state.panels.library.floatRect).toEqual({
        x: 100,
        y: 120,
        width: 400,
        height: 500,
      });
      expect(result.effects).toEqual([{ type: 'save' }]);
    });

    it('VIEWPORT_CHANGED: updates viewport without save effect', () => {
      const state = createInitialPanelState({
        viewport: { width: 1440, height: 900 },
      });

      const result = panelReducer(state, {
        type: 'VIEWPORT_CHANGED',
        width: 1200,
        height: 800,
      });

      expect(result.state.viewport).toEqual({ width: 1200, height: 800 });
      // Responsive viewport change never emits save
      expect(result.effects.some((e) => e.type === 'save')).toBe(false);
    });

    it('BEGIN_GESTURE: captures snapshot without save effect', () => {
      const state = createInitialPanelState();
      const result = panelReducer(state, { type: 'BEGIN_GESTURE', kind: 'resize' });

      expect(result.state.gesture).not.toBeNull();
      expect(result.state.gesture?.snapshot.panels).toEqual(state.panels);
      expect(result.state.gesture?.snapshot.sideWidths).toEqual(state.sideWidths);
      expect(result.effects).toEqual([]);
    });

    it('PREVIEW_GESTURE: applies changes in preview without save effect', () => {
      const state = createInitialPanelState();
      const beginResult = panelReducer(state, { type: 'BEGIN_GESTURE' });

      const previewResult = panelReducer(beginResult.state, {
        type: 'PREVIEW_GESTURE',
        action: { type: 'RESIZE_SIDE', side: 'left', width: 400 },
      });

      expect(previewResult.state.sideWidths.left).toBe(400);
      expect(previewResult.state.gesture).not.toBeNull();
      expect(previewResult.effects).toEqual([]); // No save effect during preview
    });

    it('COMMIT_GESTURE: persists committed preference changes with save effect', () => {
      const state = createInitialPanelState();
      const beginResult = panelReducer(state, { type: 'BEGIN_GESTURE' });
      const previewResult = panelReducer(beginResult.state, {
        type: 'PREVIEW_GESTURE',
        action: { type: 'RESIZE_SIDE', side: 'left', width: 400 },
      });

      const commitResult = panelReducer(previewResult.state, { type: 'COMMIT_GESTURE' });
      expect(commitResult.state.sideWidths.left).toBe(400);
      expect(commitResult.state.gesture).toBeNull();
      expect(commitResult.effects).toEqual([{ type: 'save' }]);
    });

    it('COMMIT_GESTURE: emits no save effect if preferences did not change', () => {
      const state = createInitialPanelState();
      const beginResult = panelReducer(state, { type: 'BEGIN_GESTURE' });

      const commitResult = panelReducer(beginResult.state, { type: 'COMMIT_GESTURE' });
      expect(commitResult.state.gesture).toBeNull();
      expect(commitResult.effects).toEqual([]);
    });

    it('CANCEL_GESTURE: restores pre-gesture state exactly with no save effect', () => {
      const state = createInitialPanelState();
      const beginResult = panelReducer(state, { type: 'BEGIN_GESTURE' });
      const previewResult = panelReducer(beginResult.state, {
        type: 'PREVIEW_GESTURE',
        action: { type: 'RESIZE_SIDE', side: 'left', width: 400 },
      });

      expect(previewResult.state.sideWidths.left).toBe(400);

      const cancelResult = panelReducer(previewResult.state, { type: 'CANCEL_GESTURE' });
      expect(cancelResult.state.sideWidths.left).toBe(320); // Restored exactly
      expect(cancelResult.state.gesture).toBeNull();
      expect(cancelResult.effects).toEqual([]);
    });
  });

  // ==========================================================================
  // 3. Gesture Preview / Commit / Cancel
  // ==========================================================================
  describe('Gesture Lifecycle (preview / commit / cancel)', () => {
    it('cancel restores state after multiple preview steps with zero save effects', () => {
      const initial = createInitialPanelState({
        sideWidths: { left: 320, right: 320 },
      });

      // 1. Begin
      const r1 = panelReducer(initial, { type: 'BEGIN_GESTURE' });
      expect(r1.effects).toEqual([]);

      // 2. Preview 1
      const r2 = panelReducer(r1.state, {
        type: 'PREVIEW_GESTURE',
        action: { type: 'RESIZE_SIDE', side: 'left', width: 360 },
      });
      expect(r2.state.sideWidths.left).toBe(360);
      expect(r2.effects).toEqual([]);

      // 3. Preview 2
      const r3 = panelReducer(r2.state, {
        type: 'PREVIEW_GESTURE',
        action: { type: 'RESIZE_SIDE', side: 'left', width: 420 },
      });
      expect(r3.state.sideWidths.left).toBe(420);
      expect(r3.effects).toEqual([]);

      // 4. Cancel
      const r4 = panelReducer(r3.state, { type: 'CANCEL_GESTURE' });
      expect(r4.state.sideWidths.left).toBe(320);
      expect(r4.state.gesture).toBeNull();
      expect(r4.effects).toEqual([]);
      expect(r4.state.sideWidths).toEqual(initial.sideWidths);
      expect(r4.state.panels).toEqual(initial.panels);
    });

    it('commit produces exactly one save effect for entire gesture sequence', () => {
      const initial = createInitialPanelState();
      const r1 = panelReducer(initial, { type: 'BEGIN_GESTURE' });
      const r2 = panelReducer(r1.state, {
        type: 'PREVIEW_GESTURE',
        action: { type: 'RESIZE_SIDE', side: 'right', width: 380 },
      });
      expect(r2.effects).toEqual([]);

      const r3 = panelReducer(r2.state, { type: 'COMMIT_GESTURE' });
      expect(r3.state.sideWidths.right).toBe(380);
      expect(r3.effects).toEqual([{ type: 'save' }]);
    });
  });

  // ==========================================================================
  // 4. Side Width Clamping
  // ==========================================================================
  describe('Side Width Clamping (280–440 px, default 320 px)', () => {
    it('clamps values below minimum 280 to 280', () => {
      expect(clampSideWidth(200)).toBe(280);
      expect(clampSideWidth(0)).toBe(280);
      expect(clampSideWidth(-50)).toBe(280);

      const state = createInitialPanelState();
      const result = panelReducer(state, {
        type: 'RESIZE_SIDE',
        side: 'left',
        width: 150,
      });
      expect(result.state.sideWidths.left).toBe(280);
    });

    it('clamps values above maximum 440 to 440', () => {
      expect(clampSideWidth(500)).toBe(440);
      expect(clampSideWidth(1000)).toBe(440);

      const state = createInitialPanelState();
      const result = panelReducer(state, {
        type: 'RESIZE_SIDE',
        side: 'left',
        width: 600,
      });
      expect(result.state.sideWidths.left).toBe(440);
    });

    it('accepts values between 280 and 440 untouched', () => {
      expect(clampSideWidth(280)).toBe(280);
      expect(clampSideWidth(350)).toBe(350);
      expect(clampSideWidth(440)).toBe(440);
    });

    it('handles non-finite values safely by falling back to default 320', () => {
      expect(clampSideWidth(NaN)).toBe(320);
      expect(clampSideWidth(Infinity)).toBe(320);
    });
  });

  // ==========================================================================
  // 5. Auto-Collapse LRU with Tie by ID and Announce
  // ==========================================================================
  describe('Auto-Collapse LRU with tie by ID and announce effect', () => {
    it('collapses least-recently-focused auxiliary panel when occupancy exceeds width at >=1200 px', () => {
      // At 1200 px:
      // Fixed: Canvas (480) + Rail (44) + Gutters (16) + Inspector (320) = 860 px
      // Left (320) + Right (320) = 640 px
      // Total occupancy = 860 + 640 = 1500 > 1200 px -> occupancy exceeds width!
      // When history was focused earlier (seq 1) and library later (seq 2):
      // history is least-recently focused and collapses.
      const state = createInitialPanelState({
        viewport: { width: 1200, height: 900 },
        sideWidths: { left: 440, right: 440 },
        focusedPanel: 'library',
        lastFocusedSequence: { history: 1, library: 2 },
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1200, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1200, height: 900 }),
            stackOrder: 0,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.panels.history).toBe('collapsed');
      expect(layout.panels.library).toBe('docked-left');
      expect(layout.inspector).toBe('docked');
    });

    it('collapses library when library is least-recently focused', () => {
      const state = createInitialPanelState({
        viewport: { width: 1200, height: 900 },
        sideWidths: { left: 440, right: 440 },
        focusedPanel: 'history',
        lastFocusedSequence: { library: 1, history: 2 },
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1200, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1200, height: 900 }),
            stackOrder: 0,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.panels.library).toBe('collapsed');
      expect(layout.panels.history).toBe('docked-right');
    });

    it('breaks ties deterministically by panel id (history collapses before library)', () => {
      const state = createInitialPanelState({
        viewport: { width: 1200, height: 900 },
        sideWidths: { left: 440, right: 440 },
        lastFocusedSequence: { library: 0, history: 0 }, // Tied
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1200, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1200, height: 900 }),
            stackOrder: 0,
          },
        },
      });

      const layout = effectiveLayout(state);
      // 'history'.localeCompare('library') < 0 -> history is chosen to collapse on tie
      expect(layout.panels.history).toBe('collapsed');
      expect(layout.panels.library).toBe('docked-left');
    });

    it('emits announce effect naming the collapsed panel and reason when auto-collapse occurs', () => {
      // Start with wide viewport (1600 px) where both panels fit:
      // Occupancy 860 + 320 + 320 = 1500 <= 1600
      const wideState = createInitialPanelState({
        viewport: { width: 1600, height: 900 },
        sideWidths: { left: 440, right: 440 },
        lastFocusedSequence: { history: 1, library: 2 },
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1600, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1600, height: 900 }),
            stackOrder: 0,
          },
        },
      });

      const wideLayout = effectiveLayout(wideState);
      expect(wideLayout.panels.library).toBe('docked-left');
      expect(wideLayout.panels.history).toBe('docked-right');

      // Shrink viewport to 1200 px: history should auto-collapse and emit announce
      const result = panelReducer(wideState, {
        type: 'VIEWPORT_CHANGED',
        width: 1200,
        height: 900,
      });

      expect(effectiveLayout(result.state).panels.history).toBe('collapsed');
      expect(result.effects).toContainEqual({
        type: 'announce',
        message: 'Auto-collapsed panel "history" to preserve minimum canvas width.',
      });
    });

    it('restoring width restores preferred state without emitting focus or save effects', () => {
      const collapsedState = createInitialPanelState({
        viewport: { width: 1200, height: 900 },
        sideWidths: { left: 440, right: 440 },
        lastFocusedSequence: { history: 1, library: 2 },
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1200, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1200, height: 900 }),
            stackOrder: 0,
          },
        },
      });

      expect(effectiveLayout(collapsedState).panels.history).toBe('collapsed');

      // Expand viewport back to 1600 px
      const restoreResult = panelReducer(collapsedState, {
        type: 'VIEWPORT_CHANGED',
        width: 1600,
        height: 900,
      });

      const restoredLayout = effectiveLayout(restoreResult.state);
      expect(restoredLayout.panels.history).toBe('docked-right');
      expect(restoredLayout.panels.library).toBe('docked-left');

      // "When width returns, restore the preferred state without stealing focus."
      // "restoring width does not emit a focus effect."
      expect(restoreResult.effects.some((e) => e.type === 'focus')).toBe(false);
      expect(restoreResult.effects.some((e) => e.type === 'save')).toBe(false);
    });
  });

  // ==========================================================================
  // 6. Viewports 1440 / 1200 / 1024 / 768 / 390 through effectiveLayout
  // ==========================================================================
  describe('Viewports (1440, 1200, 1024, 768, 390) through effectiveLayout', () => {
    it('1440 px (Desktop): accommodates stacked panels on left + inspector', () => {
      const state = createInitialPanelState({
        viewport: { width: 1440, height: 900 },
        sideWidths: { left: 320, right: 320 },
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.inspector).toBe('docked');
      expect(layout.panels.library).toBe('docked-left');
      expect(layout.panels.history).toBe('docked-left');
    });

    it('1200 px (Desktop lower boundary): auto-collapses auxiliary panel when both sides open', () => {
      const state = createInitialPanelState({
        viewport: { width: 1200, height: 900 },
        sideWidths: { left: 440, right: 440 },
        lastFocusedSequence: { library: 2, history: 1 },
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1200, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1200, height: 900 }),
            stackOrder: 0,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.inspector).toBe('docked');
      expect(layout.panels.library).toBe('docked-left');
      expect(layout.panels.history).toBe('collapsed');
    });

    it('1024 px (Tablet): auxiliary panels are overlays, inspector is docked', () => {
      const state = createInitialPanelState({
        viewport: { width: 1024, height: 768 },
        focusedPanel: 'library',
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1024, height: 768 }),
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1024, height: 768 }),
            stackOrder: 1,
          },
        },
      });

      const layout = effectiveLayout(state);
      // "Auxiliary panels are single overlays."
      expect(layout.panels.library).toBe('overlay');
      expect(layout.panels.history).toBe('hidden');
      // Inspector takes 320 if canvas >= 360: 1024 - 320 - 44 - 16 = 644 >= 360 -> docked
      expect(layout.inspector).toBe('docked');
    });

    it('768 px (Tablet boundary): auxiliary panel is overlay, inspector is docked', () => {
      const state = createInitialPanelState({
        viewport: { width: 768, height: 1024 },
        focusedPanel: 'library',
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 768, height: 1024 }),
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 768, height: 1024 }),
            stackOrder: 1,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.panels.library).toBe('overlay');
      // 768 - 320 - 44 - 16 = 388 >= 360 -> inspector stays docked
      expect(layout.inspector).toBe('docked');
    });

    it('390 px (Mobile): at most one overlay at a time, inspector is overlay', () => {
      const state = createInitialPanelState({
        viewport: { width: 390, height: 844 },
        activeOverlay: 'library',
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 390, height: 844 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 390, height: 844 }),
            stackOrder: 1,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.inspector).toBe('overlay');
      // At most one overlay at a time
      expect(layout.panels.library).toBe('overlay');
      expect(layout.panels.history).toBe('hidden');
    });
  });

  // ==========================================================================
  // 7. Floating Rect Clamping and Below-Min -> Overlay
  // ==========================================================================
  describe('Floating Rect Clamping and Below-Min -> Overlay', () => {
    it('clamps floating panel coordinates and dimensions within viewport margins', () => {
      const viewport = { width: 1440, height: 900 };
      // Try to place panel out-of-bounds (negative x/y, oversized dimensions)
      const clamped = clampFloatRect(
        { x: -50, y: 10, width: 2000, height: 2000 },
        viewport
      );

      expect(clamped.x).toBe(FLOAT_MARGIN); // 16
      expect(clamped.y).toBe(TOPBAR_HEIGHT_DESKTOP); // 54
      expect(clamped.width).toBe(1440 - 2 * FLOAT_MARGIN); // 1408
      expect(clamped.height).toBe(900 - TOPBAR_HEIGHT_DESKTOP - FLOAT_MARGIN); // 830
    });

    it('switches floating panel to overlay when dimensions are below minimum (280×240)', () => {
      const state = createInitialPanelState({
        viewport: { width: 1440, height: 900 },
        panels: {
          library: {
            open: true,
            placement: 'floating',
            collapsed: false,
            floatRect: { x: 100, y: 100, width: 200, height: 180 }, // Below 280x240
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      // "Below the minimum, switch to an overlay."
      const layout = effectiveLayout(state);
      expect(layout.panels.library).toBe('overlay');
    });

    it('switches floating panel to overlay when viewport cannot fit minimum dimensions', () => {
      const state = createInitialPanelState({
        viewport: { width: 300, height: 300 }, // viewport minus margins cannot fit 280x240
        panels: {
          library: {
            open: true,
            placement: 'floating',
            collapsed: false,
            floatRect: { x: 16, y: 54, width: 280, height: 240 },
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 300, height: 300 }),
            stackOrder: 1,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.panels.library).toBe('overlay');
    });

    it('returns floating mode when floating panel meets minimum requirements on desktop', () => {
      const state = createInitialPanelState({
        viewport: { width: 1440, height: 900 },
        panels: {
          library: {
            open: true,
            placement: 'floating',
            collapsed: false,
            floatRect: { x: 100, y: 100, width: 360, height: 480 },
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.panels.library).toBe('floating');
    });
  });

  // ==========================================================================
  // 8. Stacking Fit / No-Fit
  // ==========================================================================
  describe('Stacking Fit / No-Fit', () => {
    it('fits both stacked panels when available height >= 400 px', () => {
      // 900 - 54 = 846 px available height >= 400 px (200 px * 2)
      const state = createInitialPanelState({
        viewport: { width: 1440, height: 900 },
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.panels.library).toBe('docked-left');
      expect(layout.panels.history).toBe('docked-left');
    });

    it('collapses least-recently-focused panel to a collapsed header when available height < 400 px', () => {
      // 350 - 54 = 296 px available height < 400 px
      // "if both don't fit, show one expanded panel and the other as a collapsed header"
      const state = createInitialPanelState({
        viewport: { width: 1440, height: 350 },
        lastFocusedSequence: { library: 2, history: 1 }, // History least recently focused
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 350 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 350 }),
            stackOrder: 1,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.panels.library).toBe('docked-left');
      expect(layout.panels.history).toBe('collapsed');
    });

    it('emits announce effect when vertical stack cannot fit both panels', () => {
      const tallState = createInitialPanelState({
        viewport: { width: 1440, height: 900 },
        lastFocusedSequence: { library: 2, history: 1 },
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 1,
          },
        },
      });

      const result = panelReducer(tallState, {
        type: 'VIEWPORT_CHANGED',
        width: 1440,
        height: 350,
      });

      expect(result.effects).toContainEqual({
        type: 'announce',
        message: 'Auto-collapsed panel "history" to fit available height in stack.',
      });
    });
  });

  // ==========================================================================
  // 9. Responsive Override Does Not Mutate Preferences
  // ==========================================================================
  describe('Responsive Override Does Not Mutate Preferences', () => {
    it('keeps desktop preferences deep-equal before and after mobile override (390 px)', () => {
      const state = createInitialPanelState({
        viewport: { width: 1440, height: 900 },
        sideWidths: { left: 350, right: 380 },
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1440, height: 900 }),
            stackOrder: 0,
          },
        },
      });

      const prefsBefore: WorkspacePanelPreferences = {
        panels: JSON.parse(JSON.stringify(state.panels)),
        sideWidths: JSON.parse(JSON.stringify(state.sideWidths)),
      };

      const result = panelReducer(state, {
        type: 'VIEWPORT_CHANGED',
        width: 390,
        height: 844,
      });

      // Effective layout is computed responsively
      const mobileLayout = effectiveLayout(result.state);
      expect(mobileLayout.inspector).toBe('overlay');

      const prefsAfter: WorkspacePanelPreferences = {
        panels: result.state.panels,
        sideWidths: result.state.sideWidths,
      };

      // Desktop preferences must NOT have been mutated
      expect(prefsAfter).toEqual(prefsBefore);
    });

    it('keeps preferences deep-equal before and after auto-collapse override (1200 px)', () => {
      const state = createInitialPanelState({
        viewport: { width: 1600, height: 900 },
        sideWidths: { left: 440, right: 440 },
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1600, height: 900 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1600, height: 900 }),
            stackOrder: 0,
          },
        },
      });

      const prefsBefore: WorkspacePanelPreferences = {
        panels: JSON.parse(JSON.stringify(state.panels)),
        sideWidths: JSON.parse(JSON.stringify(state.sideWidths)),
      };

      const result = panelReducer(state, {
        type: 'VIEWPORT_CHANGED',
        width: 1200,
        height: 900,
      });

      expect(effectiveLayout(result.state).panels.history).toBe('collapsed');

      const prefsAfter: WorkspacePanelPreferences = {
        panels: result.state.panels,
        sideWidths: result.state.sideWidths,
      };

      // Preferences still say collapsed: false, open: true
      expect(prefsAfter).toEqual(prefsBefore);
      expect(prefsAfter.panels.history.collapsed).toBe(false);
      expect(prefsAfter.panels.history.open).toBe(true);
    });
  });

  // ==========================================================================
  // 12. Constrained Desktop Viewports (1225 px) & Effective Side Width
  // ==========================================================================
  describe('Constrained Desktop Viewports (1225 px) & Effective Side Width', () => {
    it('keeps the preferred side width at 1225 px (no fixed inspector reservation)', () => {
      const state = createInitialPanelState({
        viewport: { width: 1225, height: 773 },
        sideWidths: { left: 320, right: 380 },
        panels: {
          library: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1225, height: 773 }),
            stackOrder: 0,
          },
          history: {
            open: false,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1225, height: 773 }),
            stackOrder: 1,
          },
        },
      });

      // At 1225 px: baseOccupancy = 480 (canvas) + 44 (rail) + 16 (gutters) = 540 px;
      // the inspector is a hosted panel now, so it reserves no width of its own.
      // Available width for right side = 1225 - 540 = 685 px, so 380 px is kept.
      const effectiveRight = computeEffectiveSideWidth('right', state, ['library']);
      expect(effectiveRight).toBe(380);

      // On wider screens (1440 px), preferred width 380 px is preserved
      const wideState = { ...state, viewport: { width: 1440, height: 900 } };
      expect(computeEffectiveSideWidth('right', wideState, ['library'])).toBe(380);
    });

    it('docks side panels at 1225 px even when preferred side width is 380 px', () => {
      const state = createInitialPanelState({
        viewport: { width: 1225, height: 773 },
        sideWidths: { left: 320, right: 380 },
        panels: {
          library: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1225, height: 773 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1225, height: 773 }),
            stackOrder: 1,
          },
        },
      });

      const layout = effectiveLayout(state);
      expect(layout.inspector).toBe('docked');
      // Both panels on right fit horizontally (sharing right side) and stack vertically
      expect(layout.panels.library).toBe('docked-right');
      expect(layout.panels.history).toBe('docked-right');
    });

    it('EXPAND uncollapses and docks an effectively collapsed panel even if preferences had collapsed: false', () => {
      // Setup state where panel was effectively collapsed due to previous constraints
      const state = createInitialPanelState({
        viewport: { width: 1225, height: 773 },
        sideWidths: { left: 320, right: 380 },
        focusedPanel: 'library',
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1225, height: 773 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1225, height: 773 }),
            stackOrder: 0,
          },
        },
        lastFocusedSequence: { library: 1, history: 2 },
      });

      // Initially, history is more recently focused, so library is collapsed
      const initialLayout = effectiveLayout(state);
      expect(initialLayout.panels.library).toBe('collapsed');
      expect(initialLayout.panels.history).toBe('docked-right');

      // Dispatch EXPAND on library
      const result = panelReducer(state, { type: 'EXPAND', panel: 'library' });
      const nextLayout = effectiveLayout(result.state);
      expect(nextLayout.panels.library).toBe('docked-left');
      expect(nextLayout.panels.history).toBe('collapsed');
    });

    it('OPEN uncollapses and docks an effectively collapsed panel even if already focused', () => {
      const state = createInitialPanelState({
        viewport: { width: 1225, height: 773 },
        sideWidths: { left: 320, right: 380 },
        focusedPanel: 'library',
        panels: {
          library: {
            open: true,
            placement: 'left',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1225, height: 773 }),
            stackOrder: 0,
          },
          history: {
            open: true,
            placement: 'right',
            collapsed: false,
            floatRect: defaultFloatRect({ width: 1225, height: 773 }),
            stackOrder: 0,
          },
        },
        lastFocusedSequence: { library: 1, history: 2 },
      });

      const result = panelReducer(state, { type: 'OPEN', panel: 'library' });
      const nextLayout = effectiveLayout(result.state);
      expect(nextLayout.panels.library).toBe('docked-left');
      expect(nextLayout.panels.history).toBe('collapsed');
    });
  });
});

describe('Inspector as a hosted panel', () => {
  const wide = { width: 1600, height: 900 };

  it('SYNC_OPEN follows the draft without focusing or saving', () => {
    const state = createInitialPanelState({ viewport: wide });
    const opened = panelReducer(state, { type: 'SYNC_OPEN', panel: 'inspector', open: true });
    expect(opened.state.panels.inspector.open).toBe(true);
    expect(opened.state.focusedPanel).toBeNull();
    expect(opened.effects.filter((e) => e.type === 'save' || e.type === 'focus')).toEqual([]);
    expect(panelReducer(opened.state, { type: 'SYNC_OPEN', panel: 'inspector', open: true }).state).toBe(opened.state);
    expect(panelReducer(opened.state, { type: 'SYNC_OPEN', panel: 'inspector', open: false }).state.panels.inspector.open).toBe(false);
  });

  it('docks right by default on desktop and is hidden below 1200 px', () => {
    const open = createInitialPanelState({ viewport: wide, panels: { inspector: { ...createInitialPanelState().panels.inspector, open: true } } });
    expect(effectiveLayout(open).panels.inspector).toBe('docked-right');
    expect(effectiveLayout({ ...open, viewport: { width: 1100, height: 900 } }).panels.inspector).toBe('hidden');
    expect(effectiveLayout({ ...open, viewport: { width: 390, height: 844 } }).panels.inspector).toBe('hidden');
  });

  it('never auto-collapses the inspector; the other panels collapse instead', () => {
    const base = createInitialPanelState({ viewport: { width: 1200, height: 900 }, sideWidths: { left: 440, right: 440 } });
    const state = createInitialPanelState({
      viewport: { width: 1200, height: 900 },
      sideWidths: { left: 440, right: 440 },
      lastFocusedSequence: { library: 5, history: 6, inspector: 1 },
      panels: {
        library: { ...base.panels.library, open: true, placement: 'left' },
        history: { ...base.panels.history, open: true, placement: 'right' },
        inspector: { ...base.panels.inspector, open: true, placement: 'right', stackOrder: 0 },
      },
    });
    const layout = effectiveLayout(state);
    expect(layout.panels.inspector).toBe('docked-right');
    expect(layout.panels.library === 'collapsed' || layout.panels.history === 'collapsed').toBe(true);
  });

  it('PLACE keeps stack orders unique and contiguous with three panels on one side', () => {
    const base = createInitialPanelState({ viewport: wide });
    const state = createInitialPanelState({
      viewport: wide,
      panels: {
        library: { ...base.panels.library, open: true, placement: 'right', stackOrder: 0 },
        history: { ...base.panels.history, open: true, placement: 'right', stackOrder: 1 },
        inspector: { ...base.panels.inspector, open: true, placement: 'left', stackOrder: 0 },
      },
    });
    const next = panelReducer(state, { type: 'PLACE', panel: 'inspector', placement: 'right', index: 1 }).state;
    const orders = (['library', 'inspector', 'history'] as const).map((id) => next.panels[id].stackOrder);
    expect(orders).toEqual([0, 1, 2]);
    const layout = effectiveLayout(next);
    expect(layout.panels.library).toBe('docked-right');
    expect(layout.panels.inspector).toBe('docked-right');
    expect(layout.panels.history).toBe('docked-right');
  });

  it('collapses the least-recently-focused non-inspector panel when three stacked panels do not fit', () => {
    const base = createInitialPanelState();
    const state = createInitialPanelState({
      viewport: { width: 1600, height: 560 },
      lastFocusedSequence: { library: 1, history: 2, inspector: 3 },
      panels: {
        library: { ...base.panels.library, open: true, placement: 'right', stackOrder: 0 },
        history: { ...base.panels.history, open: true, placement: 'right', stackOrder: 1 },
        inspector: { ...base.panels.inspector, open: true, placement: 'right', stackOrder: 2 },
      },
    });
    const layout = effectiveLayout(state);
    expect(layout.panels.inspector).toBe('docked-right');
    expect(layout.panels.library).toBe('collapsed');
  });
});
