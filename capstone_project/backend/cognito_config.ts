/**
 * Cognito Configuration Management.
 *
 * Replaces `cognito_config.py`: saves and loads the Cognito OAuth configuration so a re-run does not
 * create a second user pool, and makes sure the app client allows the flows the course needs.
 */
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  type ExplicitAuthFlowsType,
  ListUserPoolsCommand,
  UpdateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { dirname, fromFileUrl, join } from "@std/path";
import type { CognitoAuthorizerResult, CognitoClientInfo, GatewayClient } from "../toolkit/mod.ts";

export const COGNITO_CONFIG_FILE = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "notebooks",
  "environments",
  "cognito_config.json",
);

/** Save Cognito configuration to file. */
export async function saveCognitoConfig(
  cognitoResult: CognitoAuthorizerResult,
  gatewayName: string,
): Promise<void> {
  const config = {
    gateway_name: gatewayName,
    authorizer_config: cognitoResult.authorizer_config,
    client_info: cognitoResult.client_info,
  };
  await Deno.writeTextFile(COGNITO_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`💾 Cognito config saved to ${COGNITO_CONFIG_FILE}`);
}

/** Load existing Cognito configuration from file. */
export async function loadCognitoConfig(
  gatewayName: string,
): Promise<CognitoAuthorizerResult | null> {
  try {
    const config = JSON.parse(await Deno.readTextFile(COGNITO_CONFIG_FILE));
    if (config.gateway_name === gatewayName) {
      console.log(`📂 Loaded existing Cognito config for ${gatewayName}`);
      return {
        authorizer_config: config.authorizer_config,
        client_info: config.client_info,
      } as CognitoAuthorizerResult;
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      console.log(`⚠️ Error loading Cognito config: ${error}`);
    }
  }
  return null;
}

/** Ensure Cognito client has USER_PASSWORD_AUTH enabled. */
export async function ensureUserPasswordAuth(
  clientId: string,
  userPoolId: string,
  region = "us-east-1",
): Promise<void> {
  const cognitoClient = new CognitoIdentityProviderClient({ region });
  try {
    // Get current client config
    const response = await cognitoClient.send(
      new DescribeUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId }),
    );
    const currentFlows = response.UserPoolClient?.ExplicitAuthFlows ?? [];

    // Check if USER_PASSWORD_AUTH is already enabled
    if (!currentFlows.includes("ALLOW_USER_PASSWORD_AUTH")) {
      console.log("🔧 Enabling USER_PASSWORD_AUTH flow...");
      const updatedFlows = [
        ...new Set<ExplicitAuthFlowsType>([
          ...currentFlows,
          "ALLOW_USER_PASSWORD_AUTH",
          "ALLOW_REFRESH_TOKEN_AUTH",
        ]),
      ];
      await cognitoClient.send(
        new UpdateUserPoolClientCommand({
          UserPoolId: userPoolId,
          ClientId: clientId,
          ExplicitAuthFlows: updatedFlows,
        }),
      );
      console.log("✅ USER_PASSWORD_AUTH flow enabled");
    } else {
      console.log("✅ USER_PASSWORD_AUTH already enabled");
    }
  } catch (error) {
    console.log(`⚠️ Error updating auth flows: ${error}`);
  }
}

/** Enable client_credentials OAuth flow for Gateway authentication. */
export async function activateOauthClientCredentials(
  clientInfo: CognitoClientInfo,
  region = "us-east-1",
): Promise<void> {
  const cognitoClient = new CognitoIdentityProviderClient({ region });
  try {
    await cognitoClient.send(
      new UpdateUserPoolClientCommand({
        UserPoolId: clientInfo.user_pool_id,
        ClientId: clientInfo.client_id,
        AllowedOAuthFlows: ["client_credentials"],
        AllowedOAuthScopes: [clientInfo.scope],
        AllowedOAuthFlowsUserPoolClient: true,
      }),
    );
    console.log("✅ Enabled client_credentials OAuth flow");
  } catch (error) {
    console.log(`⚠️ Error enabling OAuth flow: ${error}`);
    throw error;
  }
}

/** Setup Cognito OAuth, reusing existing config if available. */
export async function setupCognitoOauth(
  client: GatewayClient,
  gatewayName: string,
  region = "us-east-1",
): Promise<CognitoAuthorizerResult> {
  // Try to load existing config
  const existing = await loadCognitoConfig(gatewayName);
  if (existing) {
    // Ensure OAuth flows are properly configured even for existing config
    await activateOauthClientCredentials(existing.client_info, region);
    return existing;
  }

  // Check for existing user pools with the same name, for the reader's benefit: the
  // toolkit client creates its own pool either way.
  try {
    const pools = await new CognitoIdentityProviderClient({ region }).send(
      new ListUserPoolsCommand({ MaxResults: 60 }),
    );
    const existingPool = pools.UserPools?.find((p) => p.Name === gatewayName);
    if (existingPool) {
      console.log(`⚠️ Found existing Cognito pool: ${existingPool.Name}`);
    }
  } catch (error) {
    console.log(`Warning: Could not check existing pools: ${error}`);
  }

  // Create new Cognito resources
  console.log("🔐 Creating new Cognito OAuth configuration...");
  const cognitoResult = await client.createOauthAuthorizerWithCognito(gatewayName);

  // Save for future use
  await saveCognitoConfig(cognitoResult, gatewayName);

  // Ensure USER_PASSWORD_AUTH is enabled
  await ensureUserPasswordAuth(
    cognitoResult.client_info.client_id,
    cognitoResult.client_info.user_pool_id,
    region,
  );

  // Enable client_credentials OAuth flow (fixes invalid_grant error)
  await activateOauthClientCredentials(cognitoResult.client_info, region);

  return cognitoResult;
}
