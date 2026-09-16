import React, { useState } from 'react';
import type { Metrics } from '../domain/metrics';
import type { BehaviorConfig, ComponentKind, ExecutionNode } from '../domain/execution';
import { defaultBehavior } from '../domain/behaviorDefaults';
import { useEditor } from '../state/editor';
import { NumberField } from './NumberField';
import { OpenWorkloadControls } from './OpenWorkloadControls';
import { NoteInspector } from './CanvasNotes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import './openInspector.css';

import { X, AlertCircle } from 'lucide-react';

export interface OpenInspectorProps {
  metrics: Metrics | null;
  mode?: 'selection' | 'workloads';
  onOpenWorkloads?: () => void;
  onClose?: () => void;
}

export function OpenInspector({
  metrics,
  mode = 'selection',
  onOpenWorkloads,
  onClose,
}: OpenInspectorProps) {
  const editor = useEditor();
  const readOnly = editor.readOnly;
  const project = editor.project;
  const graph = project.graph;
  const selectedId = editor.selected;
  const selectedNodeIds = editor.selectedNodeIds;

  const [behaviorTypeChangeError, setBehaviorTypeChangeError] = useState<string | null>(null);

  const renderGlobalWorkloads = (title: string) => (
    <aside className="inspector open-inspector-container" aria-label="System configuration inspector">
      <div className="inspector-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{title}</strong>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close inspector"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
            onClick={onClose}
          >
            <X size={15} />
          </Button>
        )}
      </div>
      <fieldset disabled={readOnly} className="open-inspector-fieldset">
        <div className="inspector-body">
          <div className="open-inspector-section">
            <span className="open-inspector-section-title">Execution Settings</span>
            <NumberField
              label="Simulation Duration"
              unit="s"
              value={graph.settings.duration}
              min={1}
              max={300}
              onChange={(val) => editor.settings({ duration: val })}
            />

            <NumberField
              label="Random Seed"
              value={graph.settings.seed}
              min={0}
              max={4294967295}
              onChange={(val) => editor.settings({ seed: val })}
            />
          </div>

          <OpenWorkloadControls
            workloads={graph.workloads ?? []}
            readOnly={readOnly}
          />
        </div>
      </fieldset>
    </aside>
  );

  // When mode is workloads, render global duration, seed, and all workloads regardless of selection
  if (mode === 'workloads') {
    return renderGlobalWorkloads('System Configuration & Workloads');
  }

  // Note selected
  if (selectedId && graph.notes?.some((n) => n.id === selectedId)) {
    const note = graph.notes.find((n) => n.id === selectedId)!;
    return (
      <fieldset disabled={readOnly} className="open-inspector-fieldset">
        <NoteInspector key={`${note.id}:${note.title}:${note.body}:${note.kind}:${JSON.stringify(note.attachment)}`} note={note} />
      </fieldset>
    );
  }

  // Shell (subsystem) selected
  const subsystem = (project.subsystems ?? []).find((s) => s.id === selectedId);
  if (subsystem) {
    return (
      <aside className="inspector open-inspector-container" aria-label="Subsystem inspector">
        <div className="inspector-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Subsystem: {subsystem.name}</strong>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close inspector"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
              onClick={onClose}
            >
              <X size={15} />
            </Button>
          )}
        </div>
        <div className="inspector-body">
          <div className="open-inspector-section">
            <span className="open-inspector-section-title">Members</span>
            <p className="open-inspector-help-text">
              Contains {subsystem.nodeIds.length} member component{subsystem.nodeIds.length === 1 ? '' : 's'}.
            </p>
            <p className="open-inspector-help-text">
              Right-click the subsystem shell on the canvas to expand, collapse, or dissolve this group.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
              <Button
                type="button"
                variant="outline"
                className="open-inspector-btn w-full justify-center"
                onClick={() => editor.toggleSubsystem(subsystem.id)}
                aria-label={`${subsystem.collapsed ? "Expand" : "Collapse"} subsystem ${subsystem.name}`}
              >
                {subsystem.collapsed ? "Expand subsystem" : "Collapse subsystem"}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="open-inspector-btn danger w-full justify-center"
                disabled={readOnly}
                onClick={() => {
                  editor.dissolveSubsystem(subsystem.id);
                  onClose?.();
                }}
                aria-label={`Ungroup ${subsystem.name}`}
              >
                Ungroup
              </Button>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  // Multi-selection
  if (selectedNodeIds.length > 1) {
    return (
      <aside className="inspector open-inspector-container" aria-label="Multiple selection inspector">
        <div className="inspector-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{selectedNodeIds.length} Components Selected</strong>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close inspector"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
              onClick={onClose}
            >
              <X size={15} />
            </Button>
          )}
        </div>
        <div className="inspector-body">
          <div className="open-inspector-section">
            <p className="open-inspector-help-text">
              You have selected {selectedNodeIds.length} nodes.
            </p>
            <p className="open-inspector-help-text">
              Right-click on canvas to group these components into a subsystem, align positions, or delete them together.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  // Single node selected
  const selectedNode = selectedId ? graph.nodes.find((n) => n.id === selectedId) : null;

  if (selectedNode) {
    const behavior = (selectedNode.behavior || defaultBehavior(selectedNode.kind)) as BehaviorConfig;
    const nodeMetrics = metrics?.execution?.nodes[selectedNode.id];
    const execMetrics = metrics?.execution;

    const handleNameChange = (name: string) => {
      editor.updateNode(selectedNode.id, { name: name.slice(0, 80) });
    };

    const handleDescriptionChange = (desc: string) => {
      editor.updateNode(selectedNode.id, { description: desc.slice(0, 240) });
    };

    const handleCustomTypeChange = (ct: string) => {
      editor.updateNode(selectedNode.id, { customType: ct.trim() ? ct.slice(0, 60) : selectedNode.kind === 'custom' ? 'Custom component' : undefined });
    };

    const handleBehaviorTypeChange = (newType: BehaviorConfig['type']) => {
      setBehaviorTypeChangeError(null);
      // Reset behavior with defaults appropriate for that type
      let nextBehavior: BehaviorConfig;
      const base = {
        capacity: 2000,
        concurrency: 1,
        queueLimit: 500,
        failureRate: 0,
        maxRetries: 0,
        retryDelayMs: 100,
      };

      if (newType === 'source') {
        nextBehavior = { ...base, type: 'source' };
      } else if (newType === 'processor') {
        nextBehavior = { ...base, type: 'processor' };
      } else if (newType === 'storage') {
        nextBehavior = { ...base, capacity: 500, writeCapacity: 500, type: 'storage' };
      } else if (newType === 'router') {
        nextBehavior = { ...base, type: 'router', strategy: 'round-robin' };
      } else if (newType === 'cache') {
        nextBehavior = {
          ...base,
          capacity: 5000,
          type: 'cache',
          mode: 'fixed',
          hitRate: 80,
          entries: 100,
          ttlMs: 10000,
        };
      } else if (newType === 'broker') {
        nextBehavior = { ...base, type: 'broker', delivery: 'competing' };
      } else {
        return;
      }

      editor.updateNode(selectedNode.id, { behavior: nextBehavior });
    };

    const patchBehavior = (patch: Partial<BehaviorConfig>) => {
      const updated = { ...behavior, ...patch } as BehaviorConfig;
      editor.updateNode(selectedNode.id, { behavior: updated });
    };

    const handleDuplicate = () => {
      if (!editor.duplicateNode(selectedNode.id)) {
        setBehaviorTypeChangeError('Unable to duplicate node: graph or workload limit reached.');
      }
    };

    const handleDelete = () => {
      editor.remove(selectedNode.id);
    };

    const handleGenerateTraffic = () => {
      if (editor.generateTraffic(selectedNode.id)) {
        onOpenWorkloads?.();
      } else {
        setBehaviorTypeChangeError('Unable to generate traffic: workload limit (20) reached.');
      }
    };

    return (
      <aside className="inspector open-inspector-container" aria-label="Component inspector">
        <div className="inspector-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
            <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedNode.name}</strong>
            <Badge variant="secondary" className="open-inspector-behavior-badge uppercase font-mono text-[10px] tracking-wider">
              {behavior.type}
            </Badge>
          </div>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close inspector"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0"
              onClick={onClose}
            >
              <X size={15} />
            </Button>
          )}
        </div>

        <fieldset disabled={readOnly} className="open-inspector-fieldset">
          <div className="inspector-body">
            {/* Identity section */}
            <div className="open-inspector-section">
              <span className="open-inspector-section-title">Identity & Metadata</span>
              <label className="field">
                <span>Name</span>
                <Input
                  type="text"
                  maxLength={80}
                  value={selectedNode.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="h-8"
                />
              </label>

              <label className="field">
                <span>Description / Notes</span>
                <textarea
                  rows={2}
                  maxLength={240}
                  value={selectedNode.description ?? ''}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  placeholder="Operational context (max 240 chars)"
                />
              </label>

              <label className="field">
                <span>Custom Type Label</span>
                <Input
                  type="text"
                  maxLength={60}
                  value={selectedNode.customType ?? ''}
                  onChange={(e) => handleCustomTypeChange(e.target.value)}
                  placeholder="e.g., Auth Service, Payment DB"
                  className="h-8"
                />
              </label>
            </div>

            {/* Behavior Switching */}
            <div className="open-inspector-section">
              <span className="open-inspector-section-title">Behavior Model</span>
              <label className="field">
                <span>Execution Behavior</span>
                <select
                  value={behavior.type}
                  onChange={(e) => handleBehaviorTypeChange(e.target.value as BehaviorConfig['type'])}
                >
                  <option value="source">Source (Logical Traffic Entry)</option>
                  <option value="processor">Processor (Service / Worker)</option>
                  <option value="storage">Storage (Database / Objectstore)</option>
                  <option value="router">Router (Gateway / Balancer)</option>
                  <option value="cache">Cache (Fixed / LRU)</option>
                  <option value="broker">Broker (Queue / Stream / PubSub)</option>
                </select>
              </label>
              <p className="open-inspector-help-text">
                Note: Switching behavior resets parameters to type defaults. Connected routes remain intact;
                the execution compiler will flag incompatible connection transports or routing rules.
              </p>
              {behaviorTypeChangeError && (
                <Alert variant="destructive" className="open-review-banner py-2 px-3 my-2 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <AlertDescription className="open-review-banner-text text-xs">
                    {behaviorTypeChangeError}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Applicable Behavior Parameters */}
            <div className="open-inspector-section">
              <span className="open-inspector-section-title">Behavior Parameters</span>

              {behavior.type === 'source' && (
                <p className="open-inspector-help-text">
                  Sources dispatch work without processing cost or a concurrency limit. Attached workloads set arrival rates and deadlines.
                </p>
              )}

              {behavior.type === 'broker' && (
                <>
                  <label className="field">
                    <span>Delivery Mode</span>
                    <select
                      value={behavior.delivery}
                      onChange={(e) => patchBehavior({ delivery: e.target.value as 'competing' | 'broadcast' })}
                    >
                      <option value="competing">Competing Consumers (Queue: one recipient per msg)</option>
                      <option value="broadcast">Broadcast / Fan-out (PubSub: all subscribers receive msg)</option>
                    </select>
                  </label>
                  <NumberField
                    label="Queue Limit"
                    unit="slots"
                    value={behavior.queueLimit}
                    min={0}
                    max={10000}
                    onChange={(val) => patchBehavior({ queueLimit: val })}
                  />
                  <p className="open-inspector-help-text">
                    Brokers store messages in flight without occupying execution CPU capacity.
                  </p>
                </>
              )}

              {behavior.type !== 'source' && behavior.type !== 'broker' && (
                <>
                  <NumberField
                    label="Processing Capacity"
                    unit="req/s per slot"
                    value={behavior.capacity}
                    min={1}
                    max={100000}
                    onChange={(val) => patchBehavior({ capacity: val })}
                  />

                  <NumberField
                    label="Concurrency (Workers)"
                    unit="parallel slots"
                    value={behavior.concurrency}
                    min={1}
                    max={16}
                    onChange={(val) => patchBehavior({ concurrency: val })}
                  />

                  <NumberField
                    label="Queue Limit"
                    unit="waiting slots"
                    value={behavior.queueLimit}
                    min={0}
                    max={10000}
                    onChange={(val) => patchBehavior({ queueLimit: val })}
                  />

                  <NumberField
                    label="Failure Rate"
                    unit="%"
                    value={behavior.failureRate}
                    min={0}
                    max={100}
                    onChange={(val) => patchBehavior({ failureRate: val })}
                  />

                  <NumberField
                    label="Max Retries"
                    unit="attempts"
                    value={behavior.maxRetries}
                    min={0}
                    max={5}
                    onChange={(val) => patchBehavior({ maxRetries: val })}
                  />

                  <NumberField
                    label="Retry Delay"
                    unit="ms"
                    value={behavior.retryDelayMs}
                    min={0}
                    max={10000}
                    onChange={(val) => patchBehavior({ retryDelayMs: val })}
                  />
                </>
              )}

              {behavior.type === 'storage' && (
                <NumberField
                  label="Write Capacity"
                  unit="writes/s"
                  value={behavior.writeCapacity}
                  min={1}
                  max={100000}
                  onChange={(val) => patchBehavior({ writeCapacity: val })}
                />
              )}

              {behavior.type === 'router' && (
                <label className="field">
                  <span>Routing Strategy</span>
                  <select
                    value={behavior.strategy}
                    onChange={(e) =>
                      patchBehavior({ strategy: e.target.value as 'round-robin' | 'weighted' | 'conditional' })
                    }
                  >
                    <option value="round-robin">Round Robin (Even distribution)</option>
                    <option value="weighted">Weighted (Ratio per route)</option>
                    <option value="conditional">Conditional (Match request class/op/tag)</option>
                  </select>
                </label>
              )}

              {behavior.type === 'cache' && (
                <>
                  <label className="field">
                    <span>Cache Eviction Mode</span>
                    <select
                      value={behavior.mode}
                      onChange={(e) => patchBehavior({ mode: e.target.value as 'fixed' | 'lru' })}
                    >
                      <option value="fixed">Fixed Hit Rate</option>
                      <option value="lru">Finite Capacity LRU</option>
                    </select>
                  </label>

                  {behavior.mode === 'fixed' && <NumberField
                    label="Hit Rate"
                    unit="%"
                    value={behavior.hitRate}
                    min={0}
                    max={100}
                    onChange={(val) => patchBehavior({ hitRate: val })}
                  />}

                  {behavior.mode === 'lru' && <><NumberField
                    label="Cache Entries Limit"
                    unit="keys"
                    value={behavior.entries}
                    min={1}
                    max={100000}
                    onChange={(val) => patchBehavior({ entries: val })}
                  />

                  <NumberField
                    label="Time To Live (TTL)"
                    unit="ms"
                    value={behavior.ttlMs}
                    min={1}
                    max={3600000}
                    onChange={(val) => patchBehavior({ ttlMs: val })}
                  /></>}
                </>
              )}
            </div>

            {/* Observed Runtime Metrics */}
            {nodeMetrics && (
              <div className="open-inspector-section">
                <span className="open-inspector-section-title">Observed Resource Metrics</span>
                <div className="open-metrics-grid">
                  <div className="open-metric-item">
                    <span className="open-metric-label">Utilization</span>
                    <span className="open-metric-val">{Math.round(nodeMetrics.utilization * 100)}%</span>
                  </div>
                  <div className="open-metric-item">
                    <span className="open-metric-label">Active Slots</span>
                    <span className="open-metric-val">
                      {nodeMetrics.activeWorkers} / {behavior.type === 'source' || behavior.type === 'broker' ? 0 : behavior.concurrency}
                    </span>
                  </div>
                  <div className="open-metric-item">
                    <span className="open-metric-label">Queue Waiting</span>
                    <span className="open-metric-val">
                      {nodeMetrics.queued} / {behavior.queueLimit}
                    </span>
                  </div>
                  <div className="open-metric-item">
                    <span className="open-metric-label">Completed</span>
                    <span className="open-metric-val">{nodeMetrics.completed}</span>
                  </div>
                  <div className="open-metric-item">
                    <span className="open-metric-label">Rejected</span>
                    <span className="open-metric-val">{nodeMetrics.rejected}</span>
                  </div>
                  <div className="open-metric-item"><span className="open-metric-label">Slot occupancy</span><span className="open-metric-val">{Math.round(nodeMetrics.occupancy * 100)}%</span></div>
                  <div className="open-metric-item"><span className="open-metric-label">Waiting for downstream</span><span className="open-metric-val">{nodeMetrics.waiting}</span></div>
                  <div className="open-metric-item"><span className="open-metric-label">Expired / cancelled cleanup</span><span className="open-metric-val">{nodeMetrics.cleanupProcessing}</span></div>
                  {(
                    <div className="open-metric-item">
                      <span className="open-metric-label">Retrying</span>
                      <span className="open-metric-val">{nodeMetrics.retrying}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Workloads for this node (hidden when dedicated workloads panel/callback provided) */}
            {!onOpenWorkloads && (
              <OpenWorkloadControls
                workloads={graph.workloads ?? []}
                filterNodeId={selectedNode.id}
                readOnly={readOnly}
              />
            )}

            {/* Inline Actions */}
            <div className="open-inspector-actions flex flex-col gap-2 pt-2">
              <Button
                type="button"
                className="open-inspector-btn primary w-full"
                onClick={handleGenerateTraffic}
                disabled={readOnly || (graph.workloads?.length ?? 0) >= 20}
              >
                Generate Traffic
              </Button>
              <Button
                type="button"
                variant="outline"
                className="open-inspector-btn w-full"
                onClick={handleDuplicate}
                disabled={readOnly || graph.nodes.length >= 100}
              >
                Duplicate Node
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="open-inspector-btn danger w-full"
                onClick={handleDelete}
                disabled={readOnly}
              >
                Delete Node
              </Button>
            </div>
          </div>
        </fieldset>
      </aside>
    );
  }

  // Nothing selected: Global System & Workloads Inspector
  return renderGlobalWorkloads('System Configuration');
}
