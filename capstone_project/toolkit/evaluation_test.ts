// Unit tests for the pure parts of the Evaluation port: which documents survive the filter, how
// they are ordered, how a trace window is cut, and how spans and logs are counted. Nothing here
// touches AWS.
import { assertEquals, assertThrows } from "@std/assert";

import type { OtelDocument, RuntimeLog, Span, TraceData } from "./observability-client.ts";
import {
  countSpanTypes,
  determineSpansForEvaluator,
  evaluationResultsToDocument,
  extractRawSpans,
  filterRelevantSpans,
  filterTracesUpTo,
  getMostRecentSpans,
  hasAllowedScope,
  hasConversationBody,
  hasGenAiAttributes,
  isBuiltinEvaluator,
  referenceInputsToApiList,
  resolveExpectedResponse,
  validateEvaluatorConfig,
} from "./evaluation.ts";

function spanDoc(
  { spanId, traceId, startTimeUnixNano, scope, attributes }: {
    spanId: string;
    traceId: string;
    startTimeUnixNano: number;
    scope?: string;
    attributes?: OtelDocument;
  },
): OtelDocument {
  const doc: OtelDocument = { spanId, traceId, startTimeUnixNano };
  if (scope !== undefined) doc.scope = { name: scope };
  if (attributes !== undefined) doc.attributes = attributes;
  return doc;
}

function logDoc(
  { traceId, timeUnixNano, body }: {
    traceId: string;
    timeUnixNano: number;
    body: OtelDocument;
  },
): OtelDocument {
  return { traceId, timeUnixNano, body };
}

function span(traceId: string, startTimeUnixNano: number, rawMessage: OtelDocument): Span {
  return {
    traceId,
    spanId: String(rawMessage.spanId ?? ""),
    spanName: "invoke",
    startTimeUnixNano,
    events: [],
    attributes: {},
    resourceAttributes: {},
    rawMessage,
  };
}

function runtimeLog(traceId: string, rawMessage: OtelDocument): RuntimeLog {
  return { timestamp: "2026-09-22 10:00:00.000", message: "", traceId, rawMessage };
}

// ---------------------------------------------------------------------------
// Document predicates
// ---------------------------------------------------------------------------

Deno.test("hasAllowedScope accepts the three known instrumentation scopes only", () => {
  for (
    const name of [
      "strands.telemetry.tracer",
      "opentelemetry.instrumentation.langchain",
      "openinference.instrumentation.langchain",
    ]
  ) {
    assertEquals(hasAllowedScope({ scope: { name } }), true);
  }
  assertEquals(hasAllowedScope({ scope: { name: "strands-agents" } }), false);
  assertEquals(hasAllowedScope({ scope: "strands.telemetry.tracer" }), false);
  assertEquals(hasAllowedScope({}), false);
});

Deno.test("hasGenAiAttributes spots gen_ai attributes, flat or nested", () => {
  assertEquals(hasGenAiAttributes({ attributes: { "gen_ai.system": "strands" } }), true);
  assertEquals(hasGenAiAttributes({ attributes: { gen_ai: { system: "strands" } } }), true);
  assertEquals(hasGenAiAttributes({ attributes: { "session.id": "s" } }), false);
  // `gen_aixyz` must not match the `gen_ai.` prefix.
  assertEquals(hasGenAiAttributes({ attributes: { gen_aixyz: 1 } }), false);
  assertEquals(hasGenAiAttributes({}), false);
});

