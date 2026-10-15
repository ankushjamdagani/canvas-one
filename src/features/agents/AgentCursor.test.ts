import { describe, expect, it } from 'vitest';
import { agentPresenceLabel, findAgentCursorPosition, type AgentPresence } from './AgentCursor';
const presence: AgentPresence = { providerLabel: 'Claude', phase: 'reading', targetIds: ['element'] };
const viewport = { x: 0, y: 0, zoom: 1 }, bounds = { width: 320, height: 500 };
describe('factual agent cursor targeting', () => {
  it('maps record identity to its visible projected position without assuming placement identity', () => {
    expect(findAgentCursorPosition(presence, [{ recordIds: ['element'], x: 40, y: 80 }], viewport, bounds)).toEqual({ x: 48, y: 88 });
    expect(agentPresenceLabel(presence)).toBe('Claude · Inspecting board');
  });
  it('omits board-wide reads, hidden records and offscreen targets', () => {
    const targets = [{ recordIds: ['element'], x: 400, y: 600 }];
    expect(findAgentCursorPosition({ ...presence, targetIds: [] }, targets, viewport, bounds)).toBeUndefined();
    expect(findAgentCursorPosition({ ...presence, targetIds: ['missing'] }, targets, viewport, bounds)).toBeUndefined();
    expect(findAgentCursorPosition(presence, targets, viewport, bounds)).toBeUndefined();
    expect(findAgentCursorPosition(presence, targets, { x: -300, y: -500, zoom: 1 }, bounds)).toEqual({ x: 408, y: 608 });
  });
  it('ignores invalid geometry and chooses another actual visible target', () => {
    const targets = [{ recordIds: ['first'], x: NaN, y: 0 }, { recordIds: ['element'], x: 40, y: 80 }];
    expect(findAgentCursorPosition({ ...presence, targetIds: ['first', 'element'] }, targets, viewport, bounds)).toEqual({ x: 48, y: 88 });
    expect(findAgentCursorPosition(presence, targets, { ...viewport, zoom: 0 }, bounds)).toBeUndefined();
  });
});
