import * as ResizablePrimitive from "react-resizable-panels";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div
          data-slot="resizable-handle-grip"
          className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border border-border bg-sunken"
        >
          <GripVertical className="size-2.5 text-secondary-text" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
