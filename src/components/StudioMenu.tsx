import React, { useState, Suspense, lazy } from "react";
import {
  FolderOpen,
  Plus,
  FilePlus,
  MessageSquare,
  ShoppingCart,
  Cpu,
  Workflow,
  BookmarkPlus,
  GitBranch,
  Download,
  Image,
  Upload,
  BarChart3,
  Info,
  ArrowUpRight,
  Check,
  X,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import type { Project, Checkpoint } from "../domain/model";
import type { SavedRun } from "../domain/results";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import "./workspaceMenu.css";

const RevisionsPanel = lazy(() =>
  import("./RevisionsPanel").then((module) => ({
    default: module.RevisionsPanel,
  })),
);

export interface StudioMenuProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  currentProject: Project;
  editor: {
    checkpoint: (name: string) => boolean;
    restore: (id: string) => void;
  };
  onSwitchProject: (project: Project) => Promise<void>;
  onCreateProject: () => Promise<void>;
  onLoadTemplate: (templateId: "realtime-chat" | "ecommerce-checkout" | "event-processing") => void;
  onOpenExamples: () => void;
  onOpenSavedRuns: () => void;
  onOpenAssumptions: () => void;
  onOpenExportModal: () => void;
  onDownloadJson: () => void;
  onImportJson: () => void;
  savedRuns: SavedRun[];
  isReadOnly: boolean;
  setNotice: (msg: string) => void;
  setError: (msg: string) => void;
}

