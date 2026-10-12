# Local CLI and MCP

Start `canvas-one-agent bridge --origin http://localhost:3000`, then pair the current app with its short-lived code. Set `CANVAS_ONE_AGENT_TOKEN` to the printed agent token (keep it outside project files). Use `canvas-one-agent call board_inspect`, `component_schemas`, `document_validate`, `proposal_submit` or `proposal_status`; pass JSON via `--file` or `--input`.

Use `diagram_create` for readable component aliases, optional automatic positions and connections. Discover the diagram schema with `component_schemas`; supply the project/branch scope and revision returned by `board_inspect`. Repeating the same operation retains the original generated component IDs; changing its payload requires a new operation ID. Review and accept the proposal in the browser.

For a local MCP client, launch `node packages/cli/dist/main.js mcp` with bridge URL/token in its environment. The stdio server supports initialization, tool discovery, concurrent tool calls and cancellation. Proposals require human review in the browser; CLI/MCP never write IndexedDB directly. MCP messages use newline-delimited JSON-RPC and logs go to stderr, per the [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).
