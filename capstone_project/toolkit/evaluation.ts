// Hand-written replacement for the Python starter toolkit's `bedrock_agentcore_starter_toolkit.Evaluation`
// (the `notebook/evaluation/client.py` facade over `operations/evaluation/*`).
//
// The starter toolkit is Python-only, so the course ports the parts notebook 11 uses onto AWS SDK v3:
// `Evaluate` on the data plane, evaluator and online-config CRUD on the control plane, the IAM
// execution role, and the CloudWatch span/log fetch via `ObservabilityClient`. Class name, method
// names (camelCased), the options objects (the Python keyword arguments) and the returned shapes are
// kept so a notebook cell diffs against its Python original as a straight translation.
//
// Deliberate differences from the Python original:
//   - Result fields are camelCase (`evaluatorId`, `tokenUsage`) rather than the Python dataclasses'
//     snake_case; the JSON written by `output` follows the same convention.
//   - `filterRelevantSpans` keeps more than the Python filter does - see the comment on it.
//   - The AWS account ID comes from the agent runtime's ARN rather than from an extra STS call.
//   - `EvaluationResult.error` is read from the API's `errorMessage`; Python reads a key named
//     `error`, which the Evaluate API never returns, so its error field is always empty.
import {
  BedrockAgentCoreClient,
  EvaluateCommand,
  type EvaluateCommandInput,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  BedrockAgentCoreControlClient,
  CreateEvaluatorCommand,
  type CreateEvaluatorCommandInput,
  type CreateEvaluatorCommandOutput,
  CreateOnlineEvaluationConfigCommand,
  type CreateOnlineEvaluationConfigCommandOutput,
  DeleteEvaluatorCommand,
  DeleteOnlineEvaluationConfigCommand,
  GetAgentRuntimeCommand,
  GetEvaluatorCommand,
  type GetEvaluatorCommandOutput,
  GetOnlineEvaluationConfigCommand,
  type GetOnlineEvaluationConfigCommandOutput,
  ListEvaluatorsCommand,
  type ListEvaluatorsCommandOutput,
} from "@aws-sdk/client-bedrock-agentcore-control";
import {
  CreateRoleCommand,
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  EntityAlreadyExistsException,
  GetRoleCommand,
  IAMClient,
  ListRolePoliciesCommand,
  NoSuchEntityException,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";
import { dirname, extname } from "@std/path";

import {
  getAgentRuntimeLogGroup,
  ObservabilityClient,
  type OtelDocument,
  type Span,
  type TraceData,
} from "./observability-client.ts";

/** Read an env var, tolerating a run without `--allow-env` (e.g. a bare `deno test`). */
function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

/** Defaults from the toolkit's `operations/constants.py` and `on_demand_processor.py`. */
export const DEFAULT_LOOKBACK_DAYS = Number(env("AGENTCORE_DEFAULT_LOOKBACK_DAYS") ?? "7");
export const DEFAULT_MAX_EVALUATION_ITEMS = 1000;
export const MAX_EVALUATORS_PER_REQUEST = 20;
export const DEFAULT_RUNTIME_ENDPOINT = env("AGENTCORE_RUNTIME_ENDPOINT") ?? "DEFAULT";
export const DEFAULT_EVALUATORS = ["Builtin.GoalSuccessRate"];

/** `scope.name` values the Evaluate API recognises (Python: `constants.InstrumentationScopes`). */
export const InstrumentationScopes = {
  OTEL_LANGCHAIN: "opentelemetry.instrumentation.langchain",
  OPENINFERENCE_LANGCHAIN: "openinference.instrumentation.langchain",
  STRANDS: "strands.telemetry.tracer",
} as const;

const ALLOWED_SCOPES: readonly string[] = [
  InstrumentationScopes.OTEL_LANGCHAIN,
  InstrumentationScopes.OPENINFERENCE_LANGCHAIN,
  InstrumentationScopes.STRANDS,
];

// ===========================
// Pure span/log selection logic
// ===========================

/** True when the document's instrumentation scope is one the Evaluate API knows. */
export function hasAllowedScope(doc: OtelDocument): boolean {
  const scope = doc.scope;
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) return false;
  const name = (scope as OtelDocument).name;
  return typeof name === "string" && ALLOWED_SCOPES.includes(name);
}

/** True when the document carries any `gen_ai.*` span attribute. */
export function hasGenAiAttributes(doc: OtelDocument): boolean {
  const attributes = doc.attributes;
  if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) {
    return false;
  }
  return Object.keys(attributes).some((key) => key === "gen_ai" || key.startsWith("gen_ai."));
}

/** True when the document is a log record whose body holds conversation input/output. */
export function hasConversationBody(doc: OtelDocument): boolean {
  const body = doc.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  return "input" in (body as OtelDocument) || "output" in (body as OtelDocument);
}

/** True when the document looks like a span rather than a log record. */
export function isSpanDocument(doc: OtelDocument): boolean {
  return "spanId" in doc && "startTimeUnixNano" in doc;
}

/** True when the document looks like a log record rather than a span. */
export function isLogDocument(doc: OtelDocument): boolean {
  return "body" in doc && "timeUnixNano" in doc;
}

