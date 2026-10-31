import { GenerationDeliveryCapture } from '../kernel/generationDelivery';
import {
  dumpJson,
  isJsonObject,
  isObj,
  JsonFloat,
  parseJson,
  type JsonObject,
  type Obj,
} from '../kernel/json';
import { cpSlice } from '../kernel/pythonText';
import type { PlainJson } from '../kernel/redaction';
import {
  ProviderError,
  ToolCall,
  ToolSpec,
  type ChatRequest,
  type ChatResponse,
  type StreamEvent,
} from '../llm/contracts';
import { RunInterrupted } from '../llm/control';
import { LlmError } from '../llm/payload';
import { costBreakdown } from '../llm/usage';
import type { StoryForgeCheckpointStore } from './chatLoopCheckpoints';
import { StoryForgeRuntimeContext } from './chatLoopContext';
import { loopToolFeedback } from './chatLoopTypes';
import { gateDecide } from './permission';
import type {
  InterruptionCheck,
  PolicyDecision,
  RunTracer,
  RuntimePolicy,
  RuntimeProvider,
  RuntimeTraceEvent,
  ToolSelector,
  UsageSink,
} from './sdkPorts';
import type { PendingToolCall } from './sdkState';
import {
  runtimeArtifact,
  RuntimeToolResult,
  runtimeTool,
  ToolRegistry,
  type FeedbackInput,
  type RuntimeTool,
  type ToolFeedbackFormatter,
} from './sdkTools';
import { completeWithTextStream } from './textStream';
import { mergeCostBreakdown, serializeToolOutput, toolOutputSummary } from './toolFeedback';
import { listLoopToolSpecs, llmToolName, loopPatchToolSpecs } from './tools/catalog';
import type { ToolResult } from './tools/execution';
import { sanitizeLoopToolArguments } from './tools/runtimeArguments';
import type { AgentToolTrace } from './traces';
import type { TokenUsage } from '../llm/contracts';

const PATCH_TOOL_NAMES: ReadonlySet<string> = new Set(
  loopPatchToolSpecs().map((spec) => spec.name),
);
const LLM_TO_REGISTRY = new Map(
  listLoopToolSpecs().map((spec) => [llmToolName(spec.name), spec.name]),
);
const SINGLE_PATCH_ERROR =
  '一次对话最多生成一个待确认修订：请先等作者处理当前修订，再发起新的修订或起草。';
/** SDK 在处理器之前就挡下的失败：处理器从没跑，证据与轨迹由这里补记。 */
const PRE_HANDLER_FAILURE_CODES = new Set([
  'invalid_arguments',
  'policy_denied',
  'runtime_budget',
  'tool_call_budget',
  'tool_not_available',
  'unknown_tool',
]);
const unknownToolMessage = (name: string) =>
  `未知工具：${name}，可用工具为 fs_list / fs_read / fs_search。`;

