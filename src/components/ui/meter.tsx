import * as React from "react";
import { cn } from "@/lib/utils";

export interface MeterProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  percent?: number;
  readout?: React.ReactNode;
  tone?: "green" | "clay";
}

export const Meter = React.forwardRef<HTMLDivElement, MeterProps>(
  ({ className, label, percent = 0, readout, tone = "green", ...props }, ref) => {
    const clamped = Math.max(0, Math.min(100, percent));
    const toneColor = tone === "clay" ? "bg-clay" : "bg-primary";
    const readoutColor = tone === "clay" ? "text-clay" : "text-body";

    return (
      <div
        ref={ref}
        data-slot="meter"
        className={cn("flex items-center gap-2.5 font-sans text-xs", className)}
        {...props}
      >
        {label && (
          <span className="w-[74px] shrink-0 font-mono text-[9.5px] text-secondary-text truncate tracking-wider">
            {label}
          </span>
        )}
        <div className="relative h-1.5 flex-1 rounded-full bg-sunken overflow-hidden">
          <div
            className={cn("h-full transition-all duration-300", toneColor)}
            style={{ width: `${clamped}%` }}
          />
        </div>
        {readout && (
          <span className={cn("font-mono text-[10px] shrink-0 font-medium", readoutColor)}>
            {readout}
          </span>
        )}
      </div>
    );
  }
);
Meter.displayName = "Meter";
