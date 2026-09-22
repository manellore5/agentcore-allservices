# How the notebooks replace the Python starter toolkit

Type: grilling
Status: resolved
Blocked by:

## Question

The notebooks call `Runtime.configure/launch/invoke`, `Evaluation`, `GatewayClient`, `ObservabilityClient` and `PolicyClient` from `bedrock_agentcore_starter_toolkit`, and there is no TS library for any of them. For each one, which replacement does the course use?

- **(a) Shell out to the npm `@aws/agentcore` CLI** through the notebook shell helper. This is the official successor, but it changes how the cells read, from Python calls to CLI invocations and a project config file.
- **(b) A thin in-repo TS helper on AWS SDK v3** that mirrors the toolkit's API, e.g. `memory.ts`, `gateway.ts`, `observability.ts`, `evaluation.ts`. This is closest to "only the language changes", but it is code the repo now owns.
- **(c) A mix,** e.g. the CLI for deploy/launch and SDK v3 helpers for queries and evaluation.

The same choice applies to the missing `MemoryClient` and `IdentityClient` in the backend. Also decide where the helpers live, alongside the notebook helper module from the Deno Jupyter decision.

Background: `docs/research/agentcore-sdk-typescript.md` on branch `research/agentcore-sdk-typescript`.

## Answer

Decided with the user on 2026-09-22.

1. **In-repo TS helpers on AWS SDK v3 mirror the toolkit's classes:** `GatewayClient`, `MemoryClient`, `IdentityClient`, `ObservabilityClient`, `Evaluation`, `PolicyClient`. The notebooks already call AWS directly for everything else, and they keep doing so through SDK v3 clients. Cells don't use the npm `@aws/agentcore` CLI. The estimate is about 600–900 lines.
2. **Learners need no local Docker,** matching today, where the toolkit builds remotely in CodeBuild.
3. **`Runtime` (`configure` / `launch` / `status` / `invoke`) is our own helper,** ported from the Python toolkit's logic:
   - auto-create the execution role and ECR repo
   - zip the agent folder to S3
   - arm64 CodeBuild build + push
   - `CreateAgentRuntime` / `UpdateAgentRuntime` with `metadataConfiguration.requireMMDSV2: true`
   - poll until READY
   
   It is the largest helper, about 300–400 lines. The spike already proved create and invoke.
4. **API fidelity:** same class names, camelCase methods, options objects mirroring the Python kwargs in camelCase, same return shapes. For example, `create_memory_and_wait(name=..., strategies=[...])` becomes `await memory.createMemoryAndWait({ name, strategies })`.
5. **Location:** `capstone_project/toolkit/` with `runtime.ts`, `gateway.ts`, `memory.ts`, `identity.ts`, `observability-client.ts`, `evaluation.ts`, `policy.ts` and `mod.ts`, shared by the notebooks and the backend. The notebook utilities and the in-container telemetry module are separate; their placement belongs to the toolchain-layout ticket.
6. **Verification:** live runs of the notebooks that use each helper. `deno test` unit tests cover only pure logic, e.g. `Evaluation.run` span filtering and memory-strategy key normalisation.
