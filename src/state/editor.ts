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
  supportsFreeCanvas,
  isOpenGraph,
  type Project,
  type Graph,
  type ComponentKind,
  type ModelNode,
  type Settings,
} from "../domain/model";
import { makeOpenNode, newOpenProject } from "../domain/openGraph";
import { defaultWorkload } from "../domain/behaviorDefaults";
import { groupingReason } from "../domain/grouping";
import type { WorkloadDefinition } from "../domain/execution";

export interface SelectionSnapshot {
  selected: string | null;
  selectedNodeIds: string[];
}

export interface HistoryEntry {
  graph: Graph;
  view?: Omit<ArchitectureSnapshot, "graph">;
  selection?: SelectionSnapshot;
}

interface Editor {
  readOnly: boolean;
  saveRevision: (details: RevisionDetails) => boolean;
  finalizeRevision: (id: string) => boolean;
  restoreRevision: (id: string) => void;
  addNote: (position: { x: number; y: number }, kind?: NoteKind) => void;
  updateNote: (id: string, patch: Partial<Pick<CanvasNote, "title" | "body" | "kind" | "collapsed" | "attachment" | "position">>) => boolean;
  removeNote: (id: string) => void;
  project: Project;
  createSubsystem: (name: string, ids: string[]) => boolean;
  renameSubsystem: (id: string, name: string) => boolean;
  toggleSubsystem: (id: string) => void;
  dissolveSubsystem: (id: string) => void;
  saveRun: (run: SavedRun) => boolean;
  renameRun: (id: string, name: string) => void;
  deleteRun: (id: string) => void;
  restoreRun: (id: string) => void;
  selected: string | null;
  selectedNodeIds: string[];
  selectionMode: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  revision: number;
  load: (p: Project, readOnly?: boolean) => void;
  select: (id: string | null, additive?: boolean) => void;
  selectNodes: (ids: string[]) => void;
  setSelectionMode: (active: boolean) => void;
  applyNodePositions: (positions: { id: string; position: { x: number; y: number } }[]) => boolean;
  toggleExpanded: (id: string) => void;
  change: (fn: (g: Graph) => void) => void;
  updateNode: (id: string, patch: Partial<ModelNode>) => void;
  settings: (patch: Partial<Settings>) => void;
  add: (kind: ComponentKind, position?: { x: number; y: number }) => boolean | void;
  duplicateNode: (id: string) => boolean;
  generateTraffic: (id: string) => boolean;
  updateWorkload: (id: string, patch: Partial<WorkloadDefinition>) => void;
  removeWorkload: (id: string) => void;
  replaceSystem: (graph: Graph) => void;
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
  checkpoint: (name: string) => boolean;
  restore: (id: string) => void;
  viewport: (v: Project["viewport"]) => void;
}

function replaceGraph(target: Graph, source: Graph) {
  for (const key of Object.keys(target)) delete (target as unknown as Record<string, unknown>)[key];
  Object.assign(target, clone(source));
}

