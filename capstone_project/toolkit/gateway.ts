// Hand-written replacement for the Python starter toolkit's
// `bedrock_agentcore_starter_toolkit.operations.gateway.client.GatewayClient`
// (together with the `create_role.py` and `constants.py` helpers it calls).
//
// The starter toolkit ships as a Python package only: there is no TypeScript build of it and no
// other npm package covers Gateway + Cognito "EZ auth" setup, so the course carries its own copy.
// Everything here is the AWS SDK v3 (`bedrock-agentcore-control`, `cognito-idp`, `iam`, `sts`)
// plus `fetch` for the OAuth token call, and the class keeps the Python API so a notebook cell
// reads as a straight translation of the Python one: same class name, camelCase methods, one
// options object mirroring the Python keyword arguments, and the same return shapes.
//
// The raw control-plane client stays public as `client`, because the notebooks reach through the
// helper for calls it does not wrap (`gatewayClient.client.send(new ListGatewaysCommand({}))`,
// the Python `gateway_client.client.list_gateways()`).
import {
  type ApiKeyCredentialLocation,
  type ApiSchemaConfiguration,
  type AuthorizerConfiguration,
  BedrockAgentCoreControlClient,
  CreateApiKeyCredentialProviderCommand,
  CreateGatewayCommand,
  type CreateGatewayResponse,
  CreateGatewayTargetCommand,
  type CreateGatewayTargetResponse,
  type CredentialProviderConfiguration,
  DeleteGatewayCommand,
  DeleteGatewayTargetCommand,
  type ExceptionLevel,
  type GatewayPolicyEngineConfiguration,
  type GatewayPolicyEngineMode,
  GetGatewayCommand,
  GetGatewayTargetCommand,
  ListGatewayTargetsCommand,
  type McpLambdaTargetConfiguration,
  type TargetConfiguration,
  UpdateGatewayCommand,
  type UpdateGatewayResponse,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  CognitoIdentityProviderClient,
  CreateResourceServerCommand,
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
  CreateUserPoolDomainCommand,
  DeleteUserPoolCommand,
  DeleteUserPoolDomainCommand,
  DescribeUserPoolDomainCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  AttachRolePolicyCommand,
  CreatePolicyCommand,
  CreateRoleCommand,
  EntityAlreadyExistsException,
  GetRoleCommand,
  IAMClient,
  ListPoliciesCommand,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { Logger } from "./logger.ts";

/** Python: `bedrock_agentcore_starter_toolkit.utils.aws.DEFAULT_REGION`. */
export const DEFAULT_REGION = "us-west-2";
/** Python: `constants.GATEWAY_EXECUTION_POLICY_NAME`. */
export const GATEWAY_EXECUTION_POLICY_NAME = "BedrockAgentCoreGatewayExecutionPolicy";
/** Python: the `role_name` default of `create_gateway_execution_role`. */
export const GATEWAY_EXECUTION_ROLE_NAME = "AgentCoreGatewayExecutionRole";

/** Python: `__wait_for_ready(max_attempts=30, delay=2)`. */
const WAIT_MAX_ATTEMPTS = 30;
const WAIT_DELAY_MS = 2_000;
/** Python: `get_access_token_for_cognito`'s `max_retries` / `retry_delay`. */
const TOKEN_MAX_RETRIES = 5;
const TOKEN_RETRY_DELAY_MS = 10_000;

/** Python: `GatewaySetupException`. */
export class GatewaySetupError extends Error {
  override name = "GatewaySetupError";
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Returned shapes
// ---------------------------------------------------------------------------

/** The gateway as `create_mcp_gateway` returns it (the raw CreateGateway response). */
export type McpGateway = CreateGatewayResponse;
/** The target as `create_mcp_gateway_target` returns it. */
export type McpGatewayTarget = CreateGatewayTargetResponse;

/** Anything carrying the fields the target helpers read: a Create- or GetGateway response. */
export interface GatewayRef {
  gatewayId?: string;
  roleArn?: string;
}

/**
 * Python: the `client_info` dict of `create_oauth_authorizer_with_cognito`. The keys stay
 * snake_case because they are written to (and read back from) the labs' JSON config files.
 */
export interface CognitoClientInfo {
  client_id: string;
  client_secret: string;
  user_pool_id: string;
  token_endpoint: string;
  scope: string;
  domain_prefix: string;
}

/** Python: the dict returned by `create_oauth_authorizer_with_cognito`. */
export interface CognitoAuthorizerResult {
  authorizer_config: AuthorizerConfiguration;
  client_info: CognitoClientInfo;
}

/** Python: the `credentials` dict of `create_mcp_gateway_target` (the API-key shape). */
export interface ApiKeyCredentials {
  apiKey: string;
  /** "HEADER" | "QUERY_PARAMETER". */
  credentialLocation: ApiKeyCredentialLocation;
  credentialParameterName: string;
}

/** Python: `target_type`, narrowed to the two the course uses. */
export type McpTargetType = "openApiSchema" | "lambda";
/** Python: `target_payload`, whose shape follows `target_type`. */
export type McpTargetPayload = ApiSchemaConfiguration | McpLambdaTargetConfiguration;

export interface CreateMcpGatewayOptions {
  name?: string | null;
  roleArn?: string | null;
  authorizerConfig?: AuthorizerConfiguration | null;
  enableSemanticSearch?: boolean;
  exceptionLevel?: ExceptionLevel | null;
  policyEngineConfig?: GatewayPolicyEngineConfiguration | null;
}

export interface CreateMcpGatewayTargetOptions {
  gateway: GatewayRef;
  name?: string | null;
  targetType?: McpTargetType;
  targetPayload?: McpTargetPayload | null;
  credentials?: ApiKeyCredentials | null;
}

export interface UpdateGatewayOptions {
  gatewayIdentifier: string;
  description?: string | null;
  /** `null` detaches the policy engine; leaving it out keeps whatever the gateway has. */
  policyEngineConfig?: GatewayPolicyEngineConfiguration | null;
}

export interface UpdateGatewayPolicyEngineOptions {
  gatewayIdentifier: string;
  /** `null` detaches the policy engine (Python passes `None` in the lab's cleanup cell). */
  policyEngineArn: string | null;
  mode?: GatewayPolicyEngineMode | null;
}

// ---------------------------------------------------------------------------
// IAM policy documents (Python: gateway/constants.py)
// ---------------------------------------------------------------------------

export interface IamPolicyStatement {
  Sid?: string;
  Effect: "Allow" | "Deny";
  Principal?: Record<string, string>;
  Action: string | string[];
  Resource?: string | string[];
  Condition?: Record<string, Record<string, string>>;
}

export interface IamPolicyDocument {
  Version: string;
  Statement: IamPolicyStatement[];
}

/** Python: `utils.aws.get_partition` (botocore's endpoint data, reduced to the live partitions). */
export function getPartition(region: string): string {
  if (region.startsWith("cn-")) return "aws-cn";
  if (region.startsWith("us-gov-")) return "aws-us-gov";
  if (region.startsWith("us-iso-b")) return "aws-iso-b";
  if (region.startsWith("us-iso")) return "aws-iso";
  return "aws";
}

/** Python: `utils.aws.extract_id_from_arn`. */
export function extractIdFromArn(arnOrId: string): string {
  return arnOrId.includes("/") ? arnOrId.split("/").pop() as string : arnOrId;
}

/** Python: `create_role._role_name_from_arn`. */
export function roleNameFromArn(roleArn: string): string {
  return roleArn.split("/").pop() as string;
}

/** Python: `utils.runtime.templates.execution_role_trust_policy.json.j2`. */
export function buildGatewayTrustPolicy(region: string, accountId: string): IamPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AssumeRolePolicy",
        Effect: "Allow",
        Principal: { Service: "bedrock-agentcore.amazonaws.com" },
        Action: "sts:AssumeRole",
        Condition: {
          StringEquals: { "aws:SourceAccount": accountId },
          ArnLike: {
            "aws:SourceArn": `arn:${
              getPartition(region)
            }:bedrock-agentcore:${region}:${accountId}:*`,
          },
        },
      },
    ],
  };
}

