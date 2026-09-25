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
      className={`w-72 sm:w-80 rounded-xl border border-[var(--color-border,#E7E3DB)] bg-[var(--color-panel,#F7F5F1)] p-4 shadow-[0_18px_32px_-16px_rgba(22,32,29,0.32)] text-[var(--color-foreground,#16201D)] font-sans ${className ?? ''}`}
      data-testid="entry-detail-card"
    >
      {/* Category / Group header + STANDARD badge */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span
          className="text-[10.5px] font-mono font-medium uppercase tracking-widest text-[var(--color-secondary-text,#626D68)]"
          style={detail.stripeColor ? { color: detail.stripeColor } : undefined}
        >
          {detail.group.toUpperCase()}
        </span>
        <span className="text-[10px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--color-primary,#0B5C54)]/40 text-[var(--color-primary,#0B5C54)] bg-[var(--color-accent,#EAEFEC)]/60">
          {detail.badge}
        </span>
      </div>

      {/* Entry Title */}
      <h3 className="text-base font-semibold text-[var(--color-foreground,#16201D)] mb-2">
        {detail.label}
      </h3>

      {/* models (what this entry actually simulates) */}
      <p className="text-xs text-[var(--color-body,#4A544F)] leading-relaxed mb-3">
        {detail.models}
      </p>

      {/* DEFAULTS row */}
      <div className="border-t border-[var(--color-border,#E7E3DB)]/80 pt-2.5 mb-2.5">
        <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-secondary-text,#626D68)] mb-1">
          DEFAULTS
        </div>
        <div className="text-xs font-mono text-[var(--color-body,#4A544F)] break-words">
          {detail.defaults}
        </div>
      </div>

      {/* DOES NOT MODEL row */}
      <div className="border-t border-[var(--color-border,#E7E3DB)]/80 pt-2.5 mb-3">
        <div className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-secondary-text,#626D68)] mb-1">
          DOES NOT MODEL
        </div>
        <div className="text-xs text-[var(--color-body,#4A544F)] leading-relaxed">
          {detail.doesNotModel}
        </div>
      </div>

      {/* Footer shortcut hints */}
      <div className="border-t border-[var(--color-border,#E7E3DB)]/80 pt-2 flex items-center justify-between text-[11px] font-mono text-[var(--color-secondary-text,#626D68)]">
        <span>↵ place · drag to position</span>
      </div>
    </div>
  );
}
