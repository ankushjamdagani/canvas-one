import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-tag border px-2 py-0.5 font-mono text-xs uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        // Board tag tones
        neutral: "border-border bg-sunken text-body",
        success: "border-selected-edge bg-accent text-primary",
        accent: "border-selected-edge bg-accent text-primary",
        branch: "border-branch-edge bg-branch-tint text-branch",
        risk: "border-risk-edge bg-risk-tint text-risk-text",
        solid: "border-transparent bg-foreground text-shell",
        count:
          "rounded-full border-transparent bg-primary px-2 py-0.5 font-sans text-xs font-semibold normal-case tracking-normal text-primary-foreground",

        // Legacy aliases retained so existing app usages keep compiling.
        default: "border-selected-edge bg-accent text-primary",
        secondary: "border-border bg-sunken text-body",
        destructive: "border-risk-edge bg-risk-tint text-risk-text",
        outline: "border-border bg-transparent text-foreground",
        amber:
          "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
