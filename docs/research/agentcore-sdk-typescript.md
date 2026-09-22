# AgentCore Python SDK / Starter Toolkit → TypeScript on Deno

Research date: 2026-09-22. Question: for every `bedrock_agentcore` and
`bedrock_agentcore_starter_toolkit` API this repo uses, what is the TypeScript
equivalent, and does it run under Deno via `npm:` specifiers?

## TL;DR

- There is an official TypeScript SDK, **`bedrock-agentcore`** on npm (v0.4.4, released
  2026-09-11), in the GitHub repo `aws/bedrock-agentcore-sdk-typescript`. It covers **Runtime**
  (`BedrockAgentCoreApp`), **Code Interpreter**, **Browser**, the **Identity wrappers**
  (`withAccessToken`, `withApiKey`) and **Memory, but only as a Strands integration**. Its README
  lists **Gateway** and **Observability** as "coming soon". It has **no general-purpose
  `MemoryClient`**, **no public `IdentityClient`**, and **no Evaluation or Policy client**.
  [S1][S2][S3]
- The official replacement for the starter toolkit (`Runtime`, the `agentcore` CLI, Gateway,
  Evaluation and Policy) is the **AgentCore CLI, `@aws/agentcore`** (v0.30.0). It is written in
  TypeScript and you use it as a command-line tool. It has no programmatic replacement for
  `Runtime.configure/launch/invoke` or for `GatewayClient`. The starter toolkit README says the
  starter toolkit CLI is "no longer supported". [S4][S5][S6]
- Anything the TS SDK lacks can be rebuilt on the AWS SDK for JavaScript v3:
  **`@aws-sdk/client-bedrock-agentcore`** (data plane) and
  **`@aws-sdk/client-bedrock-agentcore-control`** (control plane), plus
  `client-cloudwatch-logs`, `client-cognito-identity-provider`, `client-iam` and so on. Every
  boto3 call the Python code makes has a matching command in these clients (listed below). [S7][S8]
- **Deno, tested here on Deno 2.9.6 (macOS arm64):** every `bedrock-agentcore@0.4.4` subpath the
  port needs imports cleanly, the tool clients can be constructed, and **`BedrockAgentCoreApp`
  serves `/ping` and SSE-streamed `/invocations` under Deno**. `npm:@aws/agentcore@0.30.0 --help`
  also runs under Deno. No call reached AWS. The AWS SDK v3 README does not list Deno as a
  supported runtime; it names Node, browsers and React Native. So Deno support is "works in
  practice", not something AWS guarantees. [S9][S10]
- **Deployment gap:** AgentCore Runtime's managed code runtimes are `NODE_22` and
  `PYTHON_3_10…3_14`. There is no Deno runtime. A Deno agent must ship as an **ARM64 container**
  that listens on `0.0.0.0:8080` (the AgentCore CLI's `"build": "Container"` supports a custom
  Dockerfile). [S8-enum][S11][S12]
- **Existing repo bugs:** `bedrock_agentcore.services.code_interpreter` and
  `bedrock_agentcore.services.browser_tools` **do not exist** in any Python SDK release checked
  (v1.6.0, which `uv.lock` pins, and main at v1.23.1). `backend/code_interpreter_setup.py` and
  `backend/browser_tools_setup.py` therefore fail with an ImportError, and the methods they call
  (`create_runtime`, `list_runtimes`, `create_session`, `execute_actions`) are made up. In
  `backend/gateway/gateway_setup.py`, `gateway.get_mcp_url()` and `gateway.gateway_id` are also
  wrong: `create_mcp_gateway` returns a plain `dict`. [S13][S14]

## What the repo actually calls

Found by grepping `capstone_project/backend/**/*.py` and the code cells of
`capstone_project/notebooks/*.ipynb`.

