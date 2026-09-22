# Port: notebook 02 and the simple agent

Type: task
Status: resolved
Blocked by: 15, 16, 17

## Question

Port `02-runtime-setup.ipynb` and `backend/runtime/simple_agent/` (`travel_agent.py` -> `.ts`, `requirements.txt` -> `deno.json`). The notebook's `%%writefile` cells must generate the Deno agent using `BedrockAgentCoreApp`, with no telemetry code in the agent file.

This is the first live test of the `Runtime` helper: configure, launch through CodeBuild, status, invoke.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commits b233ee3 and 8b96da9.

**Ported:**
- `backend/runtime/simple_agent/travel_agent.ts` — the three tools as `tool({ inputSchema: z.object(...) })`, `BedrockModel` on Haiku 4.5, and `BedrockAgentCoreApp` with a zod request schema. No telemetry code: the container preloads `shared/observability.ts`.
- `backend/runtime/simple_agent/deno.json` — the agent's own pins, filling the role of `requirements.txt`: its imports plus everything the preloaded observability module needs. `deno task check:pins` keeps it aligned with the root.
- `02-runtime-setup.ipynb` — 16 code cells on the Deno kernel. The `%%writefile` cells become `writeFile(...)` calls generating both files above. The deploy cells use the toolkit `Runtime`, passing `sourceDir` instead of Python's `os.chdir`. Runtime info is saved to `environments/runtime_info.json` and also to the notebook state.
- Deleted: `travel_agent.py`, `requirements.txt`.

**Verified live in 362249012325/us-east-1:** CodeBuild built the arm64 image, `travel_companion_basic` reached READY, and the invoke, budget and 4-turn conversation tests all returned sensible answers. **The user then ran the notebook in VS Code on the Deno kernel: all 16 cells executed with no errors**, deploying runtime version 4. Outputs were stripped before committing.

**Two bugs the live run forced, both fixed in `toolkit/runtime.ts` with tests:**
1. **CodeBuild could not assume the role that had just been created.** Added `withIamConsistencyRetry`, ported from the Python toolkit's `retry_create_with_eventual_iam_consistency` and widened to CodeBuild's own wording (`InvalidInputException` … `sts:AssumeRole`), which the Python version does not cover. Wraps both project creation and `StartBuild`.
2. **Docker Hub rate-limited the CodeBuild pull** of the base image: `429 Too Many Requests` for `denoland/deno`. CodeBuild builds from shared IPs, so learners would hit this too. The generated Dockerfile now uses `ghcr.io/denoland/deno` (`DENO_IMAGE_REGISTRY`), as the deploy research recommended.

**Resources created and kept for later notebooks:** ECR repo `bedrock-agentcore-travel_companion_basic`, roles `AmazonBedrockAgentCoreSDKRuntime-us-east-1-346339bc6e` and `...CodeBuild-us-east-1-346339bc6e`, bucket `bedrock-agentcore-codebuild-sources-362249012325-us-east-1`, CodeBuild project `bedrock-agentcore-travel_companion_basic-builder`, and agent runtime `travel_companion_basic-px28dj540l`.

**Notes for later tickets:**
1. `.bedrock_agentcore.json` (the Runtime helper's state) is gitignored, like the notebook state file.
2. Running a notebook stores outputs and can add stray empty cells; strip both before committing.
3. The README's setup sections were updated to Deno ahead of schedule (commit 8b11ed2), since they were actively misleading. Structure, tech stack and testing sections remain for the final ticket.
