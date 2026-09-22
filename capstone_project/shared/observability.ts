// Preloaded telemetry for the course's Deno agents on AgentCore Runtime.
//
// Loaded with `deno run -A --preload capstone_project/shared/observability.ts <agent>.ts`, which is the
// counterpart of Python's `opentelemetry-instrument python <agent>.py`: agent code imports nothing from here.
// Traces go to the X-Ray OTLP endpoint and conversation logs to the CloudWatch Logs OTLP endpoint, both
// SigV4-signed, because AWS ships no ADOT distro that works under Deno. The AgentCore runtime injects
// AGENT_OBSERVABILITY_ENABLED, OTEL_RESOURCE_ATTRIBUTES and OTEL_EXPORTER_OTLP_LOGS_HEADERS, but no endpoint.
//
// Verified end to end in AgentCore Runtime; see the spikes on branch `research/deno-observability-spike`.
import http from "node:http";
import { type Context, context, propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import type { LogBody } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ProtobufLogsSerializer, ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

const env = (k: string) => Deno.env.get(k);
const REGION = env("AWS_REGION") ?? "us-east-1";
const ENABLED = env("AGENT_OBSERVABILITY_ENABLED") === "true" &&
  env("DISABLE_ADOT_OBSERVABILITY") !== "true";
const SESSION_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id";
const credentials = defaultProvider();

export function parseKv(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of (s ?? "").split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) out[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim());
  }
  return out;
}

async function signedPost(
  service: string,
  path: string,
  body: Uint8Array,
  extra: Record<string, string> = {},
) {
  const host = `${service}.${REGION}.amazonaws.com`;
  const signer = new SignatureV4({ service, region: REGION, credentials, sha256: Sha256 });
  const req = new HttpRequest({
    method: "POST",
    protocol: "https:",
    hostname: host,
    path,
    headers: { host, "content-type": "application/x-protobuf", ...extra },
    body,
  });
  const signed = await signer.sign(req);
  const res = await fetch(`https://${host}${path}`, {
    method: "POST",
    headers: signed.headers as Record<string, string>,
    body: body as BodyInit,
  });
  const text = await res.text();
  if (!res.ok) {
    console.log(
      JSON.stringify({
        observability: "export_failed",
        service,
        status: res.status,
        body: text.slice(0, 300),
      }),
    );
  }
  return res.ok;
}

class SigV4SpanExporter implements SpanExporter {
  export(spans: ReadableSpan[], done: (r: { code: number }) => void) {
    const body = new Uint8Array(ProtobufTraceSerializer.serializeRequest(spans)!);
    signedPost("xray", "/v1/traces", body).then(
      (ok) => done({ code: ok ? 0 : 1 }),
      () => done({ code: 1 }),
    );
  }
  shutdown() {
    return Promise.resolve();
  }
}

