# Port: notebook 03 and the gateway backend

Type: task
Status: resolved
Blocked by: 18

## Question

Port `03-gateway-integration.ipynb` and `backend/gateway/` (`gateway_setup.py`, `test_gateway.py`, `setup.sh`, the OpenAPI specs stay as they are), plus `backend/auth_utils.py` (Cognito SECRET_HASH via Web Crypto) and `backend/cognito_config.py`.

Fix-and-log applies: `gateway_setup` treats the dict returned by `create_mcp_gateway` as an object (see the broken-originals decision).

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commit c03b5cb (plus the merged agent commit af3b99d).

**Ported:**
- `backend/auth_utils.ts` — Cognito SECRET_HASH via Web Crypto `crypto.subtle` HMAC, replacing `hmac`/`hashlib`.
- `backend/cognito_config.ts` — `saveCognitoConfig`, `loadCognitoConfig`, `ensureUserPasswordAuth`, `activateOauthClientCredentials`, `setupCognitoOauth`.
- `backend/gateway/gateway_setup.ts`, `test_gateway.ts`, `setup.sh` — the standalone path (ported by an agent).
- `03-gateway-integration.ipynb` — 19 cells: spec review, Cognito OAuth, gateway creation with the existing-gateway fallback through the raw client, three OpenAPI targets, MCP tool calls over `fetch`, and the saved gateway info.
- Deleted: `auth_utils.py`, `cognito_config.py`, `gateway_setup.py`, `test_gateway.py`, and the dead `gateway/requirements.txt`.

**Verified live in 362249012325/us-east-1** with placeholder API keys (the user opted not to obtain real ones): the Cognito pool and app client, gateway `TravelMateGateway` (`travelmategateway-fujwshcxxj`), three targets and their API-key credential providers were all created, an OAuth token was obtained, and a tool call travelled MCP -> Gateway -> credential provider -> OpenWeatherMap, which answered `401 Invalid API key`. That 401 **is** the success signal: it proves the gateway routed the call and injected the stored key. With real keys the same call returns weather. The flight and currency tools take the same path.

**Bug fixed in our own `GatewayClient`, found only by running it:** every OpenAPI target failed at call time with "Failed to fetch outbound api key … not authorized to perform: `bedrock-agentcore:GetWorkloadAccessToken`", then the same for `GetResourceApiKey`. The gateway assumes its execution role, mints a workload token for itself, and reads the target's credential provider through it. **The Python toolkit's `build_gateway_access_policy` does not grant these either**, so this is not a porting slip. `buildGatewayAccessPolicy` now grants `GetWorkloadAccessToken`, `GetResourceApiKey` and `GetResourceOauth2Token` on `workload-identity-directory/default` and its `workload-identity/*`, with a test.

**Three bugs in the Python originals, fixed and logged** (the standalone script could never have run):
1. `gateway.get_mcp_url()` / `gateway.gateway_id` called on a dict.
2. `cognito_result['authorization']` — a key that does not exist; the toolkit returns `authorizer_config`.
3. `openapi_specs/hotelbeds.json` loaded but absent from the repo, with a `HOTELBEDS_API_KEY` no notebook sets. The Hotelbeds target and its two tests are dropped; three targets and five tests remain.
Also: the script defaulted to `us-west-2` while every notebook uses `us-east-1` (now `AWS_REGION` with an `us-east-1` fallback), its ExchangeRate credential location disagreed with the notebook (now follows the notebook: QUERY_PARAMETER `api_key`), and spec paths depended on the working directory (now resolved from `import.meta.url`).

**Repo hygiene:** `capstone_project/notebooks/environments/*.json` are now gitignored. They were empty placeholders upstream but are generated at runtime and hold live resource ids and the Cognito **client secret**, which one commit briefly contained; the commit was amended before anything was pushed, and the value appears nowhere in history. Later notebooks still read these files locally.

**Note for later tickets:** run `deno fmt` from the repo root only. Running it on a path bypasses the `include` list in `deno.json` and reformats the third-party OpenAPI specs (reverted here).

**Not verified:** live tool responses with real API keys, and `test_gateway.ts` against a live gateway (its no-credentials guard path was run). The user has the `.env` with placeholders and can swap in real keys.
