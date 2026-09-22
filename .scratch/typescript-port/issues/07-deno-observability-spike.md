# Spike: get a Deno agent's traces into CloudWatch GenAI observability

Type: task
Status: resolved
Blocked by:

## Question

Can a minimal Deno container agent on AgentCore Runtime produce traces that show up in CloudWatch GenAI observability the way the Python agent's do? Labs 09 and 11 depend on these traces. The agent is a `Deno.serve` app with `/invocations` + `/ping` making one Bedrock model call.

Try, time-boxed, in order:
1. Deno's built-in OpenTelemetry (`OTEL_DENO=true`) exporting to the endpoints the runtime configures.
2. ADOT JS / OpenTelemetry JS under Deno's Node compatibility.
3. A SigV4-signing OTLP exporter.

Also make live AWS calls from Deno with Strands TS + `bedrock-agentcore` TS + AWS SDK v3. The AgentCore SDK research already confirmed locally that they import and that `BedrockAgentCoreApp` serves under Deno, but no live calls were made. None of these packages list Deno as supported.

Resolved when you can state: which approach works, if any, and whether spans and sessions appear in the GenAI observability console and in the `ObservabilityClient`-style queries that lab 09 uses. Record any IDs and ARNs that later tickets need, and tear down what the spike created.

Background: `docs/research/deno-agentcore-deploy.md` on branch `research/deno-agentcore-deploy`.

Add to the live checks, from the Strands research:
- one live Bedrock call through `@strands-agents/sdk`
- a live AgentCore code-interpreter session
- a live browser session via Playwright `connectOverCDP` under Deno
- the Fastify-based `bedrock-agentcore/runtime` server running inside the deployed Deno container

## Answer

**Deno works, but only with our own SigV4 exporter. Deno's built-in OTel does not work.** Tested live in 362249012325/us-east-1 on 2026-09-22.

| Approach | Result |
|---|---|
| Deno built-in OTel (`OTEL_DENO=true`) in the runtime | **No spans.** The runtime injects no OTLP traces endpoint. |
| OTel JS SDK + SigV4-signed OTLP/protobuf exporter (service `xray`, `https://xray.us-east-1.amazonaws.com/v1/traces`) | **Works**, both locally and inside AgentCore Runtime. X-Ray returns 200 and the spans land in `aws/spans`. |
| ADOT JS under Deno | Not tried. The first working approach made it unnecessary. ADOT's `OTLPAwsSpanExporter` can't be imported (the package `exports` map blocks it), and its `./lite` entry is Lambda/UDP only. |

- **Spans look right for GenAI observability.** Strands TS emits `invoke_agent Strands Agent`, `chat`, `execute_tool <name>` and `execute_agent_loop_cycle` with `gen_ai.operation.name` and `gen_ai.system=strands-agents`. Every span carries `session.id` (copied from baggage by a small span processor) and the runtime's resource attributes: `service.name=<agent>.DEFAULT`, `cloud.resource_id=<runtime endpoint ARN>`, `aws.log.group.names`. A Logs Insights query on `aws/spans` filtered by `attributes.session.id`, as lab 09's ObservabilityClient does, returns the full trace. **Not checked visually:** the GenAI observability console page itself.
- **What the runtime injects, same for Deno and Python containers:** `AGENT_OBSERVABILITY_ENABLED=true`, `OTEL_RESOURCE_ATTRIBUTES=…`, `OTEL_EXPORTER_OTLP_LOGS_HEADERS=x-aws-log-group=/aws/bedrock-agentcore/runtimes/<id>-DEFAULT,x-aws-log-stream=otel-rt-logs,x-aws-metric-namespace=bedrock-agentcore`, `OTEL_EXPORTER_OTLP_TIMEOUT=5000`, plus Python-only `OTEL_PYTHON_*` values. There are no endpoint variables.
- **The stack runs live under Deno, locally and inside the runtime:**
  - a `@strands-agents/sdk` 1.18 agent on Haiku 4.5 with a zod tool
  - `CodeInterpreterTools` (executeCode)
  - `BrowserTools` via Playwright `connectOverCDP` (navigate + getText)
  - the Fastify-based `bedrock-agentcore/runtime` server
  - AWS SDK v3 `CreateAgentRuntime` / `GetAgentRuntime` / `InvokeAgentRuntime`
  
  The image is `denoland/deno:2.9.7` arm64, running as `USER 1993`.
- **Tooling note:** the local AWS CLI v2.35.16 has no `--metadata-configuration` option. SDK v3 3.1136.0 does, so the course's deploy path goes through SDK v3 or the npm CLI.
- **Not tested:** OTLP **logs** export, i.e. prompt/response content and events for lab 11 evaluations. The same SigV4 technique should apply (service `logs`, `https://logs.<region>.amazonaws.com/v1/logs` with the injected `x-aws-log-*` headers), but it is unverified.
- **Teardown done:** the 2 runtimes, ECR repo `ts-port-spike`, IAM role `ts-port-spike-runtime-role` and the runtime log groups are deleted. The spike spans remain in `aws/spans` until retention expires.

Asset: spike code on branch `research/deno-observability-spike`, `docs/research/spikes/deno-otel/` (commit 4a4094c).
