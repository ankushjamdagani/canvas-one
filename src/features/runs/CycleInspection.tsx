import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Clock3, Layers3, ListTree, MapPin } from 'lucide-react';
import type { Cycle, FlowRecord } from '../../domain/studio/runner/types';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import type { PlaybackRange, PlaybackStore } from './playback';

export type CycleInspectionProps = {
  store: PlaybackStore;
  cycles: readonly Cycle[];
  selection: PlaybackRange | null;
  elementLabels: Record<string, string>;
  connectionLabels?: Record<string, string>;
  onSeek: (time: number) => void;
  visibleWindow?: PlaybackRange;
  onEventSelect?: (event: FlowRecord | null) => void;
  mobile?: boolean;
  eventResetKey?: number;
  recordingChanged?: boolean;
  onLocateEvent?: (event: FlowRecord) => void;
  canLocateEvent?: (event: FlowRecord) => boolean;
  navigation?: React.ReactNode;
};

const fmtTime = (ms: number | null): string => ms === null ? '—' : `${(ms / 1000).toFixed(3)} s`;
const fmtDuration = (ms: number | null): string => ms === null ? '—' : `${ms.toFixed(1)} ms`;
const fmtOutcome = (cycle: Cycle): string => cycle.outcome ?? 'in progress';
function EventRows({ events, labels, connectionLabels = {}, onSelect }: { events: readonly FlowRecord[]; labels: Record<string, string>; connectionLabels?: Record<string, string>; onSelect: (event: FlowRecord) => void }) {
  if (events.length === 0) return <p className="py-4 text-sm text-secondary-text">No retained lifecycle events for this cycle.</p>;
  return <ol className="divide-y divide-border" aria-label="Recorded lifecycle events">
    {events.map((event, index) => {
      const subject = event.elementId ? labels[event.elementId] ?? 'Component unavailable' : event.connectionId ? connectionLabels[event.connectionId] ?? 'Connection unavailable' : 'Unit';
      return <li key={`${event.key}:${event.phase}:${event.atMs}:${index}`}>
        <button type="button" onClick={() => onSelect(event)} className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)] gap-2 px-2 py-2 text-left text-sm hover:bg-sunken focus-visible:outline-2 focus-visible:outline-ring">
          <time className="font-mono text-xs text-secondary-text">{fmtTime(event.atMs)}</time>
          <span className="min-w-0 truncate"><span className="font-medium">{event.phase}</span><span className="text-secondary-text"> · {subject}{event.outcome ? ` · ${event.outcome}` : ''}</span></span>
        </button>
      </li>;
    })}
  </ol>;
}

