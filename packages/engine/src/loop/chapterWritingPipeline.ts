import { nativeProjectPath } from '../kernel/fsTools';
import type { PlainJson } from '../kernel/redaction';
import { buildLlmContextSnapshot } from '../kernel/llmContext';
import { llmContextSnapshotToPromptContextBundle } from '../kernel/llmPromptContext';
import { pythonStrip } from '../kernel/pythonText';
import { buildPlan } from '../kernel/serialPlan';
import { assertChapterSources, captureChapterSources } from './chapterSourceGuard';
import {
  buildBriefSeed,
  briefWrittenMaterials,
  CHAPTER_BRIEF_ARTIFACT_KIND,
  CHAPTER_CANDIDATE_ARTIFACT_KIND,
  CHAPTER_CHECK_ARTIFACT_KIND,
  CHAPTER_WRITE_INTENT,
  confirmBrief,
  recentChapterChars,
  resolveTarget,
} from './chapterWritingContracts';
import type { FixedPipelineHost, FixedPipelineRequest } from './fixedPipelines';
import { patchRequiresConfirmation } from './permission';
import { planStep, runtimeInterruptedResponse } from './runEvents';
import { AgentOrchestrationError, roleHints, roleMentions } from './runPayloads';
import type { ToolArtifact } from './tools/execution';
import {
  buildRuntimePendingCallResolutionPayload,
  RUNTIME_PENDING_CALL_ARTIFACT_KIND,
  RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
  type AgentToolTrace,
} from './traces';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
type PendingRow = { readonly id: number; readonly kind: string; readonly payload: Obj };

const roles = (args: Obj) => ({ roleHints: roleHints(args), roleMentions: roleMentions(args) });
const strip = (value: unknown) => (typeof value === 'string' ? pythonStrip(value) : '');

function requiredProjectRoot(args: Obj): string {
  const value = strip(args.project_path);
  if (!value) throw new AgentOrchestrationError('写一章需要当前项目路径。');
  return value;
}

async function resumeProjectRoot(host: FixedPipelineHost, request: FixedPipelineRequest) {
  if (strip(request.args.project_path)) return strip(request.args.project_path);
  const session = await host.assistant.getSession(request.assistantSessionId);
  if (strip(session.project_path)) return strip(session.project_path);
  throw new AgentOrchestrationError('恢复写章时找不到当前项目路径，请重新发起写章。');
}

function completedPlan(checkStatus: string, patchStatus: string, checkDetail = '章节检查已完成。') {
  return [
    planStep('chapter.brief', '作者已确认 Chapter Brief。', 'completed'),
    planStep('chapter.brief.confirm', 'Chapter Brief 已确认。', 'completed'),
    planStep('chapter.draft', '已按 brief 起草正文。', 'completed'),
    planStep('chapter.check', checkDetail, checkStatus),
    planStep('chapter.patch', '未发现稿件硬问题时生成 proposed patch。', patchStatus),
  ];
}

const checkerFailureDetail = (executionStatus: unknown) =>
  executionStatus === 'incomplete'
    ? '章节检查未完整执行：结果超过协议预算，不能据此判断稿件通过。'
    : '章节检查执行失败：未取得有效、来源与证据可核实的完整结果。';

export function isChapterResume(
  run: FixedPipelineRequest['run'],
  pending: PendingRow | null,
): pending is PendingRow {
  if (pending === null || run.status !== 'running' || run.current_step !== 'resumed') return false;
  const payload = isObj(pending.payload) ? pending.payload : {};
  return payload.intent === CHAPTER_WRITE_INTENT;
}

