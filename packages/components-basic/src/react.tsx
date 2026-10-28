import * as React from 'react';
import type { EditorObject } from '@canvas-one/whiteboard';
import { basicComponentTypes, validateBasicEntity, type BasicData } from './index.js';

export type BasicComponentProps = { readonly object: EditorObject; readonly selected: boolean; readonly assetUri?: string };
export function BasicComponent({ object, selected, assetUri }: BasicComponentProps) {
  const issues = validateBasicEntity({ id: object.entityId, type: object.componentType, data: object.data, extensions: {} });
  if (issues.length) return <div style={{ padding: 8, color: '#171717', border: '1px dashed #737373' }}>Invalid {object.componentType}: {issues[0].message}</div>;
  const data = (object.data ?? {}) as BasicData;
  const border = data.stroke ?? '#525252';
  const common: React.CSSProperties = { boxSizing: 'border-box', width: '100%', height: '100%', color: '#171717', background: data.fill ?? (object.componentType === 'basic/text' || object.componentType === 'basic/freehand' ? 'transparent' : '#fafafa'), border: `${data.strokeWidth ?? 1}px solid ${border}`, outline: selected ? '2px solid #2563eb' : undefined, outlineOffset: 2, overflow: 'hidden', font: '14px system-ui', padding: 8 };
  if (data.fontSize !== undefined) common.fontSize = data.fontSize;
  common.lineHeight = 1.3;
  common.color = border;
  if (object.componentType === 'basic/rectangle') return <div style={{ ...common, display: 'grid', placeItems: 'center', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{data.text}</div>;
  if (object.componentType === 'basic/rounded-rectangle') return <div style={{ ...common, borderRadius: 8, display: 'grid', placeItems: 'center', whiteSpace: 'pre-wrap' }}>{data.text}</div>;
  if (object.componentType === 'basic/diamond' || object.componentType === 'basic/line' || object.componentType === 'basic/arrow') {
    const { width, height } = object.bounds;
    return <div style={{ ...common, padding: 0, border: 'none', background: 'transparent', position: 'relative' }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} aria-label={data.text || object.componentType.slice(6)}>
        {object.componentType === 'basic/diamond' ? <polygon points={`${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`} fill={data.fill ?? '#fafafa'} stroke={border} strokeWidth={data.strokeWidth ?? 1} /> : <>
          <path d={`M 0 ${height / 2} H ${width}`} fill="none" stroke={border} strokeWidth={data.strokeWidth ?? 1} />
          {object.componentType === 'basic/arrow' && <path d={`M ${width - 10} ${height / 2 - 6} L ${width} ${height / 2} L ${width - 10} ${height / 2 + 6}`} fill="none" stroke={border} strokeWidth={data.strokeWidth ?? 1} />}
        </>}
      </svg>
      <span style={{ position: 'absolute', inset: 8, display: 'grid', placeItems: 'center', whiteSpace: 'pre-wrap', overflow: 'hidden' }}>{data.text}</span>
    </div>;
  }
  if (object.componentType === 'basic/ellipse') return <div style={{ ...common, borderRadius: '50%', display: 'grid', placeItems: 'center' }}>{data.text}</div>;
  if (object.componentType === 'basic/freehand') return <svg width="100%" height="100%" viewBox={`0 0 ${object.bounds.width} ${object.bounds.height}`} aria-label={data.text ?? 'Freehand drawing'} style={{ ...common, padding: 0, border: 'none' }}><polyline points={(data.points ?? []).map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={border} strokeWidth={data.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (object.componentType === 'basic/image') return assetUri ? <img src={assetUri} alt={data.text ?? 'Board image'} draggable={false} style={{ ...common, objectFit: 'contain', padding: 0 }} /> : <div style={common}>Image asset unavailable: {data.assetId}</div>;
  if (object.componentType === 'basic/frame') return <div style={{ ...common, background: data.fill ?? 'transparent', borderStyle: 'dashed' }}>{data.text ?? 'Frame'}</div>;
  return <div style={{ ...common, border: object.componentType === 'basic/text' ? 'none' : common.border, whiteSpace: 'pre-wrap' }}>{data.text}</div>;
}
export const basicRenderers = Object.freeze(Object.fromEntries(basicComponentTypes.map(type => [type, BasicComponent])));
