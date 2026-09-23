# Map: Port the course repo from Python to TypeScript

Label: wayfinder:map

## Destination

Every Python artifact in the repo — `capstone_project/backend/**`, the 11 notebooks, `tests/`, `setup.sh`, README — ported to TypeScript running on **Deno**. Each keeps the same folders, file roles, behaviour and AWS resources, and each works when run against AWS. The Python toolchain (`uv`, `pyproject.toml`, `uv.lock`, `.venv`, `.python-version`, `requirements.txt`) gets a Deno equivalent of the same shape, and the Python originals are deleted.

## Notes

- **This effort carries execution into the map.** Once the planning tickets resolve, porting tickets get created and worked here, not handed off.
- Only the programming language changes. The project structure, the setup workflow (one `setup.sh` that bootstraps everything), the course flow (notebooks 01–11), the deployed resources and the behaviour all stay the same.
- Runtime: **Deno**, chosen by the user. `deno.json` fills the role of `pyproject.toml`, `deno.lock` the role of `uv.lock`, and the Deno cache the role of `.venv`. npm packages come in through `npm:` specifiers.
- Originals: **replace** them. Python files are removed once their TS version works.
- Verification: the user has an AWS account and API keys. A ported piece is done when it has actually run against AWS, not just typechecked.
- Tracker: local markdown (`.scratch/typescript-port/`), because origin is the upstream course repo.
- Research findings live on throwaway `research/<name>` branches under `docs/research/`.
- **Bugs found while porting:** port the intent and fix the bug when the intent is obvious, logging each fix in the port ticket's answer. When the intent is unclear, stop and ask the user. (From the broken-originals decision.)
- Skills: `/grilling` + `/domain-modeling` for decisions, `/research` for SDK facts, `/tdd` when porting modules.

## Decisions so far

<!-- one line per closed ticket -->