/** 第一段：整理 Chapter Brief，冻结来源，记下待作者确认的未决调用后停下。 */
export async function startChapterBrief(
  host: FixedPipelineHost,
  request: FixedPipelineRequest,
): Promise<Obj> {
  const { args, userMessage } = request;
  let { run } = request;
  const deps = { reader: host.reader, platform: host.platform, secrets: host.secrets };
  const root = requiredProjectRoot(args);
  const { relative, target, planned } = await resolveTarget(
    host.reader,
    root,
    args.file_path || args.current_file,
    host.platform,
  );
  const targetAbsolute = nativeProjectPath(root, target, host.platform);
  const plan = await buildPlan(host.reader, root, host.platform);
  const context = await host.toolContext(run, request);
  const bundle = args.context_bundle || {};
  const snapshot = await buildLlmContextSnapshot(
    host.reader,
    {
      runState: {
        public_id: context.run.public_id,
        goal: context.run.goal,
        status: context.run.status,
        current_step: context.run.current_step,
      },
      intent: CHAPTER_WRITE_INTENT,
      userMessage,
      filePath: relative,
      content: '',
      contextBundle: {
        ...(bundle as Obj),
        project_root: root,
        current_file: relative,
      } as PlainJson,
      roleHints: roleHints(args),
      roleMentions: roleMentions(args),
      eventHistory: context.run.events as PlainJson[],
      artifacts: context.run.artifacts as PlainJson[],
    },
    { platform: host.platform, secrets: host.secrets },
  );
  const promptBundle = llmContextSnapshotToPromptContextBundle(snapshot, host.secrets) as Obj;
  const sourceGuard = await captureChapterSources(deps, {
    root,
    target,
    bundle: promptBundle,
    snapshot,
    userMessage,
  });
  const seed = buildBriefSeed({
    userMessage,
    targetPath: relative,
    planned,
    plan,
    recentChars: await recentChapterChars(host.reader, root, relative, host.platform),
  });
  // 章纲顺带对照上一章结尾和已写事实，专挡「计划和已写内容打架」（不多一次调用）。
  const written = await briefWrittenMaterials(
    host.reader,
    root,
    targetAbsolute,
    host.platform,
    `${userMessage}\n${String(seed.goal ?? '')}`,
  );
  const response = (fields: { plan: Obj[]; agentResult: Obj; toolTrace: AgentToolTrace[] }) =>
    host.baseResponse({
      agentSessionId: request.agentSessionId,
      assistantSessionId: request.assistantSessionId,
      intent: CHAPTER_WRITE_INTENT,
      userMessage,
      ...fields,
      ...roles(args),
    });
  const started = response({
    plan: [
      planStep('chapter.brief', '整理章节目标与可信上下文。', 'running'),
      planStep('chapter.brief.confirm', '等待作者确认 Chapter Brief。', 'pending'),
      planStep('chapter.draft', '按确认后的 brief 起草正文。', 'pending'),
      planStep('chapter.check', '检查并在必要时定向修复一次。', 'pending'),
      planStep('chapter.patch', '生成待审阅 proposed patch。', 'pending'),
    ],
    agentResult: { summary: '正在整理 Chapter Brief。', requires_user_confirmation: false },
    toolTrace: [],
  });
  run = await host.sink.recordPlan(run, started);
  const briefResult = await host.executeTool(run, 'chapter.brief', context, {
    project_root: root,
    target_absolute: targetAbsolute,
    seed,
    written,
    llm_context_snapshot: snapshot,
    llm_prompt_context_bundle: promptBundle,
  });
  await assertChapterSources(deps, root, target, sourceGuard);
  await host.sink.recordToolTrace(run, briefResult.trace, 0);
  const brief = briefResult.output.brief as Obj;
  const safePromptBundle = { ...promptBundle, project_root: '.' };
  await host.sink.recordRuntimePendingCall(run, {
    kind: RUNTIME_PENDING_CALL_ARTIFACT_KIND,
    intent: CHAPTER_WRITE_INTENT,
    boundary: 'after_tool:chapter.brief',
    status: 'pending',
    resume_strategy: 'continue_chapter_writing_after_brief',
    resume_message: {
      type: 'user_message',
      intent: CHAPTER_WRITE_INTENT,
      user_message: userMessage,
      assistant_session_id: request.assistantSessionId,
      args: {
        project_path: root,
        project_name: args.project_name ?? null,
        file_path: relative,
        context_bundle: safePromptBundle,
      },
    },
    chapter_brief: brief,
    target_relative: relative,
    source_guard: sourceGuard,
    llm_prompt_context_bundle: safePromptBundle,
  });
  const summary = `Chapter Brief 已准备：${brief.goal || relative}。确认后才会开始起草。`;
  const result = response({
    plan: [
      planStep('chapter.brief', '已生成可编辑 Chapter Brief。', 'completed'),
      planStep('chapter.brief.confirm', '等待作者确认 Chapter Brief。', 'needs_approval'),
      planStep('chapter.draft', '确认后起草正文。', 'pending'),
      planStep('chapter.check', '检查并在必要时定向修复一次。', 'pending'),
      planStep('chapter.patch', '检查通过后生成 proposed patch。', 'pending'),
    ],
    agentResult: {
      summary,
      requires_user_confirmation: true,
      confirmation_kind: 'chapter_brief',
      chapter_brief: brief,
      confirmation_action: { kind: 'chapter_brief', chapter_brief: brief },
    },
    toolTrace: [briefResult.trace],
  });
  const interrupted = host.checkResultDelivery(result, 'before_finalize:chapter.brief', true);
  await host.sink.recordArtifact(run, {
    kind: CHAPTER_BRIEF_ARTIFACT_KIND,
    payload: { ...brief, status: interrupted !== null ? 'interrupted' : 'proposed' },
    requiresConfirmation: interrupted === null,
  });
  if (interrupted !== null) return interrupted;
  await host.assistant.appendMessage(request.assistantSessionId, {
    role: 'user',
    content: userMessage,
  });
  await host.assistant.appendMessage(request.assistantSessionId, {
    role: 'assistant',
    content: summary,
  });
  await host.sink.recordPermissionRequired(run, result, 'chapter_brief_confirmation');
  await host.store.updateRun(run.id, { current_step: 'chapter.brief.confirm' });
  const paused = runtimeInterruptedResponse(
    result,
    {
      kind: 'runtime_interruption',
      status: 'paused',
      current_step: 'chapter.brief.confirm',
      boundary: 'after_tool:chapter.brief',
      uses_existing_status: true,
      resume_strategy: 'continue_chapter_writing_after_brief',
      automatic_resume_supported: true,
    },
    true,
  );
  // 停在这里是等作者确认章纲，不是作者按了暂停：回话照旧说人话，不换成运行边界的内部说法。
  (paused.agent_result as Obj).summary = summary;
  (paused.agent_result as Obj).requires_user_confirmation = true;
  return paused;
}

