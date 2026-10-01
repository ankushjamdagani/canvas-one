import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { nodeKindColor, computeTagColors, type NodeKindLayer } from '@/components/studio/tokens';

const meta: Meta = {
  title: 'Design System/Node Kind Colors',
  parameters: {
    layout: 'padded',
  },
};

export default meta;

export const NodeKindPalette: StoryObj = {
  name: 'System Layer Stripes',
  render: () => {
    const layers: { key: NodeKindLayer; name: string; description: string }[] = [
      { key: 'clients', name: 'Clients', description: 'Web browsers, mobile apps, IoT devices, API callers' },
      { key: 'edge', name: 'Edge & Ingress', description: 'API Gateways, Load Balancers, CDN, Reverse Proxies' },
      { key: 'compute', name: 'Compute & Services', description: 'Application servers, microservices, RPC endpoints, workers' },
      { key: 'messaging', name: 'Messaging & Queues', description: 'Message brokers, event streams, pub/sub topics, buffers' },
      { key: 'data', name: 'Databases & Storage', description: 'Relational DBs, Document stores, Key-value caches, Object storage' },
      { key: 'operations', name: 'Operations & Monitoring', description: 'Log collectors, telemetry, cron triggers, background jobs' },
    ];

    return (
      <div className="space-y-6 max-w-4xl">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink font-sans">Node Kind Layer Colors</h2>
          <p className="text-xs text-secondary-text mt-1">
            Top 3px stripe colors applied to canvas nodes based on their architectural catalog layer.
            Meets WCAG 2.2 contrast requirements against both white canvas and panel surfaces.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {layers.map((layer) => {
            const hex = nodeKindColor[layer.key];
            const tagStyles = computeTagColors(hex);

            return (
              <div
                key={layer.key}
                className="relative rounded-node border border-control-border bg-background p-4 shadow-sm space-y-3 overflow-hidden"
              >
                {/* 3px Node stripe */}
                <div
                  className="absolute inset-x-0 top-0 h-[3px] rounded-t-node"
                  style={{ backgroundColor: hex }}
                />

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="size-3 rounded-full shrink-0"
                      style={{ backgroundColor: hex }}
                    />
                    <h4 className="text-sm font-semibold text-foreground">{layer.name}</h4>
                  </div>
                  <span className="font-mono text-xs text-secondary-text">{hex}</span>
                </div>

                <p className="text-xs text-body leading-relaxed">{layer.description}</p>

                {/* Example tag / badge rendered with computeTagColors */}
                <div className="pt-2 border-t border-hairline flex items-center justify-between">
                  <span className="font-mono text-[10px] text-secondary-text uppercase">Badge Preview:</span>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-tag text-xs font-mono font-medium"
                    style={{
                      backgroundColor: tagStyles.backgroundColor,
                      borderColor: tagStyles.borderColor,
                      color: tagStyles.color,
                      borderWidth: '1px',
                    }}
                  >
                    {layer.key}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  },
};
