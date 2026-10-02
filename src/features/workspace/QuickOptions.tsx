/**
 * 14A Quick options (RV-03q).
 *
 * Matches specs/revamp/screens/14A_Quick_options_open.png and
 * 14A_Rename_inside_quick_options.png over the command registry
 * (commands.md §1): every row is a registry command with its bound payload,
 * disabled rows show their reason, and selecting a row goes through the
 * caller's `onRun` (the workspace's `executeCommand`).
 *
 * Left out per design-revalidation.md §2 and commands.md §1: ⌘K and the other
 * ⌘-letter hints (Quick options opens with F2 or the top-bar button), Duplicate
 * project, Project settings, New branch from here, "Tab stay open", parts in
 * search, team availability copy and branch ahead/behind/author metadata (no
 * contracted source for it).
 */

import * as React from 'react';
import { Command as CommandIcon } from 'lucide-react';
import { Command as CommandPrimitive } from 'cmdk';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { QuickOption, QuickOptionGroup } from './commands/registry';
import { QuickOptionRow } from './QuickOptionRow';
import { QuickOptionsRename, type RenameOutcome } from './QuickOptionsRename';
import { QuickOptionsTextStep, type TextStepKind, type TextStepOutcome } from './QuickOptionsTextStep';

export type { RenameOutcome } from './QuickOptionsRename';

export interface QuickOptionsContentProps {
  readonly groups: readonly QuickOptionGroup[];
  readonly projectTitle: string;
  readonly branchLabel: string;
  readonly isMac: boolean;
  readonly mode: 'list' | 'rename' | TextStepKind;
  readonly onRun: (option: QuickOption) => void;
  readonly onRename: (title: string) => Promise<RenameOutcome>;
  readonly onTextCommand: (kind: TextStepKind, value: string) => Promise<TextStepOutcome>;
  readonly onBack: () => void;
}

const GROUP_HEADING_CLASSES =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 ' +
  '[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase ' +
  '[&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-secondary-text';

/**
 * cmdk's default filter is a loose subsequence match ("note" matches any row
 * whose text has n, o, t, e in order). Quick options match whole words
 * instead: every query word must start a word in the row's label, detail or
 * keywords, with label hits ranked first.
 */
export function quickOptionFilter(_value: string, search: string, keywords?: readonly string[]): number {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const [label = '', ...rest] = keywords ?? [];
  const startsWord = (text: string, word: string) =>
    text.toLowerCase().split(/[^a-z0-9]+/).some((part) => part.startsWith(word));
  let score = 0;
  for (const word of words) {
    if (startsWord(label, word)) score += 1;
    else if (rest.some((text) => startsWord(text, word))) score += 0.5;
    else return 0;
  }
  return score / words.length;
}

