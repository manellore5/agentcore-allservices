# Port: notebook 09, the observability lab

Type: task
Status: open
Blocked by: 24

## Question

Port `09-agentcore_observability_lab.ipynb`, including its `%store` usage (now the state file), its `subprocess` calls, and `ObservabilityClient.querySpansBySession`.

The spike proved a Deno agent's spans reach `aws/spans` with session.id and gen_ai attributes, so the lab's queries should work unchanged.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
