import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../../domain/studio/model";
import { planPlacement } from "../../domain/parts/place";
import { validatePartContent } from "../../domain/parts/validate";
import { SessionController } from "../../features/session/controller";
import { createStudioDatabase, type StudioDatabase } from "./db";
import { LocalRepository } from "./repository";
import type { PartCaptureCommand, PartImportCommand } from "./parts";
import type { Actor } from "./types";

const actor: Actor = {
  actorId: "parts-test",
  kind: "local-human",
  displayName: "Part author",
};
const databases: StudioDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
async function setup() {
  const db = createStudioDatabase(`parts-${crypto.randomUUID()}`);
  databases.push(db);
  const repo = new LocalRepository(db, { mintId: () => crypto.randomUUID() });
  const session = new SessionController({
    repository: repo,
    mintId: () => crypto.randomUUID(),
    actor,
  });
  const document = JSON.parse(
    readFileSync("specs/revamp/fixtures/s03.json", "utf8"),
  ) as Document;
  await session.createProject({ title: "Parts", initialDocument: document });
  const current = session.getState();
  const source = {
    projectId: current.projectId!,
    branchId: current.branchId!,
    expectedWorkingRevision: current.workingRevision!,
    viewId: document.views[0].id,
    elementIds: [document.elements[0].id],
    noteIds: [],
  };
  const preview = await repo.previewPart(source);
  if (preview.status !== "ready") throw new Error(JSON.stringify(preview));
  const command: PartCaptureCommand = {
    commandId: "part.capture",
    projectId: source.projectId,
    branchId: source.branchId,
    expectedWorkingRevision: source.expectedWorkingRevision,
    actor,
    operationId: crypto.randomUUID(),
    payload: {
      partId: crypto.randomUUID(),
      revision: 1,
      expectedLatestRevision: null,
      viewId: source.viewId,
      elementIds: source.elementIds,
      noteIds: [],
      label: "Reusable pipeline",
      description: "User text",
      dependencyPreviewId: preview.dependencyPreviewId,
    },
  };
  return { db, repo, session, source, command };
}
describe("durable saved parts", () => {
  it("saves without changing working content/undo, persists reload, and returns detached query copies", async () => {
    const { db, repo, session, source, command } = await setup();
    const before = session.getState();
    expect((await session.savePart(command)).status).toBe("applied");
    expect(session.getState()).toMatchObject({
      workingRevision: before.workingRevision,
      projectRevision: before.projectRevision! + 1,
      document: before.document,
      canUndo: false,
    });
    const stored = await repo.listParts(source.projectId);
    expect(stored).toHaveLength(1);
    (stored[0] as { label: string }).label = "Mutated query";
    expect(
      (await new LocalRepository(db).listParts(source.projectId))[0].label,
    ).toBe("Reusable pipeline");
  });
  it("replays receipts and rejects operation reuse, source races, and revision races", async () => {
    const { repo, command, source, db } = await setup();
    const accepted = await repo.execute(command);
    expect(await repo.execute(command)).toEqual(accepted);
    expect(await new LocalRepository(db).execute(command)).toEqual(accepted);
    expect(
      await repo.execute({
        ...command,
        payload: { ...command.payload, label: "Different" },
      }),
    ).toMatchObject({ status: "failed", code: "operation-id-reused" });
    expect(
      await repo.execute({ ...command, operationId: crypto.randomUUID() }),
    ).toMatchObject({ status: "stale" });
    const next = {
      ...command,
      operationId: crypto.randomUUID(),
      payload: { ...command.payload, revision: 2, expectedLatestRevision: 1 },
    };
    expect((await repo.execute(next)).status).toBe("applied");
    await db.branches.update([source.projectId, source.branchId], {
      workingRevision: source.expectedWorkingRevision + 1,
    });
    expect(
      await repo.execute({
        ...next,
        operationId: crypto.randomUUID(),
        payload: { ...next.payload, revision: 3, expectedLatestRevision: 2 },
      }),
    ).toMatchObject({ status: "stale", scope: "branch" });
    expect(await repo.listParts(source.projectId)).toHaveLength(2);
  });
  it("requires a matching dependency preview, and rejects invalid revision/labels before mutation", async () => {
    const { repo, command, source } = await setup();
    for (const payload of [
      { ...command.payload, dependencyPreviewId: crypto.randomUUID() },
      { ...command.payload, elementIds: [] },
      { ...command.payload, revision: 3 },
      { ...command.payload, label: "" },
    ]) {
      expect((await repo.execute({ ...command, payload })).status).toBe(
        "invalid",
      );
    }
    expect(await repo.listParts(source.projectId)).toHaveLength(0);
  });
  it("rolls back part and project revision when the receipt write fails", async () => {
    const { db, repo, command, source } = await setup();
    const before = await repo.loadProject(source.projectId);
    const write = vi
      .spyOn(db.operations, "add")
      .mockRejectedValueOnce(
        new DOMException("Storage full", "QuotaExceededError"),
      );
    expect((await repo.execute(command)).status).toBe("failed");
    write.mockRestore();
    expect(await repo.loadProject(source.projectId)).toEqual(before);
    expect(await repo.listParts(source.projectId)).toHaveLength(0);
    expect((await repo.execute(command)).status).toBe("applied");
  });
  it("imports standalone files under fresh identity/revision, with receipt and project CAS", async () => {
    const { repo, command, source } = await setup();
    await repo.execute(command);
    const exported = await repo.exportPart(
      source.projectId,
      command.payload.partId,
      1,
    );
    if (exported.status !== "done") throw new Error(JSON.stringify(exported));
    const token = await repo.fileTokens.registerFile(exported.bytes, () =>
      crypto.randomUUID(),
    );
    const imported: PartImportCommand = {
      commandId: "part.import",
      projectId: source.projectId,
      expectedProjectRevision: (await repo.loadProject(source.projectId))!
        .revision,
      operationId: crypto.randomUUID(),
      actor,
      payload: { fileToken: token, partId: crypto.randomUUID() },
    };
    const result = await repo.execute(imported);
    expect(result.status).toBe("applied");
    expect(await repo.execute(imported)).toEqual(result);
    expect(
      await repo.execute({
        ...imported,
        operationId: crypto.randomUUID(),
        payload: { ...imported.payload, partId: crypto.randomUUID() },
      }),
    ).toMatchObject({ status: "stale", scope: "project" });
    expect(
      await repo.execute({
        ...imported,
        payload: { ...imported.payload, fileToken: { ...token } },
      }),
    ).toMatchObject({ status: "missing" });
    expect(await repo.listParts(source.projectId)).toHaveLength(2);
  });
  it("places independent IDs and dependencies with a single undo after artifact capture", async () => {
    const { repo, session, command, source } = await setup();
    await session.savePart(command);
    const content = validatePartContent(
      (await repo.listParts(source.projectId))[0].content,
    );
    if (!content.ok) throw new Error(JSON.stringify(content));
    const before = session.getState().document!;
    const plan = planPlacement(
      before,
      source.viewId,
      content.value,
      { x: 50, y: 50 },
      () => crypto.randomUUID(),
    );
    if (!plan.ok) throw new Error(JSON.stringify(plan));
    expect((await session.apply(plan.changes, "Place part")).status).toBe(
      "applied",
    );
    expect(session.undoStack).toHaveLength(1);
    expect(session.getState().document!.elements.length).toBe(
      before.elements.length + 1,
    );
    expect((await session.undo()).status).toBe("applied");
    expect(session.getState().document).toEqual(before);
    expect(await repo.listParts(source.projectId)).toHaveLength(1);
    expect((await session.redo()).status).toBe("applied");
  });

  it("counts every immutable revision toward the Library ceiling without partial writes", async () => {
    const { repo, db, command, source } = await setup();
    await repo.execute(command);
    const row = (await repo.listParts(source.projectId))[0];
    await db.parts.bulkAdd(
      Array.from({ length: 99 }, (_, index) => ({
        ...row,
        revision: index + 2,
      })),
    );
    const before = await repo.loadProject(source.projectId);
    expect(
      await repo.execute({
        ...command,
        operationId: crypto.randomUUID(),
        payload: {
          ...command.payload,
          revision: 101,
          expectedLatestRevision: 100,
        },
      }),
    ).toMatchObject({ status: "failed", code: "limit" });
    expect(await repo.loadProject(source.projectId)).toEqual(before);
    expect(await repo.listParts(source.projectId)).toHaveLength(100);
  });

  it("validates backup parts but transfers them into another Library only via standalone import", async () => {
    const { repo, command, source } = await setup();
    await repo.execute(command);
    const backup = await repo.exportProject({
      projectId: source.projectId,
      expectedProjectRevision: (await repo.loadProject(source.projectId))!
        .revision,
    });
    if (backup.status !== "done") throw new Error(JSON.stringify(backup));
    const bundle = JSON.parse(new TextDecoder().decode(backup.bytes));
    expect(bundle.project.parts).toHaveLength(1);
    const token = await repo.fileTokens.registerFile(backup.bytes, () =>
      crypto.randomUUID(),
    );
    const newProjectId = crypto.randomUUID();
    expect(
      (
        await repo.importProject({
          commandId: "project.import",
          operationId: crypto.randomUUID(),
          actor,
          payload: { newProjectId, fileToken: token },
        })
      ).status,
    ).toBe("applied");
    expect(await repo.listParts(newProjectId)).toHaveLength(0);
    bundle.project.parts[0].content.scripts = ["untrusted"];
    const invalidToken = await repo.fileTokens.registerFile(
      new TextEncoder().encode(JSON.stringify(bundle)),
      () => crypto.randomUUID(),
    );
    const rejectedId = crypto.randomUUID();
    expect(
      (
        await repo.importProject({
          commandId: "project.import",
          operationId: crypto.randomUUID(),
          actor,
          payload: { newProjectId: rejectedId, fileToken: invalidToken },
        })
      ).status,
    ).toBe("invalid");
    expect(await repo.loadProject(rejectedId)).toBeNull();
  });
});
