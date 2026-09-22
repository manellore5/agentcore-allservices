#!/usr/bin/env -S deno run -A
/**
 * Travel Agent with Google Drive Integration
 * Uses AgentCore Identity for OAuth2 authentication with Google Drive.
 *
 * Replaces `travel_agent_google_drive.py`. The Python `@requires_access_token(...)` decorator
 * becomes `withAccessToken({...})(fn)` from `bedrock-agentcore/identity`, which injects the token
 * as the wrapped function's last argument. Google's client comes from `npm:googleapis`.
 */
import { Agent, tool } from "@strands-agents/sdk";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { withAccessToken } from "bedrock-agentcore/identity";
import { google } from "googleapis";
import { z } from "zod";
import { getOauth2CallbackUrl } from "./oauth2_callback_server.ts";

// Environment configuration
Deno.env.set("STRANDS_OTEL_ENABLE_CONSOLE_EXPORT", "true");
Deno.env.set("OTEL_PYTHON_EXCLUDED_URLS", "/ping,/invocations");

// Google Drive API scope
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

// Module-level access token, set once the OAuth2 flow completes
let googleAccessToken: string | null = null;

/** Saves a travel itinerary to Google Drive as a text file. */
const saveItineraryToDrive = tool({
  name: "save_itinerary_to_drive",
  description: "Saves a travel itinerary to Google Drive as a text file",
  inputSchema: z.object({
    destination: z.string().describe("Travel destination name"),
    itinerary_content: z.string().describe("The itinerary content to save"),
  }),
  callback: async ({ destination, itinerary_content }) => {
    if (!googleAccessToken) {
      return JSON.stringify({
        message:
          "Google Drive authentication is required. Please wait while we set up the authorization.",
        success: false,
      });
    }

    try {
      // Create credentials from access token
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: googleAccessToken, scope: SCOPES.join(" ") });
      const service = google.drive({ version: "v3", auth });

      // Create filename
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const filename = `${destination.toLowerCase().replace(/ /g, "_")}_itinerary_${date}.txt`;

      // Upload file
      const file = await service.files.create({
        requestBody: { name: filename },
        media: { mimeType: "text/plain", body: itinerary_content },
        fields: "id,name,webViewLink",
      });

      return JSON.stringify({
        success: true,
        message: `✅ Itinerary saved to Google Drive: ${file.data.name}`,
        file_id: file.data.id,
        view_link: file.data.webViewLink,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: `Error saving to Google Drive: ${error}`,
      });
    }
  },
});

// Initialize the agent
const agent = new Agent({
  model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  tools: [saveItineraryToDrive],
  systemPrompt: `
You are a helpful travel planning assistant with the ability to save itineraries to Google Drive.
When users ask you to create travel plans, generate detailed itineraries and offer to save them to Google Drive.
Always format itineraries clearly with day-by-day breakdowns, times, and activities.
`,
});

// Initialize app
const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema: z.object({
      prompt: z.string().default(
        "Hello! I'm your travel planning assistant. How can I help you plan your next trip?",
      ),
    }),
    process: async function* ({ prompt }) {
      yield* agentTask(prompt);
    },
  },
});

/** Handle authorization URL callback: the learner opens this URL to grant Drive access. */
async function onAuthUrl(url: string): Promise<void> {
  console.log(`Authorization url: ${url}`);
  pendingAuthUrl = url;
  await Promise.resolve();
}

let pendingAuthUrl: string | null = null;

/**
 * Get Google Drive access token.
 *
 * Python wrapped this with `@requires_access_token(...)`; here `withAccessToken` injects the token
 * as the last argument. Outside a runtime request it throws, because there is no workload identity.
 */
const getGoogleDriveToken = withAccessToken({
  providerName: "google-drive-provider",
  scopes: SCOPES,
  authFlow: "USER_FEDERATION",
  onAuthUrl,
  forceAuthentication: true,
  callbackUrl: getOauth2CallbackUrl(),
})(async (accessToken: string): Promise<string> => {
  googleAccessToken = accessToken;
  return await Promise.resolve(accessToken);
});

/**
 * Execute the agent task with authentication handling.
 *
 * Python pushed progress onto an asyncio queue and streamed it; an async generator says the same
 * thing directly, so the StreamingQueue class has no counterpart here.
 */
async function* agentTask(userMessage: string): AsyncGenerator<string> {
  try {
    yield "Begin agent execution";

    // Call the agent first to see if it needs authentication
    let response = await agent.invoke(userMessage);
    const responseText = response.toString();

    // Check if the response indicates authentication is required
    const authKeywords = [
      "authentication",
      "authorize",
      "authorization",
      "auth",
      "sign in",
      "login",
      "access",
      "permission",
      "credential",
      "need authentication",
      "requires authentication",
    ];
    const needsAuth = authKeywords.some((k) => responseText.toLowerCase().includes(k));

    if (needsAuth) {
      yield "Authentication required for Google Drive access. Starting authorization flow...";

      // Trigger the 3LO authentication flow
      try {
        googleAccessToken = await getGoogleDriveToken();
        if (pendingAuthUrl) yield `Authorization url: ${pendingAuthUrl}`;
        yield "Authentication successful! Retrying your request...";

        // Retry the agent call now that we have authentication
        response = await agent.invoke(userMessage);
      } catch (authError) {
        console.log(`auth_error: ${authError}`);
        yield `Authentication failed: ${authError}`;
      }
    }

    yield response.toString();
    yield "End agent execution";
  } catch (error) {
    yield `Error: ${error}`;
  }
}

if (import.meta.main) {
  app.run();
}
