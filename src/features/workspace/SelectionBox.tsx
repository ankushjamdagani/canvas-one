import * as React from 'react';
import { useStore } from '@xyflow/react';

export interface SelectionBoxProps {
  readonly selectedIds: readonly string[];
}

/**
 * Renders a unified selection box around multi-item selections on the canvas with
 * uniform 24px spacing and rounded-card corners, matching the grouping box geometry.
 */
export function SelectionBox({ selectedIds }: SelectionBoxProps) {
  const rect = useStore(
    (s) => {
      if (selectedIds.length <= 1) return null;
      const nodes = selectedIds
        .map((id) => s.nodeLookup.get(id))
        .filter((n): n is NonNullable<typeof n> => !!n);
      if (nodes.length <= 1) return null;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      nodes.forEach((n) => {
        const x = n.position.x;
        const y = n.position.y;
        const w = n.measured?.width ?? n.width ?? 184;
        const h = n.measured?.height ?? n.height ?? 76;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      });

      return {
        x: minX - 24,
        y: minY - 24,
        width: maxX - minX + 48,
        height: maxY - minY + 48,
      };
    },
    (a, b) => a?.x === b?.x && a?.y === b?.y && a?.width === b?.width && a?.height === b?.height,
  );

  if (!rect) return null;

  return (
    <div
      data-testid="canvas-selection-box"
      className="absolute rounded-card border-2 border-dashed border-primary bg-primary/[0.04] pointer-events-none select-none z-0"
      style={{
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}
