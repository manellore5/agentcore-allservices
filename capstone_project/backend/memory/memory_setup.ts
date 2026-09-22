/**
 * TravelMate AI - AgentCore Memory Setup
 * Creates Memory resource with travel-specific strategies.
 *
 * Replaces `memory_setup.py`, using the course's own `MemoryClient` (there is no TypeScript
 * `bedrock_agentcore.memory`).
 */
import {
  type EventMessage,
  MemoryClient,
  type MemoryStrategyDict,
  StrategyType,
} from "../../toolkit/mod.ts";
import { loadEnv } from "../../shared/notebook.ts";

await loadEnv();

// Configuration
const REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const MEMORY_NAME = "TravelMateMemory";

/** Memory strategies for travel planning; shared with notebook 04. */
export const travelStrategies: MemoryStrategyDict[] = [
  {
    [StrategyType.USER_PREFERENCE]: {
      name: "TravelPreferences",
      description: "Captures user travel preferences and behavior",
      namespaces: ["travel/user/{actorId}/preferences"],
    },
  },
  {
    [StrategyType.SEMANTIC]: {
      name: "TravelSemantic",
      description: "Stores travel facts and trip information",
      namespaces: ["travel/user/{actorId}/semantic"],
    },
  },
  {
    [StrategyType.SUMMARY]: {
      name: "TravelSummary",
      description: "Maintains conversation summaries for context",
      namespaces: ["travel/user/{actorId}/summary"],
    },
  },
];

/** Create AgentCore Memory resource for travel agent. */
export async function createTravelMemory(): Promise<{ memoryId: string; client: MemoryClient }> {
  // Initialize Memory Client
  console.log("🧠 Creating AgentCore Memory for Travel Agent...");
  const client = new MemoryClient({ region: REGION });

  // Create memory resource
  try {
    const memory = await client.createMemoryAndWait({
      name: MEMORY_NAME,
      strategies: travelStrategies,
      description: "Memory for AI Travel Companion agent",
      eventExpiryDays: 365, // Keep travel memories for 1 year
    });
    const memoryId = (memory.id ?? memory.memoryId)!;
    console.info(`✅ Created memory: ${memoryId}`);
    return { memoryId, client };
  } catch (error) {
    // If memory already exists, retrieve its ID
    if (error instanceof Error && error.message.includes("already exists")) {
      const memories = await client.listMemories();
      const existing = memories.find((m) => (m.id ?? m.memoryId ?? "").startsWith(MEMORY_NAME));
      const memoryId = (existing?.id ?? existing?.memoryId)!;
      console.info(`Memory already exists. Using existing memory ID: ${memoryId}`);
      return { memoryId, client };
    }
    console.error(`❌ ERROR: ${error}`);
    throw error;
  }
}

/** Get namespace mapping for memory strategies. */
export async function getNamespaces(
  client: MemoryClient,
  memoryId: string,
): Promise<Record<string, string>> {
  const strategies = await client.getMemoryStrategies(memoryId);
  return Object.fromEntries(
    strategies.map((s) => [s.type ?? s.memoryStrategyType ?? "", (s.namespaces ?? [])[0] ?? ""]),
  );
}

/** Sample travel interactions to establish preferences; shared with notebook 04. */
export const travelInteractions: EventMessage[] = [
  ["I prefer mid-range hotels, nothing too fancy but clean and comfortable.", "USER"],
  [
    "Noted! I'll focus on 3-4 star hotels with good reviews for cleanliness and comfort.",
    "ASSISTANT",
  ],
  ["I'm vegetarian, so I need restaurants with good vegetarian options.", "USER"],
  [
    "Perfect! I'll make sure to recommend destinations and restaurants known for excellent vegetarian cuisine.",
    "ASSISTANT",
  ],
  ["My budget is usually around $3000-5000 for a 10-day international trip.", "USER"],
  [
    "That's a great budget range! I can help you plan amazing trips within $3000-5000 for 10 days.",
    "ASSISTANT",
  ],
  ["I love historical sites and museums, not so much into nightlife or beaches.", "USER"],
  [
    "Excellent! I'll focus on destinations rich in history and culture with world-class museums.",
    "ASSISTANT",
  ],
];

/** Seed initial travel preferences for demonstration. */
export async function seedTravelPreferences(
  client: MemoryClient,
  memoryId: string,
  userId: string,
): Promise<void> {
  try {
    await client.createEvent({
      memoryId,
      actorId: userId,
      sessionId: "preference_setup",
      messages: travelInteractions,
    });
    console.log(`✅ Seeded travel preferences for user: ${userId}`);
  } catch (error) {
    console.log(`⚠️ Error seeding preferences: ${error}`);
  }
}

if (import.meta.main) {
  // Create memory resource
  const { memoryId, client } = await createTravelMemory();

  // Display memory strategies
  console.log("\n📋 Memory Strategies:");
  const strategies = await client.getMemoryStrategies(memoryId);
  for (const strategy of strategies) {
    console.log(`  • ${strategy.name}: ${strategy.description}`);
  }

  // Seed sample preferences
  const sampleUserId = "travel_user_001";
  await seedTravelPreferences(client, memoryId, sampleUserId);

  // Save memory info for notebooks
  const memoryInfo = {
    memory_id: memoryId,
    memory_name: MEMORY_NAME,
    region: REGION,
    strategies: strategies.map((s) => s.type ?? s.memoryStrategyType),
    sample_user_id: sampleUserId,
  };

  await Deno.writeTextFile("memory_info.json", `${JSON.stringify(memoryInfo, null, 2)}\n`);

  console.log("\n💾 Memory information saved to memory_info.json");
  console.log(`Memory ID: ${memoryId}`);
  console.log("Ready for integration with travel agent!");
}
