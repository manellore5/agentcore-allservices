# Port: notebook 08 and the final unified agent

Type: task
Status: open
Blocked by: 23

## Question

Port `08-final-integration.ipynb` and `backend/runtime/final_agent/` (`unified_travel_agent.py`, `identity_helper.py`, `requirements.txt` -> `deno.json`). The unified agent hand-rolls JSON-RPC to the gateway today; keep that behaviour or use `McpClient`, and log the choice.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
