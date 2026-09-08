import { insertBalancer, addServiceInstance, balancedLookup, hasBalancer } from "../domain/routing";
import { experiments } from "../domain/experiments";
import { architectureTemplate } from "../domain/architectureTemplates";
import { visibleSubsystems } from "../domain/subsystems";
import { MAX_SAVED_RUNS, type SavedRun } from "../domain/results";
import { create } from "zustand";
import {
  clone,
  makeNode,
  newProject,
  backgroundJobs,
  architectureDiagram,
  type Project,
  type Graph,
  type ComponentKind,
  type ModelNode,
  type Settings,
} from "../domain/model";
interface Editor {
  project: Project;
  createSubsystem: (name: string, ids: string[]) => void;
  toggleSubsystem: (id: string) => void;
  dissolveSubsystem: (id: string) => void;
  saveRun: (run: SavedRun) => boolean;
  renameRun: (id: string, name: string) => void;
  deleteRun: (id: string) => void;
  restoreRun: (id: string) => void;
  selected: string | null;
  past: Graph[];
  future: Graph[];
  revision: number;
  load: (p: Project) => void;
  select: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
  change: (fn: (g: Graph) => void) => void;
  updateNode: (id: string, patch: Partial<ModelNode>) => void;
  settings: (patch: Partial<Settings>) => void;
  add: (kind: ComponentKind) => void;
  duplicateNode: (id: string) => boolean;
  insertCache: () => void;
  insertBalancer: () => void;
  addServiceInstance: () => void;
  loadExperiment: (id: string) => void;
  loadArchitectureTemplate: (id: string) => boolean;
  useScenario: (scenario: "lookup" | "jobs" | "balanced" | "diagram") => void;
  beginMove: () => void;
  move: (
    positions: { id: string; position: { x: number; y: number } }[],
  ) => void;
  remove: (id: string) => void;
  undo: () => void;
  redo: () => void;
  rename: (name: string) => void;
  checkpoint: (name: string) => void;
  restore: (id: string) => void;
  viewport: (v: Project["viewport"]) => void;
}
function replaceGraph(target: Graph, source: Graph) {
  for (const key of Object.keys(target)) delete (target as unknown as Record<string, unknown>)[key];
  Object.assign(target, clone(source));
}
export const useEditor = create<Editor>((set, get) => ({
  project: newProject(),
  createSubsystem: (name, nodeIds) => {
    const active = visibleSubsystems(get().project);
    const used = new Set(active.flatMap((group) => group.nodeIds));
    const members = [...new Set(nodeIds)].filter(
      (id) =>
        !used.has(id) &&
        get().project.graph.nodes.some((node) => node.id === id),
    );
    if (members.length < 2 || active.length >= 10) return;
    const group = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 80) || "Subsystem",
      nodeIds: members,
      collapsed: false,
    };
    set((s) => ({
      project: {
        ...s.project,
        subsystems: [...active, group],
        updatedAt: Date.now(),
      },
    }));
  },
  toggleSubsystem: (id) =>
    set((s) => ({
      project: {
        ...s.project,
        subsystems: (s.project.subsystems ?? []).map((group) =>
          group.id === id ? { ...group, collapsed: !group.collapsed } : group,
        ),
        updatedAt: Date.now(),
      },
      selected: s.project.subsystems?.find((group) => group.id === id)
        ?.collapsed
        ? s.project.subsystems.find((group) => group.id === id)!.nodeIds[0]
        : id,
    })),
  dissolveSubsystem: (id) =>
    set((s) => ({
      project: {
        ...s.project,
        subsystems: (s.project.subsystems ?? []).filter(
          (group) => group.id !== id,
        ),
        updatedAt: Date.now(),
      },
      selected: null,
    })),
  saveRun: (run) => {
    const runs = get().project.savedRuns ?? [];
    if (runs.some((r) => r.id === run.id)) return true;
    if (runs.length >= MAX_SAVED_RUNS) return false;
    set((s) => ({
      project: {
        ...s.project,
        savedRuns: [...(s.project.savedRuns ?? []), clone(run)],
        updatedAt: Date.now(),
      },
    }));
    return true;
  },
  renameRun: (id, name) =>
    set((s) => ({
      project: {
        ...s.project,
        savedRuns: s.project.savedRuns?.map((r) =>
          r.id === id ? { ...r, name: name.trim().slice(0, 80) || r.name } : r,
        ),
        updatedAt: Date.now(),
      },
    })),
  deleteRun: (id) =>
    set((s) => ({
      project: {
        ...s.project,
        savedRuns: s.project.savedRuns?.filter((r) => r.id !== id),
        updatedAt: Date.now(),
      },
    })),
  restoreRun: (id) => {
    const run = get().project.savedRuns?.find((r) => r.id === id);
    if (run) get().change((g) => replaceGraph(g, run.graph));
  },
  selected: null,
  past: [],
  future: [],
  revision: 0,
  load: (p) =>
    set((s) => ({
      project: clone(p),
      selected: null,
      past: [],
      future: [],
      revision: s.revision + 1,
    })),
  select: (selected) => set({ selected }),
  toggleExpanded: (id) =>
    set((s) => {
      if (!s.project.graph.nodes.some((n) => n.id === id)) return {};
      const expanded = s.project.expandedNodeIds ?? [];
      return {
        selected: id,
        project: {
          ...s.project,
          expandedNodeIds: expanded.includes(id)
            ? expanded.filter((value) => value !== id)
            : [...expanded, id],
          updatedAt: Date.now(),
        },
      };
    }),
  change: (fn) =>
    set((s) => {
      const graph = clone(s.project.graph);
      fn(graph);
      return {
        project: { ...s.project, graph, updatedAt: Date.now() },
        past: [...s.past.slice(-49), clone(s.project.graph)],
        future: [],
        revision: s.revision + 1,
      };
    }),
  beginMove: () =>
    set((s) => ({
      past: [...s.past.slice(-49), clone(s.project.graph)],
      future: [],
    })),
  move: (positions) =>
    set((s) => ({
      project: {
        ...s.project,
        graph: {
          ...s.project.graph,
          nodes: s.project.graph.nodes.map((n) => {
            const updated = positions.find((p) => p.id === n.id);
            return updated ? { ...n, position: updated.position } : n;
          }),
        },
        updatedAt: Date.now(),
      },
    })),
  updateNode: (id, patch) =>
    get().change((g) => {
      const n = g.nodes.find((n) => n.id === id);
      if (n) Object.assign(n, patch);
    }),
  settings: (patch) =>
    get().change((g) => {
      Object.assign(g.settings, patch);
      const profile = g.settings.profile;
      if (patch.duration !== undefined && profile?.kind === "burst") {
        profile.end = Math.min(profile.end, g.settings.duration);
        profile.start = Math.min(profile.start, Math.max(0, profile.end - 0.1));
      }
    }),
  insertBalancer: () => get().change(insertBalancer),
  addServiceInstance: () => {
    let id: string | undefined;
    get().change((g) => { id = addServiceInstance(g)?.id; });
    if (id) get().select(id);
  },
  add: (kind) => {
    if (get().project.graph.scenario === "diagram" && get().project.graph.nodes.length >= 100) return;
    if (kind === "balancer") { get().insertBalancer(); return; }
    if (kind === "service" && hasBalancer(get().project.graph)) { get().addServiceInstance(); return; }
    const node = makeNode(
      kind,
      220 + get().project.graph.nodes.length * 35,
      350,
    );
    get().change((g) => {
      g.nodes.push(node);
    });
    set({ selected: node.id });
  },
  duplicateNode: (id) => {
    const state = get();
    const graph = state.project.graph;
    if (graph.scenario !== "diagram" || graph.nodes.length >= 100) return false;
    const source = graph.nodes.find((node) => node.id === id);
    if (!source) return false;
    let step = 1;
    let position = {
      x: source.position.x + 40,
      y: source.position.y + 40,
    };
    while (
      graph.nodes.some(
        (node) => node.position.x === position.x && node.position.y === position.y,
      )
    ) {
      step += 1;
      position = {
        x: source.position.x + 40 * step,
        y: source.position.y + 40 * step,
      };
    }
    const copy: ModelNode = {
      ...clone(source),
      id: crypto.randomUUID(),
      name: `${source.name.slice(0, 75)} copy`,
      position,
    };
    get().change((draft) => {
      draft.nodes.push(copy);
    });
    set({ selected: copy.id });
    return true;
  },
  loadExperiment: (id) => {
    const experiment = experiments.find((item) => item.id === id);
    if (!experiment) {
      set((s) => ({
        project: {
          ...s.project,
          graph: { ...s.project.graph, guideId: undefined },
          updatedAt: Date.now(),
        },
      }));
      return;
    }
    const graph = experiment.build();
    graph.guideId = id;
    get().change((g) => {
      replaceGraph(g, graph);
    });
    set((s) => ({
      project: s.project,
      selected: null,
    }));
  },
  loadArchitectureTemplate: (id) => {
    const template = architectureTemplate(id);
    if (!template) return false;
    const graph = template.create();
    get().change((draft) => replaceGraph(draft, graph));
    set({ selected: null });
    return true;
  },
  useScenario: (scenario) => {
    const fresh = scenario === "jobs" ? backgroundJobs() : scenario === "balanced" ? balancedLookup() : scenario === "diagram" ? architectureDiagram() : newProject().graph;
    get().change((g) => {
      replaceGraph(g, fresh);
    });
    get().select(null);
  },
  insertCache: () => {
    if (get().project.graph.nodes.some((n) => n.kind === "cache")) return;
    get().checkpoint("Before cache");
    const serviceNode = get().project.graph.nodes.find(
      (n) => n.kind === "service",
    );
    if (!serviceNode) return;
    const node = makeNode(
      "cache",
      serviceNode.position.x + 305,
      serviceNode.position.y,
    );
    get().change((g) => {
      const service = g.nodes.find((n) => n.kind === "service"),
        db = g.nodes.find((n) => n.kind === "database");
      if (!service || !db) return;
      db.position = { x: node.position.x + 305, y: node.position.y };
      g.nodes.push(node);
      const services = g.nodes.filter((n) => n.kind === "service");
      g.edges = g.edges.filter((e) => !services.some((n) => e.source === n.id && e.target === db.id));
      g.edges.push(
        ...services.map((n) => ({ id: crypto.randomUUID(), source: n.id, target: node.id })),
        { id: crypto.randomUUID(), source: node.id, target: db.id },
      );
    });
    get().checkpoint("After cache");
    set({ selected: node.id });
  },
  remove: (id) => {
    get().change((g) => {
      g.nodes = g.nodes.filter((n) => n.id !== id);
      g.edges = g.edges.filter((e) => e.source !== id && e.target !== id);
    });
    set({ selected: null });
  },
  undo: () =>
    set((s) =>
      s.past.length
        ? (() => {
            const graph = s.past.at(-1)!;
            return {
            project: {
              ...s.project,
              graph,
              updatedAt: Date.now(),
            },
            past: s.past.slice(0, -1),
            future: [s.project.graph, ...s.future],
            revision: s.revision + 1,
            selected: graph.nodes.some((node) => node.id === s.selected) ? s.selected : null,
          }; })()
        : {},
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? (() => {
            const graph = s.future[0];
            return {
            project: {
              ...s.project,
              graph,
              updatedAt: Date.now(),
            },
            past: [...s.past, s.project.graph],
            future: s.future.slice(1),
            revision: s.revision + 1,
            selected: graph.nodes.some((node) => node.id === s.selected) ? s.selected : null,
          }; })()
        : {},
    ),
  rename: (name) =>
    set((s) => ({ project: { ...s.project, name, updatedAt: Date.now() } })),
  checkpoint: (name) =>
    set((s) => ({
      project: {
        ...s.project,
        checkpoints: [
          ...s.project.checkpoints.slice(-49),
          {
            id: crypto.randomUUID(),
            name,
            graph: clone(s.project.graph),
            createdAt: Date.now(),
          },
        ],
        updatedAt: Date.now(),
      },
    })),
  restore: (id) => {
    const checkpoint = get().project.checkpoints.find((c) => c.id === id);
    if (checkpoint)
      get().change((g) => replaceGraph(g, checkpoint.graph));
  },
  viewport: (viewport) =>
    set((s) => ({
      project: { ...s.project, viewport, updatedAt: Date.now() },
    })),
}));
