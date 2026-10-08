import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom typography must not be mistaken for a text color and erase semantic roles.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ['display', 'heading', 'title', 'subtitle', 'ui', 'micro'] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