/** Dialog body; rendered on its own in tests (no portal). */
export function QuickOptionsContent({
  groups,
  projectTitle,
  branchLabel,
  isMac,
  mode,
  onRun,
  onRename,
  onTextCommand,
  onBack,
}: QuickOptionsContentProps) {
  if (mode === 'rename') {
    return <QuickOptionsRename projectTitle={projectTitle} onRename={onRename} onBack={onBack} />;
  }
  if (mode !== 'list') {
    return <QuickOptionsTextStep kind={mode} onSubmit={(value) => onTextCommand(mode, value)} onBack={onBack} />;
  }
  // Disabled rows stay visible with their reason; cmdk skips them for
  // keyboard selection, so the first enabled row starts highlighted.
  return (
    <CommandPrimitive label="Quick options" loop filter={quickOptionFilter} className="flex flex-col min-w-0 bg-background">
      <div className="flex items-center gap-3 px-4 h-14 border-b border-border bg-shell">
        <CommandIcon className="size-4 text-secondary-text shrink-0" aria-hidden="true" />
        <CommandPrimitive.Input
          autoFocus
          data-testid="quick-options-input"
          data-slot="quick-options-input"
          placeholder="Search actions and branches…"
          className="flex-1 min-w-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-secondary-text"
        />
        <span
          data-testid="quick-options-context"
          className="hidden sm:flex items-center gap-1 h-6 px-2 rounded-control border border-control-border bg-panel text-[11px] font-semibold shrink-0 max-w-[45%] overflow-hidden"
        >
          <span className="text-ink truncate">{projectTitle}</span>
          <span className="text-secondary-text" aria-hidden="true">
            /
          </span>
          <span className="text-branch truncate">{branchLabel}</span>
        </span>
      </div>
      <CommandPrimitive.List
        data-testid="quick-options-list"
        className="max-h-[min(460px,60vh)] overflow-y-auto overflow-x-hidden px-2 py-1.5"
      >
        <CommandPrimitive.Empty className="py-8 text-center text-xs text-secondary-text">
          No matching actions
        </CommandPrimitive.Empty>
        {groups.map((group) => (
          <CommandPrimitive.Group
            key={group.group}
            data-testid={`quick-options-group-${group.group}`}
            heading={
              <span className="flex items-center gap-2">
                <span>{group.label}</span>
                <span aria-hidden="true" className="flex-1 h-px bg-border" />
                {group.group === 'branch' && <span>{group.options.length}</span>}
              </span>
            }
            className={cn('pb-1', GROUP_HEADING_CLASSES)}
          >
            {group.options.map((option) => (
              <QuickOptionRow key={option.key} option={option} isMac={isMac} onRun={onRun} />
            ))}
          </CommandPrimitive.Group>
        ))}
      </CommandPrimitive.List>
      <div className="flex items-center justify-between gap-3 px-4 h-9 border-t border-border bg-shell font-mono text-[11px] text-secondary-text">
        <span className="flex items-center gap-4">
          <span>↑↓ move</span>
          <span>↵ select</span>
        </span>
        <span>esc close</span>
      </div>
    </CommandPrimitive>
  );
}

export interface QuickOptionsDialogProps extends Omit<QuickOptionsContentProps, 'mode' | 'onBack'> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function QuickOptionsDialog({ open, onOpenChange, onRun, ...content }: QuickOptionsDialogProps) {
  const [mode, setMode] = React.useState<'list' | 'rename' | TextStepKind>('list');
  // The dialog is controlled with no trigger (⌘K or the top-bar button), so Radix has
  // nothing to return focus to. Remember what had focus when it opened, during render,
  // because the dialog's own autofocus runs before this component's effects.
  const returnFocusTo = React.useRef<HTMLElement | null>(null);
  const wasOpen = React.useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;

  React.useEffect(() => {
    if (open) setMode('list');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="quick-options"
        hideClose
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          // A command may have moved focus on purpose (a panel opening); keep that.
          const active = document.activeElement;
          if (active && active !== document.body) return;
          const target = returnFocusTo.current?.isConnected
            ? returnFocusTo.current
            : document.querySelector<HTMLElement>('[data-testid="topbar-quick-options-btn"]');
          target?.focus();
        }}
        onEscapeKeyDown={(e) => {
          // Escape inside a nested text step goes back to the list first.
          if (mode !== 'list') {
            e.preventDefault();
            setMode('list');
          }
        }}
        className={cn(
          'top-[max(64px,14vh)] translate-y-0 data-[state=open]:slide-in-from-top-2 data-[state=closed]:slide-out-to-top-2',
          'w-[calc(100vw-32px)] max-w-[660px] p-0 gap-0 overflow-hidden flex flex-col',
          'rounded-popover sm:rounded-[11px] border border-border bg-background shadow-popover',
        )}
      >
        <DialogTitle className="sr-only">Quick options</DialogTitle>
        <DialogDescription className="sr-only">
          Search and run project, branch, run, history and export actions.
        </DialogDescription>
        <QuickOptionsContent
          {...content}
          mode={mode}
          onRun={(option) => {
            if (option.id === 'project.rename') {
              setMode('rename');
              return;
            }
            if (option.id === 'selection.group') {
              setMode('group');
              return;
            }
            if (option.id === 'canvas.add-note') {
              setMode('note');
              return;
            }
            if (option.id === 'history.commit') {
              setMode('commit');
              return;
            }
            onOpenChange(false);
            onRun(option);
          }}
          onBack={() => setMode('list')}
        />
      </DialogContent>
    </Dialog>
  );
}
