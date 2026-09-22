# Spike 2: preloaded telemetry, OTLP logs and evaluations on Deno (2026-09-22)

Throwaway code from the ticket "Spike: OTLP logs export and --preload telemetry on Deno". All AWS resources it created have been deleted.

- `observability.ts` is loaded with `deno run --preload observability.ts agent.ts` and needs no agent-code changes. It does the following:
  - Traces go to X-Ray OTLP and logs to CloudWatch Logs OTLP (`/v1/logs` with the runtime-injected `x-aws-log-group` / `x-aws-log-stream`). Both are SigV4-signed.
  - `session.id` is set by wrapping `node:http.createServer`, which Fastify, and therefore `BedrockAgentCoreApp`, uses.
  - A span processor turns Strands `gen_ai.*.message` / `gen_ai.choice` span events into `{input, output}` log records.
- `agent.ts` is the agent with no telemetry code.
- `eval.ts` runs on-demand `Evaluate` with spans from `aws/spans` plus the runtime logs, the same input the Python toolkit's `Evaluation.run` builds.
- `online.ts` creates an online evaluation config and invokes the agent once.
