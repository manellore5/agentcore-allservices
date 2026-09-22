# Port: notebook 03 and the gateway backend

Type: task
Status: open
Blocked by: 18

## Question

Port `03-gateway-integration.ipynb` and `backend/gateway/` (`gateway_setup.py`, `test_gateway.py`, `setup.sh`, the OpenAPI specs stay as they are), plus `backend/auth_utils.py` (Cognito SECRET_HASH via Web Crypto) and `backend/cognito_config.py`.

Fix-and-log applies: `gateway_setup` treats the dict returned by `create_mcp_gateway` as an object (see the broken-originals decision).

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.
