# Port: toolkit Runtime helper with CodeBuild deploy

Type: task
Status: open
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
