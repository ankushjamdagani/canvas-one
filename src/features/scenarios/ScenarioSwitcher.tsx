/**
 * Scenario switcher (RV-05c).
 *
 * Implements specs/revamp/contracts/commands.md §4 "Switcher": "a segmented control
 * beside Run in the 22A top bar (D38) -- scenario name with status dot and mode icon,
 * then the green Run. Its list shows every scenario with status ..., 'Run all n', the
 * commit line ..., and New / Duplicate / Edit. Per-row menu: Rename, Duplicate,
 * Delete.... No scenario -> the control reads 'No scenario' and Run is disabled with
 * the reason 'Add a scenario to run'." Screens: scenario_switcher.png,
 * scenario_blank_project.png.
 *
 * It replaced the RV-12c4 run control in the top bar (RV-12i), with New/Duplicate/Edit/
 * Rename/Delete wired to the scenario editor. "Rename" opens the same editor as "Edit",
 * focused on the header name field -- the screens show no separate rename-only surface.
 *
 * "Run itself is passed in; no runner here" (brief) -- onRun/onRunAll/onPause/onResume/
 * onReset are opaque callbacks; this component owns no run state.
 */

import { useHeaderSideOffset } from "@/lib/useHeaderSideOffset";
import * as React from "react";
import {
  Activity,
  ChevronDown,
  GitCommitHorizontal,
  Info,
  Pause,
  Pencil,
  Play,
  Plus,
  SlidersHorizontal,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { Id } from "../../domain/studio/model";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import type { ScenarioStatus } from "../runs/scenarioStatus";
import {
  findRunAllDisabledReason,
  formatCommitLineText,
  formatScenarioMode,
  getScenarioStatusColor,
} from "../runs/view-models";

export interface ScenarioSwitcherEntry {
  readonly id: Id;
  readonly label: string;
  readonly mode: "logical" | "timed";
  readonly status: ScenarioStatus;
}

/** The run phases the switcher renders; a subset of RunController's RunPhase (no 'done'). */
export type ScenarioSwitcherRunPhase =
  "idle" | "compiling" | "running" | "paused" | "saving";

export interface ScenarioSwitcherProps {
  readonly scenarios: readonly ScenarioSwitcherEntry[];
  readonly selectedId: Id | null;
  readonly runPhase: ScenarioSwitcherRunPhase;
  readonly disabledReason?: string | null;
  readonly onSelect: (scenarioId: Id) => void;
  readonly onRun: (scenarioId: Id) => void;
  readonly onRunAll: () => void;
  readonly onPause?: () => void;
  readonly onResume?: () => void;
  readonly onReset?: () => void;
  /** D55: stop a timed run gracefully, keeping its results; `isStopping` while it drains. */
  readonly onStop?: () => void;
  readonly isStopping?: boolean;
  /** Unified simulation bar: transport owns pause/resume; the joined action drains. */
  readonly unified?: boolean;
  readonly executionMode?: 'logical' | 'timed';
  readonly onNew: () => void;
  readonly onEdit: (scenarioId: Id) => void;
  readonly onRename: (scenarioId: Id) => void;
  readonly onDelete: (scenarioId: Id) => void;
}

export function ScenarioSwitcher({
  scenarios,
  selectedId,
  runPhase,
  disabledReason,
  onSelect,
  onRun,
  onRunAll,
  onPause,
  onResume,
  onReset,
  onStop,
  isStopping,
  unified = false,
  executionMode,
  onNew,
  onEdit,
  onRename,
  onDelete,
}: ScenarioSwitcherProps) {
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const sideOffset = useHeaderSideOffset(popoverOpen);

  const selectedScenario =
    scenarios.find((s) => s.id === selectedId) ??
    (scenarios.length > 0 ? scenarios[0] : null);

  const isRunning =
    runPhase === "running" || runPhase === "compiling" || runPhase === "saving";
  const isPaused = runPhase === "paused";
  const isExecutionActive = isRunning || isPaused;

  const totalScenarios = scenarios.length;
  const passingCount = scenarios.filter(
    (s) => s.status.kind === "passed",
  ).length;
  const allPassing = totalScenarios > 0 && passingCount === totalScenarios;

  const notReadyReason = findRunAllDisabledReason(scenarios);
  const selectedNotReadyReason =
    selectedScenario && selectedScenario.status.kind === "not-ready"
      ? (selectedScenario.status.issues[0]?.message ??
        "Can't run this scenario")
      : null;

  const effectiveDisabledReason =
    disabledReason ??
    (totalScenarios === 0
      ? "Add a scenario to run"
      : !selectedScenario
        ? "Select a scenario to run"
        : selectedNotReadyReason);

  const isRunDisabled =
    !!effectiveDisabledReason || totalScenarios === 0 || !selectedScenario;
  const runAllDisabledReason = notReadyReason;
  const isRunAllDisabled =
    isExecutionActive || isRunDisabled || !!runAllDisabledReason;

  return (
    <div
      data-testid="scenario-switcher"
      className="inline-flex items-center h-8 pointer-coarse:h-12 min-w-0 rounded-control border border-control-border bg-background shadow-xs overflow-hidden select-none"
      role="group"
      aria-label="Scenario and simulation run controls"
    >
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="scenario-switcher-trigger"
            className={cn(
              "h-full min-w-0 pointer-coarse:min-w-11 px-2 sm:px-2.5 flex items-center gap-1.5 text-xs font-medium transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-ring focus-visible:z-10 cursor-pointer",
              !selectedScenario && "text-secondary-text",
            )}
            aria-label={
              selectedScenario
                ? `Selected scenario: ${selectedScenario.label}`
                : "No scenario selected"
            }
          >
            {selectedScenario ? (
              <>
                <span
                  className={cn(
                    "size-2 rounded-full shrink-0",
                    getScenarioStatusColor(selectedScenario.status).dotClass,
                  )}
                  aria-hidden="true"
                />
                {selectedScenario.mode === "timed" ? (
                  <Activity
                    className="hidden sm:block size-3.5 text-secondary-text shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <GitCommitHorizontal
                    className="hidden sm:block size-3.5 text-secondary-text shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="font-semibold text-foreground min-w-[3ch] max-w-[130px] truncate text-xs">
                  {selectedScenario.label}
                </span>
              </>
            ) : (
              <span className="text-secondary-text text-xs">No scenario</span>
            )}
            <ChevronDown
              className="hidden sm:block size-3 text-secondary-text shrink-0 ml-0.5"
              aria-hidden="true"
            />
          </button>
        </PopoverTrigger>

        <PopoverContent
          data-testid="scenario-switcher-popover"
          className="w-80 md:w-96 p-0 bg-background border border-border rounded-popover shadow-popover overflow-hidden text-xs outline-none flex flex-col"
          align="end"
          sideOffset={sideOffset}
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-hairline bg-panel select-none shrink-0">
            <span className="font-mono text-meta font-medium text-secondary-text uppercase">
              SCENARIOS · {totalScenarios}
            </span>
            {totalScenarios > 0 && (
              <button
                type="button"
                data-testid="scenario-run-all-btn"
                onClick={() => {
                  setPopoverOpen(false);
                  onRunAll();
                }}
                disabled={isRunAllDisabled}
                title={runAllDisabledReason ?? undefined}
                className="inline-flex items-center gap-1.5 font-semibold text-primary hover:text-primary-hover active:text-primary-pressed transition-colors cursor-pointer disabled:cursor-not-allowed disabled:text-secondary-text"
                aria-label={`Run all ${totalScenarios} scenarios`}
              >
                <Play className="size-3.5 fill-current" aria-hidden="true" />
                <span>Run all {totalScenarios}</span>
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto p-1.5 space-y-1">
            {scenarios.map((s) => {
              const statusToken = getScenarioStatusColor(s.status);
              const isSelected = selectedScenario?.id === s.id;

              return (
                <div
                  key={s.id}
                  data-testid={`scenario-row-${s.id}`}
                  className={cn(
                    "group flex items-start justify-between rounded-control transition-colors border",
                    isSelected
                      ? "bg-selected-tint/40 border-selected-edge"
                      : "border-transparent hover:bg-sunken",
                  )}
                >
                  {/* The select action is its own button beside the row menu; nesting the menu
                      inside a clickable row made two interactive controls share one target. */}
                  <button
                    type="button"
                    className="flex flex-1 items-start gap-2 min-w-0 p-2 text-left rounded-control"
                    onClick={() => onSelect(s.id)}
                    aria-pressed={isSelected}
                  >
                    <span
                      className={cn(
                        "size-2 rounded-full shrink-0 mt-1",
                        statusToken.dotClass,
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground truncate text-xs">
                          {s.label}
                        </span>
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-secondary-text font-normal">
                          {s.mode === "timed" ? (
                            <Activity className="size-2.5" aria-hidden="true" />
                          ) : (
                            <GitCommitHorizontal
                              className="size-2.5"
                              aria-hidden="true"
                            />
                          )}
                          {formatScenarioMode(s.mode)}
                        </span>
                      </div>
                      <div
                        data-testid={`scenario-status-${s.id}`}
                        className="text-[11px] text-secondary-text mt-0.5"
                      >
                        {statusToken.label}
                      </div>
                    </div>
                  </button>

                  <div
                    className={cn(
                      "flex items-center gap-0.5 shrink-0 p-2 pl-0 transition-opacity",
                      isSelected
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100",
                    )}
                  >
                    {(
                      [
                        {
                          label: "Rename",
                          icon: Pencil,
                          run: () => onRename(s.id),
                          tone: "",
                        },
                        {
                          label: "Edit",
                          icon: SlidersHorizontal,
                          run: () => onEdit(s.id),
                          tone: "",
                        },
                        {
                          label: "Delete",
                          icon: Trash2,
                          run: () => onDelete(s.id),
                          tone: "text-destructive hover:text-destructive",
                        },
                      ] as const
                    ).map(({ label, icon: Icon, run, tone }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          setPopoverOpen(false);
                          run();
                        }}
                        title={`${label} scenario`}
                        aria-label={`${label} scenario ${s.label}`}
                        data-testid={`scenario-${label.toLowerCase()}-btn-${s.id}`}
                        className={cn(
                          "size-6 pointer-coarse:size-11 inline-flex items-center justify-center rounded-sm text-secondary-text hover:text-foreground hover:bg-sunken cursor-pointer transition-colors",
                          tone,
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {totalScenarios === 0 && (
              <div className="p-4 text-center text-secondary-text">
                No scenarios yet. Add a scenario to begin testing.
              </div>
            )}
          </div>

          {totalScenarios > 0 && (
            <div
              data-testid="scenario-commit-line"
              className={cn(
                "mx-2.5 my-1.5 p-2 rounded-md border text-[11px] flex items-center gap-2",
                allPassing
                  ? "bg-selected-tint/40 border-selected-edge text-primary"
                  : "bg-risk-tint/40 border-risk-edge/50 text-risk-text",
              )}
              role="status"
            >
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{formatCommitLineText(totalScenarios, passingCount)}</span>
            </div>
          )}

          <div className="flex items-center px-3 py-2.5 border-t border-hairline bg-panel text-[11px] font-medium text-body select-none shrink-0 mt-auto">
            <button
              type="button"
              onClick={() => {
                setPopoverOpen(false);
                onNew();
              }}
              className="inline-flex items-center gap-1 text-body hover:text-foreground transition-colors cursor-pointer"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New scenario
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <div className="w-px h-full bg-control-border shrink-0" />

      {unified && isExecutionActive ? (
        <button
          type="button"
          data-testid="scenario-stop-btn"
          onClick={(executionMode ?? selectedScenario?.mode) === "timed" ? onStop : onReset}
          disabled={
            isStopping || runPhase === "compiling" || runPhase === "saving"
          }
          title={
            (executionMode ?? selectedScenario?.mode) === "timed"
              ? "Stop new requests and drain in-flight work"
              : "Cancel execution"
          }
          aria-label={
            (executionMode ?? selectedScenario?.mode) === "timed"
              ? "Stop the run and keep its results"
              : "Cancel execution"
          }
          className="h-full shrink-0 px-3 flex items-center gap-1.5 text-xs font-semibold bg-clay text-primary-foreground disabled:opacity-50"
        >
          <Square className="size-3.5 fill-current" aria-hidden="true" />
          <span>Stop</span>
        </button>
      ) : isExecutionActive ? (
        <div className="inline-flex items-center h-full">
          {isRunning ? (
            <button
              type="button"
              data-testid="scenario-pause-btn"
              onClick={onPause}
              className="h-full shrink-0 px-2.5 pointer-coarse:min-w-11 justify-center flex items-center gap-1 text-xs font-semibold bg-warning-text text-primary-foreground hover:opacity-90 active:opacity-100 transition-colors cursor-pointer"
              aria-label="Pause execution"
            >
              <Pause className="size-3.5 fill-current" aria-hidden="true" />
              <span className="hidden sm:inline">Pause</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="scenario-resume-btn"
              onClick={onResume}
              className="h-full shrink-0 px-2.5 pointer-coarse:min-w-11 justify-center flex items-center gap-1 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed transition-colors cursor-pointer"
              aria-label="Resume execution"
            >
              <Play className="size-3.5 fill-current" aria-hidden="true" />
              <span className="hidden sm:inline">Resume</span>
            </button>
          )}

          {selectedScenario?.mode === "timed" && onStop ? (
            <>
              <div className="w-px h-full bg-control-border shrink-0" />
              <button
                type="button"
                data-testid="scenario-stop-btn"
                onClick={onStop}
                disabled={
                  isStopping ||
                  runPhase === "compiling" ||
                  runPhase === "saving"
                }
                className="h-full shrink-0 px-2 pointer-coarse:min-w-11 justify-center flex items-center gap-1 text-xs font-medium text-body hover:bg-sunken hover:text-foreground transition-colors cursor-pointer disabled:cursor-not-allowed disabled:text-secondary-text"
                aria-label="Stop the run and keep its results"
                title="Stop new requests, let work in flight finish, and keep the results"
              >
                <Square className="size-3 fill-current" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {isStopping ? "Stopping…" : "Stop"}
                </span>
              </button>
            </>
          ) : null}

          <div className="w-px h-full bg-control-border shrink-0" />

          <button
            type="button"
            data-testid="scenario-reset-btn"
            onClick={onReset}
            className="h-full shrink-0 px-2 pointer-coarse:min-w-11 justify-center flex items-center gap-1 text-xs font-medium text-body hover:bg-sunken hover:text-foreground transition-colors cursor-pointer"
            aria-label="Reset simulation"
            title="Reset simulation"
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex h-full">
                <button
                  type="button"
                  data-testid="scenario-run-btn"
                  disabled={isRunDisabled}
                  onClick={() => {
                    if (selectedScenario) onRun(selectedScenario.id);
                  }}
                  className={cn(
                    "h-full shrink-0 px-2.5 sm:px-3 pointer-coarse:min-w-11 justify-center flex items-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer",
                    "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed",
                    "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-secondary-text",
                  )}
                  aria-label="Run scenario simulation"
                >
                  <Play className="size-3.5 fill-current" aria-hidden="true" />
                  <span className={unified ? undefined : "hidden sm:inline"}>
                    Run
                  </span>
                </button>
              </span>
            </TooltipTrigger>
            {effectiveDisabledReason && (
              <TooltipContent side="bottom" className="text-xs">
                {effectiveDisabledReason}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
