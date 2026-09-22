import { BedrockAgentCoreControlClient, DeleteAgentRuntimeCommand, DeleteOnlineEvaluationConfigCommand } from "@aws-sdk/client-bedrock-agentcore-control";
const ctl = new BedrockAgentCoreControlClient({ region: "us-east-1" });
const { id } = JSON.parse(await Deno.readTextFile("runtime2.json"));
const online = JSON.parse(await Deno.readTextFile("online.json"));
try { await ctl.send(new DeleteOnlineEvaluationConfigCommand({ onlineEvaluationConfigId: online.id })); console.log("online config deleted"); } catch (e) { console.log("online config:", String(e).slice(0, 120)); }
try { await ctl.send(new DeleteAgentRuntimeCommand({ agentRuntimeId: id })); console.log("runtime deleting"); } catch (e) { console.log("runtime:", String(e).slice(0, 120)); }
