# Deploying a Deno/TypeScript agent to Amazon Bedrock AgentCore Runtime

Research date: 2026-09-22. Sources are primary (AWS docs, AWS/Deno GitHub source, npm registry, Docker Hub) and are linked inline. Anything marked **UNVERIFIED** is an inference or has no primary source, and should be tested before we rely on it.

## TL;DR

- AgentCore Runtime runs any **linux/arm64 container** that serves `POST /invocations` and `GET /ping` on `0.0.0.0:8080`. A Deno container fits this contract; no Python is needed inside the image.
- **Direct-code (zip) deployment does not work for Deno.** The managed runtimes are `PYTHON_3_10`–`PYTHON_3_14` and `NODE_22`, and a Node entry point must be a `.js` file. Deno needs **container deployment**.
- The Python `agentcore` CLI (starter toolkit) is not required. We have three supported options: (a) the **new npm `@aws/agentcore` CLI**, which supports `"build": "Container"` with a Dockerfile you supply and builds it in CodeBuild, (b) **CDK** `AgentRuntimeArtifact.fromAsset()`, or (c) **AWS SDK v3** (`@aws-sdk/client-bedrock-agentcore-control` `CreateAgentRuntimeCommand`) after an ECR push.
- **Observability is the main risk.** AgentCore's GenAI observability documents ADOT SDKs only, and the ADOT Collector is explicitly unsupported. Deno's built-in OTel exports plain OTLP with no SigV4 signing and is not ADOT. The ADOT Node package works by patching `require()`, which Deno does not document support for. Getting the same traces as the Python `opentelemetry-instrument` flow on Deno is **not documented** and needs a spike.
- The OAuth callback server runs **on the learner's machine**, not in the runtime. A small `Deno.serve` app plus `CompleteResourceTokenAuthCommand` from AWS SDK v3 replaces it, and nothing about it is specific to AgentCore Runtime.

---

## 1. Today's Python flow (what we are replacing)

- `capstone_project/backend/identity/runtime/Dockerfile` starts from `ghcr.io/astral-sh/uv:python3.10-bookworm-slim`, runs `uv pip install -r requirements.txt` and `aws-opentelemetry-distro>=0.10.1`, sets `DOCKER_CONTAINER=1`, runs as UID 1000 `bedrock_agentcore`, exposes 8080/8000/9000, and has `CMD ["opentelemetry-instrument", "python", "-m", "travel_agent_google_drive"]`.
  - `DOCKER_CONTAINER=1` matters because the Python SDK's `app.run()` binds to `0.0.0.0` only when `/.dockerenv` exists or `DOCKER_CONTAINER` is set. Otherwise it binds to `127.0.0.1` ([bedrock-agentcore-sdk-python `runtime/app.py`](https://github.com/aws/bedrock-agentcore-sdk-python/blob/main/src/bedrock_agentcore/runtime/app.py)).
