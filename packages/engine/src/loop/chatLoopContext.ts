import type { AssistantStore } from '../assistant/service';
import type { GenerationDeliveryCapture } from '../kernel/generationDelivery';
import type { Obj } from '../kernel/json';
import type { SecretContext } from '../kernel/redaction';
import type { LlmSource } from '../llm/config';
import { ToolCall, type ChatResponse, type ProviderError } from '../llm/contracts';
import type { RunControl } from '../llm/control';
import type { RecoverySources } from './chatLoopCheckpoints';
import type { ChatLoopOutcome } from './chatLoopTypes';
import type { InterruptionCallback } from './runControl';
import type { RuntimeCheckpoint } from './sdkState';
import type { TextObserver } from './textStream';
import type { ToolDefinition, ToolResult } from './tools/execution';
import type { AgentToolTrace } from './traces';

/**
 * 执行一个循环工具：参数已由模型给出、尚未清洗；路径、正文与可信上下文由执行方补。
 * deliveries 收集嵌套 writer 的送达回执（Python 经 ContextVar 隐式传递）。
 */
export type LoopToolExecutor = (
  registryName: string,
  args: Obj,
  deliveries: GenerationDeliveryCapture,
) => Promise<ToolResult>;

export type TraceCallback = (trace: AgentToolTrace) => void | Promise<void>;

/** 循环看到的 run：档位快照与身份。 */
export type LoopRunView = {
  readonly public_id: string;
  readonly permission_profile: string;
  /** 续跑时是 'resumed'（控制通道认领后写下）。 */
  readonly current_step?: string | null;
  readonly assistant_session_id?: number | null;
};

export type RuntimeContextFields = {
  readonly assistant: AssistantStore;
  readonly assistantSessionId: number;
  readonly run: LoopRunView;
  readonly source: LlmSource;
  readonly secrets: SecretContext;
  readonly definitions: ReadonlyMap<string, ToolDefinition>;
  readonly executeTool: LoopToolExecutor;
  readonly onTrace: TraceCallback;
  readonly outcome: ChatLoopOutcome;
  readonly onText: TextObserver | null;
  readonly shouldInterrupt: InterruptionCallback | null;
  readonly recoveryMessage: Obj;
  readonly newStreamId: () => string;
  /** 这一轮的可用技能里有插件技能：只有这时才把 skill_read 交给模型。 */
  readonly pluginSkills?: boolean;
};

/** StoryForge 适配器在一次 SDK 运行里共享的可变状态。 */
export class StoryForgeRuntimeContext {
  readonly assistant: AssistantStore;
  readonly assistantSessionId: number;
  readonly run: LoopRunView;
  readonly source: LlmSource;
  readonly secrets: SecretContext;
  readonly definitions: ReadonlyMap<string, ToolDefinition>;
  readonly executeTool: LoopToolExecutor;
  readonly onTrace: TraceCallback;
  readonly outcome: ChatLoopOutcome;
  readonly onText: TextObserver | null;
  readonly shouldInterrupt: InterruptionCallback | null;
  readonly recoveryMessage: Obj;
  readonly newStreamId: () => string;
  readonly pluginSkills: boolean;

  modelOutcomeUnknown = false;
  providerAttempts = 0;
  /** 输出途中断开后整轮重发的次数（不算轮次）。 */
  streamRetries = 0;
  /** 让本轮失败的那个 provider 错误（SDK 只往上报分类与安全摘要）。 */
  providerError: ProviderError | null = null;
  completedModelRounds = 0;
  interruption: Obj | null = null;
  latestCheckpoint: RuntimeCheckpoint | null = null;
  /** 本轮读过文件的指纹（第一次读到时记下，续跑时原样恢复）。 */
  recoverySources: RecoverySources | null = null;
  callControl: RunControl | null = null;
  handledCallIds = new Set<string>();
  callsById = new Map<string, ToolCall>();
  private readonly allowedCallIds = new Map<string, string[]>();
  readonly pendingCosts: [number | null, Obj][] = [];

  constructor(fields: RuntimeContextFields) {
    this.assistant = fields.assistant;
    this.assistantSessionId = fields.assistantSessionId;
    this.run = fields.run;
    this.source = fields.source;
    this.secrets = fields.secrets;
    this.definitions = fields.definitions;
    this.executeTool = fields.executeTool;
    this.onTrace = fields.onTrace;
    this.outcome = fields.outcome;
    this.onText = fields.onText;
    this.shouldInterrupt = fields.shouldInterrupt;
    this.recoveryMessage = fields.recoveryMessage;
    this.newStreamId = fields.newStreamId;
    this.pluginSkills = fields.pluginSkills ?? false;
  }

  /** 每一轮（作者发一句话）最多一个待确认补丁。 */
  get writeBudgetExhausted(): boolean {
    return this.outcome.patchProposal !== null;
  }

  /** 给模型的工具调用补齐 / 去重 id，并记下这一轮。 */
  rememberResponse(response: ChatResponse): ChatResponse {
    const normalized = response.toolCalls.map((call) => {
      let callId = call.id || `call_${this.outcome.toolCallCount}`;
      while (this.callsById.has(callId)) callId = `${callId}_${this.outcome.toolCallCount}`;
      const item = new ToolCall(callId, call.name, call.argumentsJson, call.type);
      this.callsById.set(callId, item);
      this.outcome.toolCallCount += 1;
      return item;
    });
    this.completedModelRounds += 1;
    return { ...response, toolCalls: normalized };
  }

  allowCall(llmName: string, callId: string): void {
    const queue = this.allowedCallIds.get(llmName) ?? [];
    queue.push(callId);
    this.allowedCallIds.set(llmName, queue);
  }

  claimAllowedCall(llmName: string): ToolCall | null {
    const queue = this.allowedCallIds.get(llmName);
    if (!queue || queue.length === 0) return null;
    return this.callsById.get(queue.shift()!) ?? null;
  }

  async recordTrace(trace: AgentToolTrace, callId: string | null = null): Promise<void> {
    this.outcome.traces.push(trace);
    await this.onTrace(trace);
    if (callId) this.handledCallIds.add(callId);
  }
}
