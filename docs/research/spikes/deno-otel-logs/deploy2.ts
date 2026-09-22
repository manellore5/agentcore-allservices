import { BedrockAgentCoreControlClient, CreateAgentRuntimeCommand, GetAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore-control";
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
const region = "us-east-1";
const ctl = new BedrockAgentCoreControlClient({ region });
const r = await ctl.send(new CreateAgentRuntimeCommand({
  agentRuntimeName: "ts_port_spike2_preload",
  agentRuntimeArtifact: { containerConfiguration: { containerUri: "362249012325.dkr.ecr.us-east-1.amazonaws.com/ts-port-spike2:v1" } },
  roleArn: "arn:aws:iam::362249012325:role/ts-port-spike2-runtime-role",
  networkConfiguration: { networkMode: "PUBLIC" },
  metadataConfiguration: { requireMMDSV2: true },
}));
console.log("runtime", r.agentRuntimeId);
await Deno.writeTextFile("runtime2.json", JSON.stringify({ id: r.agentRuntimeId, arn: r.agentRuntimeArn }));
for (;;) {
  const g = await ctl.send(new GetAgentRuntimeCommand({ agentRuntimeId: r.agentRuntimeId! }));
  if (g.status !== "CREATING") { console.log("status", g.status, g.failureReason ?? ""); break; }
  await new Promise((res) => setTimeout(res, 5000));
}
const data = new BedrockAgentCoreClient({ region });
const sid = `spike2-rt-${crypto.randomUUID()}`;
for (const prompt of ["A 5-night trip at $180/night plus $400 flights: total?", "Now add a $35/day food budget for those 5 days. New total?"]) {
  const out = await data.send(new InvokeAgentRuntimeCommand({
    agentRuntimeArn: r.agentRuntimeArn!, runtimeSessionId: sid, contentType: "application/json", accept: "application/json",
    payload: new TextEncoder().encode(JSON.stringify({ action: "agent", prompt })),
  }));
  console.log((await out.response!.transformToString()).slice(0, 200));
}
await Deno.writeTextFile("session2.txt", sid);
console.log("session", sid);
