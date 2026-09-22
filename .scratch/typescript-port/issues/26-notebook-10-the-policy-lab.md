# Port: notebook 10, the policy lab

Type: task
Status: open
Blocked by: 25

## Question

Port `10-agentcore_policy_lab.ipynb`: the toolkit `GatewayClient` and `PolicyClient` helpers, the Lambda and IAM setup cells (AWS SDK v3), and the MCP client cell (`McpClient` from the Strands SDK, replacing `streamablehttp_client`). This notebook creates and deletes a Lambda function and IAM roles; keep the cleanup cells working.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
