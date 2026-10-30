import type { AssistantStore } from '../assistant/service';
import type { SecretContext } from '../kernel/redaction';
import type { ProjectReader } from '../readPort';
import { pythonTruthy, type JsonValue } from '../kernel/json';
import { revisionReferencesReview } from '../kernel/reviseScope';
import type { RunRecord, RunStore } from '../store/runs';
import { isChapterResume, resumeChapterWriting, startChapterBrief } from './chapterWritingPipeline';
import type { ConversationSources } from './conversationHistory';
import { currentConversationReview } from './reviewSources';
import { planStep, runtimeInterruptedResponse, type AgentRunEventSink } from './runEvents';
import { AgentOrchestrationError, roleHints, roleMentions } from './runPayloads';
import type { ToolArtifact, ToolExecutionContext, ToolResult } from './tools/execution';
import {
  buildRuntimePendingCallResolutionPayload,
  buildRuntimePendingCallSummary,
  RUNTIME_PENDING_CALL_ARTIFACT_KIND,
  RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
  traceAsDict,
  traceObjects,
  type AgentToolTrace,
} from './traces';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const truthy = (value: unknown) => pythonTruthy(value as JsonValue);

type ArtifactRow = { readonly id: number; readonly kind: string; readonly payload: Obj };

/** 固定管线要用到的运行时能力（Python 里是 AgentRuntime 的 mixin 方法）。 */
export interface FixedPipelineHost {
  readonly sink: AgentRunEventSink;
  readonly store: RunStore;
  readonly assistant: AssistantStore;
  readonly conversation: ConversationSources;
  readonly reader: ProjectReader;
  readonly platform: 'windows' | 'posix';
  readonly secrets: SecretContext;
  /** 本机插件库根目录；缺省或 null 是没有插件（写章不带插件的写法与要求）。 */
  readonly pluginLibraryRoot?: string | null;
  /** 补丁 id（Python 的 uuid4().hex）。 */
  newHex(): string;
  /** 先过中断边界与权限门，再在工具自己的模型操作范围里跑处理器。 */
  executeTool(
    run: RunRecord,
    toolName: string,
    context: ToolExecutionContext,
    payload: Obj,
  ): Promise<ToolResult>;
  toolContext(
    run: RunRecord,
    request: FixedPipelineRequest,
    currentReviewReport?: Obj | null,
  ): Promise<ToolExecutionContext>;
  runtimeInterruption(run: RunRecord, boundary: string): Obj | null;
  /** 送达前的中断检查（runtime_delivery.check_result_delivery）：被打断时返回改写后的结果。 */
  checkResultDelivery(result: Obj, boundary: string, eventsRecorded: boolean): Obj | null;
  baseResponse(fields: {
    agentSessionId: string;
    assistantSessionId: number;
    intent: string;
    userMessage: string;
    plan: Obj[];
    agentResult: Obj;
    toolTrace: readonly AgentToolTrace[];
    proposedPatch?: Obj | null;
    roleHints?: string[];
    roleMentions?: string[];
    toolArtifacts?: readonly ToolArtifact[];
  }): Obj;
}

export type FixedPipelineRequest = {
  readonly run: RunRecord;
  readonly agentSessionId: string;
  readonly assistantSessionId: number;
  readonly userMessage: string;
  readonly args: Obj;
  readonly intent: string;
};

/** 本 run 最近一个仍待恢复的未决调用；碰到已消费的记录就说明没有。 */
export async function latestRuntimePendingCall(
  store: RunStore,
  run: RunRecord,
  intent: string | null = null,
): Promise<ArtifactRow | null> {
  const rows = (await store.artifacts(run.id))
    .filter(
      (row) =>
        row.kind === RUNTIME_PENDING_CALL_ARTIFACT_KIND ||
        row.kind === RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
    )
    .sort((left, right) => right.id - left.id);
  for (const row of rows) {
    if (row.kind === RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND) return null;
    const summary = buildRuntimePendingCallSummary(row.payload, row.id, row.kind);
    if (summary !== null && (intent === null || summary.intent === intent))
      return row as ArtifactRow;
  }
  return null;
}

