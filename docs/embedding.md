# Standalone and embedded Canvas One

See [composables.md](composables.md) for independent boards, custom components,
command contributions, canvas replacement and AI collaboration. The example host
keeps all complete-app workflows on its existing `/canvas` mount. Its `/independent`
page is a consumer fixture; it adds no route to the standalone product.

The standalone Next.js shell owns public HTML, metadata and its PWA. The reusable
`CanvasOne` component owns the browser workspace. Mount one workspace per browser
page: existing controllers share its address bar and router.

## Mount inside an existing Next.js application

Create an optional catch-all route at `app/canvas/[[...path]]/page.tsx` so refreshing
project and branch URLs reaches the same mount. Import the workspace stylesheet
once in the host root layout. Build and pack the local React package first:

```sh
npm run build:react
npm pack ./dist-react
```

Install the generated `canvas-one-react-0.1.0.tgz` in the host with
`npm install /path/to/canvas-one-react-0.1.0.tgz`. This package is not published to
npm. The working consumer fixture is `examples/next-host`; it uses a local file
dependency on `dist-react` instead of a tarball.

In the host's root layout:

```tsx
import '@canvas-one/react/styles.css';
```

In the catch-all page:

```tsx
import { CanvasOne } from '@canvas-one/react';

export default function CanvasPage() {
  return <CanvasOne basePath="/canvas" storageNamespace="my-product-canvas" />;
}
```

When the host itself deploys at `/tools`, pass `basePath="/tools/canvas"`. The prefix is the full
browser-visible path; Canvas One does not read the host's Next.js configuration.
Use only letters, numbers, underscores and hyphens in prefix segments.

Navigation remains within that prefix, including projects and branches. The
embedded root opens projects by default; pass `entryRoute="home"` to show the
landing page there. Pass `publicNavigation="document"` when the host renders
landing and Brand as separate server pages. The default `"client"` keeps public
pages in the animated workspace shell.

The component waits for browser mounting before loading the application and opening
IndexedDB. Internal route changes use browser history and retain the host's
history state. Links outside the mount, downloads, modifier clicks, query strings
and fragments remain ordinary browser navigation.

## Storage and ownership

Omit `storageNamespace` in standalone mode to retain existing local projects and
the existing actor identity. Supply a stable namespace when embedding to isolate
its database and identity from other installations on the same origin. Changing
the namespace opens a separate dataset; it does not migrate or delete projects.
Portable project identifiers and exports keep their existing format.

Canvas One does not register a service worker when embedded. The host owns its
manifest, icons, service worker scope, caching and updates. Installation and
offline reopening require the host to cache its catch-all workspace shell and
all required assets. A route mount alone does not provide offline functionality.

The mount is intended to occupy the workspace viewport. Foundation styles and
theme variables belong to `.canvas-one-root`; the host must provide the built
stylesheet and any associated font assets. Mount and portal ownership are shared
so menus inherit the workspace theme.

## Separate deployment behind a subroute

A separately deployed standalone app can also run behind a reverse proxy. That
is a deployment integration: configure the standalone Next.js base path and
proxy routes consistently, including its assets, manifest and service worker.
It does not use the component mount above and is not selected automatically.
