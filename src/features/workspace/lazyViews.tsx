/**
 * Views that open on demand (History ladder, Commit, Publish flow, scenario editor) load
 * as separate chunks so the workspace renders without them (architecture.md: lazy-load
 * history, merge and results). The workspace preloads them once the browser is idle, so
 * opening one normally renders immediately. Each wrapper keeps the original props.
 */
import * as React from 'react';
import { lazyComponent } from '@/lib/lazyComponent';
import type { HistoryLadder as HistoryLadderComponent } from '../history/HistoryLadder';
import type { CommitPanel as CommitPanelComponent } from '../history/CommitPanel';
import type { PublishFlow as PublishFlowComponent } from '../history/PublishFlow';
import type { ScenarioEditor as ScenarioEditorComponent } from '../scenarios/ScenarioEditor';

const viewLoading = (
  <div role="status" className="p-4 text-xs text-secondary-text" data-testid="lazy-view-loading">
    Loading…
  </div>
);

export const HistoryLadder = lazyComponent<React.ComponentProps<typeof HistoryLadderComponent>>(
  () => import('../history/HistoryLadder').then((m) => m.HistoryLadder),
  viewLoading,
);
export const CommitPanel = lazyComponent<React.ComponentProps<typeof CommitPanelComponent>>(
  () => import('../history/CommitPanel').then((m) => m.CommitPanel),
  viewLoading,
);
export const PublishFlow = lazyComponent<React.ComponentProps<typeof PublishFlowComponent>>(
  () => import('../history/PublishFlow').then((m) => m.PublishFlow),
  viewLoading,
);
export const ScenarioEditor = lazyComponent<React.ComponentProps<typeof ScenarioEditorComponent>>(
  () => import('../scenarios/ScenarioEditor').then((m) => m.ScenarioEditor),
  viewLoading,
);

/** Warms every on-demand view; call once the workspace is idle. */
export function preloadLazyViews(): void {
  void HistoryLadder.preload();
  void CommitPanel.preload();
  void PublishFlow.preload();
  void ScenarioEditor.preload();
}
