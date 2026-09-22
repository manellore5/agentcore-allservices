# Port: notebook 02 and the simple agent

Type: task
Status: open
Blocked by: 15, 16, 17

## Question

Port `02-runtime-setup.ipynb` and `backend/runtime/simple_agent/` (`travel_agent.py` -> `.ts`, `requirements.txt` -> `deno.json`). The notebook's `%%writefile` cells must generate the Deno agent using `BedrockAgentCoreApp`, with no telemetry code in the agent file.

This is the first live test of the `Runtime` helper: configure, launch through CodeBuild, status, invoke.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
