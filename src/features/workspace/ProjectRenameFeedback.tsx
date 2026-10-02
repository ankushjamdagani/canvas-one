/**
 * 13A rename feedback: the "NAME TAKEN" popover shown under the inline rename
 * input and the "SAVED" notice shown after a successful rename.
 *
 * Both anchor to the breadcrumb chip through `PopoverAnchor` and never take
 * focus, so typing in the rename input and pressing Enter/Esc keep working.
 */

import * as React from 'react';
import { ArrowRight, Check, Undo2 } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

const ROW =
  'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-[13px] text-ink ' +
  'transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:text-secondary-text/60 disabled:hover:bg-transparent';

export interface RenameConflictPopoverProps {
  readonly open: boolean;
  readonly conflictTitle: string;
  readonly currentTitle: string;
  readonly onKeep: () => void;
  readonly onOpenExisting: () => void;
  readonly children: React.ReactNode;
}

/** Keep focus in the rename input while the popover's buttons are pressed. */
const keepInputFocus = (event: React.MouseEvent) => event.preventDefault();

export function RenameConflictPopover({
  open,
  conflictTitle,
  currentTitle,
  onKeep,
  onOpenExisting,
  children,
}: RenameConflictPopoverProps) {
  return (
    <Popover open={open}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        data-testid="rename-name-taken"
        align="start"
        sideOffset={10}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="w-[min(310px,calc(100vw-24px))] p-0 overflow-hidden"
      >
        <div className="px-3.5 pt-3 pb-2.5 border-b border-hairline">
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-secondary-text">
            Renaming project
          </div>
          <p role="alert" className="mt-1 text-[13px] leading-snug text-risk-text">
            Your team already has a project called {conflictTitle}.
          </p>
        </div>
        <div className="p-1.5 flex flex-col gap-0.5">
          <button
            type="button"
            data-testid="rename-keep"
            className={ROW}
            onMouseDown={keepInputFocus}
            onClick={onKeep}
          >
            <Undo2 size={13} className="shrink-0 text-secondary-text" aria-hidden="true" />
            <span className="flex-1 min-w-0 truncate">Keep {currentTitle}</span>
            <Kbd className="text-[10px]">esc</Kbd>
          </button>
          <button
            type="button"
            data-testid="rename-open-existing"
            className={ROW}
            onMouseDown={keepInputFocus}
            onClick={onOpenExisting}
          >
            <ArrowRight size={13} className="shrink-0 text-secondary-text" aria-hidden="true" />
            <span className="flex-1 min-w-0 truncate">Open {conflictTitle}</span>
          </button>
          <button type="button" disabled data-testid="rename-save-disabled" className={ROW}>
            <Check size={13} className="shrink-0" aria-hidden="true" />
            <span className="flex-1">Save name</span>
            <Kbd className="text-[10px] opacity-60">↵</Kbd>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export interface RenamedNoticeProps {
  readonly open: boolean;
  readonly title: string;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
  readonly children: React.ReactNode;
}

export function RenamedNotice({ open, title, onUndo, onDismiss, children }: RenamedNoticeProps) {
  return (
    <Popover open={open} onOpenChange={(next) => !next && onDismiss()}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        data-testid="rename-saved"
        role="status"
        align="start"
        sideOffset={10}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className={cn(
          'w-auto max-w-[min(420px,calc(100vw-24px))] flex items-center gap-2.5 px-3 py-2',
          'rounded-popover border-selected-edge text-[13px] text-ink',
        )}
      >
        <Check size={13} className="shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 truncate">
          Renamed to <strong className="font-semibold">{title}</strong>
        </span>
        <span aria-hidden="true" className="h-4 w-px bg-border shrink-0" />
        <button
          type="button"
          data-testid="rename-undo"
          onClick={onUndo}
          className="shrink-0 text-[13px] font-semibold text-primary hover:text-primary-hover cursor-pointer"
        >
          Undo
        </button>
      </PopoverContent>
    </Popover>
  );
}
