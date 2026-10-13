import { cloneJson, type JsonObject, type JsonValue } from '../kernel/json';
import type { ChatRequest } from '../llm/contracts';
import type { ChatLoopOutcome } from './chatLoopTypes';
import type { StoryForgeRuntimeContext } from './chatLoopContext';
import type { CheckpointStore } from './sdkPorts';
import { RuntimeCheckpoint } from './sdkState';
import { traceAsDict } from './traces';

type Obj = { [key: string]: unknown };
type CheckpointFields = ConstructorParameters<typeof RuntimeCheckpoint>[0];

/**
 * 一次保存下来的循环检查点：SDK 快照连同 StoryForge 侧的结果累计与派发状态。
 * 只留在引擎内存里（§2.6：重启后不续跑，所以从不落库）；暂停后的续跑与来源核对随 P3-5c。
 */
export type SavedLoopCheckpoint = {
  readonly checkpoint: RuntimeCheckpoint;
  readonly assistantSessionId: number;
  readonly permissionProfile: string;
  readonly resumeMessage: Obj;
  readonly outcome: Obj;
  readonly dispatchState: 'checkpointed' | 'model_outcome_unknown';
};

/** 按 run 保存最近的检查点；P3-5c 的续跑从这里取。 */
export class LoopCheckpointStore {
  private readonly saved = new Map<string, SavedLoopCheckpoint[]>();

  append(runId: string, item: SavedLoopCheckpoint): void {
    const list = this.saved.get(runId) ?? [];
    list.push(item);
    this.saved.set(runId, list);
  }

  latest(runId: string): SavedLoopCheckpoint | null {
    const list = this.saved.get(runId);
    return list && list.length ? list[list.length - 1] : null;
  }

  /** 测试与对账用：某个 run 的全部保存记录。 */
  history(runId: string): readonly SavedLoopCheckpoint[] {
    return [...(this.saved.get(runId) ?? [])];
  }
}

const OUTCOME_FIELDS: [string, (outcome: ChatLoopOutcome) => unknown][] = [
  ['rounds', (o) => o.rounds],
  ['tool_call_count', (o) => o.toolCallCount],
  ['completion_tokens', (o) => o.completionTokens],
  ['prompt_tokens', (o) => o.promptTokens],
  ['token_usage', (o) => o.tokenUsage],
  ['token_usage_source', (o) => o.tokenUsageSource],
  ['cost_cny_estimated', (o) => o.costCnyEstimated],
  ['cost_breakdown', (o) => o.costBreakdown],
  ['review_report', (o) => o.reviewReport],
];

/** 结果累计的可恢复快照（字段与 Python checkpoint payload 的 outcome 一致）。 */
export function outcomePayload(outcome: ChatLoopOutcome): Obj {
  const result: Obj = Object.fromEntries(
    OUTCOME_FIELDS.map(([name, read]) => [name, read(outcome)]),
  );
  result.traces = outcome.traces.map(traceAsDict);
  result.proposed_patch = outcome.proposedPatch;
  result.artifacts = outcome.artifacts.map((artifact) => ({
    kind: artifact.kind,
    payload: artifact.payload,
    requires_confirmation: artifact.requires_confirmation,
  }));
  return cloneJson(result as JsonObject);
}

/** SDK 的检查点端口：每次保存同时记下结果累计；发模型请求前先存一次「结果未知」。 */
export class StoryForgeCheckpointStore implements CheckpointStore {
  constructor(
    private readonly context: StoryForgeRuntimeContext,
    private readonly store: LoopCheckpointStore,
  ) {}

  save(checkpoint: RuntimeCheckpoint): void {
    const context = this.context;
    if (checkpoint.runId !== context.run.public_id) throw new Error('checkpoint_identity_mismatch');
    this.store.append(checkpoint.runId, {
      checkpoint,
      assistantSessionId: context.assistantSessionId,
      permissionProfile: context.run.permission_profile,
      resumeMessage: cloneJson(context.recoveryMessage as JsonValue) as Obj,
      outcome: outcomePayload(context.outcome),
      dispatchState: context.modelOutcomeUnknown ? 'model_outcome_unknown' : 'checkpointed',
    });
    context.latestCheckpoint = checkpoint;
  }

  modelStarted(request: ChatRequest): void {
    const context = this.context;
    context.modelOutcomeUnknown = true;
    const base: CheckpointFields = context.latestCheckpoint ?? {
      runId: context.run.public_id,
      model: request.model,
      phase: 'before_model',
      messages: request.messages,
      roundCount: 0,
      toolAttempts: 0,
      toolOutputChars: 0,
      totalTokens: 0,
      totalCost: null,
      usageAvailable: false,
      costAvailable: false,
      pending: null,
      completedToolCallIds: [],
      artifacts: [],
      exhausted: false,
      sequence: 0,
      interruptionReason: null,
      continuationOmitted: false,
    };
    this.save(
      new RuntimeCheckpoint({
        ...base,
        messages: request.messages,
        phase: 'before_model',
        roundCount: context.providerAttempts,
      }),
    );
  }

  load(): null {
    // 续跑随 P3-5c；在那之前循环从不以续跑方式启动。
    return null;
  }
}