const shouldResumePendingCall = (run: RunRecord, pending: ArtifactRow | null) =>
  pending !== null && run.status === 'running' && run.current_step === 'resumed';

function resolutionArtifact(pending: ArtifactRow): ToolArtifact {
  return {
    kind: RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
    payload: buildRuntimePendingCallResolutionPayload(pending.payload, pending.id, pending.kind),
    requires_confirmation: false,
  };
}

const roles = (args: Obj) => ({ roleHints: roleHints(args), roleMentions: roleMentions(args) });

// ---- 审稿（file_review_pipeline） ----

const REVIEW_STEPS = {
  context: '读取当前章与项目上下文。',
  review: '剧情、人物、文风和连续性子代理完成同步审稿。',
  merge: '合并多视角意见为结构化审稿报告。',
};

function fileReviewResumeMessage(result: Obj, projectPath: string | null): Obj {
  const traces = Array.isArray(result.tool_trace) ? result.tool_trace : [];
  const contextTrace = traces.length ? traces[0] : {};
  const input = isObj(contextTrace) ? contextTrace.input_summary : {};
  const filePath = isObj(input) ? input.file_path : null;
  return {
    type: 'user_message',
    run_id: result.run_id ?? null,
    user_message: result.user_message ?? null,
    intent: 'file.review',
    assistant_session_id: result.assistant_session_id ?? null,
    args: {
      project_path: projectPath,
      file_path: typeof filePath === 'string' ? filePath : null,
      agent_role_hints: Array.isArray(result.agent_role_hints) ? result.agent_role_hints : [],
      agent_role_mentions: Array.isArray(result.agent_role_mentions)
        ? result.agent_role_mentions
        : [],
    },
  };
}

const jsonSafeReviewOutput = (output: Obj): Obj => ({
  ...output,
  traces: (Array.isArray(output.traces) ? output.traces : []).map((trace) =>
    isObj(trace) && typeof trace.tool_name === 'string'
      ? traceAsDict(trace as AgentToolTrace)
      : trace,
  ),
});

async function recordFileReviewPendingCall(
  host: FixedPipelineHost,
  run: RunRecord,
  fields: {
    partial: Obj;
    contextOutput: Obj;
    interruption: Obj;
    reviewOutput?: Obj | null;
    nextTraceIndex?: number | null;
  },
): Promise<void> {
  const { partial, interruption } = fields;
  if (interruption.status !== 'paused') return;
  let boundary = interruption.boundary;
  if (typeof boundary !== 'string' || !boundary) boundary = 'after_tool:context.load';
  const session =
    run.assistant_session_id === null || run.assistant_session_id === undefined
      ? null
      : await host.assistant.getSession(run.assistant_session_id);
  const traces = Array.isArray(partial.tool_trace) ? partial.tool_trace : [];
  const payload: Obj = {
    kind: RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    intent: 'file.review',
    boundary,
    status: 'pending',
    resume_message: fileReviewResumeMessage(partial, session ? session.project_path : null),
    context_output: fields.contextOutput,
    context_trace: traces.length ? traces[0] : null,
    interruption,
    resume_strategy:
      boundary === 'after_tool:context.load'
        ? 'continue_after_context_load'
        : 'continue_file_review_postprocess',
  };
  if (fields.reviewOutput) payload.review_output = jsonSafeReviewOutput(fields.reviewOutput);
  if (fields.nextTraceIndex !== undefined && fields.nextTraceIndex !== null)
    payload.next_trace_index = fields.nextTraceIndex;
  await host.sink.recordRuntimePendingCall(run, payload);
}

