/**
 * `Runtime` — the course's replacement for the Python starter toolkit's `Runtime` class
 * (`bedrock_agentcore_starter_toolkit.Runtime`), which has no TypeScript equivalent.
 *
 * Same shape as the Python class, so a notebook cell translates line for line:
 *
 * ```ts
 * const runtime = new Runtime();
 * await runtime.configure({ entrypoint: "travel_agent.ts", agentName, requirementsFile: "deno.json", region,
 *                           autoCreateExecutionRole: true, autoCreateEcr: true });
 * const launch = await runtime.launch();
 * await runtime.status();
 * await runtime.invoke({ prompt: "Plan me a trip" });
 * ```
 *
 * `launch()` builds the container **remotely in CodeBuild**, exactly as the Python toolkit does, so a
 * learner never needs Docker locally. The pipeline is: ensure the ECR repo and the two IAM roles ->
 * zip the agent folder (with a generated Deno Dockerfile and a copy of `shared/observability.ts`) ->
 * upload to S3 -> run an arm64 CodeBuild project -> Create/UpdateAgentRuntime -> poll until READY.
 *
 * Differences from the Python original are listed at the bottom of this file.
 */
import {
  BatchGetBuildsCommand,
  CodeBuildClient,
  CreateProjectCommand,
  StartBuildCommand,
  UpdateProjectCommand,
} from "@aws-sdk/client-codebuild";
import {
  CreateRepositoryCommand,
  DescribeRepositoriesCommand,
  ECRClient,
} from "@aws-sdk/client-ecr";
import {
  CreateRoleCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  BedrockAgentCoreControlClient,
  CreateAgentRuntimeCommand,
  GetAgentRuntimeCommand,
  GetAgentRuntimeEndpointCommand,
  ListAgentRuntimesCommand,
  UpdateAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import { dirname, fromFileUrl, join, resolve } from "@std/path";
import JSZip from "jszip";
import { Logger } from "./logger.ts";

/** Where `configure()` persists its state, mirroring Python's `.bedrock_agentcore.yaml`. */
export const CONFIG_FILE = ".bedrock_agentcore.json";
const DEFAULT_REGION = "us-west-2";
const OBSERVABILITY_MODULE = "observability.ts";

export interface ConfigureOptions {
  /** Agent entry file, relative to `sourceDir` (Python: `entrypoint`, e.g. "travel_agent.ts"). */
  entrypoint: string;
  agentName?: string;
  /** The agent folder's own `deno.json` (Python: `requirements_file`, its requirements.txt). */
  requirementsFile?: string;
  region?: string;
  executionRole?: string;
  autoCreateExecutionRole?: boolean;
  /** Kept for a line-for-line diff with Python; an ECR repo is always ensured for container deploys. */
  autoCreateEcr?: boolean;
  ecrRepository?: string;
  environmentVariables?: Record<string, string>;
  /** JWT inbound auth, passed straight through to CreateAgentRuntime. */
  authorizerConfiguration?: Record<string, unknown>;
  protocol?: "HTTP" | "MCP" | "A2A" | "AGUI";
  idleTimeout?: number;
  maxLifetime?: number;
  /** Directory holding the entrypoint; defaults to the entrypoint's own directory. */
  sourceDir?: string;
}

export interface ConfigureResult {
  configPath: string;
  agentName: string;
  entrypoint: string;
  region: string;
  sourceDir: string;
}

export interface LaunchOptions {
  /** Python's `launch(auto_update_on_conflict=True)`: update an agent runtime that already exists. */
  autoUpdateOnConflict?: boolean;
  buildTimeoutMs?: number;
}

export interface LaunchResult {
  agentId: string;
  agentArn: string;
  ecrUri: string;
  imageTag: string;
  buildId: string;
  executionRoleArn: string;
}

export interface StatusResult {
  config: StoredConfig;
  agent: Record<string, unknown> | { error: string } | null;
  endpoint: Record<string, unknown> | { error: string } | null;
}

export interface InvokeOptions {
  sessionId?: string;
  bearerToken?: string;
  qualifier?: string;
}

export interface StoredConfig {
  agentName: string;
  entrypoint: string;
  sourceDir: string;
  region: string;
  requirementsFile?: string;
  executionRole?: string;
  autoCreateExecutionRole?: boolean;
  ecrRepository?: string;
  environmentVariables?: Record<string, string>;
  authorizerConfiguration?: Record<string, unknown>;
  protocol?: string;
  idleTimeout?: number;
  maxLifetime?: number;
  agentId?: string;
  agentArn?: string;
  agentSessionId?: string;
  imageTag?: string;
}

// --- pure helpers (unit-tested; the Python equivalents live in services/ecr.py and create_role.py) ---

/** Python `sanitize_ecr_repo_name`: ECR names are lowercase, and start with a letter or digit. */
export function sanitizeEcrRepoName(name: string): string {
  let out = name.toLowerCase().replace(/[^a-z0-9_\-/]/g, "-");
  if (out && !/[a-z0-9]/.test(out[0])) out = `a${out}`;
  out = out.replace(/[-_]{2,}/g, "-").replace(/[-_]+$/, "");
  if (out.length < 2) out = `${out}-agent`;
  if (out.length > 200) out = out.slice(0, 200).replace(/[-_]+$/, "");
  return out;
}

/** Python `generate_image_tag`: a UTC timestamp, `YYYYMMDD-HHMMSS-mmm`. */
export function generateImageTag(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-` +
    `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}-${
      p(now.getUTCMilliseconds(), 3)
    }`;
}

/** Python `_generate_deterministic_suffix`: the first 10 hex characters of sha256(agentName). */
export async function deterministicSuffix(agentName: string, length = 10): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(agentName));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
    .slice(0, length);
}

export function partitionForRegion(region: string): string {
  if (region.startsWith("cn-")) return "aws-cn";
  if (region.startsWith("us-gov-")) return "aws-us-gov";
  if (region.startsWith("us-iso-b")) return "aws-iso-b";
  if (region.startsWith("us-iso-")) return "aws-iso";
  return "aws";
}

export function executionRoleTrustPolicy(
  accountId: string,
  region: string,
): Record<string, unknown> {
  const partition = partitionForRegion(region);
  return {
    Version: "2012-10-17",
    Statement: [{
      Sid: "AssumeRolePolicy",
      Effect: "Allow",
      Principal: { Service: "bedrock-agentcore.amazonaws.com" },
      Action: "sts:AssumeRole",
      Condition: {
        StringEquals: { "aws:SourceAccount": accountId },
        ArnLike: { "aws:SourceArn": `arn:${partition}:bedrock-agentcore:${region}:${accountId}:*` },
      },
    }],
  };
}

/** Ported from `execution_role_policy.json.j2` (container branch, memory enabled). */
export function executionRolePolicy(
  accountId: string,
  region: string,
  agentName: string,
  ecrRepositoryName: string,
): Record<string, unknown> {
  const p = partitionForRegion(region);
  const logGroups = `arn:${p}:logs:${region}:${accountId}:log-group`;
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ECRImageAccess",
        Effect: "Allow",
        Action: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
        Resource: [`arn:${p}:ecr:${region}:${accountId}:repository/${ecrRepositoryName}`],
      },
      {
        Effect: "Allow",
        Action: ["logs:DescribeLogStreams", "logs:CreateLogGroup"],
        Resource: [`${logGroups}:/aws/bedrock-agentcore/runtimes/*`],
      },
      { Effect: "Allow", Action: ["logs:DescribeLogGroups"], Resource: [`${logGroups}:*`] },
      {
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: [`${logGroups}:/aws/bedrock-agentcore/runtimes/*:log-stream:*`],
      },
      {
        Sid: "ECRTokenAccess",
        Effect: "Allow",
        Action: ["ecr:GetAuthorizationToken"],
        Resource: "*",
      },
      {
        Effect: "Allow",
        Action: [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
          "xray:PutSpans",
          "xray:PutSpansForIndexing",
        ],
        Resource: ["*"],
      },
      {
        Effect: "Allow",
        Resource: "*",
        Action: "cloudwatch:PutMetricData",
        Condition: { StringEquals: { "cloudwatch:namespace": "bedrock-agentcore" } },
      },
      {
        Sid: "CloudWatchLogsPutResourcePolicy",
        Effect: "Allow",
        Action: ["logs:PutResourcePolicy"],
        Resource: [`${logGroups}:/aws/bedrock-agentcore/runtimes/${agentName}-*`],
      },
      {
        Sid: "BedrockAgentCoreMemoryAndTools",
        Effect: "Allow",
        Action: [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:GetEvent",
          "bedrock-agentcore:GetMemory",
          "bedrock-agentcore:GetMemoryRecord",
          "bedrock-agentcore:ListActors",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:ListMemoryRecords",
          "bedrock-agentcore:ListSessions",
          "bedrock-agentcore:DeleteEvent",
          "bedrock-agentcore:DeleteMemoryRecord",
          "bedrock-agentcore:RetrieveMemoryRecords",
          "bedrock-agentcore:StartCodeInterpreterSession",
          "bedrock-agentcore:InvokeCodeInterpreter",
          "bedrock-agentcore:StopCodeInterpreterSession",
          "bedrock-agentcore:GetCodeInterpreterSession",
          "bedrock-agentcore:StartBrowserSession",
          "bedrock-agentcore:StopBrowserSession",
          "bedrock-agentcore:GetBrowserSession",
          "bedrock-agentcore:ConnectBrowserAutomationStream",
          "bedrock-agentcore:UpdateBrowserStream",
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
          "bedrock-agentcore:GetWorkloadAccessTokenForUserId",
          "bedrock-agentcore:GetResourceOauth2Token",
          "bedrock-agentcore:GetResourceApiKey",
          // The unified agent of notebook 08 reads the ExchangeRate key back out of its credential
          // provider, which needs the two provider lookups as well as GetResourceApiKey.
          "bedrock-agentcore:ListApiKeyCredentialProviders",
          "bedrock-agentcore:GetApiKeyCredentialProvider",
        ],
        Resource: ["*"],
      },
      {
        // ...and then the secret itself. AgentCore Identity keeps every credential provider's
        // value in Secrets Manager under `bedrock-agentcore-identity!default/`, so the role is
        // scoped to that prefix rather than to all secrets. Notebook 08's Python original asks the
        // learner to add this statement to the role by hand.
        Sid: "BedrockAgentCoreIdentityGetCredentialProviderSecret",
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: [
          `arn:${p}:secretsmanager:${region}:${accountId}:secret:bedrock-agentcore-identity!default/apikey/*`,
          `arn:${p}:secretsmanager:${region}:${accountId}:secret:bedrock-agentcore-identity!default/oauth2/*`,
        ],
      },
      {
        Sid: "BedrockModelInvocation",
        Effect: "Allow",
        Action: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:Converse",
          "bedrock:ConverseStream",
        ],
        Resource: ["*"],
      },
    ],
  };
}

export function codeBuildTrustPolicy(): Record<string, unknown> {
  return {
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "codebuild.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  };
}

export function codeBuildRolePolicy(
  accountId: string,
  region: string,
  ecrRepositoryArn: string,
  sourceBucketName: string,
): Record<string, unknown> {
  const p = partitionForRegion(region);
  return {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["ecr:GetAuthorizationToken"], Resource: "*" },
      {
        Effect: "Allow",
        Action: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
        ],
        Resource: ecrRepositoryArn,
      },
      {
        Effect: "Allow",
        Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        Resource:
          `arn:${p}:logs:${region}:${accountId}:log-group:/aws/codebuild/bedrock-agentcore-*`,
      },
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
        Resource: [`arn:${p}:s3:::${sourceBucketName}`, `arn:${p}:s3:::${sourceBucketName}/*`],
        Condition: { StringEquals: { "s3:ResourceAccount": accountId } },
      },
    ],
  };
}

/** The arm64 buildspec, ported from `CodeBuildService._get_arm64_buildspec`. */
export function arm64Buildspec(ecrRepositoryUri: string, imageTag: string): string {
  return `version: 0.2
phases:
  build:
    commands:
      - echo "Starting Docker build and ECR authentication..."
      - |
        docker build -t bedrock-agentcore-arm64 . &
        BUILD_PID=$!
        aws ecr get-login-password --region $AWS_DEFAULT_REGION | \\
        docker login --username AWS --password-stdin ${ecrRepositoryUri} &
        AUTH_PID=$!
        wait $BUILD_PID || { echo "Docker build failed"; exit 1; }
        wait $AUTH_PID || { echo "ECR authentication failed"; exit 1; }
      - "docker tag bedrock-agentcore-arm64:latest ${ecrRepositoryUri}:${imageTag}"
  post_build:
    commands:
      - "docker push ${ecrRepositoryUri}:${imageTag}"
      - echo "Build completed at $(date)"
`;
}

/**
 * The Deno image, replacing the Python toolkit's `Dockerfile.j2`.
 *
 * `--preload` loads the shared observability module before the agent, which is how telemetry stays
 * out of agent code (the Python toolkit's equivalent is the `opentelemetry-instrument` prefix).
 *
 * The base image comes from ghcr.io rather than Docker Hub: a live CodeBuild run was refused with
 * "429 Too Many Requests" pulling `denoland/deno` from Docker Hub, whose anonymous pulls are rate
 * limited per source IP, and CodeBuild's IPs are shared.
 */
export const DENO_IMAGE_REGISTRY = "ghcr.io/denoland/deno";

export function buildDockerfile(entrypoint: string, denoVersion: string): string {
  return `FROM ${DENO_IMAGE_REGISTRY}:${denoVersion}
WORKDIR /app
COPY deno.json* deno.lock* ./
COPY . .
RUN deno install --entrypoint ${entrypoint} ${OBSERVABILITY_MODULE} && deno cache ${entrypoint} ${OBSERVABILITY_MODULE}
USER 1993
EXPOSE 8080
CMD ["run", "-A", "--preload", "${OBSERVABILITY_MODULE}", "${entrypoint}"]
`;
}

/** Files a source zip never carries, ported from `dockerignore.template`. */
export const IGNORED_SOURCE_ENTRIES = [
  ".git",
  "node_modules",
  "__pycache__",
  ".DS_Store",
  ".venv",
  "venv",
  ".env",
  CONFIG_FILE,
];

export function shouldIgnoreSourceEntry(name: string): boolean {
  return IGNORED_SOURCE_ENTRIES.includes(name) || name.endsWith(".pyc");
}

/**
 * Retries an AWS call that fails only because a just-created IAM role has not propagated yet.
 *
 * Ported from the Python toolkit's `retry_create_with_eventual_iam_consistency`, widened to cover
 * CodeBuild's own wording ("not authorized to perform: sts:AssumeRole"), which a live run hit when
 * creating the build project immediately after the role.
 */
export function isRoleNotReadyError(error: unknown): boolean {
  const name = (error as Error)?.name ?? "";
  const message = (error as Error)?.message ?? "";
  return (
    (name === "ValidationException" && message.includes("Role validation failed")) ||
    (name === "InvalidParameterValueException" && message.includes("cannot be assumed")) ||
    (name === "InvalidInputException" && message.includes("sts:AssumeRole"))
  );
}

async function withIamConsistencyRetry<T>(
  operation: () => Promise<T>,
  logger: Logger,
  maxRetries = 5,
): Promise<T> {
  for (let attempt = 0;; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!isRoleNotReadyError(error) || attempt === maxRetries) throw error;
      const wait = Math.min(5000 * 2 ** attempt, 15000);
      logger.info(
        `IAM role not ready to be assumed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${
          wait / 1000
        }s...`,
      );
      await delay(wait);
    }
  }
}

