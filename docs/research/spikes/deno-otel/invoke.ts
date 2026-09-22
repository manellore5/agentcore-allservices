import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
const c = new BedrockAgentCoreClient({ region: "us-east-1" });
const ids: Record<string, string> = JSON.parse(await Deno.readTextFile("runtimes.json"));
const sessions: Record<string, string> = {};
for (const [m, arn] of Object.entries(ids)) {
  const sid = `spike-${m}-${crypto.randomUUID()}`;
  sessions[m] = sid;
  for (const action of ["agent", "ci", "browser"]) {
    const t0 = Date.now();
    try {
      const r = await c.send(new InvokeAgentRuntimeCommand({
        agentRuntimeArn: arn, runtimeSessionId: sid, contentType: "application/json", accept: "application/json",
        payload: new TextEncoder().encode(JSON.stringify({ action })),
      }));
      const body = await r.response!.transformToString();
      console.log(m, action, Date.now() - t0, "ms", body.slice(0, 220));
    } catch (e) { console.log(m, action, "ERROR", String(e).slice(0, 300)); }
  }
}
await Deno.writeTextFile("sessions.json", JSON.stringify(sessions, null, 2));
