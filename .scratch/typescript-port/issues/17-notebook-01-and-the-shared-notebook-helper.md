# Port: notebook 01 and the shared notebook helper

Type: task
Status: open
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
