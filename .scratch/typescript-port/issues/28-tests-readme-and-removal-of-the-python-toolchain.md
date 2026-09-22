# Port: tests, README, and removal of the Python toolchain

Type: task
Status: open
Blocked by: 27

## Question

Port `tests/api_direct_test.py` -> `.ts` under the `tests/deno.json` config. Rewrite the README and every notebook markdown cell that mentions Python, uv, pip or venv, including a note on why `misc/mcp.json` still uses `uvx`. Delete `pyproject.toml`, `uv.lock`, `.python-version` and any remaining `.py` files, and update `.gitignore`.

Finish with a full 01 -> 11 run against AWS from a clean checkout following `setup.sh`, then merge `typescript-port` to main.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
