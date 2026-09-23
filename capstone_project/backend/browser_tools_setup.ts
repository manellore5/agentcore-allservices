#!/usr/bin/env -S deno run -A
/**
 * TravelMate AI - AgentCore Browser Tools Setup
 * Starts a Browser session for web research.
 *
 * Replaces `browser_tools_setup.py`, which could never run: it imported
 * `bedrock_agentcore.services.browser_tools.BrowserToolsClient` and called `create_session` /
 * `list_sessions` / an `execute_actions` loop, none of which exist in any version of the SDK. The
 * real API starts a **session** against the built-in browser and drives it over CDP with Playwright.
 * This file keeps the original's intent: start a session, run the navigate/extract capability check
 * against a travel page, report, stop.
 */
import { Browser } from "bedrock-agentcore/browser";
import { chromium } from "playwright";
import { loadEnv } from "../shared/notebook.ts";

await loadEnv();

// Configuration
const REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const SESSION_NAME = "travel-research-session";
const TEST_URL = "https://www.louvre.fr/en";

/** Start an AgentCore Browser session for travel research. */
export async function createBrowserSession(): Promise<{ sessionId: string; client: Browser }> {
  console.log("🌐 Starting AgentCore Browser session...");
  const client = new Browser({ region: REGION });
  const session = await client.startSession({
    sessionName: SESSION_NAME,
    viewport: { width: 1920, height: 1080 },
    timeout: 3600,
  });
  console.info(`✅ Started browser session: ${session.sessionId}`);
  return { sessionId: session.sessionId, client };
}

/**
 * Test basic browser capabilities: connect over CDP, navigate, read the page.
 *
 * The browser itself runs in AWS, so Playwright connects to it rather than launching one locally —
 * there is no browser binary to download.
 */
export async function testBrowserCapabilities(client: Browser): Promise<boolean> {
  try {
    console.log("🧪 Testing browser capabilities...");
    const { url, headers } = await client.generateWebSocketUrl();
    const browser = await chromium.connectOverCDP(url, { headers });
    try {
      const context = browser.contexts()[0] ?? await browser.newContext();
      const page = context.pages()[0] ?? await context.newPage();

      await page.goto(TEST_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const title = await page.title();
      const heading = (await page.locator("h1").first().textContent({ timeout: 10_000 }))?.trim();

      console.log(`   Page title: ${title}`);
      console.log(`   First heading: ${heading ?? "(none)"}`);
      console.log("✅ Browser test completed successfully");
      return true;
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.log(`⚠️ Browser test failed: ${error}`);
    return false;
  }
}

if (import.meta.main) {
  // Start the browser session
  const { sessionId, client } = await createBrowserSession();

  try {
    // Test browser capabilities
    const testSuccess = await testBrowserCapabilities(client);

    // Save session info for notebooks
    const sessionInfo = {
      session_id: sessionId,
      session_name: SESSION_NAME,
      region: REGION,
      capabilities: [
        "attraction_research",
        "review_aggregation",
        "price_comparison",
        "content_extraction",
      ],
      test_status: testSuccess ? "passed" : "failed",
      created_at: new Date().toISOString(),
    };

    await Deno.writeTextFile(
      "browser_tools_info.json",
      `${JSON.stringify(sessionInfo, null, 2)}\n`,
    );

    console.log("\n💾 Session information saved to browser_tools_info.json");
    console.log(`Session ID: ${sessionId}`);
    console.log(`Test Status: ${testSuccess ? "✅ Passed" : "❌ Failed"}`);
    console.log("Ready for travel research!");
  } finally {
    // Sessions are billed while they live, so always stop it
    await client.stopSession();
    console.log("🛑 Session stopped");
  }
}