/** 被打断的送达：暂停留下可恢复的未决调用；停止 / 超时补记已完成的轨迹，停止时保住只读报告。 */
async function preserveInterruptedFileReview(
  host: FixedPipelineHost,
  run: RunRecord,
  result: Obj,
  reviewOutput: Obj,
  contextOutput: Obj,
  nextTraceIndex: number,
): Promise<Obj> {
  const interruption = result.runtime_interruption;
  if (isObj(interruption) && interruption.status === 'paused')
    await recordFileReviewPendingCall(host, run, {
      partial: result,
      contextOutput,
      interruption,
      reviewOutput,
      nextTraceIndex,
    });
  else {
    // 这些是已完成的观察，不是新的审稿派发。
    const traces = traceObjects({ tool_trace: reviewOutput.traces });
    for (let index = nextTraceIndex; index <= traces.length; index++)
      await host.sink.recordToolTrace(run, traces[index - 1], index);
    if (interruption !== undefined && interruption !== null)
      await host.sink.recordArtifact(run, {
        kind: 'review_report',
        payload: reviewOutput.review_report as Obj,
        requiresConfirmation: false,
      });
  }
  return result;
}

async function deliverFileReview(
  host: FixedPipelineHost,
  run: RunRecord,
  result: Obj,
  reviewOutput: Obj,
  contextOutput: Obj,
  startIndex = 1,
): Promise<Obj> {
  const traces = traceObjects({ tool_trace: reviewOutput.traces });
  for (let index = startIndex; index <= traces.length; index++) {
    const trace = traces[index - 1];
    await host.sink.recordToolTrace(run, trace, index);
    const interrupted = host.checkResultDelivery(result, `after_tool:${trace.tool_name}`, true);
    if (interrupted !== null)
      return preserveInterruptedFileReview(
        host,
        run,
        interrupted,
        reviewOutput,
        contextOutput,
        index + 1,
      );
  }
  const interrupted = host.checkResultDelivery(result, 'before_deliver:file.review', true);
  if (interrupted !== null)
    return preserveInterruptedFileReview(
      host,
      run,
      interrupted,
      reviewOutput,
      contextOutput,
      traces.length + 1,
    );
  // 只有送达才写对话历史；已完成的审稿证据可以停在暂停 / 失败，而不冒称已送达。
  const sessionId = result.assistant_session_id as number;
  await host.assistant.appendMessage(sessionId, {
    role: 'user',
    content: String(result.user_message),
  });
  await host.assistant.appendMessage(sessionId, {
    role: 'assistant',
    content: String((result.agent_result as Obj).summary),
  });
  result._events_recorded = true;
  return result;
}

