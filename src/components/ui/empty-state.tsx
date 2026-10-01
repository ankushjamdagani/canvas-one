import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  glyph?: React.ReactNode;
  title: React.ReactNode;
  detail?: React.ReactNode;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, glyph = "⊞", title, detail, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="empty-state"
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-node border border-dashed border-border bg-transparent p-6 text-center select-none",
          className
        )}
        {...props}
      >
        {glyph && (
          <span className="text-xl text-[#C0C6C1] mb-0.5 leading-none">
            {glyph}
          </span>
        )}
        <h4 className="text-xs font-semibold text-foreground leading-tight">
          {title}
        </h4>
        {detail && (
          <p className="max-w-[240px] text-xs text-secondary-text leading-relaxed">
            {detail}
          </p>
        )}
        {children && <div className="mt-2">{children}</div>}
      </div>
    );
  }
);
EmptyState.displayName = "EmptyState";