/** Raw OTel documents from a session's spans and runtime logs. */
export function extractRawSpans(traceData: TraceData): OtelDocument[] {
  const rawSpans: OtelDocument[] = [];

  // Spans carry the full OTel span document in `rawMessage`...
  for (const span of traceData.spans) {
    if (span.rawMessage) rawSpans.push(span.rawMessage);
  }

  // ...and runtime logs carry the OTel log events.
  for (const log of traceData.runtimeLogs) {
    if (log.rawMessage) rawSpans.push(log.rawMessage);
  }

  return rawSpans;
}

/**
 * Keep only high-signal documents for evaluation.
 *
 * The Python original keeps a span only when its instrumentation scope is one of the known ones,
 * which for Strands means `strands.telemetry.tracer`. Strands TypeScript names its tracer after the
 * service name instead, so this port must not filter on the scope name alone: it also keeps any
 * span carrying `gen_ai.*` attributes, and any log record whose body has `input`/`output`.
 * (`capstone_project/shared/observability.ts` does rename the scope for the same reason, but an
 * agent instrumented some other way - or a recorded session from before that rename - would
 * otherwise be silently filtered down to nothing.) A live on-demand evaluation was proven to work
 * with exactly this input shape; see the spike on branch `research/deno-observability-spike`.
 */
export function filterRelevantSpans(rawSpans: OtelDocument[]): OtelDocument[] {
  return rawSpans.filter((doc) =>
    hasAllowedScope(doc) || hasGenAiAttributes(doc) || hasConversationBody(doc)
  );
}

