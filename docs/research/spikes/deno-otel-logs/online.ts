import { BedrockAgentCoreControlClient, CreateOnlineEvaluationConfigCommand, GetOnlineEvaluationConfigCommand } from "@aws-sdk/client-bedrock-agentcore-control";
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
const region = "us-east-1";
const { id, arn } = JSON.parse(await Deno.readTextFile("runtime2.json"));
const ctl = new BedrockAgentCoreControlClient({ region });
await new Promise((r) => setTimeout(r, 10000)); // IAM propagation
const c = await ctl.send(new CreateOnlineEvaluationConfigCommand({
  onlineEvaluationConfigName: "ts_port_spike2_online",
  rule: { samplingConfig: { samplingPercentage: 100 } },
  dataSourceConfig: { cloudWatchLogs: { logGroupNames: [`/aws/bedrock-agentcore/runtimes/${id}-DEFAULT`], serviceNames: ["ts_port_spike2_preload.DEFAULT"] } },
  evaluators: [{ evaluatorId: "Builtin.Helpfulness" }],
  evaluationExecutionRoleArn: "arn:aws:iam::362249012325:role/ts-port-spike2-eval-role",
  enableOnCreate: true,
}));
console.log("config", c.onlineEvaluationConfigId, c.status);
for (let i = 0; i < 30; i++) {
  const g = await ctl.send(new GetOnlineEvaluationConfigCommand({ onlineEvaluationConfigId: c.onlineEvaluationConfigId! }));
  if (g.status !== "CREATING") { console.log("status", g.status, g.executionStatus, JSON.stringify(g.outputConfig ?? {}), g.failureReason ?? ""); break; }
  await new Promise((r) => setTimeout(r, 5000));
}
await Deno.writeTextFile("online.json", JSON.stringify({ id: c.onlineEvaluationConfigId }));
const data = new BedrockAgentCoreClient({ region });
const sid = `spike2-online-${crypto.randomUUID()}`;
const out = await data.send(new InvokeAgentRuntimeCommand({
  agentRuntimeArn: arn, runtimeSessionId: sid, contentType: "application/json", accept: "application/json",
  payload: new TextEncoder().encode(JSON.stringify({ action: "agent", prompt: "Hotel $210/night for 4 nights plus $520 flights: total?" })),
}));
console.log((await out.response!.transformToString()).slice(0, 160));
await Deno.writeTextFile("session_online.txt", sid);
console.log("session", sid);