| Python API | Methods / members used | Where |
| --- | --- | --- |
| `bedrock_agentcore.runtime.BedrockAgentCoreApp` | `BedrockAgentCoreApp()`, `@app.entrypoint` (sync and async-generator handlers), `app.run()` | `backend/runtime/simple_agent/travel_agent.py`, `backend/runtime/final_agent/unified_travel_agent.py`, `backend/identity/runtime/travel_agent_google_drive.py`, NB 02, 05, 08, 09, 11 |
| `bedrock_agentcore.memory.MemoryClient` | `create_memory_and_wait(name, strategies, description, event_expiry_days)`, `list_memories()`, `get_memory_strategies(memory_id)`, `create_event(memory_id, actor_id, session_id, messages=[(text, role)])`, `retrieve_memories(memory_id, namespace, query, top_k)` | `backend/memory/memory_setup.py`, `unified_travel_agent.py`, NB 04, 08 |
| `bedrock_agentcore.memory.constants.StrategyType` | `USER_PREFERENCE`, `SEMANTIC`, `SUMMARY` (`.value`) | `memory_setup.py`, NB 04 |
| `bedrock_agentcore.identity.auth.requires_access_token` | decorator with `provider_name`, `scopes`, `auth_flow='USER_FEDERATION'`, `on_auth_url`, `force_authentication=True`, `callback_url` | `travel_agent_google_drive.py`, NB 05 |
| `bedrock_agentcore.services.identity` | `IdentityClient(region)`, `.complete_resource_token_auth(session_uri, user_identifier)`, `.get_workload_identity(name)`, `.update_workload_identity(...)`, `UserTokenIdentifier` (pydantic model) | `backend/identity/runtime/oauth2_callback_server.py`, NB 05 |
| `bedrock_agentcore.services.code_interpreter.CodeInterpreterClient` | `create_runtime(...)`, `list_runtimes()`, `execute_code(runtime_id, code)`. **The module does not exist** | `backend/code_interpreter_setup.py` |
| `bedrock_agentcore.services.browser_tools.BrowserToolsClient` | `create_session(...)`, `list_sessions()`, `execute_actions(...)`. **The module does not exist** | `backend/browser_tools_setup.py` |
| `strands_tools.code_interpreter.AgentCoreCodeInterpreter`, `strands_tools.browser.AgentCoreBrowser` (not `bedrock_agentcore` itself, but these are how the notebooks really use Code Interpreter and Browser) | used as Strands tools | NB 06, 07, 08 |
| toolkit `Runtime` | `configure(entrypoint, auto_create_execution_role, auto_create_ecr, requirements_file, region, agent_name, memory_mode, authorizer_configuration, environment_variables, idle_timeout)`, `launch(auto_update_on_conflict=True)`, `status()`, `invoke(payload, bearer_token=...)` | NB 02, 05, 08, 09, 11 |
| toolkit `Evaluation` | `Evaluation(region)`, `list_evaluators()`, `get_evaluator(evaluator_id)`, `create_evaluator(name, level, description, config)`, `run(agent_id, session_id, evaluators)`, `create_online_config(...)`, `get_online_config(config_id)`, `delete_online_config`, `delete_evaluator` | NB 11 |
| toolkit `operations.gateway.client.GatewayClient` | `create_oauth_authorizer_with_cognito(name)`, `create_mcp_gateway(name, role_arn, authorizer_config, enable_semantic_search, ...)`, `create_mcp_gateway_target(gateway, target_type="openApiSchema", target_payload, credentials)`, `get_access_token_for_cognito(client_info)`, `cleanup_gateway(id, client_info)`, `update_gateway_policy_engine(...)`, and the underlying boto3 client `client.client.list_gateways/get_gateway/list_gateway_targets` | `backend/gateway/gateway_setup.py`, NB 03, 10 |
| toolkit `operations.observability.client.ObservabilityClient` | `query_spans_by_session(session_id, start_time_ms, end_time_ms, agent_id)` | NB 09, 11 |
| toolkit `operations.policy.client.PolicyClient` (outside the ticket's list, but used) | `create_or_get_policy(...)`, `generate_policy(...)`, `cleanup_policy_engine(id)` | NB 10 |
| `agentcore` CLI (configure/launch/invoke) | **not run as a shell command anywhere** in the notebooks or backend. The repo drives the same flow through the `Runtime` class. Only `.bedrock_agentcore.yaml` (the toolkit's config file) appears, and only as a file being cleaned up | NB 05, 09, 11 |

Versions pinned in `uv.lock`: `bedrock-agentcore` 1.6.0, `bedrock-agentcore-starter-toolkit` 0.3.4.

## Mapping, API by API

### 1. `bedrock_agentcore.runtime.BedrockAgentCoreApp`

- **TS equivalent:** `import { BedrockAgentCoreApp } from "npm:bedrock-agentcore/runtime"`. It is a
  Fastify server on port 8080 and host `0.0.0.0` that serves `/ping`, `/invocations` (JSON or
  SSE) and `/ws`. [S15: `src/runtime/app.ts` L36-L130]
- **API shape:** there is no decorator. You pass the handler as
  `new BedrockAgentCoreApp({ invocationHandler: { requestSchema?: zod, process: (req, ctx) => … } })`
  and then call `app.run({ port?, host? })`. `process` may return a value or an
  **async generator**; a generator becomes an SSE stream. So Python's
  `@app.entrypoint async def …: yield …` maps directly onto an `async function*`. The context gives
  `sessionId`, `requestId`, `workloadAccessToken`, `oauth2CallbackUrl` and filtered headers. It
  also has `addAsyncTask`/`completeAsyncTask` for the `HealthyBusy` ping state, and optional
  `pingHandler` and `websocketHandler`. [S15: L58-L240, L563-L610]
- **Behaviour differences from Python (found by testing):**
  - `/invocations` returns **400 when there is no session id**. The id must come from the
    `x-amzn-bedrock-agentcore-runtime-session-id` header or a `sessionId` body field.
  - A streaming (generator) handler returns **406 unless the request sends
    `Accept: text/event-stream`**. [S15: L338-L400]
  - Neither matters on AgentCore Runtime, which sets these headers. It does matter for local
    `curl` or `fetch` tests that the Python version never needed.
- **Deno:** tested. `deno run -A app.ts` bound to port 18080. `GET /ping` returned
  `{"status":"Healthy",...}`. `POST /invocations` with the session header and
  `Accept: text/event-stream` streamed two `event: message` SSE frames. Fastify, `@fastify/sse`
  and the `createRequire(import.meta.url)` loading all work under Deno's Node compatibility
  layer. [S9]
- **Gaps:** none in functionality. For deployment, see §9: Deno needs a container.

### 2. `bedrock_agentcore.memory` (`MemoryClient` + `StrategyType`)

- **TS SDK:** there is **no `MemoryClient`**. The only memory code is
  `bedrock-agentcore/memory/strands`, which exports `AgentCoreMemoryStore`,
  `AgentCoreEventSender` and `createAgentCoreMemoryStores`. These implement the Strands TS
  `MemoryStore` interface: `search()` wraps `RetrieveMemoryRecords` and `addMessages()` goes through
  `CreateEvent`. They import types from `@strands-agents/sdk`, which is a peer dependency, and they
  **do not create or list memories**. [S16: `src/memory/integrations/strands/index.ts`,
  `store.ts` L1-L30, L147-L200][S1 CHANGELOG 0.4.1: "promote AgentCore Memory Strands integration to GA"]
- **Rebuilding on AWS SDK v3.** Each Python method turns out to be a thin wrapper
  [S17: `memory/client.py`]:

  | Python | AWS SDK v3 command | Notes for reimplementing |
  | --- | --- | --- |
  | `create_memory_and_wait` | control `CreateMemoryCommand`, then poll `GetMemoryCommand` until `status === "ACTIVE"` | Python sends `eventExpiryDuration` (days) and a `clientToken` UUID, and fills in default `namespaceTemplates` for strategies that have none (`_add_default_namespaces`). The repo passes the older `namespaces` key, which Python accepts as-is; check which key the current API wants. |
  | `list_memories` | control `ListMemoriesCommand` (paginate `nextToken`) | Python adds both `id` and `memoryId` to each result (`_normalize_memory_response`). The repo matches on `m['id']`. |
  | `get_memory_strategies` | control `GetMemoryCommand` → `memory.strategies` | Same key normalisation: `strategyId`/`memoryStrategyId`, `type`/`memoryStrategyType`. |
  | `create_event(messages=[(text, role)])` | data `CreateEventCommand` | Build `payload: [{ conversational: { content: { text }, role } }]` with `eventTimestamp: new Date()`. `role` is `USER`/`ASSISTANT`/`TOOL`/`OTHER`. |
  | `retrieve_memories(namespace, query, top_k)` | data `RetrieveMemoryRecordsCommand({ memoryId, namespace, searchCriteria: { searchQuery, topK } })` | Python catches and logs errors and returns `[]`. Records are in `memoryRecordSummaries[].content.text`. |
  | `StrategyType.*` | none needed | These are plain strings: `semanticMemoryStrategy`, `summaryMemoryStrategy`, `userPreferenceMemoryStrategy`, `episodicMemoryStrategy`, `customMemoryStrategy` [S17: `memory/constants.py` L10-L17]. The AWS SDK union type `MemoryStrategyInput` uses the same keys. |

  Estimated effort: about 100–150 lines for a `MemoryClient` module with a polling helper.
- **Deno:** `AgentCoreMemoryStore` and `AgentCoreEventSender` import cleanly together with
  `npm:@strands-agents/sdk` (it resolved to 1.18.0). Both AWS SDK clients import and list all the
  commands above under Deno. [S9]

### 3. `bedrock_agentcore.identity.auth.requires_access_token`

- **TS equivalent:** `withAccessToken({ providerName, scopes, authFlow, onAuthUrl,
  forceAuthentication, callbackUrl, customState, customParameters, workloadIdentityToken? })` from
  `bedrock-agentcore/identity`. It is a higher-order function: the token is added as the **last
  positional argument**, where Python injects it as the `access_token=` keyword argument.
  `withApiKey` (maps to `GetResourceApiKey`) and `withWAT` also exist. [S18: `src/identity/wrappers.ts`, `types.ts` L48-L80]
- **Same behaviour:** calls `GetResourceOauth2Token`. For `USER_FEDERATION` it calls `onAuthUrl`
  with the authorization URL, then **polls every 5 s for up to 10 min** until the token arrives.
  `callbackUrl` defaults to the `OAuth2CallbackUrl` request header. [S19: `src/identity/client.ts` L37-L118]
- **Gap (local development):** without a runtime request context and without an explicit
  `workloadIdentityToken`, the TS wrapper **throws**. Python instead creates a workload identity,
  saves it to `.agentcore.json` and calls `GetWorkloadAccessTokenForUserId`, so decorated
  functions also work locally. [S20: `identity/auth.py` L350-L402] To rebuild that in TS:
  control `CreateWorkloadIdentityCommand` plus data `GetWorkloadAccessTokenForUserIdCommand`
  (about 30 lines), then pass `workloadIdentityToken` explicitly.
- **Deno:** imports and runs; exports checked under Deno. [S9]

### 4. `bedrock_agentcore.services.identity` (`IdentityClient`, `UserTokenIdentifier`)

- **TS SDK:** `IdentityClient` exists in the source but is **not exported**. The changelog says
  "refactor: remove IdentityClient from public API", and the Deno test confirmed `IdentityClient`
  is missing from the `bedrock-agentcore/identity` exports. Even the internal class only has
  `getOAuth2Token` and `getApiKey`. [S1 CHANGELOG][S19][S9]
- **Rebuilding on AWS SDK v3.** Each Python method is a single boto3 call [S21: `services/identity.py` L159-L198]:

  | Python | AWS SDK v3 command |
  | --- | --- |
  | `complete_resource_token_auth(session_uri, user_identifier)` | data `CompleteResourceTokenAuthCommand({ sessionUri, userIdentifier: { userToken } \| { userId } })` |
  | `get_workload_identity(name)` | control `GetWorkloadIdentityCommand` |
  | `update_workload_identity(name, allowed_resource_oauth_2_return_urls)` | control `UpdateWorkloadIdentityCommand({ name, allowedResourceOauth2ReturnUrls })` |
  | `UserTokenIdentifier` | a TS type `{ userToken?: string; userId?: string }` (or a zod schema) |
  | (`identity_helper.py`, plain boto3) `list/get_api_key_credential_provider` | control `ListApiKeyCredentialProvidersCommand` / `GetApiKeyCredentialProviderCommand` |

  The FastAPI OAuth2 callback server (`oauth2_callback_server.py`) becomes `Deno.serve` (or Hono)
  with the same three routes.
- **Gaps:** none at the API level. The work is writing thin wrappers.

### 5. `bedrock_agentcore.services.code_interpreter` (as the repo uses it)

- **The Python module does not exist.** `services/` holds only `identity.py` and
  `resource_policy.py`, both at the locked v1.6.0 and on main (v1.23.1). The real Python API is
  `bedrock_agentcore.tools.code_interpreter_client.CodeInterpreter` (`start/invoke/stop`). [S13][S14]
  `create_runtime(python_version, packages)` has no counterpart anywhere. The control-plane
  `CreateCodeInterpreter` takes `name`, `description`, `executionRoleArn`,
  `networkConfiguration`, `certificates` and `filesystemConfigurations`, and **has no package
  list**. [S8 types, `CreateCodeInterpreterRequest`]
- **TS equivalent of what the code is trying to do:** `CodeInterpreter` from
  `bedrock-agentcore/code-interpreter`, with `startSession`, `executeCode({ code, language,
  clearContext })`, `executeCommand`, `readFiles`, `writeFiles`, `listFiles`, `removeFiles`,
  `listSessions` and `stopSession`. The default identifier is `aws.codeinterpreter.v1`. To replace
  `strands_tools.AgentCoreCodeInterpreter` (NB 06/08), use `CodeInterpreterTools` from
  `bedrock-agentcore/experimental/code-interpreter/strands`, which provides the tools
  `executeCode`, `fileOperations` and `executeCommand`. [S22: `src/tools/code-interpreter/client.ts`][S9]
- **Deno:** imports, constructs and lists its Strands tools. `executeCode` was not called against
  AWS.

### 6. `bedrock_agentcore.services.browser_tools` (as the repo uses it)

- **The Python module does not exist** either. The real one is
  `bedrock_agentcore.tools.browser_client`. `execute_actions([{action: "navigate"}, ...])` is not a
  real API. [S13][S14]
- **TS equivalent:** `Browser` from `bedrock-agentcore/browser` (`startSession({ viewport,
  timeout, proxyConfiguration, extensions })`, `listSessions`, `getSession`, `stopSession`,
  `generateWebSocketUrl`, `generateLiveViewUrl`). There is also `PlaywrightBrowser` from
  `bedrock-agentcore/browser/playwright`, which provides `navigate`, `click`, `type`, `getText`,
  `getHtml`, `screenshot`, `waitForSelector` and more over CDP, with `playwright` as a peer
  dependency. To replace `strands_tools.AgentCoreBrowser` (NB 07/08), use `BrowserTools` from
  `bedrock-agentcore/experimental/browser/strands` (tools: navigate, click, type, getText,
  getHtml, screenshot, evaluate). [S23: `src/tools/browser/client.ts`, `integrations/playwright/client.ts`][S9]
- **Deno:** `Browser`, `PlaywrightBrowser` and `BrowserTools` import and construct. A live CDP
  session through `npm:playwright` under Deno was **not** tested. Playwright only needs to connect
  to a browser AWS hosts, so no local browser download (postinstall step) is needed. Deno skips
  npm lifecycle scripts unless you pass `--allow-scripts`. [S10]
- The **live-view React component** (`bedrock-agentcore/browser/live-view`) needs a Vite bundler
  alias for the vendored DCV SDK. It is not relevant to this repo. [S1 `docs/BROWSER_LIVE_VIEW.md`]

### 7. Starter toolkit `Runtime` (`configure` / `launch` / `status` / `invoke`) and the `agentcore` CLI

- **What it does in Python:** `configure` writes `.bedrock_agentcore.yaml` and a Dockerfile.
  `launch` creates the execution role and ECR repository, builds an ARM64 image in CodeBuild (by
  default), then calls `CreateAgentRuntime` or `UpdateAgentRuntime`. `invoke` calls
  `InvokeAgentRuntime` with SigV4, or makes an HTTPS POST with `Authorization: Bearer` when you
  pass `bearer_token`. [S24: `notebook/runtime/bedrock_agentcore.py` L37-L480,
  `operations/runtime/launch.py`, `services/runtime.py` L670, L779-L831]
- **Official TS successor:** the **AgentCore CLI, `@aws/agentcore`**, used as a tool rather than
  a library. The lifecycle is `create`, `dev`, `deploy`, `invoke`, `status`. It also has `add`
  (memory, credentials, gateways/targets, evaluators, online-eval, policy engine/policy),
  `logs`, `traces list|get`, `run eval`, and `import` for migrating an existing starter toolkit
  project. Infrastructure is managed with CDK/CloudFormation, and the config file is
  `agentcore.json` (not `.bedrock_agentcore.yaml`). [S4 README][S6 migration]
  - Its npm library entry point exports only `schema` and `lib` (config types, packaging and
    config I/O). It has **no `Runtime`-style programmatic deploy API**. [S25: `src/index.ts`]
  - Supported build types are `"CodeZip"` and `"Container"`. TypeScript agents run on `NODE_22`.
    The generated TS Dockerfile uses `node:22-slim` with `npx tsx main.ts`, and container builds
    run in CodeBuild, so `deploy` does not need Docker locally. [S11: `docs/configuration.md` L183-L215, `docs/container-builds.md` L18-L95]
- **Runtime replacement in code (for notebook-style scripting):** use AWS SDK v3 directly.
  - control plane: `CreateAgentRuntimeCommand`, `UpdateAgentRuntimeCommand`,
    `GetAgentRuntimeCommand` (poll `status` for the "status" step), `DeleteAgentRuntimeCommand`;
  - data plane: `InvokeAgentRuntimeCommand` (SigV4). For the OAuth `bearer_token` path, `fetch`
    `https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{encodeURIComponent(arn)}/invocations?qualifier=DEFAULT`
    with `Authorization: Bearer …` and `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`;
  - the TS SDK's `RuntimeClient` adds presigned or OAuth **WebSocket** URLs and shell sessions,
    but has no HTTP invoke. [S15 `src/runtime/client.ts`]
  - **Not available from TS:** the IAM role and ECR repository creation, the CodeBuild image
    build, and `.bedrock_agentcore.yaml` handling. Either call `agentcore deploy` (CLI) or do it
    yourself with `client-iam`, `client-ecr` and `client-codebuild`, or with CDK
    (`aws-cdk-lib/aws-bedrockagentcore`). Rebuilding `launch` properly (role policy, ECR, ARM64
    build, polling) is a sizeable job, several hundred lines. **Recommendation: use the CLI.**
- **Deno:** `deno run -A npm:@aws/agentcore@0.30.0 --help` prints the full command tree. The
  deploy path (CDK toolkit-lib, asset publishing, child processes) was **not** tested under Deno.
  The CLI declares `engines.node >= 20`, so running it with Node (`npx @aws/agentcore`) is the
  supported way. [S9][S25 package.json]

### 8. Starter toolkit `Evaluation`

- **TS SDK:** no evaluation module. **CLI:** `agentcore add evaluator`, `add online-eval`,
  `run eval`, `run batch-evaluation`, `evals history`, `pause|resume online-eval`. [S4]
- **Rebuilding on AWS SDK v3:**
  - `list_evaluators`, `get_evaluator`, `create_evaluator` and `delete_evaluator` map to control
    `ListEvaluatorsCommand`, `GetEvaluatorCommand`, `CreateEvaluatorCommand` and
    `DeleteEvaluatorCommand`.
  - `create_online_config`, `get_online_config` and `delete_online_config` map to
    `CreateOnlineEvaluationConfigCommand`, `GetOnlineEvaluationConfigCommand` and
    `DeleteOnlineEvaluationConfigCommand`. The Python version also creates an IAM execution role
    for this, so add `client-iam`.
  - **`run(agent_id, session_id, evaluators)` does the most work client-side.** It pulls the
    session's spans (and runtime logs) from CloudWatch Logs (see §10), filters and groups them by
    evaluator level (it calls `GetEvaluator` to read each evaluator's level), and then calls data
    `EvaluateCommand` for each evaluator. [S26: `notebook/evaluation/client.py` L156-L611,
    `operations/evaluation/on_demand_processor.py` L88-L531] There is also a server-side
    `StartBatchEvaluationCommand` / `GetBatchEvaluationCommand`, which may replace the
    client-side span filtering.
  - Estimated effort: moderate. About 200–300 lines, mostly span shaping.

### 9. Starter toolkit `GatewayClient`

- **TS SDK:** Gateway is "coming soon". **CLI:** `agentcore add gateway` and
  `add gateway-target`, then `deploy`. [S1 README][S4]
- **Rebuilding on AWS SDK v3** [S27: `operations/gateway/client.py`]:

  | Python | Rebuild |
  | --- | --- |
  | `create_oauth_authorizer_with_cognito(name)` | `@aws-sdk/client-cognito-identity-provider`: `CreateUserPool`, `CreateUserPoolDomain` (+ poll `DescribeUserPoolDomain`), `CreateResourceServer`, `CreateUserPoolClient` (client-credentials). Return `{ authorization: { customJWTAuthorizer: { discoveryUrl, allowedClients } }, client_info }`. |
  | `create_mcp_gateway(...)` | Create the gateway IAM role if none is given (`client-iam`), then control `CreateGatewayCommand({ protocolType: "MCP", authorizerType: "CUSTOM_JWT", protocolConfiguration: { mcp: { searchType: "SEMANTIC" } }, exceptionLevel })`, then poll `GetGatewayCommand` until READY. Python also turns on observability delivery by default. Returns a dict (`gatewayId`, `gatewayUrl`, ...). |
  | `create_mcp_gateway_target(openApiSchema, credentials={api_key,...})` | control `CreateApiKeyCredentialProviderCommand`, then `CreateGatewayTargetCommand({ targetConfiguration: { mcp: { openApiSchema: { inlinePayload } } }, credentialProviderConfigurations: [{ credentialProviderType: "API_KEY", credentialProvider: { apiKeyCredentialProvider: { providerArn, credentialLocation, credentialParameterName } } }] })`, then poll `GetGatewayTargetCommand`. |
  | `get_access_token_for_cognito(client_info)` | `fetch(token_endpoint, { method: "POST", body: "grant_type=client_credentials&client_id=…&client_secret=…&scope=…" })` |
  | `cleanup_gateway` | `ListGatewayTargets`, then `DeleteGatewayTarget` for each (poll), then `DeleteGateway`, then delete the Cognito domain and user pool |
  | `update_gateway_policy_engine` | control `UpdateGatewayCommand` with `policyEngineConfiguration` |
  | `client.client.list_gateways/get_gateway/list_gateway_targets` | control `ListGatewaysCommand` / `GetGatewayCommand` / `ListGatewayTargetsCommand` (the same raw API) |

  Estimated effort: moderate, about 250–350 lines, mostly Cognito setup and polling.
- **Consumption side:** calling the gateway's MCP endpoint from an agent needs an MCP client.
  `@modelcontextprotocol/sdk` (streamable HTTP) or the Strands TS MCP client both work. The TS
  SDK's `GatewayMcpBackend` is only for web search. [S1 `src/tools/web-search/client.ts`]

### 10. Starter toolkit `ObservabilityClient.query_spans_by_session`

- **TS SDK:** Observability is "coming soon". **CLI:** `agentcore traces list|get` and
  `agentcore logs`. [S1][S4]
- **Rebuilding on AWS SDK v3:** it is a CloudWatch Logs Insights query on the **`aws/spans`**
  log group. Use `@aws-sdk/client-cloudwatch-logs` `StartQueryCommand` and poll
  `GetQueryResultsCommand`. The query string is in `query_builder.build_spans_by_session_query`
  and filters on `attributes.session.id` and the agent's resource id. [S28:
  `operations/observability/client.py` L15-L77, L284-L304, `query_builder.py` L8-L40] Estimated
  effort: small, about 60–80 lines.

### 11. Starter toolkit `PolicyClient` (NB 10, outside the ticket's list)

- **TS SDK:** none. **CLI:** `agentcore add policy-engine` and `add policy`. [S4]
- **Rebuilding on AWS SDK v3:** `create_or_get_policy` maps to `ListPolicies` then
  `CreatePolicy` (with polling). `generate_policy` maps to `StartPolicyGeneration`, then polling
  `GetPolicyGeneration`, then `ListPolicyGenerationAssets`. `cleanup_policy_engine` maps to
  `ListPolicies` → `DeletePolicy` for each, then `DeletePolicyEngine`. All of these commands are in
  `client-bedrock-agentcore-control` 3.1136.0. [S29: `operations/policy/client.py` L343-L948][S9]

## Deno compatibility notes

- **Tested setup:** Deno 2.9.6 (aarch64-apple-darwin), `npm:bedrock-agentcore@0.4.4`,
  `npm:@aws-sdk/client-bedrock-agentcore@3.1136.0`, `npm:@aws-sdk/client-bedrock-agentcore-control@3.1136.0`,
  `npm:@strands-agents/sdk@1.18.0`, `npm:zod@4`. Run with `deno run -A`. No AWS credentials were
  used, so **nothing was sent to AWS**; results cover import, construction and the local HTTP
  server only. [S9]
- **What worked:** imports of `bedrock-agentcore/{runtime,identity,code-interpreter,browser,browser/playwright,
  experimental/code-interpreter/strands,experimental/browser/strands,memory/strands}`;
  `BedrockAgentCoreApp` serving `/ping` and SSE `/invocations`; `npm:@aws/agentcore --help`.
- **Things to watch:**
  - The TS SDK declares `engines.node >= 20` and uses Node built-ins (`node:buffer`, `crypto`,
    `stream`, `module.createRequire`) plus Fastify and `ws`. All of these work through Deno's Node
    compatibility layer. [S1 package.json][S15]
  - The AWS SDK v3 README lists Node, browsers and React Native, **not Deno**. Past Deno issues
    with `npm:@aws-sdk/*` (for example `ClientRequest.setTimeout` not implemented,
    credential-provider failures) were bugs on the Deno side. Pin versions and add an
    integration smoke test against real AWS early. [S10a][S10b]
  - Credentials: `fromNodeProviderChain` reads `~/.aws` and environment variables, which needs
    `--allow-env --allow-read --allow-net` (and `--allow-sys` for some providers). `-A` covers all
    of them.
  - Deno does not run npm `postinstall` scripts unless you pass `--allow-scripts`. That is fine
    here, because the browser is hosted remotely and no Playwright browser download is
    needed. [S10]
- **Deploying a Deno agent to AgentCore Runtime:** you must use a **container**. The managed
  runtimes are `NODE_22` and `PYTHON_3_10…3_14` only [S8 `AgentManagedRuntimeType`]. The container
  must be ARM64 and listen on `0.0.0.0:8080` with `/invocations` and `/ping` [S12]. With the CLI,
  set `"build": "Container"` in `agentcore.json` and replace the generated `node:22-slim`
  Dockerfile with a `denoland/deno` ARM64 base image [S11]. The CodeZip/`NODE_22` path runs Node
  with `tsx`, not Deno.

## Summary table

| Python API used | Official TS equivalent | Coverage | Runs under Deno (`npm:`)? |
| --- | --- | --- | --- |
| `runtime.BedrockAgentCoreApp` (`entrypoint`, `run`) | `bedrock-agentcore/runtime` `BedrockAgentCoreApp` | Full (handler object instead of a decorator; stricter session-id and `Accept` checks) | **Yes, tested** (ping and SSE invocations) |
| `memory.MemoryClient.create_memory_and_wait` / `list_memories` / `get_memory_strategies` | none in the TS SDK. Use `client-bedrock-agentcore-control` `CreateMemory` / `GetMemory` / `ListMemories` | **Gap: reimplement** (about 100 lines with polling and normalisation) | AWS SDK clients import (tested) |
| `memory.MemoryClient.create_event` / `retrieve_memories` | `memory/strands` `AgentCoreMemoryStore` (Strands only), or data-plane `CreateEvent` / `RetrieveMemoryRecords` | Partial (Strands-bound) or reimplement (small) | Yes, imports (tested) |
| `memory.constants.StrategyType` | none; use string literals | Trivial | n/a |
| `identity.auth.requires_access_token` | `bedrock-agentcore/identity` `withAccessToken` (and `withApiKey`) | Full inside the runtime. **No local-dev auto workload identity** | Yes, imports (tested) |
| `services.identity.IdentityClient.complete_resource_token_auth` / `get_workload_identity` / `update_workload_identity`, `UserTokenIdentifier` | none public (`IdentityClient` was removed from the public API). Use `CompleteResourceTokenAuth`, `Get/UpdateWorkloadIdentity` | **Gap: thin wrappers** (small) | AWS SDK clients import (tested) |
| `services.code_interpreter.CodeInterpreterClient` (module doesn't exist) | `bedrock-agentcore/code-interpreter` `CodeInterpreter`; Strands: `experimental/code-interpreter/strands` `CodeInterpreterTools` | Full for real Code Interpreter features. The repo's `create_runtime(packages)` has no equivalent anywhere | Yes, imports and constructs (tested); no live call |
| `services.browser_tools.BrowserToolsClient` (module doesn't exist) | `bedrock-agentcore/browser` `Browser` / `browser/playwright` `PlaywrightBrowser`; Strands: `experimental/browser/strands` `BrowserTools` | Full for real Browser features. The repo's `execute_actions` has no equivalent | Imports (tested); a Playwright CDP session under Deno was not tested |
| toolkit `Runtime.configure/launch/status/invoke` | `@aws/agentcore` CLI (`create`/`deploy`/`status`/`invoke`); raw `Create/Update/GetAgentRuntime` and `InvokeAgentRuntime` | CLI only; **no programmatic deploy API** | CLI `--help` runs (tested); deploy under Deno not tested, so use Node for the CLI |
| toolkit `Evaluation` | CLI `add evaluator` / `add online-eval` / `run eval`; raw control `*Evaluator*`, `*OnlineEvaluationConfig*` and data `Evaluate` | **Gap for code: reimplement `run()`** (moderate) | AWS SDK clients import (tested) |
| toolkit `GatewayClient` | CLI `add gateway` / `add gateway-target`; raw control `*Gateway*`, `*GatewayTarget*`, `CreateApiKeyCredentialProvider` plus Cognito | **Gap for code: reimplement** (moderate; the Cognito setup is most of it) | AWS SDK clients import (tested) |
| toolkit `ObservabilityClient.query_spans_by_session` | CLI `traces list|get`; `client-cloudwatch-logs` Logs Insights on `aws/spans` | **Gap for code: reimplement** (small) | Not tested (same AWS SDK v3 family) |
| toolkit `PolicyClient` | CLI `add policy-engine` / `add policy`; raw control `*Policy*` and `StartPolicyGeneration` | **Gap for code: reimplement** (small to moderate) | AWS SDK clients import (tested) |
| `agentcore` CLI (configure/launch/invoke) | `@aws/agentcore` (`create`/`deploy`/`invoke`; `import` migrates `.bedrock_agentcore.yaml`) | Replacement with different config (`agentcore.json`) | `--help` runs under Deno; Node ≥ 20 is the supported host |

## Gaps with no TypeScript equivalent (in official TS packages)

1. **General-purpose `MemoryClient`.** No create, list or get-strategies helpers and no
   `StrategyType` enum. Only the Strands-bound `AgentCoreMemoryStore`/`AgentCoreEventSender`
   exist. Rebuild on `client-bedrock-agentcore(-control)`.
2. **Public `IdentityClient`.** No `complete_resource_token_auth`, `get/update_workload_identity`
   or `UserTokenIdentifier`. Rebuild with thin AWS SDK wrappers.
3. **Local-dev workload identity fallback in `requires_access_token`.** Python auto-creates a
   workload identity and uses `.agentcore.json`; `withAccessToken` throws outside the runtime.
4. **Starter toolkit `Runtime` as a library** (configure, launch, status, invoke with
   role/ECR/CodeBuild automation). Only the CLI (`@aws/agentcore`) or raw SDK/CDK.
5. **`Evaluation` client**, in particular the client-side `run()` that fetches spans and calls
   `Evaluate`. CLI or raw SDK only.
6. **`GatewayClient`** (Cognito "EZ auth", create gateway/target helpers with waiters, cleanup).
   The TS SDK says "coming soon"; CLI or raw SDK only.
7. **`ObservabilityClient`** (span queries). The TS SDK says "coming soon"; CLI `traces` or raw
   CloudWatch Logs.
8. **`PolicyClient`** (create-or-get, NL policy generation with polling, cleanup). CLI or raw SDK
   only.
9. **A managed Deno runtime on AgentCore.** Deno agents need a custom ARM64 container.
10. **Non-gaps that look like gaps:** `services.code_interpreter.CodeInterpreterClient` and
    `services.browser_tools.BrowserToolsClient` have no TS equivalent because **they never existed
    in Python either**. Port those scripts to the real `CodeInterpreter` / `Browser` APIs.

## Sources

- [S1] aws/bedrock-agentcore-sdk-typescript @ `abafc2a` (2026-09-18): [README](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/README.md), [package.json](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/package.json), [CHANGELOG](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/CHANGELOG.md), [docs/BROWSER_LIVE_VIEW.md](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/docs/BROWSER_LIVE_VIEW.md), [src/tools/web-search/client.ts](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/tools/web-search/client.ts)
- [S2] npm: [bedrock-agentcore](https://www.npmjs.com/package/bedrock-agentcore) (0.4.4)
- [S3] Same repo, [package.json `exports` map](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/package.json) (subpaths runtime, identity, browser, code-interpreter, memory/strands, web-search)
- [S4] aws/agentcore-cli @ `805f342` (2026-09-15), v0.30.0: [README](https://github.com/aws/agentcore-cli/blob/805f3420e2069e83694ba12ef447d8495b883aef/README.md); npm [@aws/agentcore](https://www.npmjs.com/package/@aws/agentcore)
- [S5] aws/bedrock-agentcore-starter-toolkit @ `c5e1e2e`: [README](https://github.com/aws/bedrock-agentcore-starter-toolkit/blob/c5e1e2eba27ba431fb4895603e38022c420214bd/README.md) (L28: "The Starter Toolkit CLI is no longer supported. Please use the AgentCore CLI.")
- [S6] [awslabs/agentcore-samples MIGRATION.md](https://github.com/awslabs/agentcore-samples/blob/main/MIGRATION.md) (`agentcore import` from the starter toolkit)
- [S7] npm [@aws-sdk/client-bedrock-agentcore](https://www.npmjs.com/package/@aws-sdk/client-bedrock-agentcore); API reference [BedrockAgentCoreClient](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-agentcore/)
- [S8] npm [@aws-sdk/client-bedrock-agentcore-control](https://www.npmjs.com/package/@aws-sdk/client-bedrock-agentcore-control); API reference [BedrockAgentCoreControlClient](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-agentcore-control/). Command lists, `AgentManagedRuntimeType` (`NODE_22`, `PYTHON_3_10`–`3_14`), `CreateCodeInterpreterRequest` and `StartBrowserSessionRequest` were read from the 3.1136.0 type definitions (`dist-types/models/enums.d.ts`, `models_0.d.ts`).
- [S9] Local experiment, 2026-09-22: Deno 2.9.6, with scripts importing all subpaths above, listing `*Command` exports of both AWS SDK clients, constructing `CodeInterpreter`/`Browser`/`CodeInterpreterTools`/`BrowserTools`, running a `BedrockAgentCoreApp` and curling `/ping` and `/invocations`, and running `deno run -A npm:@aws/agentcore@0.30.0 --help`.
- [S10] Deno docs, [Node and npm compatibility](https://docs.deno.com/runtime/fundamentals/node/) (`npm:` specifiers, `node:` built-ins, lifecycle scripts need `--allow-scripts`). [S10a] [aws/aws-sdk-js-v3 README](https://github.com/aws/aws-sdk-js-v3) (supported environments; Deno not mentioned). [S10b] Deno issues [#16810](https://github.com/denoland/deno/issues/16810), [#17666](https://github.com/denoland/deno/issues/17666)
- [S11] agentcore-cli [docs/container-builds.md](https://github.com/aws/agentcore-cli/blob/805f3420e2069e83694ba12ef447d8495b883aef/docs/container-builds.md), [docs/configuration.md](https://github.com/aws/agentcore-cli/blob/805f3420e2069e83694ba12ef447d8495b883aef/docs/configuration.md)
- [S12] AWS docs, [HTTP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html) (host 0.0.0.0, port 8080, ARM64, `/invocations`, `/ping`, `/ws`); [Runtime service contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-service-contract.html)
- [S13] aws/bedrock-agentcore-sdk-python tag [v1.6.0](https://github.com/aws/bedrock-agentcore-sdk-python/tree/v1.6.0/src/bedrock_agentcore) (`services/` = `identity.py`, `resource_policy.py`; tools under `tools/`)
- [S14] aws/bedrock-agentcore-sdk-python @ [`889615f`](https://github.com/aws/bedrock-agentcore-sdk-python/tree/889615f4c7f2fb69565f2c4ac3ce83e146e8a459/src/bedrock_agentcore) (v1.23.1)
- [S15] TS SDK [src/runtime/app.ts](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/runtime/app.ts), [src/runtime/client.ts](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/runtime/client.ts), [src/runtime/index.ts](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/runtime/index.ts)
- [S16] TS SDK [src/memory/integrations/strands/](https://github.com/aws/bedrock-agentcore-sdk-typescript/tree/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/memory/integrations/strands)
- [S17] Python SDK [memory/client.py](https://github.com/aws/bedrock-agentcore-sdk-python/blob/889615f4c7f2fb69565f2c4ac3ce83e146e8a459/src/bedrock_agentcore/memory/client.py), [memory/constants.py](https://github.com/aws/bedrock-agentcore-sdk-python/blob/889615f4c7f2fb69565f2c4ac3ce83e146e8a459/src/bedrock_agentcore/memory/constants.py)
- [S18] TS SDK [src/identity/wrappers.ts](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/identity/wrappers.ts), [types.ts](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/identity/types.ts), [index.ts](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/identity/index.ts)
- [S19] TS SDK [src/identity/client.ts](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/identity/client.ts)
- [S20] Python SDK [identity/auth.py](https://github.com/aws/bedrock-agentcore-sdk-python/blob/889615f4c7f2fb69565f2c4ac3ce83e146e8a459/src/bedrock_agentcore/identity/auth.py)
- [S21] Python SDK [services/identity.py](https://github.com/aws/bedrock-agentcore-sdk-python/blob/889615f4c7f2fb69565f2c4ac3ce83e146e8a459/src/bedrock_agentcore/services/identity.py)
- [S22] TS SDK [src/tools/code-interpreter/](https://github.com/aws/bedrock-agentcore-sdk-typescript/tree/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/tools/code-interpreter)
- [S23] TS SDK [src/tools/browser/](https://github.com/aws/bedrock-agentcore-sdk-typescript/tree/abafc2afc60459737cf4fa6e3ef2d5b29af83577/src/tools/browser)
- [S24] Starter toolkit [notebook/runtime/bedrock_agentcore.py](https://github.com/aws/bedrock-agentcore-starter-toolkit/blob/c5e1e2eba27ba431fb4895603e38022c420214bd/src/bedrock_agentcore_starter_toolkit/notebook/runtime/bedrock_agentcore.py), [operations/runtime/launch.py](https://github.com/aws/bedrock-agentcore-starter-toolkit/blob/c5e1e2eba27ba431fb4895603e38022c420214bd/src/bedrock_agentcore_starter_toolkit/operations/runtime/launch.py), [services/runtime.py](https://github.com/aws/bedrock-agentcore-starter-toolkit/blob/c5e1e2eba27ba431fb4895603e38022c420214bd/src/bedrock_agentcore_starter_toolkit/services/runtime.py)
- [S25] agentcore-cli [src/index.ts](https://github.com/aws/agentcore-cli/blob/805f3420e2069e83694ba12ef447d8495b883aef/src/index.ts), [package.json](https://github.com/aws/agentcore-cli/blob/805f3420e2069e83694ba12ef447d8495b883aef/package.json)
- [S26] Starter toolkit [notebook/evaluation/client.py](https://github.com/aws/bedrock-agentcore-starter-toolkit/blob/c5e1e2eba27ba431fb4895603e38022c420214bd/src/bedrock_agentcore_starter_toolkit/notebook/evaluation/client.py), [operations/evaluation/](https://github.com/aws/bedrock-agentcore-starter-toolkit/tree/c5e1e2eba27ba431fb4895603e38022c420214bd/src/bedrock_agentcore_starter_toolkit/operations/evaluation)
- [S27] Starter toolkit [operations/gateway/client.py](https://github.com/aws/bedrock-agentcore-starter-toolkit/blob/c5e1e2eba27ba431fb4895603e38022c420214bd/src/bedrock_agentcore_starter_toolkit/operations/gateway/client.py)
- [S28] Starter toolkit [operations/observability/](https://github.com/aws/bedrock-agentcore-starter-toolkit/tree/c5e1e2eba27ba431fb4895603e38022c420214bd/src/bedrock_agentcore_starter_toolkit/operations/observability)
- [S29] Starter toolkit [operations/policy/client.py](https://github.com/aws/bedrock-agentcore-starter-toolkit/blob/c5e1e2eba27ba431fb4895603e38022c420214bd/src/bedrock_agentcore_starter_toolkit/operations/policy/client.py)