/** 循环用的模型：能否逐块回传正文决定作者看不看得到流式输出。 */
export interface LoopProvider {
  complete(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<StreamEvent>;
  readonly streaming: boolean;
}

/** 流开始吐字后才断开：建连阶段的失败传输层已经重试过，配置 / 鉴权类错误重发也没用。 */
export const STREAM_RETRY_LIMIT = 2;
const STREAM_RETRY_DELAY_SECONDS = 1;
const isStreamBreak = (error: unknown) =>
  error instanceof LlmError ||
  (error instanceof ProviderError &&
    (error.details.category === 'connection' ||
      error.details.category === 'timeout' ||
      error.details.providerCode === 'incomplete_text_stream'));

/** 每次派发前存一次「结果未知」检查点，响应回来后登记调用 id 与待记账费用。 */
export class StoryForgeProviderAdapter implements RuntimeProvider {
  constructor(
    private readonly provider: LoopProvider,
    private readonly context: StoryForgeRuntimeContext,
    private readonly checkpoints: StoryForgeCheckpointStore,
  ) {}

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const context = this.context;
    context.providerAttempts += 1;
    await this.checkpoints.modelStarted(request);
    let streamed: ChatResponse;
    for (let retryAttempt = 0; ; retryAttempt++) {
      const progress = { received: false };
      try {
        streamed = await completeWithTextStream(this.provider, request, {
          onText: context.onText,
          runId: context.run.public_id,
          roundIndex: context.completedModelRounds + 1,
          secrets: context.secrets,
          control: context.callControl,
          newStreamId: context.newStreamId,
          retryAttempt,
          progress,
        });
        break;
      } catch (error) {
        // 吐到一半断了整轮重发：作者端按 retry_attempt 丢掉半截正文；重发仍各自留请求证据。
        if (!progress.received || retryAttempt >= STREAM_RETRY_LIMIT || !isStreamBreak(error)) {
          if (error instanceof ProviderError) context.providerError = error;
          throw error;
        }
        context.streamRetries += 1;
        await context.callControl?.waitForRetry(STREAM_RETRY_DELAY_SECONDS);
      }
    }
    const response = context.rememberResponse(streamed);
    context.modelOutcomeUnknown = false;
    const rawBreakdown = response.metadata.cost_breakdown;
    const breakdown: Obj = isObj(rawBreakdown)
      ? { ...rawBreakdown }
      : costBreakdown(context.source, response.usage.toLegacy());
    const rawCost = Object.prototype.hasOwnProperty.call(response.metadata, 'cost_cny_estimated')
      ? response.metadata.cost_cny_estimated
      : breakdown.total_cny;
    const cost = rawCost instanceof JsonFloat ? rawCost.value : rawCost;
    context.pendingCosts.push([
      typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
      breakdown,
    ]);
    return response;
  }
}

/** 主循环自己的 token 与费用累计；嵌套调用各有自己的证据。 */
export class StoryForgeUsageSink implements UsageSink {
  constructor(private readonly context: StoryForgeRuntimeContext) {}

  record(_runId: string, _roundNumber: number, usage: TokenUsage): number | null {
    const context = this.context;
    const outcome = context.outcome;
    outcome.promptTokens += usage.inputTokens;
    outcome.completionTokens += usage.outputTokens;
    outcome.tokenUsage += usage.totalTokens;
    if (usage.source !== 'unavailable') {
      if (outcome.tokenUsageSource === 'unavailable') outcome.tokenUsageSource = usage.source;
      else if (outcome.tokenUsageSource !== usage.source) outcome.tokenUsageSource = 'mixed';
    }
    let estimated: unknown;
    let breakdown: Obj;
    if (context.pendingCosts.length) {
      [estimated, breakdown] = context.pendingCosts.shift()!;
    } else {
      // provider 报错时也可能带回真实用量，但没有响应侧的费用元数据。
      breakdown = costBreakdown(context.source, usage.toLegacy());
      estimated = breakdown.total_cny;
    }
    if (estimated === null || estimated === undefined) return null;
    const charge = estimated instanceof JsonFloat ? estimated.value : (estimated as number);
    outcome.costCnyEstimated = (outcome.costCnyEstimated ?? 0) + charge;
    outcome.costBreakdown = mergeCostBreakdown(outcome.costBreakdown, breakdown, {
      promptTokens: outcome.promptTokens,
      completionTokens: outcome.completionTokens,
      tokenUsageSource: outcome.tokenUsageSource,
    });
    return charge;
  }
}

const allow: PolicyDecision = { kind: 'allow', reason: null };
const deny = (reason: string): PolicyDecision => ({ kind: 'deny', reason });

/** 补丁一次一个；其余交给 run 已快照的权限档位裁决。放行的调用登记下来，处理器认领。 */
export class StoryForgeRuntimePolicy implements RuntimePolicy {
  constructor(private readonly context: StoryForgeRuntimeContext) {}

