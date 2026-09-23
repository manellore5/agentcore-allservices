# Port: notebook 09, the observability lab

Type: task
Status: resolved
Blocked by: 24

## Question

Port `09-agentcore_observability_lab.ipynb`, including its `%store` usage (now the state file), its `subprocess` calls, and `ObservabilityClient.querySpansBySession`.

The spike proved a Deno agent's spans reach `aws/spans` with session.id and gen_ai attributes, so the lab's queries should work unchanged.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commit 9efdb09.

**Ported:** `09-agentcore_observability_lab.ipynb`, 13 code cells. The lab is self-contained: it generates its own agent (`observability_lab_agent.ts` plus a `deno.json`) into `backend/observability/`, deploys through the toolkit `Runtime`, invokes it three times in one session (the third carrying a custom `traceParent`, `traceState` and `baggage`), queries spans back through `ObservabilityClient.querySpansBySession`, lists the runtime's CloudWatch log groups, prints the console lookup values, and deletes the runtime and the generated files at the end. The `uv pip install` cell becomes a note plus a `deno --version` check.

The lab agent needs a **calculator**, which Strands TypeScript does not ship, so the generated agent defines one inline with a zod schema — the approach the dependency mapping chose.

**Verified live in 362249012325/us-east-1:** the agent built, deployed, reached READY, and the three invocations produced **9 spans across 2 traces** for the session (18 by the time ingestion finished). Span names are the Strands ones: `invoke_agent Strands Agent`, `chat`, `execute_agent_loop_cycle`, `execute_tool calculator`, `execute_tool get_weather`. The runtime was deleted by the cleanup cell.

**This closes the loop opened by the observability spike.** A Deno agent's spans, exported by our own preloaded telemetry module with a hand-written SigV4 OTLP exporter, are queryable by the course's own `ObservabilityClient`. The spike proved the spans reached `aws/spans`; this proves the lab's own queries find them.

**Bug in my first draft, caught by the live run:** the summary cell read `span.name`, but our `Span` exposes `spanName` (the query aliases `name as spanName`). Span names printed as an empty list. Fixed and re-verified against the same session's spans. Python's helper tried `name`/`spanName`/`span_name` in turn, which is why the original never hit this.

**Note:** the lab's ECR repository is left behind, as in the Python original — its cleanup removes the runtime and local files only.
