/** 16D selection-scoped actions, routed through the command registry. */

import * as React from 'react';
import { useStore } from '@xyflow/react';
import { BoxSelect, ChevronDown, ChevronsDownUp, ChevronsUpDown, Copy, Group, MoreHorizontal, Trash2, Ungroup } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuHeader,
  DropdownMenuFooter,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  getAvailability,
  getPayloadFreeAvailability,
  type CommandContext,
  type CommandPayloads,
  type ExecuteResult,
} from './commands/registry';

export type CanvasAuthoringCommandId =
  | 'selection.duplicate'
  | 'selection.delete'
  | 'selection.group'
  | 'selection.wrap-in-boundary'
  | 'selection.ungroup'
  | 'selection.align'
  | 'selection.distribute'
  | 'canvas.add-note'
  | 'canvas.expand'
  | 'canvas.collapse'
  | 'selection.save-as-component'
  | 'selection.replace-part'
  | 'selection.add-probe'
  | 'history.show-changes'
  | 'selection.export';

export type CanvasCommandExecutor = <K extends CanvasAuthoringCommandId>(
  id: K,
  payload: CommandPayloads[K],
) => Promise<ExecuteResult>;

export interface SelectionToolbarProps {
  readonly context: CommandContext;
  readonly executeCommand: CanvasCommandExecutor;
  readonly mintId: () => string;
}

function commandSucceeded(result: ExecuteResult): boolean {
  if (result.status !== 'done') return false;
  if (result.value && typeof result.value === 'object' && 'ok' in result.value) {
    return (result.value as { readonly ok: boolean }).ok;
  }
  return true;
}

function commandError(result: ExecuteResult): string | null {
  if (result.status === 'disabled') return result.reason;
  if (result.value && typeof result.value === 'object' && 'ok' in result.value) {
    const outcome = result.value as { readonly ok: boolean; readonly message?: string };
    return outcome.ok ? null : (outcome.message ?? 'Could not apply this canvas change');
  }
  return null;
}

type OverflowCommandId =
  | 'selection.save-as-component'
  | 'selection.replace-part'
  | 'selection.add-probe'
  | 'history.show-changes'
  | 'selection.export';

/** Board 16D overflow menu, in board order (Wrap in boundary lives on the toolbar). */
const OVERFLOW_PRIMARY: readonly { readonly id: OverflowCommandId; readonly label: string }[] = [
  { id: 'selection.save-as-component', label: 'Save as component' },
  { id: 'selection.replace-part', label: 'Replace part…' },
  { id: 'selection.add-probe', label: 'Add flow probe' },
  { id: 'history.show-changes', label: 'Changes on this part' },
];
const OVERFLOW_SECONDARY: readonly { readonly id: OverflowCommandId; readonly label: string }[] = [
  { id: 'selection.export', label: 'Export selection' },
];

