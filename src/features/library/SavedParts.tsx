import * as React from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  PART_FILE_BYTES,
  validatePartContent,
} from "../../domain/parts/validate";
import type { Id } from "../../domain/studio/model";
import type {
  Actor,
  PartCaptureCommand,
  PartCapturePreview,
  PartImportCommand,
  PartRecord,
  StudioRepository,
} from "../../persistence/studio";
import type { FileTokenRegistry } from "../../persistence/studio/file-tokens";
import type { SessionController } from "../session/controller";
import { formatStudioError } from "../session/formatError";
import { sanitizeFilenameStem } from "../transfer/filename";
import { createBrowserDownloadSink } from "../transfer/ui/download-sink";
import type { LibraryView } from "./types";
import type {
  CommandId,
  CommandPayloads,
  ExecuteResult,
} from "../workspace/commands/registry";

type SavePartResult = Awaited<ReturnType<SessionController["savePart"]>>;

/**
 * Executes `part.export`: reads the part's bytes and hands them to the browser
 * download sink. The Workspace supplies this as the registry handler.
 */
export async function downloadSavedPart(
  repository: StudioRepository,
  projectId: Id,
  part: { readonly partId: Id; readonly revision: number; readonly label: string },
) {
  const result = await repository.exportPart(projectId, part.partId, part.revision);
  if (result.status === "done") {
    createBrowserDownloadSink()(
      new Blob([result.bytes.slice().buffer as ArrayBuffer], {
        type: "application/json;charset=utf-8",
      }),
      `${sanitizeFilenameStem(part.label)}.system-studio-part.json`,
    );
  }
  return result;
}

export type SavedPartsProps = {
  repository: StudioRepository;
  session: SessionController;
  actor: Actor;
  mintId: () => Id;
  viewId: Id | null;
  elementIds: readonly Id[];
  noteIds: readonly Id[];
  /** Shared reason from the registry (draft open, saving) for place and import. */
  blockedReason: string | null;
  /** Registry reason for `part.capture`, e.g. no selection. */
  captureBlockedReason: string | null;
  /** Runs `part.capture|place|export|import` through the command registry. */
  execute: <K extends CommandId>(id: K, payload: CommandPayloads[K]) => Promise<ExecuteResult>;
};