  decideTool(tool: RuntimeTool, call: PendingToolCall): PolicyDecision {
    const context = this.context;
    const registryName = String(tool.metadata.registry_name);
    if (PATCH_TOOL_NAMES.has(registryName) && context.writeBudgetExhausted)
      return deny(SINGLE_PATCH_ERROR);
    const definition = context.definitions.get(registryName)!;
    const decision = gateDecide(
      context.run.permission_profile,
      definition,
      sanitizeLoopToolArguments({ ...call.arguments }),
    );
    if (decision.status === 'deny')
      return deny(`权限策略阻止工具 ${registryName}：${decision.reason}`);
    if (decision.status === 'require_approval' && !decision.allows_pending_artifact)
      return deny(`工具 ${registryName} 需要先获得权限确认：${decision.reason}`);
    context.allowCall(tool.spec.name, call.callId);
    return allow;
  }

  shouldRetry(tool: RuntimeTool, retryable: boolean, attempt: number): boolean {
    return tool.retrySafe && tool.idempotent && retryable && attempt < 2;
  }

  canResumeStartedTool(tool: RuntimeTool, call: PendingToolCall): boolean {
    return tool.retrySafe && tool.idempotent && this.decideTool(tool, call).kind === 'allow';
  }
}

/** 已有待确认补丁时撤下所有产补丁的工具。 */
export class StoryForgeToolSelector implements ToolSelector {
  select(registry: ToolRegistry, context: unknown): readonly RuntimeTool[] {
    if (!(context instanceof StoryForgeRuntimeContext) || !context.writeBudgetExhausted)
      return registry.all();
    return registry.all().filter((tool) => tool.metadata.patch_tool !== true);
  }
}

/** 工具结果回给模型的文本：成功给输出，失败给作者能看懂的一句话。 */
export class StoryForgeFeedbackFormatter implements ToolFeedbackFormatter {
  format(result: RuntimeToolResult, input: FeedbackInput): string {
    const context = input.context instanceof StoryForgeRuntimeContext ? input.context : null;
    if (result.status === 'success') return serializeToolOutput(result.toOutput());
    let message = result.errorMessage || '工具执行失败。';
    if (result.errorCode === 'unknown_tool') message = unknownToolMessage(input.call.name);
    else if (
      result.errorCode === 'tool_not_available' &&
      context !== null &&
      context.writeBudgetExhausted &&
      input.tool !== null &&
      input.tool.metadata.patch_tool === true
    )
      message = SINGLE_PATCH_ERROR;
    else if (result.errorCode === 'invalid_arguments') message = `工具参数解析失败：${message}`;
    return dumpJson({ error: message }, { ensureAscii: false });
  }
}

/** 模型给的参数原文按标准 JSON 读（§4.3.1），读不出就当没有参数。 */
function safeArguments(argumentsJson: string): Obj {
  try {
    const payload = parseJson(argumentsJson || '{}', 'tool arguments');
    return sanitizeLoopToolArguments(isJsonObject(payload) ? payload : {});
  } catch {
    return {};
  }
}

function failureMessage(
  code: string,
  call: ToolCall,
  registryName: string | null,
  context: StoryForgeRuntimeContext,
): string {
  if (registryName === null) return unknownToolMessage(call.name);
  if (code === 'tool_not_available' && context.writeBudgetExhausted) return SINGLE_PATCH_ERROR;
  if (code === 'invalid_arguments')
    return '工具参数解析失败：工具参数不是有效 JSON 对象或不符合 ToolSpec。';
  if (code === 'runtime_budget') return '工具输出预算已用完。';
  if (code === 'tool_call_budget') return '工具调用预算已用完。';
  const decision = gateDecide(
    context.run.permission_profile,
    context.definitions.get(registryName)!,
    safeArguments(call.argumentsJson),
  );
  if (decision.status === 'deny') return `权限策略阻止工具 ${registryName}：${decision.reason}`;
  if (decision.status === 'require_approval' && !decision.allows_pending_artifact)
    return `工具 ${registryName} 需要先获得权限确认：${decision.reason}`;
  return '工具执行失败。';
}