async function resumeFileReview(
  host: FixedPipelineHost,
  request: FixedPipelineRequest,
  pending: ArtifactRow,
): Promise<Obj> {
  const { run, args } = request;
  const payload = isObj(pending.payload) ? pending.payload : {};
  const contextOutput = isObj(payload.context_output) ? payload.context_output : {};
  const contextTrace = traceObjects({
    tool_trace: [isObj(payload.context_trace) ? payload.context_trace : {}],
  });
  const reviewOutput = isObj(payload.review_output) ? payload.review_output : null;
  const response = (fields: {
    reviewText: string;
    agentResult: Obj;
    toolTrace: AgentToolTrace[];
    toolArtifacts: ToolArtifact[];
  }) =>
    host.baseResponse({
      agentSessionId: request.agentSessionId,
      assistantSessionId: request.assistantSessionId,
      intent: 'file.review',
      userMessage: request.userMessage,
      plan: [
        planStep('context.load', REVIEW_STEPS.context, 'completed'),
        planStep('subagents.review', fields.reviewText, 'completed'),
        planStep('synthesizer.merge', REVIEW_STEPS.merge, 'completed'),
      ],
      agentResult: fields.agentResult,
      toolTrace: fields.toolTrace,
      ...roles(args),
      toolArtifacts: fields.toolArtifacts,
    });
  if (reviewOutput !== null) {
    const reviewTraces = traceObjects({ tool_trace: reviewOutput.traces });
    const result = response({
      reviewText: '从 pending boundary 继续，补齐剩余审稿事件。',
      agentResult: {
        summary: reviewOutput.summary,
        requires_user_confirmation: false,
        review_report: reviewOutput.review_report,
        resumed_from_pending_call: true,
        pending_call_artifact_id: pending.id,
        resumed_from_boundary: payload.boundary ?? null,
      },
      toolTrace: [...contextTrace, ...reviewTraces],
      toolArtifacts: [
        {
          kind: 'review_report',
          payload: reviewOutput.review_report as Obj,
          requires_confirmation: false,
        },
        resolutionArtifact(pending),
      ],
    });
    const next = payload.next_trace_index;
    const start = typeof next === 'number' && Number.isInteger(next) && next > 0 ? next : 1;
    return deliverFileReview(host, run, result, reviewOutput, contextOutput, start);
  }
  const review = await host.executeTool(run, 'file.review', await host.toolContext(run, request), {
    ...args,
    ...contextOutput,
  });
  const result = response({
    reviewText: '从 pending boundary 继续，多视角审稿完成。',
    agentResult: {
      summary: review.output.summary,
      requires_user_confirmation: false,
      review_report: review.output.review_report,
      resumed_from_pending_call: true,
      pending_call_artifact_id: pending.id,
    },
    toolTrace: [...contextTrace, ...(review.output.traces as AgentToolTrace[])],
    toolArtifacts: [...(review.artifacts ?? []), resolutionArtifact(pending)],
  });
  return deliverFileReview(host, run, result, review.output, contextOutput);
}

async function runFileReview(host: FixedPipelineHost, request: FixedPipelineRequest): Promise<Obj> {
  let { run } = request;
  const { args } = request;
  const pending = await latestRuntimePendingCall(host.store, run);
  if (shouldResumePendingCall(run, pending)) return resumeFileReview(host, request, pending!);
  const response = (fields: { plan: Obj[]; agentResult: Obj; toolTrace: AgentToolTrace[] }) =>
    host.baseResponse({
      agentSessionId: request.agentSessionId,
      assistantSessionId: request.assistantSessionId,
      intent: 'file.review',
      userMessage: request.userMessage,
      ...fields,
      ...roles(args),
    });
  const started = response({
    plan: [
      planStep('context.load', REVIEW_STEPS.context, 'running'),
      planStep('subagents.review', REVIEW_STEPS.review, 'pending'),
      planStep('synthesizer.merge', REVIEW_STEPS.merge, 'pending'),
    ],
    agentResult: { summary: '正在读取当前章与项目上下文。', requires_user_confirmation: false },
    toolTrace: [],
  });
  run = await host.sink.recordPlan(run, started);
  let interruption = host.runtimeInterruption(run, 'after_plan');
  if (interruption !== null) return runtimeInterruptedResponse(started, interruption, true);
  const context = await host.executeTool(
    run,
    'context.load',
    await host.toolContext(run, request),
    { ...args, _agent_intent: 'file.review' },
  );
  await host.sink.recordToolTrace(run, context.trace, 0);
  const partial = response({
    plan: [
      planStep('context.load', REVIEW_STEPS.context, 'completed'),
      planStep('subagents.review', REVIEW_STEPS.review, 'pending'),
      planStep('synthesizer.merge', REVIEW_STEPS.merge, 'pending'),
    ],
    agentResult: { summary: '已读取上下文，等待继续审稿。', requires_user_confirmation: false },
    toolTrace: [context.trace],
  });
  interruption = host.runtimeInterruption(run, 'after_tool:context.load');
  if (interruption !== null) {
    await recordFileReviewPendingCall(host, run, {
      partial,
      contextOutput: context.output,
      interruption,
    });
    return runtimeInterruptedResponse(partial, interruption, true);
  }
  const review = await host.executeTool(run, 'file.review', await host.toolContext(run, request), {
    ...args,
    ...context.output,
  });
  const result = host.baseResponse({
    agentSessionId: request.agentSessionId,
    assistantSessionId: request.assistantSessionId,
    intent: 'file.review',
    userMessage: request.userMessage,
    plan: [
      planStep('context.load', REVIEW_STEPS.context, 'completed'),
      planStep('subagents.review', REVIEW_STEPS.review, 'completed'),
      planStep('synthesizer.merge', REVIEW_STEPS.merge, 'completed'),
    ],
    agentResult: {
      summary: review.output.summary,
      requires_user_confirmation: false,
      review_report: review.output.review_report,
    },
    toolTrace: [context.trace, ...(review.output.traces as AgentToolTrace[])],
    ...roles(args),
    toolArtifacts: review.artifacts ?? [],
  });
  return deliverFileReview(host, run, result, review.output, context.output);
}

