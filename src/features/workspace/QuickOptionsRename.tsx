/**
 * The nested project.rename step inside Quick options. The hint lines say what
 * rename really checks and changes; there is no team availability copy.
 */

import * as React from 'react';
import { Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { checkProjectTitle } from './commands/registry';

export type RenameOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface QuickOptionsRenameProps {
  readonly projectTitle: string;
  readonly onRename: (title: string) => Promise<RenameOutcome>;
  readonly onBack: () => void;
}

export function QuickOptionsRename({ projectTitle, onRename, onBack }: QuickOptionsRenameProps) {
  const [value, setValue] = React.useState(projectTitle);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const check = checkProjectTitle(value, projectTitle);
  const unchanged = value.trim() === projectTitle;

  async function submit() {
    if (!check.ok || submitting) return;
    setSubmitting(true);
    setError(null);
    const outcome = await onRename(check.title);
    setSubmitting(false);
    if (!outcome.ok) setError(outcome.message);
  }

  return (
    <div data-testid="quick-options-rename" className="bg-background">
      <div className="flex items-center gap-3 px-4 h-14 border-b border-border bg-shell">
        <Badge variant="accent" className="h-6 px-2 gap-1 text-xs font-sans font-semibold normal-case tracking-normal shrink-0">
          <Pencil className="size-3" aria-hidden="true" />
          Rename project
        </Badge>
        <input
          autoFocus
          data-testid="quick-options-rename-input"
          data-slot="quick-options-input"
          aria-label="New project name"
          value={value}
          maxLength={120}
          disabled={submitting}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          className="flex-1 min-w-0 bg-transparent text-[15px] font-medium text-ink outline-none"
        />
        <span className="hidden sm:inline font-mono text-[11px] text-secondary-text shrink-0">
          ↵ rename · esc back
        </span>
      </div>
      <ul className="px-4 py-3 flex flex-col gap-2 text-xs text-body">
        <li data-testid="quick-options-rename-check" className="flex items-center gap-2">
          {error ? (
            <span role="alert" className="text-risk-text">
              {error}
            </span>
          ) : check.ok ? (
            <>
              <span aria-hidden="true" className="text-primary">
                ✓
              </span>
              <span>Enter renames this project</span>
            </>
          ) : (
            <span className={cn(!unchanged && 'text-risk-text')}>{check.reason}</span>
          )}
        </li>
        <li className="flex items-center gap-2 text-secondary-text">
          <span aria-hidden="true">↔</span>
          <span>Branches, checkpoints and saved runs stay the same</span>
        </li>
      </ul>
      <button type="button" className="sr-only" onClick={onBack}>
        Back to quick options
      </button>
    </div>
  );
}
