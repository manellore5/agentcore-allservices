# Strands Agents TypeScript SDK: coverage and Deno compatibility

Research date: 2026-09-22. Question: does the Strands Agents TypeScript SDK cover what this repo uses from Python `strands-agents` / `strands-agents-tools`, and does it run under Deno?

**Short answer:** Mostly yes. `@strands-agents/sdk` 1.18.0 (GA since 1.0) covers `Agent`, custom tools, `BedrockModel`, and an MCP client that can reach AgentCore Gateway over Streamable HTTP with a bearer header. `strands-agents-tools` has no TypeScript package. Code Interpreter and Browser tools for Strands TS come from AWS's `bedrock-agentcore` npm package (0.4.4, pre-1.0, subpaths marked "experimental"). The repo has to write its own `calculator`. Deno is not an officially supported runtime. Even so, a local smoke test passed on Deno 2.9.7 with `npm:` specifiers: agent loop, zod tool, MCP over HTTP with a bearer token, `BedrockModel` construction, and importing and constructing the AgentCore code-interpreter and browser tools. The browser tool depends on Playwright's `connectOverCDP`, which has not been checked under Deno.

---

## 1. What the repo uses (from grep)

Pinned Python versions: `strands-agents` 1.17.0 and `strands-agents-tools` 0.2.17 (`uv.lock`, `pyproject.toml` lines 28-29).

| Python API | Where | How it is used |
|---|---|---|
| `strands.Agent` | `backend/runtime/simple_agent/travel_agent.py`, `backend/runtime/final_agent/unified_travel_agent.py`, `backend/identity/runtime/travel_agent_google_drive.py`, notebooks 02, 06, 07, 09, 10, 11 | Always `Agent(model=..., tools=[...], system_prompt="...")`. Called synchronously as `agent(prompt)`. The result is read as `response.message['content'][0]['text']` or `str(response)`. The Google Drive agent passes `model="us.anthropic..."` as a plain string. **Not used anywhere:** `stream_async`, `callback_handler`, hooks, `session_manager`, conversation managers. The default console callback handler is left on. |
| `@tool` | all of the above | Plain decorator on typed functions; docstrings become descriptions; returns dicts or str. Once with overrides: `@tool(name="save_itinerary_to_drive", description=...)` (`travel_agent_google_drive.py`). |
| `strands.models.BedrockModel` | same files | Only `BedrockModel(model_id=...)`, once with `region_name=region` (notebook 10). Model IDs: `us.anthropic.claude-3-7-sonnet-20250219-v1:0`, `us.anthropic.claude-haiku-4-5-20251001-v1:0`. |
| `MCPClient` + `streamablehttp_client` | notebook 10 (`10-agentcore_policy_lab.ipynb`, cell 10) only | `MCPClient(lambda: streamablehttp_client(gateway_url, headers={"Authorization": f"Bearer {token}"}))`, used as a context manager, `mcp.list_tools_sync()`, and the tools are passed to `Agent`. The final agent (`unified_travel_agent.py`) does **not** use MCPClient. It sends hand-rolled JSON-RPC `tools/call` POSTs through `requests`. |
| `strands_tools.calculator` | notebooks 09 and 11 (the agent code is written to `backend/observability/`, `backend/evaluation/`) | `tools=[calculator, get_weather]` |
| `strands_tools.code_interpreter.AgentCoreCodeInterpreter` | notebook 06; `unified_travel_agent.py` (constructed, but the tool is commented out of `tools=`) | `AgentCoreCodeInterpreter(region=...)` and then `tools=[code_interpreter.code_interpreter]` |
| `strands_tools.browser.AgentCoreBrowser` | notebook 07; `unified_travel_agent.py` (constructed, commented out) | `AgentCoreBrowser(region=...)` and then `tools=[browser_tool.browser]` |
| OTEL env | `travel_agent_google_drive.py` | `STRANDS_OTEL_ENABLE_CONSOLE_EXPORT=true` |

Memory access goes through `bedrock_agentcore.memory.MemoryClient` inside custom tools, not through a Strands session or memory hook. Runtime hosting uses `BedrockAgentCoreApp`. Both are outside this ticket, but section 4 lists their TypeScript counterparts.

## 2. Packages, maturity, versions