/**
 * 第二段：作者确认后起草 → 检查 → 必要时定向修复一次 → 再检查；通过才产补丁。
 * 例外：检查器重试后仍不可用、程序检查又没有硬失败时，交「未经检查」的稿并强制作者确认。
 */
export async function resumeChapterWriting(
  host: FixedPipelineHost,
  request: FixedPipelineRequest,
  pending: PendingRow,
): Promise<Obj> {
  const { run, args, userMessage } = request;
  const deps = { reader: host.reader, platform: host.platform, secrets: host.secrets };
  const payload = isObj(pending.payload) ? pending.payload : {};
  const original = isObj(payload.chapter_brief) ? payload.chapter_brief : {};
  const confirmed = confirmBrief(args.chapter_brief, original);
  const root = await resumeProjectRoot(host, request);
  const { relative, target } = await resolveTarget(
    host.reader,
    root,
    confirmed.target_path,
    host.platform,
  );
  if (relative !== payload.target_relative)
    throw new AgentOrchestrationError('目标章节在 brief 确认期间发生变化，请重新生成 brief。');
  const promptBundle = payload.llm_prompt_context_bundle;
  if (!isObj(promptBundle))
    throw new AgentOrchestrationError('Chapter Brief 缺少可信上下文快照，请重新生成。');
  await assertChapterSources(deps, root, target, payload.source_guard);
  const targetAbsolute = nativeProjectPath(root, target, host.platform);
  const context = await host.toolContext(run, request);
  const writer = {
    project_root: root,
    project_name: args.project_name ?? null,
    target_absolute: targetAbsolute,
    target_relative: relative,
    brief: confirmed,
    source_guard: payload.source_guard,
    llm_prompt_context_bundle: promptBundle,
  };
  const traces: AgentToolTrace[] = [];
  const draft = await host.executeTool(run, 'chapter.draft', context, writer);
  traces.push(draft.trace);
  let content = String(draft.output.content);
  // 检查器没给出可用结果（不是稿件结论）时同一份正文再查一次。
  const checkChapter = async (attempt: number): Promise<Obj> => {
    const input = { brief: confirmed, content, attempt };
    let check = await host.executeTool(run, 'chapter.check', context, input);
    traces.push(check.trace);
    if ((check.output.check as Obj).execution_status !== 'completed') {
      check = await host.executeTool(run, 'chapter.check', context, { ...input, recheck: true });
      traces.push(check.trace);
    }
    return check.output.check as Obj;
  };
  let finalCheck = await checkChapter(1);
  let repairCount = 0;
  if (finalCheck.status === 'repairable') {
    const repaired = await host.executeTool(run, 'chapter.repair', context, {
      ...writer,
      content,
      check: finalCheck,
    });
    traces.push(repaired.trace);
    content = String(repaired.output.content);
    repairCount = 1;
    finalCheck = await checkChapter(2);
  }
  await assertChapterSources(deps, root, target, payload.source_guard);
  for (const [index, trace] of traces.entries()) await host.sink.recordToolTrace(run, trace, index);
  const toolArtifacts: ToolArtifact[] = [
    { kind: CHAPTER_BRIEF_ARTIFACT_KIND, payload: confirmed, requires_confirmation: false },
    {
      kind: CHAPTER_CHECK_ARTIFACT_KIND,
      payload: {
        ...finalCheck,
        attempt: repairCount ? 2 : 1,
        repair_count: repairCount,
        recheck_count: traces.filter(
          (trace) => trace.tool_name === 'chapter.check' && trace.input_summary.recheck === true,
        ).length,
      },
      requires_confirmation: false,
    },
    {
      kind: RUNTIME_PENDING_CALL_RESOLUTION_ARTIFACT_KIND,
      payload: buildRuntimePendingCallResolutionPayload(pending.payload, pending.id, pending.kind),
      requires_confirmation: false,
    },
  ];
  const response = (fields: { plan: Obj[]; agentResult: Obj; proposedPatch?: Obj | null }): Obj => {
    const result = host.baseResponse({
      agentSessionId: request.agentSessionId,
      assistantSessionId: request.assistantSessionId,
      intent: CHAPTER_WRITE_INTENT,
      userMessage,
      plan: fields.plan,
      agentResult: fields.agentResult,
      toolTrace: traces,
      proposedPatch: fields.proposedPatch ?? null,
      ...roles(args),
      toolArtifacts,
    });
    result._events_recorded = true;
    return result;
  };
  const executionStatus = finalCheck.execution_status;
  // 重查后检查器仍失败，说明不了稿件好坏：稿子照给，但一律要作者确认；程序查出的问题（空稿、字数）仍拦下。
  const unchecked =
    executionStatus !== 'completed' && finalCheck.manuscript_hard_failure_count === 0;
  if (finalCheck.status !== 'pass' && !unchecked) {
    const detail =
      executionStatus === 'completed'
        ? `章节检查已完成：发现 ${finalCheck.manuscript_hard_failure_count} 个稿件硬失败。`
        : checkerFailureDetail(executionStatus);
    const candidate = {
      target_path: relative,
      brief_id: confirmed.brief_id,
      brief_sha256: finalCheck.brief_sha256,
      content,
      content_sha256: finalCheck.content_sha256,
      execution_status: executionStatus,
      manuscript_status: finalCheck.manuscript_status,
      read_only: true,
    };
    toolArtifacts.push({
      kind: CHAPTER_CANDIDATE_ARTIFACT_KIND,
      payload: candidate,
      requires_confirmation: false,
    });
    return response({
      plan: completedPlan(
        executionStatus === 'completed' ? 'completed' : 'failed',
        'skipped',
        detail,
      ),
      agentResult: {
        summary: `${detail} 候选稿已保留在运行证据中，未生成补丁。`,
        requires_user_confirmation: false,
        chapter_brief: confirmed,
        chapter_check: finalCheck,
        chapter_candidate: candidate,
        repair_count: repairCount,
      },
    });
  }
  const requiresConfirmation = unchecked || patchRequiresConfirmation(run.permission_profile);
  const proposedPatch = {
    id: `chapter-writing-${host.newHex()}`,
    kind: 'file_revision',
    created_by_tool: CHAPTER_WRITE_INTENT,
    file_path: targetAbsolute,
    before: '',
    after: content,
    requires_confirmation: requiresConfirmation,
    approval_action: 'desktop.confirm_file_writeback',
    brief_id: confirmed.brief_id,
  };
  toolArtifacts.push({
    kind: 'proposed_patch',
    payload: proposedPatch,
    requires_confirmation: requiresConfirmation,
  });
  return response({
    plan: unchecked
      ? completedPlan('failed', 'completed', checkerFailureDetail(executionStatus))
      : completedPlan('completed', 'completed'),
    agentResult: {
      summary: unchecked
        ? '章节检查重查一次后仍未取得可用结果，这份稿子未经检查。' +
          `已生成 ${relative} 的待审阅补丁，请通读后再决定是否接受。`
        : `章节草稿已通过 brief 检查，生成 ${relative} 的待审阅补丁。`,
      requires_user_confirmation: requiresConfirmation,
      chapter_brief: confirmed,
      chapter_check: finalCheck,
      repair_count: repairCount,
    },
    proposedPatch,
  });
}
