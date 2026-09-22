# Port: notebook 11, the evaluations lab

Type: task
Status: open
Blocked by: 26

## Question

Port `11-agentcore_evaluations_lab.ipynb`: the toolkit `Evaluation` helper (listEvaluators, getEvaluator, createEvaluator, run, online config CRUD), `ObservabilityClient`, `display(Markdown)` -> `Deno.jupyter.md`, and `%store`.

On-demand evaluation is proven to work on a Deno agent. The online-evaluation half is not: resolve the ticket "Lab 11's online evaluation on a Deno agent" as part of this work, starting by comparing a Python agent's records in the same account against ours.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
