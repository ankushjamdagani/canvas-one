import * as React from 'react';
import { PanelHost } from './PanelHost';
import {
  createInitialPanelState,
  panelReducer,
  type WorkspacePanelState,
  type PanelId,
  type WorkspacePanelAction,
} from '@/features/workspace/panels';
import { Button } from '@/components/ui/button';

export type ScreenStateKey = '23A' | '23B' | '23C' | '23D' | '23E' | '23F' | '23G';

export function createState23A(): WorkspacePanelState {
  const base = createInitialPanelState();
  return {
    ...base,
    panels: {
      ...base.panels,
      history: {
        open: true,
        placement: 'right',
        collapsed: false,
        floatRect: base.panels.history.floatRect,
        stackOrder: 0,
      },
      library: {
        ...base.panels.library,
        open: false,
      },
    },
    sideWidths: {
      left: 320,
      right: 356,
    },
    focusedPanel: 'history',
  };
}

export function createState23B(): WorkspacePanelState {
  const base = createInitialPanelState();
  return {
    ...base,
    panels: {
      ...base.panels,
      library: {
        open: true,
        placement: 'left',
        collapsed: false,
        floatRect: base.panels.library.floatRect,
        stackOrder: 0,
      },
      history: {
        ...base.panels.history,
        open: false,
      },
    },
    sideWidths: {
      left: 320,
      right: 320,
    },
    focusedPanel: 'library',
  };
}

export function createState23C(): WorkspacePanelState {
  const base = createInitialPanelState();
  return {
    ...base,
    panels: {
      ...base.panels,
      history: {
        open: true,
        placement: 'floating',
        collapsed: false,
        floatRect: {
          x: 900,
          y: 110,
          width: 360,
          height: 480,
        },
        stackOrder: 0,
      },
      library: {
        ...base.panels.library,
        open: false,
      },
    },
    focusedPanel: 'history',
  };
}

export function createState23D(): WorkspacePanelState {
  const base = createInitialPanelState();
  return {
    ...base,
    panels: {
      ...base.panels,
      history: {
        open: true,
        placement: 'floating',
        collapsed: false,
        floatRect: {
          x: 240,
          y: 180,
          width: 340,
          height: 460,
        },
        stackOrder: 0,
      },
    },
    gesture: {
      snapshot: {
        panels: base.panels,
        sideWidths: base.sideWidths,
        focusedPanel: 'history',
      },
      kind: 'drag-panel-history',
    },
    focusedPanel: 'history',
  };
}

export function createState23E(): WorkspacePanelState {
  const base = createInitialPanelState();
  return {
    ...base,
    panels: {
      history: {
        open: true,
        placement: 'right',
        collapsed: false,
        floatRect: base.panels.history.floatRect,
        stackOrder: 0,
      },
      library: {
        open: true,
        placement: 'right',
        collapsed: false,
        floatRect: base.panels.library.floatRect,
        stackOrder: 1,
      },
    },
    sideWidths: {
      left: 320,
      right: 340,
    },
    focusedPanel: 'history',
  };
}

export function createState23F(): WorkspacePanelState {
  const base = createInitialPanelState();
  return {
    ...base,
    panels: {
      history: {
        open: true,
        placement: 'left',
        collapsed: true,
        floatRect: base.panels.history.floatRect,
        stackOrder: 0,
      },
      library: {
        open: true,
        placement: 'right',
        collapsed: false,
        floatRect: base.panels.library.floatRect,
        stackOrder: 0,
      },
    },
    sideWidths: {
      left: 320,
      right: 340,
    },
    focusedPanel: 'library',
  };
}

export function createState23G(): WorkspacePanelState {
  const base = createInitialPanelState();
  return {
    ...base,
    panels: {
      history: {
        open: true,
        placement: 'left',
        collapsed: true,
        floatRect: base.panels.history.floatRect,
        stackOrder: 0,
      },
      library: {
        open: true,
        placement: 'left',
        collapsed: true,
        floatRect: base.panels.library.floatRect,
        stackOrder: 1,
      },
    },
    sideWidths: {
      left: 320,
      right: 320,
    },
    focusedPanel: null,
  };
}

export const screenStateFactories: Record<ScreenStateKey, () => WorkspacePanelState> = {
  '23A': createState23A,
  '23B': createState23B,
  '23C': createState23C,
  '23D': createState23D,
  '23E': createState23E,
  '23F': createState23F,
  '23G': createState23G,
};

export const screenLabels: Record<ScreenStateKey, string> = {
  '23A': '23A: Dock right',
  '23B': '23B: Dock left',
  '23C': '23C: Floating panel',
  '23D': '23D: Dragging to dock',
  '23E': '23E: Stacked docks',
  '23F': '23F: Collapsed docks',
  '23G': '23G: Both collapsed left',
};