export function StudioMenu({
  isOpen,
  onClose,
  projects,
  currentProject,
  editor,
  onSwitchProject,
  onCreateProject,
  onLoadTemplate,
  onOpenExamples,
  onOpenSavedRuns,
  onOpenAssumptions,
  onOpenExportModal,
  onDownloadJson,
  onImportJson,
  savedRuns,
  isReadOnly,
  setNotice,
  setError,
}: StudioMenuProps) {
  const [checkpointName, setCheckpointName] = useState("");

  if (!isOpen) return null;

  return (
    <div className="scope-menu-backdrop" onClick={onClose}>
      <section
        data-testid="studio-menu"
        className="scope-menu-card studio-menu-card"
        onClick={(e) => e.stopPropagation()}
        role="region"
        aria-label="Local projects"
      >
        {/* Header */}
        <div className="scope-menu-header">
          <div className="scope-menu-title-group">
            <div className="scope-menu-icon-wrapper">
              <FolderOpen size={18} />
            </div>
            <div className="scope-menu-titles">
              <div className="scope-menu-title-row">
                <h2>{currentProject.name}</h2>
                <Badge variant="secondary" className="scope-menu-badge teal bg-teal-500/15 text-teal-600 dark:text-teal-400 border-0 font-medium">
                  Active System
                </Badge>
              </div>
              <p className="scope-menu-subtitle">
                {currentProject.graph.nodes.length} components · {projects.length} saved systems
              </p>
            </div>
          </div>

          <div className="scope-menu-header-actions">
            <Button
              data-testid="studio-menu-close"
              type="button"
              variant="ghost"
              size="icon"
              className="scope-menu-close-btn h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label="Close projects"
            >
              <X size={16} />
            </Button>
          </div>
        </div>

        <div className="studio-menu-scroll-body">
          {/* Section 1: Switch Project */}
          <div className="scope-menu-section">
            <div className="scope-menu-section-header">
              <span className="scope-menu-section-title">
                <FolderOpen size={13} /> Switch project
              </span>
              <span className="scope-menu-badge">{projects.length} systems</span>
            </div>

            <div className="scope-project-list">
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={`scope-project-item ${p.id === currentProject.id ? "active" : ""}`}
                  onClick={() => onSwitchProject(p)}
                  aria-label={p.name}
                >
                  <div className="scope-project-item-left">
                    <FolderOpen size={16} className="scope-project-item-icon" />
                    <div className="scope-project-item-meta">
                      <strong>{p.name}</strong>
                      <small>
                        {new Date(p.updatedAt).toLocaleDateString()} · {p.graph.nodes.length} components
                      </small>
                    </div>
                  </div>
                  {p.id === currentProject.id ? (
                    <span className="scope-project-active-badge">
                      <Check size={13} /> Current
                    </span>
                  ) : (
                    <ChevronRight size={14} className="scope-project-item-icon" />
                  )}
                </button>
              ))}
            </div>

            <Button
              type="button"
              className="scope-action-btn primary-action w-full justify-center"
              onClick={onCreateProject}
            >
              <Plus size={14} />
              <span>New project</span>
            </Button>
          </div>

          {/* Section 2: Starters & Templates */}
          <div className="scope-menu-section">
            <div className="scope-menu-section-header">
              <span className="scope-menu-section-title">
                <Sparkles size={13} /> Starters & Templates
              </span>
              <span className="scope-menu-badge">Templates</span>
            </div>

            <Button
              type="button"
              variant="outline"
              className="scope-action-btn w-full justify-start"
              onClick={onCreateProject}
            >
              <FilePlus size={14} />
              <span>Blank system</span>
            </Button>

            <div className="scope-template-grid">
              <button
                type="button"
                className="scope-template-card"
                aria-label="Real-time chat"
                onClick={() => onLoadTemplate("realtime-chat")}
                disabled={isReadOnly}
              >
                <div className="scope-template-card-top">
                  <MessageSquare size={15} color="#087f84" />
                  <span className="scope-menu-badge">WebSocket</span>
                </div>
                <span className="scope-template-card-title">Real-time chat</span>
                <span className="scope-template-card-desc">Pub/sub messaging & cache</span>
              </button>

              <button
                type="button"
                className="scope-template-card"
                aria-label="Ecommerce checkout"
                onClick={() => onLoadTemplate("ecommerce-checkout")}
                disabled={isReadOnly}
              >
                <div className="scope-template-card-top">
                  <ShoppingCart size={15} color="#087f84" />
                  <span className="scope-menu-badge">Orders</span>
                </div>
                <span className="scope-template-card-title">Ecommerce checkout</span>
                <span className="scope-template-card-desc">Queued jobs & database</span>
              </button>

              <button
                type="button"
                className="scope-template-card"
                aria-label="Event processing"
                onClick={() => onLoadTemplate("event-processing")}
                disabled={isReadOnly}
              >
                <div className="scope-template-card-top">
                  <Cpu size={15} color="#087f84" />
                  <span className="scope-menu-badge">Stream</span>
                </div>
                <span className="scope-template-card-title">Event processing</span>
                <span className="scope-template-card-desc">Worker pool ingestion</span>
              </button>
            </div>

            <Button
              type="button"
              variant="outline"
              className="scope-action-btn w-full justify-start"
              onClick={onOpenExamples}
              disabled={isReadOnly}
            >
              <Workflow size={14} />
              <span>Examples & tutorials</span>
            </Button>
          </div>

          {/* Section 3: Checkpoints */}
          <div className="scope-menu-section">
            <div className="scope-menu-section-header">
              <span className="scope-menu-section-title">
                <BookmarkPlus size={13} /> Checkpoints options
              </span>
              <span className="scope-menu-badge">{currentProject.checkpoints.length} saved</span>
            </div>

            {currentProject.checkpoints.length ? (
              <div className="scope-checkpoint-list checkpoint-list">
                {currentProject.checkpoints.map((c: Checkpoint) => (
                  <button
                    key={c.id}
                    className="scope-checkpoint-item"
                    disabled={isReadOnly}
                    onClick={() => {
                      editor.restore(c.id);
                      onClose();
                      setNotice(`Restored “${c.name}”.`);
                    }}
                  >
                    <div className="scope-checkpoint-item-left">
                      <span className="scope-checkpoint-dot" />
                      <span>{c.name}</span>
                    </div>
                    <ChevronRight size={13} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="scope-menu-section-desc">Keep a version before trying something new.</p>
            )}

            <fieldset disabled={isReadOnly} style={{ border: "none", padding: 0, margin: 0 }}>
              <form
                className="scope-checkpoint-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (isReadOnly) return;
                  const ok = editor.checkpoint(
                    checkpointName.trim() || `Checkpoint ${currentProject.checkpoints.length + 1}`
                  );
                  if (ok) {
                    setCheckpointName("");
                    setNotice("Checkpoint saved with the current model and settings.");
                  } else {
                    setError("Could not save checkpoint. Maximum limit reached.");
                  }
                }}
              >
                <Input
                  className="scope-checkpoint-input h-9 text-xs"
                  aria-label="Checkpoint name"
                  placeholder="Name this checkpoint"
                  value={checkpointName}
                  onChange={(e) => setCheckpointName(e.target.value)}
                  maxLength={60}
                />
                <Button
                  type="submit"
                  size="sm"
                  className="scope-action-btn primary-action"
                  style={{ width: "auto", flexShrink: 0 }}
                >
                  <BookmarkPlus size={14} />
                  <span>Save checkpoint</span>
                </Button>
              </form>
            </fieldset>
          </div>

          {/* Section 4: Architecture Revisions */}
          <div className="scope-menu-section revisions-group">
            <div className="scope-menu-section-header">
              <span className="scope-menu-section-title">
                <GitBranch size={13} /> Architecture Revisions
              </span>
              <span className="scope-menu-badge">Snapshots</span>
            </div>
            <div className="scope-revisions-wrapper">
              <Suspense fallback={<div className="scope-loading">Loading revisions…</div>}>
                <RevisionsPanel key={currentProject.id} />
              </Suspense>
            </div>
          </div>

          {/* Section 5: Export & Backup */}
          <div className="scope-menu-section">
            <div className="scope-menu-section-header">
              <span className="scope-menu-section-title">
                <Download size={13} /> Export options
              </span>
              <span className="scope-menu-badge">Canvas / JSON</span>
            </div>

            <div className="scope-export-tiles">
              <button
                type="button"
                className="scope-export-tile"
                aria-label="Export canvas"
                onClick={onOpenExportModal}
              >
                <Image size={18} />
                <span>Export canvas</span>
                <small>SVG & PNG</small>
              </button>

              <button
                type="button"
                className="scope-export-tile"
                aria-label="Export JSON"
                onClick={onDownloadJson}
              >
                <Download size={18} />
                <span>Export JSON</span>
                <small>Portable backup</small>
              </button>

              <button
                type="button"
                className="scope-export-tile"
                aria-label="Import JSON"
                onClick={onImportJson}
              >
                <Upload size={18} />
                <span>Import JSON</span>
                <small>Restore backup</small>
              </button>
            </div>
          </div>

          {/* Section 6: Saved Runs */}
          <div className="scope-menu-section">
            <div className="scope-menu-section-header">
              <span className="scope-menu-section-title">
                <BarChart3 size={13} /> Saved runs & comparisons
              </span>
              <span className="scope-menu-badge">{savedRuns.length} runs</span>
            </div>

            <Button
              type="button"
              variant="outline"
              className="scope-action-btn w-full justify-start"
              aria-label="Saved runs"
              onClick={() => {
                onClose();
                onOpenSavedRuns();
              }}
            >
              <BarChart3 size={14} />
              <span>Saved runs</span>
              <Badge variant="secondary" className="scope-menu-badge ml-auto text-[10px] px-1.5 py-0 h-4 font-normal">
                {savedRuns.length}
              </Badge>
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="scope-menu-footer">
          <button
            type="button"
            className="scope-menu-info-btn"
            onClick={onOpenAssumptions}
          >
            <Info size={14} />
            <span>How the model works</span>
            <ArrowUpRight size={12} />
          </button>
        </div>
      </section>
    </div>
  );
}