/** Spans have `startTimeUnixNano`, log records have `timeUnixNano`. */
function getTimestamp(doc: OtelDocument): number {
  const value = doc.startTimeUnixNano || doc.timeUnixNano || 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** Keep the target trace and every trace that started before it, chronologically. */
export function filterTracesUpTo(traceData: TraceData, targetTraceId: string): TraceData {
  // Earliest start time per trace.
  const traceTimes = new Map<string, number>();
  for (const span of traceData.spans) {
    const existing = traceTimes.get(span.traceId);
    if (existing === undefined) {
      traceTimes.set(span.traceId, span.startTimeUnixNano ?? 0);
    } else if (span.startTimeUnixNano) {
      traceTimes.set(span.traceId, Math.min(existing, span.startTimeUnixNano));
    }
  }

  const sortedTraces = [...traceTimes.entries()].sort((a, b) => a[1] - b[1]);

  const includedTraces = new Set<string>();
  for (const [traceId] of sortedTraces) {
    includedTraces.add(traceId);
    if (traceId === targetTraceId) break;
  }

  return {
    sessionId: traceData.sessionId,
    agentId: traceData.agentId,
    spans: traceData.spans.filter((s) => includedTraces.has(s.traceId)),
    runtimeLogs: traceData.runtimeLogs.filter((log) =>
      log.traceId !== undefined && includedTraces.has(log.traceId)
    ),
  };
}

/** The most recent relevant documents across every trace in the session, newest first. */
export function getMostRecentSpans(
  traceData: TraceData,
  maxItems: number = DEFAULT_MAX_EVALUATION_ITEMS,
): OtelDocument[] {
  const rawSpans = extractRawSpans(traceData);
  if (rawSpans.length === 0) return [];

  const relevantSpans = filterRelevantSpans(rawSpans);
  relevantSpans.sort((a, b) => getTimestamp(b) - getTimestamp(a));

  return relevantSpans.slice(0, maxItems);
}

/** Counts reported for a set of documents (Python returns a `(spans, logs, scoped)` tuple). */
export interface SpanTypeCounts {
  spansCount: number;
  logsCount: number;
  /** Spans the Evaluate API will recognise - by scope name or by `gen_ai.*` attributes. */
  scopedSpansCount: number;
}

/** Count spans, log records and recognised spans (Python: `count_span_types`). */
export function countSpanTypes(rawSpans: OtelDocument[]): SpanTypeCounts {
  return {
    spansCount: rawSpans.filter(isSpanDocument).length,
    logsCount: rawSpans.filter(isLogDocument).length,
    // Relaxed the same way `filterRelevantSpans` is, so the count matches what is actually sent.
    scopedSpansCount:
      rawSpans.filter((doc) =>
        isSpanDocument(doc) && (hasAllowedScope(doc) || hasGenAiAttributes(doc))
      )
        .length,
  };
}

/** Which traces/spans the API should score, if not the whole session. */
export interface EvaluationTarget {
  traceIds?: string[];
  spanIds?: string[];
}

export interface DetermineSpansOptions {
  /** `"SESSION"` or `"TRACE"`. */
  evaluatorLevel: string;
  traceData: TraceData;
  traceId?: string;
  maxItems?: number;
}

export interface DetermineSpansResult {
  spans: OtelDocument[];
  evaluationTarget?: EvaluationTarget;
}

/** Pick the documents to send for an evaluator's level (Python: `determine_spans_for_evaluator`). */
export function determineSpansForEvaluator(
  { evaluatorLevel, traceData, traceId, maxItems = DEFAULT_MAX_EVALUATION_ITEMS }:
    DetermineSpansOptions,
): DetermineSpansResult {
  if (evaluatorLevel === "SESSION") {
    // Session-level: the most recent documents across every trace.
    return { spans: getMostRecentSpans(traceData, maxItems) };
  }

  if (evaluatorLevel === "TRACE") {
    // Trace-level: the target trace plus the earlier ones, for context.
    if (traceId) {
      const filteredData = filterTracesUpTo(traceData, traceId);
      return {
        spans: getMostRecentSpans(filteredData, maxItems),
        evaluationTarget: { traceIds: [traceId] },
      };
    }
    return { spans: getMostRecentSpans(traceData, maxItems) };
  }

  throw new Error(`Unknown evaluator level: ${evaluatorLevel}`);
}

// ===========================
// Reference inputs
// ===========================

/** Ground truth for an evaluation (Python: `models.ReferenceInputs`). */
export interface ReferenceInputs {
  assertions?: string[];
  expectedTrajectory?: string[];
  /** Either the response text, or `{ traceId: text }` to target specific traces. */
  expectedResponse?: string | Record<string, string>;
}

/** A single `EvaluationReferenceInput` struct as the API takes it. */
export interface ApiReferenceInput {
  context: { spanContext: { sessionId: string; traceId?: string } };
  assertions?: { text: string }[];
  expectedTrajectory?: { toolNames: string[] };
  expectedResponse?: { text: string };
}

/**
 * Convert reference inputs to the API list (Python: `ReferenceInputs.to_api_dict`).
 *
 * `assertions` and `expectedTrajectory` are session-level; `expectedResponse` is trace-level and
 * must already be resolved to a `{ traceId: text }` record.
 */
export function referenceInputsToApiList(
  referenceInputs: ReferenceInputs,
  sessionId: string,
): ApiReferenceInput[] {
  const items: ApiReferenceInput[] = [];

  const hasSessionFields = referenceInputs.assertions !== undefined ||
    referenceInputs.expectedTrajectory !== undefined;
  if (hasSessionFields) {
    const sessionItem: ApiReferenceInput = { context: { spanContext: { sessionId } } };
    if (referenceInputs.assertions !== undefined) {
      sessionItem.assertions = referenceInputs.assertions.map((a) => ({ text: a }));
    }
    if (referenceInputs.expectedTrajectory !== undefined) {
      sessionItem.expectedTrajectory = { toolNames: referenceInputs.expectedTrajectory };
    }
    items.push(sessionItem);
  }

  const expected = referenceInputs.expectedResponse;
  if (expected !== undefined && typeof expected !== "string") {
    for (const [respTraceId, respText] of Object.entries(expected)) {
      items.push({
        context: { spanContext: { sessionId, traceId: respTraceId } },
        expectedResponse: { text: respText },
      });
    }
  }

  return items;
}

/** Resolve a bare `expectedResponse` string onto a trace (Python: `execute_evaluators`). */
export function resolveExpectedResponse(
  referenceInputs: ReferenceInputs,
  otelSpans: OtelDocument[],
  traceId?: string,
): ReferenceInputs {
  const resolved: ReferenceInputs = { ...referenceInputs };
  if (typeof resolved.expectedResponse !== "string") return resolved;

  // `otelSpans` is newest-first, so walking it backwards picks the session's earliest trace,
  // which is what the Python `reversed(otel_spans)` does.
  let targetTrace = traceId;
  if (!targetTrace) {
    for (let i = otelSpans.length - 1; i >= 0; i--) {
      const candidate = otelSpans[i].traceId;
      if (typeof candidate === "string" && candidate) {
        targetTrace = candidate;
        break;
      }
    }
  }

  if (targetTrace) resolved.expectedResponse = { [targetTrace]: resolved.expectedResponse };
  return resolved;
}

// ===========================
// Result shapes
// ===========================

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

/** One result from the Evaluate API (Python: `models.EvaluationResult`). */
export interface EvaluationResult {
  evaluatorId: string;
  evaluatorName: string;
  evaluatorArn: string;
  explanation: string;
  /** The API's `context` union; in practice `{ spanContext: { sessionId, traceId?, spanId? } }`. */
  context: OtelDocument;
  value?: number;
  label?: string;
  tokenUsage?: TokenUsage;
  error?: string;
}

/** All results for one `run()` (Python: `models.EvaluationResults`). */
export interface EvaluationResults {
  sessionId?: string;
  traceId?: string;
  results: EvaluationResult[];
  /** The OTel documents that were sent to the API, kept for export. */
  inputData?: { spans: OtelDocument[] };
}

export function hasErrors(results: EvaluationResults): boolean {
  return results.results.some((r) => r.error !== undefined);
}

export function getSuccessfulResults(results: EvaluationResults): EvaluationResult[] {
  return results.results.filter((r) => r.error === undefined);
}

export function getFailedResults(results: EvaluationResults): EvaluationResult[] {
  return results.results.filter((r) => r.error !== undefined);
}

/** The serialisable form written by `run({ output })` (Python: `EvaluationResults.to_dict`). */
export interface EvaluationResultsDocument {
  sessionId?: string;
  traceId?: string;
  summary: { totalEvaluations: number; successful: number; failed: number };
  results: EvaluationResult[];
}

export function evaluationResultsToDocument(
  results: EvaluationResults,
): EvaluationResultsDocument {
  return {
    sessionId: results.sessionId,
    traceId: results.traceId,
    summary: {
      totalEvaluations: results.results.length,
      successful: getSuccessfulResults(results).length,
      failed: getFailedResults(results).length,
    },
    results: results.results,
  };
}

// ===========================
// Options objects
// ===========================

export interface EvaluationOptions {
  /** AWS region (Python: `region`). Falls back to `AWS_REGION`, then `us-east-1`. */
  region?: string;
}

export interface RunOptions {
  agentId?: string;
  /** Auto-fetches the agent's latest session when omitted. */
  sessionId?: string;
  /** Default: `["Builtin.GoalSuccessRate"]`. */
  evaluators?: string[];
  /** Evaluate only this trace, with the earlier traces for context. */
  traceId?: string;
  /** Path to save results as JSON. */
  output?: string;
  referenceInputs?: ReferenceInputs;
  /** Days of CloudWatch history to search (default: 7). */
  days?: number;
}

export interface ListEvaluatorsOptions {
  maxResults?: number;
}

export interface GetEvaluatorOptions {
  evaluatorId: string;
  /** Path to save the details as JSON. */
  output?: string;
}

export interface CreateEvaluatorOptions {
  name: string;
  /** Evaluator configuration; must contain an `llmAsAJudge` key. */
  config: OtelDocument;
  /** `TRACE`, `TOOL_CALL` or `SESSION` (default: `TRACE`). */
  level?: string;
  description?: string;
}

export interface DeleteEvaluatorOptions {
  evaluatorId: string;
}

export interface CreateOnlineConfigOptions {
  agentId: string;
  configName: string;
  /** `DEFAULT`, `DRAFT` or an alias ARN (default: `DEFAULT`). */
  agentEndpoint?: string;
  configDescription?: string;
  /** Percentage of interactions to evaluate, 0-100 (default: 1.0). */
  samplingRate?: number;
  /** Default: `["Builtin.GoalSuccessRate"]`. */
  evaluatorList?: string[];
  executionRole?: string;
  autoCreateExecutionRole?: boolean;
  enableOnCreate?: boolean;
}

export interface GetOnlineConfigOptions {
  configId: string;
}

export interface DeleteOnlineConfigOptions {
  configId: string;
  /** Also delete the auto-created IAM execution role (default: false). */
  deleteExecutionRole?: boolean;
}

export interface GetLatestSessionOptions {
  agentId: string;
}

/** Control-plane responses are returned unchanged, exactly as the Python client returns boto3's. */
export type EvaluatorList = ListEvaluatorsCommandOutput;
export type EvaluatorDetails = GetEvaluatorCommandOutput;
export type CreatedEvaluator = CreateEvaluatorCommandOutput;
export type CreatedOnlineConfig = CreateOnlineEvaluationConfigCommandOutput;
export type OnlineConfigDetails = GetOnlineEvaluationConfigCommandOutput;

// ===========================
// The client
// ===========================

/**
 * Notebook interface for agent evaluation.
 *
 * ```ts ignore
 * const evalClient = new Evaluation({ region: "us-east-1" });
 * await evalClient.listEvaluators();
 * const results = await evalClient.run({ agentId, sessionId });
 * ```
 */
export class Evaluation {
  readonly region: string;
  readonly dataPlaneClient: BedrockAgentCoreClient;
  readonly controlPlaneClient: BedrockAgentCoreControlClient;
  readonly observabilityClient: ObservabilityClient;

  constructor({ region }: EvaluationOptions = {}) {
    this.region = region || env("AWS_REGION") || "us-east-1";
    this.dataPlaneClient = new BedrockAgentCoreClient({
      region: this.region,
      // Python configures `{"max_attempts": 3, "mode": "adaptive"}` for transient failures.
      maxAttempts: 3,
      retryMode: "adaptive",
    });
    this.controlPlaneClient = new BedrockAgentCoreControlClient({ region: this.region });
    this.observabilityClient = new ObservabilityClient({ region: this.region });
  }

  // ===========================
  // On-demand evaluation
  // ===========================

  /** The latest session ID for an agent, or `undefined` if there is none in the last 7 days. */
  async getLatestSession({ agentId }: GetLatestSessionOptions): Promise<string | undefined> {
    if (!agentId.trim()) throw new Error("agent_id is required and cannot be empty");

    try {
      const endTime = Date.now();
      const startTime = endTime - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
      return await this.observabilityClient.getLatestSessionId({
        startTimeMs: startTime,
        endTimeMs: endTime,
        agentId,
      });
    } catch (error) {
      console.warn(`Warning: Failed to fetch latest session for agent ${agentId}: ${error}`);
      return undefined;
    }
  }

  /**
   * Run evaluation on a session (mirrors `agentcore eval run`).
   *
   * Fetches the session's spans plus the runtime logs for those traces, filters them to the
   * documents an evaluator can use, and calls `Evaluate` once per evaluator.
   */
  async run(
    { agentId, sessionId, evaluators, traceId, output, referenceInputs, days }: RunOptions = {},
  ): Promise<EvaluationResults> {
    if (!agentId) {
      throw new Error(
        "agentId is required for run(). Provide it as a parameter.\n" +
          "Example: evalClient.run({ agentId: 'my-agent', sessionId: 'session-123' })",
      );
    }

    if (!sessionId) {
      console.log("No sessionId provided, fetching latest session...");
      sessionId = await this.getLatestSession({ agentId });

      if (!sessionId) {
        throw new Error(
          "No sessionId provided and could not fetch latest session. " +
            "Please provide sessionId explicitly or ensure agent has recent sessions.",
        );
      }

      console.log(`Using latest session: ${sessionId}\n`);
    }

    const evaluatorIds = evaluators ?? DEFAULT_EVALUATORS;

    console.log(`\nEvaluating session: ${sessionId}`);
    console.log(
      traceId
        ? `Trace: ${traceId} (with previous traces for context)`
        : "Mode: All traces (most recent 1000 spans)",
    );
    console.log(`Evaluators: ${evaluatorIds.join(", ")}\n`);

    const results = await this.evaluateSession({
      sessionId,
      evaluators: evaluatorIds,
      agentId,
      traceId,
      days,
      referenceInputs,
    });

    if (output) await saveEvaluationResults(results, output);

    return results;
  }

  /** Fetch a session's spans and runtime logs (Python: `EvaluationProcessor.fetch_session_data`). */
  async fetchSessionData(
    { sessionId, agentId, days = DEFAULT_LOOKBACK_DAYS }: {
      sessionId: string;
      agentId: string;
      days?: number;
    },
  ): Promise<TraceData> {
    if (!sessionId.trim()) throw new Error("sessionId is required and cannot be empty");
    if (!agentId.trim()) throw new Error("agentId is required and cannot be empty");

    const endTimeMs = Date.now();
    const startTimeMs = endTimeMs - days * 24 * 60 * 60 * 1000;

    const spans = await this.observabilityClient.querySpansBySession({
      sessionId,
      startTimeMs,
      endTimeMs,
      agentId,
    });

    if (spans.length === 0) throw new Error(`No spans found for session ${sessionId}`);

    const traceIds = [...new Set(spans.map((span: Span) => span.traceId).filter(Boolean))];

    const runtimeLogs = await this.observabilityClient.queryRuntimeLogsByTraces({
      traceIds,
      startTimeMs,
      endTimeMs,
      agentId,
      endpointName: DEFAULT_RUNTIME_ENDPOINT,
    });

    return { sessionId, agentId, spans, runtimeLogs };
  }

  /** Evaluate a session with several evaluators (Python: `EvaluationProcessor.evaluate_session`). */
  async evaluateSession(
    { sessionId, evaluators, agentId, traceId, days = DEFAULT_LOOKBACK_DAYS, referenceInputs }: {
      sessionId: string;
      evaluators: string[];
      agentId: string;
      traceId?: string;
      days?: number;
      referenceInputs?: ReferenceInputs;
    },
  ): Promise<EvaluationResults> {
    if (evaluators.length === 0) throw new Error("evaluators must be a non-empty list");
    if (evaluators.length > MAX_EVALUATORS_PER_REQUEST) {
      throw new Error(
        `Too many evaluators: ${evaluators.length}. ` +
          `Maximum allowed is ${MAX_EVALUATORS_PER_REQUEST} per request.`,
      );
    }

    const traceData = await this.fetchSessionData({ sessionId, agentId, days });

    const results: EvaluationResults = { sessionId, traceId, results: [] };
    let inputSpans: OtelDocument[] = [];

    for (const [level, evalList] of await this.groupEvaluatorsByLevel(evaluators)) {
      if (evalList.length === 0) continue;

      const { spans: otelSpans, evaluationTarget } = determineSpansForEvaluator({
        evaluatorLevel: level,
        traceData,
        traceId,
        maxItems: DEFAULT_MAX_EVALUATION_ITEMS,
      });

      if (otelSpans.length === 0) continue;

      if (inputSpans.length === 0) inputSpans = otelSpans;

      const evalResults = await this.executeEvaluators({
        evaluators: evalList,
        otelSpans,
        sessionId,
        evaluationTarget,
        referenceInputs,
        traceId,
      });
      results.results.push(...evalResults);
    }

    if (inputSpans.length > 0) results.inputData = { spans: inputSpans };

    return results;
  }

  /** Call the Evaluate API once per evaluator (Python: `EvaluationProcessor.execute_evaluators`). */
  async executeEvaluators(
    { evaluators, otelSpans, sessionId, evaluationTarget, referenceInputs, traceId }: {
      evaluators: string[];
      otelSpans: OtelDocument[];
      sessionId: string;
      evaluationTarget?: EvaluationTarget;
      referenceInputs?: ReferenceInputs;
      traceId?: string;
    },
  ): Promise<EvaluationResult[]> {
    const evalRefInputs = referenceInputs
      ? referenceInputsToApiList(
        resolveExpectedResponse(referenceInputs, otelSpans, traceId),
        sessionId,
      )
      : undefined;

    const results: EvaluationResult[] = [];

    for (const evaluatorId of evaluators) {
      try {
        const response = await this.dataPlaneClient.send(
          new EvaluateCommand({
            evaluatorId,
            // The SDK types `sessionSpans` as smithy documents; our parsed OTel documents are
            // structurally the same, but TypeScript cannot prove it.
            evaluationInput: {
              sessionSpans: otelSpans,
            } as unknown as EvaluateCommandInput["evaluationInput"],
            // Likewise a tagged union in the SDK, a plain `{ traceIds }` object in Python.
            evaluationTarget: evaluationTarget as EvaluateCommandInput["evaluationTarget"],
            evaluationReferenceInputs: evalRefInputs?.length ? evalRefInputs : undefined,
          }),
        );

        const apiResults = response.evaluationResults ?? [];
        if (apiResults.length === 0) console.warn(`Evaluator ${evaluatorId} returned no results`);

        for (const apiResult of apiResults) {
          results.push({
            evaluatorId: apiResult.evaluatorId ?? "",
            evaluatorName: apiResult.evaluatorName ?? "",
            evaluatorArn: apiResult.evaluatorArn ?? "",
            explanation: apiResult.explanation ?? "",
            context: (apiResult.context ?? {}) as OtelDocument,
            value: apiResult.value,
            label: apiResult.label,
            tokenUsage: apiResult.tokenUsage,
            error: apiResult.errorMessage,
          });
        }
      } catch (error) {
        console.warn(`Evaluator ${evaluatorId} failed: ${error}`);
        results.push({
          evaluatorId,
          evaluatorName: evaluatorId,
          evaluatorArn: "",
          explanation: `Evaluation failed: ${error}`,
          context: { spanContext: { sessionId } },
          error: String(error),
        });
      }
    }

    return results;
  }

  /** Group evaluator IDs into `SESSION` and `TRACE`; anything else counts as `TRACE`. */
  private async groupEvaluatorsByLevel(evaluators: string[]): Promise<[string, string[]][]> {
    const grouped: [string, string[]][] = [["SESSION", []], ["TRACE", []]];

    for (const evaluatorId of evaluators) {
      let level = "TRACE";
      try {
        const details = await this.getEvaluatorRaw(evaluatorId);
        level = details.level ?? "TRACE";
      } catch (error) {
        // Default to TRACE when the evaluator's details cannot be fetched.
        console.debug(`Could not fetch level for evaluator ${evaluatorId}: ${error}`);
      }
      grouped[level === "SESSION" ? 0 : 1][1].push(evaluatorId);
    }

    return grouped;
  }

  // ===========================
  // Evaluator management
  // ===========================

  /** List all evaluators, built-in and custom (mirrors `agentcore eval evaluator list`). */
  async listEvaluators({ maxResults = 50 }: ListEvaluatorsOptions = {}): Promise<EvaluatorList> {
    return await this.controlPlaneClient.send(new ListEvaluatorsCommand({ maxResults }));
  }

  /** Get one evaluator's details (mirrors `agentcore eval evaluator get`). */
  async getEvaluator({ evaluatorId, output }: GetEvaluatorOptions): Promise<EvaluatorDetails> {
    const response = await this.getEvaluatorRaw(evaluatorId);
    if (output) await saveJsonOutput(response, output);
    return response;
  }

  /** Create a custom evaluator (mirrors `agentcore eval evaluator create`). */
  async createEvaluator(
    { name, config, level = "TRACE", description }: CreateEvaluatorOptions,
  ): Promise<CreatedEvaluator> {
    validateEvaluatorConfig(config);

    const response = await this.controlPlaneClient.send(
      new CreateEvaluatorCommand({
        evaluatorName: name,
        // The SDK narrows `level` to an enum and `evaluatorConfig` to a tagged union; both are
        // plain values in Python, and the notebook builds them the same way.
        level: level as CreateEvaluatorCommandInput["level"],
        evaluatorConfig: config as unknown as CreateEvaluatorCommandInput["evaluatorConfig"],
        description: description || undefined,
      }),
    );

    console.log("\nEvaluator created successfully!");
    console.log(`ID: ${response.evaluatorId ?? ""}`);
    console.log(`ARN: ${response.evaluatorArn ?? ""}`);

    return response;
  }

  /** Delete a custom evaluator (mirrors `agentcore eval evaluator delete`). */
  async deleteEvaluator({ evaluatorId }: DeleteEvaluatorOptions): Promise<void> {
    if (isBuiltinEvaluator(evaluatorId)) {
      throw new Error("Built-in evaluators cannot be deleted");
    }

    await this.controlPlaneClient.send(new DeleteEvaluatorCommand({ evaluatorId }));
    console.log("\nEvaluator deleted successfully");
  }

  private async getEvaluatorRaw(evaluatorId: string): Promise<EvaluatorDetails> {
    return await this.controlPlaneClient.send(new GetEvaluatorCommand({ evaluatorId }));
  }

  // ===========================
  // Online evaluation configs
  // ===========================

  /**
   * Create an online evaluation config (mirrors `agentcore eval online create`).
   *
   * Continuously evaluates a sample of the agent's live traffic by watching its runtime log group.
   */
  async createOnlineConfig(
    {
      agentId,
      configName,
      agentEndpoint = "DEFAULT",
      configDescription,
      samplingRate = 1.0,
      evaluatorList,
      executionRole,
      autoCreateExecutionRole = true,
      enableOnCreate = true,
    }: CreateOnlineConfigOptions,
  ): Promise<CreatedOnlineConfig> {
    if (!configName.trim()) throw new Error("configName is required and cannot be empty");
    if (!agentId.trim()) throw new Error("agentId is required and cannot be empty");
    if (!(samplingRate >= 0 && samplingRate <= 100)) {
      throw new Error(`samplingRate must be between 0 and 100, got ${samplingRate}`);
    }
    if (!executionRole && !autoCreateExecutionRole) {
      throw new Error("executionRole is required when autoCreateExecutionRole is false");
    }

    // The agent runtime gives both the service name the online config filters on and, via its ARN,
    // the account ID the execution role's policies are scoped to (Python calls STS for the latter).
    const runtime = await this.controlPlaneClient.send(
      new GetAgentRuntimeCommand({ agentRuntimeId: agentId }),
    );
    const agentName = runtime.agentRuntimeName ?? "";
    const accountId = (runtime.agentRuntimeArn ?? "").split(":")[4] ?? "";

    let roleArn = executionRole;
    if (autoCreateExecutionRole && !roleArn) {
      roleArn = await getOrCreateEvaluationExecutionRole({
        region: this.region,
        accountId,
        configName,
      });
    }

    const response = await this.controlPlaneClient.send(
      new CreateOnlineEvaluationConfigCommand({
        onlineEvaluationConfigName: configName,
        rule: { samplingConfig: { samplingPercentage: samplingRate } },
        dataSourceConfig: {
          cloudWatchLogs: {
            logGroupNames: [getAgentRuntimeLogGroup(agentId, agentEndpoint)],
            serviceNames: [`${agentName}.${agentEndpoint}`],
          },
        },
        evaluators: (evaluatorList ?? DEFAULT_EVALUATORS).map((evaluatorId) => ({ evaluatorId })),
        evaluationExecutionRoleArn: roleArn,
        enableOnCreate,
        description: configDescription || undefined,
      }),
    );

    console.log("Online evaluation configuration created!");
    return response;
  }

  /** Get an online evaluation config (mirrors `agentcore eval online get`). */
  async getOnlineConfig({ configId }: GetOnlineConfigOptions): Promise<OnlineConfigDetails> {
    if (!configId.trim()) throw new Error("configId is required and cannot be empty");

    return await this.controlPlaneClient.send(
      new GetOnlineEvaluationConfigCommand({ onlineEvaluationConfigId: configId }),
    );
  }

  /** Delete an online evaluation config (mirrors `agentcore eval online delete`). */
  async deleteOnlineConfig(
    { configId, deleteExecutionRole = false }: DeleteOnlineConfigOptions,
  ): Promise<void> {
    if (!configId.trim()) throw new Error("configId is required and cannot be empty");

    let executionRoleArn: string | undefined;
    if (deleteExecutionRole) {
      try {
        const details = await this.getOnlineConfig({ configId });
        executionRoleArn = details.evaluationExecutionRoleArn;
      } catch (error) {
        console.warn(`Could not retrieve config details to get execution role: ${error}`);
      }
    }

    await this.controlPlaneClient.send(
      new DeleteOnlineEvaluationConfigCommand({ onlineEvaluationConfigId: configId }),
    );
    console.log("Configuration deleted!");

    if (deleteExecutionRole && executionRoleArn) {
      await deleteExecutionRoleByArn(executionRoleArn, this.region);
    }
  }
}

// ===========================
// Evaluator helpers
// ===========================

/** True when the ID names a built-in evaluator (Python: `is_builtin_evaluator`). */
export function isBuiltinEvaluator(evaluatorId: string): boolean {
  return evaluatorId.startsWith("Builtin.");
}

/** Reject an evaluator config that is missing `llmAsAJudge` (Python: `validate_evaluator_config`). */
export function validateEvaluatorConfig(config: OtelDocument): void {
  if (!("llmAsAJudge" in config)) throw new Error("Config must contain 'llmAsAJudge' key");
}

// ===========================
// Output files
// ===========================

/** Write results to JSON, with the input spans alongside in `<name>_input.json`. */
export async function saveEvaluationResults(
  results: EvaluationResults,
  outputFile: string,
): Promise<void> {
  await Deno.mkdir(dirname(outputFile), { recursive: true });
  await Deno.writeTextFile(
    outputFile,
    JSON.stringify(evaluationResultsToDocument(results), null, 2),
  );
  console.log(`\nResults saved to: ${outputFile}`);

  if (results.inputData !== undefined) {
    const suffix = extname(outputFile);
    const stem = outputFile.slice(0, outputFile.length - suffix.length);
    const inputPath = `${stem}_input${suffix}`;
    await Deno.writeTextFile(inputPath, JSON.stringify(results.inputData, null, 2));
    console.log(`Input data saved to: ${inputPath}`);
  }
}

/** Write any JSON document to a file, creating parent directories. */
export async function saveJsonOutput(data: unknown, outputFile: string): Promise<void> {
  await Deno.mkdir(dirname(outputFile), { recursive: true });
  await Deno.writeTextFile(outputFile, JSON.stringify(data, null, 2));
  console.log(`\nSaved to: ${outputFile}`);
}

// ===========================
// IAM execution role (Python: operations/evaluation/create_role.py)
// ===========================

/** Deterministic lowercase suffix for role names, derived from the config name. */
export async function generateDeterministicSuffix(
  configName: string,
  length = 10,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(configName));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, length).toLowerCase();
}