/** Python: `constants.build_gateway_access_policy`. */
export function buildGatewayAccessPolicy(
  region: string,
  accountId: string,
  gatewayName: string,
  partition = "aws",
): IamPolicyDocument {
  const prefix = `arn:${partition}:bedrock-agentcore:${region}:${accountId}`;
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "GetGateway",
        Effect: "Allow",
        Action: ["bedrock-agentcore:GetGateway"],
        Resource: [`${prefix}:gateway/${gatewayName}-*`],
      },
      {
        // Not in the Python policy, but without it every OpenAPI target fails at call time with
        // "Failed to fetch outbound api key ... not authorized to perform:
        // bedrock-agentcore:GetWorkloadAccessToken", then the same for GetResourceApiKey. The
        // Gateway assumes this role, mints a workload token for itself, and reads the target's
        // credential provider through it — both against the gateway's own workload identity.
        // Found on a live run; the credential-provider policy alone is not enough.
        Sid: "GatewayWorkloadIdentity",
        Effect: "Allow",
        Action: [
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetResourceApiKey",
          "bedrock-agentcore:GetResourceOauth2Token",
        ],
        Resource: [
          `${prefix}:workload-identity-directory/default`,
          `${prefix}:workload-identity-directory/default/workload-identity/*`,
        ],
      },
      {
        Sid: "GetConfigurationBundleVersion",
        Effect: "Allow",
        Action: ["bedrock-agentcore:GetConfigurationBundleVersion"],
        Resource: [`${prefix}:configuration-bundle/*`],
        Condition: {
          StringEquals: {
            "aws:ResourceAccount": "${aws:PrincipalAccount}",
            "aws:RequestedRegion": region,
          },
        },
      },
    ],
  };
}

