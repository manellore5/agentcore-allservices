// Unit tests for the pure helpers ported out of Python's `MemoryClient`. No AWS calls: every test
// here exercises logic that the Python client does before or after the boto3 call.
import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  addDefaultNamespaces,
  buildNamespaceParams,
  DEFAULT_NAMESPACES,
  FALLBACK_NAMESPACES,
  hasWaitBudget,
  type MemoryStrategyDict,
  nextPageSize,
  normalizeMemoryResponse,
  normalizeMemorySummary,
  normalizeStrategy,
  StrategyType,
  toConversationalPayload,
  validateNamespace,
} from "./memory.ts";

// --- addDefaultNamespaces ---------------------------------------------------------------------

Deno.test("addDefaultNamespaces fills the default templates per strategy type", () => {
  const strategies: MemoryStrategyDict[] = [
    { [StrategyType.SEMANTIC]: { name: "TravelSemantic" } },
    { [StrategyType.SUMMARY]: { name: "TravelSummary" } },
    { [StrategyType.USER_PREFERENCE]: { name: "TravelPreferences" } },
    { [StrategyType.EPISODIC]: { name: "TravelEpisodic" } },
  ];

  const processed = addDefaultNamespaces(strategies);

  assertEquals(
    processed[0][StrategyType.SEMANTIC].namespaceTemplates,
    DEFAULT_NAMESPACES[StrategyType.SEMANTIC],
  );
  assertEquals(
    processed[1][StrategyType.SUMMARY].namespaceTemplates,
    DEFAULT_NAMESPACES[StrategyType.SUMMARY],
  );
  assertEquals(
    processed[2][StrategyType.USER_PREFERENCE].namespaceTemplates,
    DEFAULT_NAMESPACES[StrategyType.USER_PREFERENCE],
  );
  assertEquals(
    processed[3][StrategyType.EPISODIC].namespaceTemplates,
    DEFAULT_NAMESPACES[StrategyType.EPISODIC],
  );
});

Deno.test("addDefaultNamespaces falls back for strategy types without a default", () => {
  const processed = addDefaultNamespaces([
    { [StrategyType.CUSTOM]: { name: "TravelCustom" } },
  ]);

  assertEquals(
    processed[0][StrategyType.CUSTOM].namespaceTemplates,
    [...FALLBACK_NAMESPACES],
  );
});

Deno.test("addDefaultNamespaces respects a caller-supplied deprecated `namespaces` key", () => {
  // This is the shape the course's memory_setup uses.
  const processed = addDefaultNamespaces([
    {
      [StrategyType.USER_PREFERENCE]: {
        name: "TravelPreferences",
        namespaces: ["travel/user/{actorId}/preferences"],
      },
    },
  ]);

  const config = processed[0][StrategyType.USER_PREFERENCE];
  assertEquals(config.namespaces, ["travel/user/{actorId}/preferences"]);
  assertEquals(config.namespaceTemplates, undefined);
});

Deno.test("addDefaultNamespaces respects a caller-supplied `namespaceTemplates` key", () => {
  const processed = addDefaultNamespaces([
    {
      [StrategyType.SEMANTIC]: {
        name: "TravelSemantic",
        namespaceTemplates: ["travel/user/{actorId}/semantic"],
      },
    },
  ]);

  assertEquals(
    processed[0][StrategyType.SEMANTIC].namespaceTemplates,
    ["travel/user/{actorId}/semantic"],
  );
});

Deno.test("addDefaultNamespaces does not mutate the caller's strategies", () => {
  const strategies: MemoryStrategyDict[] = [
    { [StrategyType.SEMANTIC]: { name: "TravelSemantic" } },
  ];

  const processed = addDefaultNamespaces(strategies);

  assertEquals(strategies[0][StrategyType.SEMANTIC].namespaceTemplates, undefined);
  assert(processed[0] !== strategies[0]);
});

// --- validateNamespace ------------------------------------------------------------------------

Deno.test("validateNamespace accepts everything, warning only on unknown template variables", () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (msg: string) => warnings.push(msg);
  try {
    assertEquals(validateNamespace("travel/user/{actorId}/preferences"), true);
    assertEquals(validateNamespace("travel/user/static/preferences"), true);
    assertEquals(validateNamespace("travel/{tenantId}/preferences"), true);
  } finally {
    console.warn = original;
  }

  assertEquals(warnings.length, 1);
  assert(warnings[0].includes("{tenantId}"));
});

// --- buildNamespaceParams ---------------------------------------------------------------------

Deno.test("buildNamespaceParams maps an exact namespace to `namespace`", () => {
  assertEquals(buildNamespaceParams("travel/user/u1/preferences"), {
    namespace: "travel/user/u1/preferences",
  });
});

Deno.test("buildNamespaceParams maps a path prefix to `namespacePath`", () => {
  assertEquals(buildNamespaceParams(undefined, "/org/team/"), { namespacePath: "/org/team/" });
});

Deno.test("buildNamespaceParams rejects both, neither, and wildcards", () => {
  assertThrows(
    () => buildNamespaceParams("/a/", "/b/"),
    Error,
    "mutually exclusive",
  );
  assertThrows(
    () => buildNamespaceParams(),
    Error,
    "At least one of",
  );
  assertThrows(
    () => buildNamespaceParams("/a/*"),
    Error,
    "Wildcards",
  );
  assertThrows(
    () => buildNamespaceParams(undefined, "/a/*"),
    Error,
    "Wildcards",
  );
});