/** Structural deep equality, matching Python's order-insensitive `dict ==`. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    key in (b as Record<string, unknown>) &&
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}

/** Refuse to reuse a role whose trust policy is not the one we require. */
export function validateIamRoleTrustPolicy(
  assumeRolePolicyDocument: string | undefined,
  expectedPolicy: unknown,
  roleName: string,
): void {
  let actualPolicy: unknown;
  try {
    actualPolicy = JSON.parse(decodeURIComponent(assumeRolePolicyDocument ?? ""));
  } catch {
    actualPolicy = undefined;
  }

  if (deepEqual(actualPolicy, expectedPolicy)) return;

  throw new Error(
    `Refusing to reuse existing IAM role '${roleName}' because its trust policy does not match ` +
      "the policy required by Bedrock AgentCore Evaluation. Delete the conflicting role or " +
      "provide a customer-managed role with executionRole.",
  );
}

function buildEvaluationTrustPolicy(region: string, accountId: string): OtelDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "TrustPolicyStatement",
        Effect: "Allow",
        Principal: { Service: "bedrock-agentcore.amazonaws.com" },
        Action: "sts:AssumeRole",
        Condition: {
          StringEquals: { "aws:SourceAccount": accountId, "aws:ResourceAccount": accountId },
          ArnLike: {
            "aws:SourceArn": [
              `arn:aws:bedrock-agentcore:${region}:${accountId}:evaluator/*`,
              `arn:aws:bedrock-agentcore:${region}:${accountId}:online-evaluation-config/*`,
            ],
          },
        },
      },
    ],
  };
}

