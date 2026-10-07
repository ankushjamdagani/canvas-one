import { cn } from "@/lib/utils";

/** System Studio logo square. Decorative: pair it with visible text or a labelled control. */
export function BrandMark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={cn("inline-block size-5 shrink-0 rounded-[5px] bg-linear-to-br from-primary to-[#2e7d6b]", className)}
    />
  );
}
