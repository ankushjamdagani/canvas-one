import * as React from "react";
import {
  Workflow,
  FolderOpen,
  ChevronDown,
  Check,
  Play,
  Pause,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface TopBarProps {
  projectName: string;
  isReadOnly: boolean;
  projectNameInput: string;
  setProjectNameInput: (name: string) => void;
  onSaveProjectName: () => void;
  projectMenuOpen: boolean;
  onToggleProjectMenu: () => void;
  saved: string;
  simulationRunning: boolean;
  simulationFinished?: boolean;
  simulationTime?: number;
  simulationError?: string | null;
  onToggleSimulation: () => void;
  onResetSimulation: () => void;
  canRun: boolean;
  canReset: boolean;
}

export function TopBar({
  projectName,
  isReadOnly,
  projectNameInput,
  setProjectNameInput,
  onSaveProjectName,
  projectMenuOpen,
  onToggleProjectMenu,
  saved,
  simulationRunning,
  simulationFinished,
  simulationTime,
  onToggleSimulation,
  onResetSimulation,
  canRun,
  canReset,
}: TopBarProps) {
  return (
    <header
      data-testid="topbar"
      className="canvas-first-topbar studio-header experiment-heading"
      role="banner"
    >
      <div className="canvas-first-topbar-row canvas-first-topbar-row-main">
        <div data-testid="brand" className="canvas-first-brand brand">
          <Workflow size={20} />
          <span>
            System studio<span className="brand-dot">.</span>
          </span>
        </div>

        <div className="canvas-first-project-switcher-group">
          <button
            data-testid="project-switch-btn"
            type="button"
            className={`canvas-first-btn subtle project-switch workspace-switch project-menu-btn ${
              projectMenuOpen ? "active" : ""
            }`}
            onClick={onToggleProjectMenu}
            aria-expanded={projectMenuOpen}
            aria-label={projectName}
            title={`Switch or manage projects: ${projectName}`}
          >
            <FolderOpen size={16} />
            <span className="project-switch-name">{projectName}</span>
            <ChevronDown
              size={13}
              className={`project-switch-chevron ${
                projectMenuOpen ? "open" : ""
              }`}
            />
          </button>

          <input
            data-testid="project-name-input"
            aria-label="Project name"
            className="canvas-first-project-name-input"
            value={projectNameInput}
            onChange={(e) => setProjectNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
                onSaveProjectName();
              }
            }}
            onBlur={onSaveProjectName}
            disabled={isReadOnly}
            maxLength={80}
            placeholder="Project name"
            title="Click to rename project"
          />
          {projectNameInput.trim() !== projectName &&
            projectNameInput.trim().length > 0 && (
              <button
                data-testid="project-save-btn"
                type="button"
                className="canvas-first-btn canvas-first-project-save-btn"
                onClick={onSaveProjectName}
                aria-label="Save project name"
                title="Save project name"
                disabled={isReadOnly || !projectNameInput.trim()}
              >
                <Check size={13} />
                <span>Save</span>
              </button>
            )}
        </div>

        <span data-testid="save-status" className="save-status" role="status">
          <span
            className={`save-dot ${saved === "Save failed" ? "failed" : ""}`}
          />
          {saved}
        </span>
      </div>

      <div className="canvas-first-topbar-row canvas-first-topbar-row-tools">
        <button
          data-testid="run-button"
          className="canvas-first-btn primary"
          disabled={!canRun}
          onClick={onToggleSimulation}
        >
          {simulationRunning ? (
            <Pause size={14} />
          ) : (
            <Play size={14} fill="currentColor" />
          )}
          {simulationRunning
            ? "Pause"
            : simulationFinished
              ? "Replay"
              : simulationTime
                ? "Resume"
                : "Run"}
        </button>

        <button
          data-testid="reset-button"
          onClick={onResetSimulation}
          disabled={!canReset}
          className="canvas-first-btn reset-button"
        >
          <RotateCcw size={14} />
          <span>Reset</span>
        </button>
      </div>
    </header>
  );
}
