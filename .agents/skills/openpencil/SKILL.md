---
name: openpencil
description: Inspect, create, edit and verify OpenPencil design documents through its local MCP server. Use for OpenPencil canvas work and connection troubleshooting; preserve explicit requests to work in Figma.
---

# OpenPencil

Prefer the connected OpenPencil MCP tools for design-canvas work. This local workflow avoids dependence on Figma service quotas; model context limits still apply. Do not migrate an existing Figma document unless the task calls for it.

## Connect and identify the target

- Check for available OpenPencil tools first. If absent, check whether the desktop app and `openpencil-mcp` are installed before proposing installation. The official npm package is `@open-pencil/mcp`; the stdio command is `openpencil-mcp`.
- The desktop app owns the local server. Open the app with a document loaded; inspect Settings → MCP for status and installed version. Reuse its server rather than starting a competing HTTP server. Use the installed tool schemas, not a memorized tool catalog.
- A successful MCP `initialize` handshake proves only that the bridge started. Verify an actual document read: normally `list_documents`, then a bounded `get_page_tree`. Pass the returned `document_id` and `page_id` explicitly on subsequent calls. Do not assume IDs persist across sessions.
- In selection-only mode, use `get_selection` and inspect only permitted descendants instead of `list_documents`. Missing edit tools may reflect deliberate scope or tool-access settings; do not widen access automatically.
- If no native tools are exposed, a temporary MCP client using stdio is a workable fallback. Complete `initialize`, send `notifications/initialized`, inspect the required tool schemas, then use `tools/call`. Close the client after the operation. A temporary client does not register a persistent integration in the agent.

## Diagnose misleading connection errors

The 2026-10-24 local test used OpenPencil/MCP 0.16.0. The app showed Running, but a sandboxed bridge reported “app is not connected.” The underlying failure was `EPERM` accessing the Unix socket; a permitted connection outside that sandbox succeeded. Treat this as a diagnostic possibility, not the explanation for every connection failure.

1. Inspect bridge stderr and transport errors before declaring the app disconnected. Distinguish an inaccessible socket, failed discovery and an actual missing document.
2. On macOS, that installation stored discovery at `~/Library/Application Support/OpenPencil/mcp.json`. Discover the current location rather than assuming this path on other systems. Never print the file: it contains the bearer token.
3. In 0.16.0, default discovery attempted `chmod` on the support directory, which could itself fail in a sandbox. Setting `OPENPENCIL_MCP_DISCOVERY_PATH` to the existing discovery file avoided that directory-permission change. This does **not** grant socket access.
4. Check the discovered transport's `/health` endpoint without exposing credentials. `ok` confirms the app connection; an MCP handshake alone does not. If the sandbox blocks the socket, use the environment's approved escalation mechanism for the scoped operation. Do not disable authentication, loosen filesystem permissions or change network bindings to bypass it.
5. If access is allowed but the server is unhealthy, inspect app state and consider one server restart/reconnect when safe for the ongoing work. Stop repeated retries when the same blocker persists and report the actual error.

## Edit and verify

- Inspect the relevant nodes before editing. Bound reads by depth, root or node type; request only the schemas needed for the task.
- Use `render` for composed JSX or dedicated shape/layout tools for focused edits. Inspect renderer warnings: unsupported props may be ignored while the call still succeeds. In the tested version, React-style `flexDirection` was ignored; use documented OpenPencil layout syntax or explicit coordinates as appropriate.
- Consult the current [JSX renderer reference](https://openpencil.dev/programmable/jsx-renderer) when composing layouts; do not assume DOM/CSS props work. Use `replace_id` only for a known task-owned placeholder because it deletes the old node.
- Read back the edited subtree and inspect an `export_image` result or the live app. A successful creation response does not prove correct text positioning or layout. Keep exported image dimensions bounded with the tool's `maxEdge` option.
- Save a requested deliverable with `save_file` to a deliberate path within the configured MCP root. Preserve existing documents and unsaved human work. Report whether the result is saved or remains in the app.
- Keep authentication enabled and file operations scoped with `OPENPENCIL_MCP_ROOT`. Do not enable arbitrary eval merely to make ordinary design tools work.

Official setup and transport details: [OpenPencil MCP server](https://openpencil.dev/programmable/mcp-server). Recheck these docs when installed behavior or tool schemas differ from the tested version.