| Package | Latest | Maturity | Source |
|---|---|---|---|
| `@strands-agents/sdk` | **1.18.0** (2026-09-15); first published 2025-11-28 | **GA.** The 1.0 blog post (2026-04-30) says "Version 1.0 of the Strands Agents TypeScript SDK is here." Weekly releases (1.13 to 1.18 between Aug 12 and Sep 15). | npm registry `https://registry.npmjs.org/@strands-agents/sdk` (dist-tags, time); https://strandsagents.com/blog/strands-agents-typescript-v1/ |
| Source repo | `strands-agents/harness-sdk`, directory `strands-ts/` (monorepo with `strands-py/`). The old `strands-agents/sdk-typescript` is **archived**. | | `package.json` `repository` field; `gh api repos/strands-agents/sdk-typescript` → `archived: true` |
| `bedrock-agentcore` (AWS TS SDK for AgentCore) | **0.4.4** (2026-09-11) | **Pre-1.0.** The Strands subpaths are `./experimental/code-interpreter/strands`, `./experimental/browser/strands`, `./memory/strands` (also available as `./experimental/memory/strands`). The JSDoc says "EXPERIMENTAL: This integration uses the Strands TypeScript SDK, which is currently experimental". That wording dates from before Strands TS 1.0. | npm `bedrock-agentcore@0.4.4` `package.json` `exports`; `dist/src/tools/code-interpreter/integrations/strands/index.d.ts`; repo `aws/bedrock-agentcore-sdk-typescript` |
| TS equivalent of `strands-agents-tools` | **None.** An npm scope search for `@strands-agents` returns only `@strands-agents/sdk`. The Python `strands-agents/tools` repo (0.8.9 on PyPI) is Python only. | | `registry.npmjs.org/-/v1/search?text=scope:strands-agents`; `gh api repos/strands-agents/tools/contents/src/strands_tools` |

Required peer dependencies of `@strands-agents/sdk` 1.18.0 (not marked optional): `zod ^4.1.12`, `@modelcontextprotocol/sdk ^1.25.2`, `@opentelemetry/api ^1.9.0`. Direct dependencies: `@aws-sdk/client-bedrock-runtime`, `@smithy/fetch-http-handler`, `uuid`, `yaml`, `@types/json-schema`. `engines.node >= 22`. Source: `package.json` in the npm tarball.

## 3. API mapping and differences

