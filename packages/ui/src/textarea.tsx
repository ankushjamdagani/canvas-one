import * as React from "react";
import { cn } from "./utils.js";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, placeholder = ' ', ...props }, ref) => {
    // placeholder=' ' lets the :placeholder-shown fill rule (shell at rest, white once filled)
    // work on fields that have no visible placeholder.
    return (
      <textarea
        data-slot="textarea"
        className={cn(
          "flex min-h-15 w-full rounded-control border border-input bg-shell px-3 py-2 text-base shadow-xs placeholder:text-muted-foreground hover:bg-background [&[placeholder]:not(:placeholder-shown)]:bg-background focus-visible:bg-background focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-risk-text focus-visible:aria-invalid:outline-risk-text disabled:cursor-not-allowed disabled:bg-sunken disabled:text-secondary-text disabled:border-control-border transition-[color,box-shadow]",
          className
        )}
        ref={ref}
        placeholder={placeholder}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
