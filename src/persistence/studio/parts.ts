import { captureSelection } from "../../domain/parts/capture";
import type {
  CapturePreview,
  CaptureSelection,
} from "../../domain/parts/types";
import {
  parsePartFile,
  validateSavedPart,
  type SavedPart,
} from "../../domain/parts/validate";
import { canonicalJson, sha256Hex } from "../../domain/studio/canonical";
import type { Id } from "../../domain/studio/model";
import type { StudioDatabase } from "./db";
import { createIssue, mapErrorToFailedResult } from "./errors";
import { sha256HexOfBytes, type FileTokenRegistry } from "./file-tokens";
import { calculateRecordBytes, enforceProjectLimits } from "./limits";
import {
  checkOperationReceipt,
  computeRequestHash,
  insertImmutable,
  recordOperationReceipt,
  validateActor,
  validateRevision,
  validateUuid,
} from "./primitives";
import type {
  Actor,
  AppliedResult,
  AuthoredResult,
  ExportProjectResult,
  PartRecord,
} from "./types";

export type PartCaptureSource = CaptureSelection & {
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly viewId: Id;
};
export type PartCapturePreview = {
  readonly status: "ready";
  readonly dependencyPreviewId: Id;
  readonly source: PartCaptureSource;
  readonly preview: CapturePreview;
};
export type PartCaptureCommand = {
  readonly commandId: "part.capture";
  readonly projectId: Id;
  readonly branchId: Id;
  readonly expectedWorkingRevision: number;
  readonly operationId: Id;
  readonly actor: Actor;
  readonly payload: CaptureSelection & {
    readonly partId: Id;
    readonly revision: number;
    readonly expectedLatestRevision: number | null;
    readonly viewId: Id;
    readonly label: string;
    readonly description: string;
    readonly dependencyPreviewId: Id;
  };
};
export type PartImportCommand = {
  readonly commandId: "part.import";
  readonly projectId: Id;
  readonly operationId: Id;
  readonly actor: Actor;
  readonly expectedProjectRevision: number;
  readonly payload: { readonly fileToken: unknown; readonly partId: Id };
};

/** Repository-owned previews pin the exact source and closure acknowledged by the user. */
export class PartRepository {
  private readonly previews = new Map<
    Id,
    { source: PartCaptureSource; content: SavedPart["content"] }
  >();
  constructor(
    private readonly db: StudioDatabase,
    private readonly tokens: FileTokenRegistry,
    private readonly mintId?: () => Id,
  ) {}

  async preview(
    source: PartCaptureSource,
  ): Promise<PartCapturePreview | AuthoredResult> {
    try {
      const branch = await this.db.branches.get([
        source.projectId,
        source.branchId,
      ]);
      if (!branch) return { status: "missing", ids: [source.branchId] };
      if (branch.workingRevision !== source.expectedWorkingRevision)
        return {
          status: "stale",
          scope: "branch",
          expected: source.expectedWorkingRevision,
          actual: branch.workingRevision,
        };
      const snapshot = await this.db.snapshots.get([
        source.projectId,
        branch.workingSnapshotId,
      ]);
      if (!snapshot)
        return { status: "missing", ids: [branch.workingSnapshotId] };
      const capture = captureSelection(
        snapshot.document,
        source.viewId,
        source,
      );
      if (!capture.ok) return { status: "invalid", issues: capture.issues };
      if (!this.mintId)
        return {
          status: "invalid",
          issues: [
            createIssue(
              "missing-property",
              "Part previews require an injected ID generator.",
              ["mintId"],
            ),
          ],
        };
      const dependencyPreviewId = this.mintId();
      const previewIdIssue = validateUuid(
        dependencyPreviewId,
        ["dependencyPreviewId"],
        "dependencyPreviewId",
      );
      if (previewIdIssue || this.previews.has(dependencyPreviewId))
        return {
          status: "invalid",
          issues: [
            previewIdIssue ??
              createIssue(
                "duplicate-id",
                "ID generator returned an existing preview ID.",
                ["dependencyPreviewId"],
              ),
          ],
        };
      this.previews.set(
        dependencyPreviewId,
        structuredClone({ source, content: capture.content }),
      );
      if (this.previews.size > 100)
        this.previews.delete(this.previews.keys().next().value!);
      return {
        status: "ready",
        dependencyPreviewId,
        source: structuredClone(source),
        preview: capture.preview,
      };
    } catch (error) {
      return mapErrorToFailedResult(error);
    }
  }

  async list(projectId: Id): Promise<readonly PartRecord[]> {
    return structuredClone(
      await this.db.parts.where("projectId").equals(projectId).toArray(),
    );
  }

