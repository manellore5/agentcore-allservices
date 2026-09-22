# AgentCore SDK + starter-toolkit coverage in TypeScript/Deno

Type: research
Status: resolved
Blocked by:

## Question

For every `bedrock_agentcore` and `bedrock_agentcore_starter_toolkit` API this repo uses, what is the TypeScript equivalent, if any, and does it run under Deno (`npm:` specifiers)?

APIs in use: `bedrock_agentcore.runtime.BedrockAgentCoreApp`, `bedrock_agentcore.memory` (MemoryClient + constants), `bedrock_agentcore.identity.auth` (`requires_access_token` etc.), `bedrock_agentcore.services.identity`, `bedrock_agentcore.services.code_interpreter`, `bedrock_agentcore.services.browser_tools`; starter toolkit `Runtime`, `Evaluation`, `operations.gateway.client.GatewayClient`, `operations.observability.client.ObservabilityClient`, and the `agentcore` CLI (configure/launch/invoke).

For each one, report: the official TS package (e.g. an AgentCore TS SDK or an AWS SDK v3 `@aws-sdk/client-bedrock-agentcore*` client), the matching API, any feature gaps, and Deno compatibility notes. Name the primary sources.

## Context pointer

Findings: branch `research/agentcore-sdk-typescript`, file `docs/research/agentcore-sdk-typescript.md`

## Answer

**Everything the repo uses has a TS route, but only part of it is a library.**

- **Official TS SDK:** npm `bedrock-agentcore` v0.4.4. It covers:
  - the agent server (`BedrockAgentCoreApp`)
  - `CodeInterpreter`
  - `Browser`/`PlaywrightBrowser`
  - `withAccessToken`/`withApiKey`
  - Memory, but only as a Strands integration
  
  Gateway and Observability are "coming soon".
- **The starter toolkit is superseded by the npm AgentCore CLI** `@aws/agentcore` v0.30.0: create, dev, deploy, invoke, gateway/evaluator/policy commands, traces, eval. Its CLI is officially unsupported. There is no programmatic `Runtime.configure/launch/invoke`.
- **AWS SDK v3:** `@aws-sdk/client-bedrock-agentcore` and `-control` have a command for every boto3 call the repo makes.
- **Gaps with no TS library:**
  - `MemoryClient`: roughly 100–150 lines on SDK v3
  - `IdentityClient`: thin wrappers
  - `Evaluation`: span filtering + Evaluate
  - `GatewayClient`: mostly Cognito setup
  - `ObservabilityClient`: a Logs Insights query on `aws/spans`
  - `PolicyClient`
  - `Runtime`: role/ECR/CodeBuild automation
- **Deno, smoke-tested locally with no AWS calls:** all `bedrock-agentcore` subpaths and both SDK clients import. `BedrockAgentCoreApp` serves `/ping` and a streamed `/invocations`. `npm:@aws/agentcore` runs. Deno isn't officially supported.
- **Behaviour differences:**
  - The TS server returns 400 without a session-id header, and 406 on streaming requests unless they send `Accept: text/event-stream`.
  - `withAccessToken` throws outside a runtime request context. Python auto-creates a workload identity for local runs.
- **Existing Python bugs:**
  - `code_interpreter_setup.py` and `browser_tools_setup.py` import modules that don't exist in any Python SDK version, and their methods are made up.
  - `gateway_setup.py` treats the dict returned by `create_mcp_gateway` as an object.

Full findings with sources: branch `research/agentcore-sdk-typescript`, `docs/research/agentcore-sdk-typescript.md` (commit 501d0e9).
