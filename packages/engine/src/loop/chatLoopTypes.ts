import { pythonTruthy, type JsonValue } from '../kernel/json';
import type { AgentExecutionOutcome } from './runPayloads';
import { reviewFeedback, reviseFeedback } from './toolFeedback';
import type { ToolArtifact } from './tools/execution';
import type { AgentToolTrace } from './traces';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 补丁的线上载荷原样保留；循环只关心它要不要等作者点接受。 */
export class PatchProposal {
  private constructor(
    private readonly wire: Obj,
    readonly requiresConfirmation: boolean,
  ) {}

  static fromPayload(payload: Obj): PatchProposal {
    const flag = Object.prototype.hasOwnProperty.call(payload, 'requires_confirmation')
      ? pythonTruthy(payload.requires_confirmation as JsonValue)
      : true;
    return new PatchProposal({ ...payload }, flag);
  }

  toPayload(): Obj {
    return { ...this.wire };
  }
}

/** 只回给模型摘要的检查类工具：正文与明细留在证据里。 */
const SUMMARY_ONLY_TOOLS = new Set([
  'project.collapse_check',
  'project.entity_budget_check',
  'project.promise_check',
  'project.canon_delta',
  'project.hooks_delta',
]);

export type LoopToolFeedback = {
  readonly content: Obj;
  readonly reviewReport: Obj | null;
  readonly patchProposal: PatchProposal | null;
};

export function loopToolFeedback(
  registryName: string,
  output: Obj,
  patchTools: ReadonlySet<string>,
): LoopToolFeedback {
  if (registryName === 'file.review')
    return {
      content: reviewFeedback(output),
      reviewReport: isObj(output.review_report) ? output.review_report : null,
      patchProposal: null,
    };
  if (SUMMARY_ONLY_TOOLS.has(registryName))
    return {
      content: { summary: output.summary ?? null },
      reviewReport: null,
      patchProposal: null,
    };
  if (patchTools.has(registryName)) {
    const raw = output.proposed_patch;
    return {
      content: reviseFeedback(output),
      reviewReport: null,
      patchProposal: isObj(raw) ? PatchProposal.fromPayload(raw) : null,
    };
  }
  return { content: output, reviewReport: null, patchProposal: null };
}

/** 一轮 chat 循环交给上层的结果：回答、轨迹、用量、补丁与中断事实。 */
export class ChatLoopOutcome {
  traces: AgentToolTrace[] = [];
  rounds = 0;
  toolCallCount = 0;
  completionTokens = 0;
  promptTokens = 0;
  tokenUsage = 0;
  tokenUsageSource = 'unavailable';
  // 只记主循环自己的模型费用；工具内嵌的调用各有证据。非空小计不代表每一轮的费用都拿到了。
  costCnyEstimated: number | null = null;
  costBreakdown: Obj = {};
  exhausted = false;
  executionOutcome: AgentExecutionOutcome | null = null;
  /** 模型调用失败的原始原因（传输层已脱敏），只进证据，不进回话。 */
  failureDetail: string | null = null;
  reviewReport: Obj | null = null;
  patchProposal: PatchProposal | null = null;
  interrupted = false;
  interruption: Obj | null = null;
  artifacts: ToolArtifact[] = [];

  constructor(public answer = '') {}

  get proposedPatch(): Obj | null {
    return this.patchProposal === null ? null : this.patchProposal.toPayload();
  }

  set proposedPatch(payload: Obj | null) {
    this.patchProposal = payload === null ? null : PatchProposal.fromPayload(payload);
  }

  markFailed(code: string, message: string): void {
    const partial =
      this.traces.some((trace) => trace.status === 'completed') || this.artifacts.length > 0;
    this.answer = `本轮未完成：${Array.from(message).slice(0, 300).join('')}`;
    if (partial) this.answer += ' 已完成的结果已保留。';
    this.executionOutcome = {
      status: partial ? 'partial' : 'failed',
      code,
      message: this.answer,
    };
    const patch = this.proposedPatch;
    if (patch !== null) {
      // 失败的轮次里补丁一律退回逐次确认，自动档也不落盘。
      this.proposedPatch = { ...patch, requires_confirmation: true };
      this.artifacts = this.artifacts.map((item) =>
        item.kind === 'proposed_patch'
          ? {
              kind: item.kind,
              payload: { ...item.payload, requires_confirmation: true },
              requires_confirmation: true,
            }
          : item,
      );
    }
  }
}
