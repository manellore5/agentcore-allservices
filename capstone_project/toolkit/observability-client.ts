// Hand-written replacement for the Python starter toolkit's
// `bedrock_agentcore_starter_toolkit.operations.observability.client.ObservabilityClient`
// (plus the `query_builder`, `builders` and `telemetry` modules it is built from).
//
// The starter toolkit is Python-only and has no TypeScript equivalent, so the course ports the
// parts the notebooks actually use onto the AWS SDK v3 CloudWatch Logs client. Class name, method
// names (camelCased), the options objects (the Python keyword arguments) and the returned shapes
// are kept so a notebook cell diffs against its Python original as a straight translation.
//
// Deliberate differences from the Python original:
//   - Returned record fields are camelCase (`traceId`, `startTimeUnixNano`) rather than the Python
//     dataclasses' snake_case, because everything else in this port is camelCase.
//   - Unix-nanosecond timestamps are JS `number`s, so they lose precision below ~256ns. That is
//     irrelevant for the ordering and filtering done here, but it is not bit-for-bit Python.
import {
  CloudWatchLogsClient,
  GetQueryResultsCommand,
  ResourceNotFoundException,
  type ResultField,
  StartQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs";

/** A raw OpenTelemetry span or log document, as CloudWatch stores it in `@message`. */
export type OtelDocument = Record<string, unknown>;

/** An OpenTelemetry span with trace and timing information (Python: `telemetry.Span`). */
export interface Span {
  traceId: string;
  spanId: string;
  spanName: string;
  sessionId?: string;
  startTimeUnixNano?: number;
  endTimeUnixNano?: number;
  durationMs?: number;
  statusCode?: string;
  statusMessage?: string;
  parentSpanId?: string;
  kind?: string;
  events: OtelDocument[];
  attributes: OtelDocument;
  resourceAttributes: OtelDocument;
  serviceName?: string;
  resourceId?: string;
  serviceType?: string;
  timestamp?: string;
  rawMessage?: OtelDocument;
}

/** A runtime log entry from an agent-specific log group (Python: `telemetry.RuntimeLog`). */
export interface RuntimeLog {
  timestamp: string;
  message: string;
  spanId?: string;
  traceId?: string;
  logStream?: string;
  rawMessage?: OtelDocument;
}

/** Complete session data: spans plus runtime logs (Python: `telemetry.TraceData`). */
export interface TraceData {
  sessionId?: string;
  agentId?: string;
  spans: Span[];
  runtimeLogs: RuntimeLog[];
}

/** CloudWatch log group name for an agent runtime's logs. */
export function getAgentRuntimeLogGroup(agentId: string, endpointName = "DEFAULT"): string {
  return `/aws/bedrock-agentcore/runtimes/${agentId}-${endpointName}`;
}

/**
 * Logs Insights query strings (Python: `observability.query_builder.CloudWatchQueryBuilder`).
 *
 * The whitespace inside each query is copied from the Python f-strings on purpose: these strings
 * are what a reader compares against the toolkit source when a query misbehaves.
 */
export const CloudWatchQueryBuilder = {
  /** All spans for a session, from the `aws/spans` log group. */
  buildSpansBySessionQuery(sessionId: string, agentId: string): string {
    return `fields @timestamp,
               @message,
               traceId,
               spanId,
               name as spanName,
               kind,
               status.code as statusCode,
               status.message as statusMessage,
               durationNano/1000000 as durationMs,
               attributes.session.id as sessionId,
               startTimeUnixNano,
               endTimeUnixNano,
               parentSpanId,
               events,
               resource.attributes.service.name as serviceName,
               resource.attributes.cloud.resource_id as resourceId,
               attributes.aws.remote.service as serviceType
        | filter attributes.session.id = '${sessionId}'
        | parse resource.attributes.cloud.resource_id "runtime/*/" as parsedAgentId
        | filter parsedAgentId = '${agentId}'
        | sort startTimeUnixNano asc`;
  },

  /** All spans for a trace. Trace IDs are globally unique, so no agent filter is needed. */
  buildSpansByTraceQuery(traceId: string): string {
    return `fields @timestamp,
               @message,
               traceId,
               spanId,
               name as spanName,
               kind,
               status.code as statusCode,
               status.message as statusMessage,
               durationNano/1000000 as durationMs,
               attributes.session.id as sessionId,
               startTimeUnixNano,
               endTimeUnixNano,
               parentSpanId,
               events,
               resource.attributes.service.name as serviceName
        | filter traceId = '${traceId}'
        | sort startTimeUnixNano asc`;
  },

  /** Runtime logs for a single trace (the per-trace fallback query). */
  buildRuntimeLogsByTraceDirect(traceId: string): string {
    return `fields @timestamp, @message, spanId, traceId, @logStream
        | filter traceId = '${traceId}'
        | sort @timestamp asc`;
  },

  /** Runtime logs for many traces in one query, using an `in [...]` filter. */
  buildRuntimeLogsByTracesBatch(traceIds: string[]): string {
    if (traceIds.length === 0) return "";

    const traceIdsQuoted = traceIds.map((tid) => `'${tid}'`).join(", ");

    return `fields @timestamp, @message, spanId, traceId, @logStream
        | filter traceId in [${traceIdsQuoted}]
        | sort @timestamp asc`;
  },

  /** The most recent session ID(s) for an agent. */
  buildLatestSessionQuery(agentId: string, limit = 1): string {
    const baseFilter = 'resource.attributes.aws.service.type = "gen_ai_agent"';

    return `filter ${baseFilter}
| parse resource.attributes.cloud.resource_id "runtime/*/" as parsedAgentId
| filter parsedAgentId = '${agentId}'
| stats max(endTimeUnixNano) as maxEnd by attributes.session.id
| sort maxEnd desc
| limit ${limit}`;
  },
} as const;

function getField(fields: ResultField[], fieldName: string): string | undefined {
  for (const item of fields) {
    if (item.field === fieldName) return item.value;
  }
  return undefined;
}

/** Parse a field that CloudWatch returns as a JSON string, falling back to the raw string. */
function parseJsonField(fields: ResultField[], fieldName: string): unknown {
  const value = getField(fields, fieldName);
  if (!value) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asDocument(value: unknown): OtelDocument | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as OtelDocument
    : undefined;
}

function getNumber(fields: ResultField[], fieldName: string): number | undefined {
  const value = getField(fields, fieldName);
  return value === undefined ? undefined : Number(value);
}

/**
 * Telemetry records from Logs Insights result rows
 * (Python: `observability.builders.CloudWatchResultBuilder`).
 */
export const CloudWatchResultBuilder = {
  buildSpan(result: ResultField[]): Span {
    // `@message` carries the full OTel document, including attributes and resource attributes.
    const rawMessage = asDocument(parseJsonField(result, "@message"));
    const resource = asDocument(rawMessage?.resource);

    return {
      traceId: getField(result, "traceId") ?? "",
      spanId: getField(result, "spanId") ?? "",
      spanName: getField(result, "spanName") ?? "",
      sessionId: getField(result, "sessionId"),
      startTimeUnixNano: getNumber(result, "startTimeUnixNano"),
      endTimeUnixNano: getNumber(result, "endTimeUnixNano"),
      durationMs: getNumber(result, "durationMs"),
      statusCode: getField(result, "statusCode"),
      statusMessage: getField(result, "statusMessage"),
      parentSpanId: getField(result, "parentSpanId"),
      kind: getField(result, "kind"),
      events: (parseJsonField(result, "events") as OtelDocument[] | undefined) ?? [],
      attributes: asDocument(rawMessage?.attributes) ?? {},
      resourceAttributes: asDocument(resource?.attributes) ?? {},
      serviceName: getField(result, "serviceName"),
      resourceId: getField(result, "resourceId"),
      serviceType: getField(result, "serviceType"),
      timestamp: getField(result, "@timestamp"),
      rawMessage,
    };
  },

  buildRuntimeLog(result: ResultField[]): RuntimeLog {
    return {
      timestamp: getField(result, "@timestamp") ?? "",
      message: getField(result, "@message") ?? "",
      spanId: getField(result, "spanId"),
      traceId: getField(result, "traceId"),
      logStream: getField(result, "@logStream"),
      rawMessage: asDocument(parseJsonField(result, "@message")),
    };
  },
} as const;

export interface ObservabilityClientOptions {
  /** AWS region (Python: `region_name`). */
  region: string;
}

export interface QuerySpansBySessionOptions {
  sessionId: string;
  startTimeMs: number;
  endTimeMs: number;
  /** Required: prevents session-ID collisions between agents. */
  agentId: string;
}

export interface QuerySpansByTraceOptions {
  traceId: string;
  startTimeMs: number;
  endTimeMs: number;
  agentId: string;
}

export interface QueryRuntimeLogsByTracesOptions {
  traceIds: string[];
  startTimeMs: number;
  endTimeMs: number;
  agentId: string;
  /** Runtime endpoint name used to build the log group name (default: `DEFAULT`). */
  endpointName?: string;
}

export interface GetLatestSessionIdOptions {
  startTimeMs: number;
  endTimeMs: number;
  agentId: string;
}

/**
 * Stateless client for querying spans, traces and runtime logs from CloudWatch Logs.
 *
 * Every operation takes the agent ID as a parameter, so one client serves any number of agents.
 */
export class ObservabilityClient {
  static readonly SPANS_LOG_GROUP = "aws/spans";
  static readonly QUERY_TIMEOUT_SECONDS = 60;
  static readonly POLL_INTERVAL_SECONDS = 2;

  readonly region: string;
  readonly logsClient: CloudWatchLogsClient;

  constructor({ region }: ObservabilityClientOptions) {
    this.region = region;
    this.logsClient = new CloudWatchLogsClient({ region });
  }

  /** Query all spans for a session from the `aws/spans` log group. */
  async querySpansBySession(
    { sessionId, startTimeMs, endTimeMs, agentId }: QuerySpansBySessionOptions,
  ): Promise<Span[]> {
    const queryString = CloudWatchQueryBuilder.buildSpansBySessionQuery(sessionId, agentId);

    const results = await this.executeCloudWatchQuery({
      queryString,
      logGroupName: ObservabilityClient.SPANS_LOG_GROUP,
      startTime: startTimeMs,
      endTime: endTimeMs,
    });

    return results.map((result) => CloudWatchResultBuilder.buildSpan(result));
  }

  /** Query all spans for a trace from the `aws/spans` log group. */
  async querySpansByTrace(
    { traceId, startTimeMs, endTimeMs }: QuerySpansByTraceOptions,
  ): Promise<Span[]> {
    const queryString = CloudWatchQueryBuilder.buildSpansByTraceQuery(traceId);

    const results = await this.executeCloudWatchQuery({
      queryString,
      logGroupName: ObservabilityClient.SPANS_LOG_GROUP,
      startTime: startTimeMs,
      endTime: endTimeMs,
    });

    return results.map((result) => CloudWatchResultBuilder.buildSpan(result));
  }

  /**
   * Query runtime logs for many traces from the agent's own log group.
   *
   * Uses a single batch query and falls back to one query per trace if that fails.
   */
  async queryRuntimeLogsByTraces(
    {
      traceIds,
      startTimeMs,
      endTimeMs,
      agentId,
      endpointName = "DEFAULT",
    }: QueryRuntimeLogsByTracesOptions,
  ): Promise<RuntimeLog[]> {
    if (traceIds.length === 0) return [];

    const runtimeLogGroup = getAgentRuntimeLogGroup(agentId, endpointName);
    const queryString = CloudWatchQueryBuilder.buildRuntimeLogsByTracesBatch(traceIds);

    try {
      const results = await this.executeCloudWatchQuery({
        queryString,
        logGroupName: runtimeLogGroup,
        startTime: startTimeMs,
        endTime: endTimeMs,
      });
      return results.map((result) => CloudWatchResultBuilder.buildRuntimeLog(result));
    } catch (error) {
      console.warn(`Failed to query runtime logs in batch: ${error}`);
      console.warn("Falling back to individual queries per trace");
      return await this.queryRuntimeLogsIndividually(
        traceIds,
        startTimeMs,
        endTimeMs,
        runtimeLogGroup,
      );
    }
  }

  /** The most recent session ID for an agent, or `undefined` if it has none in the window. */
  async getLatestSessionId(
    { startTimeMs, endTimeMs, agentId }: GetLatestSessionIdOptions,
  ): Promise<string | undefined> {
    const queryString = CloudWatchQueryBuilder.buildLatestSessionQuery(agentId, 1);

    const results = await this.executeCloudWatchQuery({
      queryString,
      logGroupName: ObservabilityClient.SPANS_LOG_GROUP,
      startTime: startTimeMs,
      endTime: endTimeMs,
    });

    const firstRow = results[0];
    if (!firstRow || firstRow.length === 0) return undefined;

    return getField(firstRow, "attributes.session.id");
  }

  private async queryRuntimeLogsIndividually(
    traceIds: string[],
    startTimeMs: number,
    endTimeMs: number,
    runtimeLogGroup: string,
  ): Promise<RuntimeLog[]> {
    const allLogs: RuntimeLog[] = [];

    for (const traceId of traceIds) {
      const queryString = CloudWatchQueryBuilder.buildRuntimeLogsByTraceDirect(traceId);
      try {
        const results = await this.executeCloudWatchQuery({
          queryString,
          logGroupName: runtimeLogGroup,
          startTime: startTimeMs,
          endTime: endTimeMs,
        });
        for (const result of results) {
          allLogs.push(CloudWatchResultBuilder.buildRuntimeLog(result));
        }
      } catch (error) {
        console.warn(`Failed to query runtime logs for trace ${traceId}: ${error}`);
      }
    }

    return allLogs;
  }

  /** Start a Logs Insights query and poll until it completes, fails or times out. */
  private async executeCloudWatchQuery(
    { queryString, logGroupName, startTime, endTime }: {
      queryString: string;
      logGroupName: string;
      startTime: number;
      endTime: number;
    },
  ): Promise<ResultField[][]> {
    let queryId: string | undefined;
    try {
      const response = await this.logsClient.send(
        new StartQueryCommand({
          logGroupName,
          startTime: Math.floor(startTime / 1000), // Logs Insights takes seconds, not milliseconds.
          endTime: Math.floor(endTime / 1000),
          queryString,
        }),
      );
      queryId = response.queryId;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        throw new Error(`Log group not found: ${logGroupName}`, { cause: error });
      }
      throw error;
    }

    const startPollTime = Date.now();
    for (;;) {
      const elapsedSeconds = (Date.now() - startPollTime) / 1000;
      if (elapsedSeconds > ObservabilityClient.QUERY_TIMEOUT_SECONDS) {
        throw new Error(
          `Query ${queryId} timed out after ${ObservabilityClient.QUERY_TIMEOUT_SECONDS} seconds`,
        );
      }

      const result = await this.logsClient.send(new GetQueryResultsCommand({ queryId }));

      if (result.status === "Complete") return result.results ?? [];
      if (result.status === "Failed" || result.status === "Cancelled") {
        throw new Error(`Query ${queryId} failed with status: ${result.status}`);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, ObservabilityClient.POLL_INTERVAL_SECONDS * 1000)
      );
    }
  }
}
