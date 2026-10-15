import * as React from 'react';
import { MousePointer2 } from 'lucide-react';
import { CanvasOneFace, type FaceExpression } from '../../components/ui/canvas-one-face';
import type { AgentActivity } from './activity';

export interface AgentPresence {
  readonly providerLabel: string;
  readonly phase: 'reading' | 'applying' | 'reviewing';
  /** Record IDs from an actual board request, never inferred from model text. */
  readonly targetIds: readonly string[];
  readonly activity?: AgentActivity;
}
export interface AgentCursorTarget {
  readonly recordIds: readonly string[];
  readonly x: number;
  readonly y: number;
}
const activity: Record<AgentPresence['phase'], string> = { reading: 'Inspecting board', applying: 'Applying changes', reviewing: 'Preparing review' };
const expression: Record<AgentPresence['phase'], FaceExpression> = { reading: 'look', applying: 'squint', reviewing: 'pixel' };
export function agentPresenceLabel(presence: AgentPresence): string { return `${presence.providerLabel} · ${presence.activity?.label ?? activity[presence.phase]}`; }

/** Resolves explicit visible records only; an offscreen/unknown target never moves the camera. */
export function findAgentCursorPosition(presence: AgentPresence, targets: readonly AgentCursorTarget[], viewport: { readonly x: number; readonly y: number; readonly zoom: number }, bounds: { readonly width: number; readonly height: number }): { readonly x: number; readonly y: number } | undefined {
  if (![viewport.x, viewport.y, viewport.zoom, bounds.width, bounds.height].every(Number.isFinite) || viewport.zoom <= 0 || bounds.width <= 0 || bounds.height <= 0) return undefined;
  for (const id of presence.targetIds) {
    const target = targets.find(node => node.recordIds.includes(id));
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) continue;
    const x = target.x + 8, y = target.y + 8;
    const screenX = x * viewport.zoom + viewport.x, screenY = y * viewport.zoom + viewport.y;
    if (screenX >= 0 && screenX <= bounds.width && screenY >= 0 && screenY <= bounds.height) return { x, y };
  }
  return undefined;
}

/** Read-only spatial evidence; unknown or offscreen targets have no canvas presence. */
export function AgentCursor({ presence, position, scale = 1 }: { readonly presence: AgentPresence; readonly position?: { readonly x: number; readonly y: number }; readonly scale?: number }) {
  if (!position) return null;
  return <div aria-hidden="true" data-testid="agent-presence-cursor" data-spatial="target" data-outcome={presence.activity?.status ?? 'running'} className="pointer-events-none absolute z-dock flex max-w-64 items-center gap-1.5 text-caption text-foreground" style={{ left: position.x, top: position.y, transform: `scale(${Number.isFinite(scale) && scale > 0 ? scale : 1})`, transformOrigin: 'top left' }}>
    {position && <MousePointer2 className="size-3 shrink-0 text-primary" aria-hidden="true" />}
    <CanvasOneFace expression={presence.activity?.status === 'succeeded' ? 'happy' : expression[presence.phase]} size={28} aria-hidden="true" />
    <span className="min-w-0 break-words rounded-control border border-hairline bg-panel px-2 py-1">{agentPresenceLabel(presence)}</span>
  </div>;
}
