# Port: toolkit Runtime helper with CodeBuild deploy

Type: task
Status: resolved
Blocked by: 14

## Question

Write `capstone_project/toolkit/runtime.ts` with `configure` / `launch` / `status` / `invoke`, ported from the Python toolkit's `Runtime`: auto-create the execution role and ECR repo, zip the agent folder (copying in `shared/observability.ts`), run an arm64 CodeBuild build and push, then `CreateAgentRuntime` / `UpdateAgentRuntime` with `metadataConfiguration.requireMMDSV2: true` and poll until READY. Learners need no local Docker.

The container `CMD` must use `deno run -A --preload observability.ts <entrypoint>`. The spike's `Dockerfile`, `deploy2.ts` and `update2.ts` on branch `research/deno-observability-spike` are working references for the image and the control-plane calls.

Verified for real by the notebook 02 ticket.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commit 6a3cb9d: `capstone_project/toolkit/runtime.ts` (939 lines) plus `runtime_test.ts` (12 tests). Exported from `mod.ts`.

**API, mirroring the Python class:**
- `configure({ entrypoint, agentName, requirementsFile, region, autoCreateExecutionRole, autoCreateEcr, executionRole, environmentVariables, authorizerConfiguration, protocol, idleTimeout, maxLifetime, sourceDir })`
- `launch({ autoUpdateOnConflict = true, buildTimeoutMs })`, `status()`, `invoke(payload, { sessionId, bearerToken, qualifier })`, and `runtime.name`.

**The launch pipeline, ported from the Python toolkit so no local Docker is needed:**
1. ECR repo `bedrock-agentcore-<sanitized agent name>`.
2. Execution role `AmazonBedrockAgentCoreSDKRuntime-<region>-<sha256(agentName)[:10]>`, with the trust policy and permissions ported from the toolkit's templates.
3. Source bucket `bedrock-agentcore-codebuild-sources-<account>-<region>`, with the 7-day lifecycle rule, plus the CodeBuild role.
4. Zip the agent folder, adding the generated Deno `Dockerfile` and a copy of `shared/observability.ts`, then upload to `s3://<bucket>/<agent>/source.zip`.
5. Create or update the arm64 CodeBuild project and wait for the build, reporting phases.
6. `CreateAgentRuntime` or `UpdateAgentRuntime` with `requireMMDSV2: true`, then poll until READY.
7. Persist state to `.bedrock_agentcore.json`, so a restarted kernel can still `status()` and `invoke()`.

The generated Dockerfile runs `deno run -A --preload observability.ts <entrypoint>`, which is what keeps telemetry out of agent code.

**Verified:** `deno task check` (21 files), `deno lint`, `deno fmt`, and `deno task test` = 94 tests passing across the toolkit. Live verification comes with the notebook 02 ticket, which is the first cell to call `configure`/`launch`.

**Dependency added:** `jszip` 3.10.2, pinned in `deno.json`, for building the source archive. The dependency mapping table didn't anticipate it, since Python's `zipfile` is a standard-library module.

**Differences from Python, logged per the fix-and-log rule** (also at the foot of `runtime.ts`):
1. Config is `.bedrock_agentcore.json`, not `.yaml`, keyed by agent name. No YAML dependency, and it matches the notebook helper's JSON state.
2. Container deployment only. AgentCore's zip deployment supports Python and Node runtimes, never Deno.
3. The image comes from `buildDockerfile()` rather than the toolkit's Jinja template.
4. The execution-role policy adds `xray:PutSpans` / `PutSpansForIndexing`, which the SigV4 OTLP exporter needs, plus the code-interpreter, browser and identity actions the course's agents use. The Python template hides those behind flags the course never sets.
5. Ignore-file filtering is a fixed list, not the toolkit's dockerignore pattern engine; the agent folders are flat.
6. No local container runtime path, since learners aren't required to have Docker.
7. Not ported (no call site): `destroy`, `stop_session`, VPC configuration, `memory_mode` auto-provisioning, request-header configuration.
