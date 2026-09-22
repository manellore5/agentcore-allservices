# What to port for backend files that are already broken in Python

Type: grilling
Status: resolved
Blocked by:

## Question

The research found that some originals don't work today:
- `backend/code_interpreter_setup.py` and `backend/browser_tools_setup.py` import `bedrock_agentcore.services.code_interpreter` / `services.browser_tools`, which don't exist in any Python SDK version, and they call made-up methods.
- `backend/gateway/gateway_setup.py` treats the dict returned by `create_mcp_gateway` as an object (`get_mcp_url()`, `gateway_id`).

"Only the language changes" can't mean porting broken behaviour. Should the TS port:
- implement what each file evidently intends, on the real `CodeInterpreter`/`Browser` APIs and the dict fields, or
- follow what the matching notebooks (06, 07, 03) actually do, or
- drop these files if nothing uses them?

Check which notebooks or files import them before deciding.

## Answer

Decided with the user on 2026-09-22.

Facts found: nothing imports `code_interpreter_setup.py` or `browser_tools_setup.py`. Notebooks 06 and 07 use the Strands tools directly. `gateway_setup.py` is referenced only by `gateway/setup.sh`, as a manual alternative to notebook 03.

1. **`code_interpreter_setup.py` and `browser_tools_setup.py` are ported to their intent.** They become working `code_interpreter_setup.ts` and `browser_tools_setup.ts` scripts on the real `bedrock-agentcore` `CodeInterpreter` / `Browser` APIs. Each starts a session, runs the same capability checks and stops the session. They are not dropped, so the backend structure stays.
2. **`gateway_setup.py` is ported with the fix.** It uses the toolkit `GatewayClient` and reads `gatewayUrl` / `gatewayId` from the returned object. `gateway/setup.sh` becomes the Deno equivalent (check API keys, then `deno task gateway:setup`), and `test_gateway.py` is ported alongside.
3. **Standing rule for bugs found while porting:** if the intent is obvious, port the intent and fix the bug, logging each fix in the port ticket's answer. If the intent is unclear, stop and ask. This rule is recorded in the map's Notes.
