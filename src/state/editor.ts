import { insertBalancer, addServiceInstance, balancedLookup, hasBalancer } from "../domain/routing";
import { experiments } from "../domain/experiments";
import { architectureTemplate } from "../domain/architectureTemplates";
import { visibleSubsystems } from "../domain/subsystems";
import { MAX_SAVED_RUNS, type SavedRun } from "../domain/results";
import { create } from "zustand";
import { architectureSnapshot, MAX_REVISIONS, validateRevisionDetails, type ArchitectureSnapshot, type RevisionDetails } from "../domain/revisions";
import { MAX_NOTES, validateNotes, type CanvasNote, type NoteKind } from "../domain/notes";
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
  saveRevision: (details: RevisionDetails) => boolean;
  finalizeRevision: (id: string) => boolean;
  restoreRevision: (id: string) => void;
  addNote: (position: { x: number; y: number }, kind?: NoteKind) => void;
  updateNote: (id: string, patch: Partial<Pick<CanvasNote, "title" | "body" | "kind" | "collapsed" | "attachment" | "position">>) => boolean;
  removeNote: (id: string) => void;
  project: Project;
  createSubsystem: (name: string, ids: string[]) => void;
  toggleSubsystem: (id: string) => void;
  dissolveSubsystem: (id: string) => void;
  saveRun: (run: SavedRun) => boolean;
  renameRun: (id: string, name: string) => void;
  deleteRun: (id: string) => void;
  restoreRun: (id: string) => void;
  selected: string | null;
  selectedNodeIds: string[];
  selectionMode: boolean;
  past: { graph: Graph; view?: Omit<ArchitectureSnapshot, "graph"> }[];
  future: { graph: Graph; view?: Omit<ArchitectureSnapshot, "graph"> }[];
  revision: number;
  load: (p: Project) => void;
  select: (id: string | null, additive?: boolean) => void;
  setSelectionMode: (active: boolean) => void;
  applyNodePositions: (positions: { id: string; position: { x: number; y: number } }[]) => boolean;
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
  saveRevision: (details) => {
    const clean = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()])) as unknown as RevisionDetails;
    const project = get().project;
    if (validateRevisionDetails(clean).length || (project.revisions?.length ?? 0) >= MAX_REVISIONS) return false;
    const revision = { ...architectureSnapshot(project), ...clean, id: crypto.randomUUID(), createdAt: Date.now(), status: "draft" as const };
    set({ project: { ...project, revisions: [...(project.revisions ?? []), revision], updatedAt: Date.now() } });
    return true;
  },
  finalizeRevision: (id) => {
    const project = get().project;
    const source = project.revisions?.find(r => r.id === id);
    if (!source || source.status !== "draft" || project.revisions!.some(r => r.status === "final" && r.sourceId === id) || project.revisions!.length >= MAX_REVISIONS) return false;
    const revision = { ...clone(source), id: crypto.randomUUID(), sourceId: id, createdAt: Date.now(), status: "final" as const };
    set({ project: { ...project, revisions: [...project.revisions!, revision], updatedAt: Date.now() } });
    return true;
  },
  restoreRevision: (id) => {
    const state = get();
    const source = state.project.revisions?.find(r => r.id === id);
    if (!source) return;
    const { graph, ...view } = architectureSnapshot(state.project);
    set({ project: { ...state.project, graph: clone(source.graph), subsystems: clone(source.subsystems), expandedNodeIds: [...source.expandedNodeIds], updatedAt: Date.now() }, past: [...state.past.slice(-49), { graph, view }], future: [], revision: state.revision + 1, selected: null, selectedNodeIds: [], selectionMode: false });
  },
  addNote: (position, kind = "general") => {
    const graph = get().project.graph;
    if (graph.scenario !== "diagram" || (graph.notes?.length ?? 0) >= MAX_NOTES) return;
    const note: CanvasNote = { id: crypto.randomUUID(), kind, title: "Untitled note", body: "", position, collapsed: false };
    if (validateNotes([note]).length) return;
    get().change(g => { (g.notes ??= []).push(note); });
    set({ selected: note.id, selectedNodeIds: [], selectionMode: false });
  },
  updateNote: (id, patch) => {
    const graph = get().project.graph;
    const note = graph.notes?.find(n => n.id === id);
    if (graph.scenario !== "diagram" || !note) return false;
    const next = { ...note, ...patch };
    if (validateNotes([next]).length || JSON.stringify(note) === JSON.stringify(next)) return false;
    get().change(g => { Object.assign(g.notes!.find(n => n.id === id)!, patch); });
    return true;
  },
  removeNote: id => {
    if (!get().project.graph.notes?.some(n => n.id === id)) return;
    get().change(g => { g.notes = g.notes?.filter(n => n.id !== id); });
    set({ selected: null, selectedNodeIds: [] });
  },
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
      selectedNodeIds: [],
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
      selectedNodeIds: [],
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
    if (run) {
      get().change((g) => replaceGraph(g, run.graph));
      set({ selected: null, selectedNodeIds: [], selectionMode: false });
    }
  },
  selected: null,
  selectedNodeIds: [],
  selectionMode: false,
  past: [],
  future: [],
  revision: 0,
  load: (p) =>
    set((s) => ({
      project: clone(p),
      selected: null,
      selectedNodeIds: [],
      selectionMode: false,
      past: [],
      future: [],
      revision: s.revision + 1,
    })),
  select: (selected, additive = false) =>
    set((state) => {
      const hidden = new Set(visibleSubsystems(state.project).filter((group) => group.collapsed).flatMap((group) => group.nodeIds));
      const isNode = !!selected && !hidden.has(selected) && state.project.graph.nodes.some((node) => node.id === selected);
      if (state.project.graph.scenario === "diagram" && state.project.graph.notes?.some(note => note.id === selected))
        return { selected, selectedNodeIds: [] };
      if (state.project.graph.scenario === "diagram" && !isNode)
        return { selected: null, selectedNodeIds: [] };
      if (!isNode || state.project.graph.scenario !== "diagram")
        return { selected, selectedNodeIds: [] };
      if (!additive) return { selected, selectedNodeIds: [selected] };
      const selectedNodeIds = state.selectedNodeIds.includes(selected)
        ? state.selectedNodeIds.filter((id) => id !== selected)
        : [...state.selectedNodeIds, selected];
      return {
        selectedNodeIds,
        selected: selectedNodeIds.length === 1 ? selectedNodeIds[0] : null,
      };
    }),
  setSelectionMode: (selectionMode) => set({ selectionMode }),
  applyNodePositions: (positions) => {
    const state = get();
    if (state.project.graph.scenario !== "diagram" || positions.length === 0 || state.selectedNodeIds.length < 2) return false;
    const ids = positions.map((item) => item.id);
    const hidden = new Set(visibleSubsystems(state.project).filter((group) => group.collapsed).flatMap((group) => group.nodeIds));
    if (new Set(ids).size !== ids.length || positions.some((item) =>
      !Number.isFinite(item.position.x) ||
      !Number.isFinite(item.position.y) ||
      hidden.has(item.id) ||
      !state.selectedNodeIds.includes(item.id) ||
      !state.project.graph.nodes.some((node) => node.id === item.id))) return false;
    const changed = positions.some((item) => {
      const node = state.project.graph.nodes.find((candidate) => candidate.id === item.id)!;
      return node.position.x !== item.position.x || node.position.y !== item.position.y;
    });
    if (!changed) return false;
    set((current) => ({
      project: {
        ...current.project,
        graph: {
          ...current.project.graph,
          nodes: current.project.graph.nodes.map((node) => {
            const update = positions.find((item) => item.id === node.id);
            return update ? { ...node, position: update.position } : node;
          }),
        },
        updatedAt: Date.now(),
      },
      past: [...current.past.slice(-49), { graph: clone(current.project.graph) }],
      future: [],
      revision: current.revision + 1,
    }));
    return true;
  },
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
        past: [...s.past.slice(-49), { graph: clone(s.project.graph) }],
        future: [],
        revision: s.revision + 1,
      };
    }),
  beginMove: () =>
    set((s) => ({
      past: [...s.past.slice(-49), { graph: clone(s.project.graph) }],
      future: [],
    })),
  move: (positions) =>
    set((s) => ({
      project: {
        ...s.project,
        graph: {
          ...s.project.graph,
          ...(s.project.graph.notes ? { notes: s.project.graph.notes.map(note => {
            const update = positions.find(p => p.id === note.id);
            return update && Number.isFinite(update.position.x) && Number.isFinite(update.position.y) && Math.abs(update.position.x) <= 1_000_000 && Math.abs(update.position.y) <= 1_000_000 ? { ...note, position: update.position } : note;
          }) } : {}),
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
    set({ selected: node.id, selectedNodeIds: get().project.graph.scenario === "diagram" ? [node.id] : [] });
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
    set({ selected: copy.id, selectedNodeIds: [copy.id] });
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
      selectedNodeIds: [],
      selectionMode: false,
    }));
  },
  loadArchitectureTemplate: (id) => {
    const template = architectureTemplate(id);
    if (!template) return false;
    const graph = template.create();
    get().change((draft) => replaceGraph(draft, graph));
    set({ selected: null, selectedNodeIds: [], selectionMode: false });
    return true;
  },
  useScenario: (scenario) => {
    const fresh = scenario === "jobs" ? backgroundJobs() : scenario === "balanced" ? balancedLookup() : scenario === "diagram" ? architectureDiagram() : newProject().graph;
    get().change((g) => {
      replaceGraph(g, fresh);
    });
    get().select(null);
    set({ selectionMode: false });
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
    set({ selected: null, selectedNodeIds: [] });
  },
  undo: () =>
    set((s) =>
      s.past.length
        ? (() => {
            const { graph, view } = s.past.at(-1)!;
            return {
            project: {
              ...s.project,
              ...view,
              graph,
              updatedAt: Date.now(),
            },
            past: s.past.slice(0, -1),
            future: [{ graph: s.project.graph, ...(view ? { view: { subsystems: clone(s.project.subsystems ?? []), expandedNodeIds: [...(s.project.expandedNodeIds ?? [])] } } : {}) }, ...s.future],
            revision: s.revision + 1,
            selected: graph.nodes.some((node) => node.id === s.selected) || graph.notes?.some(note => note.id === s.selected) ? s.selected : null,
            selectedNodeIds: s.selectedNodeIds.filter((id) => graph.nodes.some((node) => node.id === id)),
          }; })()
        : {},
    ),
  redo: () =>
    set((s) =>
      s.future.length
        ? (() => {
            const { graph, view } = s.future[0];
            return {
            project: {
              ...s.project,
              ...view,
              graph,
              updatedAt: Date.now(),
            },
            past: [...s.past, { graph: s.project.graph, ...(view ? { view: { subsystems: clone(s.project.subsystems ?? []), expandedNodeIds: [...(s.project.expandedNodeIds ?? [])] } } : {}) }],
            future: s.future.slice(1),
            revision: s.revision + 1,
            selected: graph.nodes.some((node) => node.id === s.selected) || graph.notes?.some(note => note.id === s.selected) ? s.selected : null,
            selectedNodeIds: s.selectedNodeIds.filter((id) => graph.nodes.some((node) => node.id === id)),
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
    if (checkpoint) {
      get().change((g) => replaceGraph(g, checkpoint.graph));
      set({ selected: null, selectedNodeIds: [], selectionMode: false });
    }
  },
  viewport: (viewport) =>
    set((s) => ({
      project: { ...s.project, viewport, updatedAt: Date.now() },
    })),
}));
