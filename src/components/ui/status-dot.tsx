import * as React from "react";
import { cn } from "@/lib/utils";

export type StatusDotTone = "live" | "degraded" | "idle" | "branch";

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: StatusDotTone;
  label?: React.ReactNode;
  halo?: boolean;
}

const STATUS_COLORS: Record<StatusDotTone, string> = {
  live: "bg-primary",
  degraded: "bg-clay",
  idle: "bg-[#C0C6C1]",
  branch: "bg-purple",
};

const STATUS_HALOS: Record<StatusDotTone, string> = {
  live: "shadow-[0_0_0_3px_rgba(11,92,84,0.16)]",
  degraded: "shadow-[0_0_0_3px_rgba(180,103,74,0.16)]",
  idle: "shadow-none",
  branch: "shadow-[0_0_0_3px_rgba(125,90,155,0.16)]",
};

export const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ className, status = "live", label, halo = false, ...props }, ref) => {
    const dot = (
      <span
        data-slot="status-dot-circle"
        className={cn(
          "inline-block size-2 shrink-0 rounded-full transition-shadow",
          STATUS_COLORS[status],
          halo && STATUS_HALOS[status]
        )}
      />
    );

    if (!label) {
      return (
        <span
          ref={ref}
          data-slot="status-dot"
          className={cn("inline-flex items-center justify-center", className)}
          {...props}
        >
          {dot}
        </span>
      );
    }

    return (
      <span
        ref={ref}
        data-slot="status-dot"
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium text-foreground",
          className
        )}
        {...props}
      >
        {dot}
        <span>{label}</span>
      </span>
    );
  }
);
StatusDot.displayName = "StatusDot";