- Notebooks 02, 05, 08, 09 and 11 all use `bedrock_agentcore_starter_toolkit.Runtime().configure(entrypoint=..., requirements_file="requirements.txt", auto_create_execution_role=True, auto_create_ecr=True, ...)` and then `.launch()`. Notebook 02 passes `container_runtime=None` to force a CodeBuild ARM64 build. Notebooks 05 and 08 add a `customJWTAuthorizer` (Cognito). Notebook 08 passes gateway and memory IDs as env vars. Notebooks 09 and 11 call `invoke_agent_runtime` / `delete_agent_runtime` / `list_agent_runtimes` through boto3, and notebook 09 passes `traceParent`/`traceState`/`baggage` so traces correlate.
- The agents use `BedrockAgentCoreApp` + `@app.entrypoint`. The identity agent returns an async generator, which the SDK streams as SSE (`StreamingResponse(..., media_type="text/event-stream")`, and each item is framed as `data: <json>\n\n` by `_convert_to_sse`) ([Python SDK `app.py`](https://github.com/aws/bedrock-agentcore-sdk-python/blob/main/src/bedrock_agentcore/runtime/app.py)).

## 2. Runtime container contract

From the [HTTP protocol contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html) and the [service contract overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-service-contract.html):

| Item | Requirement |
| --- | --- |
| Host / port | `0.0.0.0:8080` for HTTP protocol (MCP uses 8000 `/mcp`, A2A uses 9000 `/`) |
| Platform | ARM64 container ("Required for compatibility") |
| `POST /invocations` | JSON in. The response is either `application/json` or `text/event-stream` (SSE) |
| `GET /ping` | `200`, `application/json`, `{"status": "Healthy" \| "HealthyBusy"}`. `time_of_last_update` is optional and must change only when the status changes. Setting it on every ping stops idle timeout and can exhaust the session quota |
| `/ws` | Optional WebSocket on the same port 8080 |
| Registry | Image must be in ECR. `containerUri` must match `<acct>.dkr.ecr.<region>.amazonaws.com/...` or `public.ecr.aws/...` ([ContainerConfiguration](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_ContainerConfiguration.html), [Get started without the CLI](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/getting-started-custom.html)) |

**SSE framing.** The docs example is `data: {"event": "..."}` lines ([HTTP contract](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-http-protocol-contract.html)). To stay byte-compatible with what the notebooks' consumers parse today, emit `data: ${JSON.stringify(chunk)}\n\n` per chunk, as the Python SDK does. The TS SDK sends generator output via `@fastify/sse`, and it **rejects streaming unless the request sends `Accept: text/event-stream`** ([TS SDK `runtime/app.ts`](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/src/runtime/app.ts)). The Python SDK has no such check, so a hand-written Deno server should not add one either.

**Request headers the agent may need** (constants from [Python SDK `runtime/models.py`](https://github.com/aws/bedrock-agentcore-sdk-python/blob/main/src/bedrock_agentcore/runtime/models.py), mirrored in [TS SDK `runtime/app.ts`](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/src/runtime/app.ts)):
- `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` and `X-Amzn-Bedrock-AgentCore-Runtime-Request-Id`
- `X-Amz-Bedrock-AgentCore-Identity-WAT` (legacy `WorkloadAccessToken`): the workload access token that Identity's `GetResourceOauth2Token` needs
- `OAuth2CallbackUrl` and `Authorization` (JWT inbound auth)
- Custom headers must use the `X-Amzn-Bedrock-AgentCore-Runtime-Custom-` prefix

**Other operational facts:**
- Credentials come from the microVM metadata service (MMDS), which works like IMDS. Since 2026-06-30, invocations are rejected unless the runtime has `metadataConfiguration.requireMMDSV2 = true` ([Troubleshooting](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-troubleshooting.html), [RuntimeMetadataConfiguration](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_RuntimeMetadataConfiguration.html)). Any direct `CreateAgentRuntime` call we write must set this.
- An image with more than 53 layers and a non-numeric `USER` fails with HTTP 424 ("Failed to mount overlay"). Use a numeric `USER` ([Troubleshooting](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-troubleshooting.html)).
- Sessions keep the artifact they started with, so after an update, test with a new session ID ([Troubleshooting](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-troubleshooting.html)).
- An x86 image fails with `exec format error`. The fix is buildx `--platform linux/arm64` or CodeBuild ([Troubleshooting](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-troubleshooting.html)).

### Minimal Deno server shape (sketch)

```ts
// main.ts
Deno.serve({ hostname: "0.0.0.0", port: 8080 }, async (req) => {
  const { pathname } = new URL(req.url);
  if (req.method === "GET" && pathname === "/ping") {
    return Response.json({ status: busy ? "HealthyBusy" : "Healthy" });
  }
  if (req.method === "POST" && pathname === "/invocations") {
    const payload = await req.json();
    const sessionId = req.headers.get("x-amzn-bedrock-agentcore-runtime-session-id");
    const wat = req.headers.get("x-amz-bedrock-agentcore-identity-wat")
      ?? req.headers.get("workloadaccesstoken");
    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(c) {
        for await (const chunk of runAgent(payload, { sessionId, wat })) {
          c.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        c.close();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }
  return new Response("not found", { status: 404 });
});
```

`Deno.serve` defaults to port 8000, so set port 8080 and hostname explicitly ([Deno HTTP server docs](https://docs.deno.com/runtime/fundamentals/http_server/)). `ReadableStream` bodies are the documented way to stream, and the stream is cancelled when the client hangs up (same source).

**Using the official TS SDK instead.** `bedrock-agentcore` (npm, v0.4.4) provides a `BedrockAgentCoreApp` that implements the contract: Fastify 5, port 8080 on `0.0.0.0`, automatic `Healthy`/`HealthyBusy`, SSE, `/ws`, and header-to-context mapping. It declares `engines.node >= 20` and does not mention Deno ([repo](https://github.com/aws/bedrock-agentcore-sdk-typescript), [package.json](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/package.json)). **UNVERIFIED:** whether Fastify, `@fastify/sse`, `@fastify/websocket` and AsyncLocalStorage context behave correctly under Deno's Node compatibility layer. Deno's built-in OTel auto-instruments `Deno.serve` but documents only `node:http2`, not `node:http`, for Node servers ([Deno OTel docs](https://docs.deno.com/runtime/fundamentals/open_telemetry/)). A Fastify server on Deno may therefore produce no server spans.

## 3. Deno base image and dependency caching

- Official images: `denoland/deno` on Docker Hub and `ghcr.io/denoland/deno`, in debian (default), alpine, distroless, ubuntu and `bin` variants ([deno_docker README](https://github.com/denoland/deno_docker)). The current tag `2.9.7` (and `debian-2.9.7`, `distroless-2.9.7`) is published for **linux/amd64 and linux/arm64** ([Docker Hub tag API](https://hub.docker.com/v2/repositories/denoland/deno/tags/2.9.7), checked 2026-09-22).
- The image defines a user `deno` with **UID 1993**, `DENO_DIR=/deno-dir/`, and `ENTRYPOINT ["/tini", "--", "docker-entrypoint.sh"]` ([debian.dockerfile](https://github.com/denoland/deno_docker/blob/main/debian.dockerfile)).
- Caching pattern from the [Deno Docker guide](https://docs.deno.com/runtime/reference/docker/): copy `deno.json deno.lock package.json*` first, then `RUN deno ci --prod --skip-types` (a reproducible install from `deno.lock`), then `COPY . .`. In a multi-stage build, **copy `$DENO_DIR` into the final stage**, or the container re-downloads dependencies on first run. The deno_docker README also shows `RUN deno cache main.ts` after copying source, so type-checking and compilation happen at build time and not at startup.

Proposed Dockerfile (replaces `requirements.txt` with `deno.json` + `deno.lock`):

```dockerfile
FROM --platform=linux/arm64 ghcr.io/denoland/deno:2.9.7
WORKDIR /app
ENV DENO_DIR=/deno-dir \
    DENO_NO_UPDATE_CHECK=1 \
    DENO_NO_PROMPT=1 \
    AWS_REGION=us-east-1
COPY deno.json deno.lock ./
RUN deno ci --prod --skip-types
COPY . .
RUN deno cache main.ts
# numeric USER avoids the >53-layer overlay failure
USER 1993
EXPOSE 8080
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-sys", "main.ts"]
```

Notes:
- The permission flags are a starting point. The AWS SDK's credential and metadata providers read env and files and make network calls to the MMDS address. Which exact `--allow-*` set is sufficient is **UNVERIFIED**, so start with `-A` in a spike and then narrow it.
- `DENO_DIR` must be writable by UID 1993, or the dependencies must be fully cached at build time.
- **Alternative:** `deno compile --target aarch64-unknown-linux-gnu` produces a single binary that can be copied into a minimal base image. This is not needed for a first cut.

## 4. Direct code (zip) vs container

- **Direct code deploy** zips code and dependencies to S3 and calls `CreateAgentRuntime` with `agentRuntimeArtifact.codeConfiguration { code.s3, runtime, entryPoint }` ([Node direct-code guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html)).
  - Supported runtimes: `PYTHON_3_10`–`PYTHON_3_14` and **`NODE_22`** only, on Amazon Linux 2023. `NODE_22` is deprecated on 2027-04-30 ([Supported runtimes](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-code-deploy-supported-runtimes.html)). Node support was announced in April 2026 ([What's New](https://aws.amazon.com/about-aws/whats-new/2026/04/amazon-bedrock-agentcore-runtime/)).
  - A Node entry point must be a `.js` file, and `.ts` is not accepted. You transpile with `tsc` or bundle with esbuild. The limits are 250 MB zipped and 750 MB unzipped. Native `.node`/`.so` files are ELF-checked for arm64, and `engines.node` is validated against Node 22 ([Node direct-code guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html)).
  - The CDK construct allow-list is the same: `PYTHON_3_10..3_14 | NODE_22` ([aws-cdk `runtime-artifact.ts`](https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/aws-bedrockagentcore/lib/runtime/runtime-artifact.ts)).
- **Conclusion:** there is no Deno (or Bun, or custom) managed runtime, so **Deno requires container deployment**. There is a Node/TS direct-code path. If the port wrote Node-compatible TS and bundled it with esbuild (or `deno bundle`, which was restored in Deno 2.4 and uses esbuild internally, per the [Deno 2.4 blog](https://deno.com/blog/v2.4)), it could ship as a `NODE_22` zip. The code would then run on Node, not Deno, so any `Deno.*` API usage would break. **UNVERIFIED** whether `deno bundle` output is acceptable to the `NODE_22` runtime.

## 5. Deploying without the Python `agentcore` CLI

### Option A: new AgentCore CLI (npm, official)
- `npm install -g @aws/agentcore` (v0.30.0 on npm, `engines.node >= 20`). It replaces the Python starter toolkit, and both use the `agentcore` command name. The README tells you to uninstall `bedrock-agentcore-starter-toolkit` ([agentcore-cli README](https://github.com/aws/agentcore-cli)). Commands: `create`, `add agent`, `dev`, `deploy`, `invoke`, `status`, `logs`, `traces`, `remove`. `deploy` synthesizes and deploys through **AWS CDK/CloudFormation** ([TS CLI getting started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html)).
- **Container builds:** `"build": "Container"` in `agentcore/agentcore.json`. The generated Dockerfile "can be customized freely — ... change the base image". `agentcore deploy` builds remotely in **AWS CodeBuild** and pushes to ECR, so no local Docker is needed. Converting from CodeZip means adding a `Dockerfile` + `.dockerignore`. The upload always excludes `.env*`, `.git`, `node_modules`, etc. ([container-builds.md](https://github.com/aws/agentcore-cli/blob/main/docs/container-builds.md)).
- The generated **TS container template** is `node:22-slim` + `npm ci` + `CMD ["npx","tsx","main.ts"]`, with UID 1000, and it has **no ADOT/OTel wiring** ([template Dockerfile](https://github.com/aws/agentcore-cli/blob/main/src/assets/container/typescript/Dockerfile)). A Deno Dockerfile would replace it.
- **UNVERIFIED:** `agentcore dev` for container agents "adds a dev layer with `uvicorn`" and hot reloads through `uvicorn --reload` ([container-builds.md](https://github.com/aws/agentcore-cli/blob/main/docs/container-builds.md)). That looks Python-specific, so local dev for a Deno container may not work through the CLI. `agentcore deploy` should still work because it only runs `docker build` in CodeBuild. The `entrypoint`/`runtimeVersion` fields in `agentcore.json` may need placeholder values for a Deno container.

### Option B: CDK
- `aws-cdk-lib/aws-bedrockagentcore` includes L2 constructs (`Runtime`, `Gateway`, `Memory`, ...) ([CDK module docs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html)). The earlier `@aws-cdk/aws-bedrock-agentcore-alpha` package also exists ([Construct Hub](https://constructs.dev/packages/@aws-cdk/aws-bedrock-agentcore-alpha/v/2.225.0-alpha.0)).
- `AgentRuntimeArtifact.fromAsset(dir, DockerImageAssetOptions)` builds the local Dockerfile and pushes it to CDK-managed ECR. `fromEcrRepository(repo, tag)` and `fromImageUri(uri)` reference existing images ([runtime-artifact.ts](https://github.com/aws/aws-cdk/blob/main/packages/aws-cdk-lib/aws-bedrockagentcore/lib/runtime/runtime-artifact.ts)).
  - `fromAsset` does **not** set a platform itself (same source), so pass `platform: Platform.LINUX_ARM64` and build on arm64 hardware or under emulation.
- CDK apps run on Node, not Deno, so this adds a Node toolchain to the course.

### Option C: AWS SDK v3 from Deno (closest to the current notebook style)
1. **Build and push an arm64 image.** Options:
   - Locally: `docker buildx build --platform linux/arm64 ... --push` to an ECR repo ([Get started without the CLI](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/getting-started-custom.html)).
   - Or with a CodeBuild project on `ARM_CONTAINER` compute, which reproduces the toolkit's `container_runtime=None` behaviour ([CodeBuild compute types](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-compute-types.html)). This needs `@aws-sdk/client-ecr`, `client-codebuild`, `client-s3` and `client-iam` calls, which is the orchestration the starter toolkit hides today.
2. **Create the runtime.** `new BedrockAgentCoreControlClient({region}).send(new CreateAgentRuntimeCommand({ agentRuntimeName, agentRuntimeArtifact: { containerConfiguration: { containerUri } }, roleArn, networkConfiguration: { networkMode: "PUBLIC" }, authorizerConfiguration?, environmentVariables?, metadataConfiguration: { requireMMDSV2: true } }))`.
   - The artifact is a union of `containerConfiguration` and `codeConfiguration` ([AgentRuntimeArtifact](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_AgentRuntimeArtifact.html)).
   - The TS form of Create/Update/Delete is shown in the [Node direct-code guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html).
   - Package: `@aws-sdk/client-bedrock-agentcore-control` v3.1137.0.
3. **Invoke.** Call `@aws-sdk/client-bedrock-agentcore` `InvokeAgentRuntimeCommand` and read `response.response`. For OAuth (JWT) inbound auth you cannot use the SDK and must make a raw HTTPS request with a bearer token ([TS CLI getting started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-cli-typescript.html)). Notebooks 05 and 08 hit this case.
4. **IAM execution role.** The toolkit's `auto_create_execution_role` must be replaced by explicit IAM calls or a CDK/CFN template ([runtime permissions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-permissions.html)).

**AWS SDK v3 on Deno.** The SDK README documents Node.js, browser and React Native, and **does not mention Deno** ([aws-sdk-js-v3 README](https://github.com/aws/aws-sdk-js-v3)). **UNVERIFIED** in practice for the credential chain inside AgentCore (the MMDS/IMDS provider over `node:http`) and for `~/.aws` profile/SSO resolution on learners' machines.

## 6. Observability (CloudWatch GenAI observability)

What AWS documents:
- **Prerequisites.** One-time CloudWatch Transaction Search setup, then "add the AWS Distro for Open Telemetry (ADOT) SDK to your agent code". For Python that means `aws-opentelemetry-distro>=0.18.0` and `opentelemetry-instrument python ...` ([Configure observability](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html)).
  - ADOT ≥ 0.18.0 is required for the per-agent "unified" span destination.
  - Agents created on or after 2026-07-20 use unified telemetry by default ([Telemetry setup](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/supported-frameworks-telemetry.html)).
  - **The course pins `aws-opentelemetry-distro>=0.10.1`, which is below 0.18.0.**
- **The ADOT Collector is explicitly unsupported** for agent observability. Only the ADOT SDK or the ADOT Lambda layer are supported ([Configure observability](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/observability-configure.html)).
- **The runtime injects default ADOT environment variables.** `DISABLE_ADOT_OBSERVABILITY=true` unsets them if you use another platform (same source). Their exact values are not documented for runtime-hosted agents. The documented values for off-runtime agents include `AGENT_OBSERVABILITY_ENABLED=true`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, `OTEL_EXPORTER_OTLP_LOGS_HEADERS=x-aws-log-group=...` and `OTEL_RESOURCE_ATTRIBUTES=service.name=...,aws.log.group.names=...`.
- **Node ADOT.** Package `@aws/aws-distro-opentelemetry-node-autoinstrumentation`, current version 0.13.0 on npm. It "works by patching Node.js `require()` calls" and silently emits nothing with ESM output. For zips you use the `opentelemetry-instrument` entry-point prefix ([Node direct-code guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-get-started-code-deploy-node.html)).
  - When `AGENT_OBSERVABILITY_ENABLED` is set, ADOT JS sends spans through `OTLPAwsSpanExporter` (SigV4-signed, targeting `https://xray.<region>.amazonaws.com/v1/traces`).
  - It also adds a GenAI span processor and copies `session.id` baggage onto spans ([aws-opentelemetry-configurator.ts](https://github.com/aws-observability/aws-otel-js-instrumentation/blob/main/aws-distro-opentelemetry-node-autoinstrumentation/src/aws-opentelemetry-configurator.ts)).
- **Evaluations (notebook 11) read `gen_ai.*` span attributes plus `session.id`** ([Telemetry setup](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/supported-frameworks-telemetry.html), [Vercel AI example](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/supported-frameworks-vercel-ai.html)).

What Deno offers ([Deno OTel docs](https://docs.deno.com/runtime/fundamentals/open_telemetry/), source [open_telemetry.md](https://github.com/denoland/docs/blob/main/runtime/fundamentals/open_telemetry.md)):
- Enabled with `OTEL_DENO=true`, with no unstable flag since 2.4 ([Deno 2.4](https://deno.com/blog/v2.4)).
- Auto-spans for `Deno.serve`, `fetch`, `node:http2` (2.9+) and `Deno.cron`, and console logs are exported as OTel logs.
- Wires `npm:@opentelemetry/api@1` automatically, so libraries that call the global API emit into Deno's pipeline. Strands TS declares `@opentelemetry/api` as a peer dependency ([npm](https://registry.npmjs.org/@strands-agents/sdk/latest)).
- Exporters are **only OTLP (`http/protobuf`, `http/json`, `grpc`) and `console`**, configured through `OTEL_EXPORTER_OTLP_*` including `..._HEADERS`. Propagators are `tracecontext` and `baggage` only, with no X-Ray.
- Known gaps: the `Deno.serve` server span has no error status, and several limit env vars are ignored.

Assessment:
- **Deno native OTel alone probably does not reach CloudWatch GenAI observability.** It cannot SigV4-sign requests to the X-Ray OTLP endpoint, it is not ADOT, and the Collector workaround is unsupported. **UNVERIFIED:** whether the runtime injects an OTLP endpoint that accepts unsigned traffic. Nothing in the docs says it does.
- **Running ADOT Node inside Deno is UNVERIFIED and risky.** It depends on `require()` patching of CommonJS. Deno has `--preload` (2.4) and `--require` for CJS (2.6), but custom module loaders are still "planned for a future release" ([Deno 2.6](https://deno.com/blog/v2.6)).
- **Most plausible Deno path (needs a spike):**
  1. Leave `OTEL_DENO` off.
  2. Build the OTel JS SDK manually (`@opentelemetry/sdk-trace-base`) with ADOT's `OTLPAwsSpanExporter`. The class exists in the ADOT JS source, but whether its import path is public is **UNVERIFIED**. Alternatively, write our own SigV4-signed OTLP/HTTP exporter using `@smithy/signature-v4`.
  3. Set `session.id` from the session header, and let Strands' `gen_ai.*` spans flow through the global API.
  4. Alternatively, set `DISABLE_ADOT_OBSERVABILITY=true` and accept that the course loses the GenAI dashboard and evaluations.

## 7. OAuth callback server

- `oauth2_callback_server.py` does not run in AgentCore Runtime. Notebook 05 starts it on the **learner's machine** (`uv run python .../oauth2_callback_server.py --region us-east-1`) on `127.0.0.1:9090`.
  - The runtime agent only imports `get_oauth2_callback_url()` (`http://localhost:9090/oauth2/callback`) to pass as `callback_url` to `@requires_access_token`. The notebook also registers that URL on the workload identity (`allowed_resource_oauth_2_return_urls`).
  - The Dockerfile does not expose 9090.
- **What it does:**
  - `POST /userIdentifier/token` stores `{user_token}`.
  - `GET /ping` returns `{"status":"success"}`.
  - `GET /oauth2/callback?session_id=...` calls `IdentityClient.complete_resource_token_auth(session_uri, user_identifier)` and returns success HTML.
- **Deno equivalent:** a `Deno.serve({hostname: "127.0.0.1", port: 9090})` handler with the same three routes. It calls `new BedrockAgentCoreClient({region}).send(new CompleteResourceTokenAuthCommand({ sessionUri, userIdentifier: { userToken } }))`.
  - The API is `POST /identities/CompleteResourceTokenAuth`. `sessionUri` matches `urn:ietf:params:oauth:request_uri:...`. `userIdentifier` is a union of `userToken` and `userId` ([API reference](https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_CompleteResourceTokenAuth.html)).
  - The command exists in `@aws-sdk/client-bedrock-agentcore` ([SDK source](https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-bedrock-agentcore/src/commands)).
  - The TS AgentCore SDK's `IdentityClient` has no wrapper for it, only `getOAuth2Token` and `getApiKey` ([identity/client.ts](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/src/identity/client.ts)), so call the AWS SDK command directly.
- **Nothing runtime-specific is needed.** It needs local AWS credentials (profile/SSO) and Deno permissions `--allow-net=127.0.0.1:9090,bedrock-agentcore.<region>.amazonaws.com --allow-env --allow-read` (for `~/.aws`; **UNVERIFIED** exact set).
- **Keep the callback URL constant in a small shared module**, so the agent image does not import the server, which is what the Python agent does today.
- **Agent side:** the in-runtime agent must read the WAT header (§2) and call `GetResourceOauth2Token` with `resourceOauth2ReturnUrl`, `forceAuthentication` and polling. The TS SDK's `withAccessToken({ providerName, scopes, authFlow, onAuthUrl, forceAuthentication, callbackUrl })` does this and reads the WAT from request context ([identity/wrappers.ts](https://github.com/aws/bedrock-agentcore-sdk-typescript/blob/main/src/identity/wrappers.ts)). That context is populated by the SDK's Fastify app, so on a hand-written `Deno.serve` server, pass `workloadIdentityToken` explicitly.

## 8. Recommended deployment path

1. **Container deployment with a Deno Dockerfile** (§3). Hand-write the contract server with `Deno.serve` (§2) instead of the TS SDK's Fastify app, because it is smaller, avoids Node-compat unknowns, and `Deno.serve` is what Deno's OTel instruments. Use the AWS SDK v3 and Strands TS as npm dependencies, locked in `deno.lock`.
2. **Deploy with the npm `@aws/agentcore` CLI, `"build": "Container"`** as the default course path. It is the official successor to the Python starter toolkit, handles IAM, ECR and the CodeBuild arm64 build through CDK, and keeps notebook cells short. For learners who want to see the moving parts, add an **appendix script in Deno** using AWS SDK v3: buildx push, then `CreateAgentRuntimeCommand` with `requireMMDSV2: true`, then `InvokeAgentRuntimeCommand`, then `DeleteAgentRuntimeCommand`. That script also serves as a fallback if the CLI's container flow fights a non-Node image.
3. **Observability: run a time-boxed spike first** (§6):
   - Deploy a hello-world Deno container, dump `Deno.env.toObject()` filtered to `OTEL_*`/`AGENT_*`/`AWS_*` to logs, and try (a) Deno native OTel with the injected env and (b) the OTel JS SDK with a SigV4 OTLP exporter.
   - If neither produces spans in the GenAI dashboard and evaluations, reconsider running the in-runtime agent on Node 22 (still TypeScript, still containerized or `NODE_22` zip, with ADOT JS as documented) and keep Deno for notebooks, tooling and the local OAuth server.
4. **OAuth callback server:** port it as a local `Deno.serve` app (§7). No runtime changes are needed.

## 9. Open risks

1. **GenAI observability and evaluations on Deno are undocumented.** No SigV4 exporter exists in Deno's native OTel, the ADOT Collector is unsupported, and ADOT JS relies on `require()` patching. Notebooks 09 and 11 depend on this. This is the top risk.
2. **AWS SDK v3 on Deno is not officially supported.** The riskiest part is the credential chain inside the microVM (MMDSv2) and SSO profiles locally.
3. **Strands TS SDK and the `bedrock-agentcore` TS SDK declare `engines.node`** (>=22 and >=20 respectively). Neither mentions Deno, so Deno compatibility is untested (Fastify/SSE/WebSocket, AsyncLocalStorage context, Playwright for browser tools).
4. **The npm AgentCore CLI may assume Node or Python in container mode.** `agentcore dev` injects a uvicorn dev layer, and the `entrypoint`/`runtimeVersion` fields may be validated. Deploying with a custom non-Node Dockerfile is plausible but not demonstrated.
5. **CDK `fromAsset` does not default to arm64.** Forgetting `platform: LINUX_ARM64` gives `exec format error` at runtime.
6. **Base image pulls in CodeBuild.** Docker Hub `denoland/deno` pulls may be rate-limited. Prefer `ghcr.io/denoland/deno` or mirror the image into ECR (the AWS templates already use `public.ecr.aws` mirrors for Node and Python). Also pin an exact Deno version.
7. **MMDSv2 is mandatory.** Any hand-rolled `CreateAgentRuntime` must set `metadataConfiguration.requireMMDSV2 = true`, or invocations fail with `ValidationException`.
8. **SSE parity.** Consumers in notebooks 05 and 08 parse the Python SDK's `data: <json>\n\n` framing. The Deno server must match it exactly and must not require `Accept: text/event-stream` (the TS SDK does require it).
9. **`/ping` semantics.** A hand-written server must report `HealthyBusy` during background work, and must not advance `time_of_last_update` on every ping, or sessions leak until `maxLifetime`.
10. **Numeric `USER` and permission flags.** Use `USER 1993` (not `deno`). Deno `--allow-*` flags that are too tight will fail only at runtime, so start with `-A` and narrow later.
11. **The ADOT version is stale in the Python course** (`>=0.10.1` vs the required `>=0.18.0` for unified telemetry). This is independent of the port, but it affects the baseline we compare against.
12. **The inbound JWT auth used in notebooks 05 and 08 blocks the SDK invoke path.** The Deno notebooks need a raw HTTPS `InvokeAgentRuntime` call with a bearer token.
