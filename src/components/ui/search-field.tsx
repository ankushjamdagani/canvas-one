import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value?: string;
  placeholder?: string;
  active?: boolean;
  shortcut?: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
}

export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  (
    {
      className,
      value = "",
      placeholder = "Search the library",
      active,
      shortcut = "P",
      disabled,
      onChange,
      onClear,
      ...props
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = React.useState(false);
    const isActive = active || isFocused;

    return (
      <div
        data-slot="search-field"
        className={cn(
          "flex items-center gap-2 rounded-control border bg-panel px-2.5 py-1.5 text-xs transition-colors",
          isActive
            ? "border-ring bg-background shadow-ring-soft"
            : "border-border hover:border-hover-border",
          disabled && "cursor-not-allowed bg-sunken border-hairline opacity-60",
          className
        )}
      >
        <Search
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 transition-colors",
            isActive ? "text-primary" : "text-secondary-text"
          )}
        />
        <input
          ref={ref}
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none border-none p-0 disabled:cursor-not-allowed"
          {...props}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onClear?.();
            }}
            className="text-secondary-text hover:text-foreground cursor-pointer rounded p-0.5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X className="size-3" />
          </button>
        ) : shortcut ? (
          <span className="font-mono text-[9.5px] text-muted-foreground select-none">
            {shortcut}
          </span>
        ) : null}
      </div>
    );
  }
);
SearchField.displayName = "SearchField";
