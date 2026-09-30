import * as React from 'react';
import { cn } from '../../lib/utils';
import type { ScenarioIssue } from './types';

export interface CompactRowProps {
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly summary: React.ReactNode;
  readonly issues?: readonly ScenarioIssue[];
  readonly children: React.ReactNode;
}

export function CompactRow({ isExpanded, onToggle, summary, issues = [], children }: CompactRowProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isExpanded) {
      e.stopPropagation();
      onToggle();
    }
  };

  const hasError = issues.some(i => i.severity === 'error');
  const hasWarning = issues.some(i => i.severity === 'warning');

  const statusClass = hasError ? 'text-risk-text' : hasWarning ? 'text-warning-text' : 'text-foreground';

  return (
    <div 
      className={cn("rounded-control border bg-panel overflow-hidden", isExpanded ? "border-primary" : "border-control-border")}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className={cn(
          "w-full text-left px-3 py-2 text-[11px] font-medium flex items-center justify-between",
          statusClass,
          isExpanded ? "bg-background border-b border-control-border" : "hover:bg-background"
        )}
      >
        <span>{summary}</span>
        {!isExpanded && issues.length > 0 && (
          <span className="text-risk-text font-normal">
            {issues[0].message} {issues.length > 1 ? `(+${issues.length - 1} more)` : ''}
          </span>
        )}
      </button>
      {isExpanded && (
        <div className="p-3">
          {children}
        </div>
      )}
    </div>
  );
}
