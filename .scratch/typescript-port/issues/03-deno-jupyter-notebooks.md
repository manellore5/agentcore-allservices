# Running the course notebooks as Deno TypeScript notebooks

Type: research
Status: resolved
Blocked by:

## Question

How do the 11 `.ipynb` notebooks run as TypeScript on Deno's Jupyter kernel, and what does that cost?

- Install/setup: `deno jupyter --install`. Does it still need a Python Jupyter install (JupyterLab / VS Code Jupyter extension)? What is the minimal setup that `setup.sh` could automate?
- Replacements for IPython features used here: `%store` (cross-notebook variables), `!` shell cells, `%` magics, `IPython.display.Markdown/display`, top-level await.
- Rich output: `Deno.jupyter` display APIs. What are the TS options for tables and charts in place of pandas, matplotlib and seaborn (e.g. nodejs-polars, Observable Plot, vega-lite through `Deno.jupyter`)?
- Known limitations or bugs of the Deno kernel that matter for a course.

Name the primary sources.

## Context pointer

Findings: branch `research/deno-jupyter`, file `docs/research/deno-jupyter.md`

## Answer

The notebooks run on Deno's Jupyter kernel through **VS Code + its Jupyter extension, with no Python needed**. `deno jupyter --install --force` writes the kernel spec itself. JupyterLab would still need Python, so the course supports VS Code only.

- Notebooks never use pandas, matplotlib or seaborn. They only appear in the deps and in Python sent to the Code Interpreter sandbox. Nothing to port there.
- IPython features actually used:
  - `%store` in 09 and 11, only to survive restarts
  - one `!uv add` in 07
  - `subprocess` in 01, 05, 09, 10 and 11
  - `%%writefile` in 02, 05 and 08, which writes the deployable agent code
  - `display(Markdown)` in 11
- Recommended: one shared helper module covering `.env` loading via `jsr:@std/dotenv`, a JSON state file in place of `%store`, a shell wrapper that prints captured output, and file writing. Use `Deno.jupyter.md` for display. Make cells safe to re-run.
- Risks:
  - Stop button kills the kernel (#24491)
  - child-process output is not shown (#20555)
  - adding a dependency mid-session can need a restart (#23218)
  - importing a local `.ts` helper may crash the kernel (#26816). Smoke-test this before relying on the helper.
- Other details: `deno jupyter` accepts no `--env-file`, config or permission flags, and every cell runs with full permissions. Pin Vega-Lite v5 if charts are ever needed.

Full findings with sources: branch `research/deno-jupyter`, `docs/research/deno-jupyter.md` (commit b064731).
