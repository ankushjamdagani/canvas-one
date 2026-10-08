import * as React from "react";
import { cn } from "@/lib/utils";

export type LibraryRowState =
  | "rest"
  | "hover"
  | "selected"
  | "dragging"
  | "disabled"
  | "loading";

export interface LibraryRowProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  glyph?: React.ReactNode;
  state?: LibraryRowState;
  trailing?: React.ReactNode;
}

export const LibraryRow = React.forwardRef<HTMLDivElement, LibraryRowProps>(
  (
    {
      className,
      title,
      meta,
      glyph = "⧉",
      state = "rest",
      trailing,
      onClick,
      ...props
    },
    ref
  ) => {
    if (state === "loading") {
      return (
        <div
          ref={ref}
          data-slot="library-row-loading"
          className={cn(
            "flex items-center gap-2.5 rounded-md border border-hairline bg-shell p-2 select-none",
            className
          )}
          {...props}
        >
          <span className="size-[26px] shrink-0 rounded-control bg-sunken" />
          <div className="flex-1 flex flex-col gap-1.5">
            <span className="h-2.5 w-1/2 rounded bg-hairline-soft" />
            <span className="h-2 w-1/3 rounded bg-sunken" />
          </div>
        </div>
      );
    }

    const isSelected = state === "selected";
    const isDragging = state === "dragging";
    const isDisabled = state === "disabled";
    const isAccent = isSelected || isDragging;

    const stateStyles: Record<LibraryRowState, string> = {
      rest: "bg-shell border-hairline hover:bg-background hover:border-border hover:shadow-raised",
      hover: "bg-background border-border shadow-raised",
      selected: "bg-background border-primary shadow-ring-soft",
      dragging: "bg-background border-dashed border-primary shadow-floating -rotate-[0.6deg]",
      disabled: "bg-panel border-hairline-soft cursor-not-allowed opacity-60",
      loading: "",
    };

    return (
      <div
        ref={ref}
        data-slot="library-row"
        data-state={state}
        onClick={isDisabled ? undefined : onClick}
        className={cn(
          "flex items-center gap-2.5 rounded-md border p-2 transition-all font-sans cursor-pointer select-none",
          stateStyles[state],
          className
        )}
        {...props}
      >
        <span
          className={cn(
            "size-[26px] shrink-0 rounded-control flex items-center justify-center text-xs transition-colors",
            isAccent
              ? "bg-accent border border-selected-edge text-accent-foreground"
              : isDisabled
              ? "bg-sunken border border-hairline text-text-disabled"
              : "bg-sunken border border-border text-body"
          )}
        >
          {glyph}
        </span>
        <div className="flex-1 min-w-0">
          <div
            className={cn(
              "text-xs font-semibold truncate leading-tight",
              isDisabled
                ? "text-text-disabled"
                : isDragging
                ? "text-accent-foreground"
                : "text-foreground"
            )}
          >
            {title}
          </div>
          {meta && (
            <div
              className={cn(
                "font-mono text-[9.5px] truncate mt-0.5",
                isDisabled
                  ? "text-text-disabled"
                  : isDragging
                  ? "text-accent-foreground"
                  : "text-secondary-text"
              )}
            >
              {meta}
            </div>
          )}
        </div>
        {trailing}
      </div>
    );
  }
);
LibraryRow.displayName = "LibraryRow";
