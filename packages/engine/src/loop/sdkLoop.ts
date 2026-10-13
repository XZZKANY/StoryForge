import { cloneJson, type JsonObject } from '../kernel/json';
import {
  ChatMessage,
  ProviderError,
  TokenUsage,
  toAssistantMessage,
  type ChatResponse,
  type ToolCall,
} from '../llm/contracts';
import {
  appendToolFeedback,
  callFromPending,
  DefaultRuntimePolicy,
  InMemoryCheckpointStore,
  RuntimeInfrastructureError,
  shouldWithdrawTools,
  utcIsoTimestamp,
  type CheckpointStore,
  type InterruptionCheck,
  type RunTracer,
  type RuntimePolicy,
  type RuntimeProvider,
  type RuntimeTraceEvent,
  type ToolSelector,
  type UsageSink,
} from './sdkPorts';
import {
  pendingToolCall,
  RuntimeState,
  type PendingToolCall,
  type RuntimeCheckpoint,
  type RuntimeLimits,
  type RuntimeResult,
  type RuntimeResultStatus,
} from './sdkState';
import {
  JsonToolFeedbackFormatter,
  parseToolArguments,
  RuntimeToolResult,
  ToolRegistryError,
  validateJsonSchema,
  type RuntimeTool,
  type ToolFeedbackFormatter,
  type ToolRegistry,
} from './sdkTools';

export type RuntimeOptions = {
  policy?: RuntimePolicy;
  selector?: ToolSelector;
  tracer?: RunTracer;
  usageSink?: UsageSink;
  checkpoints?: CheckpointStore;
  interruption?: InterruptionCheck | null;
  feedbackFormatter?: ToolFeedbackFormatter;
  diagnosticTraceBestEffort?: boolean;
  now?: () => string;
};

export type RunInput = {
  model: string;
  runId: string;
  limits: RuntimeLimits;
  applicationContext?: unknown;
  /** 从检查点恢复；command 为 'continue' 才会继续，null 只回报暂停结果。 */
  resume?: { checkpoint: RuntimeCheckpoint; command: 'continue' | null } | null;
};

/**
 * 与 Python ToolCallingRuntime 同一套轮次 / 预算 / 中断 / 恢复语义；模型与工具调用改为 await。
 * provider 抛出的非 ProviderError 异常（检查中断后）原样上抛，与 Python 同。
 */
export class ToolCallingRuntime {
  private readonly policy: RuntimePolicy;
  private readonly selector: ToolSelector;
  private readonly tracer: RunTracer | null;
  private readonly usageSink: UsageSink | null;
  private readonly checkpoints: CheckpointStore;
  private readonly interruption: InterruptionCheck | null;
  private readonly formatter: ToolFeedbackFormatter;
  private readonly bestEffort: boolean;
  private readonly now: () => string;

  constructor(
    private readonly llm: RuntimeProvider,
    private readonly tools: ToolRegistry,
    options: RuntimeOptions = {},
  ) {
    this.policy = options.policy ?? new DefaultRuntimePolicy();
    this.selector = options.selector ?? { select: (registry) => registry.all() };
    this.tracer = options.tracer ?? null;
    this.usageSink = options.usageSink ?? null;
    this.checkpoints = options.checkpoints ?? new InMemoryCheckpointStore();
    this.interruption = options.interruption ?? null;
    this.formatter = options.feedbackFormatter ?? new JsonToolFeedbackFormatter();
    this.bestEffort = options.diagnosticTraceBestEffort ?? true;
    this.now = options.now ?? (() => utcIsoTimestamp());
  }

  async run(messages: readonly ChatMessage[], input: RunInput): Promise<RuntimeResult> {
    const { limits, applicationContext = null, resume = null } = input;
    const state = resume
      ? RuntimeState.fromCheckpoint(resume.checkpoint)
      : new RuntimeState(input.runId, input.model, 'before_model', [...messages]);
    if (state.runId !== input.runId || state.model !== input.model)
      return this.failure(
        state,
        'resume_identity_mismatch',
        'Checkpoint identity does not match the run.',
        false,
      );
    try {
      if (!resume) {
        await this.emit(state, 'runtime_started', {}, true);
      } else {
        await this.emit(state, 'runtime_resumed', {}, true);
        const resumed = await this.resume(state, resume.command, applicationContext, limits);
        if (resumed !== null) return resumed;
      }
      return await this.runLoop(state, limits, applicationContext);
    } catch (error) {
      if (!(error instanceof RuntimeInfrastructureError)) throw error;
      return this.failure(state, 'runtime_infrastructure', error.message, false);
    }
  }

