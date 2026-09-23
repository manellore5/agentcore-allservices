/**
 * Helper for reading API keys back out of AgentCore Identity credential providers.
 *
 * Replaces `identity_helper.py`. The Gateway stores each target's API key in a credential provider
 * backed by Secrets Manager; the ExchangeRate spec wants the key as a request parameter, so the
 * agent has to read it back.
 */
import {
  BedrockAgentCoreControlClient,
  GetApiKeyCredentialProviderCommand,
  ListApiKeyCredentialProvidersCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export class IdentityHelper {
  readonly agentcoreClient: BedrockAgentCoreControlClient;
  readonly secretsClient: SecretsManagerClient;

  constructor(region = "us-east-1") {
    this.agentcoreClient = new BedrockAgentCoreControlClient({ region });
    this.secretsClient = new SecretsManagerClient({ region });
  }

  /** Find a credential provider by name prefix and return the API key it holds. */
  async getApiKeyByProviderName(providerNamePrefix: string): Promise<string | null> {
    try {
      // Step 1: find the provider
      const providers = await this.agentcoreClient.send(
        new ListApiKeyCredentialProvidersCommand({ maxResults: 100 }),
      );
      const provider = providers.credentialProviders?.find((p) =>
        p.name?.startsWith(providerNamePrefix)
      );
      if (!provider?.name) {
        console.log(`❌ No credential provider found starting with '${providerNamePrefix}'`);
        return null;
      }

      // Step 2: read its details
      const details = await this.agentcoreClient.send(
        new GetApiKeyCredentialProviderCommand({ name: provider.name }),
      );

      // Step 3: extract secret ARN
      const secretArn = details.apiKeySecretArn?.secretArn;
      if (!secretArn) {
        console.log("❌ Credential provider has no secret ARN");
        return null;
      }
      console.log(`   Secret ARN: ${secretArn}`);

      // Step 4: read the secret
      const secret = await this.secretsClient.send(
        new GetSecretValueCommand({ SecretId: secretArn }),
      );
      const apiKey = parseSecretValue(secret.SecretString);
      if (!apiKey) {
        console.log("❌ Failed to parse API key from secret");
        return null;
      }
      return apiKey;
    } catch (error) {
      console.log(`❌ Error retrieving API key: ${error}`);
      return null;
    }
  }

  /** The ExchangeRate key, which its OpenAPI spec takes as a request parameter. */
  getExchangerateApiKey(): Promise<string | null> {
    return this.getApiKeyByProviderName("ExchangeRate-ApiKey");
  }
}

/**
 * Parse a secret value, accepting any of the field names AgentCore has used.
 * Exported for tests.
 */
export function parseSecretValue(secretString: string | undefined): string | null {
  if (!secretString) return null;
  try {
    const parsed = JSON.parse(secretString) as Record<string, unknown>;
    const key = parsed.api_key ?? parsed.apiKey ?? parsed.api_key_value ?? parsed.key;
    // If no standard field is found, hand back the whole JSON as the Python did
    return typeof key === "string" ? key : secretString;
  } catch {
    // Not JSON: the secret is the key itself
    return secretString;
  }
}
