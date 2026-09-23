#!/usr/bin/env -S deno run -A
/**
 * Unified Travel Agent - Combines all AgentCore components
 * Integrates Gateway MCP, Memory, Code Interpreter, Browser Tools, and OAuth.
 * Uses environment variables for configuration (set during runtime deployment).
 *
 * Replaces `unified_travel_agent.py`. Tools are declared with `tool({ inputSchema: zod })`, the
 * Gateway is still reached by hand-rolled JSON-RPC over `fetch` (as the Python did, rather than
 * through an MCP client), and memory calls go straight to the AWS SDK (see the note below).
 */
import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { z } from "zod";
import {
  BedrockAgentCoreClient,
  CreateEventCommand,
  RetrieveMemoryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { IdentityHelper } from "./identity_helper.ts";

// Configuration from environment variables
const REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const MODEL_ID = Deno.env.get("MODEL_ID") ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";

// Gateway configuration from environment
const GATEWAY_MCP_ENDPOINT = Deno.env.get("GATEWAY_MCP_ENDPOINT");
const GATEWAY_TOKEN_ENDPOINT = Deno.env.get("GATEWAY_TOKEN_ENDPOINT");
const GATEWAY_OAUTH_CLIENT_ID = Deno.env.get("GATEWAY_OAUTH_CLIENT_ID");
const GATEWAY_OAUTH_CLIENT_SECRET = Deno.env.get("GATEWAY_OAUTH_CLIENT_SECRET");
const GATEWAY_OAUTH_SCOPE = Deno.env.get("GATEWAY_OAUTH_SCOPE");

// Memory configuration from environment
const MEMORY_ID = Deno.env.get("MEMORY_ID");
const MEMORY_USER_ID = Deno.env.get("MEMORY_USER_ID") ?? "default-user";
const MEMORY_SESSION_ID = Deno.env.get("MEMORY_SESSION_ID") ?? "default-session";

// Initialize tools.
//
// Memory goes through the AWS SDK directly rather than the course's `toolkit/MemoryClient`: a
// deployed agent folder is zipped on its own, so it cannot import a module from outside itself.
// (Python could, because its MemoryClient came from an installed package.) These are the same two
// API calls that client makes.
const memoryClient = MEMORY_ID ? new BedrockAgentCoreClient({ region: REGION }) : null;
const identityHelper = new IdentityHelper(REGION);

/** Internal helper to call MCP gateway tools. */
async function callMcpTool(toolName: string, args: Record<string, unknown>): Promise<string> {
  if (!GATEWAY_MCP_ENDPOINT) {
    return JSON.stringify({ error: "Gateway not configured" });
  }

  try {
    // Get access token
    const tokenResponse = await fetch(GATEWAY_TOKEN_ENDPOINT!, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: GATEWAY_OAUTH_CLIENT_ID ?? "",
        client_secret: GATEWAY_OAUTH_CLIENT_SECRET ?? "",
        scope: GATEWAY_OAUTH_SCOPE ?? "",
      }),
    });

    if (!tokenResponse.ok) {
      return JSON.stringify({ error: "Authentication failed" });
    }

    const accessToken = (await tokenResponse.json()).access_token;

    // Call MCP endpoint
    const response = await fetch(GATEWAY_MCP_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `unified-${toolName}`,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });

    if (!response.ok) {
      return JSON.stringify({ error: `API call failed: ${response.status}` });
    }
    const result = await response.json();
    return JSON.stringify(result.result ?? {});
  } catch (error) {
    return JSON.stringify({ error: `Error calling gateway API: ${error}` });
  }
}

const searchFlights = tool({
  name: "search_flights",
  description: "Search for flights between two airports",
  inputSchema: z.object({
    origin: z.string().describe("Departure IATA code (e.g., SFO)"),
    destination: z.string().describe("Arrival IATA code (e.g., DFW)"),
  }),
  callback: ({ origin, destination }) =>
    callMcpTool("FlightSearch___getFlights", { dep_iata: origin, arr_iata: destination }),
});

const getWeather = tool({
  name: "get_weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name and country code (e.g., 'Rome,IT')"),
    units: z.string().default("metric").describe("'metric' (Celsius) or 'imperial' (Fahrenheit)"),
  }),
  callback: ({ location, units }) =>
    callMcpTool("WeatherSearch___getCurrentWeather", { q: location, units }),
});

