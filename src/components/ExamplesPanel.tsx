import { useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="examples-modal"
        className="examples-modal sm:max-w-3xl max-h-[85vh] p-0 gap-0 overflow-hidden bg-background border-border shadow-2xl flex flex-col"
        hideClose
      >
        <DialogHeader className="examples-modal-header flex flex-row items-center justify-between px-5 py-3.5 border-b border-border space-y-0">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-teal-600 dark:text-teal-400" />
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
            className="subtle h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          >
            <X size={16} />
          </Button>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(val) => handleTabChange(val as "starter" | "tutorial")}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="examples-tabs px-5 py-2.5 bg-muted/30 border-b border-border">
            <TabsList className="grid w-full max-w-xs grid-cols-2 h-8 p-1 bg-muted">
              <TabsTrigger
                value="starter"
                role="button"
                className="text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                Starter architectures
              </TabsTrigger>
              <TabsTrigger
                value="tutorial"
                role="button"
                className="text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                Guided tutorials
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="examples-body flex flex-1 min-h-[380px] overflow-hidden">
            <div
              className="examples-list w-2/5 border-r border-border overflow-y-auto p-2.5 flex flex-col gap-1.5"
              role="listbox"
              aria-label="Available examples"
            >
              {filtered.map((ex) => (
                <button
                  key={ex.id}
                  role="option"
                  aria-selected={current?.id === ex.id}
                  className={cn(
                    "example-list-item flex flex-col items-start w-full p-2.5 rounded-lg border border-transparent text-left transition-all hover:bg-accent/60 cursor-pointer",
                    current?.id === ex.id && "selected bg-teal-500/10 border-teal-500/30 text-foreground"
                  )}
                  onClick={() => setSelectedId(ex.id)}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <strong className="text-xs font-semibold text-foreground">{ex.title}</strong>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 font-normal uppercase opacity-70">
                      {ex.kind}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-muted-foreground line-clamp-2">{ex.purpose}</span>
                </button>
              ))}
            </div>

            {current && (
              <div className="example-preview flex-1 p-5 overflow-y-auto flex flex-col justify-between">
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">{current.title}</h3>
                    <p className="purpose text-xs text-muted-foreground leading-relaxed">{current.purpose}</p>
                  </div>
                  <div className="steps-title text-xs font-medium text-foreground uppercase tracking-wider text-[10px] text-muted-foreground">
                    Exploration steps
                  </div>
                  <ol className="text-xs space-y-1.5 pl-4 list-decimal text-muted-foreground">
                    {current.steps.map((step, i) => (
                      <li key={i} className="leading-relaxed">{step}</li>
                    ))}
                  </ol>
                </div>
                <div className="example-preview-actions flex items-center gap-2 pt-4 border-t border-border mt-4">
                  <Button className="primary bg-teal-600 hover:bg-teal-700 text-white" onClick={handleLoad}>
                    Load example
                  </Button>
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