/** Python: `constants.build_gateway_credential_provider_policy`. */
export function buildGatewayCredentialProviderPolicy(
  region: string,
  accountId: string,
  providerName: string,
  providerKind: "oauth2" | "apikey",
  partition = "aws",
): IamPolicyDocument {
  const bac = `arn:${partition}:bedrock-agentcore:${region}:${accountId}`;
  const sm = `arn:${partition}:secretsmanager:${region}:${accountId}`;
  const tokenAction = providerKind === "oauth2"
    ? "bedrock-agentcore:GetResourceOauth2Token"
    : "bedrock-agentcore:GetResourceApiKey";
  const providerResource = providerKind === "oauth2"
    ? `${bac}:token-vault/default/oauth2credentialprovider/${providerName}*`
    : `${bac}:token-vault/default/apikeycredentialprovider/${providerName}*`;
  const secretResource = providerKind === "oauth2"
    ? `${sm}:secret:bedrock-agentcore-identity!default/oauth2/${providerName}-*`
    : `${sm}:secret:bedrock-agentcore-identity!default/apikey/${providerName}-*`;

  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "GatewayCredentialProviderToken",
        Effect: "Allow",
        Action: [tokenAction],
        Resource: [`${bac}:token-vault/default`, providerResource],
      },
      {
        Sid: "GatewayCredentialProviderSecret",
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: [secretResource],
      },
    ],
  };
}

/** Python: `create_role.append_credential_provider_permissions`'s inline policy name. */
export function credentialProviderPolicyName(
  providerKind: "oauth2" | "apikey",
  providerName: string,
): string {
  return `GatewayCredentialProvider-${providerKind}-${providerName}`.slice(0, 128);
}

/** Python: the `{"mcp": {target_type: target_payload}}` target configuration. */
export function buildTargetConfiguration(
  targetType: McpTargetType,
  targetPayload: McpTargetPayload,
): TargetConfiguration {
  // The payload's shape follows `targetType`, which the SDK's tagged unions cannot infer from a
  // computed key, so each branch asserts the member type the caller has already chosen.
  if (targetType === "lambda") {
    return { mcp: { lambda: targetPayload as McpLambdaTargetConfiguration } };
  }
  return { mcp: { openApiSchema: targetPayload as ApiSchemaConfiguration } };
}

/** Python: the `credentialProviderConfigurations` built for an API-key OpenAPI target. */
export function buildApiKeyCredentialProviderConfiguration(
  providerArn: string,
  credentials: ApiKeyCredentials,
): CredentialProviderConfiguration {
  return {
    credentialProviderType: "API_KEY",
    credentialProvider: {
      apiKeyCredentialProvider: {
        providerArn,
        credentialLocation: credentials.credentialLocation,
        credentialParameterName: credentials.credentialParameterName,
      },
    },
  };
}

/** Python: `urllib.parse.urlencode(form_data)` for the client-credentials token request. */
export function buildTokenRequestBody(clientInfo: CognitoClientInfo): string {
  return new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientInfo.client_id,
    client_secret: clientInfo.client_secret,
    scope: clientInfo.scope,
  }).toString();
}

/** Python: comparing two parsed trust-policy dicts in `utils.aws.validate_iam_role_trust_policy`. */
// deno-lint-ignore no-explicit-any -- compares arbitrary parsed JSON, as Python's `dict ==` does.
export function jsonEquals(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEquals(item, b[i]));
  }
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) return false;
  return aKeys.every((k) => jsonEquals(a[k], b[k]));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// GatewayClient
// ---------------------------------------------------------------------------

export interface GatewayClientOptions {
  /** Python: `region_name`. */
  region?: string;
}

/**
 * High-level client for Bedrock AgentCore Gateway operations.
 *
 * Python: `GatewayClient(region_name=...)`.
 */
export class GatewayClient {
  readonly region: string;
  /** The raw AWS SDK v3 control-plane client, for calls this helper does not wrap. */
  readonly client: BedrockAgentCoreControlClient;
  readonly cognito: CognitoIdentityProviderClient;
  readonly iam: IAMClient;
  readonly sts: STSClient;
  readonly logger = new Logger("bedrock_agentcore.gateway");

