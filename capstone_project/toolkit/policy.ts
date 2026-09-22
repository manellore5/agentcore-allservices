// Hand-written replacement for the Python starter toolkit's
// `bedrock_agentcore_starter_toolkit.operations.policy.client.PolicyClient`.
//
// The starter toolkit is Python-only and nothing on npm wraps the AgentCore policy control plane,
// so the course carries its own copy on top of the AWS SDK v3 `bedrock-agentcore-control` client.
// The class keeps the Python API — same class name, camelCase methods, one options object
// mirroring the Python keyword arguments, same return shapes — so a notebook cell reads as a
// straight translation of the Python one.
//
// The raw control-plane client stays public as `client`, because the policy lab reaches through
// the helper for the calls it does not wrap (CreatePolicyEngine, ListPolicyEngines, GetPolicyEngine
// and UpdateGateway), the Python `policy_admin_client.client.create_policy_engine(...)`.
import {
  BedrockAgentCoreControlClient,
  type Content,
  CreatePolicyCommand,
  CreatePolicyEngineCommand,
  type CreatePolicyEngineResponse,
  type CreatePolicyResponse,
  DeletePolicyCommand,
  DeletePolicyEngineCommand,
  type DeletePolicyEngineResponse,
  type DeletePolicyResponse,
  GetPolicyCommand,
  GetPolicyEngineCommand,
  type GetPolicyEngineResponse,
  GetPolicyGenerationCommand,
  type GetPolicyGenerationResponse,
  type GetPolicyResponse,
  ListPoliciesCommand,
  type ListPoliciesResponse,
  ListPolicyEnginesCommand,
  type ListPolicyEnginesResponse,
  ListPolicyGenerationAssetsCommand,
  type ListPolicyGenerationAssetsResponse,
  type Policy,
  type PolicyDefinition,
  type PolicyEngine,
  type PolicyGenerationAsset,
  type PolicyValidationMode,
  type Resource,
  ResourceNotFoundException,
  StartPolicyGenerationCommand,
  type StartPolicyGenerationResponse,
  UpdatePolicyCommand,
  UpdatePolicyEngineCommand,
  type UpdatePolicyEngineResponse,
  type UpdatePolicyResponse,
} from "@aws-sdk/client-bedrock-agentcore-control";

/** Python: `utils.aws.DEFAULT_REGION`. */
export const DEFAULT_REGION = "us-west-2";
/** Python: `policy/constants.py`. */
export const DEFAULT_MAX_ATTEMPTS = 30;
export const DEFAULT_POLL_DELAY_MS = 2_000;
/** The page size the Python client uses when it walks every policy or engine. */
const LIST_PAGE_SIZE = 100;

/** Python: `PolicySetupException`. */
export class PolicySetupError extends Error {
  override name = "PolicySetupError";
}
/** Python: `PolicyEngineNotFoundException`. */
export class PolicyEngineNotFoundError extends Error {
  override name = "PolicyEngineNotFoundError";
}
/** Python: `PolicyNotFoundException`. */
export class PolicyNotFoundError extends Error {
  override name = "PolicyNotFoundError";
}
/** Python: `PolicyGenerationNotFoundException`. */
export class PolicyGenerationNotFoundError extends Error {
  override name = "PolicyGenerationNotFoundError";
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR";

const LEVELS: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40 };

/**
 * The smallest stand-in for the Python logger the notebooks tune with
 * `policy_client.logger.setLevel(logging.WARNING)`.
 */
export class Logger {
  private level: LogLevel = "INFO";

  constructor(private readonly prefix: string) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private log(level: LogLevel, ...args: unknown[]): void {
    if (LEVELS[level] < LEVELS[this.level]) return;
    console.error(`${this.prefix} - ${level} -`, ...args);
  }

  debug(...args: unknown[]): void {
    this.log("DEBUG", ...args);
  }
  info(...args: unknown[]): void {
    this.log("INFO", ...args);
  }
  warning(...args: unknown[]): void {
    this.log("WARNING", ...args);
  }
  error(...args: unknown[]): void {
    this.log("ERROR", ...args);
  }
}

// ---------------------------------------------------------------------------
// Option and result shapes
// ---------------------------------------------------------------------------

export interface PolicyClientOptions {
  /** Python: `region_name`. */
  region?: string;
}

export interface CreatePolicyEngineOptions {
  name: string;
  description?: string | null;
  encryptionKeyArn?: string | null;
  tags?: Record<string, string> | null;
  clientToken?: string | null;
}