/** The saved collection shares the parent Library search and list/grid preference. */
export function SavedParts({
  repository,
  session,
  actor,
  mintId,
  viewId,
  elementIds,
  noteIds,
  blockedReason,
  captureBlockedReason,
  execute,
  searchQuery,
  view,
}: SavedPartsProps & { searchQuery: string; view: LibraryView }) {
  const state = React.useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );
  const [parts, setParts] = React.useState<readonly PartRecord[]>([]);
  const [preview, setPreview] = React.useState<PartCapturePreview | null>(null);
  const [label, setLabel] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [retry, setRetry] = React.useState<PartImportCommand | null>(null);
  const pendingCapture = React.useRef<PartCaptureCommand | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const disabled = busy || state.status !== "ready" || Boolean(blockedReason);
  React.useEffect(() => {
    let cancelled = false;
    setParts([]);
    if (state.projectId)
      void repository
        .listParts(state.projectId)
        .then((rows) => {
          if (!cancelled) setParts(rows);
        })
        .catch((error) => {
          if (!cancelled) setMessage(formatStudioError(error));
        });
    return () => {
      cancelled = true;
    };
  }, [repository, state.projectId, state.projectRevision]);
  React.useEffect(() => {
    setPreview(null);
    setRetry(null);
    setMessage("");
    pendingCapture.current = null;
  }, [state.projectId, state.branchId]);
  const latest = new Map<string, PartRecord>();
  for (const part of parts)
    if ((latest.get(part.id)?.revision ?? 0) < part.revision)
      latest.set(part.id, part);
  const query = searchQuery.trim().toLocaleLowerCase();
  const visible = [...latest.values()]
    .filter((part) =>
      `${part.label} ${part.description} saved parts`
        .toLocaleLowerCase()
        .includes(query),
    )
    .sort((a, b) => a.label.localeCompare(b.label));

  const review = async () => {
    const current = session.getState();
    if (
      !current.projectId ||
      !current.branchId ||
      current.workingRevision === null ||
      !viewId
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const result = await repository.previewPart({
        projectId: current.projectId,
        branchId: current.branchId,
        expectedWorkingRevision: current.workingRevision,
        viewId,
        elementIds,
        noteIds,
      });
      if (result.status !== "ready") {
        setMessage(formatStudioError(result));
        return;
      }
      setPreview(result);
      setLabel(
        current.document?.elements.find(
          (element) => element.id === elementIds[0],
        )?.label ?? "Saved component",
      );
      setDescription("");
      pendingCapture.current = null;
    } catch (error) {
      setMessage(formatStudioError(error));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!preview) return;
    const source = preview.source;
    const existing = pendingCapture.current;
    const command: PartCaptureCommand =
      existing &&
      existing.payload.label === label &&
      existing.payload.description === description
        ? existing
        : {
            commandId: "part.capture",
            projectId: source.projectId,
            branchId: source.branchId,
            expectedWorkingRevision: source.expectedWorkingRevision,
            operationId: mintId(),
            actor,
            payload: {
              partId: mintId(),
              revision: 1,
              expectedLatestRevision: null,
              viewId: source.viewId,
              elementIds: source.elementIds,
              noteIds: source.noteIds,
              label,
              description,
              dependencyPreviewId: preview.dependencyPreviewId,
            },
          };
    pendingCapture.current = command;
    setBusy(true);
    try {
      const outcome = await execute("part.capture", { command });
      if (outcome.status === "disabled") {
        setMessage(outcome.reason);
        return;
      }
      const result = outcome.value as SavePartResult;
      if (result.status === "applied") {
        setPreview(null);
        pendingCapture.current = null;
        setMessage("Component saved to this project’s Library.");
      } else setMessage(formatStudioError(result));
    } finally {
      setBusy(false);
    }
  };
  const importCommand = async (command: PartImportCommand) => {
    const outcome = await execute("part.import", { command });
    if (outcome.status === "disabled") {
      setRetry(command);
      setMessage(outcome.reason);
      return;
    }
    const result = outcome.value as SavePartResult;
    if (result.status === "applied") {
      setRetry(null);
      setMessage("Part imported as a new saved component.");
    } else {
      setRetry(command);
      setMessage(formatStudioError(result));
    }
  };
  const importFile = async (file: File) => {
    const current = session.getState();
    if (!current.projectId || current.projectRevision === null) return;
    setBusy(true);
    setMessage("");
    try {
      if (file.size > PART_FILE_BYTES) {
        setMessage("Part file is too large. Select a smaller part.");
        return;
      }
      const tokens = (
        repository as StudioRepository & { fileTokens?: FileTokenRegistry }
      ).fileTokens;
      if (!tokens) {
        setMessage("Part import is unavailable in this storage adapter.");
        return;
      }
      const fileToken = await tokens.registerFile(
        new Uint8Array(await file.arrayBuffer()),
        mintId,
      );
      await importCommand({
        commandId: "part.import",
        projectId: current.projectId,
        expectedProjectRevision: current.projectRevision,
        operationId: mintId(),
        actor,
        payload: { fileToken, partId: mintId() },
      });
    } catch (error) {
      setMessage(formatStudioError(error));
    } finally {
      setBusy(false);
    }
  };
  const exportPart = async (part: PartRecord) => {
    setBusy(true);
    try {
      const outcome = await execute("part.export", {
        partId: part.id,
        revision: part.revision,
        label: part.label,
      });
      if (outcome.status === "disabled") {
        setMessage(outcome.reason);
        return;
      }
      const result = outcome.value as Awaited<ReturnType<typeof downloadSavedPart>>;
      if (result.status !== "done") {
        setMessage(formatStudioError(result));
        return;
      }
      setMessage(
        "Part exported. Placed copies are independent of this Library entry.",
      );
    } catch (error) {
      setMessage(formatStudioError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Saved parts"
      className="border-b border-border p-3 space-y-3"
      onKeyDown={(event) => {
        if (event.key !== "Escape") event.stopPropagation();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold mr-auto">
          Saved parts{" "}
          <span className="font-mono text-secondary-text">{latest.size}</span>
        </h3>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || Boolean(captureBlockedReason)}
          title={captureBlockedReason ?? blockedReason ?? undefined}
          onClick={() => void review()}
        >
          Save as component
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
        >
          Import part
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Import part file"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </div>
      {blockedReason && (
        <p className="text-xs text-secondary-text">{blockedReason}</p>
      )}
      {preview && (
        <form
          aria-label="Save component preview"
          className="space-y-2 rounded-control border border-control-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="text-xs">
            Includes {preview.preview.includedElementIds.length} elements,{" "}
            {preview.preview.includedConnectionIds.length} internal connections,{" "}
            {preview.preview.includedRelationIds.length} relations and{" "}
            {preview.preview.includedNoteIds.length} notes.
          </p>
          <p className="text-xs break-words">
            {preview.preview.includedElementIds
              .map(
                (id) =>
                  state.document?.elements.find((element) => element.id === id)
                    ?.label ?? id,
              )
              .join(", ")}
          </p>
          <p className="text-xs text-secondary-text">
            Dependencies: {preview.preview.requiredSchemaIds.length} schemas,{" "}
            {preview.preview.requiredFixtureIds.length} fixtures,{" "}
            {preview.preview.requiredRefinementIds.length} refinements.
          </p>
          <ul className="space-y-1 text-xs text-secondary-text">
            {[...preview.preview.notices, ...preview.preview.warnings].map(
              (notice) => (
                <li key={notice}>{notice}</li>
              ),
            )}
          </ul>
          <label className="block text-xs">
            Component name
            <Input
              aria-label="Component name"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              required
            />
          </label>
          <label className="block text-xs">
            Description
            <Input
              aria-label="Component description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              loading={busy}
              disabled={disabled || !label.trim()}
            >
              Save component
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                pendingCapture.current = null;
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {visible.length === 0 && (
        <p className="text-xs text-secondary-text">
          {latest.size
            ? "No saved parts match this search."
            : "Save a selection to reuse it in this project."}
        </p>
      )}
      <div className={view === "grid" ? "grid grid-cols-2 gap-2" : "space-y-2"}>
        {visible.map((part) => (
          <article
            key={part.id}
            className="min-w-0 rounded-control border border-control-border p-2 text-xs"
          >
            <button
              type="button"
              className="w-full text-left font-semibold break-words focus-visible:outline-ring"
              aria-expanded={selected === part.id}
              onClick={() => setSelected(selected === part.id ? null : part.id)}
            >
              {part.label}{" "}
              <span className="text-secondary-text font-mono">
                r{part.revision}
              </span>
            </button>
            {selected === part.id && (
              <p className="mt-2 break-words text-secondary-text">
                {part.description || "No description."} Independent copy;
                configure and connect its exposed ports after placement.
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="tint"
                disabled={disabled}
                aria-label={`Place ${part.label}`}
                onClick={() => {
                  const validated = validatePartContent(part.content);
                  if (!validated.ok) {
                    setMessage(
                      validated.issues[0]?.message ?? "Invalid saved part",
                    );
                    return;
                  }
                  setBusy(true);
                  void execute("part.place", { content: validated.value, label: part.label })
                    .then((outcome) =>
                      setMessage(
                        outcome.status === "disabled"
                          ? outcome.reason
                          : outcome.value
                            ? "Part placed. Connect exposed ports before running."
                            : "Could not place the part. The canvas was not changed.",
                      ),
                    )
                    .catch((error) => setMessage(formatStudioError(error)))
                    .finally(() => setBusy(false));
                }}
              >
                Place
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Export ${part.label}`}
                onClick={() => void exportPart(part)}
              >
                Export
              </Button>
            </div>
          </article>
        ))}
      </div>
      {message && (
        <p role="status" className="text-xs break-words">
          {message}
        </p>
      )}
      {retry && (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setBusy(true);
            void importCommand(retry).finally(() => setBusy(false));
          }}
        >
          Retry part import
        </Button>
      )}
    </section>
  );
}
