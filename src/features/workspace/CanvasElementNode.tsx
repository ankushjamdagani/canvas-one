import * as React from 'react';
import { NodeResizer, type NodeProps } from '@canvas-one/editor-reactflow/react';
import { BasicComponent } from '@canvas-one/components-basic/react';
import { Pencil, Settings2, Copy, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { ProjectedNodeData } from './projection';
import type { CanvasElement } from '../../domain/studio/model';

export function CanvasElementNode({ data, selected }: NodeProps) {
  const node = data as ProjectedNodeData;
  if (node.kind !== 'canvas-element') return null;
  return <CanvasElementContent node={node} selected={Boolean(selected)} />;
}

function CanvasElementContent({ node, selected }: { node: Extract<ProjectedNodeData, { kind: 'canvas-element' }>; selected: boolean }) {
  const item = node.canvasElement;
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(item.text);
  const [settings, setSettings] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [saving, setSaving] = React.useState(false);
  const [colors, setColors] = React.useState({ fill: item.fill, stroke: item.stroke });
  React.useEffect(() => { setColors({ fill: item.fill, stroke: item.stroke }); }, [item.fill, item.stroke]);
  React.useEffect(() => { setText(item.text); }, [item.text]);
  React.useEffect(() => { if (!selected) { setEditing(false); setSettings(false); } }, [selected]);
  const update = async (patch: Partial<Omit<CanvasElement, 'id'>>) => {
    if (!node.onUpdate || saving) { setError('Wait for the current save, then try again.'); return false; }
    setSaving(true); setError(undefined);
    try {
      const applied = await node.onUpdate(patch);
      if (!applied) setError('Could not save this change. Try again.');
      return applied;
    } catch { setError('Could not save this change. Try again.'); return false; }
    finally { setSaving(false); }
  };
  const commit = async () => { if (await update({ text })) setEditing(false); };
  return <div className="canvas-element" data-testid={`canvas-element-${item.id}`} data-kind={item.kind} style={{ width: '100%', height: '100%' }} onDoubleClick={() => { if (node.onUpdate) setEditing(true); }}>
    <NodeResizer isVisible={selected && Boolean(node.onUpdate)} minWidth={32} minHeight={24} maxWidth={2000} maxHeight={2000}
      onResizeEnd={(_event, bounds) => void update({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) })} />
    <BasicComponent selected={false} object={{ id: item.id, entityId: item.id, componentType: `basic/${item.kind}`, bounds: { x: item.x, y: item.y, width: item.width, height: item.height }, data: { text: item.text, fill: item.fill, stroke: item.stroke, strokeWidth: item.strokeWidth, fontSize: item.fontSize } }} />
    {selected && <div className="canvas-element-tools nodrag nopan" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <Button size="icon" variant="ghost" aria-label="Edit element text" title="Edit element text" disabled={!node.onUpdate} onClick={() => setEditing(true)}><Pencil className="size-3.5" /></Button>
      <Popover open={settings} onOpenChange={setSettings}><PopoverTrigger asChild><Button size="icon" variant="ghost" aria-label="Element appearance" title="Element appearance" disabled={!node.onUpdate}><Settings2 className="size-3.5" /></Button></PopoverTrigger>
        <PopoverContent className="canvas-element-settings nodrag nopan" side="top" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
          <strong className="text-xs">Appearance</strong>
          {(['width', 'height', 'strokeWidth', 'fontSize'] as const).map(key => <label key={key} className="canvas-element-field"><span>{({ width: 'Width', height: 'Height', strokeWidth: 'Stroke width', fontSize: 'Text size' })[key]}</span><Input aria-label={key === 'fontSize' ? 'Text size' : key === 'strokeWidth' ? 'Stroke width' : key === 'width' ? 'Width' : 'Height'} type="number" defaultValue={item[key]} key={`${key}-${item[key]}`} min={key === 'strokeWidth' ? 0 : key === 'fontSize' ? 8 : key === 'width' ? 32 : 24} max={key === 'strokeWidth' ? 12 : key === 'fontSize' ? 96 : 2000} onBlur={event => {
            const value = Number(event.currentTarget.value);
            const min = key === 'strokeWidth' ? 0 : key === 'fontSize' ? 8 : key === 'width' ? 32 : 24;
            const max = key === 'strokeWidth' ? 12 : key === 'fontSize' ? 96 : 2000;
            if (!event.currentTarget.value || !Number.isFinite(value) || value < min || value > max) { setError(`Use a value from ${min} to ${max}.`); event.currentTarget.value = String(item[key]); return; }
            setError(undefined); if (value !== item[key]) void update({ [key]: value });
          }} /></label>)}
          {(['fill', 'stroke'] as const).map(key => <div key={key} className="canvas-element-field"><span>{key === 'fill' ? 'Fill' : 'Stroke'}</span><div className="flex items-center gap-2"><input type="color" disabled={saving || !node.onUpdate} aria-label={key === 'fill' ? 'Fill colour' : 'Stroke colour'} value={colors[key] === 'transparent' ? '#ffffff' : colors[key]} onChange={event => setColors(previous => ({ ...previous, [key]: event.target.value }))} onBlur={() => { if (colors[key] !== item[key]) void update({ [key]: colors[key] }); }} /><Button size="sm" variant="ghost" disabled={saving || !node.onUpdate} aria-pressed={item[key] === 'transparent'} onClick={() => void update({ [key]: 'transparent' })}>None</Button></div></div>)}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </PopoverContent>
      </Popover>
      <Button size="icon" variant="ghost" aria-label="Duplicate selection" title="Duplicate selection" disabled={!node.onDuplicate || saving} onClick={() => node.onDuplicate?.()}><Copy className="size-3.5" /></Button>
      <Button size="icon" variant="ghost" aria-label="Delete selection" title="Delete selection" disabled={!node.onDelete || saving} onClick={() => node.onDelete?.()}><Trash2 className="size-3.5" /></Button>
    </div>}
    {editing && <div className="canvas-element-editor nodrag nopan" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <Textarea autoFocus aria-label="Element text" maxLength={4000} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { setText(item.text); setEditing(false); } if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commit(); }} />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-1"><Button size="sm" variant="ghost" disabled={saving} onClick={() => { setText(item.text); setEditing(false); }}>Cancel</Button><Button size="sm" disabled={saving || !node.onUpdate} onClick={() => void commit()}>Save</Button></div>
    </div>}
    {error && !editing && !settings && <p role="alert" className="canvas-element-editor text-xs text-destructive">{error}</p>}
  </div>;
}