export interface CreatePolicyOptions {
  policyEngineId: string;
  name: string;
  /** Python: `{"cedar": {"statement": "permit(...)"}}`. */
  definition: PolicyDefinition;
  description?: string | null;
  /** Python: `FAIL_ON_ANY_FINDINGS` | `IGNORE_ALL_FINDINGS`. */
  validationMode?: PolicyValidationMode | null;
  clientToken?: string | null;
}

export interface UpdatePolicyOptions {
  policyEngineId: string;
  policyId: string;
  definition: PolicyDefinition;
  description?: string | null;
  validationMode?: PolicyValidationMode | null;
}

export interface ListPoliciesOptions {
  policyEngineId: string;
  targetResourceScope?: string | null;
  maxResults?: number | null;
  nextToken?: string | null;
}

export interface GeneratePolicyOptions {
  policyEngineId: string;
  name: string;
  /** Python: `{"arn": "<gateway arn>"}`. */
  resource: Resource;
  /** Python: `{"rawText": "allow refunds..."}`. */
  content: Content;
  clientToken?: string | null;
  maxAttempts?: number;
  delayMs?: number;
  fetchAssets?: boolean;
}

/**
 * Python: the generation dict `generate_policy` returns, with `generatedPolicies` added when
 * `fetch_assets` is set.
 */
