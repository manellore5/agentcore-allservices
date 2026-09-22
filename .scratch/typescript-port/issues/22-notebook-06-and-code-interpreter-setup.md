# Port: notebook 06 and code interpreter setup

Type: task
Status: open
Blocked by: 21

## Question

Port `06-code-interpreter.ipynb` (Strands agent with `CodeInterpreterTools`) and rebuild `backend/code_interpreter_setup.py` as `.ts` on the real `bedrock-agentcore` `CodeInterpreter` API, per the broken-originals decision. The Python source it sends *into* the sandbox stays Python; say so in a comment.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
