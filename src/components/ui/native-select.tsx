import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NativeSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
}

const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => {
    return (
      <div
        data-slot="native-select-wrapper"
        className={cn("relative w-full", wrapperClassName)}
      >
        <select
          ref={ref}
          data-slot="native-select"
          className={cn(
            "flex h-8 pointer-coarse:h-11 w-full appearance-none rounded-md border border-input bg-background px-3 py-1 pr-8 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-risk-text focus-visible:aria-invalid:outline-risk-text disabled:cursor-not-allowed disabled:bg-sunken disabled:text-secondary-text disabled:border-control-border cursor-pointer select-none",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          data-slot="native-select-icon"
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-secondary-text select-none"
          aria-hidden="true"
        />
      </div>
    );
  }
);
NativeSelect.displayName = "NativeSelect";

const NativeSelectOption = React.forwardRef<
  HTMLOptionElement,
  React.OptionHTMLAttributes<HTMLOptionElement>
>(({ className, ...props }, ref) => (
  <option
    ref={ref}
    data-slot="native-select-option"
    className={cn("bg-background text-foreground", className)}
    {...props}
  />
));
NativeSelectOption.displayName = "NativeSelectOption";

const NativeSelectOptGroup = React.forwardRef<
  HTMLOptGroupElement,
  React.OptgroupHTMLAttributes<HTMLOptGroupElement>
>(({ className, ...props }, ref) => (
  <optgroup
    ref={ref}
    data-slot="native-select-optgroup"
    className={cn("bg-background text-foreground font-semibold", className)}
    {...props}
  />
));
NativeSelectOptGroup.displayName = "NativeSelectOptGroup";

export { NativeSelect, NativeSelectOption, NativeSelectOptGroup };
