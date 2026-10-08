/**
 * DraftBehindMainBanner: a canvas-top banner — "Main has moved on · N conflicts with your
 * edits" / "M versions published since you forked at <version>" with Later / Review and
 * resolve actions.
 *
 * A standalone, presentational component: the app shell decides when to mount it
 * (typically after calling PublishController.prepare() to learn the real conflict count).
 */

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';

export interface DraftBehindMainBannerProps {
  readonly conflictCount: number;
  readonly versionsPublishedSinceFork: number;
  /** The version at the branch's fork point, when it forked after some
   * publication already existed; null when it forked before the first one. */
  readonly forkVersionKey: string | null;
  readonly onLater?: () => void;
  readonly onReviewAndResolve?: () => void;
  readonly className?: string;
}

export function DraftBehindMainBanner({
  conflictCount,
  versionsPublishedSinceFork,
  forkVersionKey,
  onLater,
  onReviewAndResolve,
  className,
}: DraftBehindMainBannerProps): React.JSX.Element {
  return (
    <div
      data-testid="draft-behind-main-banner"
      className={cn(
        'flex items-center justify-between gap-3 rounded-control border border-risk-edge bg-risk-tint px-3 py-2.5',
        className,
      )}
    >
      <div className="flex items-start gap-2 min-w-0">
        <AlertTriangle className="size-4 text-risk-text shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-risk-text truncate">
            Main has moved on · {conflictCount} conflict{conflictCount === 1 ? '' : 's'} with your edits
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {versionsPublishedSinceFork} version{versionsPublishedSinceFork === 1 ? '' : 's'} published since you
            forked{forkVersionKey ? ` at ${forkVersionKey}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onLater && (
          <Button type="button" variant="outline" size="sm" onClick={onLater}>
            Later
          </Button>
        )}
        {onReviewAndResolve && (
          <Button type="button" size="sm" onClick={onReviewAndResolve}>
            Review and resolve
          </Button>
        )}
      </div>
    </div>
  );
}
