import { create } from 'zustand';
import { clone, makeNode, newProject, type Project, type Graph, type ComponentKind, type ModelNode, type Settings } from '../domain/model';
interface Editor {
 project: Project; selected: string | null; past: Graph[]; future: Graph[]; revision: number;
 load: (p: Project) => void; select: (id: string | null) => void;
 change: (fn: (g: Graph) => void) => void; updateNode: (id: string, patch: Partial<ModelNode>) => void; settings: (patch: Partial<Settings>) => void;
 add: (kind: ComponentKind) => void; insertCache: () => void; remove: (id: string) => void; undo: () => void; redo: () => void;
 rename: (name: string) => void; checkpoint: (name: string) => void; restore: (id: string) => void; viewport: (v: Project['viewport']) => void;
}
export const useEditor = create<Editor>((set, get) => ({
 project: newProject(), selected: null, past: [], future: [], revision: 0,
 load: p => set(s => ({ project: clone(p), selected: null, past: [], future: [], revision: s.revision + 1 })),
 select: selected => set({ selected }),
 change: fn => set(s => { const graph = clone(s.project.graph); fn(graph); return { project: { ...s.project, graph, updatedAt: Date.now() }, past: [...s.past.slice(-49), clone(s.project.graph)], future: [], revision: s.revision + 1 }; }),
 updateNode: (id, patch) => get().change(g => { const n = g.nodes.find(n => n.id === id); if (n) Object.assign(n, patch); }),
 settings: patch => get().change(g => { Object.assign(g.settings, patch); }),
 add: kind => { const node = makeNode(kind, 220 + get().project.graph.nodes.length * 35, 350); get().change(g => { g.nodes.push(node); }); set({ selected: node.id }); },
 insertCache: () => {
   if (get().project.graph.nodes.some(n => n.kind === 'cache')) return;
   get().checkpoint('Before cache');
   const node = makeNode('cache', 600, 170);
   get().change(g => { const service = g.nodes.find(n => n.kind === 'service'), db = g.nodes.find(n => n.kind === 'database'); if (!service || !db) return; db.position.x = 880; g.nodes.push(node); g.edges = g.edges.filter(e => !(e.source === service.id && e.target === db.id)); g.edges.push({ id: crypto.randomUUID(), source: service.id, target: node.id }, { id: crypto.randomUUID(), source: node.id, target: db.id }); });
   get().checkpoint('After cache'); set({ selected: node.id });
 },
 remove: id => { get().change(g => { g.nodes = g.nodes.filter(n => n.id !== id); g.edges = g.edges.filter(e => e.source !== id && e.target !== id); }); set({ selected: null }); },
 undo: () => set(s => s.past.length ? { project: { ...s.project, graph: s.past.at(-1)!, updatedAt: Date.now() }, past: s.past.slice(0, -1), future: [s.project.graph, ...s.future], revision: s.revision + 1 } : {}),
 redo: () => set(s => s.future.length ? { project: { ...s.project, graph: s.future[0], updatedAt: Date.now() }, past: [...s.past, s.project.graph], future: s.future.slice(1), revision: s.revision + 1 } : {}),
 rename: name => set(s => ({ project: { ...s.project, name, updatedAt: Date.now() } })),
 checkpoint: name => set(s => ({ project: { ...s.project, checkpoints: [...s.project.checkpoints.slice(-49), { id: crypto.randomUUID(), name, graph: clone(s.project.graph), createdAt: Date.now() }], updatedAt: Date.now() } })),
 restore: id => { const checkpoint = get().project.checkpoints.find(c => c.id === id); if (checkpoint) get().change(g => Object.assign(g, clone(checkpoint.graph))); },
 viewport: viewport => set(s => ({ project: { ...s.project, viewport, updatedAt: Date.now() } })),
}));