Deno.test("hasConversationBody spots log bodies carrying input or output", () => {
  assertEquals(hasConversationBody({ body: { input: "hi" } }), true);
  assertEquals(hasConversationBody({ body: { output: "there" } }), true);
  assertEquals(hasConversationBody({ body: { message: "hi" } }), false);
  assertEquals(hasConversationBody({ body: "hi" }), false);
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

Deno.test("filterRelevantSpans keeps scoped spans, gen_ai spans and conversation logs", () => {
  // A Strands TypeScript agent whose tracer was NOT renamed: the scope is the service name, so
  // the Python filter would drop this span. It carries gen_ai attributes, so this port keeps it.
  const tsStrandsSpan = spanDoc({
    spanId: "s2",
    traceId: "t1",
    startTimeUnixNano: 2,
    scope: "strands-agents",
    attributes: { "gen_ai.operation.name": "chat" },
  });
  const pythonStrandsSpan = spanDoc({
    spanId: "s1",
    traceId: "t1",
    startTimeUnixNano: 1,
    scope: "strands.telemetry.tracer",
  });
  const httpSpan = spanDoc({
    spanId: "s3",
    traceId: "t1",
    startTimeUnixNano: 3,
    scope: "@opentelemetry/instrumentation-http",
    attributes: { "http.method": "POST" },
  });
  const conversationLog = logDoc({
    traceId: "t1",
    timeUnixNano: 4,
    body: { input: "2+2?", output: "4" },
  });
  const noiseLog = logDoc({ traceId: "t1", timeUnixNano: 5, body: { message: "started" } });

  const kept = filterRelevantSpans([
    pythonStrandsSpan,
    tsStrandsSpan,
    httpSpan,
    conversationLog,
    noiseLog,
  ]);

  assertEquals(kept, [pythonStrandsSpan, tsStrandsSpan, conversationLog]);
});

Deno.test("extractRawSpans pulls the raw documents from spans then runtime logs", () => {
  const spanRaw = spanDoc({ spanId: "s1", traceId: "t1", startTimeUnixNano: 1 });
  const logRaw = logDoc({ traceId: "t1", timeUnixNano: 2, body: { input: "hi" } });
  const traceData: TraceData = {
    sessionId: "sess",
    spans: [span("t1", 1, spanRaw), { ...span("t1", 2, {}), rawMessage: undefined }],
    runtimeLogs: [runtimeLog("t1", logRaw), { ...runtimeLog("t1", {}), rawMessage: undefined }],
  };

  assertEquals(extractRawSpans(traceData), [spanRaw, logRaw]);
});

// ---------------------------------------------------------------------------
// Chronological ordering
// ---------------------------------------------------------------------------

Deno.test("getMostRecentSpans sorts newest first across spans and logs", () => {
  const first = spanDoc({
    spanId: "s1",
    traceId: "t1",
    startTimeUnixNano: 100,
    scope: "strands.telemetry.tracer",
  });
  const middle = logDoc({ traceId: "t1", timeUnixNano: 200, body: { input: "hi" } });
  const last = spanDoc({
    spanId: "s2",
    traceId: "t2",
    startTimeUnixNano: 300,
    scope: "strands.telemetry.tracer",
  });

  const traceData: TraceData = {
    spans: [span("t1", 100, first), span("t2", 300, last)],
    runtimeLogs: [runtimeLog("t1", middle)],
  };

  assertEquals(getMostRecentSpans(traceData), [last, middle, first]);
});

Deno.test("getMostRecentSpans truncates to maxItems, keeping the newest", () => {
  const docs = [1, 2, 3, 4].map((n) =>
    spanDoc({
      spanId: `s${n}`,
      traceId: "t1",
      startTimeUnixNano: n,
      scope: "strands.telemetry.tracer",
    })
  );
  const traceData: TraceData = {
    spans: docs.map((doc, i) => span("t1", i + 1, doc)),
    runtimeLogs: [],
  };

  assertEquals(getMostRecentSpans(traceData, 2), [docs[3], docs[2]]);
});

Deno.test("getMostRecentSpans returns nothing when there is nothing relevant", () => {
  assertEquals(getMostRecentSpans({ spans: [], runtimeLogs: [] }), []);
  assertEquals(
    getMostRecentSpans({
      spans: [span("t1", 1, spanDoc({ spanId: "s1", traceId: "t1", startTimeUnixNano: 1 }))],
      runtimeLogs: [],
    }),
    [],
  );
});

Deno.test("filterTracesUpTo keeps the target trace and every earlier one", () => {
  const raws = {
    t1: spanDoc({ spanId: "a", traceId: "t1", startTimeUnixNano: 10 }),
    t2: spanDoc({ spanId: "b", traceId: "t2", startTimeUnixNano: 20 }),
    t3: spanDoc({ spanId: "c", traceId: "t3", startTimeUnixNano: 30 }),
  };
  const traceData: TraceData = {
    sessionId: "sess",
    agentId: "agent",
    // Deliberately out of order, and with a later span for t1 to test the earliest-start rule.
    spans: [
      span("t3", 30, raws.t3),
      span("t1", 40, raws.t1),
      span("t1", 10, raws.t1),
      span("t2", 20, raws.t2),
    ],
    runtimeLogs: [
      runtimeLog("t1", logDoc({ traceId: "t1", timeUnixNano: 11, body: { input: "a" } })),
      runtimeLog("t3", logDoc({ traceId: "t3", timeUnixNano: 31, body: { input: "c" } })),
    ],
  };

  const filtered = filterTracesUpTo(traceData, "t2");

  assertEquals(new Set(filtered.spans.map((s) => s.traceId)), new Set(["t1", "t2"]));
  assertEquals(filtered.runtimeLogs.map((l) => l.traceId), ["t1"]);
  assertEquals(filtered.sessionId, "sess");
});

Deno.test("filterTracesUpTo keeps everything when the target is the last trace", () => {
  const traceData: TraceData = {
    spans: [
      span("t1", 10, spanDoc({ spanId: "a", traceId: "t1", startTimeUnixNano: 10 })),
      span("t2", 20, spanDoc({ spanId: "b", traceId: "t2", startTimeUnixNano: 20 })),
    ],
    runtimeLogs: [],
  };

  assertEquals(filterTracesUpTo(traceData, "t2").spans.length, 2);
});

// ---------------------------------------------------------------------------
// Span vs log counting
// ---------------------------------------------------------------------------

Deno.test("countSpanTypes separates spans from logs and counts recognised spans", () => {
  const docs = [
    spanDoc({
      spanId: "s1",
      traceId: "t1",
      startTimeUnixNano: 1,
      scope: "strands.telemetry.tracer",
    }),
    spanDoc({
      spanId: "s2",
      traceId: "t1",
      startTimeUnixNano: 2,
      scope: "strands-agents",
      attributes: { "gen_ai.operation.name": "chat" },
    }),
    spanDoc({ spanId: "s3", traceId: "t1", startTimeUnixNano: 3, scope: "http" }),
    logDoc({ traceId: "t1", timeUnixNano: 4, body: { input: "hi" } }),
    logDoc({ traceId: "t1", timeUnixNano: 5, body: { message: "noise" } }),
  ];

  assertEquals(countSpanTypes(docs), {
    spansCount: 3,
    logsCount: 2,
    // The renamed-scope span and the gen_ai span; not the plain HTTP span, not the logs.
    scopedSpansCount: 2,
  });
});

Deno.test("countSpanTypes reports zeroes for an empty set", () => {
  assertEquals(countSpanTypes([]), { spansCount: 0, logsCount: 0, scopedSpansCount: 0 });
});

// ---------------------------------------------------------------------------
// Level routing
// ---------------------------------------------------------------------------

Deno.test("determineSpansForEvaluator sends the whole session for SESSION level", () => {
  const raw = spanDoc({
    spanId: "s1",
    traceId: "t1",
    startTimeUnixNano: 1,
    scope: "strands.telemetry.tracer",
  });
  const traceData: TraceData = { spans: [span("t1", 1, raw)], runtimeLogs: [] };

  const result = determineSpansForEvaluator({ evaluatorLevel: "SESSION", traceData });

  assertEquals(result.spans, [raw]);
  assertEquals(result.evaluationTarget, undefined);
});

Deno.test("determineSpansForEvaluator targets one trace at TRACE level", () => {
  const rawA = spanDoc({
    spanId: "a",
    traceId: "t1",
    startTimeUnixNano: 10,
    scope: "strands.telemetry.tracer",
  });
  const rawB = spanDoc({
    spanId: "b",
    traceId: "t2",
    startTimeUnixNano: 20,
    scope: "strands.telemetry.tracer",
  });
  const rawC = spanDoc({
    spanId: "c",
    traceId: "t3",
    startTimeUnixNano: 30,
    scope: "strands.telemetry.tracer",
  });
  const traceData: TraceData = {
    spans: [span("t1", 10, rawA), span("t2", 20, rawB), span("t3", 30, rawC)],
    runtimeLogs: [],
  };

  const targeted = determineSpansForEvaluator({
    evaluatorLevel: "TRACE",
    traceData,
    traceId: "t2",
  });
  assertEquals(targeted.spans, [rawB, rawA]);
  assertEquals(targeted.evaluationTarget, { traceIds: ["t2"] });

  const untargeted = determineSpansForEvaluator({ evaluatorLevel: "TRACE", traceData });
  assertEquals(untargeted.spans, [rawC, rawB, rawA]);
  assertEquals(untargeted.evaluationTarget, undefined);
});

Deno.test("determineSpansForEvaluator rejects an unknown level", () => {
  assertThrows(
    () =>
      determineSpansForEvaluator({
        evaluatorLevel: "TOOL_CALL",
        traceData: { spans: [], runtimeLogs: [] },
      }),
    Error,
    "Unknown evaluator level: TOOL_CALL",
  );
});

// ---------------------------------------------------------------------------
// Reference inputs
// ---------------------------------------------------------------------------

Deno.test("referenceInputsToApiList splits session-level from trace-level inputs", () => {
  const items = referenceInputsToApiList({
    assertions: ["stays in scope"],
    expectedTrajectory: ["calculator"],
    expectedResponse: { "t1": "4" },
  }, "sess-1");

  assertEquals(items, [
    {
      context: { spanContext: { sessionId: "sess-1" } },
      assertions: [{ text: "stays in scope" }],
      expectedTrajectory: { toolNames: ["calculator"] },
    },
    {
      context: { spanContext: { sessionId: "sess-1", traceId: "t1" } },
      expectedResponse: { text: "4" },
    },
  ]);
});

Deno.test("referenceInputsToApiList skips an unresolved expectedResponse string", () => {
  assertEquals(referenceInputsToApiList({ expectedResponse: "4" }, "sess-1"), []);
});

Deno.test("resolveExpectedResponse pins a bare string to the session's earliest trace", () => {
  // getMostRecentSpans hands back newest-first, so the earliest trace is at the end.
  const otelSpans: OtelDocument[] = [
    { traceId: "t3", startTimeUnixNano: 30 },
    { traceId: "t2", startTimeUnixNano: 20 },
    { traceId: "t1", startTimeUnixNano: 10 },
  ];

  assertEquals(
    resolveExpectedResponse({ expectedResponse: "4" }, otelSpans).expectedResponse,
    { t1: "4" },
  );
  assertEquals(
    resolveExpectedResponse({ expectedResponse: "4" }, otelSpans, "t2").expectedResponse,
    { t2: "4" },
  );
});

Deno.test("resolveExpectedResponse leaves a record and the caller's object alone", () => {
  const original = { expectedResponse: { t9: "9" }, assertions: ["a"] };
  const resolved = resolveExpectedResponse(original, []);

  assertEquals(resolved.expectedResponse, { t9: "9" });
  assertEquals(original.expectedResponse, { t9: "9" });
});

// ---------------------------------------------------------------------------
// Evaluator helpers and result serialisation
// ---------------------------------------------------------------------------

Deno.test("isBuiltinEvaluator recognises the Builtin. prefix", () => {
  assertEquals(isBuiltinEvaluator("Builtin.GoalSuccessRate"), true);
  assertEquals(isBuiltinEvaluator("response_quality_with_scope-abc123"), false);
});

Deno.test("validateEvaluatorConfig requires an llmAsAJudge key", () => {
  validateEvaluatorConfig({ llmAsAJudge: {} });
  assertThrows(
    () => validateEvaluatorConfig({ modelConfig: {} }),
    Error,
    "Config must contain 'llmAsAJudge' key",
  );
});

Deno.test("evaluationResultsToDocument summarises successes and failures", () => {
  const doc = evaluationResultsToDocument({
    sessionId: "sess-1",
    traceId: "t1",
    results: [
      {
        evaluatorId: "Builtin.Correctness",
        evaluatorName: "Builtin.Correctness",
        evaluatorArn: "arn:1",
        explanation: "good",
        context: {},
        value: 1,
      },
      {
        evaluatorId: "custom",
        evaluatorName: "custom",
        evaluatorArn: "",
        explanation: "Evaluation failed: boom",
        context: {},
        error: "boom",
      },
    ],
    inputData: { spans: [{ spanId: "s1" }] },
  });

  assertEquals(doc.sessionId, "sess-1");
  assertEquals(doc.traceId, "t1");
  assertEquals(doc.summary, { totalEvaluations: 2, successful: 1, failed: 1 });
  // The input spans go to their own file, never into the results document.
  assertEquals("inputData" in doc, false);
});