export const useEditor = create<Editor>((rawSet, get) => {
  const set: typeof rawSet = (partial) => {
    rawSet((state) => {
      const update = typeof partial === "function" ? (partial as (s: Editor) => Partial<Editor>)(state) : partial;
      if (state.readOnly) {
        const allowed: Partial<Editor> = {};
        if ("selected" in update) allowed.selected = update.selected;
        if ("selectedNodeIds" in update) allowed.selectedNodeIds = update.selectedNodeIds;
        if ("selectionMode" in update) allowed.selectionMode = update.selectionMode;
        return allowed;
      }
      return update;
    });
  };

  return {
    readOnly: false,
    project: newOpenProject(),
    saveRevision: (details) => {
      if (get().readOnly) return false;
      const clean = Object.fromEntries(Object.entries(details).map(([key, value]) => [key, value.trim()])) as unknown as RevisionDetails;
      const project = get().project;
      if (validateRevisionDetails(clean).length || (project.revisions?.length ?? 0) >= MAX_REVISIONS) return false;
      const revision = { ...architectureSnapshot(project), ...clean, id: crypto.randomUUID(), createdAt: Date.now(), status: "draft" as const };
      set({ project: { ...project, revisions: [...(project.revisions ?? []), revision], updatedAt: Date.now() } });
      return true;
    },
    finalizeRevision: (id) => {
      if (get().readOnly) return false;
      const project = get().project;
      const source = project.revisions?.find(r => r.id === id);
      if (!source || source.status !== "draft" || project.revisions!.some(r => r.status === "final" && r.sourceId === id) || project.revisions!.length >= MAX_REVISIONS) return false;
      const revision = { ...clone(source), id: crypto.randomUUID(), sourceId: id, createdAt: Date.now(), status: "final" as const };
      set({ project: { ...project, revisions: [...project.revisions!, revision], updatedAt: Date.now() } });
      return true;
    },
    restoreRevision: (id) => {
      if (get().readOnly) return;
      const state = get();
      const source = state.project.revisions?.find(r => r.id === id);
      if (!source) return;
      const { graph, ...view } = architectureSnapshot(state.project);
      set({ project: { ...state.project, graph: clone(source.graph), subsystems: clone(source.subsystems), expandedNodeIds: [...source.expandedNodeIds], updatedAt: Date.now() }, past: [...state.past.slice(-49), { graph, view }], future: [], revision: state.revision + 1, selected: null, selectedNodeIds: [], selectionMode: false });
    },
    addNote: (position, kind = "general") => {
      if (get().readOnly) return;
      const graph = get().project.graph;
      if (!supportsFreeCanvas(graph) || (graph.notes?.length ?? 0) >= MAX_NOTES) return;
      const note: CanvasNote = { id: crypto.randomUUID(), kind, title: "Untitled note", body: "", position, collapsed: false };
      if (validateNotes([note]).length) return;
      get().change(g => { (g.notes ??= []).push(note); });
      set({ selected: note.id, selectedNodeIds: [], selectionMode: false });
    },
    updateNote: (id, patch) => {
      if (get().readOnly) return false;
      const graph = get().project.graph;
      const note = graph.notes?.find(n => n.id === id);
      if (!supportsFreeCanvas(graph) || !note) return false;
      const next = { ...note, ...patch };
      if (validateNotes([next]).length || JSON.stringify(note) === JSON.stringify(next)) return false;
      get().change(g => { Object.assign(g.notes!.find(n => n.id === id)!, patch); });
      return true;
    },
    removeNote: id => {
      if (get().readOnly) return;
      if (!get().project.graph.notes?.some(n => n.id === id)) return;
      get().change(g => { g.notes = g.notes?.filter(n => n.id !== id); });
      set({ selected: null, selectedNodeIds: [] });
    },
    createSubsystem: (name, nodeIds) => {
      if (get().readOnly) return false;
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 80) return false;
      const state = get();
      const reason = groupingReason(state.project, nodeIds);
      if (reason !== null) return false;

      const exactMembers = [...nodeIds];
      const group = {
        id: crypto.randomUUID(),
        name: trimmed,
        nodeIds: exactMembers,
        collapsed: false,
      };

      const { graph, ...view } = architectureSnapshot(state.project);
      const selection: SelectionSnapshot = { selected: state.selected, selectedNodeIds: [...state.selectedNodeIds] };

      set((s) => ({
        project: {
          ...s.project,
          subsystems: [...(s.project.subsystems ?? []), group],
          updatedAt: Date.now(),
        },
        selected: group.id,
        selectedNodeIds: [],
        past: [...s.past.slice(-49), { graph, view, selection }],
        future: [],
        revision: s.revision + 1,
      }));
      return true;
    },
    renameSubsystem: (id, name) => {
      if (get().readOnly) return false;
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 80) return false;
      const state = get();
      const group = state.project.subsystems?.find((g) => g.id === id);
      if (!group || group.name === trimmed) return false;

      const { graph, ...view } = architectureSnapshot(state.project);
      const selection: SelectionSnapshot = { selected: state.selected, selectedNodeIds: [...state.selectedNodeIds] };

      set((s) => ({
        project: {
          ...s.project,
          subsystems: (s.project.subsystems ?? []).map((g) =>
            g.id === id ? { ...g, name: trimmed } : g,
          ),
          updatedAt: Date.now(),
        },
        past: [...s.past.slice(-49), { graph, view, selection }],
        future: [],
        revision: s.revision + 1,
      }));
      return true;
    },
    toggleSubsystem: (id) => {
      if (get().readOnly) return;
      const state = get();
      const exists = state.project.subsystems?.some((g) => g.id === id);
      if (!exists) return;

      const { graph, ...view } = architectureSnapshot(state.project);
      const selection: SelectionSnapshot = { selected: state.selected, selectedNodeIds: [...state.selectedNodeIds] };

      set((s) => ({
        project: {
          ...s.project,
          subsystems: (s.project.subsystems ?? []).map((group) =>
            group.id === id ? { ...group, collapsed: !group.collapsed } : group,
          ),
          updatedAt: Date.now(),
        },
        selected: id,
        selectedNodeIds: [],
        past: [...s.past.slice(-49), { graph, view, selection }],
        future: [],
        revision: s.revision + 1,
      }));
    },
    dissolveSubsystem: (id) => {
      if (get().readOnly) return;
      const state = get();
      const exists = state.project.subsystems?.some((g) => g.id === id);
      if (!exists) return;

      const { graph, ...view } = architectureSnapshot(state.project);
      const selection: SelectionSnapshot = { selected: state.selected, selectedNodeIds: [...state.selectedNodeIds] };

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
        past: [...s.past.slice(-49), { graph, view, selection }],
        future: [],
        revision: s.revision + 1,
      }));
    },
    saveRun: (run) => {
      if (get().readOnly) return false;
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
    renameRun: (id, name) => {
      if (get().readOnly) return;
      set((s) => ({
        project: {
          ...s.project,
          savedRuns: s.project.savedRuns?.map((r) =>
            r.id === id ? { ...r, name: name.trim().slice(0, 80) || r.name } : r,
          ),
          updatedAt: Date.now(),
        },
      }));
    },
    deleteRun: (id) => {
      if (get().readOnly) return;
      set((s) => ({
        project: {
          ...s.project,
          savedRuns: s.project.savedRuns?.filter((r) => r.id !== id),
          updatedAt: Date.now(),
        },
      }));
    },
    restoreRun: (id) => {
      if (get().readOnly) return;
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
    load: (p, readOnly = false) =>
      rawSet((s) => ({
        readOnly,
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
        const freeCanvas = supportsFreeCanvas(state.project.graph);
        const hidden = new Set(
          visibleSubsystems(state.project)
            .filter((group) => group.collapsed)
            .flatMap((group) => group.nodeIds),
        );
        const isNode =
          !!selected &&
          !hidden.has(selected) &&
          state.project.graph.nodes.some((node) => node.id === selected);

        if (
          freeCanvas &&
          state.project.graph.notes?.some((note) => note.id === selected)
        )
          return { selected, selectedNodeIds: [] };

        const isShell =
          !!selected &&
          (state.project.subsystems ?? []).some((group) => group.id === selected);
        if (isShell) {
          return { selected, selectedNodeIds: [] };
        }

        if (freeCanvas && !isNode) return { selected: null, selectedNodeIds: [] };
        if (!isNode || !freeCanvas) return { selected, selectedNodeIds: [] };
        if (!additive) return { selected, selectedNodeIds: [selected] };
        const selectedNodeIds = state.selectedNodeIds.includes(selected)
          ? state.selectedNodeIds.filter((id) => id !== selected)
          : [...state.selectedNodeIds, selected];
        return {
          selectedNodeIds,
          selected: selectedNodeIds.length === 1 ? selectedNodeIds[0] : null,
        };
      }),
    selectNodes: (ids) =>
      set((state) => {
        const hidden = new Set(
          visibleSubsystems(state.project)
            .filter((group) => group.collapsed)
            .flatMap((group) => group.nodeIds),
        );
        const visibleNodes = new Set(
          state.project.graph.nodes
            .filter((n) => !hidden.has(n.id))
            .map((n) => n.id),
        );
        const unique = [...new Set(ids)].filter((id) => visibleNodes.has(id));
        if (state.selectedNodeIds.length === unique.length && state.selectedNodeIds.every((id, i) => id === unique[i]) && state.selected === (unique.length === 1 ? unique[0] : null)) return state;
        return {
          selectedNodeIds: unique,
          selected: unique.length === 1 ? unique[0] : null,
        };
      }),
    setSelectionMode: (selectionMode) => set({ selectionMode }),
    applyNodePositions: (positions) => {
      const state = get();
      if (state.readOnly) return false;
      if (!supportsFreeCanvas(state.project.graph) || positions.length === 0 || state.selectedNodeIds.length < 2) return false;
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
    toggleExpanded: (id) => {
      if (get().readOnly) return;
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
      });
    },
    change: (fn) => {
      if (get().readOnly) return;
      set((s) => {
        const graph = clone(s.project.graph);
        fn(graph);
        return {
          project: { ...s.project, graph, updatedAt: Date.now() },
          past: [...s.past.slice(-49), { graph: clone(s.project.graph) }],
          future: [],
          revision: s.revision + 1,
        };
      });
    },
    beginMove: () => {
      if (get().readOnly) return;
      set((s) => {
        const isShellSelected =
          !!s.selected &&
          (s.project.subsystems ?? []).some((g) => g.id === s.selected);
        return {
          past: [
            ...s.past.slice(-49),
            {
              graph: clone(s.project.graph),
              ...(isShellSelected
                ? {
                    view: {
                      subsystems: clone(s.project.subsystems ?? []),
                      expandedNodeIds: [...(s.project.expandedNodeIds ?? [])],
                    },
                    selection: {
                      selected: s.selected,
                      selectedNodeIds: [...s.selectedNodeIds],
                    },
                  }
                : {}),
            },
          ],
          future: [],
        };
      });
    },
    move: (positions) => {
      if (get().readOnly) return;
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
      }));
    },
    updateNode: (id, patch) =>
      get().change((g) => {
        const n = g.nodes.find((n) => n.id === id);
        if (n) Object.assign(n, patch);
      }),
    settings: (patch) =>
      get().change((g) => {
        Object.assign(g.settings, patch);
        const profile = g.settings.profile;
        if (patch.duration !== undefined) {
          if (profile?.kind === "burst") {
            profile.end = Math.min(profile.end, g.settings.duration);
            profile.start = Math.min(profile.start, Math.max(0, profile.end - 0.1));
          }
          if (isOpenGraph(g) && g.workloads) {
            for (const wl of g.workloads) {
              if (wl.profile?.kind === "burst") {
                wl.profile.end = Math.min(wl.profile.end, g.settings.duration);
                wl.profile.start = Math.min(wl.profile.start, Math.max(0, wl.profile.end - 0.1));
              }
            }
          }
        }
      }),
    insertBalancer: () => get().change(insertBalancer),
    addServiceInstance: () => {
      let id: string | undefined;
      get().change((g) => { id = addServiceInstance(g)?.id; });
      if (id) get().select(id);
    },
    add: (kind, position) => {
      if (get().readOnly) return false;
      const graph = get().project.graph;
      const defaultX = 220 + graph.nodes.length * 35;
      const defaultY = 350;
      const posX = position ? Math.round(position.x / 20) * 20 : defaultX;
      const posY = position ? Math.round(position.y / 20) * 20 : defaultY;
      if (isOpenGraph(graph)) {
        if (graph.nodes.length >= 100) return false;
        if (kind === "traffic" && (graph.workloads?.length ?? 0) >= 20) return false;
        const node = makeOpenNode(
          kind,
          posX,
          posY,
        );
        get().change((g) => {
          g.nodes.push(node);
          if (kind === "traffic") {
            const wl = defaultWorkload(node.id);
            (g.workloads ??= []).push(wl);
          }
        });
        set({ selected: node.id, selectedNodeIds: [node.id] });
        return true;
      }

      if (graph.scenario === "diagram" && graph.nodes.length >= 100) return false;
      if (kind === "balancer") { get().insertBalancer(); return; }
      if (kind === "service" && hasBalancer(get().project.graph)) { get().addServiceInstance(); return; }
      const node = makeNode(
        kind,
        posX,
        posY,
      );
      get().change((g) => {
        g.nodes.push(node);
      });
      set({ selected: node.id, selectedNodeIds: get().project.graph.scenario === "diagram" ? [node.id] : [] });
      return true;
    },
    duplicateNode: (id) => {
      const state = get();
      if (state.readOnly) return false;
      const graph = state.project.graph;
      if (!supportsFreeCanvas(graph) || graph.nodes.length >= 100) return false;
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

      if (isOpenGraph(graph)) {
        const attachedWorkloads = (graph.workloads ?? []).filter((w) => w.entryNodeId === id);
        if ((graph.workloads?.length ?? 0) + attachedWorkloads.length > 20) return false;

        const newId = crypto.randomUUID();
        const copy: ModelNode = {
          ...clone(source),
          id: newId,
          name: `${source.name.slice(0, 75)} copy`,
          position,
        };

        const clonedWorkloads: WorkloadDefinition[] = attachedWorkloads.map((w) => {
          const wlCopy = clone(w);
          wlCopy.id = crypto.randomUUID();
          wlCopy.entryNodeId = newId;
          wlCopy.classes = wlCopy.classes.map((c) => ({
            ...c,
            id: crypto.randomUUID(),
          }));
          return wlCopy;
        });

        get().change((draft) => {
          draft.nodes.push(copy);
          (draft.workloads ??= []).push(...clonedWorkloads);
        });
        set({ selected: copy.id, selectedNodeIds: [copy.id] });
        return true;
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
    generateTraffic: (id) => {
      if (get().readOnly) return false;
      const graph = get().project.graph;
      if (!isOpenGraph(graph)) return false;
      if (!graph.nodes.some((n) => n.id === id)) return false;
      if ((graph.workloads?.length ?? 0) >= 20) return false;

      const wl = defaultWorkload(id);
      const targetNode = graph.nodes.find((n) => n.id === id);
      if (targetNode?.kind === "scheduler") {
        wl.intervalMs = 1000;
      }

      get().change((g) => {
        (g.workloads ??= []).push(wl);
      });
      return true;
    },
    updateWorkload: (id, patch) => {
      if (get().readOnly) return;
      get().change((g) => {
        const wl = g.workloads?.find((w) => w.id === id);
        if (wl) Object.assign(wl, patch);
      });
    },
    removeWorkload: (id) => {
      if (get().readOnly) return;
      get().change((g) => {
        if (g.workloads) {
          g.workloads = g.workloads.filter((w) => w.id !== id);
        }
      });
    },
    replaceSystem: (graph) => {
      if (get().readOnly) return;
      const cloned = clone(graph);
      get().change((g) => {
        replaceGraph(g, cloned);
      });
      set({ selected: null, selectedNodeIds: [], selectionMode: false });
    },
    loadExperiment: (id) => {
      if (get().readOnly) return;
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
      if (get().readOnly) return false;
      const template = architectureTemplate(id);
      if (!template) return false;
      const graph = template.create();
      get().change((draft) => replaceGraph(draft, graph));
      set({ selected: null, selectedNodeIds: [], selectionMode: false });
      return true;
    },
    useScenario: (scenario) => {
      if (get().readOnly) return;
      const fresh = scenario === "jobs" ? backgroundJobs() : scenario === "balanced" ? balancedLookup() : scenario === "diagram" ? architectureDiagram() : newProject().graph;
      get().change((g) => {
        replaceGraph(g, fresh);
      });
      get().select(null);
      set({ selectionMode: false });
    },
    insertCache: () => {
      if (get().readOnly) return;
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
      if (get().readOnly) return;
      get().change((g) => {
        g.nodes = g.nodes.filter((n) => n.id !== id);
        g.edges = g.edges.filter((e) => e.source !== id && e.target !== id);
        if (g.workloads) {
          g.workloads = g.workloads.filter((w) => w.entryNodeId !== id);
        }
      });
      set({ selected: null, selectedNodeIds: [] });
    },
    undo: () => {
      if (get().readOnly) return;
      set((s) => {
        if (!s.past.length) return {};
        const entry = s.past.at(-1)!;
        const { graph, view, selection } = entry;

        const currentView = view
          ? {
              subsystems: clone(s.project.subsystems ?? []),
              expandedNodeIds: [...(s.project.expandedNodeIds ?? [])],
            }
          : undefined;
        const currentSelection: SelectionSnapshot = {
          selected: s.selected,
          selectedNodeIds: [...s.selectedNodeIds],
        };

        const targetGraph = graph === s.project.graph ? s.project.graph : graph;

        let nextSelected: string | null = null;
        let nextSelectedNodeIds: string[] = [];

        if (selection) {
          nextSelected = selection.selected;
          nextSelectedNodeIds = [...selection.selectedNodeIds];
        } else {
          nextSelected =
            targetGraph.nodes.some((node) => node.id === s.selected) ||
            targetGraph.notes?.some((note) => note.id === s.selected)
              ? s.selected
              : null;
          nextSelectedNodeIds = s.selectedNodeIds.filter((id) =>
            targetGraph.nodes.some((node) => node.id === id),
          );
        }

        return {
          project: {
            ...s.project,
            ...(view ? view : {}),
            graph: targetGraph,
            updatedAt: Date.now(),
          },
          past: s.past.slice(0, -1),
          future: [
            {
              graph: s.project.graph,
              ...(currentView ? { view: currentView } : {}),
              ...(selection ? { selection: currentSelection } : {}),
            },
            ...s.future,
          ],
          revision: s.revision + 1,
          selected: nextSelected,
          selectedNodeIds: nextSelectedNodeIds,
        };
      });
    },
    redo: () => {
      if (get().readOnly) return;
      set((s) => {
        if (!s.future.length) return {};
        const entry = s.future[0];
        const { graph, view, selection } = entry;

        const currentView = view
          ? {
              subsystems: clone(s.project.subsystems ?? []),
              expandedNodeIds: [...(s.project.expandedNodeIds ?? [])],
            }
          : undefined;
        const currentSelection: SelectionSnapshot = {
          selected: s.selected,
          selectedNodeIds: [...s.selectedNodeIds],
        };

        const targetGraph = graph === s.project.graph ? s.project.graph : graph;

        let nextSelected: string | null = null;
        let nextSelectedNodeIds: string[] = [];

        if (selection) {
          nextSelected = selection.selected;
          nextSelectedNodeIds = [...selection.selectedNodeIds];
        } else {
          nextSelected =
            targetGraph.nodes.some((node) => node.id === s.selected) ||
            targetGraph.notes?.some((note) => note.id === s.selected)
              ? s.selected
              : null;
          nextSelectedNodeIds = s.selectedNodeIds.filter((id) =>
            targetGraph.nodes.some((node) => node.id === id),
          );
        }

        return {
          project: {
            ...s.project,
            ...(view ? view : {}),
            graph: targetGraph,
            updatedAt: Date.now(),
          },
          past: [
            ...s.past,
            {
              graph: s.project.graph,
              ...(currentView ? { view: currentView } : {}),
              ...(selection ? { selection: currentSelection } : {}),
            },
          ],
          future: s.future.slice(1),
          revision: s.revision + 1,
          selected: nextSelected,
          selectedNodeIds: nextSelectedNodeIds,
        };
      });
    },
    rename: (name) => {
      if (get().readOnly) return;
      set((s) => ({ project: { ...s.project, name, updatedAt: Date.now() } }));
    },
    checkpoint: (name) => {
      if (get().readOnly) return false;
      const trimmed = name.trim();
      if (!trimmed) return false;
      const checkpoints = get().project.checkpoints;
      if (checkpoints.length >= 50) return false;

      set((s) => ({
        project: {
          ...s.project,
          checkpoints: [
            ...s.project.checkpoints,
            {
              id: crypto.randomUUID(),
              name: trimmed,
              graph: clone(s.project.graph),
              createdAt: Date.now(),
            },
          ],
          updatedAt: Date.now(),
        },
      }));
      return true;
    },
    restore: (id) => {
      if (get().readOnly) return;
      const checkpoint = get().project.checkpoints.find((c) => c.id === id);
      if (checkpoint) {
        get().change((g) => replaceGraph(g, checkpoint.graph));
        set({ selected: null, selectedNodeIds: [], selectionMode: false });
      }
    },
    viewport: (viewport) => {
      if (get().readOnly) return;
      set((s) => ({
        project: { ...s.project, viewport, updatedAt: Date.now() },
      }));
    },
  };
});
