// Hand-written replacement for Python's `bedrock_agentcore.memory.MemoryClient`
// (plus the `bedrock_agentcore.memory.constants` the course notebooks import alongside it).
//
// The Python `bedrock-agentcore` SDK ships a high-level Memory client that wraps two boto3 clients
// (`bedrock-agentcore-control` for the control plane, `bedrock-agentcore` for the data plane) and adds
// the convenience the course leans on: default namespace templates per strategy type, create-and-poll
// until ACTIVE, `list_memories` pagination, and normalisation of the service's asymmetric field names
// (inputs use `memoryStrategies`/`memoryStrategyId`, outputs use `strategies`/`strategyId`).
// There is no TypeScript equivalent of that SDK — AWS publishes only the raw `@aws-sdk/client-*`
// command clients — so this module ports the handful of methods the course uses onto AWS SDK v3,
// keeping the Python method names (camelCased), argument names, defaults and return shapes so a reader
// can diff a Python cell against the TypeScript cell and see only a translation.
//
// Ported from: py-sdk/src/bedrock_agentcore/memory/client.py and .../memory/constants.py.
import {
  BedrockAgentCoreControlClient,
  CreateMemoryCommand,
  GetMemoryCommand,
  ListMemoriesCommand,
  type MemoryStrategyInput,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  BedrockAgentCoreClient,
  type Branch,
  CreateEventCommand,
  type Event as MemoryEvent,
  type ExtractionMode,
  type MemoryRecordSummary,
  type PayloadType,
  RetrieveMemoryRecordsCommand,
  type SearchCriteria,
} from "@aws-sdk/client-bedrock-agentcore";

// --- constants.py -----------------------------------------------------------------------------

/** Memory strategy types. Mirrors `constants.StrategyType`; the values are the request dict keys. */
export const StrategyType = {
  SEMANTIC: "semanticMemoryStrategy",
  SUMMARY: "summaryMemoryStrategy",
  USER_PREFERENCE: "userPreferenceMemoryStrategy",
  EPISODIC: "episodicMemoryStrategy",
  CUSTOM: "customMemoryStrategy",
} as const;
export type StrategyTypeValue = typeof StrategyType[keyof typeof StrategyType];

/** Memory resource statuses. Mirrors `constants.MemoryStatus`. */
export const MemoryStatus = {
  CREATING: "CREATING",
  ACTIVE: "ACTIVE",
  FAILED: "FAILED",
  UPDATING: "UPDATING",
  DELETING: "DELETING",
} as const;

/** Extended message roles including tool usage. Mirrors `constants.MessageRole`. */
export const MessageRole = {
  USER: "USER",
  ASSISTANT: "ASSISTANT",
  TOOL: "TOOL",
  OTHER: "OTHER",
} as const;
export type MessageRoleValue = typeof MessageRole[keyof typeof MessageRole];

const MESSAGE_ROLES: readonly string[] = Object.values(MessageRole);

/** Default namespaces for each strategy type. Mirrors `constants.DEFAULT_NAMESPACES`. */
export const DEFAULT_NAMESPACES: Readonly<Partial<Record<StrategyTypeValue, string[]>>> = {
  [StrategyType.SEMANTIC]: ["/strategies/{memoryStrategyId}/actors/{actorId}/"],
  [StrategyType.SUMMARY]: [
    "/strategies/{memoryStrategyId}/actors/{actorId}/sessions/{sessionId}/",
  ],
  [StrategyType.USER_PREFERENCE]: ["/strategies/{memoryStrategyId}/actors/{actorId}/"],
  [StrategyType.EPISODIC]: [
    "/strategies/{memoryStrategyId}/actors/{actorId}/sessions/{sessionId}/",
  ],
};

/** Fallback used by `addDefaultNamespaces` for strategy types with no default (e.g. CUSTOM). */
export const FALLBACK_NAMESPACES: readonly string[] = ["custom/{actorId}/{sessionId}/"];

