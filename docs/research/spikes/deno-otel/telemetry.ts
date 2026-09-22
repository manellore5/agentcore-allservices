// Spike telemetry. TELEMETRY_MODE:
//   "deno"  -> rely on Deno's built-in OTel (OTEL_DENO=true) + whatever OTEL_* env the runtime injects
//   "sigv4" -> our own OTel JS SDK provider exporting OTLP/protobuf, SigV4-signed, to X-Ray's OTLP endpoint
//   "none"  -> nothing
import { context, propagation, trace, type Context } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type ReadableSpan,
  type Span,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CBaggagePropagator } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import { SignatureV4 } from "@smithy/signature-v4";
import { HttpRequest } from "@smithy/protocol-http";
import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider as fromNodeProviderChain } from "@aws-sdk/credential-provider-node";

export const MODE = Deno.env.get("TELEMETRY_MODE") ?? "none";
const REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";

class SigV4OtlpSpanExporter implements SpanExporter {
  #signer = new SignatureV4({
    service: "xray",
    region: REGION,
    credentials: fromNodeProviderChain(),
    sha256: Sha256,
  });
  #host = `xray.${REGION}.amazonaws.com`;

  export(spans: ReadableSpan[], done: (r: { code: number; error?: Error }) => void) {
    (async () => {
      const body = new Uint8Array(ProtobufTraceSerializer.serializeRequest(spans)!);
      const req = new HttpRequest({
        method: "POST",
        protocol: "https:",
        hostname: this.#host,
        path: "/v1/traces",
        headers: { host: this.#host, "content-type": "application/x-protobuf" },
        body: body as BodyInit,
      });
      const signed = await this.#signer.sign(req);
      const res = await fetch(`https://${this.#host}/v1/traces`, {
        method: "POST",
        headers: signed.headers as Record<string, string>,
        body: body as BodyInit,
      });
      const text = await res.text();
      console.log(JSON.stringify({ spike: "export", status: res.status, spans: spans.length, body: text.slice(0, 300) }));
      done({ code: res.ok ? 0 : 1 });
    })().catch((e) => {
      console.log(JSON.stringify({ spike: "export_error", error: String(e) }));
      done({ code: 1, error: e });
    });
  }
  shutdown() {
    return Promise.resolve();
  }
}

// Copies session.id from baggage onto every span, like ADOT's attribute-propagating processor.
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

function resourceAttrs(): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const kv of (Deno.env.get("OTEL_RESOURCE_ATTRIBUTES") ?? "").split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) attrs[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim());
  }
  attrs["service.name"] = Deno.env.get("OTEL_SERVICE_NAME") ?? attrs["service.name"] ?? "ts_port_spike";
  attrs["telemetry.sdk.language"] = "nodejs";
  return attrs;
}

export let provider: BasicTracerProvider | undefined;

export function setupTelemetry() {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(Deno.env.toObject())) {
    env[k] = /^(OTEL_|AGENT_|DISABLE_|AWS_REGION|AWS_DEFAULT_REGION|BEDROCK_)/.test(k) ? v : "<set>";
  }
  console.log(JSON.stringify({ spike: "startup", mode: MODE, env }));

  if (MODE !== "sigv4") return;
  provider = new BasicTracerProvider({
    resource: resourceFromAttributes(resourceAttrs()),
    spanProcessors: [
      new SessionIdProcessor(),
      new BatchSpanProcessor(new SigV4OtlpSpanExporter(), { scheduledDelayMillis: 1000 }),
    ],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CBaggagePropagator());
  trace.setGlobalTracerProvider(provider);
}

export async function withSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const bag = propagation.createBaggage({ "session.id": { value: sessionId } });
  const ctx = propagation.setBaggage(context.active(), bag);
  return await context.with(ctx, () =>
    trace.getTracer("ts_port_spike").startActiveSpan("invoke_agent ts_port_spike", async (span) => {
      span.setAttribute("session.id", sessionId);
      span.setAttribute("gen_ai.operation.name", "invoke_agent");
      try {
        return await fn();
      } finally {
        span.end();
        await provider?.forceFlush();
      }
    })
  );
}
