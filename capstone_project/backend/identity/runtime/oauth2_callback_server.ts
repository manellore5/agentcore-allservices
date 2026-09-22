#!/usr/bin/env -S deno run -A
/**
 * OAuth2 Callback Server for Google Drive Integration
 * Handles OAuth2 3-legged authentication flow with AgentCore Identity.
 *
 * Replaces `oauth2_callback_server.py`: `Deno.serve` in place of FastAPI + uvicorn, and the
 * course's own `IdentityClient` in place of `bedrock_agentcore.services.identity`.
 *
 * This runs on the learner's own machine, not in AgentCore Runtime: Google redirects the browser
 * here after consent, and this server hands the session back to AgentCore Identity.
 */
import { IdentityClient, type UserIdentifierInput } from "../../../toolkit/mod.ts";

// Configuration constants
export const OAUTH2_CALLBACK_SERVER_PORT = 9090;
export const PING_ENDPOINT = "/ping";
export const OAUTH2_CALLBACK_ENDPOINT = "/oauth2/callback";
export const USER_IDENTIFIER_ENDPOINT = "/userIdentifier/token";

const SUCCESS_HTML = `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth2 Success</title>
    <style>
        body {
            margin: 0; padding: 0; height: 100vh;
            display: flex; justify-content: center; align-items: center;
            font-family: Arial, sans-serif; background-color: #f5f5f5;
        }
        .container {
            text-align: center; padding: 2rem; background-color: white;
            border-radius: 8px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }
        h1 { color: #28a745; margin: 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>✅ Google Drive OAuth2 Authorization Successful!</h1>
        <p>You can now close this window and return to the application.</p>
    </div>
</body>
</html>
`;

export class OAuth2CallbackServer {
  #identityClient: IdentityClient;
  #userTokenIdentifier: UserIdentifierInput | null = null;

  constructor(region: string) {
    this.#identityClient = new IdentityClient({ region });
  }

  /** The request handler, kept separate from `serve()` so it can be unit-tested. */
  handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === USER_IDENTIFIER_ENDPOINT) {
      this.#userTokenIdentifier = await request.json() as UserIdentifierInput;
      return new Response(null, { status: 200 });
    }

    if (request.method === "GET" && url.pathname === PING_ENDPOINT) {
      return Response.json({ status: "success" });
    }

    if (request.method === "GET" && url.pathname === OAUTH2_CALLBACK_ENDPOINT) {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId) {
        return Response.json({ detail: "Missing session_id query parameter" }, { status: 400 });
      }
      if (!this.#userTokenIdentifier) {
        console.error("No configured user token identifier");
        return Response.json({ detail: "Internal Server Error" }, { status: 500 });
      }

      await this.#identityClient.completeResourceTokenAuth({
        sessionUri: sessionId,
        userIdentifier: this.#userTokenIdentifier,
      });

      return new Response(SUCCESS_HTML, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  };

  serve(): Deno.HttpServer {
    return Deno.serve(
      { hostname: "127.0.0.1", port: OAUTH2_CALLBACK_SERVER_PORT },
      this.handler,
    );
  }
}

export function getOauth2CallbackUrl(): string {
  return `http://localhost:${OAUTH2_CALLBACK_SERVER_PORT}${OAUTH2_CALLBACK_ENDPOINT}`;
}

export async function storeTokenInOauth2CallbackServer(userTokenValue: string): Promise<void> {
  if (!userTokenValue) return;
  await fetch(`http://localhost:${OAUTH2_CALLBACK_SERVER_PORT}${USER_IDENTIFIER_ENDPOINT}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userToken: userTokenValue }),
    signal: AbortSignal.timeout(2000),
  });
}

export async function waitForOauth2ServerToBeReady(durationSeconds = 40): Promise<boolean> {
  const deadline = Date.now() + durationSeconds * 1000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `http://localhost:${OAUTH2_CALLBACK_SERVER_PORT}${PING_ENDPOINT}`,
        { signal: AbortSignal.timeout(2000) },
      );
      if (response.ok) {
        await response.body?.cancel();
        return true;
      }
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

if (import.meta.main) {
  // Python used argparse: `-r/--region`, required.
  const args = Deno.args;
  const regionIndex = args.findIndex((a) => a === "-r" || a === "--region");
  const region = regionIndex >= 0 ? args[regionIndex + 1] : Deno.env.get("AWS_REGION");
  if (!region) {
    console.error("Usage: oauth2_callback_server.ts --region <AWS Region>");
    Deno.exit(2);
  }

  console.log(`OAuth2 callback server listening on ${getOauth2CallbackUrl()}`);
  new OAuth2CallbackServer(region).serve();
}
