# Strands Agents coverage in TypeScript/Deno

Type: research
Status: resolved
Blocked by:

## Question

Does the Strands Agents TypeScript SDK cover what this repo uses from Python `strands-agents` / `strands-agents-tools`, and does it run under Deno?

APIs in use: `strands.Agent`, the `@tool` decorator, `strands.models.BedrockModel`, `strands.tools.mcp.mcp_client.MCPClient` with `mcp.client.streamable_http.streamablehttp_client` (Gateway access), `strands_tools.calculator`, `strands_tools.code_interpreter` (AgentCore code interpreter tool), and `strands_tools.browser` (AgentCore browser tool).

Report the package names, maturity (GA or preview), API differences, missing tools, and Deno compatibility. Name the primary sources.

## Context pointer

Findings: branch `research/strands-typescript`, file `docs/research/strands-typescript.md`

## Answer

**Covered, with API differences.**

- **Package:** `@strands-agents/sdk` 1.18.0, GA since 2026-04-30. Source is in `strands-agents/harness-sdk/strands-ts`.
- **Agent:** `Agent`, `systemPrompt` and `BedrockModel({ modelId, region })` map directly. Calls are async only: `await agent.invoke(prompt)` and `agent.stream()`.
- **Tools:** there is no `@tool` decorator. Tools use `tool({ name, description, inputSchema: zod, callback })`, with zod ^4 as a peer dependency. Names, descriptions and schemas are written out explicitly.
- **Gateway:** `new McpClient({ url, headers })` + `listTools()` replaces `MCPClient` + `streamablehttp_client`. Only notebook 10 uses it; `unified_travel_agent.py` hand-rolls JSON-RPC.
- **Tool gaps:**
  - There is no TS `strands-agents-tools`. `calculator`, used in 09 and 11, needs a custom tool.
  - The code interpreter and browser tools come from `bedrock-agentcore` 0.4.4 `experimental/*/strands` (pre-1.0).
  - The code interpreter becomes 3 tools.
  - The browser becomes 7 tools against about 22 Python actions: no tabs, cookies, back/forward, press_key or raw CDP. It needs `playwright` `connectOverCDP`.
- **Deno, smoke-tested locally without Bedrock:** agent loop, zod tool, bearer-auth `McpClient`, streaming, and building `BedrockModel` / `CodeInterpreterTools` / `BrowserTools` all passed. Deno isn't officially supported. Scripts needed an explicit `Deno.exit(0)` after disconnecting.
- **Not verified:** a live Bedrock call, live code-interpreter or browser sessions, Playwright `connectOverCDP` under Deno, and the Fastify-based `bedrock-agentcore/runtime` under Deno.

Full findings with sources: branch `research/strands-typescript`, `docs/research/strands-typescript.md` (commit cd1b126).
