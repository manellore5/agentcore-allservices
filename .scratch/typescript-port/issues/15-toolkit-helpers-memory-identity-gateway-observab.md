# Port: toolkit helpers (memory, identity, gateway, observability, evaluation, policy)

Type: task
Status: open
Blocked by: 14

## Question

Write `capstone_project/toolkit/{memory,identity,gateway,observability-client,evaluation,policy}.ts` plus `mod.ts`, on AWS SDK v3, mirroring the Python starter-toolkit classes per the starter-toolkit decision: same class names, camelCase methods, options objects mirroring the Python kwargs, same return shapes.

Port from the toolkit's own Python source for behaviour (polling, key normalisation, `Evaluation.run`'s span filtering and runtime-log fetch, `GatewayClient`'s Cognito setup). `deno test` covers the pure logic only; the live verification happens in each notebook's ticket.

Note from the spike: `Evaluation.run` should not filter on the instrumentation scope name alone, since Strands TS differs from Python there unless the observability module renames it.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
