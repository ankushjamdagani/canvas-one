import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-normal text-center break-words rounded-md text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-sunken disabled:text-secondary-text disabled:border-control-border [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        default:
          "border border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover active:bg-primary-pressed",
        destructive:
          "border border-transparent bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive-hover active:bg-destructive-hover",
        outline:
          "border border-control-border-strong bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border border-transparent bg-secondary text-secondary-foreground shadow-sm hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-[32px] px-3 py-1.5 pointer-coarse:min-h-[44px]",
        sm: "min-h-[28px] rounded-md px-2.5 py-0.5 text-xs pointer-coarse:min-h-[44px]",
        lg: "min-h-[40px] rounded-md px-6 py-2 pointer-coarse:min-h-[44px]",
        icon: "size-[32px] pointer-coarse:size-[44px]",
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
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
