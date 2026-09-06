import { expect, it } from 'vitest';
import { newProject } from '../domain/model';
import { exportProject, importProject } from './projects';
it('roundtrips model, settings, checkpoints and viewport without overwriting original', () => { const p = newProject(); p.checkpoints.push({ id: 'a', name: 'Baseline', graph: structuredClone(p.graph), createdAt: 1 }); const restored = importProject(exportProject(p)); expect(restored.graph).toEqual(p.graph); expect(restored.viewport).toEqual(p.viewport); expect(restored.id).not.toBe(p.id); expect(restored.checkpoints[0].graph).toEqual(p.graph); });
it('rejects unknown versions and malformed imports', () => { expect(() => importProject('{"version":99}')).toThrow('Unsupported'); const p = newProject(); p.graph.nodes[0].capacity = -1; expect(() => importProject(exportProject(p))).toThrow('Capacity'); });