// --- the class ---

export class Runtime {
  readonly logger = new Logger("bedrock_agentcore.runtime");
  private config: StoredConfig | null = null;
  private configPath = resolve(CONFIG_FILE);

  /** Python exposes `runtime.name` after `configure()`. */
  get name(): string | undefined {
    return this.config?.agentName;
  }

  private clients(region: string) {
    return {
      sts: new STSClient({ region }),
      iam: new IAMClient({ region }),
      ecr: new ECRClient({ region }),
      s3: new S3Client({ region }),
      codebuild: new CodeBuildClient({ region }),
      control: new BedrockAgentCoreControlClient({ region }),
    };
  }

  async configure(options: ConfigureOptions): Promise<ConfigureResult> {
    const entrypoint = options.entrypoint;
    const sourceDir = resolve(options.sourceDir ?? dirname(entrypoint));
    const agentName = options.agentName ?? entrypoint.split("/").pop()!.replace(/\.[tj]s$/, "");
    const region = options.region ?? Deno.env.get("AWS_REGION") ?? DEFAULT_REGION;
    if (!options.executionRole && !options.autoCreateExecutionRole) {
      throw new Error(
        "Pass executionRole, or autoCreateExecutionRole: true, as in the Python toolkit.",
      );
    }

    this.config = {
      agentName,
      entrypoint: entrypoint.split("/").pop()!,
      sourceDir,
      region,
      requirementsFile: options.requirementsFile,
      executionRole: options.executionRole,
      autoCreateExecutionRole: options.autoCreateExecutionRole,
      ecrRepository: options.ecrRepository,
      environmentVariables: options.environmentVariables,
      authorizerConfiguration: options.authorizerConfiguration,
      protocol: options.protocol,
      idleTimeout: options.idleTimeout,
      maxLifetime: options.maxLifetime,
      ...(await this.readConfig(agentName)),
    };
    await this.writeConfig();
    this.logger.info(`Configured agent '${agentName}' (${entrypoint}) in ${region}`);
    return { configPath: this.configPath, agentName, entrypoint, region, sourceDir };
  }

