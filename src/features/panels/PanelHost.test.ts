import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PanelHost } from './PanelHost';
import { PanelHeader, dispatchPanelMenuAction } from './PanelHeader';
import {
  createState23A,
  createState23B,
  createState23C,
  createState23D,
  createState23E,
  createState23F,
  createState23G,
} from './PanelsPreview';
import type { PanelId } from '@/features/workspace/panels';

describe('PanelHost and Panels System Components (RV-03p)', () => {
  const dummyCanvas = React.createElement('div', { id: 'test-canvas-content' }, 'CANVAS_VIEWPORT_XYFLOW');
  const renderDummyPanel = (id: PanelId) =>
    React.createElement('div', { id: `panel-content-${id}` }, `CONTENT_${id.toUpperCase()}`);

  // ==========================================================================
  // 1. Static Markup Rendering of 23A–23G Screen States
  // ==========================================================================
  describe('Screens 23A–23G pure renderToStaticMarkup fidelity', () => {
    it('23A: renders History docked right, with no rails or floating panel', () => {
      const state = createState23A();
      const html = renderToStaticMarkup(
        React.createElement(PanelHost, {
          state,
          dispatch: vi.fn(),
          renderPanel: renderDummyPanel,
          canvas: dummyCanvas,
          panelBadges: { history: '41' },
        })
      );

      // Canvas slot present
      expect(html).toContain('data-slot="panel-canvas-slot"');
      expect(html).toContain('CANVAS_VIEWPORT_XYFLOW');

      // Right dock present
      expect(html).toContain('data-slot="dock-column"');
      expect(html).toContain('data-side="right"');
      expect(html).toContain('History');
      expect(html).toContain('41');
      expect(html).toContain('CONTENT_HISTORY');

      // Left dock, rails, floating absent
      expect(html).not.toContain('data-side="left"');
      expect(html).not.toContain('data-slot="panel-rail"');
      expect(html).not.toContain('data-slot="floating-panel"');
    });

    it('23B: renders Library docked left, with no right dock or floating panel', () => {
      const state = createState23B();
      const html = renderToStaticMarkup(
        React.createElement(PanelHost, {
          state,
          dispatch: vi.fn(),
          renderPanel: renderDummyPanel,
          canvas: dummyCanvas,
        })
      );

      expect(html).toContain('data-slot="panel-canvas-slot"');
      expect(html).toContain('data-slot="dock-column"');
      expect(html).toContain('data-side="left"');
      expect(html).toContain('Library');
      expect(html).toContain('CONTENT_LIBRARY');

      expect(html).not.toContain('data-side="right"');
      expect(html).not.toContain('data-slot="panel-rail"');
      expect(html).not.toContain('data-slot="floating-panel"');
    });

    it('23C: renders History floating with grip bar, header, and corner resize', () => {
      const state = createState23C();
      const html = renderToStaticMarkup(
        React.createElement(PanelHost, {
          state,
          dispatch: vi.fn(),
          renderPanel: renderDummyPanel,
          canvas: dummyCanvas,
        })
      );

      expect(html).toContain('data-slot="panel-canvas-slot"');
      expect(html).toContain('data-slot="floating-panel"');
      expect(html).toContain('data-panel-id="history"');
      expect(html).toContain('data-slot="panel-grip-bar"');
      expect(html).toContain('data-slot="float-resize-corner"');
      expect(html).toContain('CONTENT_HISTORY');

      // No dock columns or rails
      expect(html).not.toContain('data-slot="dock-column"');
      expect(html).not.toContain('data-slot="panel-rail"');
    });

    it('23D: renders dragging to dock state with drop targets on both edges and ghost panel', () => {
      const state = createState23D();
      const html = renderToStaticMarkup(
        React.createElement(PanelHost, {
          state,
          dispatch: vi.fn(),
          renderPanel: renderDummyPanel,
          canvas: dummyCanvas,
          isDraggingPreview: true,
          draggingPanelIdPreview: 'history',
          activeDropTargetPreview: 'left',
        })
      );

      expect(html).toContain('data-slot="drop-targets-overlay"');
      expect(html).toContain('data-slot="drop-target-left"');
      expect(html).toContain('data-slot="drop-target-right"');
      expect(html).toContain('Dock left');
      expect(html).toContain('Dock right');
      expect(html).toContain('data-slot="drop-target-left" data-active="true"');
      expect(html).toContain('data-slot="drop-target-right" data-active="false"');
      expect(html).toContain('data-slot="panel-canvas-slot"');
    });

    it('23E: renders stacked docks on right with splitter divider', () => {
      const state = createState23E();
      const html = renderToStaticMarkup(
        React.createElement(PanelHost, {
          state,
          dispatch: vi.fn(),
          renderPanel: renderDummyPanel,
          canvas: dummyCanvas,
          panelBadges: { history: '41 edits' },
        })
      );

      expect(html).toContain('data-slot="dock-column"');
      expect(html).toContain('data-side="right"');
      expect(html).toContain('data-slot="stack-splitter"');
      expect(html).toContain('aria-label="Panel stack splitter"');
      expect(html).toContain('History');
      expect(html).toContain('41 edits');
      expect(html).toContain('Library');
      expect(html).toContain('CONTENT_HISTORY');
      expect(html).toContain('CONTENT_LIBRARY');
    });

    it('23F: renders collapsed left rail with unseen dot and peek flyout, plus right docked Library', () => {
      const state = createState23F();
      const html = renderToStaticMarkup(
        React.createElement(PanelHost, {
          state,
          dispatch: vi.fn(),
          renderPanel: renderDummyPanel,
          canvas: dummyCanvas,
          unseenChanges: { history: true },
          activePeekPanelPreview: 'history',
        })
      );

      // Left rail present
      expect(html).toContain('data-slot="panel-rail"');
      expect(html).toContain('data-side="left"');
      expect(html).toContain('data-slot="rail-item-button"');
      expect(html).toContain('data-slot="rail-item-label"');
      expect(html).toContain('History');
      expect(html).toContain('data-slot="unseen-changes-dot"');

      // Peek flyout present
      expect(html).toContain('data-slot="panel-peek-flyout"');
      expect(html).toContain('peek · click to pin');
      expect(html).toContain('CONTENT_HISTORY');

      // Right dock present with Library
      expect(html).toContain('data-slot="dock-column"');
      expect(html).toContain('data-side="right"');
      expect(html).toContain('Library');
      expect(html).toContain('CONTENT_LIBRARY');
    });

    it('23G: renders both History and Library collapsed into left rail with expand-all toggle', () => {
      const state = createState23G();
      const html = renderToStaticMarkup(
        React.createElement(PanelHost, {
          state,
          dispatch: vi.fn(),
          renderPanel: renderDummyPanel,
          canvas: dummyCanvas,
          unseenChanges: { history: true },
        })
      );

      expect(html).toContain('data-slot="panel-rail"');
      expect(html).toContain('data-side="left"');
      expect(html).toContain('data-panel-id="history"');
      expect(html).toContain('data-panel-id="library"');
      expect(html).toContain('History');
      expect(html).toContain('Library');
      expect(html).toContain('data-slot="unseen-changes-dot"');
      expect(html).toContain('data-slot="rail-expand-all"');

      // No docks or floating panels
      expect(html).not.toContain('data-slot="dock-column"');
      expect(html).not.toContain('data-slot="floating-panel"');
    });
  });

  // ==========================================================================
  // 2. Canvas Slot Stability Across Layouts (R04 requirement)
  // ==========================================================================
  describe('Canvas slot stability (R04)', () => {
    it('preserves stable canvas slot container and key across all screen states', () => {
      const states = [
        createState23A(),
        createState23B(),
        createState23C(),
        createState23D(),
        createState23E(),
        createState23F(),
        createState23G(),
      ];

      for (const st of states) {
        const html = renderToStaticMarkup(
          React.createElement(PanelHost, {
            state: st,
            dispatch: vi.fn(),
            renderPanel: renderDummyPanel,
            canvas: React.createElement('div', { id: 'invariable-canvas-node' }, 'STABLE_CANVAS'),
          })
        );
        expect(html).toContain('data-slot="panel-canvas-slot"');
        expect(html).toContain('STABLE_CANVAS');
      }
    });
  });

  // ==========================================================================
  // 3. Header Menu Items Event Dispatching & Elements
  // ==========================================================================
  describe('PanelHeader event dispatching and elements', () => {
    it('renders close button and menu trigger in header', () => {
      const dispatch = vi.fn();
      const html = renderToStaticMarkup(
        React.createElement(PanelHeader, {
          panelId: 'history',
          title: 'History',
          placement: 'right',
          mode: 'docked-right',
          currentWidth: 356,
          dispatch,
        })
      );

      expect(html).toContain('data-slot="panel-close-button"');
      expect(html).toContain('data-slot="panel-menu-trigger"');
      expect(html).toContain('aria-label="Close History"');
    });

    it('renders dropdown menu items when menuOpen and renderMenuInline are true', () => {
      const dispatch = vi.fn();
      const html = renderToStaticMarkup(
        React.createElement(PanelHeader, {
          panelId: 'history',
          title: 'History',
          placement: 'right',
          mode: 'docked-right',
          currentWidth: 356,
          dispatch,
          menuOpen: true,
          renderMenuInline: true,
        })
      );

      expect(html).toContain('data-slot="panel-dropdown-menu"');
      expect(html).toContain('data-slot="menu-item-dock-right"');
      expect(html).toContain('data-slot="menu-item-dock-left"');
      expect(html).toContain('data-slot="menu-item-float"');
      expect(html).toContain('data-slot="menu-item-collapse"');
      expect(html).toContain('data-slot="menu-item-reset-width"');
      expect(html).toContain('data-slot="menu-item-close"');
      expect(html).toContain('356');
    });

    it('contains checkmark icon on active placement in menu', () => {
      const htmlRight = renderToStaticMarkup(
        React.createElement(PanelHeader, {
          panelId: 'history',
          title: 'History',
          placement: 'right',
          mode: 'docked-right',
          currentWidth: 356,
          dispatch: vi.fn(),
          menuOpen: true,
          renderMenuInline: true,
        })
      );
      expect(htmlRight).toContain('data-slot="check-icon"');

      const htmlLeft = renderToStaticMarkup(
        React.createElement(PanelHeader, {
          panelId: 'history',
          title: 'History',
          placement: 'left',
          mode: 'docked-left',
          currentWidth: 320,
          dispatch: vi.fn(),
          menuOpen: true,
          renderMenuInline: true,
        })
      );
      expect(htmlLeft).toContain('data-slot="check-icon"');
    });

    it('dispatches the exact reducer events for each menu option via dispatchPanelMenuAction', () => {
      const dispatch = vi.fn();

      // Dock right
      dispatchPanelMenuAction('dock-right', 'history', 'left', dispatch);
      expect(dispatch).toHaveBeenLastCalledWith({
        type: 'PLACE',
        panel: 'history',
        placement: 'right',
        index: 0,
      });

      // Dock left
      dispatchPanelMenuAction('dock-left', 'history', 'right', dispatch);
      expect(dispatch).toHaveBeenLastCalledWith({
        type: 'PLACE',
        panel: 'history',
        placement: 'left',
        index: 0,
      });

      // Float
      dispatchPanelMenuAction('float', 'history', 'right', dispatch);
      expect(dispatch).toHaveBeenLastCalledWith({
        type: 'PLACE',
        panel: 'history',
        placement: 'floating',
        index: 0,
      });

      // Collapse
      dispatchPanelMenuAction('collapse', 'history', 'right', dispatch);
      expect(dispatch).toHaveBeenLastCalledWith({
        type: 'COLLAPSE',
        panel: 'history',
      });

      // Reset width (when on right)
      dispatchPanelMenuAction('reset-width', 'history', 'right', dispatch);
      expect(dispatch).toHaveBeenLastCalledWith({
        type: 'RESET_SIDE',
        side: 'right',
      });

      // Reset width (when on left)
      dispatchPanelMenuAction('reset-width', 'history', 'left', dispatch);
      expect(dispatch).toHaveBeenLastCalledWith({
        type: 'RESET_SIDE',
        side: 'left',
      });

      // Close
      dispatchPanelMenuAction('close', 'history', 'right', dispatch);
      expect(dispatch).toHaveBeenLastCalledWith({
        type: 'CLOSE',
        panel: 'history',
      });
    });
  });

  // ==========================================================================
  // 4. Accessible Separators & Clamps
  // ==========================================================================
  describe('Accessible separator semantics and clamps', () => {
    it('dock column resize handle exposes role="separator" and aria attributes', () => {
      const state = createState23A();
      const html = renderToStaticMarkup(
        React.createElement(PanelHost, {
          state,
          dispatch: vi.fn(),
          renderPanel: renderDummyPanel,
          canvas: dummyCanvas,
        })
      );

      expect(html).toContain('data-slot="side-resize-handle"');
      expect(html).toContain('role="separator"');
      expect(html).toContain('aria-orientation="vertical"');
      expect(html).toContain('aria-valuenow="356"');
      expect(html).toContain('aria-valuemin="280"');
      expect(html).toContain('aria-valuemax="440"');
    });

    it('stacked divider exposes role="separator" and aria-orientation="horizontal"', () => {
      const state = createState23E();
      const html = renderToStaticMarkup(
        React.createElement(PanelHost, {
          state,
          dispatch: vi.fn(),
          renderPanel: renderDummyPanel,
          canvas: dummyCanvas,
        })
      );

      expect(html).toContain('data-slot="stack-splitter"');
      expect(html).toContain('role="separator"');
      expect(html).toContain('aria-orientation="horizontal"');
      expect(html).toContain('aria-label="Panel stack splitter"');
    });
  });

  // ==========================================================================
  // 5. Mobile & Tablet Responsive Overlays (< 768px / 768–1199px)
  // ==========================================================================
  describe('Responsive rules from §7', () => {
    it('renders overlay sheet on mobile (< 768px)', () => {
      const mobileState = {
        ...createState23A(),
        viewport: { width: 390, height: 844 },
      };

      const html = renderToStaticMarkup(
        React.createElement(PanelHost, {
          state: mobileState,
          dispatch: vi.fn(),
          renderPanel: renderDummyPanel,
          canvas: dummyCanvas,
        })
      );

      expect(html).toContain('data-slot="panel-modal-overlay"');
      expect(html).toContain('data-panel-id="history"');
      expect(html).toContain('CONTENT_HISTORY');
      expect(html).not.toContain('data-slot="dock-column"');
    });
  });
});
