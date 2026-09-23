# Port: notebook 11, the evaluations lab

Type: task
Status: resolved
Blocked by: 26

## Question

Port `11-agentcore_evaluations_lab.ipynb`: the toolkit `Evaluation` helper (listEvaluators, getEvaluator, createEvaluator, run, online config CRUD), `ObservabilityClient`, `display(Markdown)` -> `Deno.jupyter.md`, and `%store`.

On-demand evaluation is proven to work on a Deno agent. The online-evaluation half is not: resolve the ticket "Lab 11's online evaluation on a Deno agent" as part of this work, starting by comparing a Python agent's records in the same account against ours.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commits ea21f38 (agent), merge, and e51ffe1.

**Ported:** `11-agentcore_evaluations_lab.ipynb`, 21 code cells, 1:1 with the Python. It writes its own `eval_agent_strands.ts` (notebook 09's inline zod calculator plus the lab's mock `get_weather`) and a `deno.json`, deploys through the toolkit `Runtime`, generates a 3-turn session, explores built-in evaluators, creates a custom LLM-as-a-judge evaluator with the 5-level scale byte-identical to the Python, runs session/trace/span-level evaluations, configures online evaluation, and cleans up. `%store` becomes `environments/evaluation_lab_config.json` plus notebook state.

**Verified live in 362249012325/us-east-1 — the lab's teaching point reproduced exactly:**
- Custom evaluator, per turn: math **Very Good (1.0)**, weather **Very Good (1.0)**, "capital of the United States" **Very Poor (0.0)** — a factually correct answer penalised by the scope rule, which is precisely what the lab is demonstrating.
- `Builtin.GoalSuccessRate` (session level): **Yes (1)**.
- Trace-level Correctness and span-level tool evaluators ran.
- Online evaluation config created and **ENABLED** (100% sampling, 5 evaluators), with its execution role auto-created.
- Cleanup deleted the online config, the custom evaluator and the runtime, and dropped the stale entry from `.bedrock_agentcore.json`.

**Bugs 18–19 in the Python original:**
18. The "save and verify results" cell has two dead variables: `save_results` is never read, and the file it re-opens is loaded and never read, so the verification only proves the file exists. The port reads both back and prints the totals.
19. **The lab is not re-runnable.** `create_evaluator` is called unconditionally, so a second run dies with `ConflictException: Evaluator with same name already exists` and every cell after it is skipped. The port creates or reuses. This one bit the live verification directly.

**A defect of my own, caught by the script-mode verification:** reading `Deno.jupyter` outside the kernel **throws** ("only available in `deno jupyter` subcommand") rather than returning undefined, so the `showMarkdown` guard never worked and the cells died before any evaluation ran. Fixed with a try/catch probe. Inside the kernel it would have worked, so running cells as a script is what exposed it.

**Online evaluation is still unproven**, as in the spike: the config creates and enables, but no results are produced synchronously and the lab points at the console for them. The cells are non-fatal and Part 6 carries a checklist. The decision stays with "Lab 11's online evaluation on a Deno agent", which remains open.

**Minor, kept verbatim:** the closing summary advertises a "Part 7" the notebook does not have (same class as notebook 10's phantom Part 8), and the READY loop has no timeout.
