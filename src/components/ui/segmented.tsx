import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption {
  id: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  options: (string | SegmentedOption)[];
  value?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}

export const Segmented = React.forwardRef<HTMLDivElement, SegmentedProps>(
  ({ className, options, value, disabled = false, onChange, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="tablist"
        data-slot="segmented-control"
        className={cn(
          "inline-flex items-center gap-0.5 rounded-control border border-border bg-sunken p-0.5 select-none",
          disabled && "cursor-not-allowed opacity-60",
          className
        )}
        {...props}
      >
        {options.map((opt) => {
          const id = typeof opt === "string" ? opt : opt.id;
          const label = typeof opt === "string" ? opt : opt.label;
          const isOptDisabled = disabled || (typeof opt === "object" && Boolean(opt.disabled));
          const isSelected = id === value;

          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              disabled={isOptDisabled}
              onClick={() => !isOptDisabled && onChange?.(id)}
              className={cn(
                "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-all outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer",
                isSelected
                  ? "bg-background text-primary font-semibold shadow-xs"
                  : "text-secondary-text hover:text-foreground bg-transparent",
                isOptDisabled && "cursor-not-allowed text-text-disabled"
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }
);
Segmented.displayName = "Segmented";
