import * as React from "react";
import { cn } from "@/lib/utils";

export interface AvatarStackProps extends React.HTMLAttributes<HTMLDivElement> {
  people?: string[];
  overflow?: number;
  label?: React.ReactNode;
}

const AVATAR_COLORS = [
  "bg-primary text-primary-foreground",
  "bg-purple text-[#FBFAF7]",
  "bg-[#E2DED6] text-body",
];

export const AvatarStack = React.forwardRef<HTMLDivElement, AvatarStackProps>(
  ({ className, people = [], overflow, label, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="avatar-stack"
        className={cn("flex items-center gap-2.5 font-sans select-none", className)}
        {...props}
      >
        <div className="flex items-center">
          {people.map((initials, index) => {
            const colorClass = AVATAR_COLORS[index % AVATAR_COLORS.length];
            return (
              <span
                key={index}
                className={cn(
                  "size-[26px] rounded-full border-2 border-background flex items-center justify-center text-[10.5px] font-semibold leading-none shadow-2xs -ml-2 first:ml-0",
                  colorClass
                )}
              >
                {initials}
              </span>
            );
          })}
          {overflow != null && overflow > 0 && (
            <span
              className="size-[26px] rounded-full border-2 border-background bg-[#E2DED6] text-body flex items-center justify-center text-[10.5px] font-semibold leading-none shadow-2xs -ml-2"
            >
              +{overflow}
            </span>
          )}
        </div>
        {label && (
          <span className="text-xs text-secondary-text truncate leading-none">
            {label}
          </span>
        )}
      </div>
    );
  }
);
AvatarStack.displayName = "AvatarStack";
