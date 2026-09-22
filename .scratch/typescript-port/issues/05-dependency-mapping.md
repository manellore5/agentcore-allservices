# Map each Python dependency to its Deno/TS replacement

Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 04, 08, 09, 11

## Question

For every dependency in `pyproject.toml`, `tests/pyproject.toml` and each `requirements.txt`, which TS/npm/JSR package replaces it under Deno, or is it dropped (e.g. `ipykernel`, `nest-asyncio`, `pickleshare`)? Where no equivalent exists, what is the fallback?

Current deps: beautifulsoup4, bedrock-agentcore, bedrock-agentcore-starter-toolkit, boto3, fastapi, google-api-python-client, google-auth-httplib2, google-auth-oauthlib, ipykernel, jupyter, matplotlib, nest-asyncio, numpy, pandas, playwright, pickleshare, python-dotenv, requests, seaborn, selenium, strands-agents, strands-agents-tools, structlog, watchtower, plus uvicorn/mcp in sub-requirements.

The output is a single mapping table that later port tickets follow.

Known inputs from research:
- There is no TS `strands-agents-tools`, so `calculator` needs a custom tool.
- The browser tool has 7 actions against Python's ~22. Check which actions notebook 07 and the backend actually use.
- `zod` ^4 is a required peer dependency of `@strands-agents/sdk`.
- `watchtower` and `structlog`: decide their replacements here. Logs reach CloudWatch through the runtime's stdout capture and the shared observability module, so a separate CloudWatch logging library may not be needed.
- `aws-opentelemetry-distro` (ADOT) is replaced by the shared Deno observability module. Node 22 + ADOT is added only if the logs spike forces the lab 11 fallback.
- `bedrock-agentcore-starter-toolkit` is replaced by the in-repo `capstone_project/toolkit/` helpers on AWS SDK v3; see the starter-toolkit decision. List the `@aws-sdk/client-*` packages they need: bedrock-agentcore(-control), iam, ecr, s3, codebuild, cognito-identity-provider, cloudwatch-logs, secrets-manager, lambda, sts.

## Answer

Decided with the user on 2026-09-22. Exact versions are pinned in `deno.json` with `deno.lock` committed; utilities come from JSR `@std`, and npm is used only where the ecosystem requires it.

| Python | Deno/TypeScript | Note |
|---|---|---|
| `bedrock-agentcore` | `npm:bedrock-agentcore@0.4.4` | plus `experimental/code-interpreter/strands`, `experimental/browser/strands`, `runtime` |
| `bedrock-agentcore-starter-toolkit` | in-repo `capstone_project/toolkit/` on AWS SDK v3 | see the starter-toolkit decision |
| `boto3`, `botocore` | `npm:@aws-sdk/client-*` | bedrock-agentcore, bedrock-agentcore-control, cognito-identity-provider, iam, ecr, s3, codebuild, cloudwatch-logs, secrets-manager, lambda, sts, plus `credential-provider-node` |
| `strands-agents` | `npm:@strands-agents/sdk@1.18.0` | peers: `zod@^4`, `@modelcontextprotocol/sdk`, `@opentelemetry/api` |
| `strands-agents-tools` | none | `calculator` becomes a custom tool; code-interpreter and browser tools come from `bedrock-agentcore` |
| `mcp` (`streamablehttp_client`) | `McpClient` from the Strands SDK | no separate transport import |
| `requests` | built-in `fetch` | explicit status checks at each call site |
| `python-dotenv` | `jsr:@std/dotenv` | `load({ export: true, envPath })` |
| `fastapi`, `uvicorn` | `Deno.serve` | OAuth callback server, 3 routes |
| `google-api-python-client`, `google-auth-httplib2` | `npm:googleapis` | `drive.files.create` with the AgentCore Identity token |
| `playwright` | `npm:playwright` | optional peer of `BrowserTools` (`connectOverCDP`) |
| `jupyter`, `ipykernel` | Deno's built-in kernel | `deno jupyter --install` |
| `pickleshare` (`%store`) | JSON state file in the notebook helper | see the Deno-notebooks decision |
| `aws-opentelemetry-distro` | in-repo observability module | `@opentelemetry/{api,sdk-trace-base,sdk-logs,api-logs,resources,core,context-async-hooks,otlp-transformer}` (versions must match), `@smithy/signature-v4`, `@smithy/protocol-http`, `@aws-crypto/sha256-js` |
| `hmac`, `hashlib` (`auth_utils.py`) | Web Crypto `crypto.subtle` | Cognito SECRET_HASH |
| `json`, `os`, `pathlib`, `subprocess`, `io`, `datetime` | `JSON`, `Deno.env`, `jsr:@std/path`, `Deno.Command`, `Date` | built-ins |
| `pandas`, `numpy`, `matplotlib`, `seaborn` | **not repo dependencies** | they appear only inside Python source that `code_interpreter_setup.py` sends to the sandbox, which stays Python |
| `beautifulsoup4`, `selenium`, `structlog`, `watchtower`, `nest-asyncio`, `google-auth-oauthlib` | **dropped** | declared but imported nowhere |

Decisions behind the table:
1. Unused dependencies are dropped rather than mapped.
2. `fetch` replaces `requests`, with no HTTP library.
3. The official `googleapis` package keeps the "use Google's own client" lesson.
4. `Deno.serve` replaces FastAPI + uvicorn.
5. Code sent **into** the Code Interpreter stays Python; the sandbox is a Python execution service and that is the lesson. The ported file says so in a comment.
6. Exact version pins everywhere, because several packages are pre-1.0 or unofficial on Deno, and the OpenTelemetry packages must agree.
7. JSR `@std` for utilities; npm for AWS SDK, Strands, AgentCore, OpenTelemetry, googleapis, playwright, zod.