export interface PolicyGenerationResult extends GetPolicyGenerationResponse {
  generatedPolicies?: PolicyGenerationAsset[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Python: `next(e for e in engines if e["name"] == name)` over a fully paged list. */
export function findByName<T extends { name?: string }>(
  items: readonly T[],
  name: string,
): T | undefined {
  return items.find((item) => item.name === name);
}

/** Reads the Cedar statement out of a policy or generation-asset definition, if it has one. */
export function cedarStatement(definition?: PolicyDefinition): string | undefined {
  return definition && "cedar" in definition ? definition.cedar?.statement : undefined;
}

/** Python: the definition `create_policy_from_generation_asset` builds. */
export function policyDefinitionFromGenerationAsset(
  policyGenerationId: string,
  policyGenerationAssetId: string,
): PolicyDefinition {
  return { policyGeneration: { policyGenerationId, policyGenerationAssetId } };
}

/** Python: the `while True:` loops that follow `nextToken` until it is empty. */
export async function collectPages<T>(
  fetchPage: (nextToken?: string) => Promise<{ items?: T[]; nextToken?: string }>,
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | undefined;
  do {
    const page = await fetchPage(nextToken);
    all.push(...(page.items ?? []));
    nextToken = page.nextToken;
  } while (nextToken);
  return all;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// PolicyClient
// ---------------------------------------------------------------------------

/**
 * High-level client for Bedrock AgentCore Policy operations (policy engines, policies and
 * natural-language policy generation).
 *
 * Python: `PolicyClient(region_name=...)`.
 */
export class PolicyClient {
  readonly region: string;
  /** The raw AWS SDK v3 control-plane client, for calls this helper does not wrap. */
  readonly client: BedrockAgentCoreControlClient;
  readonly logger = new Logger("bedrock_agentcore.policy");

  constructor({ region }: PolicyClientOptions = {}) {
    this.region = region ?? DEFAULT_REGION;
    this.client = new BedrockAgentCoreControlClient({ region: this.region });
  }

  // ==================== Policy Engine Operations ====================

  /** Python: `create_policy_engine(name, description, encryption_key_arn, tags, client_token)`. */
  async createPolicyEngine({
    name,
    description,
    encryptionKeyArn,
    tags,
    clientToken,
  }: CreatePolicyEngineOptions): Promise<CreatePolicyEngineResponse> {
    this.logger.info("Creating Policy Engine:", name);
    try {
      const response = await this.client.send(
        new CreatePolicyEngineCommand({
          name,
          description: description ?? undefined,
          encryptionKeyArn: encryptionKeyArn ?? undefined,
          tags: tags ?? undefined,
          clientToken: clientToken ?? undefined,
        }),
      );
      this.logger.info("✓ Policy Engine creation initiated:", response.policyEngineArn);
      return response;
    } catch (error) {
      throw new PolicySetupError(`Failed to create policy engine: ${error}`);
    }
  }

  /**
   * Creates a policy engine, or returns the existing one with that name. Idempotent, and the
   * engine is ACTIVE when it returns.
   *
   * Python: `create_or_get_policy_engine(...)`.
   */
  async createOrGetPolicyEngine(
    options: CreatePolicyEngineOptions,
  ): Promise<PolicyEngine | GetPolicyEngineResponse> {
    this.logger.info("Creating or getting Policy Engine:", options.name);

    try {
      const engines = await collectPages<PolicyEngine>(async (nextToken) => {
        const page = await this.listPolicyEngines(LIST_PAGE_SIZE, nextToken);
        return { items: page.policyEngines ?? [], nextToken: page.nextToken };
      });
      const existing = findByName(engines, options.name);
      if (existing) {
        this.logger.info("✓ Found existing Policy Engine:", options.name);
        if (existing.status !== "ACTIVE") {
          this.logger.info("Waiting for Policy Engine to be active...");
          const active = await this.waitForPolicyEngineActive(existing.policyEngineId as string);
          this.logger.info("✓ Policy Engine is active");
          return active;
        }
        return existing;
      }
    } catch (error) {
      this.logger.warning("Could not list policy engines:", error);
    }

    const engine = await this.createPolicyEngine(options);
    this.logger.info("Waiting for Policy Engine to be active...");
    const active = await this.waitForPolicyEngineActive(engine.policyEngineId as string);
    this.logger.info("✓ Policy Engine is active");
    return active;
  }

  /** Python: `get_policy_engine(policy_engine_id)`. */
  async getPolicyEngine(policyEngineId: string): Promise<GetPolicyEngineResponse> {
    try {
      return await this.client.send(new GetPolicyEngineCommand({ policyEngineId }));
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyEngineNotFoundError(`Policy engine not found: ${policyEngineId}`);
      }
      throw new PolicySetupError(`Failed to get policy engine: ${error}`);
    }
  }

  /** Python: `update_policy_engine(policy_engine_id, description)`. */
  async updatePolicyEngine(
    policyEngineId: string,
    description?: string | null,
  ): Promise<UpdatePolicyEngineResponse> {
    this.logger.info("Updating Policy Engine:", policyEngineId);
    try {
      const response = await this.client.send(
        new UpdatePolicyEngineCommand({
          policyEngineId,
          // UpdatePolicyEngine takes the description in an `UpdatedDescription` wrapper; the
          // Python client passes a bare string, which the API rejects.
          description: description === undefined || description === null
            ? undefined
            : { optionalValue: description },
        }),
      );
      this.logger.info("✓ Policy Engine update initiated:", response.policyEngineArn);
      return response;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyEngineNotFoundError(`Policy engine not found: ${policyEngineId}`);
      }
      throw new PolicySetupError(`Failed to update policy engine: ${error}`);
    }
  }

  /** Python: `list_policy_engines(max_results, next_token)`. */
  async listPolicyEngines(
    maxResults?: number | null,
    nextToken?: string | null,
  ): Promise<ListPolicyEnginesResponse> {
    try {
      return await this.client.send(
        new ListPolicyEnginesCommand({
          maxResults: maxResults ?? undefined,
          nextToken: nextToken ?? undefined,
        }),
      );
    } catch (error) {
      throw new PolicySetupError(`Failed to list policy engines: ${error}`);
    }
  }

  /** Python: `delete_policy_engine(policy_engine_id)`. */
  async deletePolicyEngine(policyEngineId: string): Promise<DeletePolicyEngineResponse> {
    this.logger.info("Deleting Policy Engine:", policyEngineId);
    try {
      const response = await this.client.send(new DeletePolicyEngineCommand({ policyEngineId }));
      this.logger.info("✓ Policy Engine deletion initiated:", policyEngineId);
      return response;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyEngineNotFoundError(`Policy engine not found: ${policyEngineId}`);
      }
      throw new PolicySetupError(`Failed to delete policy engine: ${error}`);
    }
  }

  // ==================== Policy Operations ====================

