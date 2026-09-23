#!/usr/bin/env -S deno run -A
/**
 * Direct API Testing Utility
 *
 * Test external APIs directly (bypassing the gateway) for comparison and debugging.
 * This helps verify if issues are with the gateway integration or the APIs themselves.
 *
 * Replaces `api_direct_test.py`. The Python held the three API keys as empty strings in the
 * constructor, under a comment saying they "should come from environment variables" — so every run
 * called the APIs with no key and reported failure. They are read from the environment here.
 */
import { loadEnv } from "../capstone_project/shared/notebook.ts";

await loadEnv();

/** Test external APIs directly. */
export class DirectApiTester {
  readonly apiKeys: Record<string, string>;

  constructor() {
    // Loaded from the environment (or the repo-root .env), never hard-coded
    this.apiKeys = {
      EXCHANGERATE_API_KEY: Deno.env.get("EXCHANGERATE_API_KEY") ?? "",
      OPENWEATHERMAP_API_KEY: Deno.env.get("OPENWEATHERMAP_API_KEY") ?? "",
      AVIATIONSTACK_API_KEY: Deno.env.get("AVIATIONSTACK_API_KEY") ?? "",
    };
  }

  /** Test ExchangeRate-API directly. */
  async testCurrencyApi(
    fromCurrency = "USD",
    toCurrency = "EUR",
  ): Promise<unknown | null> {
    console.log(`🔄 Testing Currency API: ${fromCurrency} -> ${toCurrency}`);

    const apiKey = this.apiKeys.EXCHANGERATE_API_KEY;
    const url = `https://v6.exchangerate-api.com/v6/${apiKey}/pair/${fromCurrency}/${toCurrency}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      console.log(`   Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log("✅ Currency API - Success");
        console.log(`   Base: ${data.base_code}`);
        console.log(`   Target: ${data.target_code}`);
        console.log(`   Rate: ${data.conversion_rate}`);
        return data;
      }
      console.log("❌ Currency API - Failed");
      console.log(`   Response: ${await response.text()}`);
      return null;
    } catch (error) {
      console.log(`❌ Currency API - Exception: ${error}`);
      return null;
    }
  }

  /** Test OpenWeatherMap API directly. */
  async testWeatherApi(city = "Rome,IT"): Promise<unknown | null> {
    console.log(`🔄 Testing Weather API: ${city}`);

    const url = new URL("https://api.openweathermap.org/data/2.5/weather");
    url.search = new URLSearchParams({
      q: city,
      appid: this.apiKeys.OPENWEATHERMAP_API_KEY,
      units: "metric",
    }).toString();

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      console.log(`   Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log("✅ Weather API - Success");
        console.log(`   City: ${data.name}`);
        console.log(`   Temperature: ${data.main?.temp}°C`);
        console.log(`   Description: ${data.weather?.[0]?.description}`);
        return data;
      }
      console.log("❌ Weather API - Failed");
      console.log(`   Response: ${await response.text()}`);
      return null;
    } catch (error) {
      console.log(`❌ Weather API - Exception: ${error}`);
      return null;
    }
  }

  /** Test Aviationstack API directly. */
  async testFlightApi(
    depIata = "JFK",
    arrIata = "FCO",
    limit = 5,
  ): Promise<unknown | null> {
    console.log(`🔄 Testing Flight API: ${depIata} -> ${arrIata}`);

    const url = new URL("https://api.aviationstack.com/v1/flights");
    url.search = new URLSearchParams({
      access_key: this.apiKeys.AVIATIONSTACK_API_KEY,
      dep_iata: depIata,
      arr_iata: arrIata,
      limit: String(limit),
    }).toString();

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      console.log(`   Status: ${response.status}`);

      if (response.ok) {
        const data = await response.json();
        console.log("✅ Flight API - Success");

        const flights: Record<string, never>[] = data.data ?? [];
        console.log(`   Found ${flights.length} flights`);

        flights.slice(0, 3).forEach((flight, index) => {
          const airline = (flight as { airline?: { name?: string } }).airline?.name ??
            "Unknown";
          const flightNum = (flight as { flight?: { iata?: string } }).flight?.iata ??
            "Unknown";
          const status = (flight as { flight_status?: string }).flight_status ??
            "Unknown";
          console.log(
            `   Flight ${index + 1}: ${airline} ${flightNum} - ${status}`,
          );
        });

        return data;
      }
      console.log("❌ Flight API - Failed");
      console.log(`   Response: ${await response.text()}`);
      return null;
    } catch (error) {
      console.log(`❌ Flight API - Exception: ${error}`);
      return null;
    }
  }

  /** Run all direct API tests. */
  async runAllTests(): Promise<void> {
    console.log("🧪 Running Direct API Tests");
    console.log("=".repeat(50));

    await this.testCurrencyApi();
    console.log();

    await this.testWeatherApi();
    console.log();

    await this.testFlightApi();
    console.log();

    console.log("=".repeat(50));
    console.log("✅ Direct API testing complete");
  }
}

if (import.meta.main) {
  await new DirectApiTester().runAllTests();
}
