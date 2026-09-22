import { setupTelemetry, withSession, MODE } from "./telemetry.ts";
setupTelemetry();

const { BedrockAgentCoreApp } = await import("bedrock-agentcore/runtime");
const { Agent, BedrockModel, tool } = await import("@strands-agents/sdk");
const { CodeInterpreterTools } = await import("bedrock-agentcore/experimental/code-interpreter/strands");
const { BrowserTools } = await import("bedrock-agentcore/experimental/browser/strands");
const { z } = await import("zod");

const REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const model = () => new BedrockModel({ modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0", region: REGION });

const calculator = tool({
  name: "calculator",
  description: "Evaluate a basic arithmetic expression, e.g. '2 * (3 + 4)'.",
  inputSchema: z.object({ expression: z.string() }),
  callback: ({ expression }) => {
    if (!/^[\d\s+\-*/().]+$/.test(expression)) return "invalid expression";
    return String(Function(`"use strict"; return (${expression});`)());
  },
});

async function run(action: string, prompt: string) {
  if (action === "ci") {
    const ci = new CodeInterpreterTools({ region: REGION });
    try {
      const agent = new Agent({ model: model(), tools: [...ci.tools], systemPrompt: "Use executeCode (python) to compute answers." });
      return String(await agent.invoke(prompt || "Compute the sum of squares 1..100 with python code."));
    } finally {
      await ci.stopSession?.();
    }
  }
  if (action === "browser") {
    const br = new BrowserTools({ region: REGION });
    try {
      const agent = new Agent({ model: model(), tools: [...br.tools], systemPrompt: "Use the browser tools." });
      return String(await agent.invoke(prompt || "Navigate to https://example.com and tell me the page heading."));
    } finally {
      // deno-lint-ignore no-explicit-any
      await (br as any).stopSession?.();
    }
  }
  const agent = new Agent({ model: model(), tools: [calculator], systemPrompt: "You are a travel budget helper. Use the calculator." });
  return String(await agent.invoke(prompt || "A 5-night trip at $180/night plus $400 flights: total?"));
}

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    process: async (req: unknown, ctx) => {
      const { action = "agent", prompt = "" } = (req ?? {}) as { action?: string; prompt?: string };
      const t0 = Date.now();
      try {
        const result = await withSession(ctx.sessionId, () => run(action, prompt));
        return { ok: true, mode: MODE, action, ms: Date.now() - t0, result };
      } catch (e) {
        console.log(JSON.stringify({ spike: "error", action, error: String(e), stack: (e as Error).stack }));
        return { ok: false, mode: MODE, action, error: String(e) };
      }
    },
  },
});
app.run();
