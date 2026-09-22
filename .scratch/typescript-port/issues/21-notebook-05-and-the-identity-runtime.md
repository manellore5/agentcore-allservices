# Port: notebook 05 and the identity runtime

Type: task
Status: open
Blocked by: 20

## Question

Port `05-identity-oauth.ipynb` and `backend/identity/runtime/`: the Google Drive agent (`npm:googleapis`), `oauth2_callback_server.py` -> a `Deno.serve` app on 127.0.0.1:9090 calling `CompleteResourceTokenAuth`, the `Dockerfile` (Deno arm64 base, `--preload`), and `requirements.txt` -> `deno.json`.

The largest notebook (~680 lines of code cells); split the ticket if a session runs out of room. Note from research: JWT inbound auth needs a raw HTTPS invoke rather than the SDK invoke path.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
