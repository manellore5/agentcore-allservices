# Spike: Deno agent traces in CloudWatch GenAI observability (2026-09-22)

Throwaway code from the spike ticket "Spike: get a Deno agent's traces into CloudWatch GenAI observability". It is kept for reference and is not production code. All AWS resources it created have been deleted.

- `telemetry.ts`: `TELEMETRY_MODE=sigv4` builds an OTel JS `BasicTracerProvider` whose exporter sends OTLP/protobuf, SigV4-signed with service `xray`, to `https://xray.<region>.amazonaws.com/v1/traces`. It reads `OTEL_RESOURCE_ATTRIBUTES` as injected by the runtime and copies `session.id` from baggage onto every span.
- `main.ts`: a `bedrock-agentcore/runtime` app with a Strands TS agent. `action` is `agent` (custom calculator tool), `ci` (CodeInterpreterTools) or `browser` (BrowserTools, which uses Playwright).
- `deploy.ts` / `invoke.ts`: AWS SDK v3 `CreateAgentRuntime` (with `metadataConfiguration.requireMMDSV2`) and `InvokeAgentRuntime`, run from Deno.
- `spans.sh`: a Logs Insights poller over `aws/spans`.
- `Dockerfile`: arm64 image based on `denoland/deno:2.9.7`, running as `USER 1993`.
