# Traffic visualization

Import either design from `@/components/traffic`. Components render supplied facts; they do not run simulations or calculate rate windows. The production workspace uses Cells and lanes, driven by `PlaybackStore.trafficAt`.

## Cells and lanes

```tsx
import { CellsAndLanesNode, CellsAndLanesConnection } from '@/components/traffic';

<CellsAndLanesNode label="Payment" activity={{
  queued: 42, processing: 8, capacity: 8, awaiting: 46, retry: 3,
  services: [{ name: 'Fraud', pending: 38 }, { name: 'Orders', pending: 8 }],
  outcomes: [{ kind: 'error', rate: 0.8, detail: 'Recorded processing errors' }],
}} />
<CellsAndLanesConnection activity={{ forward: 6, returning: 4, errors: 1 }}
  progress={playbackProgress} reducedMotion={reducedMotion} />
```

- Node width remains 208px; hover/focus/tap inspection floats at 240px. Reserve space below it, or let the host canvas contain overflow. Enter/Space pins; Escape releases.
- Populations are counts at the playhead. Awaiting counts outstanding synchronous calls, including work held, travelling, queued, processing or returning. Service entries list pending calls only.
- `capacity` is configured processing slots, not a throughput rate. No progress is an explicitly observed subset of open waits.
- `progress` is supplied in `[0,1)` by playback. Freeze it while paused. `reducedMotion` gives evenly spaced static markers. Marker density is bounded at 12 per lane; above 50 in flight, a band communicates aggregation.
- `forward` counts requests/messages; `returning` counts responses/ACKs, including `errors`. `late` denotes additional responses to closed waits; never include them in a node's awaiting count. `blocked` is a separate population held at the sending end. Loss/exhaustion describe terminal deliveries, not motion.
- `outcomes[].rate` is events per second over the trailing **10 simulation seconds**. It may remain positive on an idle node. Supply `detail` for recorded cause information. Rate windows and counts are independent of canvas/timeline zoom.
- Source palette, fixed cells, shapes, lanes and sunken trays follow the approved Cells and lanes design. Sync and async use the same components.
- Canvas hosts can use `activityOnly` on the node to retain their authored header and controls, `path` on the connection for existing SVG routing, and `CellsAndLanesConnectionInspection` in a label portal. Keep activity outside measured node bounds and enable pointer events on inspection targets. The workspace retains authored widths and port geometry.
- Runtime awaiting counts remain synchronous calls only. Message ACKs use returning lanes; broker deliveries use message scope. Capacity is configured concurrency, including any currently reserved or held slots. Blockage comes from explicit consumer-capacity observations; it is not inferred from a queue or a quiet connection.

Storybook: **Design System / Cells and lanes / Guide** includes node, connection, outcome and simultaneous examples in low/high/live traffic. Fixtures are illustrative. Transition design and historical totals remain deferred.

## Current visualization

```tsx
import {
  CurrentTrafficNode, CurrentTrafficConnection, CurrentTrafficStyles,
  CurrentTrafficActivityProvider, CurrentTrafficMotionProvider,
  currentTrafficMotionDefaults,
} from '@/components/traffic';

// Use inside a ReactFlow host. Nodes retain the existing NodeCard data model.
const nodeTypes = { element: CurrentTrafficNode };
const edgeTypes = { traffic: CurrentTrafficConnection };

<CurrentTrafficMotionProvider value={{ ...currentTrafficMotionDefaults,
  count: 120, progress: playbackProgress, direction: 'dual',
}}>
  <CurrentTrafficActivityProvider value={{
    processing: 4, queued: 42, awaiting: 120,
    services: [{ name: 'Payment', count: 120 }],
  }}>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}>
      <CurrentTrafficStyles />
    </ReactFlow>
  </CurrentTrafficActivityProvider>
</CurrentTrafficMotionProvider>
```

For different per-node populations, place the activity provider in your custom node wrapper. The current renderer uses ReactFlow node/edge props, the existing architecture data model, and the workspace playback context for its base node. Its one-second summaries and expanding footers remain unchanged. Storybook: **Design System / Traffic visualization / Fundamentals**.
