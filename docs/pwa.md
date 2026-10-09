# Standalone offline workspace

The standalone Next.js shell registers `src/standalone/PwaRegistration.tsx` in production. The reusable CanvasOne component does not register a worker. An embedding host owns its manifest, service worker and offline policy.

Run `npm run build`; it builds Next.js, generates `public/sw.js`, and copies public and static assets into `.next/standalone`. Run `npm start` to serve that deployment. Deploy the matching `.next/standalone` directory as a unit. HTTPS is required outside localhost.

Set `NEXT_PUBLIC_CANVAS_BASE_PATH=/canvas` consistently at build time when deploying the standalone app under `/canvas`. The Next base path, manifest URLs, worker scope and generated asset URLs must agree. Serving `sw.js` with `Cache-Control: no-cache` allows update checks to see new releases.

The worker precaches the landing, Brand and projects HTML shells plus every emitted Next static asset, including lazy canvas chunks, worker bundles, fonts and CSS. Installation succeeds only after all files are cached. Visit the deployed app online, wait for installation and reload online so the worker controls the page before testing offline. Projects are retained in IndexedDB; clearing browser site data removes them.

Offline workspace navigations, including deep project URLs, receive the cached `/projects` HTML shell. The client router resolves the current browser pathname and opens the local project. Public routes have their own offline HTML. Unknown routes, API requests, cross-origin requests, React Server Component requests and private server responses are not cached. Successful online navigations are not added to caches.

Updates wait until existing controlled tabs close; there is no automatic skip-waiting or forced reload during editing. Activation removes older caches within this standalone deployment's own namespace. A future update prompt must preserve unsaved workspace state before offering activation.

Validate on the production server: open a project online, wait for the worker to control the page, disable the network, reload the project URL, and verify the canvas, lazy inspectors and local project changes. Also test installation, offline `/projects`, base-path deployment, and updating with an editor tab open. Offline loading does not supply remote accounts, collaboration or AI services.
