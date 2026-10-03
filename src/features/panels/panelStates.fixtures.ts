/** Panel states for screens 23A–23G, as fixtures for PanelHost tests. */
import {
  createInitialPanelState,
  type WorkspacePanelState,
} from '@/features/workspace/panels';

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
      ...base.panels,
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
      ...base.panels,
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
      ...base.panels,
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
