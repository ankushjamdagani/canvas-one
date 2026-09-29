import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, placeholder = ' ', ...props }, ref) => {
    // placeholder=' ' lets the :placeholder-shown fill rule (shell at rest, white once filled)
    // work on fields that have no visible placeholder.
    return (
      <input
        type={type}
        data-slot="input"
        className={cn(
          "flex h-8 pointer-coarse:h-11 w-full rounded-control border border-input bg-shell px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground hover:bg-background [&[placeholder]:not(:placeholder-shown)]:bg-background focus-visible:bg-background focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-risk-text focus-visible:aria-invalid:outline-risk-text disabled:cursor-not-allowed disabled:bg-sunken disabled:text-secondary-text disabled:border-control-border",
          className
        )}
        ref={ref}
        placeholder={placeholder}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
