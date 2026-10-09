import * as React from "react";
import { usePortalRoot } from "./portal-root";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

function PopoverPortal({ container, ...props }: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Portal>) {
  const root = usePortalRoot();
  return <PopoverPrimitive.Portal container={container ?? root} {...props} />;
}

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(({ ...props }, ref) => (
  <PopoverPrimitive.Trigger ref={ref} data-slot="popover-trigger" {...props} />
));
PopoverTrigger.displayName = PopoverPrimitive.Trigger.displayName;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 6, ...props }, ref) => (
  <PopoverPortal>
    <PopoverPrimitive.Content
      ref={ref}
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-popover w-72 rounded-popover border border-border bg-background p-4 text-foreground shadow-popover outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </PopoverPortal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

const PopoverHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="popover-header"
    className={cn(
      "px-3 py-2.5 bg-panel border-b border-hairline font-mono text-micro font-medium text-secondary-text tracking-wide flex items-center justify-between shrink-0",
      className
    )}
    {...props}
  />
));
PopoverHeader.displayName = "PopoverHeader";

const PopoverBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="popover-body"
    className={cn("p-2.5 bg-background flex-1 overflow-y-auto", className)}
    {...props}
  />
));
PopoverBody.displayName = "PopoverBody";

const PopoverFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="popover-footer"
    className={cn(
      "px-3 py-2 bg-panel border-t border-hairline text-caption text-secondary-text flex items-center justify-between shrink-0",
      className
    )}
    {...props}
  />
));
PopoverFooter.displayName = "PopoverFooter";

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverHeader, PopoverBody, PopoverFooter };
