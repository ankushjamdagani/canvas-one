import React from 'react';
import { X } from 'lucide-react';
import { useEditor } from '../state/editor';
import { NumberField } from './NumberField';
import type { ModelEdge } from '../domain/model';

export function OpenConnectionEditor({
  edgeId,
  onClose,
  docked = false,
}: {
  edgeId: string;
  onClose: () => void;
  docked?: boolean;
}) {
  const editor = useEditor();
  const readOnly = editor.readOnly;
  const graph = editor.project.graph;
  const edge = graph.edges.find((e) => e.id === edgeId);

  const containerClass = `inspector ${docked ? "open-connection-editor-docked" : "open-connection-editor"}`;

  if (!edge) {
    return (
      <aside className={containerClass} aria-label="Connection editor">
        <div className="inspector-heading">
          <strong>Connection Not Found</strong>
        </div>
        <p className="open-inspector-help-text">The selected connection was removed or is missing.</p>
        <button type="button" className="open-inspector-btn" onClick={onClose}>
          Close
        </button>
      </aside>
    );
  }

  const sourceNode = graph.nodes.find((n) => n.id === edge.source);
  const targetNode = graph.nodes.find((n) => n.id === edge.target);

  const sourceIsBroker = sourceNode?.behavior?.type === 'broker';
  const targetIsBroker = targetNode?.behavior?.type === 'broker';
  const routerSource = sourceNode?.behavior?.type === 'router' ? sourceNode.behavior : null;

  const mustBeMessage = sourceIsBroker || targetIsBroker;
  const isPublication = edge.transport === 'message' && !sourceIsBroker;

  const patchEdge = (patch: Partial<ModelEdge>) => {
    editor.change((g) => {
      const e = g.edges.find((item) => item.id === edgeId);
      if (e) Object.assign(e, patch);
    });
  };

  const handleDelete = () => {
    editor.change((g) => {
      g.edges = g.edges.filter((e) => e.id !== edgeId);
    });
    onClose();
  };

  const handleConfirmConnection = () => {
    patchEdge({ needsReview: false });
  };

  return (
    <aside className={containerClass} aria-label="Connection configuration">
      <div className="inspector-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Connection Settings</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            className="open-inspector-btn"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={onClose}
          >
            Done
          </button>
          <button
            type="button"
            aria-label="Close inspector"
            className="subtle"
            style={{ padding: '2px', display: 'flex', alignItems: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <fieldset disabled={readOnly} className="open-inspector-fieldset">
        <div className="open-inspector-section">
          <p className="open-inspector-help-text">
            Connecting <strong>{sourceNode?.name ?? edge.source}</strong> → <strong>{targetNode?.name ?? edge.target}</strong>
          </p>

          {edge.needsReview && (
            <div className="open-review-banner">
              <span className="open-review-banner-text">
                Review Required: This connection topology or behavior changed. Please confirm or update the transport properties below.
              </span>
              <button
                type="button"
                className="open-inspector-btn primary"
                onClick={handleConfirmConnection}
                disabled={readOnly}
              >
                Confirm Connection
              </button>
            </div>
          )}

          <label className="field">
            <span>Label</span>
            <input
              type="text"
              maxLength={60}
              value={edge.label ?? ''}
              onChange={(e) => patchEdge({ label: e.target.value.slice(0, 60) })}
              placeholder="e.g., HTTP / gRPC / Publishes to"
            />
          </label>

          <label className="field">
            <span>Protocol</span>
            <input
              type="text"
              maxLength={30}
              value={edge.protocol ?? ''}
              onChange={(e) => patchEdge({ protocol: e.target.value.slice(0, 30) })}
              placeholder="e.g., https, grpc, amqp"
            />
          </label>

          <label className="field">
            <span>Transport</span>
            <select
              value={edge.transport ?? (mustBeMessage ? 'message' : 'call')}
              disabled={readOnly}
              onChange={(e) => {
                const transport = e.target.value as 'call' | 'message';
                patchEdge({ transport });
              }}
            >
              <option value="call" disabled={mustBeMessage}>
                Synchronous Call (RPC/HTTP)
              </option>
              <option value="message">Asynchronous Message (Queue/PubSub)</option>
            </select>
          </label>
          {mustBeMessage && (
            <span className="open-inspector-help-text" style={{ fontSize: '11px', color: '#a76108' }}>
              Broker connections require message transport.
            </span>
          )}

          <NumberField
            label="Forward Latency"
            unit="ms"
            value={edge.latencyMs ?? 0}
            min={0}
            max={60000}
            onChange={(val) => patchEdge({ latencyMs: val })}
          />

          <NumberField
            label="Return Latency"
            unit="ms"
            value={edge.returnLatencyMs ?? 0}
            min={0}
            max={60000}
            onChange={(val) => patchEdge({ returnLatencyMs: val })}
          />

          {isPublication ? (
            <>
              <NumberField
                label="Broker Ack Delay"
                unit="ms"
                value={edge.ackDelayMs ?? 8}
                min={0}
                max={60000}
                onChange={(val) => patchEdge({ ackDelayMs: val })}
              />
              <NumberField
                label="Message TTL"
                unit="ms"
                value={edge.messageTtlMs ?? 2000}
                min={1}
                max={3600000}
                onChange={(val) => patchEdge({ messageTtlMs: val })}
              />
            </>
          ) : sourceIsBroker ? (
            <p className="open-inspector-help-text" style={{ fontSize: '11px' }}>
              Ack delay and message TTL apply when publishing to brokers, and are not used on consumer dispatch paths.
            </p>
          ) : null}

          {routerSource?.strategy === 'weighted' && (
            <NumberField
              label="Router Outgoing Weight"
              value={edge.weight ?? 1}
              min={0.01}
              max={10000}
              step={0.1}
              onChange={(val) => patchEdge({ weight: Math.max(0.01, val) })}
            />
          )}

          {routerSource?.strategy === 'conditional' && (
            <div className="open-inspector-section" style={{ borderTop: '1px solid #e1e7e3', paddingTop: '8px' }}>
              <span className="open-inspector-section-title">Router Conditional Match</span>
              <label className="field" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={edge.fallback ?? false}
                  disabled={readOnly}
                  onChange={(e) => {
                    const fallback = e.target.checked;
                    patchEdge({
                      fallback,
                      ...(fallback ? { condition: undefined } : {}),
                    });
                  }}
                />
                <span>Fallback Route (Catch-all)</span>
              </label>

              {!edge.fallback && (
                <>
                  <label className="field">
                    <span>Match Field</span>
                    <select
                      value={edge.condition?.field ?? 'class'}
                      disabled={readOnly}
                      onChange={(e) => {
                        const field = e.target.value as 'class' | 'operation' | 'tag';
                        patchEdge({
                          condition: {
                            field,
                            value: edge.condition?.value ?? (field === 'operation' ? 'read' : 'default'),
                          },
                        });
                      }}
                    >
                      <option value="class">Request Class Name</option>
                      <option value="operation">Operation (read/write)</option>
                      <option value="tag">Tag</option>
                    </select>
                  </label>

                  <label className="field">
                    <span>Match Value</span>
                    <input
                      type="text"
                      maxLength={80}
                      value={edge.condition?.value ?? ''}
                      placeholder={edge.condition?.field === 'operation' ? 'read or write' : 'Value to match'}
                      disabled={readOnly}
                      onChange={(e) => {
                        patchEdge({
                          condition: {
                            field: edge.condition?.field ?? 'class',
                            value: e.target.value.slice(0, 80),
                          },
                        });
                      }}
                    />
                  </label>
                </>
              )}
            </div>
          )}

          <div className="open-inspector-actions">
            <button
              type="button"
              className="open-inspector-btn danger"
              onClick={handleDelete}
              disabled={readOnly}
            >
              Delete Connection
            </button>
          </div>
        </div>
      </fieldset>
    </aside>
  );
}
