import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-normal text-center break-words rounded-control transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-sunken disabled:text-secondary-text disabled:border-control-border aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default:
          "font-semibold border border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover active:bg-primary-pressed",
        destructive:
          "font-semibold border border-transparent bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive-hover active:bg-destructive-hover",
        outline:
          "font-medium border border-control-border-strong bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "font-semibold border border-hover-border bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary-hover hover:border-border-pressed active:bg-secondary-pressed active:border-border-pressed",
        tint:
          "font-medium border border-selected-edge bg-accent text-primary hover:bg-tint-hover hover:border-tint-hover-edge active:bg-tint-pressed active:text-primary-pressed",
        ghost:
          "font-medium text-body hover:bg-sunken hover:text-foreground active:bg-desk",
        link: "font-medium text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-8 px-4 py-1 text-base pointer-coarse:min-h-11",
        sm: "min-h-7 px-3 py-0.5 text-xs pointer-coarse:min-h-11",
        lg: "min-h-10 px-5 py-1.5 text-base pointer-coarse:min-h-11",
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
        {loading && !asChild && (
          <Loader2
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        )}
        {children}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