- [Running the course notebooks as Deno TypeScript notebooks](issues/03-deno-jupyter-notebooks.md) — VS Code + Deno kernel, no Python needed; shared helper module replaces %store/!/subprocess/dotenv; no pandas/plotting in notebooks
- [Deploying a Deno/TypeScript agent to AgentCore Runtime](issues/04-deploy-deno-agent-to-runtime.md) — arm64 Deno container + npm `@aws/agentcore` CLI (container mode); no zip path for Deno; Deno observability is the open risk
- [AgentCore SDK + starter-toolkit coverage in TypeScript/Deno](issues/01-agentcore-sdk-typescript-coverage.md) — npm `bedrock-agentcore` + AWS SDK v3 cover all calls and import fine on Deno; starter toolkit → `@aws/agentcore` CLI; Memory/Identity/Evaluation/Gateway/Observability/Policy helpers have no TS library; some Python originals are broken
- [Strands Agents coverage in TypeScript/Deno](issues/02-strands-typescript-coverage.md) — `@strands-agents/sdk` 1.18 GA covers Agent/BedrockModel/McpClient; `tool()`+zod replaces `@tool`; no `calculator`; browser tool narrower; smoke test passed locally on Deno
- [Spike: get a Deno agent's traces into CloudWatch GenAI observability](issues/07-deno-observability-spike.md) — works on Deno with our own SigV4 OTLP exporter (built-in Deno OTel gets nothing); whole stack ran live in AgentCore Runtime on Deno; logs export for evaluations untested
- [Deno or Node 22 for the code that runs inside AgentCore Runtime](issues/08-in-runtime-js-runtime.md) — Deno everywhere; `BedrockAgentCoreApp`; one shared observability module loaded via `--preload`; Node 22 only as a lab-11 fallback if Deno logs fail
- [How the notebooks replace the Python starter toolkit](issues/09-starter-toolkit-replacement.md) — in-repo SDK v3 helpers in `capstone_project/toolkit/` mirroring the toolkit API; own `Runtime` helper building via CodeBuild (no local Docker); no CLI in cells
- [What to port for backend files that are already broken in Python](issues/10-broken-python-originals.md) — port intent, not bugs: CI/browser setup scripts rebuilt on real APIs, gateway_setup fixed; standing fix-and-log rule added to Notes
- [Spike: OTLP logs export and --preload telemetry on Deno](issues/11-deno-logs-and-preload-spike.md) — `--preload` keeps telemetry out of agent code; SigV4 OTLP logs land in the runtime log group; on-demand evaluations score a Deno agent; online evaluation produced nothing (unverified)
- [Map each Python dependency to its Deno/TS replacement](issues/05-dependency-mapping.md) — full table: AWS SDK v3 + `bedrock-agentcore` + `@strands-agents/sdk`, `fetch`/`Deno.serve`/`@std` replace requests/FastAPI/dotenv, 6 unused deps dropped, sandbox code stays Python, exact version pins
- [Deno toolchain layout mirroring the uv setup](issues/06-deno-toolchain-layout.md) — root `deno.json` + per-agent configs, `shared/` modules copied into build contexts, `.deno-version`, tasks, `setup.sh` steps; `misc/mcp.json` left alone
- [Porting order and ticket slicing](issues/13-porting-order.md) — 15 port tickets: skeleton, 2 toolkit tickets, one per notebook with its backend files, then tests/README/removal; one branch, Python deleted per slice
- [Port: toolchain skeleton and shared observability](issues/14-toolchain-skeleton-and-shared-observability.md) — done on branch `typescript-port` (8e6616a): deno.json/lock/.deno-version/setup.sh/tests config + `shared/observability.ts` with tests; check, test, fmt, kernel install and preload all verified
- [Port: toolkit helpers (memory, identity, gateway, observability, evaluation, policy)](issues/15-toolkit-helpers-memory-identity-gateway-observab.md) — done: 6 helpers + logger + mod.ts (~5.5k lines, 82 tests); 7 Python bugs/differences logged, incl. gateway detach and the span-scope filter
- [Port: toolkit Runtime helper with CodeBuild deploy](issues/16-toolkit-runtime-helper-with-codebuild-deploy.md) — done: configure/launch/status/invoke with the remote CodeBuild pipeline, generated Deno Dockerfile with `--preload`, requireMMDSV2; adds jszip
- [Port: notebook 01 and the shared notebook helper](issues/17-notebook-01-and-the-shared-notebook-helper.md) — done: `shared/notebook.ts` (state file, sh, loadEnv, writeFile) + notebook 01 on the Deno kernel; local `.ts` imports do NOT crash the kernel, so no fallback needed
- [Port: notebook 02 and the simple agent](issues/18-notebook-02-and-the-simple-agent.md) — done and verified live (agent deployed, READY, multi-turn tested; user ran the notebook in VS Code); fixed 2 real bugs: IAM-propagation retry and ghcr.io base image after a Docker Hub 429
- [Port: notebook 03 and the gateway backend](issues/19-notebook-03-and-the-gateway-backend.md) — done and verified live (gateway + Cognito + 3 targets created, tool call reached the upstream API); fixed the gateway role's missing workload-identity permissions, which the Python toolkit also lacks, plus 3 dead bugs in the Python scripts
- [Port: notebook 04 and memory setup](issues/20-notebook-04-and-memory-setup.md) — done and verified live (memory ACTIVE, 3 strategies, event seeded, extracted preference retrieved); no bugs found in this slice
- [Port: notebook 05 and the identity runtime](issues/21-notebook-05-and-the-identity-runtime.md) — done; callback server verified live, OAuth2 flow unverified pending Google credentials; `withAccessToken` replaces the decorator, async generator replaces the streaming queue; found a 4th Python bug (credentialProviderId vs Arn)
- [Port: notebook 06 and code interpreter setup](issues/22-notebook-06-and-code-interpreter-setup.md) — done and verified live (sandbox ran pandas/numpy, 4 agent analyses); rebuilt the never-working setup script on the real session API; fixed `deno fmt` rewriting notebooks and specs
- [Port: notebook 07 and browser tools setup](issues/23-notebook-07-and-browser-tools-setup.md) — done and verified live (Playwright over CDP to the remote browser works under Deno; agent drove navigate/screenshot/getText/click); rebuilt the second never-working setup script
- [Port: notebook 08 and the final unified agent](issues/24-notebook-08-and-the-final-unified-agent.md) — done and deployed; memory tools verified live against notebook 04's memory; deployed agents must be self-contained (no toolkit imports); 6 more Python bugs logged
- [Port: notebook 09, the observability lab](issues/25-notebook-09-the-observability-lab.md) — done and verified live: 9 spans/2 traces queried back through `ObservabilityClient`, closing the loop from the observability spike
- [Port: notebook 10, the policy lab](issues/26-notebook-10-the-policy-lab.md) — done and verified live (default-deny + all 4 Cedar allow/deny tests + NL2Cedar + cleanup); found 3 missing Gateway-role permissions that make the Python lab impossible to complete
- [Port: notebook 11, the evaluations lab](issues/27-notebook-11-the-evaluations-lab.md) — done and verified live: custom evaluator scored the out-of-scope turn Very Poor exactly as taught; found the lab is not re-runnable in Python; online evaluation still unproven

## Not yet specified

<!-- empty: every remaining question is a live ticket -->


## Out of scope

<!-- work ruled beyond the destination -->