  async execute(
    command: PartCaptureCommand | PartImportCommand,
  ): Promise<AuthoredResult> {
    try {
      const issues = [...(validateActor(command.actor) ?? [])];
      if (!command.payload || typeof command.payload !== "object")
        return {
          status: "invalid",
          issues: [
            createIssue(
              "missing-property",
              "A part command payload is required.",
              ["payload"],
            ),
          ],
        };
      const keys =
        command.commandId === "part.capture"
          ? [
              "partId",
              "revision",
              "expectedLatestRevision",
              "viewId",
              "elementIds",
              "noteIds",
              "label",
              "description",
              "dependencyPreviewId",
            ]
          : ["fileToken", "partId"];
      for (const key of Object.keys(command.payload))
        if (!keys.includes(key))
          issues.push(
            createIssue("unknown-property", "Unknown part command field.", [
              "payload",
              key,
            ]),
          );
      for (const [key, value] of [
        ["projectId", command.projectId],
        ["operationId", command.operationId],
        ["partId", command.payload?.partId],
      ] as const) {
        const error = validateUuid(value, [key], key);
        if (error) issues.push(error);
      }
      if (issues.length) return { status: "invalid", issues };
      // A durable receipt remains replayable even after its transient preview expires.
      if (command.commandId === "part.capture") {
        const prior = await checkOperationReceipt(
          this.db,
          command.projectId,
          command.operationId,
          await computeRequestHash(command),
        );
        if ("status" in prior) return prior;
        if (prior.isRetry) return prior.result;
      }
      let part: SavedPart;
      let request: unknown = command;
      if (command.commandId === "part.capture") {
        for (const [key, value] of [
          ["branchId", command.branchId],
          ["viewId", command.payload.viewId],
          ["dependencyPreviewId", command.payload.dependencyPreviewId],
        ] as const) {
          const error = validateUuid(value, [key], key);
          if (error) return { status: "invalid", issues: [error] };
        }
        if (
          typeof command.payload.label !== "string" ||
          typeof command.payload.description !== "string" ||
          !Array.isArray(command.payload.elementIds) ||
          !Array.isArray(command.payload.noteIds)
        ) {
          return {
            status: "invalid",
            issues: [
              createIssue(
                "wrong-type",
                "Part label, description and selection have invalid types.",
                ["payload"],
              ),
            ],
          };
        }
        const revisionIssue = validateRevision(
          command.expectedWorkingRevision,
          ["expectedWorkingRevision"],
          "expectedWorkingRevision",
        );
        if (revisionIssue)
          return { status: "invalid", issues: [revisionIssue] };
        const expected = command.payload.expectedLatestRevision;
        if (
          (expected !== null &&
            (!Number.isSafeInteger(expected) || expected < 1)) ||
          command.payload.revision !== (expected ?? 0) + 1
        ) {
          return {
            status: "invalid",
            issues: [
              createIssue(
                "out-of-range",
                "Revision must be the next immutable part revision.",
                ["payload", "revision"],
              ),
            ],
          };
        }
        const preview = this.previews.get(command.payload.dependencyPreviewId);
        const source: PartCaptureSource = {
          projectId: command.projectId,
          branchId: command.branchId,
          expectedWorkingRevision: command.expectedWorkingRevision,
          viewId: command.payload.viewId,
          elementIds: command.payload.elementIds,
          noteIds: command.payload.noteIds,
        };
        if (
          !preview ||
          (await computeRequestHash(source)) !==
            (await computeRequestHash(preview.source))
        ) {
          return {
            status: "invalid",
            issues: [
              createIssue(
                "structural-rule",
                "Review the selection dependencies again before saving.",
                ["payload", "dependencyPreviewId"],
              ),
            ],
          };
        }
        part = {
          id: command.payload.partId,
          revision: command.payload.revision,
          label: command.payload.label.trim(),
          description: command.payload.description,
          content: preview.content,
        };
      } else {
        const revisionIssue = validateRevision(
          command.expectedProjectRevision,
          ["expectedProjectRevision"],
          "expectedProjectRevision",
        );
        if (revisionIssue)
          return { status: "invalid", issues: [revisionIssue] };
        const binding = this.tokens.resolveFile(command.payload.fileToken);
        if (!binding) return { status: "missing", ids: [] };
        if ((await sha256HexOfBytes(binding.bytes)) !== binding.sha256)
          return {
            status: "invalid",
            issues: [
              createIssue(
                "structural-rule",
                "The selected file changed. Select it again.",
                ["payload", "fileToken"],
              ),
            ],
          };
        const parsed = parsePartFile(binding.bytes);
        if (!parsed.ok) return { status: "invalid", issues: parsed.issues };
        if (command.payload.partId === parsed.value.id)
          return {
            status: "invalid",
            issues: [
              createIssue(
                "duplicate-id",
                "Import requires a fresh part identity.",
                ["payload", "partId"],
              ),
            ],
          };
        part = { ...parsed.value, id: command.payload.partId, revision: 1 };
        request = {
          ...command,
          payload: { partId: command.payload.partId, fileHash: binding.sha256 },
        };
      }
      const validation = validateSavedPart(part);
      if (!validation.ok)
        return { status: "invalid", issues: validation.issues };
      const hash = await computeRequestHash(request);
      return await this.db.transaction(
        "rw",
        this.db.tables,
        async (): Promise<AuthoredResult> => {
          const receipt = await checkOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            hash,
          );
          if ("status" in receipt) return receipt;
          if (receipt.isRetry) return receipt.result;
          const project = await this.db.projects.get(command.projectId);
          if (!project) return { status: "missing", ids: [command.projectId] };
          let branchRevision: number | null = null;
          if (command.commandId === "part.capture") {
            const branch = await this.db.branches.get([
              command.projectId,
              command.branchId,
            ]);
            if (!branch) return { status: "missing", ids: [command.branchId] };
            if (branch.workingRevision !== command.expectedWorkingRevision)
              return {
                status: "stale",
                scope: "branch",
                expected: command.expectedWorkingRevision,
                actual: branch.workingRevision,
              };
            branchRevision = branch.workingRevision;
          } else if (project.revision !== command.expectedProjectRevision) {
            return {
              status: "stale",
              scope: "project",
              expected: command.expectedProjectRevision,
              actual: project.revision,
            };
          }
          const revisions = await this.db.parts
            .where("[projectId+id]")
            .equals([command.projectId, part.id])
            .toArray();
          const latest = revisions.length
            ? Math.max(...revisions.map((row) => row.revision))
            : null;
          const expected =
            command.commandId === "part.capture"
              ? command.payload.expectedLatestRevision
              : null;
          if (latest !== expected)
            return {
              status: "stale",
              scope: "project",
              expected,
              actual: latest,
            };
          const now = Date.now();
          const row: PartRecord = {
            ...validation.value,
            projectId: command.projectId,
            createdAt: now,
          };
          const result: AppliedResult = {
            status: "applied",
            operationId: command.operationId,
            projectRevision: project.revision + 1,
            branchRevision,
            changedIds: [part.id],
            undo: null,
            value: {
              kind: "artifact",
              artifactType: "part",
              id: part.id,
              revision: part.revision,
            },
          };
          const receiptBytes = calculateRecordBytes({
            projectId: command.projectId,
            id: command.operationId,
            requestHash: hash,
            result,
            createdAt: now,
          });
          const projectDelta =
            calculateRecordBytes({
              ...project,
              revision: result.projectRevision,
              updatedAt: now,
            }) - calculateRecordBytes(project);
          const limit = await enforceProjectLimits(this.db, {
            projectId: command.projectId,
            additionalParts: 1,
            additionalReceipts: 1,
            additionalLocalBytes:
              calculateRecordBytes(row) + receiptBytes + projectDelta,
            additionalExportBytes: calculateRecordBytes(row) + projectDelta,
          });
          if (limit) return limit;
          await insertImmutable(this.db.parts, row, [
            command.projectId,
            part.id,
            part.revision,
          ]);
          await this.db.projects.update(command.projectId, {
            revision: result.projectRevision,
            updatedAt: now,
          });
          await recordOperationReceipt(
            this.db,
            command.projectId,
            command.operationId,
            hash,
            result,
          );
          return result;
        },
      );
    } catch (error) {
      return mapErrorToFailedResult(error);
    }
  }

  async export(
    projectId: Id,
    partId: Id,
    revision: number,
  ): Promise<ExportProjectResult> {
    try {
      const row = await this.db.parts.get([projectId, partId, revision]);
      if (!row) return { status: "missing", ids: [partId] };
      const { projectId: _projectId, createdAt: _createdAt, ...part } = row;
      const validation = validateSavedPart(part);
      if (!validation.ok)
        return { status: "invalid", issues: validation.issues };
      if (!this.mintId)
        return {
          status: "invalid",
          issues: [
            createIssue(
              "missing-property",
              "Export requires an injected ID generator.",
              ["mintId"],
            ),
          ],
        };
      const encoded = canonicalJson({
        format: "system-studio-part",
        version: 1,
        part: validation.value,
      });
      if (!encoded.ok) return { status: "invalid", issues: encoded.issues };
      return {
        status: "done",
        value: { kind: "download", downloadId: this.mintId() },
        bytes: new TextEncoder().encode(encoded.text),
        sha256: await sha256Hex(encoded.text),
      };
    } catch (error) {
      return mapErrorToFailedResult(error);
    }
  }
}
