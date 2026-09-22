# Running the capstone notebooks as TypeScript on Deno's Jupyter kernel

Research ticket: how would the 11 notebooks in `capstone_project/notebooks/*.ipynb` run as TypeScript on
Deno's Jupyter kernel, and what does it cost?

- Researched: 2026-09-22. Latest Deno release at time of writing: **v2.9.7** (GitHub releases API,
  `repos/denoland/deno/releases/latest`).
- Sources are primary: docs.deno.com, `denoland/deno` source on `main`, `denoland/deno` and
  `denoland/vscode_deno` issues, jupyter-client docs, VS Code / vscode-jupyter docs, and JSR/npm package pages.
  Issue states were checked on the research date.

## TL;DR

1. **You do not need Python if students use VS Code.** `deno jupyter --install` writes a kernelspec file
   itself and never calls the `jupyter` CLI. VS Code's Jupyter extension finds non-Python kernelspecs on disk
   and starts them directly over ZeroMQ. JupyterLab or classic Notebook still needs a Python install.
2. **The notebooks use few IPython features.** There is one `!` shell cell, 7 `%%writefile` cells, 11 `%store`
   lines (in 2 notebooks), `IPython.display.Markdown` in 1 notebook, and no top-level `await`. Each has a
   straightforward TS replacement.
3. **pandas, matplotlib and seaborn are never used in any notebook.** They are listed in `setup.sh` and
   `pyproject.toml`. The only code that uses them is Python that `capstone_project/backend/code_interpreter_setup.py`
   sends to run *inside* the AgentCore Code Interpreter sandbox, so it stays Python. No charting library
   has to be ported.
4. **The main costs** are these kernel limitations:
   - every cell runs with `--allow-all`
   - `deno jupyter` accepts no `--env-file`, config or permission flags
   - pressing Stop crashes the kernel and loses all state (open issue)
   - VS Code shows false "undefined variable" errors across cells (open issue)
   - output from child processes is not captured, only `console.*`
   - changing dependencies can require a full restart

## 1. Install and setup

### What `deno jupyter --install` actually does