// --- toConversationalPayload ------------------------------------------------------------------

Deno.test("toConversationalPayload wraps [text, role] tuples and upper-cases the role", () => {
  assertEquals(
    toConversationalPayload([
      ["What's the weather?", "USER"],
      ["Today is sunny", "assistant"],
    ]),
    [
      { conversational: { content: { text: "What's the weather?" }, role: "USER" } },
      { conversational: { content: { text: "Today is sunny" }, role: "ASSISTANT" } },
    ],
  );
});

Deno.test("toConversationalPayload accepts every MessageRole", () => {
  const payload = toConversationalPayload([
    ["a", "USER"],
    ["b", "ASSISTANT"],
    ["c", "TOOL"],
    ["d", "OTHER"],
  ]);
  assertEquals(payload.length, 4);
});

Deno.test("toConversationalPayload rejects an empty message list", () => {
  assertThrows(
    () => toConversationalPayload([]),
    Error,
    "At least one message is required",
  );
});

Deno.test("toConversationalPayload rejects an unknown role", () => {
  assertThrows(
    () => toConversationalPayload([["hi", "SYSTEM"]]),
    Error,
    "Invalid role 'SYSTEM'. Must be one of: USER, ASSISTANT, TOOL, OTHER",
  );
});

// --- normalizeStrategy / normalizeMemoryResponse / normalizeMemorySummary ---------------------

Deno.test("normalizeStrategy back-fills the old field names from the new ones", () => {
  const normalized = normalizeStrategy({
    strategyId: "strat-1",
    type: "USER_PREFERENCE",
    name: "TravelPreferences",
    namespaces: ["travel/user/{actorId}/preferences"],
  });

  assertEquals(normalized.memoryStrategyId, "strat-1");
  assertEquals(normalized.memoryStrategyType, "USER_PREFERENCE");
  // getMemoryStrategies does not pair up namespaces/namespaceTemplates, matching Python.
  assertEquals(normalized.namespaceTemplates, undefined);
});

Deno.test("normalizeStrategy back-fills the new field names from the old ones", () => {
  const normalized = normalizeStrategy({
    memoryStrategyId: "strat-1",
    memoryStrategyType: "SEMANTIC",
  });

  assertEquals(normalized.strategyId, "strat-1");
  assertEquals(normalized.type, "SEMANTIC");
});

Deno.test("normalizeStrategy pairs up namespaces only when asked", () => {
  assertEquals(
    normalizeStrategy({ namespaceTemplates: ["/a/"] }, true).namespaces,
    ["/a/"],
  );
  assertEquals(
    normalizeStrategy({ namespaces: ["/a/"] }, true).namespaceTemplates,
    ["/a/"],
  );
});

Deno.test("normalizeMemoryResponse exposes both id/memoryId and strategies/memoryStrategies", () => {
  const normalized = normalizeMemoryResponse({
    id: "TravelMateMemory-abc123",
    status: "ACTIVE",
    strategies: [{ strategyId: "strat-1", type: "SEMANTIC", namespaceTemplates: ["/a/"] }],
  });

  assertEquals(normalized.memoryId, "TravelMateMemory-abc123");
  assertEquals(normalized.id, "TravelMateMemory-abc123");
  assertEquals(normalized.strategies, normalized.memoryStrategies);
  assertEquals(normalized.strategies?.[0].memoryStrategyId, "strat-1");
  assertEquals(normalized.strategies?.[0].memoryStrategyType, "SEMANTIC");
  assertEquals(normalized.strategies?.[0].namespaces, ["/a/"]);
});

Deno.test("normalizeMemoryResponse keeps an existing value rather than overwriting it", () => {
  const normalized = normalizeMemoryResponse({ id: "new-id", memoryId: "old-id" });
  assertEquals(normalized.id, "new-id");
  assertEquals(normalized.memoryId, "old-id");
});

Deno.test("normalizeMemorySummary exposes both id and memoryId", () => {
  assertEquals(normalizeMemorySummary({ id: "m-1" }).memoryId, "m-1");
  assertEquals(normalizeMemorySummary({ memoryId: "m-1" }).id, "m-1");
});

// --- hasWaitBudget / nextPageSize -------------------------------------------------------------

Deno.test("hasWaitBudget mirrors `time.time() - start_time < max_wait`", () => {
  const start = 1_000_000;
  assertEquals(hasWaitBudget(start, start, 300), true);
  assertEquals(hasWaitBudget(start, start + 299_999, 300), true);
  assertEquals(hasWaitBudget(start, start + 300_000, 300), false);
  assertEquals(hasWaitBudget(start, start + 400_000, 300), false);
});

Deno.test("nextPageSize caps each list_memories request at the service maximum of 100", () => {
  assertEquals(nextPageSize(100, 0), 100);
  assertEquals(nextPageSize(250, 0), 100);
  assertEquals(nextPageSize(250, 100), 100);
  assertEquals(nextPageSize(250, 200), 50);
  assertEquals(nextPageSize(30, 0), 30);
});
