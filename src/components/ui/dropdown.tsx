import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const Dropdown = DropdownMenuPrimitive.Root;

const DropdownTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ ...props }, ref) => (
  <DropdownMenuPrimitive.Trigger
    ref={ref}
    data-slot="dropdown-trigger"
    {...props}
  />
));
DropdownTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;

const DropdownGroup = DropdownMenuPrimitive.Group;
const DropdownPortal = DropdownMenuPrimitive.Portal;
const DropdownSub = DropdownMenuPrimitive.Sub;
const DropdownRadioGroup = DropdownMenuPrimitive.RadioGroup;

/**
 * Standardized Top / Header section for dropdown menus and popovers.
 * Default faded gray background (`bg-panel` #F7F5F1) with hairline border-bottom.
 */
const DropdownHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="dropdown-header"
    className={cn(
      "px-3 py-2.5 border-b border-hairline bg-panel text-xs flex items-center justify-between select-none shrink-0",
      className
    )}
    {...props}
  />
));
DropdownHeader.displayName = "DropdownHeader";

/**
 * Standardized Body section for dropdown menus and popovers.
 * Pure white background (`bg-background` #FFFFFF everywhere) with standard padding.
 */
const DropdownBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="dropdown-body"
    className={cn(
      "bg-background p-1.5 flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto",
      className
    )}
    {...props}
  />
));
DropdownBody.displayName = "DropdownBody";

/**
 * Standardized Bottom / Footer section for dropdown menus and popovers.
 * Default faded gray background (`bg-panel` #F7F5F1) with hairline border-top.
 */
const DropdownFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="dropdown-footer"
    className={cn(
      "px-3 py-2.5 border-t border-hairline bg-panel text-xs flex items-center justify-between select-none shrink-0 mt-auto",
      className
    )}
    {...props}
  />
));
DropdownFooter.displayName = "DropdownFooter";

/**
 * Standardized Dropdown Content shell.
 * Radius: 11px (`rounded-popover`)
 * Border: `border border-border` (#E7E3DB)
 * Shadow: `shadow-popover` (0 18px 32px -16px rgba(22, 32, 29, 0.32))
 * Background: `bg-background` (white) with overflow-hidden
 */
const DropdownContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      data-slot="dropdown-content"
      sideOffset={sideOffset}
      className={cn(
        "z-popover min-w-[12rem] overflow-hidden rounded-popover border border-border bg-background p-0 text-popover-foreground shadow-popover outline-none flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownContent.displayName = DropdownMenuPrimitive.Content.displayName;

const dropdownItemVariants = cva(
  "relative flex cursor-pointer select-none items-center gap-2.5 rounded-control px-2.5 py-2 text-ui font-medium outline-none transition-colors data-[highlighted]:bg-sunken data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-secondary-text",
  {
    variants: {
      variant: {
        default: "text-foreground data-[highlighted]:text-foreground",
        selected: "bg-accent text-accent-foreground font-semibold [&_svg]:text-accent-foreground",
        destructive:
          "text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive [&_svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const DropdownItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> &
    VariantProps<typeof dropdownItemVariants> & {
      inset?: boolean;
    }
>(({ className, inset, variant, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    data-slot="dropdown-item"
    className={cn(
      dropdownItemVariants({ variant }),
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    data-slot="dropdown-sub-trigger"
    className={cn(
      "flex cursor-pointer select-none items-center gap-2.5 rounded-control px-2.5 py-2 text-ui font-medium outline-none transition-colors data-[highlighted]:bg-sunken data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not(.ml-auto)]:size-3.5 [&_svg:not(.ml-auto)]:text-secondary-text data-[state=open]:[&_svg:not(.ml-auto)]:text-accent-foreground",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto size-3 text-secondary-text data-[state=open]:text-primary" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, sideOffset = 6, alignOffset = -5, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    data-slot="dropdown-sub-content"
    sideOffset={sideOffset}
    alignOffset={alignOffset}
    className={cn(
      "z-popover min-w-[12rem] overflow-hidden rounded-popover border border-border bg-background p-1.5 text-popover-foreground shadow-popover outline-none flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
));
DropdownSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

const DropdownShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span
    data-slot="dropdown-shortcut"
    className={cn(
      "ml-auto font-mono text-micro tracking-normal text-secondary-text",
      className
    )}
    {...props}
  />
);
DropdownShortcut.displayName = "DropdownShortcut";

const DropdownSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    data-slot="dropdown-separator"
    className={cn("my-1 h-px bg-hairline-soft shrink-0", className)}
    {...props}
  />
));
DropdownSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    data-slot="dropdown-label"
    className={cn(
      "px-2.5 pt-2 pb-1 font-mono text-micro tracking-[0.12em] font-semibold text-secondary-text select-none",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    data-slot="dropdown-checkbox-item"
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-control py-2 pl-8 pr-2.5 text-ui font-medium outline-none transition-colors data-[highlighted]:bg-sunken data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="size-3.5 text-primary" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    data-slot="dropdown-radio-item"
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-control py-2 pl-8 pr-2.5 text-ui font-medium outline-none transition-colors data-[highlighted]:bg-sunken data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed",
      className
    )}
    {...props}
  >
    <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="size-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

// ============================================================================
// Declarative DropdownMenuPanel API (matching design system Menu.jsx)
// ============================================================================

export interface DropdownMenuItemDef {
  readonly label?: string;
  readonly icon?: React.ReactNode;
  readonly shortcut?: string;
  readonly selected?: boolean;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly divider?: boolean;
  readonly testId?: string;
  readonly onSelect?: () => void;
}

export interface DropdownMenuPanelProps {
  readonly heading?: string;
  readonly header?: React.ReactNode;
  readonly items: readonly DropdownMenuItemDef[];
  readonly footer?: React.ReactNode;
  readonly width?: number | string;
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

/**
 * Declarative Dropdown Menu Panel.
 * Implements standard:
 * - Top / Header with faded gray background
 * - White body section everywhere with consistent 14px icon sizing and spacing
 * - Bottom / Footer with faded gray background
 */
export function DropdownMenuPanel({
  heading,
  header,
  items,
  footer,
  width = 280,
  className,
  style,
}: DropdownMenuPanelProps) {
  return (
    <div
      style={{ width, ...style }}
      className={cn(
        "rounded-popover border border-border bg-background shadow-popover overflow-hidden flex flex-col text-foreground font-sans",
        className
      )}
    >
      {(header || heading) && (
        <DropdownHeader>
          {header ?? (
            <span className="font-mono text-micro tracking-[0.12em] font-semibold text-secondary-text">
              {heading}
            </span>
          )}
        </DropdownHeader>
      )}

      <DropdownBody>
        {items.map((item, idx) => {
          if (item.divider) {
            return <div key={`sep-${idx}`} className="my-1 h-px bg-hairline-soft shrink-0" />;
          }

          const variantClass = item.danger
            ? "text-destructive hover:bg-destructive/10"
            : item.selected
            ? "bg-accent text-accent-foreground font-semibold [&_svg]:text-accent-foreground"
            : "text-foreground hover:bg-sunken";

          return (
            <div
              key={`item-${idx}`}
              data-testid={item.testId}
              role="menuitem"
              tabIndex={item.disabled ? -1 : 0}
              onClick={!item.disabled ? item.onSelect : undefined}
              onKeyDown={
                !item.disabled && item.onSelect
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        item.onSelect?.();
                      }
                    }
                  : undefined
              }
              className={cn(
                "relative flex cursor-pointer select-none items-center gap-2.5 rounded-control px-2.5 py-2 text-ui font-medium outline-none transition-colors",
                item.disabled && "pointer-events-none opacity-50 cursor-not-allowed",
                variantClass
              )}
            >
              {item.icon && <span className="shrink-0 [&>svg]:size-3.5">{item.icon}</span>}
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut && (
                <span className="ml-auto font-mono text-micro text-secondary-text">{item.shortcut}</span>
              )}
              {item.selected && !item.shortcut && (
                <Check className="ml-auto size-3.5 text-primary shrink-0" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </DropdownBody>

      {footer && <DropdownFooter>{footer}</DropdownFooter>}
    </div>
  );
}

export {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownHeader,
  DropdownBody,
  DropdownFooter,
  DropdownItem,
  DropdownShortcut,
  DropdownCheckboxItem,
  DropdownRadioItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownGroup,
  DropdownPortal,
  DropdownSub,
  DropdownSubContent,
  DropdownSubTrigger,
  DropdownRadioGroup,
};
