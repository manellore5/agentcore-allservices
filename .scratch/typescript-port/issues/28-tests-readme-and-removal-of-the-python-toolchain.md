# Port: tests, README, and removal of the Python toolchain

Type: task
Status: resolved
Blocked by: 27

## Question

Port `tests/api_direct_test.py` -> `.ts` under the `tests/deno.json` config. Rewrite the README and every notebook markdown cell that mentions Python, uv, pip or venv, including a note on why `misc/mcp.json` still uses `uvx`. Delete `pyproject.toml`, `uv.lock`, `.python-version` and any remaining `.py` files, and update `.gitignore`.

Finish with a full 01 -> 11 run against AWS from a clean checkout following `setup.sh`, then merge `typescript-port` to main.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commit 80c8a62.

**Ported:** `tests/api_direct_test.py` -> `api_direct_test.ts` on `fetch`, same three API checks and printed messages.

**Deleted — the repository now contains no Python toolchain:** `pyproject.toml`, `uv.lock`, `.python-version`, `tests/pyproject.toml`, `capstone_project/backend/requirements.txt`. A clean checkout reports **zero** `.py`/`pyproject`/`uv.lock`/`requirements.txt` files.

**README finished:** project structure (now showing `toolkit/`, `shared/`, `deno.json`, `deno.lock`, `.deno-version`), technology list, and testing commands. Added a note explaining that `misc/mcp.json` still launches MCP servers with `uvx`, because it is editor configuration and that server ships for Python only. `capstone_project/README.md` updated too.

**Bugs 20–21 in the Python original:**
20. `api_direct_test.py` hard-codes the three API keys as **empty strings** in its constructor, under a comment saying they should come from environment variables. Every run therefore called the APIs with no key and reported failure. The port reads them from the environment.
21. `tests/README.md` documented three scripts — `gateway_tester.py`, `api_direct_test.py`, `gateway_inspector.py` — but **two of them do not exist** in the repository. Rewritten to describe what is actually there.

**Verified from a clean clone of the branch, following `setup.sh` exactly as a learner would:**
- Zero Python files.
- `setup.sh` installed dependencies, registered the Deno Jupyter kernel, checked the API keys and printed the VS Code instructions.
- `deno task check` (36 files), `deno task test` (104 passing), `deno task check:pins` all clean.
- All 11 notebooks carry the Deno kernelspec and hold no stored outputs.
- **Notebook 01 ran from the clean checkout: 4/4 environment checks passed**, including live AWS identity and Bedrock access.

**Not done, by the user's decision:** the sequential 01→11 run in one sitting. Every notebook was verified live in its own ticket (see the map), but not back-to-back. Deferred until the third-party credentials exist, so that one run can also cover the gateway tool calls and the Google OAuth flow. Tracked by "Verify the notebooks that need third-party credentials".