class SigV4LogExporter implements LogRecordExporter {
  #headers = parseKv(env("OTEL_EXPORTER_OTLP_LOGS_HEADERS"));
  export(logs: ReadableLogRecord[], done: (r: { code: number }) => void) {
    const body = new Uint8Array(ProtobufLogsSerializer.serializeRequest(logs)!);
    const extra: Record<string, string> = {};
    for (const k of ["x-aws-log-group", "x-aws-log-stream"]) {
      if (this.#headers[k]) extra[k] = this.#headers[k];
    }
    signedPost("logs", "/v1/logs", body, extra).then(
      (ok) => done({ code: ok ? 0 : 1 }),
      () => done({ code: 1 }),
    );
  }
  forceFlush() {
    return Promise.resolve();
  }
  shutdown() {
    return Promise.resolve();
  }
}

// Copies session.id from baggage onto every span (what ADOT's baggage processor does for Python).
class SessionIdProcessor implements SpanProcessor {
  onStart(span: Span, ctx: Context) {
    const sid = propagation.getBaggage(ctx)?.getEntry("session.id")?.value;
    if (sid) span.setAttribute("session.id", sid);
  }
  onEnd() {}
  forceFlush() {
    return Promise.resolve();
  }
  shutdown() {
    return Promise.resolve();
  }
}

export interface Message {
  role: string;
  content: string;
}

/** Splits a span's gen_ai.* events into the {input, output} messages an evaluation log record carries. */
export function conversationFromEvents(
  events: readonly { name: string; attributes?: Record<string, unknown> }[],
): { input: Message[]; output: Message[] } {
  const input: Message[] = [];
  const output: Message[] = [];
  for (const ev of events) {
    const a = (ev.attributes ?? {}) as Record<string, unknown>;
    const m = /^gen_ai\.(user|system|assistant|tool)\.message$/.exec(ev.name);
    if (m) input.push({ role: m[1], content: String(a.content ?? a.message ?? "") });
    else if (ev.name === "gen_ai.choice") {
      output.push({ role: "assistant", content: String(a.message ?? a.content ?? "") });
    }
  }
  return { input, output };
}

// Turns gen_ai message span events into one log record per span with body {input, output},
// the shape AgentCore Evaluations and the GenAI dashboard read (ADOT's "LLO" handling for Python).
class ConversationLogProcessor implements SpanProcessor {
  constructor(private logs: LoggerProvider) {}
  onStart() {}
  onEnd(span: ReadableSpan) {
    const { input, output } = conversationFromEvents(span.events);
    if (!input.length && !output.length) return;
    const scope = span.instrumentationScope.name;
    this.logs.getLogger(scope).emit({
      context: trace.setSpanContext(ROOT_CONTEXT, span.spanContext()),
      // The OTel types model a log body as a Map; AgentCore Evaluations reads a plain JSON object.
      body: { input: { messages: input }, output: { messages: output } } as unknown as LogBody,
      attributes: {
        "event.name": scope,
        "session.id": String(span.attributes["session.id"] ?? ""),
      },
    });
  }
  forceFlush() {
    return Promise.resolve();
  }
  shutdown() {
    return Promise.resolve();
  }
}

// Runs every incoming HTTP request inside an OTel context carrying the runtime session id as baggage,
// so the agent code needs no telemetry calls. BedrockAgentCoreApp (Fastify) creates its server via node:http.
function instrumentHttpServer() {
  const orig = http.createServer;
  // deno-lint-ignore no-explicit-any
  (http as any).createServer = (...args: any[]) => {
    const i = args.findIndex((a) => typeof a === "function");
    if (i >= 0) {
      const listener = args[i];
      args[i] = (req: http.IncomingMessage, res: http.ServerResponse) => {
        let ctx = propagation.extract(ROOT_CONTEXT, req.headers);
        const sid = req.headers[SESSION_HEADER];
        if (typeof sid === "string" && sid) {
          const bag = (propagation.getBaggage(ctx) ?? propagation.createBaggage()).setEntry(
            "session.id",
            { value: sid },
          );
          ctx = propagation.setBaggage(ctx, bag);
        }
        return context.with(ctx, () => listener(req, res));
      };
    }
    // deno-lint-ignore no-explicit-any
    return (orig as any)(...args);
  };
}

if (ENABLED) {
  const resource = resourceFromAttributes({
    ...parseKv(env("OTEL_RESOURCE_ATTRIBUTES")),
    ...(env("OTEL_SERVICE_NAME") ? { "service.name": env("OTEL_SERVICE_NAME")! } : {}),
    "telemetry.sdk.language": "nodejs",
  });
  const logs = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor(new SigV4LogExporter(), { scheduledDelayMillis: 1000 }),
    ],
  });
  const tracer = new BasicTracerProvider({
    resource,
    spanProcessors: [
      new SessionIdProcessor(),
      new ConversationLogProcessor(logs),
      new BatchSpanProcessor(new SigV4SpanExporter(), { scheduledDelayMillis: 1000 }),
    ],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );
  // Strands TS names its tracer after the service name ("strands-agents" by default); AgentCore Evaluations
  // recognises Strands spans by the Python scope name, so register it under that name.
  const strandsScope = env("OTEL_SERVICE_NAME") || "strands-agents";
  trace.setGlobalTracerProvider({
    getTracer: (name, version, options) =>
      tracer.getTracer(name === strandsScope ? "strands.telemetry.tracer" : name, version, options),
  });
  instrumentHttpServer();
  console.log(JSON.stringify({ observability: "enabled", region: REGION }));
}
