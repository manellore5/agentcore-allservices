// Unit tests for the pure parts of the ObservabilityClient port: the Logs Insights query strings
// and the row-to-record builders. Nothing here touches AWS.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  CloudWatchQueryBuilder,
  CloudWatchResultBuilder,
  getAgentRuntimeLogGroup,
} from "./observability-client.ts";

Deno.test("buildSpansBySessionQuery filters on both the session and the parsed agent id", () => {
  const query = CloudWatchQueryBuilder.buildSpansBySessionQuery("session-123", "agent-abc");

  assert(query.startsWith("fields @timestamp,"));
  assertStringIncludes(query, "| filter attributes.session.id = 'session-123'");
  assertStringIncludes(
    query,
    '| parse resource.attributes.cloud.resource_id "runtime/*/" as parsedAgentId',
  );
  assertStringIncludes(query, "| filter parsedAgentId = 'agent-abc'");
  assertStringIncludes(query, "| sort startTimeUnixNano asc");
  // The projected fields the result builder reads back out.
  for (
    const field of [
      "traceId",
      "spanId",
      "name as spanName",
      "status.code as statusCode",
      "durationNano/1000000 as durationMs",
      "attributes.session.id as sessionId",
      "resource.attributes.cloud.resource_id as resourceId",
      "attributes.aws.remote.service as serviceType",
    ]
  ) {
    assertStringIncludes(query, field);
  }
});

Deno.test("buildSpansByTraceQuery has no agent filter - trace ids are globally unique", () => {
  const query = CloudWatchQueryBuilder.buildSpansByTraceQuery("trace-1");

  assertStringIncludes(query, "| filter traceId = 'trace-1'");
  assertEquals(query.includes("parsedAgentId"), false);
  assertStringIncludes(query, "| sort startTimeUnixNano asc");
});

Deno.test("buildRuntimeLogsByTracesBatch quotes every trace id into one IN clause", () => {
  const query = CloudWatchQueryBuilder.buildRuntimeLogsByTracesBatch(["t1", "t2", "t3"]);

  assertStringIncludes(query, "fields @timestamp, @message, spanId, traceId, @logStream");
  assertStringIncludes(query, "| filter traceId in ['t1', 't2', 't3']");
  assertStringIncludes(query, "| sort @timestamp asc");
});

Deno.test("buildRuntimeLogsByTracesBatch returns an empty query for no traces", () => {
  assertEquals(CloudWatchQueryBuilder.buildRuntimeLogsByTracesBatch([]), "");
});

Deno.test("buildRuntimeLogsByTraceDirect filters a single trace", () => {
  const query = CloudWatchQueryBuilder.buildRuntimeLogsByTraceDirect("t1");

  assertStringIncludes(query, "| filter traceId = 't1'");
  assertEquals(query.includes(" in ["), false);
});

Deno.test("buildLatestSessionQuery aggregates the newest session for one agent", () => {
  const query = CloudWatchQueryBuilder.buildLatestSessionQuery("agent-abc", 3);

  assertStringIncludes(query, 'filter resource.attributes.aws.service.type = "gen_ai_agent"');
  assertStringIncludes(query, "| filter parsedAgentId = 'agent-abc'");
  assertStringIncludes(query, "| stats max(endTimeUnixNano) as maxEnd by attributes.session.id");
  assertStringIncludes(query, "| sort maxEnd desc");
  assertStringIncludes(query, "| limit 3");
});

Deno.test("buildLatestSessionQuery defaults to a limit of 1", () => {
  assertStringIncludes(CloudWatchQueryBuilder.buildLatestSessionQuery("agent-abc"), "| limit 1");
});

Deno.test("getAgentRuntimeLogGroup builds the runtime log group name", () => {
  assertEquals(
    getAgentRuntimeLogGroup("agent-abc"),
    "/aws/bedrock-agentcore/runtimes/agent-abc-DEFAULT",
  );
  assertEquals(
    getAgentRuntimeLogGroup("agent-abc", "DRAFT"),
    "/aws/bedrock-agentcore/runtimes/agent-abc-DRAFT",
  );
});

Deno.test("buildSpan parses @message into attributes and resource attributes", () => {
  const message = JSON.stringify({
    spanId: "s1",
    traceId: "t1",
    startTimeUnixNano: 1700000000000000000,
    attributes: { "gen_ai.system": "strands", "session.id": "sess-1" },
    resource: { attributes: { "service.name": "travel-agent" } },
    scope: { name: "strands.telemetry.tracer" },
  });

  const span = CloudWatchResultBuilder.buildSpan([
    { field: "@timestamp", value: "2026-09-22 10:00:00.000" },
    { field: "@message", value: message },
    { field: "traceId", value: "t1" },
    { field: "spanId", value: "s1" },
    { field: "spanName", value: "invoke_agent" },
    { field: "sessionId", value: "sess-1" },
    { field: "startTimeUnixNano", value: "1700000000000000000" },
    { field: "endTimeUnixNano", value: "1700000001000000000" },
    { field: "durationMs", value: "1000.5" },
    { field: "statusCode", value: "OK" },
    { field: "kind", value: "SERVER" },
    { field: "serviceName", value: "travel-agent" },
  ]);

  assertEquals(span.traceId, "t1");
  assertEquals(span.spanId, "s1");
  assertEquals(span.spanName, "invoke_agent");
  assertEquals(span.sessionId, "sess-1");
  assertEquals(span.durationMs, 1000.5);
  assertEquals(span.statusCode, "OK");
  assertEquals(span.kind, "SERVER");
  assertEquals(span.attributes["gen_ai.system"], "strands");
  assertEquals(span.resourceAttributes["service.name"], "travel-agent");
  assertEquals(span.events, []);
  assert(span.rawMessage !== undefined);
});

Deno.test("buildSpan tolerates a missing or unparsable @message", () => {
  const span = CloudWatchResultBuilder.buildSpan([
    { field: "traceId", value: "t1" },
    { field: "@message", value: "not json" },
  ]);

  assertEquals(span.traceId, "t1");
  assertEquals(span.spanId, "");
  assertEquals(span.spanName, "");
  assertEquals(span.attributes, {});
  assertEquals(span.resourceAttributes, {});
  assertEquals(span.rawMessage, undefined);
  assertEquals(span.startTimeUnixNano, undefined);
});

Deno.test("buildRuntimeLog keeps the raw message as a parsed document", () => {
  const message = JSON.stringify({
    body: { input: "How much is 2 + 2?", output: "4" },
    timeUnixNano: 1700000000500000000,
  });

  const log = CloudWatchResultBuilder.buildRuntimeLog([
    { field: "@timestamp", value: "2026-09-22 10:00:01.000" },
    { field: "@message", value: message },
    { field: "spanId", value: "s1" },
    { field: "traceId", value: "t1" },
    { field: "@logStream", value: "runtime-logs/x" },
  ]);

  assertEquals(log.traceId, "t1");
  assertEquals(log.spanId, "s1");
  assertEquals(log.logStream, "runtime-logs/x");
  assertEquals((log.rawMessage?.body as Record<string, unknown>).output, "4");
});