- The docs say: "Run `deno jupyter` and follow the instructions. You can run `deno jupyter --install` to force
  installation of the kernel. Deno assumes that `jupyter` command is available in your `PATH`."
  ([docs.deno.com/runtime/reference/cli/jupyter](https://docs.deno.com/runtime/reference/cli/jupyter/))
- The source shows the installer does **not** call `jupyter`. `install.rs` works out the user data dir from
  platform env vars and writes `kernels/<name>/kernel.json` plus three logo files. The paths are
  `$HOME/Library/Jupyter` on macOS, `$APPDATA/jupyter` on Windows, and `$XDG_DATA_HOME/jupyter` or
  `~/.local/share/jupyter` on Linux.
  ([cli/tools/jupyter/install.rs](https://github.com/denoland/deno/blob/main/cli/tools/jupyter/install.rs))
  The kernelspec it writes is:
  ```json
  { "argv": ["<deno exe>", "jupyter", "--kernel", "--conn", "{connection_file}"],
    "display_name": "Deno", "language": "typescript" }
  ```
- CLI flags, from the parser definition
  ([libs/cli_parser/src/defs.rs](https://github.com/denoland/deno/blob/main/libs/cli_parser/src/defs.rs),
  `JUPYTER_SUBCOMMAND`):
  - `--install`
  - `-n/--name` (kernel name, default `deno`)
  - `-d/--display` (display name, default `Deno`)
  - `--force` (overwrite an existing kernelspec)
  - `--kernel` and `--conn` (used internally when Jupyter launches the kernel)

  The code comment says the subcommand "exposes only its own flags (no runtime/permission/compile groups)".
  Only the unstable-feature flag groups are attached.
- Running plain `deno jupyter` (no flags) only prints install status (`install::status`). Without `--force`,
  re-installing fails with "Deno kernel already exists at …, run again with `--force` to overwrite it"
  ([cli/tools/jupyter/mod.rs](https://github.com/denoland/deno/blob/main/cli/tools/jupyter/mod.rs), install.rs).
- The kernel prints `Warning "deno jupyter" is unstable and might change in the future.` on start (mod.rs).
  The `Deno.jupyter` API is marked unstable too ([Deno.jupyter API ref](https://docs.deno.com/api/deno/~/Deno.jupyter)).

### Does it still need Python Jupyter?

| Front end | Python needed? | Evidence |
|---|---|---|
| **VS Code + Jupyter extension** | **No** | vscode-jupyter says non-Python global kernels are found on the file system and "To find these kernels we don't need the Python runtime at all" ([wiki: Kernel Discovery & Execution](https://github.com/microsoft/vscode-jupyter/wiki/General-overview-of-Kernel-Discovery-&-Execution-in-Jupyter-(&-extension))). Raw kernels are launched from the kernelspec `argv` over ZeroMQ, and "Some kernels don't need python at all" ([wiki: Raw vs Jupyter Kernels](https://github.com/microsoft/vscode-jupyter/wiki/Raw-vs-Jupyter-Kernels)). Deno docs: "Install the VSCode Jupyter extension … select Deno from kernel options" ([Deno docs](https://docs.deno.com/runtime/reference/cli/jupyter/)). |
| **JetBrains IDEs** | Not stated | Deno docs: "Jupyter Notebooks are available right out of the box" ([Deno docs](https://docs.deno.com/runtime/reference/cli/jupyter/)). |
| **JupyterLab / classic Notebook / `jupyter console`** | **Yes** | Deno's launch post says "start by installing Jupyter - this command assumes Python and pip are installed on your system. `pip install jupyterlab`" ([deno.com/blog/v1.37](https://deno.com/blog/v1.37)). Issue [#20744](https://github.com/denoland/deno/issues/20744) asked for an install without Python Jupyter. It is closed, and the source above now writes the kernelspec directly, but the JupyterLab server itself is still Python. |

The vscode-jupyter wiki also says VS Code falls back to a Jupyter server for remote connections and
platforms where ZeroMQ native modules don't ship. That is the only case where VS Code users would need Python
([Raw vs Jupyter Kernels](https://github.com/microsoft/vscode-jupyter/wiki/Raw-vs-Jupyter-Kernels)).

### Minimal `setup.sh` (what can be automated)

```bash
#!/usr/bin/env bash
set -euo pipefail
# 1. Deno (pin a version; install.sh takes a positional version and -y / --no-modify-path)
command -v deno >/dev/null || curl -fsSL https://deno.land/install.sh | sh -s -- -y v2.9.7
export PATH="${DENO_INSTALL:-$HOME/.deno}/bin:$PATH"
# 2. Kernelspec (idempotent thanks to --force; also repairs a stale deno path after upgrades)
deno jupyter --install --force
# 3. Pre-cache npm/jsr deps so the first cell run isn't a long download (deps from deno.json)
deno install
# 4. Optional: VS Code extensions
command -v code >/dev/null && code --install-extension ms-toolsai.jupyter && code --install-extension denoland.vscode-deno || true
```

Sources and notes for each step:

- **Install commands and flags.** The install command and `brew install deno` come from the
  [installation docs](https://docs.deno.com/runtime/getting_started/installation/). The `-y/--yes`,
  `--no-modify-path` and positional-version handling come from `https://deno.land/install.sh`, which was read
  directly.
- **Why use `--force`.** A recent `install.rs` comment says `std::env::current_exe()` used to resolve Homebrew
  symlinks into a versioned `Cellar/deno/<version>/bin/deno` path. That path "stops existing after an upgrade,
  leaving the kernel pointing at a missing binary". Current source writes a stable path. Re-running
  `--install --force` also repairs kernelspecs written by older versions.
- **`JUPYTER_PLATFORM_DIRS=1` (open issue [#27984](https://github.com/denoland/deno/issues/27984)).** The
  installer ignores this variable and still writes to `~/Library/Jupyter/kernels` on macOS. If a student has
  set it, JupyterLab won't find the kernel. `setup.sh` should unset it or warn about it.
- **Environment variables for the kernel.** The kernelspec format allows an optional
  `"env": {…}` "dictionary of environment variables to set for the kernel"
  ([jupyter-client: kernel specs](https://jupyter-client.readthedocs.io/en/stable/kernels.html)).
  Deno doesn't write one, but `setup.sh` could patch `kernel.json` to add, say, `AWS_REGION`. Use this only
  for non-secret values, because the file lives in the user's Jupyter data dir.

## 2. IPython features used in the notebooks, and their replacements

### Inventory

I grepped every code cell of all 11 notebooks. Cell indices are 0-based positions in `cells[]`.

| Feature | Where it occurs | Notes |
|---|---|---|
| `%store` / `%store -r` | `09-agentcore_observability_lab` c8 (`%store launch_result`)<br>`11-agentcore_evaluations_lab` c7, c9, c15, c24 (store `launch_result`, `session_id`, `evaluator_id`, `online_config_id`)<br>`11` c17, c28 (`%store -r` of the same names) | **No notebook reads another notebook's `%store` value.** Notebook 10 never mentions `launch_result`, and 11 stores and restores its own values. So `%store` is only used here to survive kernel restarts. It needs `pickleshare`, which is in `pyproject.toml`. The other notebooks already pass state between notebooks through JSON files: `environments/*_info.json`, `observability_lab_config.json`, `policy_lab_config.json`. |
| `!` shell | `07-browser-tools` c3: `!uv add bedrock-agentcore strands-agents strands-agents-tools playwright nest-asyncio` | Only one. |
| `subprocess` (acts like a shell cell) | `01-foundation` c8 (`uv --version` env check)<br>`05-identity-oauth` c3 (imported, not used)<br>`09`, `10`, `11` c2 (`uv pip install` / `pip install` bootstrap) | These become `deno install` / `deno.json` deps, or `Deno.Command` for the env check. |
| `%%writefile` cell magic | `02` c13, c14<br>`05` c11, c13, c15<br>`08` c12, c16<br>(`09` and `11` c6 write files with `open()` instead) | These write **Python agent source and `requirements.txt`** that get deployed to AgentCore Runtime. In a TS port they become `Deno.writeTextFile(path, \`…\`)`. Whether the deployed agent itself becomes TS is a separate decision that this ticket doesn't cover. |
| Other `%` line magics | none | |
| `IPython.display.Markdown` / `display` | `11` c4 (import)<br>`11` c18, c19, c20, c21 (`display(Markdown(f"""…"""))`) | Formatted evaluation reports. |
| Top-level `await` | none in notebook code | The only `await`/`asyncio` lines are inside the `%%writefile` payload in `05` c13, so they are file content. `nest-asyncio` is only pip-installed (`07` c3, `08` c16 requirements). A TS port will add top-level `await` almost everywhere, because AWS SDK for JS calls return Promises. |
| `.env` loading | `01` c4, `02` c3, `03` c3, `04` c4, `07` c4: `from dotenv import load_dotenv; load_dotenv()`<br>`os.environ[...] =` in every notebook's first cells | See section 4. |
| pandas / matplotlib / seaborn | **none in notebooks** | Declared in `setup.sh` (`uv add … pandas numpy matplotlib seaborn …`) and `pyproject.toml`. Used only in `capstone_project/backend/code_interpreter_setup.py`, as a package list and a Python test string for the AgentCore Code Interpreter sandbox (`client.execute_code(runtime_id, test_code)`). That code runs remotely in Python and is not ported. |
| Rich outputs saved in notebooks | none | Every notebook has zero saved outputs, so no image or HTML outputs need reproducing. |

### Replacement details

- **Top-level `await`.** The kernel supports it. The official examples use it directly in cells, for example
  `let p = await penguins();` and `await Deno.jupyter.broadcast(...)`
  ([Deno docs](https://docs.deno.com/runtime/reference/cli/jupyter/)). There was an old VS Code bug where
  async results showed stale or pending values ([#22689](https://github.com/denoland/deno/issues/22689),
  Deno 1.41). It is **closed**.
- **`display(Markdown(...))`.** Replace with `Deno.jupyter.md` tagged templates:
  ``Deno.jupyter.md`## Results for ${id}` ``. The value renders when it is the last expression of a cell. To
  render mid-cell, use `await Deno.jupyter.display(Deno.jupyter.md`…`)`. `display(obj, {raw: true})`
  "Mimics the behavior of IPython's `display(obj, raw=True)`". Also available: `html`, `svg`, `image`,
  `format`, `broadcast`, and `$display`
  ([Deno.jupyter API](https://docs.deno.com/api/deno/~/Deno.jupyter),
  [jupyter_display example](https://docs.deno.com/examples/jupyter_display/)).
  **Caveat:** "`Deno.jupyter` only exists under the `deno jupyter` subcommand, not `deno run`"
  ([example](https://docs.deno.com/examples/jupyter_display/)). Shared helper modules that are also run from
  scripts or tests must check for it first (`if ("jupyter" in Deno)`).
- **`!` and `subprocess`.** Use `new Deno.Command("uv", { args: ["--version"] }).output()`
  ([Deno.Command](https://docs.deno.com/api/deno/~/Deno.Command)) or dax
  (`` await $`uv --version`.text() ``, [jsr:@david/dax](https://jsr.io/@david/dax), latest 0.50.0).
  **Capture the output and `console.log` it.** The kernel only captures `console.*`, not the process's
  stdout/stderr ([#20555](https://github.com/denoland/deno/issues/20555), open). A child process with
  inherited stdio, which is dax's default `await $\`…\``, prints to the kernel's terminal and not the notebook.
  Package installs (`!uv add`, `pip install`) aren't needed at all: dependencies go in `deno.json` and
  `setup.sh` runs `deno install`.
- **`%%writefile`.** Use `await Deno.writeTextFile("../backend/…", String.raw\`…\`)`. `String.raw` keeps the
  backslashes in embedded Python. Watch out for `${` inside the payload.
- **`%store`.** Two options. The simplest matches what the repo already does: a small helper that reads and
  writes a JSON file (`environments/lab_state.json`), `await Deno.writeTextFile(p, JSON.stringify(state))` and
  `JSON.parse(await Deno.readTextFile(p))`. Deno KV is not a good fit: it is an unstable feature, and issue
  [#28429](https://github.com/denoland/deno/issues/28429) ("no way of using unstable features (e.g. Deno KV)
  under the Jupyter kernel") is still open. The current parser does attach the unstable-feature arg group to
  `jupyter` (defs.rs), but I have not verified whether that works end to end.

## 3. Rich output: tables and charts

How the kernel renders a cell's final value comes from `format()` in
[cli/js/40_jupyter.js](https://github.com/denoland/deno/blob/main/cli/js/40_jupyter.js). It checks these
cases in order:

1. an object with `Symbol.for("Jupyter.display")` (`Deno.jupyter.$display`) is rendered from the MIME bundle it returns
2. canvas-like objects (`toDataURL`) render as images
3. objects with `toSpec()` render as Vega or Vega-Lite
4. **Polars-like DataFrames** (`schema`, `head()`, `toRecords()`) render as `application/vnd.dataresource+json`
   (first 50 rows) plus a `text/html` table (first 10 rows)
5. JPEG and PNG bytes render as images
6. SVG and HTML DOM-like elements (`outerHTML`) render as SVG or HTML
7. WebGPU textures and buffers
8. everything else falls back to `text/plain`

TS options in place of pandas, matplotlib and seaborn. None of these are needed by the current notebooks
(section 2); this table is for future course content.

| Need | Option | Notes / source |
|---|---|---|
| Small result tables (the likely real need, e.g. eval scores in nb 11) | `Deno.jupyter.md` with a Markdown table, or `Deno.jupyter.html` | No dependency. [API ref](https://docs.deno.com/api/deno/~/Deno.jupyter). |
| DataFrame | `npm:nodejs-polars` (latest 0.26.1, npm registry) | Auto-rendered by the DataFrame branch above. It is a native addon. Issue [#20524](https://github.com/denoland/deno/issues/20524) ("Importing npm:nodejs-polars in Jupyter crashes the kernel", Deno 1.36) is **closed**. Worth a smoke test on each student OS. |
| Charts (Observable Plot) | `npm:@observablehq/plot` (0.6.17) plus a DOM shim | The official example passes `document` from `jsr:@ry/jupyter-helper` to `Plot.plot({ …, document })`, and the returned SVG element renders through the `outerHTML` branch ([Deno docs](https://docs.deno.com/runtime/reference/cli/jupyter/)). `@ry/jupyter-helper` is v0.2.0, has "No docs found", and was published about 2 years ago ([jsr.io/@ry/jupyter-helper](https://jsr.io/@ry/jupyter-helper)). For a course, shipping your own `linkedom`/`deno-dom` document shim is less risky. |
| Charts (Vega-Lite) | `npm:vega-lite-api` (`.toSpec()`) or a plain spec object | Objects with `toSpec()` are rendered automatically. **Gotcha:** only `$schema` `…/vega-lite/v4.json` and `…/v5.json` map to Vega-Lite MIME types. Anything else, including a Vega-Lite **v6** schema, is labelled `application/vnd.vega.v5+json` (40_jupyter.js lines ~76-82), which will not render. Pin the v5 `$schema`, or use `Deno.jupyter.display({"application/vnd.vegalite.v5+json": spec}, {raw: true})`. VS Code renders Vega 2-5 and Vega-Lite 1-5 through the Jupyter Notebook Renderers extension ([microsoft/vscode-notebook-renderers](https://github.com/microsoft/vscode-notebook-renderers)). |
| Static images | `Deno.jupyter.image(pathOrBytes)` | PNG and JPEG ([API ref](https://docs.deno.com/api/deno/~/Deno.jupyter)). |
| Progress / live status | `Deno.jupyter.broadcast("display_data" / "update_display_data", …, {display_id})` | [jupyter_display example](https://docs.deno.com/examples/jupyter_display/). |

## 4. Kernel limitations and bugs that matter for a course

| Area | Finding | Impact on this course |
|---|---|---|
| **Permissions** | "Currently all code executed in the Jupyter kernel runs with `--allow-all` flag. This is a temporary limitation" ([docs](https://docs.deno.com/runtime/reference/cli/jupyter/)). Source: `PermissionsContainer::allow_all(...)` in mod.rs. | Nothing prompts. Deno's sandbox is not a teaching point here, and code has full access to `~/.aws`, the same as Python today. |
| **No CLI flags** | `jupyter` accepts only its own flags plus unstable groups (defs.rs). Open requests: "Pass cli arguments to Deno Jupyter" [#27307](https://github.com/denoland/deno/issues/27307), unstable features [#28429](https://github.com/denoland/deno/issues/28429). | There is no `--env-file`, `--config` or `--allow-*`. Configuration has to come from `deno.json` discovered from the kernel's working directory. The kernel builds normal `CliOptions` from the initial cwd (mod.rs), so it can pick up `deno.json`. |
| **`.env` loading** | Deno doesn't auto-load `.env`. The documented routes are `--env-file` or `@std/dotenv` ([env docs](https://docs.deno.com/runtime/reference/env_variables/)). `@std/dotenv` `load()` only writes to `Deno.env` when given `export: true`. The package is 0.225.8 and "UNSTABLE" ([jsr @std/dotenv](https://jsr.io/@std/dotenv/doc)). The side-effect `@std/dotenv/load` module is **deprecated and will be removed in 0.227.0** ([doc](https://jsr.io/@std/dotenv/doc/load)). Open issue "Env support for Jupyter kernel" [#26815](https://github.com/denoland/deno/issues/26815) gives no detail. | Replace `load_dotenv()` with `import { load } from "jsr:@std/dotenv@^0.225"; await load({ export: true, envPath: "../../.env" });`. Use the path explicitly, because the kernel cwd is the notebook dir. Otherwise put non-secret values in the kernelspec `env`. |
| **Stop / interrupt** | "Deno crashes jupyter kernel when pressing stop button" and all variables are lost ([#24491](https://github.com/denoland/deno/issues/24491), **open**, reported on 1.43.5). | This matters a lot for long AgentCore calls (Runtime deploys, evaluations). Keep persisting IDs to JSON after each step (the `%store` replacement) and make setup cells idempotent. |
| **Restarts after dependency changes** | After `deno add`, the import failed until VS Code was fully restarted ([#23218](https://github.com/denoland/deno/issues/23218), open). | Pre-declare every dependency in `deno.json` and run `deno install` in `setup.sh`, so notebooks never add dependencies mid-session. |
| **Kernel start failures** | Kernel "frequently" shuts down right after start under JupyterLab ([#28634](https://github.com/denoland/deno/issues/28634), open, Deno 2.2.5). | Add a troubleshooting entry. |
| **Relative imports of local helpers** | Importing `./data.ts` from a cell reportedly crashed the kernel ([#26816](https://github.com/denoland/deno/issues/26816), open, Deno 2.2.3). The report's snippet is itself malformed (`const { getData } from`). | A shared `lib/` helper module is the natural design, so **smoke-test local imports** on the pinned Deno version before committing to it. |
| **VS Code editor experience** | False errors for variables declared in earlier cells ([vscode_deno #932](https://github.com/denoland/vscode_deno/issues/932), open). Variables panel unsupported ([#26068](https://github.com/denoland/deno/issues/26068), open). Stack-trace line numbers wrong ([#20643](https://github.com/denoland/deno/issues/20643), open). Completion across cells was fixed ([#20657](https://github.com/denoland/deno/issues/20657), closed). The vscode_deno extension only turns on with `deno.enable` or a root `deno.json` ([vscode_deno README](https://github.com/denoland/vscode_deno)). | Students will see red squiggles on correct code. Warn them up front. |
| **stdout capture** | Only `console.*` output reaches the notebook ([#20555](https://github.com/denoland/deno/issues/20555), open). | Pipe child-process output (section 2). |
| **npm: imports** | Supported: "npm modules right from your notebook" ([v1.37 blog](https://deno.com/blog/v1.37)). The old native-addon crash ([#20524](https://github.com/denoland/deno/issues/20524)) is closed. | The AWS SDK v3 (`npm:@aws-sdk/*`) is pure JS. Its compatibility is a separate ticket. |
| **Stability label** | The subcommand and all of `Deno.jupyter` are marked unstable (mod.rs warning, [API ref](https://docs.deno.com/api/deno/~/Deno.jupyter)). There are 25 open issues labelled `deno jupyter` (GitHub search, 2026-09-22). | Pin the Deno version in `setup.sh` and in the course README. |

## 5. Recommended approach

1. **Target VS Code + Jupyter extension as the only supported front end.** It needs no Python. JupyterLab can
   be listed as "works if you already have it", with the note that it needs `pip install jupyterlab`.
2. **`setup.sh` does four things:**
   - install a **pinned** Deno
   - `deno jupyter --install --force`
   - `deno install` from a repo-root `deno.json` that declares every npm/jsr dependency (AWS SDK clients,
     `@std/dotenv`, optionally dax)
   - optionally install the VS Code extensions

   It should also warn if `JUPYTER_PLATFORM_DIRS` is set.
3. **Add one small shared module** (e.g. `capstone_project/notebooks/lib/nb.ts`) with:
   - `loadEnv()` (wraps `@std/dotenv` `load({export:true})`)
   - `saveState/loadState` (JSON file, replaces `%store`)
   - `sh()` (runs `Deno.Command` and `console.log`s the captured output)
   - `writeFile()` (replaces `%%writefile`)

   Guard any use of `Deno.jupyter` so the module also runs under `deno test`. Smoke-test importing it from a
   cell first (issue #26816).
4. **Use `Deno.jupyter.md` for the notebook 11 reports**, and don't port pandas, matplotlib or seaborn. They
   are unused in the notebooks. If charts are added later, prefer Vega-Lite specs with a v5 `$schema` (no DOM
   shim, and VS Code renders them natively) over Observable Plot plus a DOM shim.
5. **Design cells for crash-safety:** persist every created resource ID right after creation, and make create
   cells "get or create". The Stop button kills the kernel (#24491).
6. **Document the known VS Code issues** (false cross-cell errors, no Variables panel) in the course README.

### Per-IPython-feature replacement table

| IPython feature | Where used | Deno/TS replacement | Caveat |
|---|---|---|---|
| `%store x` / `%store -r x` | nb 09, 11 | `saveState({x})` / `const {x} = await loadState()`: JSON file via `Deno.writeTextFile` / `Deno.readTextFile` | Deno KV not usable reliably (unstable, #28429) |
| `!cmd` | nb 07 c3 (`!uv add …`) | Remove (dependencies go in `deno.json` + `deno install`). For real commands: `new Deno.Command(...).output()` or `` await $`cmd`.text() `` (dax), then `console.log` | Child stdout is not captured unless piped (#20555) |
| `subprocess.run/check_call` | nb 01, 05, 09, 10, 11 | Same as `!` | Same |
| `%%writefile path` | nb 02, 05, 08 | `await Deno.writeTextFile(path, String.raw\`…\`)` | Escape `${` in payloads |
| other `%` magics | none | n/a | n/a |
| `display(Markdown(s))` | nb 11 c18-c21 | `Deno.jupyter.md\`…\``; mid-cell: `await Deno.jupyter.display(Deno.jupyter.md\`…\`)` | `Deno.jupyter` only exists under `deno jupyter` |
| `display(HTML/obj)` | none | `Deno.jupyter.html\`…\``, `Deno.jupyter.display(bundle, {raw:true})`, `[Deno.jupyter.$display]()` | Unstable API |
| Top-level `await` | none today (will be everywhere in TS) | Native in the kernel | Stop button crashes the kernel (#24491) |
| `load_dotenv()` | nb 01, 02, 03, 04, 07 | `await load({ export: true, envPath })` from `jsr:@std/dotenv@^0.225` | No `--env-file` for `deno jupyter`. `@std/dotenv/load` is deprecated |
| `os.environ[...] = ...` | all notebooks | `Deno.env.set(...)` / `Deno.env.get(...)` | Runs with `--allow-all`, so no prompts |
| pandas DataFrame | none in notebooks | Markdown/HTML table, or `npm:nodejs-polars` (auto-rendered) | Native addon, so smoke-test per OS |
| matplotlib / seaborn | none in notebooks (Code Interpreter sandbox only) | Vega-Lite spec (v5 `$schema`), or Observable Plot + DOM shim | Vega-Lite v6 `$schema` gets the wrong MIME type |