  /** Python: `create_policy(policy_engine_id, name, definition, description, validation_mode)`. */
  async createPolicy({
    policyEngineId,
    name,
    definition,
    description,
    validationMode,
    clientToken,
  }: CreatePolicyOptions): Promise<CreatePolicyResponse> {
    this.logger.info("Creating Policy:", name);
    try {
      const response = await this.client.send(
        new CreatePolicyCommand({
          policyEngineId,
          name,
          definition,
          description: description ?? undefined,
          validationMode: validationMode ?? undefined,
          clientToken: clientToken ?? undefined,
        }),
      );
      this.logger.info("✓ Policy creation initiated:", response.policyArn);
      return response;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyEngineNotFoundError(`Policy engine not found: ${policyEngineId}`);
      }
      throw new PolicySetupError(`Failed to create policy: ${error}`);
    }
  }

  /**
   * Creates a policy, or returns the existing one with that name. Idempotent, and the policy is
   * ACTIVE when it returns.
   *
   * Python: `create_or_get_policy(policy_engine_id, name, definition, description,
   * validation_mode, client_token)`.
   */
  async createOrGetPolicy(options: CreatePolicyOptions): Promise<Policy | GetPolicyResponse> {
    const { policyEngineId, name } = options;
    this.logger.info("Creating or getting Policy:", name);

    try {
      const policies = await collectPages<Policy>(async (nextToken) => {
        const page = await this.listPolicies({
          policyEngineId,
          maxResults: LIST_PAGE_SIZE,
          nextToken,
        });
        return { items: page.policies ?? [], nextToken: page.nextToken };
      });
      const existing = findByName(policies, name);
      if (existing) {
        this.logger.info("✓ Found existing Policy:", name);
        if (existing.status !== "ACTIVE") {
          this.logger.info("Waiting for Policy to be active...");
          const active = await this.waitForPolicyActive(
            policyEngineId,
            existing.policyId as string,
          );
          this.logger.info("✓ Policy is active");
          return active;
        }
        return existing;
      }
    } catch (error) {
      this.logger.warning("Could not list policies:", error);
    }

    const policy = await this.createPolicy(options);
    this.logger.info("Waiting for Policy to be active...");
    const active = await this.waitForPolicyActive(policyEngineId, policy.policyId as string);
    this.logger.info("✓ Policy is active");
    return active;
  }

  /** Python: `get_policy(policy_engine_id, policy_id)`. */
  async getPolicy(policyEngineId: string, policyId: string): Promise<GetPolicyResponse> {
    try {
      return await this.client.send(new GetPolicyCommand({ policyEngineId, policyId }));
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyNotFoundError(`Policy not found: ${policyId}`);
      }
      throw new PolicySetupError(`Failed to get policy: ${error}`);
    }
  }

  /** Python: `update_policy(policy_engine_id, policy_id, definition, ...)`. */
  async updatePolicy({
    policyEngineId,
    policyId,
    definition,
    description,
    validationMode,
  }: UpdatePolicyOptions): Promise<UpdatePolicyResponse> {
    this.logger.info("Updating Policy:", policyId);
    try {
      const response = await this.client.send(
        new UpdatePolicyCommand({
          policyEngineId,
          policyId,
          definition,
          // Same `UpdatedDescription` wrapper as UpdatePolicyEngine.
          description: description === undefined || description === null
            ? undefined
            : { optionalValue: description },
          validationMode: validationMode ?? undefined,
        }),
      );
      this.logger.info("✓ Policy update initiated:", response.policyArn);
      return response;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyNotFoundError(`Policy not found: ${policyId}`);
      }
      throw new PolicySetupError(`Failed to update policy: ${error}`);
    }
  }

  /** Python: `list_policies(policy_engine_id, target_resource_scope, max_results, next_token)`. */
  async listPolicies({
    policyEngineId,
    targetResourceScope,
    maxResults,
    nextToken,
  }: ListPoliciesOptions): Promise<ListPoliciesResponse> {
    try {
      return await this.client.send(
        new ListPoliciesCommand({
          policyEngineId,
          targetResourceScope: targetResourceScope ?? undefined,
          maxResults: maxResults ?? undefined,
          nextToken: nextToken ?? undefined,
        }),
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyEngineNotFoundError(`Policy engine not found: ${policyEngineId}`);
      }
      throw new PolicySetupError(`Failed to list policies: ${error}`);
    }
  }

  /** Python: `delete_policy(policy_engine_id, policy_id)`. */
  async deletePolicy(policyEngineId: string, policyId: string): Promise<DeletePolicyResponse> {
    this.logger.info("Deleting Policy:", policyId);
    try {
      const response = await this.client.send(
        new DeletePolicyCommand({ policyEngineId, policyId }),
      );
      this.logger.info("✓ Policy deletion initiated:", policyId);
      return response;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyNotFoundError(`Policy not found: ${policyId}`);
      }
      throw new PolicySetupError(`Failed to delete policy: ${error}`);
    }
  }

  /** Python: `create_policy_from_generation_asset(...)`. */
  createPolicyFromGenerationAsset({
    policyEngineId,
    name,
    policyGenerationId,
    policyGenerationAssetId,
    description,
    validationMode,
    clientToken,
  }: {
    policyEngineId: string;
    name: string;
    policyGenerationId: string;
    policyGenerationAssetId: string;
    description?: string | null;
    validationMode?: PolicyValidationMode | null;
    clientToken?: string | null;
  }): Promise<CreatePolicyResponse> {
    return this.createPolicy({
      policyEngineId,
      name,
      definition: policyDefinitionFromGenerationAsset(policyGenerationId, policyGenerationAssetId),
      description,
      validationMode,
      clientToken,
    });
  }

  // ==================== Policy Generation Operations ====================

  /** Python: `start_policy_generation(policy_engine_id, name, resource, content, client_token)`. */
  async startPolicyGeneration({
    policyEngineId,
    name,
    resource,
    content,
    clientToken,
  }: {
    policyEngineId: string;
    name: string;
    resource: Resource;
    content: Content;
    clientToken?: string | null;
  }): Promise<StartPolicyGenerationResponse> {
    this.logger.info("Starting Policy Generation:", name);
    try {
      const response = await this.client.send(
        new StartPolicyGenerationCommand({
          policyEngineId,
          name,
          resource,
          content,
          clientToken: clientToken ?? undefined,
        }),
      );
      this.logger.info("✓ Policy Generation initiated:", response.policyGenerationArn);
      return response;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyEngineNotFoundError(`Policy engine not found: ${policyEngineId}`);
      }
      throw new PolicySetupError(`Failed to start policy generation: ${error}`);
    }
  }

  /** Python: `get_policy_generation(policy_engine_id, policy_generation_id)`. */
  async getPolicyGeneration(
    policyEngineId: string,
    policyGenerationId: string,
  ): Promise<GetPolicyGenerationResponse> {
    try {
      return await this.client.send(
        new GetPolicyGenerationCommand({ policyEngineId, policyGenerationId }),
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyGenerationNotFoundError(
          `Policy generation not found: ${policyGenerationId}`,
        );
      }
      throw new PolicySetupError(`Failed to get policy generation: ${error}`);
    }
  }

  /** Python: `list_policy_generation_assets(policy_engine_id, policy_generation_id, ...)`. */
  async listPolicyGenerationAssets({
    policyEngineId,
    policyGenerationId,
    maxResults,
    nextToken,
  }: {
    policyEngineId: string;
    policyGenerationId: string;
    maxResults?: number | null;
    nextToken?: string | null;
  }): Promise<ListPolicyGenerationAssetsResponse> {
    try {
      return await this.client.send(
        new ListPolicyGenerationAssetsCommand({
          policyEngineId,
          policyGenerationId,
          maxResults: maxResults ?? undefined,
          nextToken: nextToken ?? undefined,
        }),
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new PolicyGenerationNotFoundError(
          `Policy generation not found: ${policyGenerationId}`,
        );
      }
      throw new PolicySetupError(`Failed to get policy generation assets: ${error}`);
    }
  }

  /**
   * Generates Cedar policies from natural language and waits for the generation to finish.
   *
   * Python: `generate_policy(policy_engine_id, name, resource, content, client_token,
   * max_attempts=30, delay=2, fetch_assets=False)`. With `fetchAssets` the generated policies come
   * back on `generatedPolicies`.
   */
  async generatePolicy({
    policyEngineId,
    name,
    resource,
    content,
    clientToken,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    delayMs = DEFAULT_POLL_DELAY_MS,
    fetchAssets = false,
  }: GeneratePolicyOptions): Promise<PolicyGenerationResult> {
    this.logger.info("Generating policies from natural language:", name);

    const started = await this.startPolicyGeneration({
      policyEngineId,
      name,
      resource,
      content,
      clientToken,
    });
    const policyGenerationId = started.policyGenerationId as string;
    this.logger.info(`Started generation ${policyGenerationId}, waiting for completion...`);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const generation: PolicyGenerationResult = await this.getPolicyGeneration(
        policyEngineId,
        policyGenerationId,
      );

      if (generation.status === "GENERATED") {
        this.logger.info("✓ Policy generation complete");
        if (fetchAssets) {
          // The assets are eventually consistent with the generation's status.
          await sleep(2_000);
          this.logger.info("Fetching generated policy assets...");
          const assets = await this.listPolicyGenerationAssets({
            policyEngineId,
            policyGenerationId,
          });
          generation.generatedPolicies = assets.policyGenerationAssets ?? [];
          this.logger.info(`✓ Fetched ${generation.generatedPolicies.length} generated policies`);
        }
        return generation;
      }

      if (generation.status === "GENERATING") {
        this.logger.info(`Generation in progress (attempt ${attempt + 1}/${maxAttempts})...`);
        await sleep(delayMs);
        continue;
      }

      const reasons = generation.statusReasons ?? [];
      const reasonText = reasons.length > 0 ? reasons.join(", ") : "Unknown reason";
      throw new PolicySetupError(
        `Policy generation failed with status: ${generation.status}. Reason: ${reasonText}`,
      );
    }

    throw new Error(
      `Policy generation did not complete after ${maxAttempts} attempts ` +
        `(${(maxAttempts * delayMs) / 1000} seconds)`,
    );
  }

  // ==================== Helper Methods ====================

  /**
   * Deletes every policy in an engine, then the engine itself.
   *
   * Python: `cleanup_policy_engine(policy_engine_id)`.
   */
  async cleanupPolicyEngine(policyEngineId: string): Promise<void> {
    this.logger.info("🧹 Cleaning up Policy Engine:", policyEngineId);

    let policies: Policy[] = [];
    try {
      policies = await collectPages<Policy>(async (nextToken) => {
        const page = await this.listPolicies({
          policyEngineId,
          maxResults: LIST_PAGE_SIZE,
          nextToken,
        });
        return { items: page.policies ?? [], nextToken: page.nextToken };
      });
      this.logger.info(`Found ${policies.length} policies to delete`);
    } catch (error) {
      this.logger.warning("⚠️  Could not list policies:", error);
    }

    for (const policy of policies) {
      const policyName = policy.name ?? policy.policyId;
      try {
        this.logger.info("  • Deleting policy:", policyName);
        await this.deletePolicy(policyEngineId, policy.policyId as string);
        this.logger.info("    ✓ Policy deletion initiated:", policyName);
        await this.waitForPolicyDeleted(policyEngineId, policy.policyId as string);
        this.logger.info("    ✓ Policy deleted");
      } catch (error) {
        this.logger.warning(`    ⚠️ Error deleting policy ${policyName}: ${error}`);
      }
    }

    try {
      this.logger.info("  • Deleting policy engine:", policyEngineId);
      await this.deletePolicyEngine(policyEngineId);
      this.logger.info("    ✓ Policy engine deleted");
    } catch (error) {
      this.logger.warning("    ⚠️ Error deleting policy engine:", error);
    }

    this.logger.info("✅ Policy Engine cleanup complete");
  }

  /** Python: `_wait_for_policy_engine_active`. */
  private async waitForPolicyEngineActive(
    policyEngineId: string,
    maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
    delayMs: number = DEFAULT_POLL_DELAY_MS,
  ): Promise<GetPolicyEngineResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const engine = await this.getPolicyEngine(policyEngineId);
      if (engine.status === "ACTIVE") return engine;
      if (engine.status !== "CREATING") {
        throw new PolicySetupError(`Policy engine entered unexpected status: ${engine.status}`);
      }
      await sleep(delayMs);
    }
    throw new Error(`Policy engine did not become active after ${maxAttempts} attempts`);
  }

  /** Python: `_wait_for_policy_active`. */
  private async waitForPolicyActive(
    policyEngineId: string,
    policyId: string,
    maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
    delayMs: number = DEFAULT_POLL_DELAY_MS,
  ): Promise<GetPolicyResponse> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const policy = await this.getPolicy(policyEngineId, policyId);
      if (policy.status === "ACTIVE") return policy;
      if (policy.status !== "CREATING") {
        throw new PolicySetupError(`Policy entered unexpected status: ${policy.status}`);
      }
      await sleep(delayMs);
    }
    throw new Error(`Policy did not become active after ${maxAttempts} attempts`);
  }

  /** Python: `_wait_for_policy_deleted`. */
  private async waitForPolicyDeleted(
    policyEngineId: string,
    policyId: string,
    maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
    delayMs: number = DEFAULT_POLL_DELAY_MS,
  ): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const policy = await this.getPolicy(policyEngineId, policyId);
        if (policy.status !== "DELETING") {
          throw new PolicySetupError(
            `Policy in unexpected status during deletion: ${policy.status}`,
          );
        }
        await sleep(delayMs);
      } catch (error) {
        if (error instanceof PolicyNotFoundError) return;
        throw error;
      }
    }
    throw new Error(`Policy was not deleted after ${maxAttempts} attempts`);
  }
}