/** 处理器之前就被挡下的调用照样进证据链与流程树，作者看得到为什么没执行。 */
export class StoryForgeRunTracer implements RunTracer {
  constructor(private readonly context: StoryForgeRuntimeContext) {}

  async emit(event: RuntimeTraceEvent): Promise<void> {
    if (event.kind !== 'tool_failed') return;
    const context = this.context;
    const code = String(event.payload.code || '');
    const callId = String(event.payload.tool_call_id || '');
    if (!PRE_HANDLER_FAILURE_CODES.has(code) || context.handledCallIds.has(callId)) return;
    const call = context.callsById.get(callId);
    if (call === undefined) return;
    const registryName = exposedRegistryName(context, call.name);
    const message = failureMessage(code, call, registryName, context);
    if (registryName === null) {
      await context.recordTrace(
        {
          tool_name: call.name || 'unknown',
          status: 'failed',
          input_summary: { arguments: cpSlice(call.argumentsJson, 500) },
          error_message: message,
        },
        callId,
      );
      return;
    }
    const safe = safeArguments(call.argumentsJson);
    const evidence = await context.assistant.createToolCall(context.assistantSessionId, {
      tool_name: registryName,
      status: 'running',
      input_summary: safe,
    });
    await context.assistant.updateToolCall(evidence.id, {
      status: 'failed',
      error_message: cpSlice(message, 4000),
    });
    await context.recordTrace(
      {
        tool_name: registryName,
        status: 'failed',
        input_summary: safe,
        error_message: message,
        assistant_tool_call_id: evidence.id,
      },
      callId,
    );
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 一次循环工具调用：证据先记 running，再按处理器结果收尾；领域错误回给模型，不打断循环。 */
async function executeLoopTool(
  context: StoryForgeRuntimeContext,
  registryName: string,
  llmName: string,
  args: Obj,
): Promise<RuntimeToolResult> {
  const call = context.claimAllowedCall(llmName);
  const callId = call === null ? null : call.id;
  const safe = sanitizeLoopToolArguments({ ...args });
  const evidence = await context.assistant.createToolCall(context.assistantSessionId, {
    tool_name: registryName,
    status: 'running',
    input_summary: safe,
  });
  const deliveryUpdates: Promise<unknown>[] = [];
  const deliveries = new GenerationDeliveryCapture((refs) => {
    deliveryUpdates.push(
      context.assistant.updateToolCall(evidence.id, {
        input_summary: { ...safe, generation_delivery_refs: refs },
      }),
    );
  });
  const bound = () => deliveries.bind(safe as { [key: string]: PlainJson }) as Obj;
  let result: ToolResult;
  try {
    try {
      result = await context.executeTool(registryName, { ...args }, deliveries);
    } finally {
      await Promise.all(deliveryUpdates);
    }
  } catch (error) {
    if (error instanceof RunInterrupted) {
      // 已开始却没有结果的调用不算完成、也不可重试：把「结果未知」留在证据里，SDK 保留未决检查点。
      const summary = { execution_state: 'unknown', interruption_reason: error.reason };
      await context.assistant.updateToolCall(evidence.id, {
        status: 'paused',
        input_summary: bound(),
        output_summary: summary,
      });
      await context.recordTrace(
        {
          tool_name: registryName,
          status: 'paused',
          input_summary: bound(),
          output_summary: summary,
          assistant_tool_call_id: evidence.id,
        },
        callId,
      );
      throw error;
    }
    const text = cpSlice(errorText(error), 500);
    await context.assistant.updateToolCall(evidence.id, {
      status: 'failed',
      input_summary: bound(),
      error_message: cpSlice(text, 4000),
    });
    await context.recordTrace(
      {
        tool_name: registryName,
        status: 'failed',
        input_summary: bound(),
        error_message: text,
        assistant_tool_call_id: evidence.id,
      },
      callId,
    );
    return RuntimeToolResult.failure('storyforge_tool_error', text);
  }
  const output = result.output;
  const artifacts = result.artifacts ?? [];
  context.outcome.artifacts.push(...artifacts);
  const feedback = loopToolFeedback(registryName, output, PATCH_TOOL_NAMES);
  if (feedback.reviewReport !== null) context.outcome.reviewReport = feedback.reviewReport;
  if (feedback.patchProposal !== null) context.outcome.patchProposal = feedback.patchProposal;
  const handlerOwned = context.definitions.get(registryName)!.loop_trace_owner === 'handler';
  const handlerSummary = result.trace.output_summary;
  const outputSummary =
    handlerOwned && handlerSummary !== null && handlerSummary !== undefined
      ? handlerSummary
      : toolOutputSummary(registryName, output);
  await context.assistant.updateToolCall(evidence.id, {
    status: 'completed',
    input_summary: bound(),
    output_summary: outputSummary,
  });
  const trace: AgentToolTrace = {
    tool_name: registryName,
    status: 'completed',
    input_summary: deliveries.bind(
      (handlerOwned ? result.trace.input_summary : safe) as { [key: string]: PlainJson },
    ) as Obj,
    output_summary: outputSummary,
    audit_event_id: handlerOwned ? (result.trace.audit_event_id ?? null) : null,
    assistant_tool_call_id: evidence.id,
  };
  await context.recordTrace(trace, callId);
  return RuntimeToolResult.success(
    feedback.content as JsonObject,
    artifacts.map((artifact) => runtimeArtifact(artifact.kind, artifact.payload as JsonObject)),
  );
}

/** 这一轮交给模型的循环工具：skill.read 只在可用技能里有插件技能时才给。 */
const offeredLoopToolSpecs = (context: StoryForgeRuntimeContext) =>
  listLoopToolSpecs().filter((spec) => spec.name !== 'skill.read' || context.pluginSkills);

/** 没交给模型的工具当未知工具处理，与它不存在时一样。 */
function exposedRegistryName(context: StoryForgeRuntimeContext, llmName: string): string | null {
  const registryName = LLM_TO_REGISTRY.get(llmName) ?? null;
  return registryName === 'skill.read' && !context.pluginSkills ? null : registryName;
}

/** 循环工具按声明顺序装进 SDK 注册表；漏注册的处理器启动即报错。 */
export function buildStoryforgeToolRegistry(context: StoryForgeRuntimeContext): ToolRegistry {
  return new ToolRegistry(
    offeredLoopToolSpecs(context).map((spec) => {
      if (!context.definitions.has(spec.name))
        throw new Error(`StoryForge loop tool is not registered: ${spec.name}`);
      const exposed = llmToolName(spec.name);
      return runtimeTool(
        new ToolSpec(exposed, spec.loop_schema!.description, { ...spec.loop_schema!.parameters }),
        (application, args) =>
          executeLoopTool(
            application instanceof StoryForgeRuntimeContext ? application : context,
            spec.name,
            exposed,
            args,
          ),
        {
          retrySafe: spec.retry_safe,
          idempotent: spec.idempotent,
          metadata: { registry_name: spec.name, patch_tool: PATCH_TOOL_NAMES.has(spec.name) },
        },
      );
    }),
  );
}

/** SDK 的每个边界都问同一个运行控制：暂停 / 停止 / 截止时间。 */
export function interruptionCheck(context: StoryForgeRuntimeContext): InterruptionCheck {
  return (_runId, boundary) => {
    try {
      context.callControl!.check(boundary);
    } catch (error) {
      if (error instanceof RunInterrupted) return error.reason;
      throw error;
    }
    return null;
  };
}

export { PATCH_TOOL_NAMES, SINGLE_PATCH_ERROR };
