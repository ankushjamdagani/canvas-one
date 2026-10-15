# Local agent bridge

The desktop task service is exported from `@canvas-one/agent-bridge/collaboration-server`; its installed-CLI backend is Node-only under `@canvas-one/agent-bridge/runtime`. `CollaborationBrowserClient` is available from the headless root and holds no persisted bearer token. The service checks exact loopback Host/origin, pairs with a five-minute single-use secret, and separates browser authorization from private provider capabilities. It forwards board requests to the browser's existing authoring authority. See [CLI setup](../cli/README.md) for `collaborate`.

Claude uses scoped MCP with native tools disabled; Codex uses scoped app-server dynamic tools. agy remains explicitly unavailable. Cancellation acknowledgement requires process close, while revoked or expired task leases prevent further board writes immediately. Questions use a read-only tool allowlist. Event cursors belong to a specific service instance; gaps require explicit recovery.

The retained review-only bridge below is for custom hosts; it is separate from the app's task service.

`startLocalBridge` binds to IPv4 loopback and accepts only configured exact browser origins. Pair one browser with the single-use 120-second code, then authenticate browser and CLI requests with separate in-memory tokens. The relay forwards tools to the browser; it never opens or writes project storage. Browser reconnects replay unanswered requests, and request identities reject different payloads. Hosted human collaboration is a separate provider.

Secure hosted origins may require browser local-network permission. The isolated
Chromium HTTPS-origin fixture verifies pairing and authenticated polling after that
permission is granted; this is not a compatibility claim for every browser.
