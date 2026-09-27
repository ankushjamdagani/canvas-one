/**
 * PublishedNotice (22D published) — RV-11b review round.
 *
 * specs/revamp/screens/22D_published.png shows a canvas banner: version + "you are
 * now on main", a line about the source branch closing, and an "Undo publish" link.
 * design-revalidation.md §2 explicitly overrides "Undo publish" (D26: publications
 * can't be undone, no undo command exists) — it is never rendered here.
 */

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { PublicationRecord } from '../../persistence/studio';

export interface PublishedNoticeProps {
  readonly publication: Readonly<PublicationRecord>;
  readonly sourceBranchLabel: string | null;
  /** Whether the source branch closed as part of this publish (D29 default: closes). */
  readonly sourceBranchClosed: boolean;
  readonly className?: string;
}

export function PublishedNotice({
  publication,
  sourceBranchLabel,
  sourceBranchClosed,
  className,
}: PublishedNoticeProps): React.JSX.Element {
  return (
    <div
      data-testid="publish-published"
      className={cn(
        'flex items-center gap-2.5 rounded-control border border-primary/40 bg-primary/10 px-3 py-2.5',
        className,
      )}
    >
      <div className="flex items-center justify-center size-7 rounded-full bg-primary/20 text-primary shrink-0">
        <Check className="size-4" strokeWidth={2.5} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">
          {publication.versionKey} published · you are now on main
        </p>
        {sourceBranchLabel && (
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {sourceBranchLabel} {sourceBranchClosed ? 'closed' : 'stays open'}
          </p>
        )}
      </div>
    </div>
  );
}