| Python | TypeScript (`@strands-agents/sdk` 1.18.0) | Notes / source |
|---|---|---|
| `from strands import Agent` | `import { Agent } from '@strands-agents/sdk'` | `dist/src/index.d.ts` line 7 |
| `Agent(model=m, tools=[...], system_prompt="...")` | `new Agent({ model: m, tools: [...], systemPrompt: '...' })` | Config fields: `model`, `tools`, `systemPrompt`, `printer`, `conversationManager`, `sessionManager`, `memoryManager`, `plugins`, `structuredOutputSchema`, and others (`dist/src/agent/agent.d.ts` lines 85-227) |
| `Agent(model="us.anthropic...")` (string) | `model: 'us.anthropic...'` also accepted; the constructor turns it into `new BedrockModel({ modelId })` | `dist/src/agent/agent.js` lines 221-224 |
| `agent(prompt)` (sync) | `await agent.invoke(prompt)` (async only) | `agent.d.ts` line 553. Every entrypoint becomes `async`. |
| `response.message['content'][0]['text']` / `str(response)` | `result.toString()`; `result.lastMessage` (a `Message` with `content` blocks, e.g. `TextBlock`); `result.stopReason` | `dist/src/types/agent.d.ts` (`AgentResult`: `stopReason`, `lastMessage`, `toString()`) |
| default `callback_handler` (prints to stdout) | `printer: true` is the default; set `printer: false` to silence | `agent.d.ts` lines 105-110. There is no `callback_handler`. Use `for await (const ev of agent.stream(prompt))` or hooks instead. |
| `stream_async` | `agent.stream(prompt)` async iterator. Event types seen in the smoke test: `beforeInvocationEvent`, `messageAddedEvent`, `beforeModelCallEvent`, `modelStreamUpdateEvent`, `contentBlockEvent`, `modelMessageEvent`, `afterModelCallEvent`, `beforeToolsEvent`, `beforeToolCallEvent`, `afterToolCallEvent`, `toolResultEvent`, `afterToolsEvent`, `afterInvocationEvent`, `agentResultEvent` | README "Streaming Responses"; smoke test (section 5) |
| hooks | `HookRegistry`, `BeforeInvocationEvent`, `AfterToolCallEvent`, and more; `Plugin` | `index.d.ts` line 50 |
| `@tool` decorator (docstring and type hints) | `tool({ name, description, inputSchema: z.object({...}), callback })`. There are no decorators, so name, description and schema must be written out. A JSON-schema variant (`FunctionToolConfig`) also exists. | `dist/src/tools/tool-factory.d.ts` lines 14, 21; README "Tools" |
| `@tool(name=..., description=...)` | same `tool({...})` call | |
| tool returns `dict` | callback returns any JSON value. It becomes a `json` tool-result block (the smoke test got `{"json":{"daily_budget":250}}`); a string becomes a `text` block | smoke test |
| `from strands.models import BedrockModel`; `BedrockModel(model_id=..., region_name=...)` | `import { BedrockModel } from '@strands-agents/sdk'`; `new BedrockModel({ modelId, region })`. Also `clientConfig` (AWS SDK `BedrockRuntimeClientConfig`), `maxTokens`, `temperature`, `cacheConfig`, `guardrailConfig`, `additionalRequestFields`, `apiKey` | `dist/src/models/bedrock.d.ts` lines 91-176; `bedrock.js` line 155 |
| `MCPClient(lambda: streamablehttp_client(url, headers=...))` plus `with` plus `list_tools_sync()` | `new McpClient({ url, headers: { Authorization: 'Bearer ' + token } })` and then `await client.listTools()`. It connects lazily. Close it with `await client.disconnect()` or `await using`. You can also pass `transport:` (any MCP SDK transport), `auth: { clientId, clientSecret, scopes }` (the MCP SDK `ClientCredentialsProvider`), `authProvider`, `prefix`, `toolFilters`. **No separate `streamablehttp_client` import is needed**, because `url` builds a `StreamableHTTPClientTransport` internally. | `dist/src/mcp/client.d.ts`; `client.js` lines 2-3 and 84-102 |
| `strands_tools.calculator` (SymPy-based) | **Missing.** No vended calculator. The vended tools are `notebook`, `file-editor`, `http-request`, `shell`, `bash`, `sleep`, `web-fetch`, `experimental/vended-tools/stop` | `package.json` `exports`; `dist/src/vended-tools/` |
| `AgentCoreCodeInterpreter(region=...).code_interpreter` (one tool with actions `initSession`, `executeCode`, `executeCommand`, `readFiles`, `listFiles`, `removeFiles`, `writeFiles`, `listLocalSessions`) | `new CodeInterpreterTools({ region })` from `bedrock-agentcore/experimental/code-interpreter/strands`, then `tools: [...ci.tools]`, which gives **three** tools: `executeCode` (python/javascript/typescript), `fileOperations` (write/read/list/remove), `executeCommand`. The session is created on first use; call `await ci.stopSession()` at the end. | bedrock-agentcore 0.4.4 `dist/src/tools/code-interpreter/integrations/strands/*`, `tools/code-interpreter/client.js` lines 10-21; Python `strands-agents/tools` `src/strands_tools/code_interpreter/models.py` |
| `AgentCoreBrowser(region=...).browser` (one tool, about 22 actions: navigate, click, type, evaluate, press_key, get_text, get_html, screenshot, refresh, back, forward, new_tab, switch_tab, close_tab, list_tabs, get_cookies, set_cookies, network_intercept, execute_cdp, close, and more) | `new BrowserTools({ region })` from `bedrock-agentcore/experimental/browser/strands` gives **seven** tools: `navigate`, `click`, `type`, `getText`, `getHtml`, `screenshot`, `evaluate`. It uses `playwright` (optional peer, `>=1.56.0`) through `chromium.connectOverCDP` with SigV4 WebSocket headers. | bedrock-agentcore 0.4.4 `tools/browser/integrations/strands/*`, `tools/browser/integrations/playwright/client.js` lines 298-305; Python `src/strands_tools/browser/models.py` |
| `STRANDS_OTEL_ENABLE_CONSOLE_EXPORT` | `@strands-agents/sdk/telemetry` (`setupTracer`, and more); OTEL packages are optional peers | `package.json` exports and `peerDependenciesMeta` |

Tool names change. Gateway-exposed tools keep their server names (for example `WeatherSearch___getCurrentWeather`). The code-interpreter and browser tools change from one multi-action tool (`code_interpreter`, `browser`) to several camelCase tools. The system prompts in notebooks 06 and 07 and in `unified_travel_agent.py` do not mention these tool names, so they can stay as they are.

## 4. Adjacent AgentCore pieces (for the other port tickets)

