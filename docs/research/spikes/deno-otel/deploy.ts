import { BedrockAgentCoreControlClient, CreateAgentRuntimeCommand, GetAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore-control";
const c = new BedrockAgentCoreControlClient({ region: "us-east-1" });
const IMG = "362249012325.dkr.ecr.us-east-1.amazonaws.com/ts-port-spike:v1";
const ROLE = "arn:aws:iam::362249012325:role/ts-port-spike-runtime-role";
const modes: Record<string, Record<string, string>> = {
  deno: { TELEMETRY_MODE: "deno", OTEL_DENO: "true" },
  sigv4: { TELEMETRY_MODE: "sigv4" },
};
const ids: Record<string, string> = {};
for (const [m, env] of Object.entries(modes)) {
  const r = await c.send(new CreateAgentRuntimeCommand({
    agentRuntimeName: `ts_port_spike_${m}`,
    agentRuntimeArtifact: { containerConfiguration: { containerUri: IMG } },
    roleArn: ROLE,
    networkConfiguration: { networkMode: "PUBLIC" },
    environmentVariables: env,
    metadataConfiguration: { requireMMDSV2: true },
  }));
  ids[m] = r.agentRuntimeArn!;
  console.log(m, r.agentRuntimeId, r.agentRuntimeArn, r.status);
}
for (const [m, arn] of Object.entries(ids)) {
  const id = arn.split("/").pop()!;
  for (;;) {
    const g = await c.send(new GetAgentRuntimeCommand({ agentRuntimeId: id }));
    if (g.status !== "CREATING") { console.log(m, "->", g.status, g.failureReason ?? ""); break; }
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await Deno.writeTextFile("runtimes.json", JSON.stringify(ids, null, 2));