function buildEvaluationPermissionsPolicy(region: string, accountId: string): OtelDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "CloudWatchLogReadStatement",
        Effect: "Allow",
        Action: [
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:GetQueryResults",
          "logs:StartQuery",
          "cloudwatch:GenerateQuery",
          "cloudwatch:GenerateQueryResultsSummary",
        ],
        Resource: "*",
      },
      {
        Sid: "CloudWatchLogWriteStatement",
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:GetLogEvents",
        ],
        Resource:
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/bedrock-agentcore/evaluations/*`,
      },
      {
        Sid: "CloudWatchIndexPolicyStatement",
        Effect: "Allow",
        Action: ["logs:DescribeIndexPolicies", "logs:PutIndexPolicy"],
        Resource: [
          `arn:aws:logs:${region}:${accountId}:log-group:aws/spans`,
          `arn:aws:logs:${region}:${accountId}:log-group:aws/spans:*`,
        ],
      },
      {
        Sid: "BedrockInvokeStatement",
        Effect: "Allow",
        Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        Resource: [
          "arn:aws:bedrock:*::foundation-model/*",
          `arn:aws:bedrock:${region}:${accountId}:*`,
        ],
      },
    ],
  };
}

/** Get or create the evaluation execution role; idempotent, keyed on the config name. */
export async function getOrCreateEvaluationExecutionRole(
  { region, accountId, configName, roleName }: {
    region: string;
    accountId: string;
    configName: string;
    roleName?: string;
  },
): Promise<string> {
  const suffix = await generateDeterministicSuffix(configName);
  const name = roleName ?? `AgentCoreEvalsSDK-${region}-${suffix}`;
  const trustPolicy = buildEvaluationTrustPolicy(region, accountId);
  const iam = new IAMClient({ region });

  try {
    const existing = await iam.send(new GetRoleCommand({ RoleName: name }));
    validateIamRoleTrustPolicy(existing.Role?.AssumeRolePolicyDocument, trustPolicy, name);
    console.log(`Reusing existing evaluation execution role: ${existing.Role?.Arn ?? ""}`);
    return existing.Role?.Arn ?? "";
  } catch (error) {
    if (!(error instanceof NoSuchEntityException)) throw error;
  }

  console.log(`Creating IAM role: ${name}`);
  try {
    const created = await iam.send(
      new CreateRoleCommand({
        RoleName: name,
        AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
        Description: `Execution role for BedrockAgentCore Evaluation - ${configName}`,
      }),
    );

    await iam.send(
      new PutRolePolicyCommand({
        RoleName: name,
        PolicyName: `AgentCoreEvaluationPolicy-${region}-${suffix}`,
        PolicyDocument: JSON.stringify(buildEvaluationPermissionsPolicy(region, accountId)),
      }),
    );

    console.log("Waiting for IAM role propagation...");
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    return created.Role?.Arn ?? "";
  } catch (error) {
    if (error instanceof EntityAlreadyExistsException) {
      const existing = await iam.send(new GetRoleCommand({ RoleName: name }));
      validateIamRoleTrustPolicy(existing.Role?.AssumeRolePolicyDocument, trustPolicy, name);
      return existing.Role?.Arn ?? "";
    }
    throw error;
  }
}

