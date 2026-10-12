# Independent React board

`<Board runtime={runtime} editor={adapter} host={EditorHost} actor={actor} renderers={basicRenderers} />`
renders a BoardDocument with the supplied engine. The root imports no React Flow.
For the default engine use `ReactFlowBoard` from `@canvas-one/react/reactflow`.
Import `@canvas-one/react/style.css` for the generic host, or
`@canvas-one/react/reactflow.css` for the optional React Flow composition.
No storage, simulator, app routing or project list is imported. Omitting actor
makes authored gestures read-only; hosts still inspect and select objects.

Pass `editor` and optional `host` to select another adapter/presentation. A custom
imperative adapter mounts directly into the board's own container when no React
host is supplied. Namespaced component renderers are supplied separately from
semantic data; unknown components render labeled placeholders and retain data.
Each mounted board owns its selection, viewport and editor lifecycle.
The host owns runtime disposal, persistence, history and agent composition.

Custom UI inside the board can use `useBoardRuntime`, `useBoardSnapshot`,
`useBoardActor` and `useBoardPortalTarget`. The actor is absent in read-only boards.
The portal target becomes available after mount and is local to that instance;
bind your chosen UI library's portals there. Semantic editing still uses planners
and the runtime's validated transaction contract.

The full CanvasOne application compatibility bundle remains a separate build
artifact. This workspace package never imports the product application.
