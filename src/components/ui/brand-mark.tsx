import { cn } from "@/lib/utils";
import { CanvasOneFace } from './canvas-one-face';

/** Neutral Canvas One logo. Pair it with visible text or a labelled control. */
export function BrandMark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={cn("inline-flex size-[22px] shrink-0 text-ink [&>svg]:size-full", className)}
      style={props.style}
    ><CanvasOneFace expression="base" size={22} animate={false} style={{width:'100%',height:'100%'}} /></span>
  );
}
