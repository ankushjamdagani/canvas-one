import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DraftingFrame, DraftingGround } from "./drafting-board";

/** Shared public-page chrome, separate from the workspace's canvas and telemetry. */
export function DraftingSheet({
  children,
  page,
  navigation,
}: {
  children: ReactNode;
  page: string;
  navigation?: ReactNode;
}) {
  return (
    <div
      data-page={page}
      className="relative isolate flex min-h-svh flex-col bg-shell px-6 pt-6 pb-11 font-sans text-ink min-[481px]:px-10 min-[481px]:pt-9 min-[481px]:pb-[76px] min-[1101px]:px-14"
    >
      <DraftingGround />
      <DraftingFrame />
      <header className="flex h-10 flex-none items-center gap-3">
        <a
          href="/"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-sm text-sm font-semibold text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary "
        >
          <span
            aria-hidden="true"
            className="size-5 rounded-[5px] bg-linear-to-br from-primary to-[#2e7d6b]"
          />
          System Studio
        </a>
        <span className="font-mono text-micro tracking-normal text-secondary-text max-[480px]:hidden">
          v0.4.12
        </span>
        <nav
          aria-label="Main navigation"
          className="ml-auto flex items-center gap-2 min-[481px]:gap-4"
        >
          {navigation}
        </nav>
      </header>
      {children}
    </div>
  );
}

/** Vertical rule between header navigation items. */
export function DraftingNavDivider() {
  return (
    <span
      aria-hidden="true"
      className="h-5 w-px bg-border max-[480px]:hidden"
    />
  );
}

/** Round workspace-owner mark shown at the end of the header navigation. */
export function DraftingAvatar({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      {...props}
      className={cn(
        "grid size-7 place-items-center rounded-full border-2 border-background bg-primary text-micro font-semibold tracking-normal text-white ring-1 ring-border",
        className,
      )}
    />
  );
}

/** Page body: fills the sheet below the header. */
export function DraftingMain({
  className,
  ...props
}: React.ComponentProps<"main">) {
  return (
    <main
      {...props}
      className={cn(
        "mx-auto mt-7 flex w-full max-w-[1232px] flex-1 flex-col gap-6 min-[481px]:mt-10 min-[481px]:gap-10",
        className,
      )}
    />
  );
}

/** Serif page title; wrap the italic tail in <em>. */
export function DraftingHeading({
  className,
  ...props
}: React.ComponentProps<"h1">) {
  return (
    <h1
      {...props}
      className={cn(
        "font-display text-3xl font-light text-balance tracking-normal [&_em]:text-primary [&_em]:italic max-[480px]:[&_em]:block min-[800px]:text-4xl",
        className,
      )}
    />
  );
}

/** Empty notice that grows to the remaining sheet height. */
export function DraftingEmpty({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "flex min-h-60 flex-1 flex-col items-center justify-center rounded-xl border border-border bg-background p-8 text-center text-xs text-secondary-text",
        className,
      )}
    />
  );
}
