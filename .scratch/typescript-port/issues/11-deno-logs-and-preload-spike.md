# Spike: OTLP logs export and --preload telemetry on Deno

Type: task
Status: resolved
Blocked by:

## Question

The Deno-or-Node decision left two things to verify with live AWS, using the spike code on branch `research/deno-observability-spike` as the starting point:

1. **`--preload` telemetry.** With `deno run --preload observability.ts main.ts`, does the preloaded module register the global tracer provider and context manager before `@strands-agents/sdk` and `bedrock-agentcore` load, so their spans still export with `session.id`? And does it stay invisible to agent code, given that `session.id` currently comes from a wrapper around the handler? It might come from a Fastify hook or the request context instead.
2. **OTLP logs for lab 11 evaluations.** Can Deno send SigV4-signed OTLP logs (service `logs`, `https://logs.<region>.amazonaws.com/v1/logs`, with the runtime-injected `x-aws-log-group` / `x-aws-log-stream` headers) carrying the prompt/response content that AgentCore Evaluations reads? Run one on-demand evaluation (`Evaluate`, a built-in evaluator) against a Deno-agent session and confirm it scores. Also note where Strands TS puts message content: span events, attributes or logs.

This is time-boxed. If logs can't be made to work, record that; the fallback is already decided (Node 22 + ADOT for the lab 11 agent only). The agent drives it with the user's AWS account; confirm with the user before creating resources, and tear down afterwards.

Resolved when you can state: whether `--preload` works (otherwise use the import fallback), and whether evaluations score a Deno agent (otherwise use the Node fallback for lab 11).

## Answer

Run live in 362249012325/us-east-1 on 2026-09-22. Three of four checks passed; online evaluation is unverified.

1. **`--preload` works.** `deno run --preload observability.ts agent.ts` registers the tracer, the logger and the context manager before the SDKs load. The agent file contains no telemetry code at all. `session.id` reaches every span because the preloaded module wraps `node:http.createServer` (used by Fastify, and so by `BedrockAgentCoreApp`) and runs each request in an OTel context with the session id in baggage. The `getContext()` helper is not exported by the package, so the HTTP wrapper is the way in. **The fallback import is not needed.**
2. **OTLP logs work.** SigV4-signed OTLP/protobuf to `https://logs.<region>.amazonaws.com/v1/logs` with the injected `x-aws-log-group` / `x-aws-log-stream` headers lands in the runtime's `otel-rt-logs` stream. A span processor converts Strands `gen_ai.*.message` and `gen_ai.choice` span **events** into one log record per span with an `{input: {messages}, output: {messages}}` body, matching what ADOT produces for Python.
3. **On-demand evaluations work.** `Evaluate` with `evaluationInput.sessionSpans` built like the Python toolkit's `Evaluation.run` (spans from `aws/spans` by `attributes.session.id`, plus runtime logs by traceId) scored a Deno agent session: `Builtin.Helpfulness` 0.83 and 0.33, `Builtin.GoalSuccessRate` 0. The explanations quote the real conversation, including correctly marking down a turn where the agent had lost context. **Instrumentation scope did not matter**, and spans alone were enough, since Strands TS keeps message content in span events.
4. **Online evaluation: unverified, not disproven.** An online config (ACTIVE/ENABLED, 100% sampling, `Builtin.Helpfulness`, data source = runtime log group + `serviceNames: ["<agent>.DEFAULT"]`, toolkit-shaped execution role) produced **no results** in ~37 minutes, well past the 15-minute idle timeout. Its dedicated results log group stayed empty with no streams. Spans and logs for those sessions were present with the matching `service.name`, `cloud.resource_id` and `session.id`.
   - **Ruled out:** the instrumentation scope name. A retest registered the Strands tracer as `strands.telemetry.tracer` (confirmed in `aws/spans`) and still produced nothing.
   - **Still open:** whether the service needs longer, a different log-record shape, spans in the runtime log group rather than only `aws/spans`, or something else.
5. **Also confirmed:** `UpdateAgentRuntime` with a new image works from Deno via SDK v3.

**Teardown done and verified:** runtime, online config, ECR repo, both IAM roles and all three log groups are deleted.

Asset: spike code on branch `research/deno-observability-spike`, `docs/research/spikes/deno-otel-logs/` (commits 8238cf3, 2318fc0).
