import * as React from 'react';
import type { EditorObject } from '@canvas-one/whiteboard';
import { validateBasicEntity, type BasicData } from './index.js';

export type BasicComponentProps = { readonly object: EditorObject; readonly selected: boolean; readonly assetUri?: string };
export function BasicComponent({ object, selected, assetUri }: BasicComponentProps) {
  const issues = validateBasicEntity({ id: object.entityId, type: object.componentType, data: object.data, extensions: {} });
  if (issues.length) return <div style={{ padding: 8, color: '#171717', border: '1px dashed #737373' }}>Invalid {object.componentType}: {issues[0].message}</div>;
  const data = (object.data ?? {}) as BasicData;
  const border = data.stroke ?? '#525252';
  const common: React.CSSProperties = { boxSizing: 'border-box', width: '100%', height: '100%', color: '#171717', background: data.fill ?? (object.componentType === 'basic/text' || object.componentType === 'basic/freehand' ? 'transparent' : '#fafafa'), border: `${data.strokeWidth ?? 1}px solid ${border}`, outline: selected ? '2px solid #2563eb' : undefined, outlineOffset: 2, overflow: 'hidden', font: '14px system-ui', padding: 8 };
  if (object.componentType === 'basic/ellipse') return <div style={{ ...common, borderRadius: '50%', display: 'grid', placeItems: 'center' }}>{data.text}</div>;
  if (object.componentType === 'basic/freehand') return <svg width="100%" height="100%" viewBox={`0 0 ${object.bounds.width} ${object.bounds.height}`} aria-label={data.text ?? 'Freehand drawing'} style={{ ...common, padding: 0, border: 'none' }}><polyline points={(data.points ?? []).map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={border} strokeWidth={data.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (object.componentType === 'basic/image') return assetUri ? <img src={assetUri} alt={data.text ?? 'Board image'} draggable={false} style={{ ...common, objectFit: 'contain', padding: 0 }} /> : <div style={common}>Image asset unavailable: {data.assetId}</div>;
  if (object.componentType === 'basic/frame') return <div style={{ ...common, background: data.fill ?? 'transparent', borderStyle: 'dashed' }}>{data.text ?? 'Frame'}</div>;
  return <div style={{ ...common, border: object.componentType === 'basic/text' ? 'none' : common.border, whiteSpace: 'pre-wrap' }}>{data.text}</div>;
}
export const basicRenderers = Object.freeze(Object.fromEntries(['basic/text', 'basic/rectangle', 'basic/ellipse', 'basic/frame', 'basic/image', 'basic/freehand'].map(type => [type, BasicComponent])));