  /** Reloads a previous `configure()` for this agent, so a restarted kernel can still launch/invoke. */
  private async readConfig(agentName: string): Promise<Partial<StoredConfig>> {
    try {
      const all = JSON.parse(await Deno.readTextFile(this.configPath)) as Record<
        string,
        StoredConfig
      >;
      const prior = all[agentName];
      return prior
        ? { agentId: prior.agentId, agentArn: prior.agentArn, agentSessionId: prior.agentSessionId }
        : {};
    } catch {
      return {};
    }
  }

  private async writeConfig(): Promise<void> {
    if (!this.config) return;
    let all: Record<string, StoredConfig> = {};
    try {
      all = JSON.parse(await Deno.readTextFile(this.configPath)) as Record<string, StoredConfig>;
    } catch {
      // first write
    }
    all[this.config.agentName] = this.config;
    await Deno.writeTextFile(this.configPath, `${JSON.stringify(all, null, 2)}\n`);
  }

  private requireConfig(): StoredConfig {
    if (!this.config) throw new Error("Call configure() before this, as in the Python toolkit.");
    return this.config;
  }

  async launch(options: LaunchOptions = {}): Promise<LaunchResult> {
    const cfg = this.requireConfig();
    const { autoUpdateOnConflict = true, buildTimeoutMs = 900_000 } = options;
    const { region, agentName } = cfg;
    const c = this.clients(region);
    const accountId = (await c.sts.send(new GetCallerIdentityCommand({}))).Account!;
    const partition = partitionForRegion(region);

    const repoName = `bedrock-agentcore-${sanitizeEcrRepoName(agentName)}`;
    const ecrUri = cfg.ecrRepository ?? await this.ensureEcrRepository(c.ecr, repoName);
    this.logger.info(`ECR repository: ${ecrUri}`);

    const executionRoleArn = cfg.executionRole ??
      await this.ensureRole(
        c.iam,
        `AmazonBedrockAgentCoreSDKRuntime-${region}-${await deterministicSuffix(agentName)}`,
        executionRoleTrustPolicy(accountId, region),
        "BedrockAgentCoreRuntimeExecutionPolicy",
        executionRolePolicy(accountId, region, agentName, repoName),
      );
    this.logger.info(`Execution role: ${executionRoleArn}`);

    const bucket = `bedrock-agentcore-codebuild-sources-${accountId}-${region}`;
    await this.ensureSourceBucket(c.s3, bucket, region, accountId);
    const codeBuildRoleArn = await this.ensureRole(
      c.iam,
      `AmazonBedrockAgentCoreSDKCodeBuild-${region}-${await deterministicSuffix(agentName)}`,
      codeBuildTrustPolicy(),
      "CodeBuildExecutionPolicy",
      codeBuildRolePolicy(
        accountId,
        region,
        `arn:${partition}:ecr:${region}:${accountId}:repository/${repoName}`,
        bucket,
      ),
    );

    const imageTag = generateImageTag();
    const zip = await this.buildSourceZip(cfg);
    const key = `${agentName}/source.zip`;
    await c.s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: zip, ExpectedBucketOwner: accountId }),
    );
    this.logger.info(`Uploaded source to s3://${bucket}/${key}`);

    const projectName = `bedrock-agentcore-${sanitizeEcrRepoName(agentName)}-builder`;
    await this.ensureProject(
      c.codebuild,
      projectName,
      ecrUri,
      imageTag,
      codeBuildRoleArn,
      `${bucket}/${key}`,
    );
    const buildId = await this.runBuild(
      c.codebuild,
      projectName,
      `${bucket}/${key}`,
      buildTimeoutMs,
    );

    const { agentId, agentArn } = await this.createOrUpdateAgentRuntime(
      c.control,
      cfg,
      `${ecrUri}:${imageTag}`,
      executionRoleArn,
      autoUpdateOnConflict,
    );

    this.config = {
      ...cfg,
      agentId,
      agentArn,
      imageTag,
      executionRole: executionRoleArn,
      ecrRepository: ecrUri,
    };
    await this.writeConfig();
    return { agentId, agentArn, ecrUri, imageTag, buildId, executionRoleArn };
  }

  private async ensureEcrRepository(ecr: ECRClient, repoName: string): Promise<string> {
    try {
      const created = await ecr.send(new CreateRepositoryCommand({ repositoryName: repoName }));
      return created.repository!.repositoryUri!;
    } catch (error) {
      if ((error as Error).name !== "RepositoryAlreadyExistsException") throw error;
      const existing = await ecr.send(
        new DescribeRepositoriesCommand({ repositoryNames: [repoName] }),
      );
      return existing.repositories![0].repositoryUri!;
    }
  }

  private async ensureRole(
    iam: IAMClient,
    roleName: string,
    trustPolicy: Record<string, unknown>,
    policyName: string,
    policyDocument: Record<string, unknown>,
  ): Promise<string> {
    let arn: string;
    try {
      arn = (await iam.send(new GetRoleCommand({ RoleName: roleName }))).Role!.Arn!;
      this.logger.debug(`Reusing role ${roleName}`);
    } catch (error) {
      if (
        (error as Error).name !== "NoSuchEntity" &&
        (error as Error).name !== "NoSuchEntityException"
      ) throw error;
      arn = (await iam.send(
        new CreateRoleCommand({
          RoleName: roleName,
          AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
          Description: "Created by the AgentCore course toolkit",
        }),
      )).Role!.Arn!;
      this.logger.info(`Created role ${roleName}`);
    }
    await iam.send(
      new PutRolePolicyCommand({
        RoleName: roleName,
        PolicyName: policyName,
        PolicyDocument: JSON.stringify(policyDocument),
      }),
    );
    return arn;
  }

  private async ensureSourceBucket(
    s3: S3Client,
    bucket: string,
    region: string,
    accountId: string,
  ): Promise<void> {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket, ExpectedBucketOwner: accountId }));
      return;
    } catch (error) {
      const name = (error as Error).name;
      if (name === "403" || name === "Forbidden") {
        throw new Error(`Cannot access S3 bucket '${bucket}': it may belong to another account.`);
      }
    }
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ...(region === "us-east-1"
          ? {}
          : { CreateBucketConfiguration: { LocationConstraint: region as never } }),
      }),
    );
    await s3.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        ExpectedBucketOwner: accountId,
        LifecycleConfiguration: {
          Rules: [{
            ID: "DeleteOldBuilds",
            Status: "Enabled",
            Filter: {},
            Expiration: { Days: 7 },
          }],
        },
      }),
    );
    this.logger.info(`Created S3 bucket ${bucket}`);
  }

  /** Zips the agent folder, adding the generated Dockerfile and a copy of the observability module. */
  private async buildSourceZip(cfg: StoredConfig): Promise<Uint8Array> {
    const zip = new JSZip();
    for await (const entry of Deno.readDir(cfg.sourceDir)) {
      if (shouldIgnoreSourceEntry(entry.name) || !entry.isFile) continue;
      zip.file(entry.name, await Deno.readFile(join(cfg.sourceDir, entry.name)));
    }
    const denoVersion = (await Deno.readTextFile(join(repoRoot(), ".deno-version"))).trim();
    zip.file("Dockerfile", buildDockerfile(cfg.entrypoint, denoVersion));
    zip.file(
      OBSERVABILITY_MODULE,
      await Deno.readTextFile(join(repoRoot(), "capstone_project", "shared", OBSERVABILITY_MODULE)),
    );
    if (cfg.requirementsFile) {
      const path = join(cfg.sourceDir, cfg.requirementsFile);
      zip.file(cfg.requirementsFile, await Deno.readTextFile(path));
    }
    return await zip.generateAsync({ type: "uint8array" });
  }

  private async ensureProject(
    codebuild: CodeBuildClient,
    projectName: string,
    ecrUri: string,
    imageTag: string,
    serviceRole: string,
    sourceLocation: string,
  ): Promise<void> {
    const project = {
      name: projectName,
      source: {
        type: "S3" as const,
        location: sourceLocation,
        buildspec: arm64Buildspec(ecrUri, imageTag),
      },
      artifacts: { type: "NO_ARTIFACTS" as const },
      environment: {
        type: "ARM_CONTAINER" as const,
        image: "aws/codebuild/amazonlinux2-aarch64-standard:3.0",
        computeType: "BUILD_GENERAL1_MEDIUM" as const,
        privilegedMode: true,
      },
      serviceRole,
    };
    // A role created moments ago may not be assumable yet, so both paths retry.
    await withIamConsistencyRetry(async () => {
      try {
        await codebuild.send(new CreateProjectCommand(project));
        this.logger.info(`Created CodeBuild project ${projectName}`);
      } catch (error) {
        if ((error as Error).name !== "ResourceAlreadyExistsException") throw error;
        await codebuild.send(new UpdateProjectCommand(project));
        this.logger.info(`Updated CodeBuild project ${projectName}`);
      }
    }, this.logger);
  }

  private async runBuild(
    codebuild: CodeBuildClient,
    projectName: string,
    sourceLocation: string,
    timeoutMs: number,
  ): Promise<string> {
    const started = await codebuild.send(
      new StartBuildCommand({ projectName, sourceLocationOverride: sourceLocation }),
    );
    const buildId = started.build!.id!;
    this.logger.info("Waiting for the CodeBuild image build...");
    const deadline = Date.now() + timeoutMs;
    let phase: string | undefined;
    while (Date.now() < deadline) {
      const build =
        (await codebuild.send(new BatchGetBuildsCommand({ ids: [buildId] }))).builds![0];
      if (build.currentPhase !== phase) {
        phase = build.currentPhase;
        this.logger.info(`CodeBuild phase: ${phase}`);
      }
      if (build.buildStatus === "SUCCEEDED") {
        this.logger.info("CodeBuild finished");
        return buildId;
      }
      if (["FAILED", "FAULT", "STOPPED", "TIMED_OUT"].includes(build.buildStatus ?? "")) {
        throw new Error(`CodeBuild failed with status ${build.buildStatus} during ${phase}`);
      }
      await delay(2000);
    }
    throw new Error(`CodeBuild timed out after ${Math.round(timeoutMs / 1000)}s (phase ${phase})`);
  }

  private async createOrUpdateAgentRuntime(
    control: BedrockAgentCoreControlClient,
    cfg: StoredConfig,
    containerUri: string,
    roleArn: string,
    autoUpdateOnConflict: boolean,
  ): Promise<{ agentId: string; agentArn: string }> {
    const shared = {
      agentRuntimeArtifact: { containerConfiguration: { containerUri } },
      roleArn,
      networkConfiguration: { networkMode: "PUBLIC" as const },
      // Required since 2026-06-30; invocations fail without it.
      metadataConfiguration: { requireMMDSV2: true },
      ...(cfg.environmentVariables ? { environmentVariables: cfg.environmentVariables } : {}),
      ...(cfg.protocol ? { protocolConfiguration: { serverProtocol: cfg.protocol as never } } : {}),
      ...(cfg.authorizerConfiguration
        ? { authorizerConfiguration: cfg.authorizerConfiguration as never }
        : {}),
      ...(cfg.idleTimeout || cfg.maxLifetime
        ? {
          lifecycleConfiguration: {
            ...(cfg.idleTimeout ? { idleRuntimeSessionTimeout: cfg.idleTimeout } : {}),
            ...(cfg.maxLifetime ? { maxLifetime: cfg.maxLifetime } : {}),
          },
        }
        : {}),
    };

    const existingId = cfg.agentId ?? await this.findAgentRuntimeId(control, cfg.agentName);
    if (existingId && autoUpdateOnConflict) {
      const updated = await control.send(
        new UpdateAgentRuntimeCommand({ agentRuntimeId: existingId, ...shared }),
      );
      this.logger.info(
        `Updated agent runtime ${existingId} (version ${updated.agentRuntimeVersion})`,
      );
      await this.waitUntilReady(control, existingId);
      return { agentId: existingId, agentArn: updated.agentRuntimeArn! };
    }

    const created = await control.send(
      new CreateAgentRuntimeCommand({ agentRuntimeName: cfg.agentName, ...shared }),
    );
    this.logger.info(`Created agent runtime ${created.agentRuntimeId}`);
    await this.waitUntilReady(control, created.agentRuntimeId!);
    return { agentId: created.agentRuntimeId!, agentArn: created.agentRuntimeArn! };
  }

  private async findAgentRuntimeId(
    control: BedrockAgentCoreControlClient,
    agentName: string,
  ): Promise<string | undefined> {
    let nextToken: string | undefined;
    do {
      const page = await control.send(new ListAgentRuntimesCommand({ nextToken }));
      const found = page.agentRuntimes?.find((r) => r.agentRuntimeName === agentName);
      if (found) return found.agentRuntimeId;
      nextToken = page.nextToken;
    } while (nextToken);
    return undefined;
  }

  private async waitUntilReady(
    control: BedrockAgentCoreControlClient,
    agentRuntimeId: string,
    maxWaitMs = 300_000,
  ): Promise<void> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const got = await control.send(new GetAgentRuntimeCommand({ agentRuntimeId }));
      if (got.status === "READY") return;
      if (got.status && !["CREATING", "UPDATING"].includes(got.status)) {
        throw new Error(
          `Agent runtime ${agentRuntimeId} is ${got.status}: ${
            got.failureReason ?? "no reason given"
          }`,
        );
      }
      await delay(5000);
    }
    throw new Error(
      `Agent runtime ${agentRuntimeId} was not READY within ${Math.round(maxWaitMs / 1000)}s`,
    );
  }

  async status(): Promise<StatusResult> {
    const cfg = this.requireConfig();
    if (!cfg.agentId) return { config: cfg, agent: null, endpoint: null };
    const control = new BedrockAgentCoreControlClient({ region: cfg.region });
    let agent: StatusResult["agent"];
    let endpoint: StatusResult["endpoint"];
    try {
      const got = await control.send(new GetAgentRuntimeCommand({ agentRuntimeId: cfg.agentId }));
      agent = { ...got, $metadata: undefined } as Record<string, unknown>;
    } catch (error) {
      agent = { error: String(error) };
    }
    try {
      const got = await control.send(
        new GetAgentRuntimeEndpointCommand({
          agentRuntimeId: cfg.agentId,
          endpointName: "DEFAULT",
        }),
      );
      endpoint = { ...got, $metadata: undefined } as Record<string, unknown>;
    } catch (error) {
      endpoint = { error: String(error) };
    }
    return { config: cfg, agent, endpoint };
  }

  /**
   * Python: `runtime.invoke(payload, session_id=..., bearer_token=...)`.
   * The session id is remembered between calls, as it is in the Python toolkit.
   */
  async invoke(payload: unknown, options: InvokeOptions = {}): Promise<unknown> {
    const cfg = this.requireConfig();
    if (!cfg.agentArn) throw new Error("Call launch() before invoke().");
    const sessionId = options.sessionId ?? cfg.agentSessionId ?? generateSessionId();
    if (sessionId !== cfg.agentSessionId) {
      this.config = { ...cfg, agentSessionId: sessionId };
      await this.writeConfig();
    }

    const client = new BedrockAgentCoreClient({ region: cfg.region });
    const response = await client.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: cfg.agentArn,
        runtimeSessionId: sessionId,
        qualifier: options.qualifier,
        contentType: "application/json",
        accept: "application/json",
        payload: new TextEncoder().encode(
          typeof payload === "string" ? payload : JSON.stringify(payload),
        ),
        ...(options.bearerToken ? { bearerToken: options.bearerToken } as never : {}),
      }),
    );
    const text = await response.response!.transformToString();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

