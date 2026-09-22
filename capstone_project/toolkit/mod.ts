/**
 * The course's own AgentCore toolkit, replacing the Python `bedrock-agentcore-starter-toolkit`
 * and the `bedrock_agentcore` service clients, neither of which has a TypeScript equivalent.
 *
 * Each class mirrors its Python counterpart: same class name, camelCase methods, an options object
 * in place of keyword arguments, and the same return shapes — so a notebook cell translates line
 * for line. Everything is built on the AWS SDK for JavaScript v3.
 *
 * ```ts
 * import { MemoryClient } from "../toolkit/mod.ts";
 * const memory = new MemoryClient({ region });
 * const created = await memory.createMemoryAndWait({ name, strategies });
 * ```
 *
 * Each module exports more than the classes — query builders, payload builders and other pure
 * helpers used by its tests. Import those from the module itself (`./memory.ts`), not from here.
 */

export { MemoryClient } from "./memory.ts";
export type { EventMessage, MemoryStrategyDict, StrategyConfigInput } from "./memory.ts";
export { DEFAULT_NAMESPACES, MemoryStatus, MessageRole, StrategyType } from "./memory.ts";

export { IdentityClient } from "./identity.ts";
export type { UserIdentifierInput, UserIdIdentifier, UserTokenIdentifier } from "./identity.ts";

export { GatewayClient } from "./gateway.ts";
export type { CognitoAuthorizerResult, CognitoClientInfo } from "./gateway.ts";

export { PolicyClient } from "./policy.ts";

export { Runtime } from "./runtime.ts";
export type { ConfigureResult, InvokeOptions, LaunchResult, StatusResult } from "./runtime.ts";

export { ObservabilityClient } from "./observability-client.ts";
export type { RuntimeLog, Span, TraceData } from "./observability-client.ts";

export { Evaluation } from "./evaluation.ts";
export type { EvaluationResult, EvaluationResults } from "./evaluation.ts";

export { Logger } from "./logger.ts";
export type { LogLevel } from "./logger.ts";
