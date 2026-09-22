import { assertEquals } from "@std/assert";
import { conversationFromEvents, parseKv } from "./observability.ts";

Deno.test("parseKv reads the runtime's OTEL_RESOURCE_ATTRIBUTES", () => {
  const attrs = parseKv(
    "service.name=my_agent.DEFAULT,cloud.provider=aws,aws.log.stream.names=otel-rt-logs",
  );
  assertEquals(attrs["service.name"], "my_agent.DEFAULT");
  assertEquals(attrs["cloud.provider"], "aws");
  assertEquals(attrs["aws.log.stream.names"], "otel-rt-logs");
});

Deno.test("parseKv url-decodes values and ignores malformed entries", () => {
  assertEquals(parseKv("a=x%20y,b,,c=1=2")["a"], "x y");
  assertEquals(parseKv("a=x,b")["b"], undefined);
  assertEquals(parseKv("c=1=2")["c"], "1=2");
});

Deno.test("parseKv returns nothing for empty input", () => {
  assertEquals(parseKv(undefined), {});
  assertEquals(parseKv(""), {});
});

Deno.test("conversationFromEvents splits Strands gen_ai events into input and output", () => {
  const { input, output } = conversationFromEvents([
    { name: "gen_ai.system.message", attributes: { content: "You are a travel helper." } },
    { name: "gen_ai.user.message", attributes: { content: "5 nights at $180?" } },
    { name: "gen_ai.choice", attributes: { message: "$900", finish_reason: "end_turn" } },
  ]);
  assertEquals(input, [
    { role: "system", content: "You are a travel helper." },
    { role: "user", content: "5 nights at $180?" },
  ]);
  assertEquals(output, [{ role: "assistant", content: "$900" }]);
});

Deno.test("conversationFromEvents keeps tool messages and skips unrelated events", () => {
  const { input, output } = conversationFromEvents([
    { name: "gen_ai.tool.message", attributes: { content: '{"expression":"5*180"}' } },
    { name: "exception", attributes: { "exception.type": "Error" } },
  ]);
  assertEquals(input, [{ role: "tool", content: '{"expression":"5*180"}' }]);
  assertEquals(output, []);
});

Deno.test("conversationFromEvents returns empty lists for a span with no conversation", () => {
  assertEquals(conversationFromEvents([]), { input: [], output: [] });
  assertEquals(conversationFromEvents([{ name: "some.event" }]), { input: [], output: [] });
});
