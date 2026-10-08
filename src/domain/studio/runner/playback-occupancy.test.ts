import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Document } from "../model";
import { checkReadiness } from "../readiness";
import { ScenarioRunner } from "./scenario-runner";
import type { FlowRecord } from "./types";
import { PlaybackStore } from "../../../features/runs/playback";

const s06 = JSON.parse(
  readFileSync(join(process.cwd(), "src/features/entry/examples/s06.json"), "utf8"),
) as Document;

describe("recorded occupancy through broker delivery", () => {
  it("includes a processor entered directly by a workload without inventing a transit leg", async () => {
    const processor = s06.elements.find(
      (element) => element.label === "Checkout API A",
    )!;
    if (processor.behavior?.kind !== "resource")
      throw new Error("S06 processor is not a resource");
    const entry = {
      elementId: processor.id,
      portId: processor.behavior.entryPortId,
    };
    const doc: Document = {
      ...s06,
      elements: s06.elements.map((element) =>
        element.id === processor.id && element.behavior?.kind === "resource"
          ? {
              ...element,
              behavior: {
                ...element.behavior,
                config: { ...element.behavior.config, capacity: 20 },
              },
            }
          : element,
      ),
      scenarios: s06.scenarios
        .slice(0, 1)
        .map((scenario) => ({
          ...scenario,
          workloads: scenario.workloads.map((workload) => ({
            ...workload,
            entry,
            emission: {
              mode: "bulk" as const,
              requests: 6,
              arrival: "instant" as const,
            },
          })),
        })),
    };
    expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
    const runner = new ScenarioRunner(
      doc,
      doc.scenarios[0].id,
      "direct-occupancy",
    );
    const flow: FlowRecord[] = [];
    while (await runner.step()) flow.push(...runner.drainFlow());
    flow.push(...runner.drainFlow());
    expect(runner.getResult().status).toBe("completed");
    const direct = flow.filter(
      (record) =>
        record.connectionId === null && record.elementId === processor.id,
    );
    expect(
      direct.filter((record) => record.phase === "processing"),
    ).toHaveLength(6);
    expect(direct.filter((record) => record.phase === "released")).toHaveLength(
      6,
    );
    expect(
      direct.some(
        (record) => record.phase === "sent" || record.phase === "response",
      ),
    ).toBe(false);
    const store = new PlaybackStore({
      connectionTargets: new Map(
        doc.connections.map((connection) => [
          connection.id,
          connection.target.elementId,
        ]),
      ),
      historyMs: null,
    });
    store.ingestFlow(flow);
    expect(store.stateAt(0).nodes.get(processor.id)?.active).toBe(6);
    expect(store.stateAt(runner.simulatedMs).nodes.size).toBe(0);
  });

  it("retains every connection association when more than 5000 operations are concurrently in transit", async () => {
    const doc: Document = {
      ...s06,
      elements: s06.elements.map((element, index) =>
        index === 0 && element.behavior?.kind === "resource"
          ? {
              ...element,
              behavior: {
                ...element.behavior,
                config: {
                  ...element.behavior.config,
                  concurrency: 1024,
                  queueLimit: 6000,
                },
              },
            }
          : element,
      ),
      connections: s06.connections.map((connection) =>
        connection.kind === "call" &&
        connection.source.elementId === s06.elements[0].id
          ? { ...connection, config: { ...connection.config, latencyMs: 1000 } }
          : connection,
      ),
      scenarios: s06.scenarios
        .slice(0, 1)
        .map((scenario) => ({
          ...scenario,
          budgets: { ...scenario.budgets, maxEvents: 500000 },
          workloads: scenario.workloads.map((workload) => ({
            ...workload,
            emission: {
              mode: "bulk" as const,
              requests: 5200,
              arrival: "instant" as const,
            },
          })),
        })),
    };
    expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
    const runner = new ScenarioRunner(doc, doc.scenarios[0].id, "many-transit");
    const flow: FlowRecord[] = [];
    while (await runner.step()) flow.push(...runner.drainFlow());
    flow.push(...runner.drainFlow());
    expect(runner.getResult().status).toBe("completed");
    const sent = flow.filter(
      (record) => record.phase === "sent" && record.atMs < 1000,
    );
    expect(sent).toHaveLength(5200);
    const released = new Set(
      flow
        .filter(
          (record) =>
            record.phase === "released" && record.connectionId !== null,
        )
        .map((record) => record.key),
    );
    expect(sent.filter((record) => !released.has(record.key))).toEqual([]);
  });

  it("records broker dequeue, consumer transit and activity, then clears every node at the real run end", async () => {
    const doc: Document = {
      ...s06,
      elements: s06.elements.map((element) =>
        element.label === "Fulfilment worker" &&
        element.behavior?.kind === "resource"
          ? {
              ...element,
              behavior: {
                ...element.behavior,
                config: {
                  ...element.behavior.config,
                  concurrency: 1,
                  capacity: 20,
                },
              },
            }
          : element,
      ),
      scenarios: s06.scenarios
        .slice(0, 1)
        .map((scenario) => ({
          ...scenario,
          workloads: scenario.workloads.map((workload) => ({
            ...workload,
            emission: {
              mode: "bulk" as const,
              requests: 60,
              arrival: "instant" as const,
            },
          })),
        })),
    };
    expect(checkReadiness(doc, doc.scenarios[0].id).ready).toBe(true);
    const runner = new ScenarioRunner(doc, doc.scenarios[0].id, "occupancy");
    const flow: FlowRecord[] = [];
    while (await runner.step()) flow.push(...runner.drainFlow());
    flow.push(...runner.drainFlow());
    expect(runner.getResult().status).toBe("completed");
    const store = new PlaybackStore({
      connectionTargets: new Map(
        doc.connections.map((connection) => [
          connection.id,
          connection.target.elementId,
        ]),
      ),
      historyMs: null,
    });
    store.ingestFlow(flow);
    const broker = doc.elements.find(
      (element) => element.label === "Order queue",
    )!;
    const worker = doc.elements.find(
      (element) => element.label === "Fulfilment worker",
    )!;
    const delivery = doc.connections.find(
      (connection) =>
        connection.source.elementId === broker.id &&
        connection.target.elementId === worker.id,
    )!;
    const queued = flow.find(
      (record) =>
        record.phase === "queued" &&
        doc.connections.find(
          (connection) => connection.id === record.connectionId,
        )?.target.elementId === broker.id,
    )!;
    expect(queued).toBeDefined();
    expect(
      store.stateAt(queued.atMs).nodes.get(broker.id)?.queued,
    ).toBeGreaterThan(0);
    const dequeued = flow.find(
      (record) =>
        record.key === queued.key &&
        record.phase === "released" &&
        record.atMs >= queued.atMs,
    )!;
    expect(dequeued).toBeDefined();
    const child = flow.find(
      (record) =>
        record.phase === "sent" &&
        record.connectionId === delivery.id &&
        record.key.startsWith(`${queued.key}>`),
    )!;
    expect(child).toBeDefined();
    expect(child.atMs).toBe(dequeued.atMs);
    expect(child.arriveAtMs).toBeGreaterThan(child.atMs);
    const transit = store
      .stateAt((child.atMs + child.arriveAtMs!) / 2)
      .legs.find((leg) => leg.key === child.key);
    expect(transit).toMatchObject({
      connectionId: delivery.id,
      direction: "out",
      progress: 0.5,
    });
    const processing = flow.find(
      (record) => record.key === child.key && record.phase === "processing",
    )!;
    expect(processing).toBeDefined();
    expect(
      store.stateAt(processing.atMs).nodes.get(worker.id)?.active,
    ).toBeGreaterThan(0);
    expect(
      flow.some(
        (record) => record.key === child.key && record.phase === "released",
      ),
    ).toBe(true);
    const finalMs = Math.max(
      runner.simulatedMs,
      ...flow.map((record) => record.atMs),
    );
    expect(store.stateAt(finalMs).nodes.size).toBe(0);
    expect(store.stateAt(finalMs).legs).toEqual([]);
    // A returning call must still be recorded even though its callee operation is being released.
    expect(flow.some((record) => record.phase === "response")).toBe(true);
  });
});
