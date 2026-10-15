import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../../components/ui/tooltip';

export type CollaborationDockView = 'ai' | 'inspector';
export interface CollaborationDockProps {
  readonly activeView: CollaborationDockView;
  readonly onViewChange: (view: CollaborationDockView) => void;
  readonly aiContent: React.ReactNode;
  readonly inspectorContent: React.ReactNode;
  readonly inspectorCount: number;
  /** The positioning host restores focus to its opener after closing. */
  readonly onClose: () => void;
  readonly className?: string;
}

/** Content wrapper only: PanelHost owns placement and controllers outlive visibility. */
export function CollaborationDock({ activeView, onViewChange, aiContent, inspectorContent, inspectorCount, onClose, className = '' }: CollaborationDockProps) {
  const count = Number.isFinite(inspectorCount) ? Math.max(0, Math.floor(inspectorCount)) : 0;
  return <Tabs value={activeView} onValueChange={view => { if (view === 'ai' || view === 'inspector') onViewChange(view); }} className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel ${className}`} data-testid="collaboration-dock">
    <header className="flex shrink-0 items-center justify-between gap-1 border-b border-hairline px-2">
      <TabsList aria-label="Workspace details" className="min-w-0 border-b-0">
        <TabsTrigger value="ai" className="min-h-11 px-2 text-caption">AI</TabsTrigger>
        <TabsTrigger value="inspector" className="min-h-11 gap-1 px-2 text-caption">Inspector{count > 0 && <span className="tabular-nums">({count})</span>}</TabsTrigger>
      </TabsList>
      <TooltipProvider><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="Close details panel" onClick={onClose}><X aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>Close details panel</TooltipContent></Tooltip></TooltipProvider>
    </header>
    <TabsContent value="ai" forceMount hidden={activeView !== 'ai'} className={`m-0 min-h-0 flex-1 overflow-hidden ${activeView !== 'ai' ? 'hidden' : ''}`}>{aiContent}</TabsContent>
    <TabsContent value="inspector" forceMount hidden={activeView !== 'inspector'} className={`m-0 min-h-0 flex-1 overflow-y-auto ${activeView !== 'inspector' ? 'hidden' : ''}`}>{inspectorContent}</TabsContent>
  </Tabs>;
}