const convertCurrency = tool({
  name: "convert_currency",
  description: "Get current exchange rate between two currencies",
  inputSchema: z.object({
    from_currency: z.string().describe("Source currency code (e.g., 'USD')"),
    to_currency: z.string().describe("Target currency code (e.g., 'EUR')"),
  }),
  callback: async ({ from_currency, to_currency }) => {
    // Retrieve API key from credential provider
    const apiKey = await identityHelper.getExchangerateApiKey();
    if (!apiKey) {
      return JSON.stringify({ error: "ExchangeRate API key not available" });
    }
    return await callMcpTool("ExchangeRate___convertCurrency", {
      api_key: apiKey,
      from_currency,
      to_currency,
    });
  },
});

const getUserPreferences = tool({
  name: "get_user_preferences",
  description: "Retrieve user travel preferences from memory",
  inputSchema: z.object({}),
  callback: async () => {
    if (!memoryClient || !MEMORY_ID) {
      return "Memory not configured - missing MEMORY_ID environment variable";
    }
    try {
      const response = await memoryClient.send(
        new RetrieveMemoryRecordsCommand({
          memoryId: MEMORY_ID,
          namespace: `travel/user/${MEMORY_USER_ID}/preferences`,
          searchCriteria: { searchQuery: "travel preferences", topK: 5 },
        }),
      );
      const preferences = (response.memoryRecordSummaries ?? [])
        .map((m) => (m.content as { text?: string } | undefined)?.text)
        .filter((text): text is string => Boolean(text));
      return JSON.stringify({ preferences, user_id: MEMORY_USER_ID });
    } catch (error) {
      return `Error retrieving preferences: ${error}`;
    }
  },
});

const saveTravelMemory = tool({
  name: "save_travel_memory",
  description: "Save travel information to memory",
  inputSchema: z.object({
    content: z.string().describe("What to remember"),
    memory_type: z.string().default("semantic"),
  }),
  callback: async ({ content }) => {
    if (!memoryClient || !MEMORY_ID) {
      return "Memory not configured - missing MEMORY_ID environment variable";
    }
    try {
      await memoryClient.send(
        new CreateEventCommand({
          memoryId: MEMORY_ID,
          actorId: MEMORY_USER_ID,
          sessionId: MEMORY_SESSION_ID,
          eventTimestamp: new Date(),
          payload: [{ conversational: { content: { text: content }, role: "ASSISTANT" } }],
        }),
      );
      return "Memory saved successfully";
    } catch (error) {
      return `Error saving memory: ${error}`;
    }
  },
});

// Create unified agent
const model = new BedrockModel({ modelId: MODEL_ID });

const unifiedAgent = new Agent({
  model,
  tools: [
    searchFlights,
    getWeather,
    convertCurrency,
    getUserPreferences,
    saveTravelMemory,
    // The code interpreter and browser tools stay commented out here, as in the Python original:
    // notebooks 06 and 07 exercise them, and each opens a billed session per agent instance.
  ],
  systemPrompt: `
You are a comprehensive AI Travel Companion with access to:

1. **Flight Search**: search_flights(origin, destination) - Find flights between airports
2. **Weather**: get_weather(location, units) - Get current weather for a city
3. **Currency**: convert_currency(from_currency, to_currency) - Get exchange rates
4. **Memory**: get_user_preferences() and save_travel_memory(content) - Store/retrieve preferences

Always:
- Check user preferences first using get_user_preferences()
- Use real APIs for current flight, hotel, weather, and currency information
- Provide comprehensive travel planning with budget considerations
- Save important travel decisions to memory

Provide comprehensive, personalized travel planning assistance.
`,
});

// Initialize AgentCore app
const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: z.object({
      prompt: z.string().default("Hello! How can I help you plan your travel?"),
    }),
    process: async ({ prompt }) => {
      try {
        const response = await unifiedAgent.invoke(prompt);
        return response.toString();
      } catch (error) {
        return `Error processing request: ${error}`;
      }
    },
  },
});

if (import.meta.main) {
  app.run();
}
