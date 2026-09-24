# mastering-amazon-bedrock-agentcore

A TypeScript/Deno port of the Python course at
<https://github.com/puria-izady/mastering-amazon-bedrock-agentcore> (the `origin` remote).
Deno replaces Python everywhere: the notebooks run on the Deno Jupyter kernel, and
`capstone_project/toolkit/` reimplements the Python `bedrock-agentcore-starter-toolkit`
on the AWS SDK v3.

Commands live in `deno.json` — run `deno task` to list them.

## The Python original is the acceptance criterion

The port is judged cell by cell: each TypeScript notebook cell should produce what the
equivalent Python cell produced. When a report starts "in the original Python we saw X",
treat X as evidence of intended behaviour and go find what the port lost — a dropped
helper, a missing import, output going somewhere Jupyter cannot show.

Reproduce before explaining. Reasoning from first principles about why a difference is
expected has been wrong every time it has been tried here; running the cell settles it in
one step.

## Running a cell outside Jupyter

A scratch script must sit **inside the repo** to resolve bare specifiers — `deno.json`'s
import map does not reach a file in `/tmp`, which fails as `Import "zod" not a dependency`.
Write `./.scratch-name.ts`, run it, delete it.

To execute real notebook cells, drive the registered `deno` kernelspec with `nbclient`
(`jupyter` itself is not installed; Jupyter runs inside VS Code). Slice `nb.cells` to the
range under test and execute in memory, so the notebook file keeps its committed state.

## The kernel only shows `console.log`

The Deno kernel forwards `console.log` to the cell. Anything written straight to stdout —
`process.stdout.write`, a child process ([denoland/deno#20555](https://github.com/denoland/deno/issues/20555)) —
lands in the terminal that launched Jupyter, where a notebook reader never looks.

This silently swallows library output that looks fine in a terminal. Two helpers in
`capstone_project/shared/notebook.ts` exist only to route it back: `sh()` re-prints what a
subprocess wrote, and `traceTools()` re-emits the tool calls that Strands' own printer
sends to stdout. Reach for the same fix when new library output goes missing.

## VS Code holds its own copy of a notebook

Editing an open `.ipynb` on disk does not reach VS Code's in-memory model, and Restart
Kernel re-runs the stale cells it still holds. After an external edit, close the notebook
tab and reopen it (or `File → Revert File`), then restart the kernel.

## Bedrock model access is narrower than the model list

Every notebook pins `us.anthropic.claude-sonnet-4-6`. This account has **no** access to
`us.anthropic.claude-sonnet-5` — invoking it returns
`AccessDeniedException: ... is not available for this account`.

`aws bedrock list-inference-profiles` reports profiles as `ACTIVE` whether or not the
account is entitled to them, so it cannot answer "can I use this model". Confirm with a
real call before changing a model ID repo-wide:

```bash
aws bedrock-runtime converse --region us-east-1 --model-id <id> \
  --messages '[{"role":"user","content":[{"text":"hi"}]}]' \
  --inference-config '{"maxTokens":1}'
```

The ID is pinned in 20 places across notebooks, the three deployable agents, the docs, and
two gitignored generated files (`notebooks/.bedrock_agentcore.json`,
`backend/browser_tools_info.json`). A repo-wide `grep` is gitignore-aware and skips those
two — check them by path.

## Cells that cost money or overwrite sources

Run a notebook top-to-bottom only when that is the intent:

- `writeFile(...)` cells regenerate the agent folders under `capstone_project/backend/`,
  overwriting hand edits. In notebook 02 these are cells 13, 14 and 25.
- `runtime.launch()` runs a real arm64 CodeBuild and creates live AWS resources, taking
  5–10 minutes. It appears in notebooks 02 (cell 17), 05, 08 and 09.

To exercise the local-agent portion of notebook 02, stop after cell 9.

## Conventions

- **Notebooks are committed without outputs.** Every notebook at `HEAD` has zero stored
  outputs; running cells makes a notebook dirty, so clear outputs before committing.
- **Ports log their divergences.** `capstone_project/toolkit/runtime.ts` ends with a
  numbered list of every deliberate difference from the Python class. Extend that list
  rather than leaving a difference undocumented.
- **Secrets never reach a notebook output** — `maskKey()` exists because outputs get
  committed.
