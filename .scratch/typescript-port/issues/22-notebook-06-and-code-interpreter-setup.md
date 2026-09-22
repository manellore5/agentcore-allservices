# Port: notebook 06 and code interpreter setup

Type: task
Status: resolved
Blocked by: 21

## Question

Port `06-code-interpreter.ipynb` (Strands agent with `CodeInterpreterTools`) and rebuild `backend/code_interpreter_setup.py` as `.ts` on the real `bedrock-agentcore` `CodeInterpreter` API, per the broken-originals decision. The Python source it sends *into* the sandbox stays Python; say so in a comment.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commit 470f4fe.

**`code_interpreter_setup.py` rebuilt, not translated.** It could never run: it imported `bedrock_agentcore.services.code_interpreter.CodeInterpreterClient`, which exists in no SDK version, and called `create_runtime`, `execute_code` and `list_runtimes`, none of which exist. AgentCore has **no code-interpreter runtime to create** — you start a *session* against the built-in interpreter and execute code in it. `code_interpreter_setup.ts` keeps the intent: start a session, run the travel-budget capability check, report, stop the session in a `finally` block (sessions are billed while alive).

The check's code stays **Python**, per the dependency-mapping decision: the sandbox is a Python execution service and showing that is the lesson. The module comment says so. The Python original's matplotlib chart is dropped, since nothing consumed the saved PNG; the DataFrame breakdown it also computed is kept.

**Notebook 06** is 8 code cells: `CodeInterpreterTools` from `bedrock-agentcore/experimental/code-interpreter/strands` wired into a Strands agent, the four original analysis prompts, an added cell that stops the session, and the saved config.

**Verified live in 362249012325/us-east-1:**
- `code_interpreter_setup.ts` started session `01M35J3ZKZ2J5T1BYZ1NVS9SW6`, and the sandbox reported pandas 2.3.1 / numpy 1.26.4 and printed the budget breakdown. Session stopped.
- The notebook's four prompts (budget breakdown, cost comparison, savings/compound interest, hotel-price statistics) all ran through the sandbox and returned real computed numbers.

**Tooling fix:** `deno fmt`'s `include` list alone did **not** stop it reformatting `.ipynb` files and the third-party OpenAPI specs — it had silently rewritten unicode escapes in notebook 01 and reflowed the specs. `deno.json` now carries an explicit `fmt.exclude` for `**/*.ipynb`, the `openapi_specs/` folder and `environments/`. The earlier note "run fmt from the repo root only" is superseded: it is safe anywhere now.

**Added to .gitignore:** `code_interpreter_config.json` and `code_interpreter_info.json`, both generated at runtime.
