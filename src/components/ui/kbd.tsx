import * as React from "react";
import { cn } from "@/lib/utils";

const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => {
    return (
      <kbd
        ref={ref}
        data-slot="kbd"
        className={cn(
          "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-sm border border-control-border bg-shell px-1 font-mono text-xs font-medium text-secondary-text select-none [&_svg]:size-3 [&_svg]:shrink-0",
          className
        )}
        {...props}
      />
    );
  }
);
Kbd.displayName = "Kbd";

const KbdGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
});
KbdGroup.displayName = "KbdGroup";

export { Kbd, KbdGroup };