// --- public shapes ----------------------------------------------------------------------------

/**
 * One strategy configuration, e.g. `{ name, description, namespaces }`. The service accepts further
 * keys (extraction/consolidation configuration) that the course does not use, hence the index
 * signature — it stands in for Python's untyped `Dict[str, Any]` strategy config.
 */
export interface StrategyConfigInput {
  name: string;
  description?: string;
  /** Deprecated service field; `addDefaultNamespaces` honours it if the caller sets it. */
  namespaces?: string[];
  namespaceTemplates?: string[];
  [key: string]: unknown;
}

/**
 * A strategy as the course writes it: a single-key dict keyed by a {@link StrategyType} value, e.g.
 * `{ [StrategyType.SEMANTIC]: { name: "TravelSemantic", namespaces: [...] } }`.
 */
export type MemoryStrategyDict = Record<string, StrategyConfigInput>;

/**
 * A strategy as `getMemoryStrategies` / `createMemoryAndWait` return it: the service's strategy object
 * carrying both the old and new field names, exactly like the dict the Python client hands back.
 */
export interface NormalizedMemoryStrategy extends Record<string, unknown> {
  name?: string;
  description?: string;
  strategyId?: string;
  memoryStrategyId?: string;
  type?: string;
  memoryStrategyType?: string;
  namespaces?: string[];
  namespaceTemplates?: string[];
  status?: string;
}

/** A memory resource carrying both `id`/`memoryId` and `strategies`/`memoryStrategies`. */
export interface NormalizedMemory extends Record<string, unknown> {
  id?: string;
  memoryId?: string;
  arn?: string;
  name?: string;
  description?: string;
  status?: string;
  failureReason?: string;
  eventExpiryDuration?: number;
  createdAt?: Date;
  updatedAt?: Date;
  strategies?: NormalizedMemoryStrategy[];
  memoryStrategies?: NormalizedMemoryStrategy[];
}