export function CycleInspection({ store, cycles, selection, elementLabels, connectionLabels, onSeek, visibleWindow, onEventSelect, mobile = false, eventResetKey = 0, recordingChanged = false, onLocateEvent, canLocateEvent, navigation }: CycleInspectionProps) {
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set());
  const [cycleOffset, setCycleOffset] = useState(0);
  const [eventOffset, setEventOffset] = useState(0);
  const [mobilePane, setMobilePane] = useState<'list' | 'summary' | 'detail'>('list');
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [componentFilter, setComponentFilter] = useState('all');
  const [listViewportWidth, setListViewportWidth] = useState(240);
  const [columnWidth, setColumnWidth] = useState(288);
  const [selectedEvent, setSelectedEvent] = useState<FlowRecord | null>(null);
  const inspectionRoot = useRef<HTMLElement>(null);
  const columnDrag = useRef<{ x: number; width: number } | null>(null);
  const listViewport = useRef<HTMLDivElement>(null);
  const listScrollTop = useRef(0);
  useEffect(() => {
    const node = listViewport.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => setListViewportWidth(Math.max(1, entries[0]?.contentRect.width ?? 240)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setCycleOffset(0); setSelectedCycleId(null); setSelectedEvent(null); setExpandedGroups(new Set()); setEventOffset(0); setMobilePane('list'); onEventSelect?.(null); }, [selection?.startMs, selection?.endMs]);
  useEffect(() => { setSelectedEvent(null); onEventSelect?.(null); }, [eventResetKey]);
  const selectedCycle = selectedCycleId ? cycles.find((cycle) => cycle.id === selectedCycleId) ?? store.cyclesOverlappingRange(selection ?? { startMs: -Infinity, endMs: Infinity }, { limit: 200 }).rows.find((cycle) => cycle.id === selectedCycleId) : undefined;
  const query = useMemo(() => selection ? store.cyclesOverlappingRange(selection, { offset: cycleOffset, limit: 200, failuresOnly, componentId: componentFilter === 'all' ? undefined : componentFilter }) : { rows: [...cycles].filter((cycle) => (!failuresOnly || (cycle.outcome !== null && cycle.outcome !== 'ok')) && (componentFilter === 'all' || store.cycleTouchesComponent(cycle.id, componentFilter))).slice(cycleOffset, cycleOffset + 200), total: cycles.filter((cycle) => (!failuresOnly || (cycle.outcome !== null && cycle.outcome !== 'ok')) && (componentFilter === 'all' || store.cycleTouchesComponent(cycle.id, componentFilter))).length }, [store, selection?.startMs, selection?.endMs, cycleOffset, cycles, store.inspectionVersion, store.flowInspectionVersion, failuresOnly, componentFilter]);
  const rows = query.rows;
  const rangeStats = useMemo(() => selection ? store.statisticsForRange(selection) : null, [store, selection, store.inspectionVersion]);
  const eventsQuery = useMemo(() => selectedCycle ? store.flowEventsForCycle(selectedCycle.id, { offset: eventOffset, limit: 100 }) : { rows: [], total: 0 }, [store, selectedCycle?.id, eventOffset, store.flowInspectionVersion]);
  const events = eventsQuery.rows;
  const componentActivity = useMemo(() => selectedCycle ? store.componentActivityForCycle(selectedCycle.id) : [], [store, selectedCycle?.id, store.flowInspectionVersion]);

  const cycleSpan = cycles.reduce<{ startMs: number; endMs: number } | null>((span, cycle) => ({
    startMs: span ? Math.min(span.startMs, cycle.startedAtMs) : cycle.startedAtMs,
    endMs: span ? Math.max(span.endMs, cycle.startedAtMs + 1) : cycle.startedAtMs + 1,
  }), null);
  const spans = visibleWindow && visibleWindow.endMs > visibleWindow.startMs ? visibleWindow : selection ?? cycleSpan;
  const bucketMs = spans ? Math.max(1, (spans.endMs - spans.startMs) * 16 / listViewportWidth) : 1;
  const groups = useMemo(() => {
    const grouped = new Map<number, Cycle[]>();
    for (const cycle of rows) {
      const bucket = Math.floor(((cycle.startedAtMs - (spans?.startMs ?? 0)) / bucketMs));
      const group = grouped.get(bucket) ?? [];
      group.push(cycle);
      grouped.set(bucket, group);
    }
    return [...grouped.entries()].map(([bucket, members]) => ({ bucket, members }));
  }, [rows, bucketMs, spans?.startMs]);

  const chooseEvent = (event: FlowRecord) => {
    onSeek(event.atMs);
    setSelectedEvent(event);
    onEventSelect?.(event);
  };
  const selectCycle = (cycle: Cycle) => { setSelectedCycleId(cycle.id); setMobilePane('detail'); setSelectedEvent(null); setEventOffset(0); setTab('overview'); onEventSelect?.(null); };
  const backToCycle = () => { setSelectedEvent(null); onEventSelect?.(null); };
  const backToList = () => { setSelectedCycleId(null); setSelectedEvent(null); setMobilePane('list'); onEventSelect?.(null); requestAnimationFrame(() => { if (listViewport.current) listViewport.current.scrollTop = listScrollTop.current; }); };
  const backToRange = () => { setSelectedCycleId(null); setSelectedEvent(null); setMobilePane('summary'); onEventSelect?.(null); };
  const showList = !mobile || mobilePane === 'list';
  const showDetail = !mobile || mobilePane !== 'list';

  const resizeColumn = (next: number) => {
    const width = inspectionRoot.current?.getBoundingClientRect().width ?? 900;
    setColumnWidth(Math.max(192, Math.min(Math.min(520, width - 248), next)));
  };
  return <TooltipProvider delayDuration={300}><section ref={inspectionRoot} className="grid h-full min-h-0 overflow-hidden bg-background text-foreground" style={{ gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : `minmax(12rem, ${columnWidth}px) 8px minmax(0, 1fr)` }} aria-label="Cycle inspection">
      <div id="cycle-list-pane" className={`min-w-0 min-h-0 flex-col border-r border-border max-[720px]:border-r-0 max-[720px]:border-b ${showList ? 'flex' : 'hidden'}`}>
        {navigation}
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h3 className="text-sm font-semibold">{selection ? 'Cycles in range' : 'Recorded cycles'}</h3>
          <div className="flex items-center gap-2"><span className="text-xs text-secondary-text">{query.total.toLocaleString()}</span>{selection && <Button size="sm" variant="ghost" onClick={() => { setSelectedCycleId(null); setSelectedEvent(null); setMobilePane('summary'); onEventSelect?.(null); }}>Range summary</Button>}</div>
        </div>
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="text-xs text-secondary-text">Show</span>
          <Button size="sm" variant={failuresOnly ? 'ghost' : 'tint'} aria-pressed={!failuresOnly} onClick={() => { setFailuresOnly(false); setCycleOffset(0); }}>All</Button>
          <Button size="sm" variant={failuresOnly ? 'tint' : 'ghost'} aria-pressed={failuresOnly} onClick={() => { setFailuresOnly(true); setCycleOffset(0); }}>Non-success</Button>
        </div>
        <div className="border-b border-border px-3 py-1.5"><Select value={componentFilter} onValueChange={(value) => { setComponentFilter(value); setCycleOffset(0); }}><SelectTrigger aria-label="Filter by component" className="h-8 text-sm"><SelectValue placeholder="All components" /></SelectTrigger><SelectContent><SelectItem value="all">All components</SelectItem>{Object.entries(elementLabels).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent></Select></div>
        <div ref={listViewport} onScroll={(event) => { listScrollTop.current = event.currentTarget.scrollTop; }} className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? <p className="px-3 py-5 text-sm text-secondary-text">No cycles in this interval.</p> : groups.map(({ bucket, members }) => {
            // Group a collision only after it exceeds the visible row budget; small clusters stay individual.
            const crowded = members.length >= 8 && rows.length > 24;
            const expanded = expandedGroups.has(bucket);
            if (crowded) return <div key={bucket} className="border-b border-border">
              <button type="button" className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-sm hover:bg-sunken" aria-expanded={expanded} onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (next.has(bucket)) next.delete(bucket); else next.add(bucket); return next; })}>
                {expanded ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronRight aria-hidden="true" className="size-4" />}
                <span className="font-medium">{members.length} cycles in this page</span><span className="text-xs text-secondary-text">{fmtTime(Math.min(...members.map((cycle) => cycle.startedAtMs)))}–{fmtTime(Math.max(...members.map((cycle) => cycle.startedAtMs)))}</span><span className="ml-auto text-xs text-secondary-text">{summarizeOutcomes(members)}</span>
              </button>
              {expanded && members.map((cycle) => <CycleRow key={cycle.id} cycle={cycle} selected={cycle.id === selectedCycleId} onSelect={selectCycle} />)}
            </div>;
            return members.map((cycle) => <CycleRow key={cycle.id} cycle={cycle} selected={cycle.id === selectedCycleId} onSelect={selectCycle} />);
          })}
          {query.total > 200 && <div className="flex items-center justify-between gap-2 border-t border-border p-2"><Button size="sm" variant="ghost" disabled={cycleOffset === 0} onClick={() => setCycleOffset((offset) => Math.max(0, offset - 200))}>Previous</Button><span className="text-xs text-secondary-text">{cycleOffset + 1}–{Math.min(cycleOffset + rows.length, query.total)} of {query.total.toLocaleString()}</span><Button size="sm" variant="ghost" disabled={cycleOffset + rows.length >= query.total} onClick={() => setCycleOffset((offset) => offset + 200)}>Next</Button></div>}
        </div>
      </div>

      {!mobile && <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize cycle list and inspection details"
        aria-valuemin={192}
        aria-valuemax={Math.min(520, (inspectionRoot.current?.getBoundingClientRect().width ?? 900) - 248)}
        aria-valuenow={columnWidth}
        aria-controls="cycle-list-pane cycle-inspection-detail"
        data-testid="cycle-inspection-resize"
        tabIndex={0}
        className="relative z-10 flex w-2 cursor-col-resize touch-none items-center justify-center bg-background focus-visible:outline-2 focus-visible:outline-ring after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border"
        onPointerDown={(event) => { columnDrag.current = { x: event.clientX, width: columnWidth }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (columnDrag.current) resizeColumn(columnDrag.current.width + event.clientX - columnDrag.current.x); }}
        onPointerUp={() => { columnDrag.current = null; }}
        onPointerCancel={() => { columnDrag.current = null; }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); resizeColumn(columnWidth - (event.shiftKey ? 32 : 12)); }
          else if (event.key === 'ArrowRight') { event.preventDefault(); resizeColumn(columnWidth + (event.shiftKey ? 32 : 12)); }
          else if (event.key === 'Home') { event.preventDefault(); resizeColumn(192); }
          else if (event.key === 'End') { event.preventDefault(); resizeColumn(520); }
        }}
      ><span aria-hidden="true" className="h-8 w-0.5 rounded-full bg-muted-foreground/50" /></div>}

      <div id="cycle-inspection-detail" className={`min-w-0 min-h-0 overflow-y-auto p-3 ${showDetail ? 'block' : 'hidden'}`}>
        {mobile && !showList && navigation}
        {recordingChanged && <p role="status" className="mb-3 rounded-control border border-border bg-sunken px-2.5 py-2 text-xs text-secondary-text">Recorded on an earlier version of this design.</p>}
        {mobile && mobilePane === 'summary' && <Button size="sm" variant="ghost" className="mb-2" onClick={() => { setMobilePane('list'); requestAnimationFrame(() => { if (listViewport.current) listViewport.current.scrollTop = listScrollTop.current; }); }}><ArrowLeft aria-hidden="true" />Back to cycles</Button>}
        {mobile && mobilePane === 'detail' && <Button size="sm" variant="ghost" className="mb-2" onClick={backToList}><ArrowLeft aria-hidden="true" />Cycle list</Button>}
        {selectedEvent && selectedCycle ? <div>
          <Button size="sm" variant="ghost" className="-ml-2 mb-2" onClick={backToCycle}><ArrowLeft aria-hidden="true" />Back to cycle</Button>
          <h3 className="mb-3 text-sm font-semibold">Recorded event detail</h3>
          <dl className="grid grid-cols-[minmax(7rem,0.65fr)_minmax(0,1.35fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-secondary-text">Observed time</dt><dd className="font-mono">{fmtTime(selectedEvent.atMs)}</dd>
            <dt className="text-secondary-text">Event</dt><dd>{selectedEvent.phase}</dd>
            <dt className="text-secondary-text">Unit</dt><dd>{selectedEvent.category === 'root' ? 'Root request' : selectedEvent.category === 'message' ? 'Descendant message' : 'Unavailable'}</dd>
            <dt className="text-secondary-text">Component</dt><dd>{selectedEvent.elementId ? elementLabels[selectedEvent.elementId] ?? 'Component unavailable' : 'Not recorded'}</dd>
            <dt className="text-secondary-text">Connection</dt><dd>{selectedEvent.connectionId ? connectionLabels?.[selectedEvent.connectionId] ?? 'Connection unavailable' : 'Not recorded'}</dd>
            <dt className="text-secondary-text">Attempt</dt><dd>{selectedEvent.attempt === undefined ? 'Unavailable' : selectedEvent.attempt + 1}</dd>
            <dt className="text-secondary-text">Outcome</dt><dd>{selectedEvent.outcome ?? 'Not recorded'}</dd>
          </dl>
          <Tooltip>
            <TooltipTrigger asChild><span className="mt-4 inline-flex"><Button size="sm" variant="outline" disabled={!canLocateEvent?.(selectedEvent)} onClick={() => onLocateEvent?.(selectedEvent)}><MapPin aria-hidden="true" />Locate on canvas</Button></span></TooltipTrigger>
            <TooltipContent>{canLocateEvent?.(selectedEvent) ? 'Show this recorded event on the canvas' : 'Recorded endpoints are not placed in the current canvas'}</TooltipContent>
          </Tooltip>
        </div> : mobile && mobilePane === 'list' ? <p className="py-3 text-sm text-secondary-text">Select a cycle or open Range summary.</p> : selectedCycle ? <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0"><Button size="sm" variant="ghost" onClick={backToRange} className="-ml-2 mb-1"><ArrowLeft aria-hidden="true" />Range summary</Button><h3 className="text-sm font-semibold">Selected cycle</h3></div>
            <span className="rounded-control bg-sunken px-2 py-1 text-xs">{fmtOutcome(selectedCycle)}</span>
          </div>
          <p className="mb-2 text-xs text-secondary-text">Cycle details cover its full recorded lifetime, including events after the current playhead.</p>
          {store.isStream && selectedCycle.startedAtMs < store.inspectionHistoryStartMs && <p role="status" className="mb-2 rounded-control border border-border bg-sunken px-2.5 py-2 text-xs text-secondary-text">This cycle began before the retained-history boundary. Some earlier lifecycle details may have been evicted.</p>}
          <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
            <TabsList aria-label="Cycle details" className="w-full shrink-0 justify-start">
              <TabsTrigger value="overview" className="px-2 text-sm"><ListTree className="mr-1 size-4" aria-hidden="true" />Overview</TabsTrigger>
              <TabsTrigger value="components" className="px-2 text-sm"><Layers3 className="mr-1 size-4" aria-hidden="true" />Components</TabsTrigger>
              <TabsTrigger value="events" className="px-2 text-sm">Event log</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto">
              <dl className="grid grid-cols-[minmax(8rem,0.7fr)_minmax(0,1.3fr)] gap-x-3 gap-y-2 py-2 text-sm">
                <dt className="text-secondary-text">Started</dt><dd>{fmtTime(selectedCycle.startedAtMs)}</dd>
                <dt className="text-secondary-text">Response reached source</dt><dd>{fmtTime(selectedCycle.responseAtMs)}</dd>
                <dt className="text-secondary-text">Response latency</dt><dd>{fmtDuration(selectedCycle.responseAtMs === null ? null : selectedCycle.responseAtMs - selectedCycle.startedAtMs)}</dd>
                <dt className="text-secondary-text">All work complete</dt><dd>{fmtTime(selectedCycle.completedAtMs)}</dd>
                <dt className="text-secondary-text">Completion latency</dt><dd>{fmtDuration(selectedCycle.completedAtMs === null ? null : selectedCycle.completedAtMs - selectedCycle.startedAtMs)}</dd>
                <dt className="text-secondary-text">All-work outcome</dt><dd>{fmtOutcome(selectedCycle)}</dd>
              </dl>
              <h4 className="mb-1 mt-3 text-sm font-semibold">Causal flow</h4>
              <p className="mb-2 text-xs text-secondary-text">Descendant messages follow recorded parent links and can run before the response reaches the source.</p>
              <p className="mb-1 text-xs text-secondary-text">Previewing {events.length} of {eventsQuery.total.toLocaleString()} retained events.</p>
              <CausalFlow events={events} labels={elementLabels} connectionLabels={connectionLabels} cycleId={selectedCycle.id} onSelect={chooseEvent} />
              {eventsQuery.total > events.length && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setTab('events')}>Open all {eventsQuery.total.toLocaleString()} events</Button>}
            </TabsContent>
            <TabsContent value="components" className="min-h-0 flex-1 overflow-y-auto">
              <h4 className="mb-2 text-sm font-semibold">Measured cycle activity</h4>
              <p className="mb-2 text-xs text-secondary-text">Counts below come from retained lifecycle facts for this cycle.</p>
              <ComponentCounts activity={componentActivity} labels={elementLabels} />
            </TabsContent>
            <TabsContent value="events" className="min-h-0 flex-1 overflow-y-auto">
              <div className="mb-2 flex justify-between text-xs text-secondary-text"><span>Recorded lifecycle events</span><span>{eventsQuery.total.toLocaleString()}</span></div>
              <EventRows events={events} labels={elementLabels} connectionLabels={connectionLabels} onSelect={chooseEvent} />
              {eventsQuery.total > 100 && <div className="flex items-center justify-between gap-2 border-t border-border pt-2"><Button size="sm" variant="ghost" disabled={eventOffset === 0} onClick={() => setEventOffset((offset) => Math.max(0, offset - 100))}>Previous events</Button><span className="text-xs text-secondary-text">{eventOffset + 1}–{Math.min(eventOffset + events.length, eventsQuery.total)}</span><Button size="sm" variant="ghost" disabled={eventOffset + events.length >= eventsQuery.total} onClick={() => setEventOffset((offset) => offset + 100)}>More events</Button></div>}
            </TabsContent>
          </Tabs>
        </> : selection && rangeStats ? <>
          <div className="mb-3 flex items-center gap-2"><Clock3 className="size-4 text-secondary-text" aria-hidden="true" /><h3 className="text-sm font-semibold">Range activity</h3></div>
          <p className="mb-3 text-xs text-secondary-text">Activity is counted when it occurs in [{fmtTime(selection.startMs)}, {fmtTime(selection.endMs)}). Latency means use only cycles whose response or completion occurred in this interval. The cycle list includes lifetimes that overlap it.</p>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-secondary-text">Starts in interval</dt><dd className="text-right tabular-nums">{rangeStats.starts}</dd>
            <dt className="text-secondary-text">Responses in interval</dt><dd className="text-right tabular-nums">{rangeStats.responses}</dd>
            <dt className="text-secondary-text">Completions in interval</dt><dd className="text-right tabular-nums">{rangeStats.completions}</dd>
            <dt className="text-secondary-text">Non-success completions</dt><dd className="text-right tabular-nums">{rangeStats.failures}</dd>
            <dt className="text-secondary-text">Open at interval start / end</dt><dd className="text-right tabular-nums">{rangeStats.activeAtStart} / {rangeStats.activeAtEnd}</dd>
            <dt className="text-secondary-text">Peak concurrent cycles</dt><dd className="text-right tabular-nums">{rangeStats.peakConcurrency}</dd>
            <dt className="text-secondary-text">Response latency mean · response cohort</dt><dd className="text-right tabular-nums">{rangeStats.responseLatenciesMs.length ? `${mean(rangeStats.responseLatenciesMs).toFixed(1)} ms` : 'Unavailable'}</dd>
            <dt className="text-secondary-text">Completion latency mean · completion cohort</dt><dd className="text-right tabular-nums">{rangeStats.completionLatenciesMs.length ? `${mean(rangeStats.completionLatenciesMs).toFixed(1)} ms` : 'Unavailable'}</dd>
          </dl>
          <p className="mt-3 text-xs text-secondary-text">{rangeStats.responseLatenciesMs.length} response and {rangeStats.completionLatenciesMs.length} completion latency samples.</p>
        </> : <p className="py-5 text-sm text-secondary-text">Select a time range or cycle to inspect recorded activity.</p>}
      </div>
    </section></TooltipProvider>;
}

