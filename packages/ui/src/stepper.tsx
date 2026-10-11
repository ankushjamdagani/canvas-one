import * as React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "./utils.js";

export interface StepperProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "onChange"> {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange?: (value: number) => void;
}

export const Stepper = React.forwardRef<HTMLSpanElement, StepperProps>(
  (
    {
      className,
      value = 5,
      min = 0,
      max = 100,
      step = 1,
      disabled = false,
      onChange,
      ...props
    },
    ref
  ) => {
    const handleDecrement = () => {
      if (disabled) return;
      const next = Math.max(min, value - step);
      onChange?.(next);
    };

    const handleIncrement = () => {
      if (disabled) return;
      const next = Math.min(max, value + step);
      onChange?.(next);
    };

    return (
      <span
        ref={ref}
        data-slot="stepper"
        className={cn(
          "inline-flex items-center rounded-control border border-border bg-background shadow-2xs overflow-hidden select-none",
          disabled && "cursor-not-allowed opacity-60 bg-sunken",
          className
        )}
        {...props}
      >
        <button
          type="button"
          aria-label="Decrease value"
          disabled={disabled || value <= min}
          onClick={handleDecrement}
          className="flex h-7 w-7 items-center justify-center border-r border-hairline text-body transition-colors hover:bg-sunken active:bg-desk disabled:cursor-not-allowed disabled:text-text-disabled cursor-pointer outline-none focus-visible:bg-sunken"
        >
          <Minus className="size-3" />
        </button>
        <span className="min-w-10 px-2 text-center font-mono text-xs font-medium text-foreground">
          {value}
        </span>
        <button
          type="button"
          aria-label="Increase value"
          disabled={disabled || value >= max}
          onClick={handleIncrement}
          className="flex h-7 w-7 items-center justify-center border-l border-hairline text-body transition-colors hover:bg-sunken active:bg-desk disabled:cursor-not-allowed disabled:text-text-disabled cursor-pointer outline-none focus-visible:bg-sunken"
        >
          <Plus className="size-3" />
        </button>
      </span>
    );
  }
);
Stepper.displayName = "Stepper";
