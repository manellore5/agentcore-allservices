// Hand-written replacement for Python's `bedrock_agentcore.services.identity.IdentityClient`.
//
// The Python `bedrock-agentcore` SDK ships a high-level Identity client that wraps the
// `bedrock-agentcore-control` (credential providers, workload identities) and `bedrock-agentcore`
// (3LO token exchange) boto3 clients, honours the `BEDROCK_AGENTCORE_{CP,DP}_ENDPOINT` overrides, and
// turns the `UserTokenIdentifier` / `UserIdIdentifier` pydantic models into the service's tagged
// `userIdentifier` union. AWS publishes no TypeScript equivalent — only the raw `@aws-sdk/client-*`
// command clients — so this module ports the methods the course uses onto AWS SDK v3, keeping the
// Python method names (camelCased), argument names, defaults and return shapes so a reader can diff a
// Python cell against the TypeScript cell and see only a translation.
//
// Ported from: py-sdk/src/bedrock_agentcore/services/identity.py.
import {
  BedrockAgentCoreControlClient,
  CreateOauth2CredentialProviderCommand,
  type CreateOauth2CredentialProviderRequest,
  type CreateOauth2CredentialProviderResponse,
  GetOauth2CredentialProviderCommand,
  type GetOauth2CredentialProviderResponse,
  GetWorkloadIdentityCommand,
  type GetWorkloadIdentityResponse,
  UpdateWorkloadIdentityCommand,
  type UpdateWorkloadIdentityResponse,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  BedrockAgentCoreClient,
  CompleteResourceTokenAuthCommand,
  type CompleteResourceTokenAuthResponse,
  type UserIdentifier,
} from "@aws-sdk/client-bedrock-agentcore";

/** The OAuth2.0 token issued by the user's identity provider. Python: `UserTokenIdentifier`. */
export interface UserTokenIdentifier {
  userToken: string;
}

/** The ID of the user a workload access token was retrieved for. Python: `UserIdIdentifier`. */
export interface UserIdIdentifier {
  userId: string;
}

/** Python's `Union[UserTokenIdentifier, UserIdIdentifier]`. */
export type UserIdentifierInput = UserTokenIdentifier | UserIdIdentifier;

export interface CompleteResourceTokenAuthOptions {
  sessionUri: string;
  userIdentifier: UserIdentifierInput;
}

export interface UpdateWorkloadIdentityOptions {
  name: string;
  /** Python's snake-cased `allowed_resource_oauth_2_return_urls`. */
  allowedResourceOauth2ReturnUrls: string[];
}

/**
 * The `isinstance` dispatch inside `IdentityClient.complete_resource_token_auth`, which builds the
 * service's tagged `userIdentifier` union from whichever pydantic model the caller passed. Pure, so
 * the union mapping is unit-testable without calling AWS.
 */
export function toUserIdentifier(userIdentifier: UserIdentifierInput): UserIdentifier {
  if ("userId" in userIdentifier && userIdentifier.userId !== undefined) {
    return { userId: userIdentifier.userId };
  }
  if ("userToken" in userIdentifier && userIdentifier.userToken !== undefined) {
    return { userToken: userIdentifier.userToken };
  }
  throw new Error(`Unexpected UserIdentifier: ${JSON.stringify(userIdentifier)}`);
}

/**
 * A high-level client for Bedrock AgentCore Identity.
 *
 * Python: `IdentityClient(region)`. Here: `new IdentityClient({ region })`.
 */
export class IdentityClient {
  readonly region: string;
  /** Control plane, Python's `cp_client`. */
  readonly cpClient: BedrockAgentCoreControlClient;
  /** Data plane, Python's `dp_client`. */
  readonly dpClient: BedrockAgentCoreClient;

  constructor({ region }: { region: string }) {
    this.region = region;
    // Python reads the same two endpoint overrides from `bedrock_agentcore._utils.endpoints`.
    const cpEndpoint = Deno.env.get("BEDROCK_AGENTCORE_CP_ENDPOINT");
    const dpEndpoint = Deno.env.get("BEDROCK_AGENTCORE_DP_ENDPOINT");
    this.cpClient = new BedrockAgentCoreControlClient({
      region,
      ...(cpEndpoint !== undefined ? { endpoint: cpEndpoint } : {}),
    });
    this.dpClient = new BedrockAgentCoreClient({
      region,
      ...(dpEndpoint !== undefined ? { endpoint: dpEndpoint } : {}),
    });
  }

  /**
   * Create an OAuth2 credential provider. Takes the whole request as one object, as in Python
   * (`identity_client.create_oauth2_credential_provider({...})`).
   */
  async createOauth2CredentialProvider(
    req: CreateOauth2CredentialProviderRequest,
  ): Promise<CreateOauth2CredentialProviderResponse> {
    console.info("Creating OAuth2 credential provider...");
    return await this.cpClient.send(new CreateOauth2CredentialProviderCommand(req));
  }

  /**
   * Fetch an existing OAuth2 credential provider — what the notebook falls back to when creation
   * reports "already exists".
   *
   * In Python this is not a method: it is reached through the pass-through on the control-plane
   * client, `identity_client.cp_client.get_oauth2_credential_provider(name=...)`. `cpClient` is
   * public here too, but the course uses this method so the call site stays one line.
   */
  async getOauth2CredentialProvider(
    { name }: { name: string },
  ): Promise<GetOauth2CredentialProviderResponse> {
    console.info(`Fetching OAuth2 credential provider '${name}'...`);
    return await this.cpClient.send(new GetOauth2CredentialProviderCommand({ name }));
  }

  /**
   * Confirm the user authentication session for obtaining OAuth2.0 tokens for a resource — the last
   * leg of the 3LO flow, called by the OAuth2 callback server with the session id it was redirected
   * with.
   */
  async completeResourceTokenAuth(
    { sessionUri, userIdentifier }: CompleteResourceTokenAuthOptions,
  ): Promise<CompleteResourceTokenAuthResponse> {
    console.info("Completing 3LO OAuth2 flow...");
    return await this.dpClient.send(
      new CompleteResourceTokenAuthCommand({
        userIdentifier: toUserIdentifier(userIdentifier),
        sessionUri,
      }),
    );
  }

  /** Retrieve information about a workload identity. */
  async getWorkloadIdentity({ name }: { name: string }): Promise<GetWorkloadIdentityResponse> {
    console.info(`Fetching workload identity '${name}'`);
    return await this.cpClient.send(new GetWorkloadIdentityCommand({ name }));
  }

  /**
   * Update an existing workload identity with allowed resource OAuth2 callback urls.
   *
   * Python spells the argument `allowed_resource_oauth_2_return_urls`; camelCasing that snake_case
   * form would give `allowedResourceOauth2ReturnUrls`, which is also the wire field name, so the two
   * cells read the same.
   */
  async updateWorkloadIdentity(
    { name, allowedResourceOauth2ReturnUrls }: UpdateWorkloadIdentityOptions,
  ): Promise<UpdateWorkloadIdentityResponse> {
    console.info(
      `Updating workload identity '${name}' with callback urls: ${
        allowedResourceOauth2ReturnUrls.join(", ")
      }`,
    );
    return await this.cpClient.send(
      new UpdateWorkloadIdentityCommand({ name, allowedResourceOauth2ReturnUrls }),
    );
  }
}
