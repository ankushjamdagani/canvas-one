import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils.js";

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
        warning:
          "border-warning-edge bg-warning-tint text-warning-text [&>svg]:text-warning",
        info:
          "border-teal-500/50 bg-teal-500/10 text-teal-800 dark:text-teal-200 [&>svg]:text-teal-600",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="alert"
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    data-slot="alert-title"
    className={cn("mb-1 font-medium leading-none", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="alert-description"
    className={cn("text-xs [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export interface InlineAlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: "risk" | "branch" | "done";
  title?: React.ReactNode;
  detail?: React.ReactNode;
  glyph?: React.ReactNode;
}

export function InlineAlert({
  tone = "risk",
  title,
  detail,
  glyph,
  children,
  className,
  ...props
}: InlineAlertProps) {
  const tones = {
    risk: "border-risk-edge border-l-destructive shadow-xs",
    branch: "border-branch-edge border-l-branch",
    done: "border-selected-edge border-l-primary",
  }[tone];

  const spineColors = {
    risk: "text-risk-text",
    branch: "text-branch",
    done: "text-primary",
  }[tone];

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 rounded-lg border border-l-[3px] bg-background p-3 text-sm font-sans transition-colors",
        tones,
        className
      )}
      {...props}
    >
      {glyph && <span className={cn("text-xs font-semibold", spineColors)}>{glyph}</span>}
      <div className="flex-1 min-w-0">
        {title && <div className="text-xs font-semibold text-foreground leading-tight">{title}</div>}
        {detail && <div className="text-xs text-secondary-text mt-0.5 leading-normal">{detail}</div>}
        {children}
      </div>
    </div>
  );
}

export { Alert, AlertTitle, AlertDescription };
