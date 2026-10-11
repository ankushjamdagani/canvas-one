# @canvas-one/ui

Presentation-only foundation primitives for Canvas One. This package owns its component props and has no document, history, storage, simulation, or app dependencies.

```tsx
import { Button } from "@canvas-one/ui/button";
import { Input } from "@canvas-one/ui/input";
```

Build with `npm run build --workspace @canvas-one/ui`. Public exports resolve to emitted JavaScript and declarations; consumers must build the workspace first. React is a peer dependency.

Controls retain the existing semantic Tailwind classes. The current app supplies its existing design tokens and stylesheet; hosts supply matching token definitions and include `packages/ui/src` in their Tailwind content sources. This first extraction does not export the app-wide stylesheet, motion environment, themes or portal controls, because they still depend on product composition. Root `src/components/ui` forwarding modules preserve current consumer imports while ownership moves here.
