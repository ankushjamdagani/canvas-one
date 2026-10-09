# Existing Next.js host example

This fixture consumes the built React package, not application source. It mounts
Canvas One under `/canvas`, with project and branch refreshes served by the
optional catch-all route. Canvas One occupies the full viewport. The host's
magenta body and red `--primary` token deliberately differ from workspace tokens.
The fixed Host home link sits outside the workspace root and uses host routing.

From the repository root:

```sh
npm run build:react
npm install --prefix examples/next-host
npm run build --prefix examples/next-host
npm run start --prefix examples/next-host
```

Open http://localhost:5198/canvas. This host does not register a service worker;
the host must implement its own PWA setup if installation or offline loading is
needed. `storageNamespace="next-host-example"` isolates fixture projects.