// Canvas mock with dotted background matching screens
const PreviewCanvasMock: React.FC = () => (
  <div
    data-slot="preview-canvas"
    className="w-full h-full relative bg-[#FAFBF9] flex items-center justify-center overflow-hidden"
    style={{
      backgroundImage: 'radial-gradient(circle, #D5DDD8 1px, transparent 1px)',
      backgroundSize: '24px 24px',
    }}
  >
    <div className="flex items-center gap-12 pointer-events-none opacity-85">
      <div className="w-48 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div className="font-semibold text-ui text-foreground">API gateway</div>
        <div className="font-mono text-xs text-secondary-text mt-1">router · 2 000 /s</div>
      </div>
      <div className="w-12 h-0.5 bg-control-border-strong/60" />
      <div className="w-48 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div className="font-semibold text-ui text-foreground">Checkout service</div>
        <div className="font-mono text-xs text-secondary-text mt-1">processor · 74% used</div>
      </div>
    </div>
  </div>
);

// Placeholder panel content ("History" / "Library" text blocks — no fake history data)
const renderPlaceholderPanel = (panelId: PanelId) => {
  if (panelId === 'history') {
    return (
      <div data-slot="history-placeholder-content" className="space-y-3 font-sans">
        <div className="p-3 rounded-lg border border-border bg-card">
          <div className="font-medium text-ui text-foreground">History panel content</div>
          <div className="text-xs text-secondary-text mt-1 font-mono">Working edits and branch events</div>
        </div>
        <div className="p-3 rounded-lg border border-border bg-card">
          <div className="text-xs font-semibold text-secondary-text uppercase font-mono tracking-wider">Edits</div>
          <div className="text-xs text-body mt-1">3 uncommitted changes recorded in branch working state.</div>
        </div>
      </div>
    );
  }

  return (
    <div data-slot="library-placeholder-content" className="space-y-3 font-sans">
      <div className="p-3 rounded-lg border border-border bg-card">
        <div className="font-medium text-ui text-foreground">Library panel content</div>
        <div className="text-xs text-secondary-text mt-1 font-mono">Component parts and catalog items</div>
      </div>
      <div className="p-3 rounded-lg border border-border bg-card">
        <div className="text-xs font-semibold text-secondary-text uppercase font-mono tracking-wider">Catalog</div>
        <div className="text-xs text-body mt-1">Standard and saved parts available for placement.</div>
      </div>
    </div>
  );
};

export interface PanelsPreviewProps {
  initialScreen?: ScreenStateKey;
  className?: string;
}

export const PanelsPreview: React.FC<PanelsPreviewProps> = ({
  initialScreen = '23A',
  className,
}) => {
  const [activeScreen, setActiveScreen] = React.useState<ScreenStateKey>(initialScreen);
  const [panelState, setPanelState] = React.useState<WorkspacePanelState>(() =>
    screenStateFactories[initialScreen]()
  );

  const switchScreen = (key: ScreenStateKey) => {
    setActiveScreen(key);
    setPanelState(screenStateFactories[key]());
  };

  const handleDispatch = (action: WorkspacePanelAction) => {
    setPanelState((prev) => panelReducer(prev, action).state);
  };

  return (
    <div
      data-slot="panels-preview-harness"
      className="flex flex-col w-full h-screen overflow-hidden bg-background text-foreground"
    >
      {/* Top harness bar to select 23A–23G */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-shell shrink-0 z-50">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-secondary-text">
            Panel Spec Preview:
          </span>
          <div className="flex items-center gap-1">
            {(Object.keys(screenStateFactories) as ScreenStateKey[]).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={activeScreen === key ? 'default' : 'outline'}
                onClick={() => switchScreen(key)}
                className="h-7 px-2.5 text-xs font-mono"
              >
                {key}
              </Button>
            ))}
          </div>
        </div>
        <span className="font-mono text-xs text-secondary-text">
          {screenLabels[activeScreen]}
        </span>
      </header>

      {/* Main panel host viewport */}
      <div className="flex-1 relative overflow-hidden">
        <PanelHost
          state={panelState}
          dispatch={handleDispatch}
          renderPanel={renderPlaceholderPanel}
          canvas={<PreviewCanvasMock />}
          panelBadges={{ history: '41 edits' }}
          unseenChanges={{
            history: activeScreen === '23F' || activeScreen === '23G',
          }}
          isDraggingPreview={activeScreen === '23D'}
          draggingPanelIdPreview={activeScreen === '23D' ? 'history' : null}
          activeDropTargetPreview={activeScreen === '23D' ? 'left' : null}
          activePeekPanelPreview={activeScreen === '23F' ? 'history' : null}
        />
      </div>
    </div>
  );
};
