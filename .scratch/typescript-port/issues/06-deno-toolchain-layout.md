# Deno toolchain layout mirroring the uv setup

Type: grilling
Status: resolved
Blocked by: 05

## Question

What exact file layout and `setup.sh` flow reproduce today's uv setup on Deno?

- Is there one root `deno.json` (as the root `pyproject.toml` is shared) or a workspace with members for `tests/` and each deployable agent (as those have their own `pyproject.toml`/`requirements.txt` today)?
- `deno.lock` in place of `uv.lock`. What replaces `.python-version` for pinning the Deno version?
- Which step-for-step equivalents of `uv init / uv venv / uv add` does `setup.sh` run, including Jupyter kernel install?
- Tasks (`deno task`) for running agents, tests and deployment.
- `tsconfig`/`compilerOptions`, lint and fmt settings.

The output is a concrete layout that the first port ticket creates.

Fixed by the starter-toolkit decision: the AgentCore helpers live in `capstone_project/toolkit/` (with a `mod.ts`), shared by the notebooks and the backend. Still open here: where the notebook utilities and the in-container observability module live, and how agent build contexts (the zip uploaded to CodeBuild) include the observability module.

## Answer

Decided with the user on 2026-09-22.

**Layout** (replacing `pyproject.toml` + `uv.lock` + `.venv` + `.python-version` + per-agent `requirements.txt`):

```
deno.json            # root: import map with exact pins, tasks, compilerOptions
deno.lock            # committed, replaces uv.lock
.deno-version        # replaces .python-version; setup.sh installs/verifies it
setup.sh             # same steps as today, Deno versions of each
tests/deno.json      # mirrors tests/pyproject.toml
capstone_project/toolkit/        # AgentCore helper classes (starter-toolkit decision)
capstone_project/shared/observability.ts   # preloaded telemetry
capstone_project/shared/notebook.ts        # state file, shell wrapper, env loading, file writing
capstone_project/backend/runtime/simple_agent/{travel_agent.ts,deno.json}
capstone_project/backend/runtime/final_agent/{unified_travel_agent.ts,identity_helper.ts,deno.json}
capstone_project/backend/identity/runtime/{travel_agent_google_drive.ts,oauth2_callback_server.ts,deno.json,Dockerfile}
```

1. **Root config plus one per deployable agent.** Each agent folder's `deno.json` plays the role its `requirements.txt` plays today, so the folder stays independently deployable and the `%%writefile` cells still write an agent file plus its dependency file. `Runtime.configure` keeps both parameters. Pins are duplicated exactly as they are today; `deno task check:pins` verifies the agent configs agree with the root.
2. **Shared modules** live in `capstone_project/shared/`. The `Runtime` helper copies `observability.ts` into the build context when it zips an agent folder, which is how ADOT reaches the Python image as a pip dependency.
3. **`.deno-version`** mirrors `.python-version`, keeping the learner's Deno matching the `denoland/deno:2.9.7` image.
4. **`tests/` keeps its own `deno.json`**, with a root `deno task test` to run it.
5. **`misc/mcp.json` stays as is.** It is IDE configuration, and its servers ship for Python via `uvx` only. The README notes why this one file still mentions a Python tool.
6. **`setup.sh` steps:** install or verify Deno from `.deno-version`; `deno install` at the root (replacing `uv venv` + `uv add`); `deno jupyter --install --force` (replacing `ipykernel`); check the optional API keys as today; print the VS Code instructions.
7. **Tasks:** `test`, `check` (typecheck + lint), `fmt`, `check:pins`, `gateway:setup`, `oauth:server`, and `agent:<name>` per agent.
8. **Root settings:** `"nodeModulesDir": "auto"` (playwright and other npm packages need a real `node_modules`; this is what both spikes ran on), `strict: true`, and Deno's default lint and format settings.