/** Python `generate_session_id`: AgentCore requires at least 33 characters. */
export function generateSessionId(): string {
  return `session-${crypto.randomUUID()}-${crypto.randomUUID().slice(0, 8)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function repoRoot(): string {
  // capstone_project/toolkit/runtime.ts -> repo root
  return resolve(dirname(fromFileUrl(import.meta.url)), "..", "..");
}

/*
 * Differences from the Python `Runtime`, per the map's fix-and-log rule:
 *
 * 1. Config file is `.bedrock_agentcore.json` rather than `.bedrock_agentcore.yaml`, keyed by agent
 *    name. No YAML dependency, and the notebook helper already writes JSON state.
 * 2. Deployment is always a container. Python also offers `direct_code_deploy`, which AgentCore
 *    supports only for Python and Node runtimes, never Deno (see the deploy research).
 * 3. The image is generated from `buildDockerfile()` (Deno base image, `--preload` of the shared
 *    observability module) instead of the toolkit's Jinja `Dockerfile.j2`.
 * 4. The execution-role policy adds `xray:PutSpans`/`PutSpansForIndexing`, needed by the SigV4 OTLP
 *    exporter, plus the code-interpreter, browser and identity actions the course's agents use, and
 *    the credential-provider lookups plus `secretsmanager:GetSecretValue` that notebook 08 tells the
 *    learner to add by hand. The Python template gates those behind flags the course never sets.
 * 5. `.dockerignore` filtering is a small fixed list rather than the toolkit's pattern engine; the
 *    agent folders are flat and hold only an entrypoint, a config and helper files.
 * 6. Local container runtimes are not supported: `container_runtime` and the local `docker build`
 *    path are dropped, because learners are not required to have Docker.
 * 7. The image base is pulled from ghcr.io, because Docker Hub rate-limited a live CodeBuild run.
 * 8. IAM eventual consistency is handled by `withIamConsistencyRetry`, widened from the Python
 *    helper to cover CodeBuild's "not authorized to perform: sts:AssumeRole", which a live run hit.
 * 9. Not ported (no call site in the course): `destroy`, `stop_session`, VPC configuration, memory
 *    auto-provisioning (`memory_mode`), request-header configuration, and the CLI-only prompts.
 */
