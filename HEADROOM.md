# Headroom - Context Optimization Layer

**Usage**: Token-optimized context compression layer for AI coding agents and LLM tool outputs.

Headroom complements [`RTK.md`](RTK.md):
- **RTK** optimizes shell command execution output in the terminal (`rtk git status`, `rtk npm run build`).
- **Headroom** optimizes LLM context windows (tool outputs, file contents, JSON responses, RAG chunks) before requests reach the model.

---

## Architecture: Compress-Cache-Retrieve (CCR)

1. **Compress**: Intercepts tool calls and context payloads, applying AST-aware code compression and JSON crushing (60–95% on JSON, 15–20% on coding loops).
2. **Cache**: Stores original, uncompressed data locally on disk.
3. **Retrieve**: If the LLM needs full details, it invokes the retrieval tool (`headroom_retrieve`) to fetch the exact raw content from the local proxy cache.

---

## Integration Modes

### 1. Agent Wrapping (`headroom wrap`)
Automatically launches a local proxy, configures environment variables, and executes the agent session:

```bash
headroom wrap codex             # Launch OpenAI Codex CLI session through Headroom
headroom wrap claude            # Launch Claude Code through Headroom
headroom wrap copilot           # Launch GitHub Copilot CLI through Headroom
headroom wrap cursor            # Configure and launch Cursor proxy
headroom wrap aider             # Launch Aider through Headroom
```

### 2. Model Context Protocol (`headroom mcp`)
Registers Headroom as an MCP server into detected coding agents (Codex CLI, Claude Code, etc.):

```bash
headroom mcp install            # Install Headroom MCP server across detected agents
headroom mcp status             # Check MCP SDK and agent configuration status
headroom mcp serve              # Run MCP server directly (called by MCP clients)
```

**Exposed MCP Tools**:
- `headroom_retrieve`: Fetch full uncompressed content using cache markers.
- `headroom_compress`: Compress context payloads on demand.
- `headroom_stats`: Query session and persistent token savings.

### 3. Standalone Proxy (`headroom proxy`)
Runs a local proxy server for any OpenAI- or Anthropic-compatible client without code changes:

```bash
headroom proxy                  # Starts proxy at http://127.0.0.1:8787
```

Configure clients with:
```bash
export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
```

---

## Analytics & Diagnostics

```bash
headroom savings                # Show cumulative token compression savings
headroom agent-savings          # Render or verify Codex/Claude/Cursor savings
headroom doctor                 # Verify proxy and client routing health
headroom dashboard              # Launch interactive savings dashboard in browser
headroom inspect                # Show original vs. compressed content for recent calls
```

---

## Verification

```bash
which headroom                  # ~/.local/bin/headroom
headroom --version              # Verify installed version
headroom mcp status             # Verify MCP environment readiness
```
