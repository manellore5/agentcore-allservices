import { BedrockAgentCoreControlClient, UpdateAgentRuntimeCommand, GetAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore-control";
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
const region = "us-east-1";
const { id, arn } = JSON.parse(await Deno.readTextFile("runtime2.json"));
const ctl = new BedrockAgentCoreControlClient({ region });
await ctl.send(new UpdateAgentRuntimeCommand({
  agentRuntimeId: id,
  agentRuntimeArtifact: { containerConfiguration: { containerUri: "362249012325.dkr.ecr.us-east-1.amazonaws.com/ts-port-spike2:v2" } },
  roleArn: "arn:aws:iam::362249012325:role/ts-port-spike2-runtime-role",
  networkConfiguration: { networkMode: "PUBLIC" },
  metadataConfiguration: { requireMMDSV2: true },
}));
for (;;) {
  const g = await ctl.send(new GetAgentRuntimeCommand({ agentRuntimeId: id }));
  if (g.status !== "UPDATING") { console.log("status", g.status, "version", g.agentRuntimeVersion); break; }
  await new Promise((r) => setTimeout(r, 5000));
}
const data = new BedrockAgentCoreClient({ region });
const sid = `spike2-online2-${crypto.randomUUID()}`;
const out = await data.send(new InvokeAgentRuntimeCommand({
  agentRuntimeArn: arn, runtimeSessionId: sid, contentType: "application/json", accept: "application/json",
  payload: new TextEncoder().encode(JSON.stringify({ action: "agent", prompt: "Hotel $150/night for 6 nights plus $610 flights: total?" })),
}));
console.log((await out.response!.transformToString()).slice(0, 160));
await Deno.writeTextFile("session_online2.txt", sid);
console.log("session", sid, new Date().toISOString());
