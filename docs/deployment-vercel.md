# Deploy Canvas One on Vercel

Import `ankushjamdagani/canvas-one` through Vercel's GitHub integration. This is one
Next.js project; packages are workspace dependencies, not separately deployed apps.
Apply these project settings before the first build:

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root Directory | `apps/web` |
| Include source files outside Root Directory in the Build Step | Enabled |
| Install Command override | `cd ../.. && npm ci` |
| Build Command override | `cd ../.. && npm run build` |
| Output Directory | Framework default (`.next` within `apps/web`) |
| Node.js version | `22.x`, matching GitHub CI |
| Production Branch | `master`, this repository's default branch |

The commands run from `apps/web`, return to the repository root, install its
workspace lockfile and build package exports before Next. Use the Next.js preset;
do not select Vite, point output at `dist-react`, or configure a standalone start
command. Vercel manages the Next runtime. Current `outputFileTracingRoot` already
includes the repository for workspace imports. The standalone output remains useful
for self-hosting and local production tests.

Set `CANVAS_SITE_URL` to the production origin, for example
`https://canvas-one.example.com`, in the Production environment for canonical URLs,
robots and sitemap. For initial deployment, the production `.vercel.app` origin is
also valid. Leave `NEXT_PUBLIC_CANVAS_BASE_PATH` unset when deploying at `/`.
Neither value is an agent credential. Preview can leave `CANVAS_SITE_URL` unset.

Feature branch pushes create preview deployments; merging a reviewed PR to `master`
updates production. Import the repository and test PR #2's preview before merging.
Deployment creation alone does not prove GitHub CI passed: keep required CI checks
in GitHub branch protection. Add a custom domain in Vercel's project Domains settings
and apply the DNS records Vercel shows; then update `CANVAS_SITE_URL` and redeploy.

After deployment, verify landing/brand, create and reload a project, author/undo,
run simulation, export/import and pair a local agent. Projects remain in browser
IndexedDB: Vercel deployment does not provide a shared database or human multiplayer.
Different origins (including preview domains) have separate local projects. Export
before moving to another origin if that project's data is needed there.

Run the agent bridge locally with the exact deployed origin allowed, such as:

```sh
node packages/cli/dist/main.js bridge --origin https://canvas-one.example.com
```

Pair in the browser using its printed loopback address and short-lived code. A secure
origin may ask for local-network permission. The bridge is a local process; do not
deploy it as a Vercel Function. Model clients and credentials remain host-supplied.

These are repository-specific setup instructions, not a claim that an account,
domain or Vercel deployment has already been created or verified.

Official references: [monorepos](https://vercel.com/docs/monorepos),
[outside-root source files](https://vercel.com/docs/monorepos/monorepo-faq),
[build configuration](https://vercel.com/docs/builds/configure-a-build),
[Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[Git deployments](https://vercel.com/docs/git).
