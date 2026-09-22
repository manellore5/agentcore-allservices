# Deno or Node 22 for the code that runs inside AgentCore Runtime

Type: grilling
Status: resolved
Blocked by: 07

## Question

Given the observability spike's result, do the deployed agents (simple agent, Google Drive agent, final unified agent, lab agents in 09–11) run on Deno, as chosen for the rest of the repo, or on Node 22 TypeScript with ADOT?

If Node: how does that sit alongside Deno for notebooks, tooling and the local OAuth server? Consider two toolchains in one repo, shared code between them, and what "only the language changes" means for the course. Would the Node path also open up direct-code zip deployment (`NODE_22`)?

Input from the observability spike:
- Deno works in the runtime when the repo owns about 100 lines of telemetry setup: an OTel JS SDK provider, a SigV4 OTLP span exporter, and a session.id processor.
- Node 22 would get this from official ADOT with zero code, and could also use `NODE_22` zip deploy.
- Unresolved on both sides: OTLP logs for lab 11 evaluations. Deno needs a signed log exporter too; Node ADOT does it automatically.

## Answer

Decided with the user on 2026-09-22.

1. **Deno everywhere, including inside AgentCore Runtime.** There is no Node toolchain in the repo. Deployment is by container, since Deno has no zip path.
2. **Server:** `BedrockAgentCoreApp` from `bedrock-agentcore/runtime` is the direct counterpart of the Python class, and it was proven on Deno in the spike. Local-testing cells must send the session-id header and `Accept: text/event-stream` for streaming handlers.
3. **Telemetry is invisible to agent code, as with Python's `opentelemetry-instrument`.** It is loaded through `deno run --preload <observability module>` in the container `CMD`. If a preloaded module can't register the global tracer before the SDKs load, fall back to a one-line `import` at the top of each agent, explained in lab 09.
4. **One shared observability module** holds the SigV4 OTLP span exporter, the session.id processor and resource attributes from the injected env (see the spike). Every agent's container build context includes it; the mechanics belong to the toolchain-layout ticket.
5. **Lab 11 log export:** first a time-boxed attempt at SigV4-signed OTLP logs on Deno, using service `logs` and the injected `x-aws-log-*` headers. If it fails, **only the lab 11 evaluation agent** runs on Node 22 with ADOT, as a contained exception.