function CycleRow({ cycle, selected, onSelect }: { cycle: Cycle; selected: boolean; onSelect: (cycle: Cycle) => void }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const duration = Math.max(1, (cycle.completedAtMs ?? cycle.responseAtMs ?? cycle.startedAtMs + 1) - cycle.startedAtMs);
  const responsePosition = cycle.responseAtMs === null ? null : Math.max(0, Math.min(100, ((cycle.responseAtMs - cycle.startedAtMs) / duration) * 100));
  const openPopover = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const closePopover = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 120); };
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" data-testid="cycle-inspection-row" data-cycle-id={cycle.id} aria-label={`Inspect request cycle ${cycle.id}`} onClick={(event) => { event.preventDefault(); setOpen(false); onSelect(cycle); }} onMouseEnter={openPopover} onMouseLeave={closePopover} onFocus={openPopover} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closePopover(); }} aria-pressed={selected} className="flex min-h-10 w-full items-center justify-between gap-2 border-b border-border px-3 pl-9 text-left text-sm hover:bg-sunken aria-pressed:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
      <span className="min-w-0 truncate text-xs">Request · {fmtTime(cycle.startedAtMs)}</span><span className="shrink-0 text-xs text-secondary-text" title="All-work outcome, including asynchronous descendants">{fmtOutcome(cycle)}</span>
    </button></PopoverTrigger>
    <PopoverContent side="right" className="w-64 p-3 text-sm" onMouseEnter={openPopover} onMouseLeave={closePopover} onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      <span className="mb-2 block text-xs font-semibold">Cycle timing · all-work outcome: {fmtOutcome(cycle)}</span>
      <span className="mb-1 block text-xs">Response {fmtDuration(cycle.responseAtMs === null ? null : cycle.responseAtMs - cycle.startedAtMs)}</span>
      <span className="relative mb-2 block h-1.5 overflow-hidden rounded-full bg-sunken"><span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${responsePosition ?? 0}%` }} /></span>
      <span className="mb-1 block text-xs">All work {fmtDuration(cycle.completedAtMs === null ? null : cycle.completedAtMs - cycle.startedAtMs)}</span>
      <span className="relative block h-1.5 overflow-hidden rounded-full bg-sunken"><span className="absolute inset-y-0 left-0 w-full rounded-full bg-foreground" /></span>
    </PopoverContent>
  </Popover>;
}

function ComponentCounts({ activity, labels }: { activity: readonly { elementId: string; events: number }[]; labels: Record<string, string> }) {
  if (!activity.length) return <p className="text-sm text-secondary-text">Component activity is unavailable because no retained lifecycle fact identifies a component.</p>;
  return <dl className="divide-y divide-border">{activity.map(({ elementId, events }) => <div key={elementId} className="flex justify-between gap-3 py-2 text-sm"><dt className="truncate">{labels[elementId] ?? 'Component unavailable'}</dt><dd className="shrink-0 font-mono">{events} events</dd></div>)}</dl>;
}

function CausalFlow({ events, labels, connectionLabels, cycleId, onSelect }: { events: readonly FlowRecord[]; labels: Record<string, string>; connectionLabels?: Record<string, string>; cycleId: string; onSelect: (event: FlowRecord) => void }) {
  const rootEvents = events.filter((event) => event.unitId === event.cycleId);
  const messageGroups = new Map<string, FlowRecord[]>();
  for (const event of events) {
    if (event.category !== 'message') continue;
    const parent = event.parentUnitId ?? 'parent unavailable';
    const group = messageGroups.get(parent) ?? [];
    group.push(event);
    messageGroups.set(parent, group);
  }
  const unitStarts = new Map<string, number>();
  for (const event of events) if (event.category === 'message') unitStarts.set(event.unitId ?? '', Math.min(unitStarts.get(event.unitId ?? '') ?? Infinity, event.atMs));
  const branchNumber = new Map([...unitStarts.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([unitId], index) => [unitId, index + 1]));
  return <div className="space-y-3">
    <section><h5 className="mb-1 text-xs font-semibold uppercase text-secondary-text">Synchronous response path</h5><EventRows events={rootEvents} labels={labels} connectionLabels={connectionLabels} onSelect={onSelect} /></section>
    <section><h5 className="mb-1 text-xs font-semibold uppercase text-secondary-text">Asynchronous descendants</h5>
      {messageGroups.size === 0 ? <p className="py-2 text-sm text-secondary-text">No descendant message activity recorded.</p> : [...messageGroups.entries()].sort((a, b) => a[1][0].atMs - b[1][0].atMs).map(([parent, rows]) => <details key={parent} className="border-y border-border">
        <summary className="cursor-pointer px-2 py-2 text-sm">{rows.length} events from {parent === cycleId ? 'the root request' : `message branch ${branchNumber.get(parent) ?? 'unavailable'}`} · first observed {fmtTime(Math.min(...rows.map((event) => event.atMs)))}</summary>
        <EventRows events={rows} labels={labels} connectionLabels={connectionLabels} onSelect={onSelect} />
      </details>)}
    </section>
  </div>;
}

function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function summarizeOutcomes(cycles: readonly Cycle[]): string {
  const complete = cycles.filter((cycle) => cycle.outcome !== null).length;
  const failed = cycles.filter((cycle) => cycle.outcome !== null && cycle.outcome !== 'ok').length;
  return `${complete} complete · ${failed} non-success`;
}