  constructor({ region }: GatewayClientOptions = {}) {
    this.region = region ?? DEFAULT_REGION;
    this.client = new BedrockAgentCoreControlClient({ region: this.region });
    this.cognito = new CognitoIdentityProviderClient({ region: this.region });
    this.iam = new IAMClient({ region: this.region });
    this.sts = new STSClient({ region: this.region });
  }

  /** Python: `GatewayClient.generate_random_id()` — the first 8 characters of a UUID4. */
  static generateRandomId(): string {
    return crypto.randomUUID().slice(0, 8);
  }

  /**
   * Creates an MCP Gateway.
   *
   * Python: `create_mcp_gateway(name=..., role_arn=..., authorizer_config=...,
   * enable_semantic_search=..., exception_level=...)`. A null `roleArn` creates an execution role
   * and a null `authorizerConfig` creates the Cognito authorizer.
   *
   * Returns the CreateGateway response itself — read `gatewayId` and `gatewayUrl` off it. (The
   * Python returns a dict too; the repo's old `gateway.get_mcp_url()` / `gateway.gateway_id`
   * calls were always broken.)
   */
  async createMcpGateway({
    name,
    roleArn,
    authorizerConfig,
    enableSemanticSearch = true,
    exceptionLevel = "DEBUG",
    policyEngineConfig,
  }: CreateMcpGatewayOptions = {}): Promise<McpGateway> {
    const gatewayName = name ?? `TestGateway${GatewayClient.generateRandomId()}`;

    let executionRoleArn = roleArn ?? undefined;
    if (!executionRoleArn) {
      this.logger.info("Role not provided, creating an execution role to use");
      executionRoleArn = await this.createGatewayExecutionRole(gatewayName.toLowerCase());
      this.logger.info("✓ Successfully created execution role for Gateway");
    }

    let authorizer = authorizerConfig ?? undefined;
    if (!authorizer) {
      this.logger.info("Authorizer config not provided, creating an authorizer to use");
      const cognitoResult = await this.createOauthAuthorizerWithCognito(gatewayName);
      this.logger.info("✓ Successfully created authorizer for Gateway");
      authorizer = cognitoResult.authorizer_config;
    }

    this.logger.info("Creating Gateway");
    const gateway = await this.client.send(
      new CreateGatewayCommand({
        name: gatewayName,
        roleArn: executionRoleArn,
        protocolType: "MCP",
        authorizerType: "CUSTOM_JWT",
        authorizerConfiguration: authorizer,
        exceptionLevel: exceptionLevel ?? undefined,
        ...(enableSemanticSearch
          ? { protocolConfiguration: { mcp: { searchType: "SEMANTIC" } } }
          : {}),
        ...(policyEngineConfig ? { policyEngineConfiguration: policyEngineConfig } : {}),
      }),
    );
    this.logger.info("✓ Created Gateway:", gateway.gatewayArn);
    this.logger.info("  Gateway URL:", gateway.gatewayUrl);

    this.logger.info("  Waiting for Gateway to be ready...");
    await this.waitForReady(
      "Gateway",
      () => this.client.send(new GetGatewayCommand({ gatewayIdentifier: gateway.gatewayId })),
    );
    this.logger.info("\n✅Gateway is ready");

    return gateway;
  }

  /**
   * Creates an MCP Gateway Target.
   *
   * Python: `create_mcp_gateway_target(gateway=..., name=..., target_type=..., target_payload=...,
   * credentials=...)`. For an `openApiSchema` target the API key in `credentials` becomes an
   * API-key credential provider, whose access is then scoped onto the gateway's execution role.
   */
  async createMcpGatewayTarget({
    gateway,
    name,
    targetType = "lambda",
    targetPayload,
    credentials,
  }: CreateMcpGatewayTargetOptions): Promise<McpGatewayTarget> {
    const targetName = name ?? `TestGatewayTarget${GatewayClient.generateRandomId()}`;

    if (!targetPayload) {
      if (targetType === "openApiSchema") {
        throw new Error("You must provide a target configuration for your OpenAPI specification.");
      }
      // Python creates a throwaway "AgentCoreLambdaTestFunction" here; the course always brings
      // its own Lambda, so this asks for the payload instead of deploying a sample function.
      throw new Error("You must provide a target payload (lambdaArn and toolSchema).");
    }

    let credentialProviderConfigurations: CredentialProviderConfiguration[] = [
      { credentialProviderType: "GATEWAY_IAM_ROLE" },
    ];
    if (targetType === "openApiSchema") {
      credentialProviderConfigurations = [
        await this.createApiKeyCredentialProviderConfiguration(
          targetName,
          credentials,
          gateway.roleArn,
        ),
      ];
    }

    this.logger.info("Creating Target");
    const target = await this.client.send(
      new CreateGatewayTargetCommand({
        gatewayIdentifier: gateway.gatewayId,
        name: targetName,
        targetConfiguration: buildTargetConfiguration(targetType, targetPayload),
        credentialProviderConfigurations,
      }),
    );
    this.logger.info("✓ Added target successfully (ID:", target.targetId, ")");
    this.logger.info("  Waiting for target to be ready...");
    await this.waitForReady(
      "Target",
      () =>
        this.client.send(
          new GetGatewayTargetCommand({
            gatewayIdentifier: gateway.gatewayId,
            targetId: target.targetId,
          }),
        ),
    );
    this.logger.info("\n✅Target is ready");
    return target;
  }

