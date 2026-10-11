import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "./utils.js";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    data-slot="progress"
    value={value}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full border border-control-border bg-sunken",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn(
        "h-full w-full flex-1 bg-primary transition-all",
        "data-[state=indeterminate]:absolute data-[state=indeterminate]:top-0 data-[state=indeterminate]:h-full data-[state=indeterminate]:w-[30%]",
        "data-[state=indeterminate]:animate-progress-indeterminate"
      )}
      style={
        typeof value === "number"
          ? { transform: `translateX(-${100 - (value || 0)}%)` }
          : undefined
      }
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