/** Delete an IAM role and its inline policies (Python: `_delete_execution_role`). */
async function deleteExecutionRoleByArn(roleArn: string, region: string): Promise<void> {
  // ARN format: arn:aws:iam::123456789012:role/RoleName
  const roleName = roleArn.split("/").pop() ?? roleArn;
  const iam = new IAMClient({ region });

  try {
    const policies = await iam.send(new ListRolePoliciesCommand({ RoleName: roleName }));
    for (const policyName of policies.PolicyNames ?? []) {
      await iam.send(new DeleteRolePolicyCommand({ RoleName: roleName, PolicyName: policyName }));
      console.log(`Inline policy deleted: ${policyName}`);
    }
  } catch (error) {
    console.warn(`Error listing/deleting inline policies: ${error}`);
  }

  try {
    await iam.send(new DeleteRoleCommand({ RoleName: roleName }));
    console.log(`IAM role deleted successfully: ${roleName}`);
  } catch (error) {
    if (error instanceof NoSuchEntityException) {
      console.warn(`Role ${roleName} does not exist or was already deleted`);
      return;
    }
    throw new Error(`Failed to delete role ${roleName}: ${error}`, { cause: error });
  }
}

/** Re-exported so a notebook can build a `TraceData` without a second import. */
export type { OtelDocument, Span, TraceData };
export { getAgentRuntimeLogGroup, ObservabilityClient };
