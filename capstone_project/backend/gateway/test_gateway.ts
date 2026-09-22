/**
 * TravelMate AI - Gateway Integration Tests
 * Tests all 3 travel API integrations through AgentCore Gateway
 *
 * Replaces `capstone_project/backend/gateway/test_gateway.py`, the standalone (non-notebook)
 * path for exercising the gateway. `fetch` replaces `requests`, and the two Hotelbeds tests
 * (`test_search_hotels`, `test_get_hotel_details`) are gone: the repo has no Hotelbeds OpenAPI
 * spec and no notebook sets a `HOTELBEDS_API_KEY`, so the gateway never gets that target.
 * Flights, weather, forecast, exchange rates and currency conversion remain.
 */
import { loadEnv } from "../../shared/notebook.ts";

await loadEnv();

// Test configuration
const GATEWAY_MCP_URL = Deno.env.get("GATEWAY_MCP_URL"); // Set after gateway creation
const OAUTH_TOKEN = Deno.env.get("OAUTH_TOKEN"); // Get from Cognito

interface McpRequest {
  method: string;
  params: Record<string, unknown>;
}

/** Reads a nested field of a parsed response, tolerating anything missing on the way down. */
function field(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Like `field`, but for printing: Python's `response.get("x", "N/A")` chains. */
function text(value: unknown, path: (string | number)[], fallback: string): string {
  const found = field(value, ...path);
  return found === undefined || found === null ? fallback : String(found);
}

/** Test Aviationstack flight search. */
export async function testSearchFlights(): Promise<unknown> {
  console.log("🧪 Testing flight search...");

  const payload: McpRequest = {
    method: "searchFlights",
    params: {
      dep_iata: "JFK",
      arr_iata: "FCO",
      flight_date: "2024-12-15",
    },
  };

  const response = await makeMcpRequest(payload);

  const flights = field(response, "data");
  if (Array.isArray(flights)) {
    console.log(`   ✅ Found ${flights.length} flights`);
    if (flights.length > 0) {
      const flight = flights[0];
      console.log(
        `   📍 ${text(flight, ["airline", "name"], "Unknown")} - ${
          text(flight, ["flight", "number"], "N/A")
        }`,
      );
    }
  } else {
    console.log("   ❌ Flight search failed");
  }

  return response;
}

/** Test OpenWeatherMap current weather. */
export async function testGetWeather(): Promise<unknown> {
  console.log("🧪 Testing current weather...");

  const payload: McpRequest = {
    method: "getCurrentWeather",
    params: {
      q: "Rome,IT",
      units: "metric",
    },
  };

  const response = await makeMcpRequest(payload);

  if (field(response, "main") !== undefined) {
    const temp = text(response, ["main", "temp"], "N/A");
    const desc = text(response, ["weather", 0, "description"], "N/A");
    console.log(`   ✅ Weather retrieved`);
    console.log(`   🌤️ Rome: ${temp}°C, ${desc}`);
  } else {
    console.log("   ❌ Weather retrieval failed");
  }

  return response;
}

/** Test OpenWeatherMap weather forecast. */
export async function testGetWeatherForecast(): Promise<unknown> {
  console.log("🧪 Testing weather forecast...");

  const payload: McpRequest = {
    method: "getWeatherForecast",
    params: {
      q: "Florence,IT",
      units: "metric",
      cnt: 3,
    },
  };

  const response = await makeMcpRequest(payload);

  const forecasts = field(response, "list");
  if (Array.isArray(forecasts)) {
    console.log(`   ✅ Forecast retrieved (${forecasts.length} periods)`);
    if (forecasts.length > 0) {
      const forecast = forecasts[0];
      const temp = text(forecast, ["main", "temp"], "N/A");
      const desc = text(forecast, ["weather", 0, "description"], "N/A");
      console.log(`   🌤️ Florence: ${temp}°C, ${desc}`);
    }
  } else {
    console.log("   ❌ Weather forecast failed");
  }

  return response;
}

/** Test ExchangeRate-API exchange rates. */
export async function testGetExchangeRates(): Promise<unknown> {
  console.log("🧪 Testing exchange rates...");

  const payload: McpRequest = {
    method: "getExchangeRates",
    params: {
      base: "USD",
    },
  };

  const response = await makeMcpRequest(payload);

  if (field(response, "rates") !== undefined) {
    console.log(`   ✅ Exchange rates retrieved`);
    console.log(`   💱 USD to EUR: ${text(response, ["rates", "EUR"], "N/A")}`);
    console.log(`   💱 USD to GBP: ${text(response, ["rates", "GBP"], "N/A")}`);
  } else {
    console.log("   ❌ Exchange rates failed");
  }

  return response;
}

/** Test ExchangeRate-API currency conversion. */
export async function testConvertCurrency(): Promise<unknown> {
  console.log("🧪 Testing currency conversion...");

  const payload: McpRequest = {
    method: "convertCurrency",
    params: {
      from: "USD",
      to: "EUR",
      amount: 1000,
    },
  };

  const response = await makeMcpRequest(payload);

  if (field(response, "result") !== undefined) {
    const result = text(response, ["result"], "N/A");
    const rate = text(response, ["info", "rate"], "N/A");
    console.log(`   ✅ Currency conversion successful`);
    console.log(`   💱 $1000 USD = €${result} EUR (rate: ${rate})`);
  } else {
    console.log("   ❌ Currency conversion failed");
  }

  return response;
}

/** Make MCP request to Gateway. */
export async function makeMcpRequest(payload: McpRequest): Promise<unknown> {
  if (!GATEWAY_MCP_URL) {
    console.log("   ❌ GATEWAY_MCP_URL not set");
    return null;
  }

  if (!OAUTH_TOKEN) {
    console.log("   ❌ OAUTH_TOKEN not set");
    return null;
  }

  const headers = {
    "Authorization": `Bearer ${OAUTH_TOKEN}`,
    "Content-Type": "application/json",
  };

  let body: string;
  try {
    const response = await fetch(GATEWAY_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    // `requests`' raise_for_status(): an error status is a failed request, not a payload.
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    }
    body = await response.text();
  } catch (error) {
    console.log(`   ❌ Request failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    console.log(`   ❌ JSON decode failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Run all integration tests. */
export async function runAllTests(): Promise<void> {
  console.log("🚀 Starting TravelMate Gateway Integration Tests");
  console.log("=".repeat(60));

  // Check environment
  if (!GATEWAY_MCP_URL) {
    console.log("❌ Missing GATEWAY_MCP_URL environment variable");
    console.log("   Set it after creating the gateway:");
    console.log("   export GATEWAY_MCP_URL=https://your-gateway-url/mcp");
    return;
  }

  if (!OAUTH_TOKEN) {
    console.log("❌ Missing OAUTH_TOKEN environment variable");
    console.log("   Get OAuth token from Cognito and set:");
    console.log("   export OAUTH_TOKEN=your_oauth_token");
    return;
  }

  // Run tests
  const tests: [string, () => Promise<unknown>][] = [
    ["Flight Search", testSearchFlights],
    ["Current Weather", testGetWeather],
    ["Weather Forecast", testGetWeatherForecast],
    ["Exchange Rates", testGetExchangeRates],
    ["Currency Conversion", testConvertCurrency],
  ];

  const results: Record<string, string> = {};

  for (const [testName, testFunc] of tests) {
    console.log(`\n📋 ${testName}`);
    console.log("-".repeat(40));
    try {
      const result = await testFunc();
      results[testName] = result ? "✅ PASS" : "❌ FAIL";
    } catch (error) {
      console.log(`   ❌ Test error: ${error instanceof Error ? error.message : error}`);
      results[testName] = "❌ ERROR";
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(60));

  for (const [testName, status] of Object.entries(results)) {
    console.log(`${status} ${testName}`);
  }

  const passed = Object.values(results).filter((status) => status.includes("✅")).length;
  const total = Object.keys(results).length;

  console.log(`\n🎯 Results: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log("🎉 All tests passed! Gateway is ready for production.");
  } else {
    console.log("⚠️ Some tests failed. Check API keys and Gateway configuration.");
  }
}

if (import.meta.main) {
  await runAllTests();
}