// ---- 修订（chapter_generation_pipeline 的 file.revise 分支） ----

async function runFileRevise(host: FixedPipelineHost, request: FixedPipelineRequest): Promise<Obj> {
  const { run, args, userMessage } = request;
  const context = await host.executeTool(
    run,
    'context.load',
    await host.toolContext(run, request),
    { ...args, _agent_intent: request.intent },
  );
  const offered = isObj(args.review_report) ? args.review_report : null;
  const directed = revisionReferencesReview(userMessage);
  let reviewReport: Obj | null;
  let traces: AgentToolTrace[];
  let reviewArtifacts: readonly ToolArtifact[];
  if (offered !== null || directed) {
    // 重新隐式审稿可能把作者说的「第二个问题」重新编号；沿用界面上展示的当前报告。
    reviewReport = await currentConversationReview(host.conversation, request.assistantSessionId, {
      offered,
      required: directed,
    });
    traces = [context.trace];
    reviewArtifacts = [];
  } else {
    const review = await host.executeTool(
      run,
      'file.review',
      await host.toolContext(run, request),
      { ...args, ...context.output },
    );
    traces = [context.trace, ...(review.output.traces as AgentToolTrace[])];
    reviewReport = review.output.review_report as Obj;
    reviewArtifacts = review.artifacts ?? [];
  }
  const revise = await host.executeTool(
    run,
    'file.revise',
    await host.toolContext(run, request, reviewReport),
    {
      ...args,
      review_report: isObj(args.review_report) ? args.review_report : reviewReport,
      llm_context_snapshot: context.output.llm_context_snapshot,
      llm_prompt_context_bundle: context.output.llm_prompt_context_bundle,
    },
  );
  traces.push(revise.trace);
  const judge = await host.executeTool(run, 'judge.run', await host.toolContext(run, request), {
    content: revise.output.after,
    file_path: revise.output.file_path,
    mode: 'proposed_patch_smoke',
  });
  traces.push(judge.trace);
  const agentResult: Obj = {
    summary: revise.output.summary,
    requires_user_confirmation: true,
    writeback_blocked_until_user_confirms: true,
    applied_scope: revise.output.applied_scope,
    review_report: reviewReport,
  };
  if (revise.output.scope_warning !== undefined && revise.output.scope_warning !== null)
    agentResult.scope_warning = revise.output.scope_warning;
  if (revise.output.truncation_warning !== undefined && revise.output.truncation_warning !== null)
    agentResult.truncation_warning = revise.output.truncation_warning;
  if (revise.output.length_hint !== undefined && revise.output.length_hint !== null)
    agentResult.length_hint = revise.output.length_hint;
  return host.baseResponse({
    agentSessionId: request.agentSessionId,
    assistantSessionId: request.assistantSessionId,
    intent: 'file.revise',
    userMessage,
    plan: [
      planStep('context.load', REVIEW_STEPS.context, 'completed'),
      planStep('subagents.review', REVIEW_STEPS.review, 'completed'),
      planStep(
        'file.revise',
        '生成 Desktop PatchReviewPanel 可审阅的 proposed patch。',
        'completed',
      ),
      planStep('judge.run', '对待确认修订执行轻量自检。', 'completed'),
      planStep('permission.confirm', '文件写回前等待作者确认。', 'needs_approval'),
    ],
    agentResult,
    toolTrace: traces,
    proposedPatch: revise.output.proposed_patch as Obj,
    ...roles(args),
    toolArtifacts: [...reviewArtifacts, ...(revise.artifacts ?? [])],
  });
}

