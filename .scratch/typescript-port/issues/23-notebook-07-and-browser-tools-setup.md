# Port: notebook 07 and browser tools setup

Type: task
Status: open
Blocked by: 22

## Question

Port `07-browser-tools.ipynb` (Strands agent with `BrowserTools` over Playwright) and rebuild `backend/browser_tools_setup.py` as `.ts` on the real `Browser` API.

The TS browser tool has 7 actions against Python's ~22; check which the notebook actually needs and record any gap here. Replace the `!uv add` cell per the notebook helper's conventions.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
