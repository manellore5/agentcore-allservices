# Port: notebook 10, the policy lab

Type: task
Status: resolved
Blocked by: 25

## Question

Port `10-agentcore_policy_lab.ipynb`: the toolkit `GatewayClient` and `PolicyClient` helpers, the Lambda and IAM setup cells (AWS SDK v3), and the MCP client cell (`McpClient` from the Strands SDK, replacing `streamablehttp_client`). This notebook creates and deletes a Lambda function and IAM roles; keep the cleanup cells working.

## Shared rules (all port tickets)

- Branch `typescript-port`, one commit per ticket. Delete this slice's `.py` files in the same commit as its working `.ts`.
- Verify by extracting the notebook's code cells and running them in order as a Deno script against AWS, then ask the user to open the notebook in VS Code as the final gate.
- Create AWS resources with the course's own names and keep them for later tickets; confirm with the user before creating new billable resources.
- Follow the map's Notes, including the fix-and-log rule for bugs in the originals.

## Answer

Done on branch `typescript-port`, commits 02b1437 (agent), a58e538 (merge) and 14cba96 (the permission fixes).

**Ported:** `10-agentcore_policy_lab.ipynb`, 18 code cells — three Lambdas packaged with `jszip` and deployed via the AWS SDK, an IAM role, a Cognito-authorised Gateway with three Lambda targets, an unrestricted agent run over Strands' `McpClient`, a Policy Engine attached in ENFORCE mode, three Cedar policies, four allow/deny tests, natural-language policy generation, and full cleanup. The Lambda handler sources stay **Python** — they are the payload being deployed, like the Code Interpreter's sandbox code.

**Verified live in 362249012325/us-east-1, end to end:** Lambdas deployed; gateway and all three targets created; the unrestricted agent called `create_application`, `invoke_risk_model` and `approve_claim`; **DEFAULT DENY confirmed** with an empty engine attached; TEST 1 (allow, $750K) created the application; TEST 2 (deny, $1.5M) was refused by policy; TEST 3 (allow, risk model with approval) returned a score; TEST 4 (deny, no approval) was refused; NL2Cedar generated a policy asset; cleanup removed the engine, gateway, Lambdas, IAM role, both inline policies, the Cognito pool and the local config.

**Bugs 12–17 in the Python original.** The first three are the same defect in three places, and each stops the lab dead. **None is visible without running against AWS**, which is why they survived in the course:
12. **`lambda:InvokeFunction` is never granted to the Gateway execution role.** The toolkit only adds it on the path where it deploys its own throwaway Lambda; this lab always supplies its own `lambdaArn`. AWS refuses to even **create** the target: `ValidationException: Gateway execution role lacks permission to invoke Lambda function`. The Python lab therefore cannot pass Part 2.
13. **`bedrock-agentcore:GetPolicyEngine` is never granted**, so attaching the engine fails with `Access denied while calling GetPolicyEngine ... Confirm this role has ... permission`.
14. **The authorize family is never granted.** ENFORCE mode calls `AuthorizeAction`, then `PartiallyAuthorizeActions`, and checks them against **both** the policy-engine ARN and the **gateway** ARN. AWS reports one missing action per attempt, so the port grants `bedrock-agentcore:*Authorize*` scoped to those two resources rather than rediscovering them one deploy at a time.
15. Part 5's heading documents the Cedar action format as `TargetName__operation` (two underscores); the real tool names use three. Fixed in the markdown.
16. The closing summary advertises a "Part 8: Emergency shutdown" that does not exist; the notebook never writes a `forbid` policy. Kept verbatim, flagged here.
17. `create_lambda_role` sleeps 10s and proceeds, which is not reliably enough for Lambda to assume a new role. Ported with `isRoleNotReadyError` plus exponential backoff.

**Ordering matters, and cost a round-trip:** the first port granted the Lambda permission *after* creating the targets. AWS checks at creation time, so it inherited the original failure. Both grants now go on before the call that needs them, each with a propagation retry, and cleanup removes both.

**One defect of my own:** a patch added imports that already existed in an earlier cell. That fails `deno check` on the concatenated cells **and** would fail in the kernel, since notebook cells share one scope. Later notebook edits must check for existing declarations.

**Note:** minor cosmetic issues in the original were kept verbatim (off-by-one step numbers in cleanup prints; a "multi-line" NL2Cedar demo fed a single line; `RiskModelTool` returns upper-case risk levels while `ApprovalTool` accepts lower-case).
