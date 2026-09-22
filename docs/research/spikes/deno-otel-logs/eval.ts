import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { BedrockAgentCoreClient, EvaluateCommand } from "@aws-sdk/client-bedrock-agentcore";
const region = "us-east-1";
const sid = (await Deno.readTextFile("session2.txt")).trim();
const { id } = JSON.parse(await Deno.readTextFile("runtime2.json"));
const logs = new CloudWatchLogsClient({ region });
async function q(group: string, query: string) {
  const now = Date.now();
  const { queryId } = await logs.send(new StartQueryCommand({ logGroupName: group, startTime: Math.floor(now / 1000) - 3600, endTime: Math.floor(now / 1000), queryString: query }));
  for (;;) {
    const r = await logs.send(new GetQueryResultsCommand({ queryId }));
    if (r.status === "Complete") return (r.results ?? []).map((row) => JSON.parse(row.find((f) => f.field === "@message")!.value!));
    await new Promise((res) => setTimeout(res, 1500));
  }
}
const spans = await q("aws/spans", `fields @message | filter attributes.session.id = '${sid}' | sort startTimeUnixNano asc | limit 1000`);
const traceIds = [...new Set(spans.map((s) => s.traceId))];
const rlogs = await q(`/aws/bedrock-agentcore/runtimes/${id}-DEFAULT`, `fields @message | filter traceId in [${traceIds.map((t) => `'${t}'`).join(",")}] | limit 1000`);
console.log({ spans: spans.length, traces: traceIds.length, logs: rlogs.length, scope: spans[0]?.scope?.name });
const data = new BedrockAgentCoreClient({ region });
const variants: Record<string, unknown[]> = {
  "as-is": [...spans, ...rlogs],
  "scope=strands.telemetry.tracer": [...spans, ...rlogs].map((d) => ({ ...d, scope: { ...(d.scope ?? {}), name: "strands.telemetry.tracer" } })),
  "spans-only(renamed)": spans.map((d) => ({ ...d, scope: { ...(d.scope ?? {}), name: "strands.telemetry.tracer" } })),
};
for (const evaluatorId of ["Builtin.Helpfulness", "Builtin.GoalSuccessRate"]) {
  for (const [name, docs] of Object.entries(variants)) {
    try {
      const r = await data.send(new EvaluateCommand({ evaluatorId, evaluationInput: { sessionSpans: docs as never } }));
      const res = (r.evaluationResults ?? []).map((e) => ({ value: e.value, label: e.label, err: e.errorMessage, expl: e.explanation?.slice(0, 120) }));
      console.log(evaluatorId, "|", name, "|", JSON.stringify(res));
    } catch (e) { console.log(evaluatorId, "|", name, "| ERROR", String(e).slice(0, 250)); }
  }
}
