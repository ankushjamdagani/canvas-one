/**
 * Entry Detail Card (RV-06b / Screen 12C).
 *
 * Implements the hover / focus / detail popover content matching 12C.
 *
 * Specification & Revalidation rules:
 * - specs/revamp/screens/12C_Library_hover_detail.png
 * - specs/revamp/contracts/catalog.md (§5 Library display mapping)
 * - specs/revamp/design-revalidation.md (§2: OUT: Owner, Used in, Platform team / team chips,
 *   "Failures go to", Open docs)
 */

import * as React from 'react';
import type { CatalogEntry } from '../catalog/catalog';
import { getFormattedEntryDetail } from './viewModel';

export interface EntryDetailCardProps {
  readonly entry: CatalogEntry;
  readonly className?: string;
}

export function EntryDetailCard({ entry, className }: EntryDetailCardProps) {
  const detail = getFormattedEntryDetail(entry);

  return (
    <div
      role="region"
      aria-label={`${entry.label} details`}
      className={`w-72 sm:w-80 rounded-popover border border-border bg-background shadow-popover overflow-hidden text-foreground font-sans flex flex-col ${className ?? ''}`}
      data-testid="entry-detail-card"
    >
      {/* Header: Category / Group header + STANDARD badge */}
      <div className="px-3.5 py-2.5 bg-panel border-b border-hairline flex items-center justify-between gap-2 shrink-0">
        <span
          className="text-[10.5px] font-mono font-medium uppercase tracking-widest text-secondary-text"
          style={detail.stripeColor ? { color: detail.stripeColor } : undefined}
        >
          {detail.group.toUpperCase()}
        </span>
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-primary/40 text-primary bg-accent/60">
          {detail.badge}
        </span>
      </div>

      {/* Body: Title, description, models, defaults */}
      <div className="p-3.5 bg-background flex-1">
        {/* Entry Title */}
        <h3 className="text-base font-semibold text-foreground mb-1.5">
          {detail.label}
        </h3>

        {/* models (what this entry actually simulates) */}
        <p className="text-xs text-body leading-relaxed mb-3">
          {detail.models}
        </p>

        {/* DEFAULTS row */}
        <div className="border-t border-hairline pt-2.5 mb-2.5">
          <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-secondary-text mb-1">
            DEFAULTS
          </div>
          <div className="text-xs font-mono text-body break-words">
            {detail.defaults}
          </div>
        </div>

        {/* DOES NOT MODEL row */}
        <div className="border-t border-hairline pt-2.5">
          <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-secondary-text mb-1">
            DOES NOT MODEL
          </div>
          <div className="text-xs text-body leading-relaxed">
            {detail.doesNotModel}
          </div>
        </div>
      </div>

      {/* Footer: shortcut hints */}
      <div className="px-3.5 py-2 bg-panel border-t border-hairline flex items-center justify-between text-[11px] font-mono text-secondary-text shrink-0">
        <span>↵ place · drag to position</span>
      </div>
    </div>
  );
}
