import { useState, useRef } from "react";
import { X, Sparkles } from "lucide-react";
import { openExamples } from "../domain/openExamples";
import type { Graph } from "../domain/model";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function ExamplesPanel({
  onSelect,
  onClose,
}: {
  onSelect: (graph: Graph) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"starter" | "tutorial">("starter");
  const filtered = openExamples.filter((ex) => ex.kind === tab);
  const [selectedId, setSelectedId] = useState<string>(filtered[0]?.id ?? "");
  const optionRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const current = filtered.find((ex) => ex.id === selectedId) ?? filtered[0];

  const handleTabChange = (nextTab: "starter" | "tutorial") => {
    setTab(nextTab);
    const nextFiltered = openExamples.filter((ex) => ex.kind === nextTab);
    if (nextFiltered.length) {
      setSelectedId(nextFiltered[0].id);
    }
  };

  const handleLoad = () => {
    if (!current) return;
    onSelect(current.create());
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filtered.length === 0) return;
    const currentIndex = filtered.findIndex((ex) => ex.id === current?.id);
    let nextIndex = currentIndex;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = currentIndex < filtered.length - 1 ? currentIndex + 1 : 0;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = currentIndex > 0 ? currentIndex - 1 : filtered.length - 1;
    } else if (e.key === "Home") {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      nextIndex = filtered.length - 1;
    }

    if (nextIndex !== currentIndex && filtered[nextIndex]) {
      const nextId = filtered[nextIndex].id;
      setSelectedId(nextId);
      const el = optionRefs.current.get(nextId);
      el?.focus();
      el?.scrollIntoView({ block: "nearest" });
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="examples-modal"
        className="examples-modal w-[calc(100%-24px)] max-w-lg sm:max-w-3xl max-h-[88vh] sm:max-h-[85vh] p-0 gap-0 overflow-hidden bg-background border-border shadow-2xl flex flex-col"
        hideClose
      >
        <DialogHeader className="examples-modal-header flex flex-row items-center justify-between px-4 sm:px-5 py-3 sm:py-3.5 border-b border-border space-y-0 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-teal-600 dark:text-teal-400 shrink-0" />
            <DialogTitle id="examples-title" className="text-base font-semibold text-foreground">
              System examples
            </DialogTitle>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close examples"
            onClick={onClose}
            className="subtle h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
          >
            <X size={16} />
          </Button>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(val) => handleTabChange(val as "starter" | "tutorial")}
          className="flex flex-col flex-1 overflow-hidden min-h-0"
        >
          <div className="examples-tabs px-4 sm:px-5 py-2 sm:py-2.5 bg-muted/30 border-b border-border shrink-0">
            <TabsList className="grid w-full max-w-xs grid-cols-2 h-8 p-1 bg-muted">
              <TabsTrigger
                value="starter"
                className="text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                Starter architectures
              </TabsTrigger>
              <TabsTrigger
                value="tutorial"
                className="text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                Guided tutorials
              </TabsTrigger>
            </TabsList>
          </div>

          {(["starter", "tutorial"] as const).map((tabKey) => (
            <TabsContent
              key={tabKey}
              value={tabKey}
              className="mt-0 flex-1 flex flex-col overflow-hidden min-h-0"
            >
              <div className="examples-body flex flex-col sm:flex-row flex-1 min-h-0 sm:min-h-[380px] overflow-hidden">
                <div
                  className="examples-list h-44 sm:h-auto sm:w-2/5 border-b sm:border-b-0 sm:border-r border-border overflow-y-auto p-2.5 flex flex-col gap-1.5 shrink-0"
                  role="listbox"
                  aria-label="Available examples"
                  onKeyDown={handleKeyDown}
                >
                  {openExamples
                    .filter((ex) => ex.kind === tabKey)
                    .map((ex) => (
                      <button
                        key={ex.id}
                        ref={(el) => {
                          if (el) optionRefs.current.set(ex.id, el);
                          else optionRefs.current.delete(ex.id);
                        }}
                        role="option"
                        aria-selected={current?.id === ex.id}
                        tabIndex={current?.id === ex.id ? 0 : -1}
                        className={cn(
                          "example-list-item flex flex-col items-start w-full p-2.5 rounded-lg border border-transparent text-left whitespace-normal transition-colors duration-150 hover:bg-accent/60 cursor-pointer",
                          current?.id === ex.id && "selected bg-teal-500/10 border-teal-500/30 text-foreground font-medium"
                        )}
                        onClick={() => setSelectedId(ex.id)}
                      >
                        <div className="flex items-center justify-between w-full mb-1 gap-2">
                          <strong className="text-xs font-semibold text-foreground truncate">{ex.title}</strong>
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal uppercase opacity-70 shrink-0">
                            {ex.kind}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed whitespace-normal break-words">{ex.purpose}</span>
                      </button>
                    ))}
                </div>

                {current && (
                  <div className="example-preview flex-1 p-4 sm:p-5 overflow-y-auto flex flex-col justify-between min-h-0">
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground mb-1">{current.title}</h3>
                        <p className="purpose text-xs text-muted-foreground leading-relaxed whitespace-normal break-words">{current.purpose}</p>
                      </div>
                      <div className="steps-title text-xs font-medium text-foreground uppercase tracking-wider text-[10px] text-muted-foreground">
                        Exploration steps
                      </div>
                      <ol className="text-xs space-y-1.5 pl-4 list-decimal text-muted-foreground">
                        {current.steps.map((step, i) => (
                          <li key={i} className="leading-relaxed whitespace-normal break-words">{step}</li>
                        ))}
                      </ol>
                    </div>
                    <div className="example-preview-actions flex items-center gap-2 pt-3 sm:pt-4 border-t border-border mt-3 sm:mt-4 shrink-0 bg-background">
                      <Button className="primary bg-teal-600 hover:bg-teal-700 text-white min-h-[36px]" onClick={handleLoad}>
                        Load example
                      </Button>
                      <Button variant="outline" className="min-h-[36px]" onClick={onClose}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
