import { cn } from "@/lib/utils";

/** CanvasOne logo square. Decorative: pair it with visible text or a labelled control. */
export function BrandMark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={cn("inline-block size-5 shrink-0 rounded-[5px]", className)}
      style={{ background: 'var(--brand-mark)', ...props.style }}
    />
  );
}
