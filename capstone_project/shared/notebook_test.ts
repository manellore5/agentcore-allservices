import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { maskKey, sh } from "./notebook.ts";

Deno.test("maskKey shows only the last four characters", () => {
  assertEquals(maskKey("abcdef123456"), "********3456");
  assertEquals(maskKey(undefined), "Not configured");
  assertEquals(maskKey(""), "Not configured");
});

Deno.test("sh captures and returns a command's output", async () => {
  const result = await sh("echo", ["hello from the shell"], { quiet: true });
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "hello from the shell");
  assertEquals(result.stderr, "");
});

Deno.test("sh reports a non-zero exit without throwing by default", async () => {
  const result = await sh("sh", ["-c", "echo oops >&2; exit 3"], { quiet: true });
  assertEquals(result.code, 3);
  assertStringIncludes(result.stderr, "oops");
});

Deno.test("sh with check throws on a non-zero exit", async () => {
  await assertRejects(
    () => sh("sh", ["-c", "exit 1"], { quiet: true, check: true }),
    Error,
    "exited with 1",
  );
});

Deno.test("sh prints what it captured, because the kernel hides child output", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    await sh("echo", ["visible in the notebook"]);
  } finally {
    console.log = original;
  }
  assert(lines.some((l) => l.includes("visible in the notebook")), lines.join("|"));
});

Deno.test("state round-trips a value and deletes it again", async () => {
  const { state } = await import("./notebook.ts");
  const key = `__test_${crypto.randomUUID()}`;
  try {
    assertEquals(await state.get(key), undefined);
    await state.set(key, { memoryId: "mem-123", ready: true });
    assertEquals(await state.get(key), { memoryId: "mem-123", ready: true });
    assertEquals(await state.require(key), { memoryId: "mem-123", ready: true });
  } finally {
    await state.delete(key);
  }
  assertEquals(await state.get(key), undefined);
});

Deno.test("state.require names the notebook that should have set the value", async () => {
  const { state } = await import("./notebook.ts");
  await assertRejects(
    () => state.require("__never_set__", "notebook 04"),
    Error,
    "run notebook 04 first",
  );
});
