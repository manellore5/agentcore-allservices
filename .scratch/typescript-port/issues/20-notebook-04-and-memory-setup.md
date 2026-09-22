# Port: notebook 04 and memory setup

Type: task
Status: open
Blocked by: 19

## Question

Port `04-memory-implementation.ipynb` and `backend/memory/memory_setup.py`, using the toolkit `MemoryClient` (createMemoryAndWait, listMemories, getMemoryStrategies, createEvent, retrieveMemories).

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
