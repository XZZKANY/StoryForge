import { dumpJson, type JsonObject } from '../kernel/json';
import { cpLen } from '../kernel/pythonText';
import {
  ChatMessage,
  ToolCall,
  type ChatRequest,
  type ChatResponse,
  type TokenUsage,
} from '../llm/contracts';
import type { PendingToolCall, RuntimeCheckpoint, RuntimeLimits, RuntimeState } from './sdkState';
import {
  RuntimeToolResult,
  type RuntimeTool,
  type ToolFeedbackFormatter,
  type ToolRegistry,
} from './sdkTools';

type MaybePromise<T> = T | Promise<T>;

export type RuntimeTraceEvent = {
  readonly runId: string;
  readonly sequence: number;
  readonly roundNumber: number;
  readonly timestamp: string;
  readonly kind: string;
  readonly payload: JsonObject;
};

export interface RunTracer {
  emit(event: RuntimeTraceEvent): MaybePromise<void>;
}
/** 返回本次调用的估算费用；null 表示不知道。 */
export interface UsageSink {
  record(runId: string, roundNumber: number, usage: TokenUsage): MaybePromise<number | null>;
}
export interface CheckpointStore {
  save(checkpoint: RuntimeCheckpoint): MaybePromise<void>;
  load(runId: string): MaybePromise<RuntimeCheckpoint | null>;
}
export type PolicyDecision = { kind: 'allow' | 'deny'; reason: string | null };
export interface RuntimePolicy {
  decideTool(tool: RuntimeTool, call: PendingToolCall, context: unknown): PolicyDecision;
  shouldRetry(tool: RuntimeTool, retryable: boolean, attempt: number): boolean;
  canResumeStartedTool(tool: RuntimeTool, call: PendingToolCall): boolean;
}
export interface ToolSelector {
  select(registry: ToolRegistry, context: unknown): readonly RuntimeTool[];
}
export type InterruptionCheck = (
  runId: string,
  boundary: string,
  checkpoint: RuntimeCheckpoint,
) => MaybePromise<string | null>;
export interface RuntimeProvider {
  complete(request: ChatRequest): Promise<ChatResponse>;
}

export class DefaultRuntimePolicy implements RuntimePolicy {
  readonly maxToolAttempts: number;
  constructor(maxToolAttempts = 2) {
    this.maxToolAttempts = Math.max(1, maxToolAttempts);
  }
  decideTool(_tool: RuntimeTool, _call: PendingToolCall, _context: unknown): PolicyDecision {
    return { kind: 'allow', reason: null };
  }
  shouldRetry(tool: RuntimeTool, retryable: boolean, attempt: number): boolean {
    return tool.retrySafe && tool.idempotent && retryable && attempt < this.maxToolAttempts;
  }
  canResumeStartedTool(tool: RuntimeTool, _call: PendingToolCall): boolean {
    return tool.retrySafe && tool.idempotent;
  }
}

export class InMemoryCheckpointStore implements CheckpointStore {
  readonly checkpoints = new Map<string, RuntimeCheckpoint>();
  save(checkpoint: RuntimeCheckpoint): void {
    this.checkpoints.set(checkpoint.runId, checkpoint);
  }
  load(runId: string): RuntimeCheckpoint | null {
    return this.checkpoints.get(runId) ?? null;
  }
}

export class RuntimeInfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeInfrastructureError';
  }
}

/** Python datetime.now(UTC).isoformat()：微秒为零时不带小数部分。 */
export function utcIsoTimestamp(date = new Date()): string {
  const iso = date.toISOString();
  const ms = date.getUTCMilliseconds();
  return (
    (ms ? iso.replace(/\.\d{3}Z$/, `.${String(ms * 1000).padStart(6, '0')}`) : iso.slice(0, 19)) +
    '+00:00'
  );
}

export function shouldWithdrawTools(state: RuntimeState, limits: RuntimeLimits): boolean {
  return (
    state.exhausted ||
    state.toolAttempts >= limits.maxToolCalls ||
    state.toolOutputChars >= limits.maxToolOutputChars ||
    (limits.maxTokens !== null && state.usageAvailable && state.totalTokens >= limits.maxTokens) ||
    (limits.maxCost !== null && state.costAvailable && (state.totalCost ?? 0) >= limits.maxCost)
  );
}

export function appendToolFeedback(
  state: RuntimeState,
  call: ToolCall,
  result: RuntimeToolResult,
  options: {
    formatter: ToolFeedbackFormatter;
    tool?: RuntimeTool | null;
    context?: unknown;
    limits?: RuntimeLimits | null;
  },
): void {
  const input = { call, tool: options.tool ?? null, context: options.context ?? null };
  let serialized = options.formatter.format(result, input);
  if (options.limits) {
    const remaining = Math.max(0, options.limits.maxToolOutputChars - state.toolOutputChars);
    if (cpLen(serialized) > remaining) {
      state.exhausted = true;
      serialized = options.formatter.format(
        RuntimeToolResult.failure(
          'tool_output_budget',
          'Tool output was omitted because the output budget is exhausted.',
        ),
        input,
      );
    }
    state.toolOutputChars += Math.min(cpLen(serialized), remaining);
  }
  state.messages.push(new ChatMessage('tool', serialized, [], call.id));
}

export const callFromPending = (pending: PendingToolCall) =>
  new ToolCall(pending.callId, pending.name, dumpJson(pending.arguments, { ensureAscii: false }));