  /**
   * Creates the Cognito OAuth authorization server for a gateway.
   *
   * Python: `create_oauth_authorizer_with_cognito(gateway_name)` — user pool (admin-create-only),
   * domain, resource server with an `invoke` scope, and a client-credentials app client.
   */
  async createOauthAuthorizerWithCognito(gatewayName: string): Promise<CognitoAuthorizerResult> {
    this.logger.info("Starting EZ Auth setup: Creating Cognito resources...");

    try {
      const poolName = `agentcore-gateway-${GatewayClient.generateRandomId()}`;
      const userPool = await this.cognito.send(
        new CreateUserPoolCommand({
          PoolName: poolName,
          AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
        }),
      );
      const userPoolId = userPool.UserPool?.Id as string;
      this.logger.info("  ✓ Created User Pool:", userPoolId);

      const domainPrefix = `agentcore-${GatewayClient.generateRandomId()}`;
      await this.cognito.send(
        new CreateUserPoolDomainCommand({ Domain: domainPrefix, UserPoolId: userPoolId }),
      );
      this.logger.info("  ✓ Created domain:", domainPrefix);

      this.logger.info("  ⏳ Waiting for domain to be available...");
      let domainReady = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          const described = await this.cognito.send(
            new DescribeUserPoolDomainCommand({ Domain: domainPrefix }),
          );
          if (described.DomainDescription?.Status === "ACTIVE") {
            domainReady = true;
            break;
          }
        } catch (error) {
          this.logger.debug("Domain not yet active:", error);
        }
        await sleep(1_000);
      }
      this.logger.info(
        domainReady ? "  ✓ Domain is active" : "  ⚠️  Domain may not be fully available yet",
      );

      const resourceServerId = gatewayName;
      await this.cognito.send(
        new CreateResourceServerCommand({
          UserPoolId: userPoolId,
          Identifier: resourceServerId,
          Name: gatewayName,
          Scopes: [
            { ScopeName: "invoke", ScopeDescription: "Scope for invoking the agentcore gateway" },
          ],
        }),
      );
      this.logger.info("  ✓ Created resource server:", resourceServerId);

      const clientName = `agentcore-client-${GatewayClient.generateRandomId()}`;
      const scopeNames = [`${resourceServerId}/invoke`];
      const userPoolClient = await this.cognito.send(
        new CreateUserPoolClientCommand({
          UserPoolId: userPoolId,
          ClientName: clientName,
          GenerateSecret: true,
          AllowedOAuthFlows: ["client_credentials"],
          AllowedOAuthScopes: scopeNames,
          AllowedOAuthFlowsUserPoolClient: true,
          SupportedIdentityProviders: ["COGNITO"],
        }),
      );
      const clientId = userPoolClient.UserPoolClient?.ClientId as string;
      const clientSecret = userPoolClient.UserPoolClient?.ClientSecret as string;
      this.logger.info("  ✓ Created client:", clientId);

      const discoveryUrl =
        `https://cognito-idp.${this.region}.amazonaws.com/${userPoolId}/.well-known/openid-configuration`;

      const result: CognitoAuthorizerResult = {
        authorizer_config: {
          customJWTAuthorizer: { allowedClients: [clientId], discoveryUrl },
        },
        client_info: {
          client_id: clientId,
          client_secret: clientSecret,
          user_pool_id: userPoolId,
          token_endpoint:
            `https://${domainPrefix}.auth.${this.region}.amazoncognito.com/oauth2/token`,
          scope: scopeNames[0],
          domain_prefix: domainPrefix,
        },
      };

      this.logger.info(
        `  ⏳ Waiting for DNS propagation of domain: ${domainPrefix}.auth.${this.region}.amazoncognito.com`,
      );
      await sleep(60_000);