export function SelectionToolbar({ context, executeCommand, mintId }: SelectionToolbarProps) {
  const [groupOpen, setGroupOpen] = React.useState(false);
  const [groupLabel, setGroupLabel] = React.useState('');
  const [groupError, setGroupError] = React.useState<string | null>(null);
  const [wrapOpen, setWrapOpen] = React.useState(false);
  const [overflowError, setOverflowError] = React.useState<string | null>(null);
  const selectionKey = context.selectedElementIds.join(',');
  React.useEffect(() => setOverflowError(null), [selectionKey]);
  const [wrapLabel, setWrapLabel] = React.useState('');
  const [wrapError, setWrapError] = React.useState<string | null>(null);
  
  const selectedIds = React.useMemo(() => [
    ...(context.selectedPlacementIds ?? []),
    ...context.selectedGroupIds,
  ], [context.selectedPlacementIds, context.selectedGroupIds]);
  
  const [tx, ty, tZoom] = useStore((s) => s.transform);
  const rect = useStore((s) => {
    const nodes = selectedIds.map(id => s.nodeLookup.get(id)).filter((n): n is NonNullable<typeof n> => !!n);
    if (nodes.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const x = n.position.x;
      const y = n.position.y;
      const w = n.measured?.width ?? n.width ?? 184;
      const h = n.measured?.height ?? n.height ?? 76;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, (a, b) => a?.x === b?.x && a?.y === b?.y && a?.width === b?.width && a?.height === b?.height);

  const [viewportWidth, setViewportWidth] = React.useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const canvasWidth = useStore((s) => s.width);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const [toolbarWidth, setToolbarWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const measure = () => setToolbarWidth(el.offsetWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isCoarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const isFixed = isCoarse || viewportWidth < 640;

  let style: React.CSSProperties = {};
  if (isFixed || !rect) {
    style = { top: '12px', right: '12px' };
  } else {
    const screenX = rect.x * tZoom + tx;
    const screenY = rect.y * tZoom + ty;
    const screenWidth = rect.width * tZoom;
    const screenHeight = rect.height * tZoom;
    
    // Centred above the selection, clamped inside the canvas with 12 px margins
    // (the toolbar's own measured width keeps both edges on screen).
    const centerX = screenX + screenWidth / 2;
    const half = toolbarWidth / 2;
    const clampedX = canvasWidth > 0 && toolbarWidth > 0
      ? Math.min(Math.max(centerX, 12 + half), Math.max(12 + half, canvasWidth - 12 - half))
      : centerX;
    style = {
      left: `${clampedX}px`,
      transform: 'translate(-50%, 0)',
    };
    if (screenY >= 60) {
      style.top = `${screenY - 12}px`;
      style.transform = 'translate(-50%, -100%)';
    } else {
      style.top = `${screenY + screenHeight + 12}px`;
    }
  }

  // Then the component continues as normal.
  const groupAvailability = getAvailability('selection.group', context, { label: groupLabel });
  const ungroupAvailability = getAvailability('selection.ungroup', context, {
    groupIds: context.selectedGroupIds,
  });
  const wrapPayloadBase = {
    viewId: context.activeViewId ?? '',
    elementIds: context.selectedElementIds,
    ownerElementId: '',
    refinementId: '',
    label: wrapLabel,
  };
  const wrapAvailability = getAvailability('selection.wrap-in-boundary', context, wrapPayloadBase);
  const duplicateAvailability = getAvailability('selection.duplicate', context, {});
  const deleteAvailability = getAvailability('selection.delete', context, {});
  const count = context.selectedElementIds.length;
  // One group (preferred) or one component: toggles its presentation state.
  const expansionTarget = !context.activeViewId
    ? null
    : context.selectedGroupIds.length === 1
      ? ({ kind: 'group', id: context.selectedGroupIds[0] } as const)
      : context.selectedPlacementIds?.length === 1 && context.selectedElementIds.length === 1
        ? ({ kind: 'placement', id: context.selectedPlacementIds[0] } as const)
        : null;
  const targetExpanded = expansionTarget ? (context.expansionState?.[expansionTarget.id] ?? true) : true;
  const expansionCommand = targetExpanded ? 'canvas.collapse' : 'canvas.expand';
  const expansionPayload = expansionTarget && context.activeViewId
    ? { viewId: context.activeViewId, target: expansionTarget }
    : null;
  const expansionAvailability = expansionPayload
    ? getAvailability(expansionCommand, context, expansionPayload)
    : null;

  async function submitGroup() {
    const label = groupLabel.trim();
    if (!groupAvailability.enabled) return;
    if (label.length === 0) {
      setGroupError('Enter a group name');
      return;
    }
    if (Array.from(label).length > 80) {
      setGroupError('Use 80 characters or fewer');
      return;
    }
    const result = await executeCommand('selection.group', { label });
    if (commandSucceeded(result)) {
      setGroupOpen(false);
      setGroupLabel('');
      setGroupError(null);
    } else {
      setGroupError(commandError(result));
    }
  }

  async function submitWrap() {
    const label = wrapLabel.trim();
    if (!wrapAvailability.enabled) return;
    if (label.length === 0) {
      setWrapError('Enter a boundary name');
      return;
    }
    if (Array.from(label).length > 80) {
      setWrapError('Use 80 characters or fewer');
      return;
    }
    const result = await executeCommand('selection.wrap-in-boundary', {
      ...wrapPayloadBase,
      ownerElementId: mintId(),
      refinementId: mintId(),
      label,
    });
    if (commandSucceeded(result)) {
      setWrapOpen(false);
      setWrapLabel('');
      setWrapError(null);
    } else {
      setWrapError(commandError(result));
    }
  }

  const alignItems = [
    ['left', 'Align left'],
    ['center-x', 'Align center horizontally'],
    ['right', 'Align right'],
    ['top', 'Align top'],
    ['center-y', 'Align center vertically'],
    ['bottom', 'Align bottom'],
  ] as const;
  const distributeItems = [
    ['x', 'Distribute horizontally'],
    ['y', 'Distribute vertically'],
  ] as const;

  const runOverflow = async (id: OverflowCommandId) => {
    setOverflowError(null);
    const result = await executeCommand(id, {});
    setOverflowError(commandError(result));
  };

  const overflowItem = ({ id, label }: { readonly id: OverflowCommandId; readonly label: string }) => {
    const availability = getPayloadFreeAvailability(id, context);
    return (
      <DropdownMenuItem
        key={id}
        data-testid={`selection-overflow-${id.replace('.', '-')}`}
        disabled={!availability.enabled}
        onSelect={() => void runOverflow(id)}
        className="flex flex-col items-start gap-0.5 px-2.5 py-1.5 rounded-control text-[13px] pointer-coarse:min-h-11"
      >
        <span>{label}</span>
        {availability.enabled ? null : (
          <span className="text-[10px] text-secondary-text">{availability.reason}</span>
        )}
      </DropdownMenuItem>
    );
  };

  return (
    <div
      ref={toolbarRef}
      data-testid="selection-toolbar"
      className="absolute z-10 flex w-max flex-wrap justify-center items-center gap-1 max-w-[calc(100%-24px)] px-1.5 py-1 rounded-control bg-panel border border-control-border shadow-raised"
      style={style}
    >
      <span
        data-testid="selection-count"
        className="h-7 px-2 inline-flex items-center rounded-tag bg-sunken font-mono text-[10px] font-semibold tracking-wide text-secondary-text"
      >
        {count} {count === 1 ? 'PART' : 'PARTS'}
      </span>

<Popover
        open={groupOpen}
        onOpenChange={(open) => {
          setGroupOpen(open);
          if (!open) setGroupError(null);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            data-testid="selection-group-btn"
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={!groupAvailability.enabled}
            title={groupAvailability.enabled ? undefined : groupAvailability.reason}
          >
            <Group className="size-3.5" /> Group
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-0 overflow-hidden rounded-popover border border-border shadow-popover">
          <form
            data-testid="selection-group-popover"
            onSubmit={(event) => {
              event.preventDefault();
              void submitGroup();
            }}
          >
            <div className="px-3 py-2 bg-panel border-b border-hairline font-mono text-meta font-medium text-secondary-text uppercase">
              NEW GROUP
            </div>
            <div className="p-3 bg-background">
              <label className="block text-xs font-medium text-ink mb-1.5" htmlFor="selection-group-label">
                Group name
              </label>
              <Input
                id="selection-group-label"
                data-testid="selection-group-input"
                autoFocus
                value={groupLabel}
                placeholder="Name this group…"
                onChange={(event) => {
                  setGroupLabel(event.target.value);
                  setGroupError(null);
                }}
              />
              {groupError && <p role="alert" className="mt-1.5 text-xs text-risk-text">{groupError}</p>}
            </div>
            <div className="px-3 py-2 bg-panel border-t border-hairline flex justify-end">
              <Button type="submit" size="sm" variant="tint" disabled={groupLabel.trim().length === 0}>
                Group
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

{context.selectedGroupIds.length === 1 && (
        <Button
          data-testid="selection-ungroup-btn"
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={!ungroupAvailability.enabled}
          title={ungroupAvailability.enabled ? undefined : ungroupAvailability.reason}
          onClick={() => void executeCommand('selection.ungroup', { groupIds: context.selectedGroupIds })}
        >
          <Ungroup className="size-3.5" /> Ungroup
        </Button>
      )}

      <Popover
        open={wrapOpen}
        onOpenChange={(open) => {
          setWrapOpen(open);
          if (!open) setWrapError(null);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            data-testid="selection-wrap-btn"
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 pointer-coarse:h-11 gap-1.5 text-xs"
            disabled={!wrapAvailability.enabled}
            title={wrapAvailability.enabled ? undefined : wrapAvailability.reason}
          >
            <BoxSelect className="size-3.5" /> Wrap in boundary
          </Button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-64 p-0 overflow-hidden rounded-popover border border-border shadow-popover">
          <form
            data-testid="selection-wrap-popover"
            onSubmit={(event) => {
              event.preventDefault();
              void submitWrap();
            }}
          >
            <div className="px-3 py-2 bg-panel border-b border-hairline font-mono text-meta font-medium text-secondary-text uppercase">
              WRAP IN BOUNDARY
            </div>
            <div className="p-3 bg-background">
              <label className="block text-xs font-medium text-ink mb-1.5" htmlFor="selection-wrap-label">
                Boundary name
              </label>
              <Input
                id="selection-wrap-label"
                data-testid="selection-wrap-input"
                autoFocus
                value={wrapLabel}
                placeholder="Name this boundary…"
                onChange={(event) => {
                  setWrapLabel(event.target.value);
                  setWrapError(null);
                }}
              />
              {wrapError && <p role="alert" className="mt-1.5 text-xs text-risk-text">{wrapError}</p>}
            </div>
            <div className="px-3 py-2 bg-panel border-t border-hairline flex justify-end">
              <Button type="submit" size="sm" variant="tint" disabled={wrapLabel.trim().length === 0}>
                Wrap
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

      {expansionPayload && expansionAvailability && (
        <Button
          data-testid="selection-expansion-btn"
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 pointer-coarse:h-11 gap-1.5 text-xs"
          disabled={!expansionAvailability.enabled}
          title={expansionAvailability.enabled ? undefined : expansionAvailability.reason}
          onClick={() => void executeCommand(expansionCommand, expansionPayload)}
        >
          {targetExpanded ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
          {targetExpanded ? 'Collapse' : 'Expand'}
        </Button>
      )}




      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button data-testid="selection-align-btn" type="button" variant="ghost" size="sm" className="h-8 gap-1 text-xs">
            Align <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-0 overflow-hidden">
          <DropdownMenuHeader className="px-3 py-2 text-secondary-text">ALIGN & DISTRIBUTE</DropdownMenuHeader>
          <div className="p-1.5 bg-background">
            <DropdownMenuLabel className="font-mono text-meta font-medium text-secondary-text uppercase px-2.5 py-1">Align</DropdownMenuLabel>
            {alignItems.map(([edge, label]) => {
              const availability = getAvailability('selection.align', context, { edge });
              return (
                <DropdownMenuItem
                  key={edge}
                  data-testid={`selection-align-${edge}`}
                  disabled={!availability.enabled}
                  title={availability.enabled ? undefined : availability.reason}
                  onSelect={() => void executeCommand('selection.align', { edge })}
                  className="text-[13px] gap-2.5 px-2.5 py-1.5 rounded-control"
                >
                  <span>{label}</span>
                  {!availability.enabled && <span className="ml-auto text-[10px]">{availability.reason}</span>}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuLabel className="font-mono text-meta font-medium text-secondary-text uppercase px-2.5 py-1">Distribute</DropdownMenuLabel>
            {distributeItems.map(([axis, label]) => {
              const availability = getAvailability('selection.distribute', context, { axis });
              return (
                <DropdownMenuItem
                  key={axis}
                  data-testid={`selection-distribute-${axis}`}
                  disabled={!availability.enabled}
                  title={availability.enabled ? undefined : availability.reason}
                  onSelect={() => void executeCommand('selection.distribute', { axis })}
                  className="text-[13px] gap-2.5 px-2.5 py-1.5 rounded-control"
                >
                  <span>{label}</span>
                  {!availability.enabled && <span className="ml-auto text-[10px]">{availability.reason}</span>}
                </DropdownMenuItem>
              );
            })}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        data-testid="selection-duplicate-btn"
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 pointer-coarse:size-11 shrink-0"
        aria-label="Duplicate selection"
        disabled={!duplicateAvailability.enabled}
        title={duplicateAvailability.enabled ? undefined : duplicateAvailability.reason}
        onClick={() => void executeCommand('selection.duplicate', {})}
      >
        <Copy className="size-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            data-testid="selection-overflow-btn"
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 pointer-coarse:size-11 shrink-0"
            aria-label="More selection actions"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-0 overflow-hidden">
          <DropdownMenuHeader className="px-3 py-2 text-secondary-text">SELECTION ACTIONS</DropdownMenuHeader>
          <div className="p-1.5 bg-background space-y-0.5">
            {OVERFLOW_PRIMARY.map((item) => overflowItem(item))}
          </div>
          <DropdownMenuFooter className="p-1.5 bg-panel border-t border-hairline">
            {OVERFLOW_SECONDARY.map((item) => overflowItem(item))}
          </DropdownMenuFooter>
        </DropdownMenuContent>
      </DropdownMenu>
      {overflowError ? (
        <p
          role="alert"
          data-testid="selection-overflow-error"
          className="absolute left-0 right-0 top-full mt-1.5 rounded-control border border-risk-edge bg-panel px-2 py-1 text-xs text-risk-text shadow-raised"
        >
          {overflowError}
        </p>
      ) : null}

      <div className="w-[1px] h-6 bg-divider mx-0.5" />

<Button
        data-testid="selection-delete-btn"
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 pointer-coarse:size-11 shrink-0 text-destructive hover:text-destructive"
        aria-label="Delete selection"
        disabled={!deleteAvailability.enabled}
        title={deleteAvailability.enabled ? undefined : deleteAvailability.reason}
        onClick={() => void executeCommand('selection.delete', {})}
      >
        <Trash2 className="size-4" />
      </Button>
      
    </div>
  );
}
