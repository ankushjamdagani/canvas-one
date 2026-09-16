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
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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
    <div className="scope-menu-backdrop fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-start justify-center pt-14 p-4 animate-in fade-in-0" onClick={onClose}>
      <Card
        data-testid="studio-menu"
        className="scope-menu-card studio-menu-card w-full max-w-lg bg-background border-border shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
        role="region"
        aria-label="Local projects"
      >
        {/* Header */}
        <div className="scope-menu-header flex items-center justify-between p-4 border-b border-border bg-muted/20">
          <div className="scope-menu-title-group flex items-center gap-3">
            <div className="scope-menu-icon-wrapper p-2 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
              <FolderOpen size={18} />
            </div>
            <div className="scope-menu-titles">
              <div className="scope-menu-title-row flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground m-0">{currentProject.name}</h2>
                <Badge variant="secondary" className="scope-menu-badge teal bg-teal-500/15 text-teal-700 dark:text-teal-300 border-0 font-medium text-[10px] px-1.5 py-0 h-4">
                  Active System
                </Badge>
              </div>
              <p className="scope-menu-subtitle text-[11px] text-muted-foreground m-0 mt-0.5">
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

        <ScrollArea className="studio-menu-scroll-body flex-1 overflow-y-auto p-4">
          {/* Section 1: Switch Project */}
          <div className="scope-menu-section space-y-2.5">
            <div className="scope-menu-section-header flex items-center justify-between">
              <span className="scope-menu-section-title text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FolderOpen size={13} className="text-muted-foreground" /> Switch project
              </span>
              <Badge variant="outline" className="scope-menu-badge text-[10px] px-1.5 py-0 h-4 font-normal">
                {projects.length} systems
              </Badge>
            </div>

            <div className="scope-project-list space-y-1">
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={cn(
                    "scope-project-item w-full flex items-center justify-between p-2.5 rounded-lg border border-transparent text-left transition-all hover:bg-accent cursor-pointer",
                    p.id === currentProject.id && "active bg-teal-500/10 border-teal-500/30 font-medium"
                  )}
                  onClick={() => onSwitchProject(p)}
                  aria-label={p.name}
                >
                  <div className="scope-project-item-left flex items-center gap-2.5">
                    <FolderOpen size={16} className={cn("scope-project-item-icon text-muted-foreground", p.id === currentProject.id && "text-teal-600 dark:text-teal-400")} />
                    <div className="scope-project-item-meta">
                      <strong className="block text-xs text-foreground">{p.name}</strong>
                      <small className="block text-[10px] text-muted-foreground">
                        {new Date(p.updatedAt).toLocaleDateString()} · {p.graph.nodes.length} components
                      </small>
                    </div>
                  </div>
                  {p.id === currentProject.id ? (
                    <span className="scope-project-active-badge flex items-center gap-1 text-[11px] font-semibold text-teal-600 dark:text-teal-400">
                      <Check size={13} /> Current
                    </span>
                  ) : (
                    <ChevronRight size={14} className="scope-project-item-icon text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>

            <Button
              type="button"
              className="scope-action-btn primary-action w-full justify-center bg-teal-600 hover:bg-teal-700 text-white h-8 text-xs font-medium"
              onClick={onCreateProject}
            >
              <Plus size={14} />
              <span>New project</span>
            </Button>
          </div>

          <Separator className="my-4 bg-border" />

          {/* Section 2: Starters & Templates */}
          <div className="scope-menu-section space-y-2.5">
            <div className="scope-menu-section-header flex items-center justify-between">
              <span className="scope-menu-section-title text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles size={13} className="text-teal-600 dark:text-teal-400" /> Starters & Templates
              </span>
              <Badge variant="outline" className="scope-menu-badge text-[10px] px-1.5 py-0 h-4 font-normal">
                Templates
              </Badge>
            </div>

            <Button
              type="button"
              variant="outline"
              className="scope-action-btn w-full justify-start h-8 text-xs text-muted-foreground hover:text-foreground"
              onClick={onCreateProject}
            >
              <FilePlus size={14} />
              <span>Blank system</span>
            </Button>

            <div className="scope-template-grid grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                className="scope-template-card rounded-lg border border-border bg-card p-3 text-left transition-all hover:bg-accent hover:border-border/80 flex flex-col justify-between cursor-pointer disabled:opacity-50"
                aria-label="Real-time chat"
                onClick={() => onLoadTemplate("realtime-chat")}
                disabled={isReadOnly}
              >
                <div className="scope-template-card-top flex items-center justify-between mb-1.5 w-full">
                  <MessageSquare size={15} className="text-teal-600 dark:text-teal-400" />
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5 font-normal">
                    WebSocket
                  </Badge>
                </div>
                <span className="scope-template-card-title text-xs font-semibold text-foreground block">Real-time chat</span>
                <span className="scope-template-card-desc text-[10px] text-muted-foreground block mt-0.5">Pub/sub & cache</span>
              </button>

              <button
                type="button"
                className="scope-template-card rounded-lg border border-border bg-card p-3 text-left transition-all hover:bg-accent hover:border-border/80 flex flex-col justify-between cursor-pointer disabled:opacity-50"
                aria-label="Ecommerce checkout"
                onClick={() => onLoadTemplate("ecommerce-checkout")}
                disabled={isReadOnly}
              >
                <div className="scope-template-card-top flex items-center justify-between mb-1.5 w-full">
                  <ShoppingCart size={15} className="text-teal-600 dark:text-teal-400" />
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5 font-normal">
                    Orders
                  </Badge>
                </div>
                <span className="scope-template-card-title text-xs font-semibold text-foreground block">Ecommerce checkout</span>
                <span className="scope-template-card-desc text-[10px] text-muted-foreground block mt-0.5">Queued jobs & DB</span>
              </button>

              <button
                type="button"
                className="scope-template-card rounded-lg border border-border bg-card p-3 text-left transition-all hover:bg-accent hover:border-border/80 flex flex-col justify-between cursor-pointer disabled:opacity-50"
                aria-label="Event processing"
                onClick={() => onLoadTemplate("event-processing")}
                disabled={isReadOnly}
              >
                <div className="scope-template-card-top flex items-center justify-between mb-1.5 w-full">
                  <Cpu size={15} className="text-teal-600 dark:text-teal-400" />
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-3.5 font-normal">
                    Stream
                  </Badge>
                </div>
                <span className="scope-template-card-title text-xs font-semibold text-foreground block">Event processing</span>
                <span className="scope-template-card-desc text-[10px] text-muted-foreground block mt-0.5">Worker ingestion</span>
              </button>
            </div>

            <Button
              type="button"
              variant="outline"
              className="scope-action-btn w-full justify-start h-8 text-xs text-muted-foreground hover:text-foreground"
              onClick={onOpenExamples}
              disabled={isReadOnly}
            >
              <Workflow size={14} />
              <span>Examples & tutorials</span>
            </Button>
          </div>

          <Separator className="my-4 bg-border" />

          {/* Section 3: Checkpoints */}
          <div className="scope-menu-section space-y-2.5">
            <div className="scope-menu-section-header flex items-center justify-between">
              <span className="scope-menu-section-title text-xs font-semibold text-foreground flex items-center gap-1.5">
                <BookmarkPlus size={13} className="text-muted-foreground" /> Checkpoints options
              </span>
              <Badge variant="outline" className="scope-menu-badge text-[10px] px-1.5 py-0 h-4 font-normal">
                {currentProject.checkpoints.length} saved
              </Badge>
            </div>

            {currentProject.checkpoints.length ? (
              <div className="scope-checkpoint-list checkpoint-list space-y-1">
                {currentProject.checkpoints.map((c: Checkpoint) => (
                  <button
                    key={c.id}
                    className="scope-checkpoint-item w-full flex items-center justify-between p-2 rounded-md border border-border bg-card hover:bg-accent text-left transition-colors cursor-pointer text-xs"
                    disabled={isReadOnly}
                    onClick={() => {
                      editor.restore(c.id);
                      onClose();
                      setNotice(`Restored “${c.name}”.`);
                    }}
                  >
                    <div className="scope-checkpoint-item-left flex items-center gap-2">
                      <span className="scope-checkpoint-dot w-1.5 h-1.5 rounded-full bg-teal-500" />
                      <span className="text-xs font-medium text-foreground">{c.name}</span>
                    </div>
                    <ChevronRight size={13} className="text-muted-foreground" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="scope-menu-section-desc text-[11px] text-muted-foreground m-0">Keep a version before trying something new.</p>
            )}

            <fieldset disabled={isReadOnly} style={{ border: "none", padding: 0, margin: 0 }}>
              <form
                className="scope-checkpoint-form flex items-center gap-2 mt-2"
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
                  className="scope-checkpoint-input h-8 text-xs flex-1"
                  aria-label="Checkpoint name"
                  placeholder="Name this checkpoint"
                  value={checkpointName}
                  onChange={(e) => setCheckpointName(e.target.value)}
                  maxLength={60}
                />
                <Button
                  type="submit"
                  size="sm"
                  className="scope-action-btn primary-action bg-teal-600 hover:bg-teal-700 text-white h-8 text-xs shrink-0"
                >
                  <BookmarkPlus size={14} />
                  <span>Save checkpoint</span>
                </Button>
              </form>
            </fieldset>
          </div>

          <Separator className="my-4 bg-border" />

          {/* Section 4: Architecture Revisions */}
          <div className="scope-menu-section revisions-group space-y-2.5">
            <div className="scope-menu-section-header flex items-center justify-between">
              <span className="scope-menu-section-title text-xs font-semibold text-foreground flex items-center gap-1.5">
                <GitBranch size={13} className="text-muted-foreground" /> Architecture Revisions
              </span>
              <Badge variant="outline" className="scope-menu-badge text-[10px] px-1.5 py-0 h-4 font-normal">
                Snapshots
              </Badge>
            </div>
            <div className="scope-revisions-wrapper">
              <Suspense fallback={<div className="scope-loading text-xs text-muted-foreground p-3">Loading revisions…</div>}>
                <RevisionsPanel key={currentProject.id} />
              </Suspense>
            </div>
          </div>

          <Separator className="my-4 bg-border" />

          {/* Section 5: Export & Backup */}
          <div className="scope-menu-section space-y-2.5">
            <div className="scope-menu-section-header flex items-center justify-between">
              <span className="scope-menu-section-title text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Download size={13} className="text-muted-foreground" /> Export options
              </span>
              <Badge variant="outline" className="scope-menu-badge text-[10px] px-1.5 py-0 h-4 font-normal">
                Canvas / JSON
              </Badge>
            </div>

            <div className="scope-export-tiles grid grid-cols-3 gap-2">
              <button
                type="button"
                className="scope-export-tile rounded-lg border border-border bg-card p-3 flex flex-col items-center justify-center text-center transition-all hover:bg-accent cursor-pointer"
                aria-label="Export canvas"
                onClick={onOpenExportModal}
              >
                <Image size={18} className="text-teal-600 dark:text-teal-400 mb-1" />
                <span className="text-xs font-medium text-foreground block">Export canvas</span>
                <small className="text-[10px] text-muted-foreground block">SVG & PNG</small>
              </button>

              <button
                type="button"
                className="scope-export-tile rounded-lg border border-border bg-card p-3 flex flex-col items-center justify-center text-center transition-all hover:bg-accent cursor-pointer"
                aria-label="Export JSON"
                onClick={onDownloadJson}
              >
                <Download size={18} className="text-teal-600 dark:text-teal-400 mb-1" />
                <span className="text-xs font-medium text-foreground block">Export JSON</span>
                <small className="text-[10px] text-muted-foreground block">Portable backup</small>
              </button>

              <button
                type="button"
                className="scope-export-tile rounded-lg border border-border bg-card p-3 flex flex-col items-center justify-center text-center transition-all hover:bg-accent cursor-pointer"
                aria-label="Import JSON"
                onClick={onImportJson}
              >
                <Upload size={18} className="text-teal-600 dark:text-teal-400 mb-1" />
                <span className="text-xs font-medium text-foreground block">Import JSON</span>
                <small className="text-[10px] text-muted-foreground block">Restore backup</small>
              </button>
            </div>
          </div>

          <Separator className="my-4 bg-border" />

          {/* Section 6: Saved Runs */}
          <div className="scope-menu-section space-y-2.5">
            <div className="scope-menu-section-header flex items-center justify-between">
              <span className="scope-menu-section-title text-xs font-semibold text-foreground flex items-center gap-1.5">
                <BarChart3 size={13} className="text-muted-foreground" /> Saved runs & comparisons
              </span>
              <Badge variant="outline" className="scope-menu-badge text-[10px] px-1.5 py-0 h-4 font-normal">
                {savedRuns.length} runs
              </Badge>
            </div>

            <Button
              type="button"
              variant="outline"
              className="scope-action-btn w-full justify-start h-8 text-xs text-muted-foreground hover:text-foreground"
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
        </ScrollArea>

        {/* Footer */}
        <div className="scope-menu-footer p-3 border-t border-border bg-muted/20 flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="scope-menu-info-btn text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 h-7"
            onClick={onOpenAssumptions}
          >
            <Info size={14} />
            <span>How the model works</span>
            <ArrowUpRight size={12} />
          </Button>
        </div>
      </Card>
    </div>
  );
}