`bedrock-agentcore` 0.4.4 also exports `./runtime` (`BedrockAgentCoreApp`, a Fastify-based replacement for the Python `BedrockAgentCoreApp`), `./identity` (`withAccessToken`, `withApiKey`, which replace `@requires_access_token`), and `./memory/strands` (`AgentCoreMemoryStore`, `createAgentCoreMemoryStores`, which plug into the Strands TS `memoryManager`). Source: `dist/src/runtime/index.d.ts`, `dist/src/identity/index.d.ts`, `dist/src/memory/integrations/strands/index.d.ts`. Its dependencies include `fastify`, `@fastify/websocket`, and `ws`, all Node-oriented. Their behaviour under Deno is not verified here.

## 5. Deno compatibility

**Official position:** Neither `@strands-agents/sdk` nor `bedrock-agentcore` lists Deno as supported.
- The TS SDK README and the 1.0 blog post name Node.js and the browser. The blog post says "run agents in both Node.js and the browser" and "The SDK runs natively in the browser with no server required."
- The quickstart source (`harness-sdk/site/src/content/docs/user-guide/sdk/quickstart/typescript.mdx` line 21) says "Make sure you have Node.js 22+".
- `engines.node >= 22` for the SDK and `>= 20` for `bedrock-agentcore`.
- A GitHub search of `strands-agents/harness-sdk` and the archived `sdk-typescript` repo finds no Deno issues or PRs about TS runtime support.

