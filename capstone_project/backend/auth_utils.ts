/**
 * Authentication utilities for Cognito integration.
 *
 * Replaces `auth_utils.py`. Cognito's SECRET_HASH is an HMAC-SHA256, computed here with Web Crypto
 * instead of Python's `hmac`/`hashlib`.
 */
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { dirname, fromFileUrl, join } from "@std/path";

const COGNITO_CONFIG_FILE = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "notebooks",
  "environments",
  "cognito_config.json",
);

/** Cognito's SECRET_HASH: base64(HMAC-SHA256(clientSecret, username + clientId)). */
export async function secretHash(
  username: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${username}${clientId}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/** Authenticate user with Cognito and get access token. */
export async function reauthenticateUser(
  clientId: string,
  username = "testuser",
  password = "MyPassword123!",
): Promise<string | null> {
  try {
    // Load cognito config
    const config = JSON.parse(await Deno.readTextFile(COGNITO_CONFIG_FILE));
    const clientSecret: string = config.client_info.client_secret;

    // Authenticate with Cognito
    const cognitoClient = new CognitoIdentityProviderClient({});
    const response = await cognitoClient.send(
      new InitiateAuthCommand({
        ClientId: clientId,
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
          SECRET_HASH: await secretHash(username, clientId, clientSecret),
        },
      }),
    );

    return response.AuthenticationResult?.AccessToken ?? null;
  } catch (error) {
    console.log(`Authentication failed: ${error}`);
    return null;
  }
}
