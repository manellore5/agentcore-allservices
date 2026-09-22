#!/usr/bin/env -S deno run -A
/**
 * TravelMate AI - AgentCore Code Interpreter Setup
 * Starts a Code Interpreter session for advanced calculations.
 *
 * Replaces `code_interpreter_setup.py`, which could never run: it imported
 * `bedrock_agentcore.services.code_interpreter.CodeInterpreterClient` and called
 * `create_runtime` / `execute_code` / `list_runtimes`, none of which exist in any version of the
 * SDK. AgentCore has no "code interpreter runtime" to create — you start a **session** against the
 * built-in interpreter and execute code in it. This file keeps the original's intent: start a
 * session, run the travel-budget capability check, report, stop.
 *
 * The code sent *into* the sandbox stays Python: the sandbox is a Python execution service, and
 * demonstrating that is the lesson. It is data sent to a service, not part of this repo's toolchain.
 */
import { CodeInterpreter } from "bedrock-agentcore/code-interpreter";
import { loadEnv } from "../shared/notebook.ts";

await loadEnv();

// Configuration
const REGION = Deno.env.get("AWS_REGION") ?? "us-east-1";
const SESSION_NAME = "travel-code-interpreter";

/** The capability check, run inside the sandbox. Python, by design (see the module comment). */
export const TEST_CODE = `
import pandas as pd
import numpy as np

# Test basic functionality
print("✅ Code Interpreter Session Test")
print(f"Pandas version: {pd.__version__}")
print(f"NumPy version: {np.__version__}")

# Simple calculation test
budget = 5000
days = 10
daily_budget = budget / days

print(f"Sample calculation: \${budget} for {days} days = \${daily_budget}/day")

# Budget breakdown, the calculation the travel agent needs
categories = ['Flights', 'Hotels', 'Food', 'Activities']
amounts = [budget * 0.25, budget * 0.35, budget * 0.20, budget * 0.20]
breakdown = pd.DataFrame({'category': categories, 'amount': amounts})
print(breakdown.to_string(index=False))
`;

/** Start an AgentCore Code Interpreter session for travel calculations. */
export async function createCodeInterpreterSession(): Promise<
  { sessionId: string; client: CodeInterpreter }
> {
  console.log("🧮 Starting AgentCore Code Interpreter session...");
  const client = new CodeInterpreter({ region: REGION });
  const session = await client.startSession({
    sessionName: SESSION_NAME,
    description: "Code interpreter for travel budget calculations and data analysis",
  });
  console.info(`✅ Started code interpreter session: ${session.sessionId}`);
  return { sessionId: session.sessionId, client };
}

/** Test basic code interpreter capabilities. */
export async function testSessionCapabilities(client: CodeInterpreter): Promise<boolean> {
  try {
    console.log("🧪 Testing session capabilities...");
    const result = await client.executeCode({ code: TEST_CODE, language: "python" });
    console.log(result);
    console.log("✅ Session test completed successfully");
    return true;
  } catch (error) {
    console.log(`⚠️ Session test failed: ${error}`);
    return false;
  }
}

if (import.meta.main) {
  // Start the code interpreter session
  const { sessionId, client } = await createCodeInterpreterSession();

  try {
    // Test session capabilities
    const testSuccess = await testSessionCapabilities(client);

    // Save session info for notebooks
    const sessionInfo = {
      session_id: sessionId,
      session_name: SESSION_NAME,
      region: REGION,
      capabilities: [
        "budget_analysis",
        "cost_comparison",
        "budget_optimization",
        "statistical_analysis",
      ],
      test_status: testSuccess ? "passed" : "failed",
      created_at: new Date().toISOString(),
    };

    await Deno.writeTextFile(
      "code_interpreter_info.json",
      `${JSON.stringify(sessionInfo, null, 2)}\n`,
    );

    console.log("\n💾 Session information saved to code_interpreter_info.json");
    console.log(`Session ID: ${sessionId}`);
    console.log(`Test Status: ${testSuccess ? "✅ Passed" : "❌ Failed"}`);
    console.log("Ready for advanced travel calculations!");
  } finally {
    // Sessions are billed while they live, so always stop it
    await client.stopSession();
    console.log("🛑 Session stopped");
  }
}
