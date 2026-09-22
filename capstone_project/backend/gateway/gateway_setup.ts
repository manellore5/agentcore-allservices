/**
 * TravelMate AI - AgentCore Gateway Setup
 * Creates Gateway with all 3 travel API integrations
 *
 * Replaces `capstone_project/backend/gateway/gateway_setup.py`, the standalone (non-notebook)
 * path for creating the gateway. Four things differ from the Python, all of them bugs there:
 *
 * - The Python builds a Hotelbeds target from `openapi_specs/hotelbeds.json`, a file the repo
 *   does not contain, using a `HOTELBEDS_API_KEY` no notebook ever sets — the script could not
 *   run past its second target. The Hotelbeds target and its summary lines are gone; the three
 *   specs that do exist stay.
 * - `create_mcp_gateway` returns a dict, so the Python's `gateway.get_mcp_url()` and
 *   `gateway.gateway_id` always raise. Here the URL and id are read off the returned object.
 * - The Python reads `cognito_result['authorization']`; the key is `authorizer_config`.
 * - The Python hardcodes `REGION = "us-west-2"` while every notebook uses `us-east-1`. The
 *   region now comes from `AWS_REGION`, falling back to `us-east-1`.
 *
 * The ExchangeRate credentials follow notebook 03 (`QUERY_PARAMETER` `api_key`) rather than the
 * Python script (`HEADER` `Authorization`): the notebook is the path the course teaches.
 */
import { GatewayClient } from "../../toolkit/mod.ts";
import { loadEnv } from "../../shared/notebook.ts";

await loadEnv();

// Configuration
const REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const GATEWAY_NAME = "TravelMateGateway";

// API Keys (load from environment)
const API_KEYS: Record<string, string> = {
  aviationstack: Deno.env.get("AVIATIONSTACK_API_KEY") ?? "",
  openweathermap: Deno.env.get("OPENWEATHERMAP_API_KEY") ?? "",
  exchangerate: Deno.env.get("EXCHANGERATE_API_KEY") ?? "",
};

/**
 * Load OpenAPI specification from file.
 *
 * The path resolves against this module rather than the working directory, so the script works
 * from anywhere (`deno task gateway:setup` runs at the repository root).
 */
async function loadOpenapiSpec(filename: string): Promise<unknown> {
  return JSON.parse(await Deno.readTextFile(new URL(`openapi_specs/${filename}`, import.meta.url)));
}

/** Create TravelMate Gateway with all targets. */
export async function createTravelGateway() {
  // Initialize Gateway client
  console.log("Initializing Gateway client...");
  const client = new GatewayClient({ region: REGION });

  // Set up Cognito OAuth (EZ Auth)
  console.log("Setting up OAuth with Cognito...");
  const cognitoResult = await client.createOauthAuthorizerWithCognito(GATEWAY_NAME);

  // Create Gateway
  console.log(`Creating Gateway: ${GATEWAY_NAME}...`);
  const gateway = await client.createMcpGateway({
    name: GATEWAY_NAME,
    roleArn: null, // Auto-create
    authorizerConfig: cognitoResult.authorizer_config,
    enableSemanticSearch: true,
    exceptionLevel: "DEBUG",
  });

  console.log(`✅ Gateway created!`);
  console.log(`   MCP Endpoint: ${gateway.gatewayUrl}`);
  console.log(`   Gateway ID: ${gateway.gatewayId}`);

  // Add Aviationstack target
  console.log("\n1️⃣ Adding Aviationstack (flights)...");
  const aviationstackSpec = await loadOpenapiSpec("aviationstack.json");

  await client.createMcpGatewayTarget({
    gateway,
    targetType: "openApiSchema",
    targetPayload: {
      inlinePayload: JSON.stringify(aviationstackSpec),
    },
    credentials: {
      apiKey: API_KEYS.aviationstack,
      credentialLocation: "QUERY_PARAMETER",
      credentialParameterName: "access_key",
    },
  });
  console.log("   ✅ Aviationstack target added");

  // Add OpenWeatherMap target
  console.log("\n2️⃣ Adding OpenWeatherMap (weather)...");
  const weatherSpec = await loadOpenapiSpec("openweathermap.json");

  await client.createMcpGatewayTarget({
    gateway,
    targetType: "openApiSchema",
    targetPayload: {
      inlinePayload: JSON.stringify(weatherSpec),
    },
    credentials: {
      apiKey: API_KEYS.openweathermap,
      credentialLocation: "QUERY_PARAMETER",
      credentialParameterName: "appid",
    },
  });
  console.log("   ✅ OpenWeatherMap target added");

  // Add ExchangeRate-API target
  console.log("\n3️⃣ Adding ExchangeRate-API (currency)...");
  const currencySpec = await loadOpenapiSpec("exchangerate.json");

  await client.createMcpGatewayTarget({
    gateway,
    targetType: "openApiSchema",
    targetPayload: {
      inlinePayload: JSON.stringify(currencySpec),
    },
    credentials: {
      apiKey: API_KEYS.exchangerate,
      credentialLocation: "QUERY_PARAMETER",
      credentialParameterName: "api_key",
    },
  });
  console.log("   ✅ ExchangeRate-API target added");

  // Print OAuth credentials
  console.log("\n" + "=".repeat(60));
  console.log("🎉 GATEWAY SETUP COMPLETE!");
  console.log("=".repeat(60));
  console.log(`\nMCP Endpoint: ${gateway.gatewayUrl}`);
  console.log(`\nOAuth Credentials:`);
  console.log(`  Client ID: ${cognitoResult.client_info.client_id}`);
  console.log(`  Scope: ${cognitoResult.client_info.scope}`);
  console.log(`\nAvailable Tools:`);
  console.log("  - searchFlights (Aviationstack)");
  console.log("  - getCurrentWeather (OpenWeatherMap)");
  console.log("  - getWeatherForecast (OpenWeatherMap)");
  console.log("  - getExchangeRates (ExchangeRate-API)");
  console.log("  - convertCurrency (ExchangeRate-API)");

  return { gateway, cognitoResult };
}

if (import.meta.main) {
  // Check API keys
  const missingKeys = Object.entries(API_KEYS).filter(([, v]) => !v).map(([k]) => k);
  if (missingKeys.length > 0) {
    console.log(`❌ Missing API keys: ${missingKeys.join(", ")}`);
    console.log("Set environment variables:");
    for (const key of missingKeys) {
      console.log(`  export ${key.toUpperCase()}_API_KEY=your_key_here`);
    }
    Deno.exit(1);
  }

  // Create gateway
  await createTravelGateway();
}
