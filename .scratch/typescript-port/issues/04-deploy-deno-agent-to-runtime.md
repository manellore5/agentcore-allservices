# Deploying a Deno/TypeScript agent to AgentCore Runtime

Type: research
Status: resolved
Blocked by:

## Question

What does it take to deploy a TypeScript agent running on Deno to Amazon Bedrock AgentCore Runtime, replacing today's Python `Dockerfile` + `requirements.txt` + `agentcore launch` flow?

- The runtime's container contract: port, `/invocations`, `/ping`, arm64, and the streaming response format.
- A Deno base image, and how dependencies are cached in the image.
- Direct-code (zip) deployment vs container deployment. Is there a Node or TS direct-code runtime?
- Whether deployment can happen without the Python `agentcore` CLI, e.g. AWS SDK v3 `CreateAgentRuntime` + ECR push or CDK.
- Observability: ADOT/OpenTelemetry for Node/Deno, so traces appear in CloudWatch GenAI observability as they do with Python `opentelemetry-instrument`.
- The OAuth callback server (`oauth2_callback_server.py`, FastAPI + uvicorn) needs a Deno HTTP equivalent. Does it need anything runtime-specific?

Name the primary sources.

## Context pointer

Findings: branch `research/deno-agentcore-deploy`, file `docs/research/deno-agentcore-deploy.md`

## Answer

**Deploy as a container.** A linux/arm64 image built from `denoland/deno:2.9.7` runs a hand-written `Deno.serve` app. It serves `POST /invocations` (SSE `data: <json>\n\n`, matching the Python SDK) and `GET /ping` on 0.0.0.0:8080. Dependencies are cached with `deno ci --prod` + `deno cache`, and the image runs as `USER 1993`.

- **Deploy tooling:** by default the official npm CLI `@aws/agentcore` in `"build": "Container"` mode (CodeBuild). As a fallback, AWS SDK v3 `CreateAgentRuntimeCommand` plus an ECR push; it must set `metadataConfiguration.requireMMDSV2: true`. The Python starter toolkit is not needed for deploying.
- **Direct-code zip is not possible on Deno.** The managed runtimes are Python 3.10–3.14 and `NODE_22` (`.js` entry point) only.
- **OAuth callback server:** it runs locally, not in the runtime. It becomes a `Deno.serve` app on 127.0.0.1:9090 that calls `CompleteResourceTokenAuthCommand`. Nothing runtime-specific.
- **Biggest risk is observability.** Nothing documented gets Deno traces into CloudWatch GenAI observability. Deno's OTel doesn't sign OTLP with SigV4, ADOT for Node relies on patching `require()`, and the ADOT Collector is unsupported. Labs 09 and 11 depend on these traces. The fallback is Node 22 TS + ADOT inside the runtime.
- **Other risks:**
  - AWS SDK v3, Strands TS and the agentcore TS SDK don't officially list Deno.
  - `agentcore dev` adds a uvicorn dev layer, which may not suit a Deno container.
  - Docker Hub pulls in CodeBuild may be rate-limited; prefer ghcr.io.
  - Unified telemetry needs ADOT >=0.18.
  - JWT inbound auth (notebooks 05 and 08) needs a raw HTTPS invoke.

Full findings with sources (unconfirmed claims marked UNVERIFIED): branch `research/deno-agentcore-deploy`, `docs/research/deno-agentcore-deploy.md` (commit bb2c52a).