**Mechanics:**
- Deno resolves npm ESM with the conditions `["deno", "node", "import", "module-sync", "default"]` (https://docs.deno.com/runtime/fundamentals/node/). It therefore picks the SDK's `"node"` export (`dist/src/index.node.js`). That entry point registers Node defaults: MCP server-config file loading via `node:fs`, and a local sandbox via `node:child_process`.
- The Node-builtin imports sit in `mcp/config.node.js`, `sandbox/*`, `vended-tools/bash`, `vended-tools/file-editor`, `vended-plugins/skills`, `vended-plugins/goal`, and `vended-interventions/cedar` (`fs`, `path`, `os`, `child_process`, `util`, `buffer`). Deno's `node:` compatibility layer supports all of these.
- `BedrockModel` uses `@smithy/fetch-http-handler`, so web `fetch` is used for HTTPS (`models/bedrock.js` lines 10, 1623-1635), which works in Deno.
- There are no native addons or postinstall scripts in the core path. `@cedar-policy/*-wasm` and `@tobilu/qmd` are optional peers.
- `Buffer` is not a global in user code under Deno (import it from `node:buffer`). `process` is available (Deno docs, same page).

**Empirical test (this research):** Deno 2.9.7 (aarch64-apple-darwin) ran a script that imports `npm:@strands-agents/sdk@1.18.0`, `npm:zod@^4.1.12`, `npm:@modelcontextprotocol/sdk@1.30.0` and `npm:bedrock-agentcore@0.4.4`, with `deno run -A` and no `package.json` or `node_modules`. Results:
- A local Streamable HTTP MCP server (`WebStandardStreamableHTTPServerTransport` on `Deno.serve`) that returns 401 unless it receives `Authorization: Bearer test-token`. `McpClient({ url, headers })` listed its tool, and the agent called it. The server received the bearer header. This is the same shape as the Gateway access in notebook 10.
- `Agent` with a stub `Model` subclass ran a full tool-use loop: a zod `tool()` plus the MCP tool in one turn, then a final text turn. `agent.stream()` yielded all the event types listed in section 3, and `result.toString()` returned the text.
- `new BedrockModel({ modelId, region })` constructed without error. **No live Bedrock call was made**, because no AWS call was attempted.
- `CodeInterpreterTools` and `BrowserTools` imported and constructed, exposing the tool names listed above. **No AgentCore session was started.**
- Deno resolved `@opentelemetry/api` (a required peer) automatically.
- Caveat: without an explicit `Deno.exit(0)` the process did not exit after `McpClient.disconnect()` and `server.shutdown()`. This was probably the test server keeping its open SSE stream alive and was not diagnosed. Watch process lifetime in scripts.

**Unverified risk:** the AgentCore browser tool relies on `playwright` `chromium.connectOverCDP` over a SigV4-signed WebSocket. Deno's long-standing "NPM: Playwright does not work" issue (denoland/deno#16899) was closed on 2025-06-12, but this repo has not tested the CDP-over-WebSocket path under Deno. Do a spike against a real AgentCore Browser session before committing to it.

## 6. Summary table

| Python feature used | TS coverage | Package / version | Maturity | Deno |
|---|---|---|---|---|
| `Agent` + `system_prompt` | Yes (`new Agent({ systemPrompt })`, async `invoke`) | `@strands-agents/sdk` 1.18.0 | GA | Works (smoke-tested) |
| `@tool` | Yes, as the `tool({ inputSchema: zod })` factory; no decorator | same, plus `zod` ^4 | GA | Works (smoke-tested) |
| `BedrockModel(model_id, region_name)` | Yes (`{ modelId, region }`) | same | GA | Constructs; live call untested (fetch-based handler) |
| `MCPClient` + `streamablehttp_client` (Gateway bearer) | Yes (`McpClient({ url, headers })`) | same, plus `@modelcontextprotocol/sdk` ^1.25.2 | GA | Works against a local bearer-protected MCP server |
| `strands_tools.calculator` | **No** | none | n/a | Write a custom tool (for example with `npm:mathjs`) |
| `strands_tools.code_interpreter` | Yes, as 3 tools (`executeCode`, `fileOperations`, `executeCommand`) | `bedrock-agentcore` 0.4.4 `/experimental/code-interpreter/strands` | Pre-1.0 / experimental | Imports and constructs; live session untested |
| `strands_tools.browser` | Partial, as 7 tools (no tabs, cookies, back/forward, press_key, CDP, network intercept) | `bedrock-agentcore` 0.4.4 `/experimental/browser/strands` plus `playwright` >=1.56 | Pre-1.0 / experimental | Imports and constructs; Playwright CDP under Deno untested |
| Default stdout callback handler | Yes (`printer`, default on) | `@strands-agents/sdk` | GA | Works |
| OTEL console export env | Via `@strands-agents/sdk/telemetry` plus OTEL peers | same | GA | Untested |

## 7. Gap list

1. **No `strands-agents-tools` for TS.** `calculator` has to be reimplemented as a custom `tool()`. SymPy features (symbolic solve, derivatives) have no drop-in replacement. The observability and evaluation labs (09, 11) only need arithmetic.
2. **Browser tool is narrower.** It has 7 tools against about 22 Python actions: no multi-tab, cookies, back/forward/refresh, press_key, network intercept, or raw CDP. It also depends on Playwright, which needs a Deno spike.
3. **Tool shape and names change.** The single `code_interpreter` and `browser` tools become several camelCase tools. The code interpreter's `initSession`/`listLocalSessions` are replaced by `startSession()`/`stopSession()` methods on the wrapper.
4. **AgentCore Strands integrations are pre-1.0 and under `experimental/` paths** in `bedrock-agentcore` 0.4.4. Expect breaking changes, and pin exact versions.
5. **No decorator or docstring inference.** Every tool needs an explicit name, description and zod schema. The Python `Args:` docstring text should move into `.describe()`.
6. **Async-only invocation.** `agent(prompt)` becomes `await agent.invoke(prompt)`. Response extraction changes: use `result.toString()` or `result.lastMessage`.
7. **Deno is unofficial.** It works through Node compatibility and the `"node"` export condition, but it is not in CI for either package. Pin versions, and keep `zod`, `@modelcontextprotocol/sdk` and `@opentelemetry/api` in the `deno.json` import map.
8. **Not verified here:** live Bedrock Converse streaming from Deno (AWS credential-provider chain under Deno), a live AgentCore Code Interpreter or Browser session, the `bedrock-agentcore/runtime` Fastify app under Deno, and exit behaviour after MCP disconnect.
9. **Not a gap, a simplification:** `unified_travel_agent.py` hand-rolls JSON-RPC to the Gateway. The TS port can use `McpClient` directly, as notebook 10 already does in Python.

## Sources

- npm registry metadata and tarball for `@strands-agents/sdk@1.18.0`: https://registry.npmjs.org/@strands-agents/sdk (package.json, README.md, `dist/src/**` as cited above)
- npm registry metadata and tarball for `bedrock-agentcore@0.4.4`: https://registry.npmjs.org/bedrock-agentcore
- Strands TS 1.0 announcement: https://strandsagents.com/blog/strands-agents-typescript-v1/
- Strands monorepo: https://github.com/strands-agents/harness-sdk (`strands-ts/`, `site/src/content/docs/user-guide/sdk/quickstart/typescript.mdx`)
- Archived TS repo: https://github.com/strands-agents/sdk-typescript
- Python tools repo: https://github.com/strands-agents/tools (`src/strands_tools/code_interpreter/models.py`, `src/strands_tools/browser/models.py`)
- AWS AgentCore TS SDK: https://github.com/aws/bedrock-agentcore-sdk-typescript
- Deno Node/npm compatibility: https://docs.deno.com/runtime/fundamentals/node/
- Deno Playwright issue: https://github.com/denoland/deno/issues/16899
- Smoke test: run locally with Deno 2.9.7 on 2026-09-22 (script kept in the session scratchpad, not committed)