  private resolvedIds(state: RuntimeState): Set<string | null> {
    return new Set<string | null>([
      ...state.completedToolCallIds,
      ...state.messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId),
    ]);
  }

  private async resume(
    state: RuntimeState,
    command: 'continue' | null,
    context: unknown,
    limits: RuntimeLimits,
  ): Promise<RuntimeResult | null> {
    if (state.continuationOmitted)
      return this.reconciliation(
        state,
        'Provider continuation was omitted from the serialized checkpoint.',
      );
    if (state.phase === 'interrupted') {
      if (command !== 'continue') return this.result(state, 'interrupted', { checkpoint: true });
      if (state.interruptionReason === 'stopped')
        return this.reconciliation(
          state,
          'Stopped execution cannot resume without reconciliation.',
        );
      state.interruptionReason = null;
    }
    if (state.phase === 'failed')
      return this.reconciliation(state, 'Failed runtime requires explicit reconciliation.');
    let resolved = this.resolvedIds(state);
    let activeIndex = -1;
    for (let index = state.messages.length - 1; index >= 0; index--)
      if (state.messages[index].role === 'assistant') {
        activeIndex = index;
        break;
      }
    const activeCalls = activeIndex >= 0 ? state.messages[activeIndex].toolCalls : [];
    if (
      state.messages.some((message, index) =>
        message.toolCalls.some(
          (call) => !resolved.has(call.id) && (index !== activeIndex || state.roundCount === 0),
        ),
      )
    )
      return this.reconciliation(state, 'Older tool-call history has an unknown outcome.');
    if (state.pending !== null && !activeCalls.some((call) => call.id === state.pending!.callId))
      return this.reconciliation(state, 'Pending tool does not belong to the current model batch.');
    if (state.pending !== null) {
      let tool: RuntimeTool;
      try {
        tool = this.tools.get(state.pending.name);
      } catch (error) {
        if (!(error instanceof ToolRegistryError)) throw error;
        return this.reconciliation(state, 'Pending tool is no longer registered.');
      }
      if (state.phase === 'tool_started' || state.pending.attempt > 0) {
        if (!this.policy.canResumeStartedTool(tool, state.pending))
          return this.reconciliation(
            state,
            'Pending tool outcome is unknown and cannot be replayed safely.',
          );
        const selected = new Set(this.selector.select(this.tools, context).map((t) => t.spec.name));
        if (!selected.has(tool.spec.name))
          return this.reconciliation(state, 'Pending tool is no longer available.');
        const result = await this.executePending(state, tool, context, limits);
        if (result !== null) return result;
      }
    }
    // 模型已完成的检查点证明这些调用存在但没派发；已完成的结果是事实，不重放。
    resolved = this.resolvedIds(state);
    for (const call of activeCalls.filter((c) => !resolved.has(c.id))) {
      const selected = new Set(this.selector.select(this.tools, context).map((t) => t.spec.name));
      const result = await this.prepareAndExecuteCall(state, call, selected, context, limits);
      if (result !== null) return result;
    }
    const last = state.messages[state.messages.length - 1];
    if (state.roundCount > 0 && last && last.role === 'assistant' && !last.toolCalls.length)
      return this.complete(state, last.content ?? '');
    state.phase = 'before_model';
    return null;
  }

  private async runLoop(
    state: RuntimeState,
    limits: RuntimeLimits,
    context: unknown,
  ): Promise<RuntimeResult> {
    while (state.roundCount < limits.maxRounds) {
      const interrupted = await this.checkInterruption(state);
      if (interrupted !== null) return interrupted;
      const selected = this.selector.select(this.tools, context);
      let withdraw = shouldWithdrawTools(state, limits);
      if (withdraw) state.exhausted = true;
      if (state.roundCount + 1 >= limits.maxRounds) {
        withdraw = true;
        state.exhausted = true;
      }
      const last = state.messages[state.messages.length - 1];
      if (withdraw && (!last || last.role !== 'system' || last.content !== limits.finalMessage))
        state.messages.push(new ChatMessage('system', limits.finalMessage));
      const offered = withdraw ? [] : selected.map((tool) => tool.spec);
      state.roundCount += 1;
      state.phase = 'before_model';
      await this.emit(state, 'model_started', { tools_offered: offered.length });
      const reason = await this.interruptionReason(state, 'before_model_dispatch');
      if (reason !== null) {
        // 这条轨迹表示派发意图，不代表请求真的发出。
        state.roundCount -= 1;
        return this.interrupt(state, reason);
      }
      let response: ChatResponse;
      try {
        response = await this.llm.complete({
          model: state.model,
          messages: [...state.messages],
          tools: offered,
          temperature: null,
          maxTokens: null,
          toolChoice: null,
          reasoningEffort: null,
        });
      } catch (error) {
        if (error instanceof ProviderError) {
          if (error.usage !== null) await this.recordUsage(state, error.usage);
          const interruption = await this.checkInterruption(state, 'model_error');
          if (interruption !== null) return interruption;
          return this.failure(
            state,
            `provider_${error.details.category}`,
            error.details.safeMessage,
          );
        }
        const usage = (error as { usage?: unknown } | null)?.usage;
        if (usage instanceof TokenUsage) await this.recordUsage(state, usage);
        const interruption = await this.checkInterruption(state, 'model_error');
        if (interruption !== null) return interruption;
        throw error;
      }
      state.phase = 'model_completed';
      await this.recordUsage(state, response.usage);
      await this.emit(state, 'model_completed', {
        tool_call_count: response.toolCalls.length,
        finish_reason: response.finishReason,
      });
      // 只保留完整的模型输出；截断 / 过滤的响应只记用量，不进可恢复的历史。
      if (response.finishReason !== 'length' && response.finishReason !== 'content_filter') {
        state.messages.push(toAssistantMessage(response));
        if (response.toolCalls.length) await this.save(state);
      }
      const afterModel = await this.checkInterruption(state, 'after_model');
      if (afterModel !== null) return afterModel;
      if (response.finishReason === 'length')
        return this.failure(
          state,
          'model_output_truncated',
          'Model output reached its limit before completion; no returned tool calls were executed.',
        );
      if (response.finishReason === 'content_filter')
        return this.failure(
          state,
          'provider_content_filter',
          'Provider filtered the response; no returned tool calls were executed.',
        );
      if (!response.toolCalls.length) return this.complete(state, response.content);
      if (withdraw)
        return this.failure(
          state,
          'tool_call_after_withdrawal',
          'Provider returned a tool call after tools were withdrawn.',
        );
      state.phase = 'tools_pending';
      const names = new Set(selected.map((tool) => tool.spec.name));
      for (const call of response.toolCalls) {
        const paused = await this.prepareAndExecuteCall(state, call, names, context, limits);
        if (paused !== null) return paused;
      }
      state.phase = 'after_tool';
    }
    return this.failure(state, 'round_limit', 'Runtime reached its round limit.');
  }

  private async prepareAndExecuteCall(
    state: RuntimeState,
    call: ToolCall,
    selectedNames: Set<string>,
    context: unknown,
    limits: RuntimeLimits,
  ): Promise<RuntimeResult | null> {
    if (state.completedToolCallIds.includes(call.id)) return null;
    const interrupted = await this.checkInterruption(state, 'before_tool_dispatch');
    if (interrupted !== null) return interrupted;
    let tool: RuntimeTool;
    try {
      tool = this.tools.get(call.name);
    } catch (error) {
      if (!(error instanceof ToolRegistryError)) throw error;
      const result = RuntimeToolResult.failure(
        'unknown_tool',
        `Unknown runtime tool: ${call.name}`,
      );
      return this.rejectCall(state, call, result, null, context);
    }
    if (!selectedNames.has(call.name))
      return this.rejectCall(
        state,
        call,
        RuntimeToolResult.failure(
          'tool_not_available',
          'Tool is not available in the current runtime selection.',
        ),
        tool,
        context,
      );
    const parsed = parseToolArguments(call, tool);
    if (parsed.failure !== null) return this.rejectCall(state, call, parsed.failure, tool, context);
    if (shouldWithdrawTools(state, limits)) {
      state.exhausted = true;
      return this.rejectCall(
        state,
        call,
        RuntimeToolResult.failure(
          'runtime_budget',
          'Runtime budget is exhausted before tool execution.',
        ),
        tool,
        context,
      );
    }
    state.pending = pendingToolCall(call.id, call.name, parsed.args);
    const decision = this.policy.decideTool(tool, state.pending, context);
    const afterPolicy = await this.checkInterruption(state, 'after_tool_policy');
    if (afterPolicy !== null) return afterPolicy;
    if (decision.kind === 'deny') {
      state.pending = null;
      return this.rejectCall(
        state,
        call,
        RuntimeToolResult.failure('policy_denied', decision.reason || 'Tool denied by policy.'),
        tool,
        context,
      );
    }
    return this.executePending(state, tool, context, limits);
  }

  private async executePending(
    state: RuntimeState,
    tool: RuntimeTool,
    context: unknown,
    limits: RuntimeLimits,
  ): Promise<RuntimeResult | null> {
    let pending = state.pending;
    if (pending === null)
      return this.failure(state, 'missing_pending_tool', 'Runtime has no pending tool call.');
    let result: RuntimeToolResult | null = null;
    let interruptionReason: string | null;
    for (;;) {
      interruptionReason = await this.interruptionReason(state, 'before_tool_attempt');
      if (interruptionReason !== null) {
        if (result === null) return this.interrupt(state, interruptionReason);
        break;
      }
      if (shouldWithdrawTools(state, limits)) {
        state.exhausted = true;
        // 已返回的失败是事实，不拿预算拒绝去覆盖它。
        if (result === null)
          result =
            state.toolAttempts >= limits.maxToolCalls
              ? RuntimeToolResult.failure('tool_call_budget', 'Tool-call budget is exhausted.')
              : RuntimeToolResult.failure('runtime_budget', 'Runtime budget is exhausted.');
        break;
      }
      const previous: PendingToolCall = pending!;
      const attempt = previous.attempt + 1;
      pending = Object.freeze({ ...previous, attempt });
      state.pending = pending;
      state.toolAttempts += 1;
      state.phase = 'tool_started';
      await this.emit(state, 'tool_started', {
        tool: tool.spec.name,
        tool_call_id: pending.callId,
        attempt,
      });
      await this.save(state);
      interruptionReason = await this.interruptionReason(state, 'before_tool_dispatch');
      if (interruptionReason !== null) {
        // 处理器没跑：退回预留的次数，保留未决意图。
        state.toolAttempts -= 1;
        state.pending = pending = previous;
        if (result === null) return this.interrupt(state, interruptionReason);
        break;
      }
      try {
        result = await tool.handler(context, cloneJson(pending.arguments));
      } catch {
        const interruption = await this.checkInterruption(state, 'tool_error');
        // 取消时抛错的处理器结果未知：保留 pending。
        if (interruption !== null) return interruption;
        result = RuntimeToolResult.failure(
          'tool_exception',
          'Tool execution failed with an unhandled exception.',
        );
      }
      if (
        result.status === 'success' &&
        Object.keys(tool.outputSchema).length &&
        validateJsonSchema(result.output, tool.outputSchema).length
      )
        result = RuntimeToolResult.failure(
          'invalid_tool_output',
          'Tool output does not match its declared schema.',
        );
      if (result.status === 'success') break;
      await this.emit(state, 'tool_failed', {
        tool: tool.spec.name,
        tool_call_id: pending.callId,
        attempt,
        code: result.errorCode,
      });
      interruptionReason = await this.interruptionReason(state, 'after_tool');
      if (interruptionReason !== null) break;
      if (!this.policy.shouldRetry(tool, result.retryable, attempt)) break;
    }
    const final = result!;
    const settled = pending!;
    if (final.status === 'success') {
      state.artifacts.push(...final.artifacts);
      await this.emit(state, 'tool_completed', {
        tool: tool.spec.name,
        tool_call_id: settled.callId,
        attempt: settled.attempt,
      });
    }
    state.completedToolCallIds.push(settled.callId);
    appendToolFeedback(state, callFromPending(settled), final, {
      formatter: this.formatter,
      tool,
      context,
      limits,
    });
    state.pending = null;
    state.phase = 'after_tool';
    await this.save(state);
    if (interruptionReason !== null) return this.interrupt(state, interruptionReason);
    return this.checkInterruption(state, 'after_tool');
  }

  private async rejectCall(
    state: RuntimeState,
    call: ToolCall,
    result: RuntimeToolResult,
    tool: RuntimeTool | null,
    context: unknown,
  ): Promise<RuntimeResult | null> {
    appendToolFeedback(state, call, result, { formatter: this.formatter, tool, context });
    state.completedToolCallIds.push(call.id);
    state.phase = 'after_tool';
    await this.emit(state, 'tool_failed', {
      tool: call.name,
      tool_call_id: call.id,
      code: result.errorCode,
    });
    await this.save(state);
    return this.checkInterruption(state, 'after_tool');
  }

  private async recordUsage(state: RuntimeState, usage: TokenUsage): Promise<void> {
    if (usage.source !== 'unavailable') {
      state.usageAvailable = true;
      state.totalTokens += usage.totalTokens;
    }
    let charge: number | null = null;
    try {
      if (this.usageSink)
        charge = await this.usageSink.record(state.runId, state.roundCount, usage);
    } catch {
      throw new RuntimeInfrastructureError('Usage sink failed.');
    }
    if (charge !== null) {
      state.costAvailable = true;
      state.totalCost = (state.totalCost ?? 0) + charge;
    }
  }

  private async interruptionReason(state: RuntimeState, boundary: string): Promise<string | null> {
    if (this.interruption === null) return null;
    return this.interruption(state.runId, boundary, state.checkpoint());
  }

  private async checkInterruption(
    state: RuntimeState,
    boundary?: string,
  ): Promise<RuntimeResult | null> {
    const reason = await this.interruptionReason(
      state,
      boundary ?? `before_round:${state.roundCount + 1}`,
    );
    return reason === null ? null : this.interrupt(state, reason);
  }

  private async interrupt(state: RuntimeState, reason: string): Promise<RuntimeResult> {
    state.phase = 'interrupted';
    state.interruptionReason = reason;
    await this.emit(state, 'runtime_interrupted', { reason }, true);
    await this.save(state);
    return this.result(state, 'interrupted', { checkpoint: true });
  }

  private async save(state: RuntimeState): Promise<void> {
    try {
      await this.checkpoints.save(state.checkpoint());
    } catch {
      throw new RuntimeInfrastructureError('Checkpoint store failed.');
    }
    await this.emit(state, 'checkpoint_saved', { phase: state.phase }, true);
    try {
      // 再存一次，把这次轨迹用掉的序号也落盘，恢复时序号确定。
      await this.checkpoints.save(state.checkpoint());
    } catch {
      throw new RuntimeInfrastructureError('Checkpoint store failed after trace emission.');
    }
  }

  private async emit(
    state: RuntimeState,
    kind: string,
    payload: JsonObject = {},
    critical = false,
  ): Promise<void> {
    state.sequence += 1;
    const event: RuntimeTraceEvent = {
      runId: state.runId,
      sequence: state.sequence,
      roundNumber: state.roundCount,
      timestamp: this.now(),
      kind,
      payload: cloneJson(payload),
    };
    try {
      await this.tracer?.emit(event);
    } catch {
      if (critical || !this.bestEffort)
        throw new RuntimeInfrastructureError(`Critical trace event failed: ${kind}.`);
    }
  }

  private async complete(state: RuntimeState, content: string): Promise<RuntimeResult> {
    state.phase = 'completed';
    await this.save(state);
    await this.emit(state, 'runtime_completed', { exhausted: state.exhausted }, true);
    return this.result(state, 'completed', { content });
  }

  private async failure(
    state: RuntimeState,
    code: string,
    message: string,
    record = true,
  ): Promise<RuntimeResult> {
    state.phase = 'failed';
    if (record) {
      await this.save(state);
      await this.emit(state, 'runtime_failed', { code }, true);
    } else {
      try {
        await this.checkpoints.save(state.checkpoint());
      } catch {
        // 基础设施失败时尽力保存，不掩盖原因。
      }
    }
    return this.result(state, 'failed', { errorCode: code, errorMessage: message });
  }

  private reconciliation(state: RuntimeState, message: string): RuntimeResult {
    return this.result(state, 'reconciliation_required', {
      errorCode: 'reconciliation_required',
      errorMessage: message,
      checkpoint: true,
      pending: true,
    });
  }

  private result(
    state: RuntimeState,
    status: RuntimeResultStatus,
    options: {
      content?: string;
      errorCode?: string;
      errorMessage?: string;
      checkpoint?: boolean;
      pending?: boolean;
    } = {},
  ): RuntimeResult {
    return {
      status,
      runId: state.runId,
      content: options.content ?? '',
      messages: [...state.messages],
      artifacts: [...state.artifacts],
      totalTokens: state.totalTokens,
      totalCost: state.totalCost,
      usageAvailable: state.usageAvailable,
      costAvailable: state.costAvailable,
      toolAttempts: state.toolAttempts,
      exhausted: state.exhausted,
      errorCode: options.errorCode ?? null,
      errorMessage: options.errorMessage ?? null,
      checkpoint: options.checkpoint ? state.checkpoint() : null,
      // 只有对账结果带 pending id；暂停结果不带（与 Python _pause_result 同）。
      pendingToolCallId: options.pending && state.pending ? state.pending.callId : null,
    };
  }
}
