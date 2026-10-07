export type PageKind = 'home' | 'projects' | 'project';

const ORDER: Record<PageKind, number> = { home: 0, projects: 1, project: 2 };

/** +1 when moving deeper into the app, -1 when moving back out. */
export function pageDirection(from: PageKind, to: PageKind): -1 | 0 | 1 {
  return Math.sign(ORDER[to] - ORDER[from]) as -1 | 0 | 1;
}
