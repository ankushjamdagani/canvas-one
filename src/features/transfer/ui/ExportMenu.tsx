/**
 * Export submenu (screen 18B) for System Studio (RV-10b).
 *
 * Implements specs/revamp/contracts/commands.md §5 ("export.svg / png / mermaid",
 * "export.csv") and parts-and-export.md ("JSON, images and files", "CSV v1",
 * "Mermaid v1"), matching specs/revamp/screens/18B_Export_submenu.png: Diagram as
 * PNG, Diagram as SVG, System as JSON, Run results as CSV, then (below a divider)
 * the Mermaid item.
 *
 * Out of scope (RV-10b task / design-revalidation.md §2): this component is the
 * 18B submenu content only. Mounting it under 18A's header "Export..." row, inside
 * Workspace.tsx/TopBar.tsx, belongs to another lane -- see the "Mounting" doc block
 * below for the props it needs.
 *
 * 18B labels the Mermaid item "Copy as Mermaid", but the contracted Mermaid export
 * (commands.md export.mermaid, parts-and-export.md) is a file download (.mmd), so
 * the item says what it does: "Diagram as Mermaid".
 */

import * as React from 'react';
import { Braces, ChevronRight, Download, FileCode, Image as ImageIcon, Table2, Workflow } from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../../../components/ui/dropdown-menu';
import type { TransferActionResult, TransferActions } from './useTransferActions';
import type { TransferExportKind } from './preconditions';

// ============================================================================
// Mounting (for the lane that owns Workspace.tsx / TopBar.tsx)
// ============================================================================
//
// 1. Build a `TransferSessionState` from the workspace/results session state
//    (projectId, projectRevision, document, active viewId, selected run id).
// 2. `const actions = useTransferActions({ repository, session, mintId, downloadSink: createBrowserDownloadSink() })`
//    (repository/mintId already flow into Workspace.tsx; `createBrowserDownloadSink`
//    and `useTransferActions` are exported from `src/features/transfer`.)
// 3. `<ExportMenu actions={actions} trigger={<YourExportRow />} />` -- pass 18A's
//    existing "Export..." row as `trigger` (with `asChild` semantics: it becomes the
//    dropdown's trigger element), or omit `trigger` to use the built-in default.

export interface ExportMenuProps {
  readonly actions: TransferActions;
  /** Trigger element (e.g. 18A's "Export..." row); defaults to a standalone "Export..." button. */
  readonly trigger?: React.ReactElement;
  readonly align?: 'start' | 'end';
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly sideOffset?: number;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onExported?: (kind: TransferExportKind) => void;
  readonly onExportError?: (kind: TransferExportKind, message: string) => void;
  readonly asSubmenu?: boolean;
}

type ExportMenuItemDef = {
  readonly kind: TransferExportKind;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
  readonly testId: string;
  readonly run: (actions: TransferActions) => Promise<TransferActionResult>;
};

const PRIMARY_ITEMS: readonly ExportMenuItemDef[] = [
  {
    kind: 'png',
    label: 'Diagram as PNG',
    icon: ImageIcon,
    testId: 'export-menu-png',
    run: (actions) => actions.exportPng(),
  },
  {
    kind: 'svg',
    label: 'Diagram as SVG',
    icon: FileCode,
    testId: 'export-menu-svg',
    run: (actions) => actions.exportSvg(),
  },
  {
    kind: 'json',
    label: 'System as JSON',
    icon: Braces,
    testId: 'export-menu-json',
    run: (actions) => actions.exportJson(),
  },
  {
    kind: 'csv',
    label: 'Run results as CSV',
    icon: Table2,
    testId: 'export-menu-csv',
    run: (actions) => actions.exportCsv(),
  },
];

const MERMAID_ITEM: ExportMenuItemDef = {
  kind: 'mermaid',
  label: 'Diagram as Mermaid',
  icon: Workflow,
  testId: 'export-menu-mermaid',
  run: (actions) => actions.exportMermaid(),
};

function ExportItem({
  item,
  actions,
  onExported,
  onExportError,
}: {
  readonly item: ExportMenuItemDef;
  readonly actions: TransferActions;
  readonly onExported?: (kind: TransferExportKind) => void;
  readonly onExportError?: (kind: TransferExportKind, message: string) => void;
}) {
  const reason = actions.getDisabledReason(item.kind);
  const Icon = item.icon;

  async function handleSelect() {
    if (reason) return;
    const result = await item.run(actions);
    if (result.ok) {
      onExported?.(item.kind);
    } else {
      onExportError?.(item.kind, result.message);
    }
  }

  return (
    <DropdownMenuItem
      data-testid={item.testId}
      disabled={!!reason}
      title={reason ?? undefined}
      onSelect={(event) => {
        event.preventDefault();
        void handleSelect();
      }}
    >
      <Icon className="size-3.5 text-secondary-text" aria-hidden="true" />
      <span>{item.label}</span>
    </DropdownMenuItem>
  );
}

export function ExportMenu({
  actions,
  trigger,
  align = 'start',
  side = 'right',
  sideOffset = 6,
  open,
  onOpenChange,
  onExported,
  onExportError,
  asSubmenu = false,
}: ExportMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = open !== undefined;
  const menuOpen = isControlled ? open : uncontrolledOpen;

  function handleOpenChange(next: boolean) {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  React.useEffect(() => {
    const handleDismiss = () => handleOpenChange(false);
    window.addEventListener('studio:dismiss-transients', handleDismiss);
    return () => window.removeEventListener('studio:dismiss-transients', handleDismiss);
  }, []);

  const items = (
    <>
      {PRIMARY_ITEMS.map((item) => (
        <ExportItem
          key={item.kind}
          item={item}
          actions={actions}
          onExported={onExported}
          onExportError={onExportError}
        />
      ))}
      <DropdownMenuSeparator />
      <ExportItem
        item={MERMAID_ITEM}
        actions={actions}
        onExported={onExported}
        onExportError={onExportError}
      />
    </>
  );

  if (asSubmenu) {
    return (
      <DropdownMenuSub open={menuOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuSubTrigger
          data-testid="export-menu-trigger"
        >
          <Download className="size-3.5 text-secondary-text" aria-hidden="true" />
          <span>Export...</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent
          data-testid="export-submenu"
          className="w-56"
        >
          {items}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            data-testid="export-menu-trigger"
            className="w-full flex items-center justify-between gap-2.5 px-2.5 py-1.5 rounded-control text-[13px] text-ink hover:bg-sunken transition-colors text-left cursor-pointer"
          >
            <span className="flex items-center gap-2.5">
              <Download className="size-3.5 text-secondary-text" aria-hidden="true" />
              <span>Export...</span>
            </span>
            <ChevronRight className="size-3.5 text-secondary-text" aria-hidden="true" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-testid="export-submenu"
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="w-56"
      >
        {items}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
