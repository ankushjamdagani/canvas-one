/** Generic nested text-entry step for parameterized Quick options commands. */

import * as React from 'react';
import { Bookmark, GitCommitHorizontal, Group, StickyNote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type TextStepKind = 'group' | 'note' | 'commit';

export type TextStepOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

export interface QuickOptionsTextStepProps {
  readonly kind: TextStepKind;
  readonly onSubmit: (value: string) => Promise<TextStepOutcome>;
  readonly onBack: () => void;
}

const DETAILS = {
  group: {
    label: 'Group selection',
    inputLabel: 'Group name',
    placeholder: 'Name this group…',
    maxLength: 80,
    emptyReason: 'Enter a group name',
    verb: 'group',
    Icon: Group,
    hint: 'Creates one presentation group',
  },
  note: {
    label: 'Add note',
    inputLabel: 'Note text',
    placeholder: 'Write a note…',
    maxLength: 4000,
    emptyReason: 'Enter note text',
    verb: 'add',
    Icon: StickyNote,
    hint: 'Places the note at the canvas centre',
  },
  commit: {
    label: 'Commit changes',
    inputLabel: 'Commit message',
    placeholder: 'Describe this commit…',
    maxLength: 4000,
    emptyReason: 'Enter a commit message',
    verb: 'commit',
    Icon: GitCommitHorizontal,
    hint: 'Every scenario must pass on this version to commit',
  },
} as const;

export function QuickOptionsTextStep({ kind, onSubmit, onBack }: QuickOptionsTextStepProps) {
  const details = DETAILS[kind];
  const [value, setValue] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const trimmed = value.trim();
  const reason = trimmed.length === 0
    ? details.emptyReason
    : Array.from(trimmed).length > details.maxLength
      ? `Use ${details.maxLength} characters or fewer`
      : null;

  async function submit() {
    if (reason || submitting) return;
    setSubmitting(true);
    setError(null);
    const outcome = await onSubmit(trimmed);
    setSubmitting(false);
    if (!outcome.ok) setError(outcome.message);
  }

  const Icon = details.Icon;
  return (
    <div data-testid={`quick-options-${kind}`} className="bg-background">
      <div className="flex items-center gap-3 px-4 h-14 border-b border-border bg-shell">
        <Badge variant="accent" className="h-6 px-2 gap-1 text-xs font-sans font-semibold normal-case tracking-normal shrink-0">
          <Icon className="size-3" aria-hidden="true" />
          {details.label}
        </Badge>
        <input
          autoFocus
          data-testid={`quick-options-${kind}-input`}
          data-slot="quick-options-input"
          aria-label={details.inputLabel}
          placeholder={details.placeholder}
          value={value}
          disabled={submitting}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
          className="flex-1 min-w-0 bg-transparent text-[15px] font-medium text-ink outline-none"
        />
        <span className="hidden sm:inline font-mono text-[11px] text-secondary-text shrink-0">
          ↵ {details.verb} · esc back
        </span>
      </div>
      <div className="px-4 py-3 text-xs text-body">
        <span
          role={error ? 'alert' : undefined}
          className={cn((error || (reason && value.length > 0)) && 'text-risk-text')}
        >
          {error ?? reason ?? details.hint}
        </span>
      </div>
      <button type="button" className="sr-only" onClick={onBack}>Back to quick options</button>
    </div>
  );
}