/** A `list_memories` summary carrying both `id` and `memoryId`. */
export interface NormalizedMemorySummary extends Record<string, unknown> {
  id?: string;
  memoryId?: string;
  arn?: string;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * One conversational message as a `[text, role]` tuple — the same positional pair Python takes
 * (`messages=[("Today is sunny", "ASSISTANT")]`). Tuples, not `{content, role}` objects, so the
 * notebook cells diff line for line against the Python ones. `role` is compared case-insensitively
 * against {@link MessageRole} and upper-cased, as in Python.
 */
export type EventMessage = [text: string, role: string];

/** The `namespace` / `namespacePath` pair a data-plane retrieval call takes; exactly one is set. */
export type NamespaceParams = { namespace: string } | { namespacePath: string };

export interface CreateMemoryAndWaitOptions {
  name: string;
  strategies: MemoryStrategyDict[];
  description?: string;
  /** How long to retain events. Python default: 90 days. */
  eventExpiryDays?: number;
  memoryExecutionRoleArn?: string;
  /** Maximum seconds to wait. Python default: 300. */
  maxWait?: number;
  /** Seconds between status checks. Python default: 10. */
  pollInterval?: number;
}

export interface CreateEventOptions {
  memoryId: string;
  actorId: string;
  sessionId: string;
  messages: EventMessage[];
  eventTimestamp?: Date;
  /** For new branches `{ rootEventId, name }`; for continuing one `{ name }`. */
  branch?: Branch;
  /** "SKIP" stores the event in short-term memory without triggering extraction. */
  extractionMode?: ExtractionMode;
}

export interface RetrieveMemoriesOptions {
  memoryId: string;
  /** Exact namespace to match (e.g. "travel/user/{actorId}/preferences"). */
  namespace?: string;
  query: string;
  /** Number of results to return. Python default: 3. */
  topK?: number;
  /** Hierarchical path prefix; mutually exclusive with `namespace`. */
  namespacePath?: string;
}

// --- pure helpers (the private `_`-prefixed methods on the Python class) -----------------------

/**
 * `MemoryClient._validate_namespace`: warn-only check that a templated namespace uses a known
 * variable. Always returns true, as in Python.
 */
export function validateNamespace(namespace: string): boolean {
  if (
    namespace.includes("{") &&
    !(namespace.includes("{actorId}") || namespace.includes("{sessionId}") ||
      namespace.includes("{memoryStrategyId}"))
  ) {
    console.warn(`Namespace with templates should contain valid variables: ${namespace}`);
  }
  return true;
}

/**
 * `MemoryClient._add_default_namespaces`: deep-copy each strategy and, when the caller set neither
 * `namespaceTemplates` nor the deprecated `namespaces`, fill in the default templates for its type.
 */
export function addDefaultNamespaces(strategies: MemoryStrategyDict[]): MemoryStrategyDict[] {
  const processed: MemoryStrategyDict[] = [];

  for (const strategy of strategies) {
    const strategyCopy = structuredClone(strategy);

    const strategyTypeKey = Object.keys(strategy)[0];
    const strategyConfig = strategyCopy[strategyTypeKey];

    if (!("namespaceTemplates" in strategyConfig) && !("namespaces" in strategyConfig)) {
      strategyConfig.namespaceTemplates = [
        ...(DEFAULT_NAMESPACES[strategyTypeKey as StrategyTypeValue] ?? FALLBACK_NAMESPACES),
      ];
    }

    // `_validate_strategy_config`: warn on any namespace whose templating looks wrong.
    for (const namespace of strategyConfig.namespaceTemplates ?? strategyConfig.namespaces ?? []) {
      validateNamespace(namespace);
    }

    processed.push(strategyCopy);
  }

  return processed;
}

/**
 * `_utils.namespace.build_namespace_params`: exactly one of `namespace` (exact match) or
 * `namespacePath` (hierarchical prefix), neither containing a wildcard.
 */
export function buildNamespaceParams(
  namespace?: string,
  namespacePath?: string,
): NamespaceParams {
  if (namespace !== undefined && namespacePath !== undefined) {
    throw new Error("'namespace' and 'namespacePath' are mutually exclusive.");
  }
  if (namespace === undefined && namespacePath === undefined) {
    throw new Error("At least one of 'namespace' or 'namespacePath' must be provided.");
  }

  const value = namespace !== undefined ? namespace : namespacePath as string;
  if (value.includes("*")) {
    throw new Error("Wildcards (*) are not supported in namespaces.");
  }

  return namespace !== undefined ? { namespace } : { namespacePath: namespacePath as string };
}

/**
 * The message-to-payload loop inside `MemoryClient.create_event`: validate the role against
 * {@link MessageRole} and wrap each `[text, role]` pair as a conversational payload item.
 */
export function toConversationalPayload(messages: EventMessage[]): PayloadType[] {
  if (messages.length === 0) {
    throw new Error("At least one message is required");
  }

  return messages.map((msg) => {
    if (msg.length !== 2) {
      throw new Error("Each message must be (text, role)");
    }
    const [text, role] = msg;
    const roleValue = role.toUpperCase();
    if (!MESSAGE_ROLES.includes(roleValue)) {
      throw new Error(
        `Invalid role '${role}'. Must be one of: ${MESSAGE_ROLES.join(", ")}`,
      );
    }
    return { conversational: { content: { text }, role: roleValue as MessageRoleValue } };
  });
}

/**
 * The strategy half of `MemoryClient._normalize_memory_response`, also used by
 * `get_memory_strategies`: ensure `strategyId`/`memoryStrategyId` and `type`/`memoryStrategyType`
 * both exist. `withNamespaceTemplates` mirrors Python, where only `_normalize_memory_response` also
 * pairs up `namespaces`/`namespaceTemplates` and `get_memory_strategies` does not.
 */
export function normalizeStrategy(
  strategy: Record<string, unknown>,
  withNamespaceTemplates = false,
): NormalizedMemoryStrategy {
  const normalized: NormalizedMemoryStrategy = { ...strategy };

  if ("strategyId" in strategy && !("memoryStrategyId" in normalized)) {
    normalized.memoryStrategyId = strategy.strategyId as string;
  } else if ("memoryStrategyId" in strategy && !("strategyId" in normalized)) {
    normalized.strategyId = strategy.memoryStrategyId as string;
  }

  if ("type" in strategy && !("memoryStrategyType" in normalized)) {
    normalized.memoryStrategyType = strategy.type as string;
  } else if ("memoryStrategyType" in strategy && !("type" in normalized)) {
    normalized.type = strategy.memoryStrategyType as string;
  }

  if (withNamespaceTemplates) {
    if ("namespaceTemplates" in strategy && !("namespaces" in normalized)) {
      normalized.namespaces = strategy.namespaceTemplates as string[];
    } else if ("namespaces" in strategy && !("namespaceTemplates" in normalized)) {
      normalized.namespaceTemplates = strategy.namespaces as string[];
    }
  }

  return normalized;
}

/**
 * `MemoryClient._normalize_memory_response`: the API returns the new field names but course code
 * reads the old ones, so provide both.
 */
export function normalizeMemoryResponse(memory: Record<string, unknown>): NormalizedMemory {
  const normalized: NormalizedMemory = { ...memory };

  if ("id" in memory && !("memoryId" in normalized)) {
    normalized.memoryId = memory.id as string;
  } else if ("memoryId" in memory && !("id" in normalized)) {
    normalized.id = memory.memoryId as string;
  }

  if ("strategies" in memory && !("memoryStrategies" in normalized)) {
    normalized.memoryStrategies = memory.strategies as NormalizedMemoryStrategy[];
  } else if ("memoryStrategies" in memory && !("strategies" in normalized)) {
    normalized.strategies = memory.memoryStrategies as NormalizedMemoryStrategy[];
  }

  if (normalized.strategies !== undefined) {
    const normalizedStrategies = normalized.strategies.map((s) => normalizeStrategy(s, true));
    normalized.strategies = normalizedStrategies;
    normalized.memoryStrategies = normalizedStrategies;
  }

  return normalized;
}

/** The `id`/`memoryId` pairing `MemoryClient.list_memories` applies to each summary. */
export function normalizeMemorySummary(
  memory: Record<string, unknown>,
): NormalizedMemorySummary {
  const normalized: NormalizedMemorySummary = { ...memory };
  if ("id" in memory && !("memoryId" in normalized)) {
    normalized.memoryId = memory.id as string;
  } else if ("memoryId" in memory && !("id" in normalized)) {
    normalized.id = memory.memoryId as string;
  }
  return normalized;
}

/**
 * The `while time.time() - start_time < max_wait` guard of `create_memory_and_wait`. Factored out so
 * the wait budget is unit-testable without sleeping or calling AWS.
 */
export function hasWaitBudget(startedAtMs: number, nowMs: number, maxWaitSeconds: number): boolean {
  return (nowMs - startedAtMs) / 1000 < maxWaitSeconds;
}

/**
 * The page size `list_memories` asks for next: `min(max_results - collected, 100)`, the service's
 * per-request cap.
 */
export function nextPageSize(maxResults: number, collected: number): number {
  return Math.min(maxResults - collected, 100);
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// --- client -----------------------------------------------------------------------------------

/**
 * High-level Bedrock AgentCore Memory client with the operations the course uses.
 *
 * Python: `MemoryClient(region_name=REGION)`. Here: `new MemoryClient({ region: REGION })`.
 */
export class MemoryClient {
  readonly region: string;
  /** Control plane, Python's `gmcp_client`. */
  readonly gmcpClient: BedrockAgentCoreControlClient;
  /** Data plane, Python's `gmdp_client`. */
  readonly gmdpClient: BedrockAgentCoreClient;

  constructor({ region }: { region: string }) {
    this.region = region;
    this.gmcpClient = new BedrockAgentCoreControlClient({ region });
    this.gmdpClient = new BedrockAgentCoreClient({ region });
    console.info(
      `Initialized MemoryClient for control plane: ${region}, data plane: ${region}`,
    );
  }

  /**
   * Create a memory and poll until it reaches ACTIVE status.
   *
   * Throws on FAILED status (Python `RuntimeError`) and on exhausting `maxWait` (Python
   * `TimeoutError`). Returns the normalized memory object, so `memory.id` works as in the notebooks.
   */
  async createMemoryAndWait(
    {
      name,
      strategies,
      description,
      eventExpiryDays = 90,
      memoryExecutionRoleArn,
      maxWait = 300,
      pollInterval = 10,
    }: CreateMemoryAndWaitOptions,
  ): Promise<NormalizedMemory> {
    const memory = await this.createMemory({
      name,
      strategies,
      description,
      eventExpiryDays,
      memoryExecutionRoleArn,
    });

    const memoryId = memory.memoryId ?? memory.id ?? "";
    console.info(`Created memory ${memoryId}, waiting for ACTIVE status...`);

    const startTime = Date.now();
    while (hasWaitBudget(startTime, Date.now(), maxWait)) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const status = await this.getMemoryStatus(memoryId);

      if (status === MemoryStatus.ACTIVE) {
        console.info(`Memory ${memoryId} is now ACTIVE (took ${elapsed} seconds)`);
        // Get fresh memory details.
        const response = await this.gmcpClient.send(new GetMemoryCommand({ memoryId }));
        return normalizeMemoryResponse({ ...response.memory });
      } else if (status === MemoryStatus.FAILED) {
        const response = await this.gmcpClient.send(new GetMemoryCommand({ memoryId }));
        const failureReason = response.memory?.failureReason ?? "Unknown";
        throw new Error(`Memory creation failed: ${failureReason}`);
      }

      await sleep(pollInterval);
    }

    throw new Error(`Memory ${memoryId} did not become ACTIVE within ${maxWait} seconds`);
  }

  /**
   * Create a memory with simplified configuration. Python's `create_memory`; kept because
   * `createMemoryAndWait` is a thin wrapper over it and the field-name mapping lives here
   * (`eventExpiryDays` -> `eventExpiryDuration`, `strategies` -> `memoryStrategies`).
   */
  async createMemory(
    { name, strategies = [], description, eventExpiryDays = 90, memoryExecutionRoleArn }: {
      name: string;
      strategies?: MemoryStrategyDict[];
      description?: string;
      eventExpiryDays?: number;
      memoryExecutionRoleArn?: string;
    },
  ): Promise<NormalizedMemory> {
    const processedStrategies = addDefaultNamespaces(strategies);

    const response = await this.gmcpClient.send(
      new CreateMemoryCommand({
        name,
        eventExpiryDuration: eventExpiryDays,
        // The course writes strategies as single-key dicts, which is what the service takes; the SDK
        // models the same wire shape as a tagged union whose non-selected members are `never`, so a
        // `Record`-typed value cannot satisfy it structurally. The cast is the union's own wire form.
        memoryStrategies: processedStrategies as unknown as MemoryStrategyInput[],
        clientToken: crypto.randomUUID(),
        ...(description !== undefined ? { description } : {}),
        ...(memoryExecutionRoleArn !== undefined ? { memoryExecutionRoleArn } : {}),
      }),
    );

    const memory = normalizeMemoryResponse({ ...response.memory });
    console.info(`Created memory: ${memory.memoryId}`);
    return memory;
  }

  /** List all memories for the account. Python default `max_results=100`. */
  async listMemories(maxResults = 100): Promise<NormalizedMemorySummary[]> {
    const response = await this.gmcpClient.send(
      new ListMemoriesCommand({ maxResults: nextPageSize(maxResults, 0) }),
    );
    const memories = [...(response.memories ?? [])];

    let nextToken = response.nextToken;
    while (nextToken !== undefined && memories.length < maxResults) {
      const page = await this.gmcpClient.send(
        new ListMemoriesCommand({
          maxResults: nextPageSize(maxResults, memories.length),
          nextToken,
        }),
      );
      memories.push(...(page.memories ?? []));
      nextToken = page.nextToken;
    }

    return memories.slice(0, maxResults).map((m) => normalizeMemorySummary({ ...m }));
  }

  /** Get all strategies for a memory. Positional argument, as in Python. */
  async getMemoryStrategies(memoryId: string): Promise<NormalizedMemoryStrategy[]> {
    const response = await this.gmcpClient.send(new GetMemoryCommand({ memoryId }));
    const memory = (response.memory ?? {}) as Record<string, unknown>;

    // Handle both old and new field names in response.
    const strategies = (memory.strategies ?? memory.memoryStrategies ?? []) as Record<
      string,
      unknown
    >[];

    return strategies.map((s) => normalizeStrategy(s));
  }

  /** Get current memory status. */
  async getMemoryStatus(memoryId: string): Promise<string> {
    const response = await this.gmcpClient.send(new GetMemoryCommand({ memoryId }));
    return response.memory?.status ?? "";
  }

  /**
   * Save an event of an agent interaction or conversation with a user — the basis of short-term
   * memory, and the trigger for long-term extraction when the memory has strategies.
   */
  async createEvent(
    { memoryId, actorId, sessionId, messages, eventTimestamp, branch, extractionMode }:
      CreateEventOptions,
  ): Promise<MemoryEvent> {
    const payload = toConversationalPayload(messages);

    const response = await this.gmdpClient.send(
      new CreateEventCommand({
        memoryId,
        actorId,
        sessionId,
        eventTimestamp: eventTimestamp ?? new Date(),
        payload,
        ...(branch !== undefined ? { branch } : {}),
        ...(extractionMode !== undefined ? { extractionMode } : {}),
      }),
    );

    const event = response.event as MemoryEvent;
    console.info(`Created event: ${event.eventId}`);
    return event;
  }

  /**
   * Retrieve relevant memories using exact match (`namespace`) or hierarchical path prefix
   * (`namespacePath`). Exactly one must be provided.
   *
   * Returns an empty list if the namespace arguments are invalid or if the service call fails — the
   * Python method swallows `ClientError` here and logs, so the notebooks keep running while the
   * extraction pipeline catches up.
   */
  async retrieveMemories(
    { memoryId, namespace, query, topK = 3, namespacePath }: RetrieveMemoriesOptions,
  ): Promise<MemoryRecordSummary[]> {
    let nsParams: NamespaceParams;
    try {
      nsParams = buildNamespaceParams(namespace, namespacePath);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return [];
    }

    const nsValue = namespace ?? namespacePath;

    try {
      const searchCriteria: SearchCriteria = { searchQuery: query, topK };
      const response = await this.gmdpClient.send(
        new RetrieveMemoryRecordsCommand({ memoryId, searchCriteria, ...nsParams }),
      );
      const memories = response.memoryRecordSummaries ?? [];
      console.info(`Retrieved ${memories.length} memories from namespace: ${nsValue}`);
      return memories;
    } catch (e) {
      // AWS SDK v3 puts the modeled error code on `name`, where botocore puts it in
      // `e.response["Error"]["Code"]`.
      const code = e instanceof Error ? e.name : "Unknown";
      const message = e instanceof Error ? e.message : String(e);

      if (code === "ResourceNotFoundException") {
        console.warn(
          `Memory or namespace not found. Ensure memory ${memoryId} exists and namespace ` +
            `'${nsValue}' is configured`,
        );
      } else if (code === "ValidationException") {
        console.warn(`Invalid search parameters: ${message}`);
      } else if (code === "ServiceException") {
        console.warn(`Service error: ${message}. This may be temporary - try again later`);
      } else {
        console.warn(`Memory retrieval failed (${code}): ${message}`);
      }

      return [];
    }
  }
}
