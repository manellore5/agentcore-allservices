# Port: notebook 01 and the shared notebook helper

Type: task
Status: resolved
Blocked by: 14

## Question

Write `capstone_project/shared/notebook.ts` (JSON state file in place of `%store`, a shell wrapper that prints captured output, `.env` loading via `jsr:@std/dotenv`, file writing for the `%%writefile` cells) and port `01-foundation.ipynb` to TypeScript on the Deno kernel.

First: smoke-test importing a local `.ts` module into the Deno kernel (deno#26816 reports a crash). If it crashes, decide the fallback (inline the helper, or serve it from a URL) and record it here.

Verified when notebook 01 runs top to bottom in VS Code on the Deno kernel and the AWS identity checks pass.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commit f249e61.

**The kernel risk is closed.** The user ran the ported notebook in VS Code on the Deno kernel and it completed successfully, including the three cells that `import "../shared/notebook.ts"`. deno#26816 (importing a local `.ts` crashes the kernel) did **not** reproduce on Deno 2.9.7, so the shared helper stays and the inline fallback is not needed. Later notebooks can import from `shared/` freely.

**`capstone_project/shared/notebook.ts`** (146 lines, 7 tests):
- `state.set/get/require/all/delete` — a JSON file at `notebooks/.notebook-state.json` replacing `%store`. `require(key, setBy)` names the notebook that should have set a missing value. The file is gitignored.
- `sh(command, args, { cwd, quiet, check })` — replaces `!command` cells and `subprocess.run`, and **prints what it captured**, because the kernel does not forward a child process's output (deno#20555).
- `loadEnv(envPath?)` — `jsr:@std/dotenv`, replacing `load_dotenv()`.
- `writeFile(path, contents)` — replaces `%%writefile`; relative paths resolve against the notebooks directory, so the Python paths translate unchanged.
- `repoRoot()`, `maskKey()`.

**Notebook 01** is TypeScript on the Deno kernel, with the kernelspec set to `deno`. Cell by cell it mirrors the Python: the setup check now looks for `deno.json` instead of `pyproject.toml`, env vars go through `Deno.env.set`, credentials come from `defaultProvider()`, and the validation cell checks **Deno version and the Jupyter kernel** where Python checked **Python version and uv**, keeping the STS and Bedrock checks as they were.

**Verified:** the extracted cells ran in order against AWS (4/4 checks passing, real account id, Bedrock reachable), then the user ran the notebook itself in VS Code. `deno task check`, `lint`, `fmt` clean; `deno task test` = 101 passing.

**Dependency added:** `@aws-sdk/client-bedrock` 3.1136.0 for the foundation-model access check.

**Notes for later tickets:**
1. Notebook working directory is the notebook's own folder, so the Python relative paths (`../backend/...`, `../../deno.json`) carry over unchanged.
2. Strip cell outputs before committing a notebook; a verification run stores them in the file.
3. Setup for a learner is: VS Code + the Microsoft **Jupyter** extension + the **denoland** Deno extension, then pick the Deno kernel. No Python. The README rewrite should say exactly this.
