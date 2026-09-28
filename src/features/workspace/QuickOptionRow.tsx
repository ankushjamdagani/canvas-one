/**
 * One 14A Quick options row (RV-03q): a registry command with its bound
 * payload. Disabled rows stay visible with their reason (commands.md §1).
 */

import {
  Braces,
  Command as CommandIcon,
  Copy,
  FileCode,
  FolderOpen,
  Group,
  GitBranch,
  History as HistoryIcon,
  Home,
  Image as ImageIcon,
  Library,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Rows3,
  Redo2,
  RotateCcw,
  StickyNote,
  Table2,
  Undo2,
  Ungroup,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Command as CommandPrimitive } from 'cmdk';
import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { formatShortcut, type CommandIconKey, type QuickOption } from './commands/registry';

const ICONS: Readonly<Record<CommandIconKey, LucideIcon>> = {
  command: CommandIcon,
  rename: Pencil,
  projects: FolderOpen,
  branch: GitBranch,
  main: Home,
  run: Play,
  'run-all': ListChecks,
  pause: Pause,
  resume: Play,
  reset: RotateCcw,
  history: HistoryIcon,
  library: Library,
  image: ImageIcon,
  code: FileCode,
  json: Braces,
  table: Table2,
  diagram: Workflow,
  undo: Undo2,
  redo: Redo2,
  duplicate: Copy,
  group: Group,
  ungroup: Ungroup,
  align: Rows3,
  distribute: Workflow,
  note: StickyNote,
};

const BADGE_TEXT: Readonly<Record<NonNullable<QuickOption['badge']>, string>> = {
  current: 'CURRENT',
  main: 'MAIN',
  closed: 'CLOSED',
};

export function QuickOptionRow({
  option,
  isMac,
  onRun,
}: {
  readonly option: QuickOption;
  readonly isMac: boolean;
  readonly onRun: (option: QuickOption) => void;
}) {
  const Icon = ICONS[option.iconKey];
  const reason = option.availability.enabled ? null : option.availability.reason;
  const isBranch = option.id === 'branch.switch';
  const isCurrent = option.badge === 'current';
  // The current branch reads as a "you are here" row (14A), not a greyed-out
  // one; selecting it is a no-op because availability says so.
  const showsReason = reason !== null && !isCurrent;
  return (
    <CommandPrimitive.Item
      value={option.key}
      keywords={[option.label, ...(option.detail ? [option.detail] : []), ...option.keywords]}
      disabled={showsReason}
      onSelect={() => {
        if (reason === null) onRun(option);
      }}
      data-testid={`quick-option-${option.key}`}
      data-command-id={option.id}
      aria-disabled={reason !== null || undefined}
      title={reason ?? undefined}
      className={cn(
        'group flex items-center gap-2.5 min-h-9 px-2.5 py-1.5 rounded-control text-[13px] cursor-pointer select-none outline-none',
        'data-[selected=true]:bg-accent data-[selected=true]:text-primary',
        showsReason && 'cursor-not-allowed text-secondary-text',
        isCurrent && 'cursor-default',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-3.5 shrink-0', isBranch ? 'text-branch' : 'text-secondary-text')}
      />
      <span
        className={cn(
          'font-medium truncate',
          isCurrent && 'text-branch font-semibold',
          'group-data-[selected=true]:font-semibold',
        )}
      >
        {option.label}
      </span>
      {option.detail && <span className="text-secondary-text truncate min-w-0">{option.detail}</span>}
      {option.badge && (
        <Badge
          variant={option.badge === 'current' ? 'branch' : option.badge === 'main' ? 'success' : 'secondary'}
          className="text-[9px] px-1 py-0 h-4 shrink-0 font-mono"
        >
          {BADGE_TEXT[option.badge]}
        </Badge>
      )}
      <span className="ml-auto pl-3 shrink-0 flex items-center">
        {showsReason ? (
          <span
            data-testid="quick-option-reason"
            className="text-[11px] text-secondary-text truncate max-w-[220px]"
          >
            {reason}
          </span>
        ) : option.shortcut ? (
          <Kbd className="text-[10px]">{formatShortcut(option.shortcut, isMac)}</Kbd>
        ) : null}
      </span>
    </CommandPrimitive.Item>
  );
}