// ---- 受控润色（chapter_polishing_pipeline） ----

const POLISH_RESULT_KEYS = [
  'status',
  'selected_source',
  'degraded',
  'provider',
  'model',
  'resolution_source',
  'online_failure',
  'rule_version',
  'gate_version',
  'gate_reasons',
  'gate_advisories',
  'edit_policy',
];

async function runChapterPolish(
  host: FixedPipelineHost,
  request: FixedPipelineRequest,
): Promise<Obj> {
  const { run, args } = request;
  const context = await host.executeTool(
    run,
    'context.load',
    await host.toolContext(run, request),
    { ...args, _agent_intent: request.intent },
  );
  const polish = await host.executeTool(
    run,
    'chapter.polish',
    await host.toolContext(run, request),
    {
      ...args,
      ...context.output,
      style_instruction: truthy(args.style_instruction) ? args.style_instruction : '',
      use_main_model: args.use_main_model === true,
      online_enabled: args.online_enabled !== false,
    },
  );
  const proposedPatch = isObj(polish.output.proposed_patch) ? polish.output.proposed_patch : null;
  const requiresConfirmation =
    proposedPatch !== null &&
    (Object.prototype.hasOwnProperty.call(proposedPatch, 'requires_confirmation')
      ? truthy(proposedPatch.requires_confirmation)
      : true);
  const plan = [
    planStep('context.load', '读取当前章与可信项目上下文。', 'completed'),
    planStep('chapter.polish', '比较在线与本地候选并执行相对原文质量门禁。', 'completed'),
  ];
  if (proposedPatch !== null)
    plan.push(
      planStep(
        'permission.confirm',
        requiresConfirmation
          ? '文件写回前等待作者确认。'
          : '按项目权限交给 Desktop guarded writeback。',
        requiresConfirmation ? 'needs_approval' : 'completed',
      ),
    );
  return host.baseResponse({
    agentSessionId: request.agentSessionId,
    assistantSessionId: request.assistantSessionId,
    intent: 'chapter.polish',
    userMessage: request.userMessage,
    plan,
    agentResult: {
      summary: polish.output.summary,
      requires_user_confirmation: requiresConfirmation,
      polish: Object.fromEntries(
        POLISH_RESULT_KEYS.map((key) => [key, polish.output[key] ?? null]),
      ),
    },
    toolTrace: [context.trace, polish.trace],
    proposedPatch,
    ...roles(args),
    toolArtifacts: polish.artifacts ?? [],
  });
}

/** 写章：有待确认的 brief 就从确认后接着写，否则先整理 brief（chapter_writing_pipeline）。 */
async function runChapterWriting(host: FixedPipelineHost, request: FixedPipelineRequest) {
  const pending = await latestRuntimePendingCall(host.store, request.run);
  if (isChapterResume(request.run, pending)) return resumeChapterWriting(host, request, pending);
  return startChapterBrief(host, request);
}

/** 显式 intent 的固定管线分派（intent_fixed_pipeline_adapter）。 */
export function runFixedIntentPipeline(
  host: FixedPipelineHost,
  request: FixedPipelineRequest,
): Promise<Obj> {
  if (request.intent === 'file.review') return runFileReview(host, request);
  if (request.intent === 'file.revise') return runFileRevise(host, request);
  if (request.intent === 'chapter.polish') return runChapterPolish(host, request);
  if (request.intent === 'chapter.write') return runChapterWriting(host, request);
  throw new AgentOrchestrationError(`暂不支持的 Agent intent：${request.intent}`);
}
