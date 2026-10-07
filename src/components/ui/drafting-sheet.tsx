import type { ReactNode } from "react";
import { DraftingFrame, DraftingGround } from "./drafting-board";
import "./drafting-sheet.css";

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
    <div className="drafting-sheet">
      <DraftingGround />
      <DraftingFrame />
      <header className="drafting-header">
        <a href="/" className="drafting-brand">
          <span aria-hidden="true" />
          System Studio
        </a>
        <span className="drafting-version">v0.4.12</span>
        <nav aria-label="Main navigation">{navigation}</nav>
      </header>
      {children}
    </div>
  );
}
