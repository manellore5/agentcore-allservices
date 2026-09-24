import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { z } from "zod";

// Define travel tools
const getTravelPreferences = tool({
  name: "get_travel_preferences",
  description: "Get user's travel preferences from memory",
  inputSchema: z.object({}),
  callback: () => ({
    hotel_type: "mid-range",
    food_preference: "vegetarian",
    budget_range: "moderate",
  }),
});

const calculateBudget = tool({
  name: "calculate_budget",
  description: "Calculate daily budget allocation for travel",
  inputSchema: z.object({
    total_budget: z.number().describe("Total travel budget"),
    days: z.number().describe("Number of days"),
  }),
  callback: ({ total_budget, days }) => ({
    daily_budget: total_budget / days,
    allocation: {
      flights: total_budget * 0.24,
      hotels: total_budget * 0.36,
      food: total_budget * 0.20,
      activities: total_budget * 0.16,
      buffer: total_budget * 0.04,
    },
  }),
});

const destinations: Record<string, unknown> = {
  rome: {
    country: "Italy",
    currency: "EUR",
    language: "Italian",
    attractions: ["Colosseum", "Vatican", "Trevi Fountain"],
  },
  florence: {
    country: "Italy",
    currency: "EUR",
    language: "Italian",
    attractions: ["Uffizi Gallery", "Ponte Vecchio", "Duomo"],
  },
  venice: {
    country: "Italy",
    currency: "EUR",
    language: "Italian",
    attractions: ["St. Mark's Square", "Grand Canal", "Doge's Palace"],
  },
};

const getDestinationInfo = tool({
  name: "get_destination_info",
  description: "Get basic information about a travel destination",
  inputSchema: z.object({ destination: z.string().describe("Destination city") }),
  callback: ({ destination }) =>
    destinations[destination.toLowerCase()] ?? { error: "Destination not found" },
});

// Initialize model and agent
const modelId = "us.anthropic.claude-sonnet-4-6";
const model = new BedrockModel({ modelId });

const systemPrompt = `
You are an AI Travel Companion specializing in planning trips to Italy.
Your expertise includes:
- Flight and hotel recommendations
- Budget optimization and allocation
- Destination information and attractions
- Personalized recommendations based on user preferences

Always ask clarifying questions to better understand the user's needs.
Be helpful, friendly, and provide detailed explanations for your recommendations.
Remember user preferences and reference them in future interactions.
`;

const travelAgent = new Agent({
  model,
  tools: [getTravelPreferences, calculateBudget, getDestinationInfo],
  systemPrompt,
});

// AgentCore Runtime entrypoint for travel agent
const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: z.object({ prompt: z.string().default("") }),
    process: async ({ prompt }) => {
      console.log(`User input: ${prompt}`);
      const result = await travelAgent.invoke(prompt);
      return result.toString();
    },
  },
});

app.run();
