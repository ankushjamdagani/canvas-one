import { makeNode, baseline, type Graph, type ModelNode } from "./model";
export const MAX_SERVICE_INSTANCES = 8;
export const serviceInstances = (g: Graph) => g.nodes.filter((n) => n.kind === "service");
export const hasBalancer = (g: Graph) => g.nodes.some((n) => n.kind === "balancer");
const edge = (source: string, target: string) => ({ id: crypto.randomUUID(), source, target });
/** Graph node order is the stable round-robin order; moving/renaming never changes it. */
export function insertBalancer(g: Graph) {
  if (hasBalancer(g)) return;
  const traffic = g.nodes.find((n) => n.kind === "traffic"), service = serviceInstances(g)[0];
  if (!traffic || !service || g.scenario === "jobs") return;
  const balancer = makeNode("balancer", service.position.x, service.position.y);
  for (const node of g.nodes.filter((n) => n.kind !== "traffic")) node.position.x += 305;
  g.nodes.push(balancer);
  g.edges = g.edges.filter((e) => !(e.source === traffic.id && e.target === service.id));
  g.edges.push(edge(traffic.id, balancer.id), edge(balancer.id, service.id));
}
export function addServiceInstance(g: Graph): ModelNode | undefined {
  const instances = serviceInstances(g), balancer = g.nodes.find((n) => n.kind === "balancer");
  const downstream = g.nodes.find((n) => n.kind === "cache") ?? g.nodes.find((n) => n.kind === "database");
  if (!balancer || !downstream || !instances.length || instances.length >= MAX_SERVICE_INSTANCES) return;
  const template = instances[0];
  let number = instances.length + 1;
  while (g.nodes.some((n) => n.name === `Service instance ${number}`)) number++;
  const node = { ...structuredClone(template), id: crypto.randomUUID(), name: `Service instance ${number}`,
    position: { x: template.position.x, y: Math.max(...instances.map((n) => n.position.y)) + 200 } };
  g.nodes.push(node);
  g.edges.push(edge(balancer.id, node.id), edge(node.id, downstream.id));
  return node;
}
export function balancedLookup(instances = 2): Graph {
  const g = baseline();
  g.nodes[1].name = "Service instance 1";
  g.nodes[1].capacity = 200;
  g.settings.traffic = 700;
  insertBalancer(g);
  for (let i = 1; i < instances; i++) addServiceInstance(g);
  return g;
}