      this.logger.info("✓ EZ Auth setup complete!");
      return result;
    } catch (error) {
      throw new GatewaySetupError(`Failed to create Cognito resources: ${error}`);
    }
  }

  /**
   * Gets an OAuth token with the client-credentials flow.
   *
   * Python: `get_access_token_for_cognito(client_info)`. Retries while the freshly created Cognito
   * domain is still not resolvable (Python retries on urllib3's NameResolutionError; `fetch`
   * reports the same failure as a TypeError).
   */
  async getAccessTokenForCognito(clientInfo: CognitoClientInfo): Promise<string> {
    this.logger.info("Fetching test token from Cognito...");

    for (let attempt = 0; attempt < TOKEN_MAX_RETRIES; attempt++) {
      try {
        this.logger.info(
          "  Attempting to connect to token endpoint:",
          clientInfo.token_endpoint,
        );
        const response = await fetch(clientInfo.token_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: buildTokenRequestBody(clientInfo),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status !== 200) {
          throw new GatewaySetupError(`Token request failed: ${await response.text()}`);
        }
        const tokenData = await response.json() as { access_token: string };
        this.logger.info("✓ Got test token successfully");
        return tokenData.access_token;
      } catch (error) {
        const networkFailure = error instanceof TypeError;
        if (networkFailure && attempt < TOKEN_MAX_RETRIES - 1) {
          this.logger.warning(
            `  Domain not yet resolvable (attempt ${attempt + 1}/${TOKEN_MAX_RETRIES}). ` +
              `Waiting ${TOKEN_RETRY_DELAY_MS / 1000} seconds...`,
          );
          await sleep(TOKEN_RETRY_DELAY_MS);
          continue;
        }
        throw new GatewaySetupError(`Failed to get test token: ${error}`);
      }
    }
    throw new GatewaySetupError("Failed to get test token: retries exhausted");
  }

  /**
   * Updates a gateway.
   *
   * Python: `update_gateway(gateway_identifier, description=None, policy_engine_config=None)`.
   * UpdateGateway replaces the whole resource, so the current values are read first and carried
   * over. Passing `policyEngineConfig: null` detaches the policy engine; leaving it out keeps it.
   */
  async updateGateway({
    gatewayIdentifier,
    description,
    policyEngineConfig,
  }: UpdateGatewayOptions): Promise<UpdateGatewayResponse> {
    const resolvedId = extractIdFromArn(gatewayIdentifier);
    this.logger.info("Updating gateway", resolvedId);

    try {
      const gateway = await this.client.send(
        new GetGatewayCommand({ gatewayIdentifier: resolvedId }),
      );

      const keepPolicyEngine = policyEngineConfig === undefined
        ? gateway.policyEngineConfiguration
        : policyEngineConfig ?? undefined;
      if (policyEngineConfig) {
        this.logger.info("  Policy Engine ARN:", policyEngineConfig.arn);
        this.logger.info("  Mode:", policyEngineConfig.mode);
      }

      const updated = await this.client.send(
        new UpdateGatewayCommand({
          gatewayIdentifier: resolvedId,
          // Names cannot change after creation (AWS API limitation).
          name: gateway.name,
          roleArn: gateway.roleArn,
          protocolType: gateway.protocolType,
          authorizerType: gateway.authorizerType,
          description: description ?? gateway.description,
          policyEngineConfiguration: keepPolicyEngine,
          authorizerConfiguration: gateway.authorizerConfiguration,
          protocolConfiguration: gateway.protocolConfiguration,
          kmsKeyArn: gateway.kmsKeyArn,
          customTransformConfiguration: gateway.customTransformConfiguration,
          interceptorConfigurations: gateway.interceptorConfigurations,
          exceptionLevel: gateway.exceptionLevel,
        }),
      );

      this.logger.info("✓ Gateway update initiated");
      this.logger.info("  Waiting for gateway to be ready...");
      await this.waitForReady(
        "Gateway",
        () => this.client.send(new GetGatewayCommand({ gatewayIdentifier: resolvedId })),
      );
      this.logger.info("✓ Gateway update complete");
      return updated;
    } catch (error) {
      this.logger.error("Failed to update gateway:", error);
      throw new GatewaySetupError(`Failed to update gateway: ${error}`);
    }
  }

  /**
   * Attaches (or detaches) a policy engine on a gateway.
   *
   * Python: `update_gateway_policy_engine(gateway_identifier, policy_engine_arn, mode="ENFORCE")`.
   * The lab's cleanup cell detaches by passing `policy_engine_arn=None`, which Python forwarded as
   * `{"arn": None, "mode": None}` and the API rejected; here a null ARN drops the configuration
   * from the update instead, which is what detaching actually takes.
   */
  updateGatewayPolicyEngine({
    gatewayIdentifier,
    policyEngineArn,
    mode = "ENFORCE",
  }: UpdateGatewayPolicyEngineOptions): Promise<UpdateGatewayResponse> {
    this.logger.info("Attaching policy engine to gateway");
    return this.updateGateway({
      gatewayIdentifier,
      policyEngineConfig: policyEngineArn
        ? { arn: policyEngineArn, mode: mode ?? "ENFORCE" }
        : null,
    });
  }

  /**
   * Removes every resource belonging to a gateway: its targets, the gateway, then the Cognito
   * domain and user pool.
   *
   * Python: `cleanup_gateway(gateway_id, client_info=None)`.
   */
  async cleanupGateway(
    gatewayId: string,
    clientInfo?: Partial<CognitoClientInfo> | null,
  ): Promise<void> {
    this.logger.info("🧹 Cleaning up Gateway resources...");

    this.logger.info("  • Finding targets for gateway:", gatewayId);
    try {
      const response = await this.client.send(
        new ListGatewayTargetsCommand({ gatewayIdentifier: gatewayId }),
      );
      const targets = response.items ?? [];
      this.logger.info(`    Found ${targets.length} targets to delete`);

      for (const target of targets) {
        this.logger.info("  • Deleting target:", target.targetId);
        try {
          await this.client.send(
            new DeleteGatewayTargetCommand({
              gatewayIdentifier: gatewayId,
              targetId: target.targetId,
            }),
          );
          this.logger.info("    ✓ Target deletion initiated:", target.targetId);
          await sleep(5_000);
        } catch (error) {
          this.logger.warning(`    ⚠️ Error deleting target ${target.targetId}: ${error}`);
        }
      }

      this.logger.info("  • Verifying targets deletion...");
      await sleep(5_000);
      const verify = await this.client.send(
        new ListGatewayTargetsCommand({ gatewayIdentifier: gatewayId }),
      );
      const remaining = verify.items ?? [];
      if (remaining.length > 0) {
        this.logger.warning(`    ⚠️ ${remaining.length} targets still remain`);
      } else {
        this.logger.info("    ✓ All targets deleted");
      }
    } catch (error) {
      this.logger.warning("    ⚠️ Error managing targets:", error);
    }

    try {
      this.logger.info("  • Deleting gateway:", gatewayId);
      await this.client.send(new DeleteGatewayCommand({ gatewayIdentifier: gatewayId }));
      this.logger.info("    ✓ Gateway deleted:", gatewayId);
    } catch (error) {
      this.logger.warning("    ⚠️ Error deleting gateway:", error);
    }

    const userPoolId = clientInfo?.user_pool_id;
    if (userPoolId) {
      if (clientInfo?.domain_prefix) {
        this.logger.info("  • Deleting Cognito domain:", clientInfo.domain_prefix);
        try {
          await this.cognito.send(
            new DeleteUserPoolDomainCommand({
              UserPoolId: userPoolId,
              Domain: clientInfo.domain_prefix,
            }),
          );
          this.logger.info("    ✓ Cognito domain deleted");
          await sleep(5_000);
        } catch (error) {
          this.logger.warning("    ⚠️ Error deleting Cognito domain:", error);
        }
      }

      this.logger.info("  • Deleting Cognito user pool:", userPoolId);
      try {
        await this.cognito.send(new DeleteUserPoolCommand({ UserPoolId: userPoolId }));
        this.logger.info("    ✓ Cognito user pool deleted");
      } catch (error) {
        this.logger.warning("    ⚠️ Error deleting Cognito user pool:", error);
      }
    }

    this.logger.info("✅ Cleanup complete");
  }

  // -------------------------------------------------------------------------
  // Internals (Python: the `__`-prefixed methods and create_role.py)
  // -------------------------------------------------------------------------

  /** Python: `create_role.create_gateway_execution_role`. */
  private async createGatewayExecutionRole(
    gatewayName: string,
    roleName: string = GATEWAY_EXECUTION_ROLE_NAME,
  ): Promise<string> {
    const accountId = await this.accountId();
    const trustPolicy = buildGatewayTrustPolicy(this.region, accountId);

    try {
      const role = await this.iam.send(
        new CreateRoleCommand({
          RoleName: roleName,
          AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
          Description: "Execution role for AgentCore Gateway",
        }),
      );

      const basePolicy = buildGatewayAccessPolicy(
        this.region,
        accountId,
        gatewayName,
        getPartition(this.region),
      );
      const policyArn = await this.createOrGetManagedPolicy(
        GATEWAY_EXECUTION_POLICY_NAME,
        JSON.stringify(basePolicy),
      );
      await this.iam.send(
        new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: policyArn }),
      );

      return role.Role?.Arn as string;
    } catch (error) {
      if (!(error instanceof EntityAlreadyExistsException)) {
        this.logger.error("Error creating role:", error);
        throw error;
      }
      const existing = await this.iam.send(new GetRoleCommand({ RoleName: roleName }));
      const document = existing.Role?.AssumeRolePolicyDocument;
      const actual = document ? JSON.parse(decodeURIComponent(document)) : null;
      if (!jsonEquals(actual, trustPolicy)) {
        throw new Error(
          `Refusing to reuse existing IAM role '${roleName}' because its trust policy does not ` +
            "match the policy required by Bedrock AgentCore Gateway. Delete the conflicting role " +
            "or pass your own role with roleArn.",
        );
      }
      this.logger.info("✓ Role already exists:", existing.Role?.Arn);
      return existing.Role?.Arn as string;
    }
  }

  /** Python: `create_role._try_create_policy` / `_get_existing_policy_arn`. */
  private async createOrGetManagedPolicy(
    policyName: string,
    policyDocument: string,
  ): Promise<string> {
    try {
      const created = await this.iam.send(
        new CreatePolicyCommand({ PolicyName: policyName, PolicyDocument: policyDocument }),
      );
      return created.Policy?.Arn as string;
    } catch (error) {
      if (!(error instanceof EntityAlreadyExistsException)) throw error;
      let marker: string | undefined;
      do {
        const page = await this.iam.send(
          new ListPoliciesCommand({ Scope: "Local", Marker: marker }),
        );
        const match = page.Policies?.find((policy) => policy.PolicyName === policyName);
        if (match?.Arn) return match.Arn;
        marker = page.IsTruncated ? page.Marker : undefined;
      } while (marker);
      throw new Error(`Failed to get existing policy arn for ${policyName}`);
    }
  }

  /** Python: `__handle_openapi_target_credential_provider_creation` (the api_key branch). */
  private async createApiKeyCredentialProviderConfiguration(
    targetName: string,
    credentials: ApiKeyCredentials | null | undefined,
    roleArn: string | undefined,
  ): Promise<CredentialProviderConfiguration> {
    if (!credentials?.apiKey) {
      throw new Error(
        "Provided credentials object was not formatted correctly. Correct format:\n" +
          '{ apiKey: "<key>", credentialLocation: "HEADER | QUERY_PARAMETER", ' +
          'credentialParameterName: "<name of parameter>" }',
      );
    }

    this.logger.info("Creating credential provider");
    const providerName = `${targetName}-ApiKey-${GatewayClient.generateRandomId()}`;
    const provider = await this.client.send(
      new CreateApiKeyCredentialProviderCommand({
        name: providerName,
        apiKey: credentials.apiKey,
      }),
    );
    this.logger.info(
      "✓ Added credential provider successfully (ARN:",
      provider.credentialProviderArn,
      ")",
    );

    if (roleArn) await this.appendCredentialProviderPermissions(roleArn, providerName);

    return buildApiKeyCredentialProviderConfiguration(
      provider.credentialProviderArn as string,
      credentials,
    );
  }

  /** Python: `create_role.append_credential_provider_permissions` (best effort, never raises). */
  private async appendCredentialProviderPermissions(
    roleArn: string,
    providerName: string,
  ): Promise<void> {
    const roleName = roleNameFromArn(roleArn);
    try {
      const accountId = await this.accountId();
      const policy = buildGatewayCredentialProviderPolicy(
        this.region,
        accountId,
        providerName,
        "apikey",
        getPartition(this.region),
      );
      await this.iam.send(
        new PutRolePolicyCommand({
          RoleName: roleName,
          PolicyName: credentialProviderPolicyName("apikey", providerName),
          PolicyDocument: JSON.stringify(policy),
        }),
      );
      this.logger.info(
        `✓ Scoped credential-provider permissions added to ${roleName} for provider ${providerName}`,
      );
    } catch (error) {
      this.logger.warning(
        `⚠️ Could not add scoped credential-provider permissions to ${roleName} for provider ` +
          `${providerName}: ${error}. The gateway may lack access to this provider's secret; ` +
          "continuing (best effort).",
      );
    }
  }

  private async accountId(): Promise<string> {
    const identity = await this.sts.send(new GetCallerIdentityCommand({}));
    return identity.Account as string;
  }

  /** Python: `__wait_for_ready` — poll while CREATING or UPDATING, then require READY. */
  private async waitForReady(
    resourceName: string,
    fetchResource: () => Promise<{ status?: string }>,
    maxAttempts: number = WAIT_MAX_ATTEMPTS,
    delayMs: number = WAIT_DELAY_MS,
  ): Promise<void> {
    let attempts = 0;
    let response = await fetchResource();
    while (response.status === "CREATING" || response.status === "UPDATING") {
      await sleep(delayMs);
      attempts += 1;
      if (attempts >= maxAttempts) {
        throw new Error(`${resourceName} not ready after ${maxAttempts} attempts`);
      }
      response = await fetchResource();
    }
    if (response.status !== "READY") {
      throw new Error(`${resourceName} failed: ${JSON.stringify(response)}`);
    }
  }
}
