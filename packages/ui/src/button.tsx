import * as React from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-normal text-center break-words rounded-control transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default:
          "font-semibold border border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover active:bg-primary-pressed focus-visible:shadow-ring-strong disabled:bg-hairline disabled:text-[#A3ABA6] disabled:border-transparent",
        destructive:
          "font-semibold border border-transparent bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive-hover active:bg-destructive-hover focus-visible:shadow-ring-danger disabled:bg-hairline disabled:text-[#A3ABA6] disabled:border-transparent",
        outline:
          "font-medium border border-control-border-strong bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground disabled:bg-panel disabled:text-secondary-text disabled:border-hairline",
        secondary:
          "font-semibold border border-hover-border bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary-hover hover:border-border-pressed active:bg-secondary-pressed active:border-border-pressed focus-visible:border-primary disabled:bg-panel disabled:text-secondary-text disabled:border-hairline",
        tint:
          "font-medium border border-selected-edge bg-accent text-accent-foreground hover:bg-tint-hover hover:border-tint-hover-edge active:bg-tint-pressed active:text-accent-foreground focus-visible:border-primary disabled:bg-panel disabled:text-secondary-text disabled:border-hairline",
        ghost:
          "font-medium text-body hover:bg-sunken hover:text-foreground active:bg-desk disabled:bg-transparent disabled:text-secondary-text disabled:border-transparent",
        link: "font-medium text-primary underline-offset-4 hover:underline disabled:text-secondary-text",
      },
      size: {
        default: "min-h-8 px-4 py-1 text-base pointer-coarse:min-h-11",
        sm: "min-h-7 px-3 py-0.5 text-xs rounded-sm pointer-coarse:min-h-11",
        lg: "min-h-10 px-5 py-1.5 text-base rounded-md pointer-coarse:min-h-11",
        icon: "size-8 pointer-coarse:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner before the label, sets aria-busy, and disables interaction while true. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = Boolean(disabled) || loading;
    return (
      <Comp
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        aria-busy={loading || undefined}
        {...(asChild
          ? { "aria-disabled": isDisabled || undefined }
          : { disabled: isDisabled })}
        {...props}
      >
        {loading && (
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-full border-2 border-current/25 border-t-current animate-spin motion-reduce:animate-none"
          />
        )}
        {/* Slottable lets the spinner render inside an asChild element too. */}
        {asChild ? <Slottable>{children}</Slottable> : children}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
