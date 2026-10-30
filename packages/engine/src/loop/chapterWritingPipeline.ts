import { nativeProjectPath } from '../kernel/fsTools';
import { redactSensitiveText, type PlainJson } from '../kernel/redaction';
import { buildLlmContextSnapshot } from '../kernel/llmContext';
import { llmContextSnapshotToPromptContextBundle } from '../kernel/llmPromptContext';
import { pythonStrip } from '../kernel/pythonText';
import { buildPlan } from '../kernel/serialPlan';
import { PROGRAM_ADVISORY_RULES } from './chapterCheckProtocol';
import { assertChapterSources, captureChapterSources } from './chapterSourceGuard';
import {
  BRIEF_READY_PREFIX,
  briefConversation,
  buildBriefSeed,
  briefWrittenMaterials,
  CHAPTER_BRIEF_ARTIFACT_KIND,
  CHAPTER_CANDIDATE_ARTIFACT_KIND,
  CHAPTER_CHECK_ARTIFACT_KIND,
  CHAPTER_WRITE_INTENT,
  confirmBrief,
  earliestChapterChars,
  resolveTarget,
} from './chapterWritingContracts';
import type { FixedPipelineHost, FixedPipelineRequest } from './fixedPipelines';
import { patchRequiresConfirmation } from './permission';
import { planStep } from './runEvents';
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

/** 程序查出、只提示不拦稿的问题（字数、正文里的章号）直接写进回复，作者不必去翻检查记录。 */
export function programAdvisoryNote(check: Obj): string {
  const findings = Array.isArray(check.findings) ? (check.findings as Obj[]) : [];
  const messages = findings
    .filter((item) => PROGRAM_ADVISORY_RULES.has(String(item.rule)))
    .map((item) => String(item.message));
  return messages.length ? `程序提示：${messages.join(' ')}` : '';
}

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

/** 旧版停下等作者确认章纲的 run，作者在卡片上确认过才多出「已确认」那一步。 */
function completedPlan(
  authorConfirmed: boolean,
  checkStatus: string,
  patchStatus: string,
  checkDetail = '章节检查已完成。',
) {
  return [
    ...(authorConfirmed
      ? [
          planStep('chapter.brief', '作者已确认 Chapter Brief。', 'completed'),
          planStep('chapter.brief.confirm', 'Chapter Brief 已确认。', 'completed'),
        ]
      : [planStep('chapter.brief', '已生成 Chapter Brief。', 'completed')]),
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

/**
 * 写一章：整理 Chapter Brief、冻结来源，起草前记下可恢复的未决调用，随即按章纲起草—检查—产补丁。
 * 章纲不等作者确认（各档位一样）；作者只在补丁那一步按档位把关。
 */
export async function startChapterWriting(
  host: FixedPipelineHost,
  request: FixedPipelineRequest,
): Promise<Obj> {
  const { args, userMessage } = request;
  let { run } = request;
  const deps = {
    reader: host.reader,
    platform: host.platform,
    secrets: host.secrets,
    pluginLibraryRoot: host.pluginLibraryRoot ?? null,
  };
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
    earliestChars: await earliestChapterChars(host.reader, root, relative, host.platform),
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
      planStep('chapter.draft', '按 brief 起草正文。', 'pending'),
      planStep('chapter.check', '检查并在必要时定向修复一次。', 'pending'),
      planStep('chapter.patch', '生成待审阅 proposed patch。', 'pending'),
    ],
    agentResult: { summary: '正在整理 Chapter Brief。', requires_user_confirmation: false },
    toolTrace: [],
  });
  run = await host.sink.recordPlan(run, started);
  const rawConversation = briefConversation(
    await host.conversation.messages(request.assistantSessionId),
    userMessage,
  );
  const conversation =
    rawConversation === null ? null : redactSensitiveText(rawConversation, host.secrets);
  const briefResult = await host.executeTool(run, 'chapter.brief', context, {
    project_root: root,
    target_absolute: targetAbsolute,
    seed,
    written,
    conversation,
    llm_context_snapshot: snapshot,
    llm_prompt_context_bundle: promptBundle,
  });
  await assertChapterSources(deps, root, target, sourceGuard);
  await host.sink.recordToolTrace(run, briefResult.trace, 0);
  const brief = briefResult.output.brief as Obj;
  const safePromptBundle = { ...promptBundle, project_root: '.' };
  // 起草前的断点：作者在起草途中暂停（哪怕随后重启）再继续时，从章纲之后接着写，不必重拟章纲。
  const pending = await host.sink.recordRuntimePendingCall(run, {
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
    // 起草时会话里已多了「章纲已准备」那句，节选再取就是空的：章纲看到的这段原样留给起草。
    ...(conversation !== null ? { conversation_excerpt: conversation } : {}),
  });
  const summary = `${BRIEF_READY_PREFIX}${brief.goal || relative}。`;
  const briefed = response({
    plan: [
      planStep('chapter.brief', '已生成 Chapter Brief。', 'completed'),
      planStep('chapter.draft', '按 brief 起草正文。', 'pending'),
      planStep('chapter.check', '检查并在必要时定向修复一次。', 'pending'),
      planStep('chapter.patch', '检查通过后生成 proposed patch。', 'pending'),
    ],
    agentResult: { summary, requires_user_confirmation: false, chapter_brief: brief },
    toolTrace: [briefResult.trace],
  });
  const interrupted = host.checkResultDelivery(briefed, 'before_finalize:chapter.brief', true);
  await host.sink.recordArtifact(run, {
    kind: CHAPTER_BRIEF_ARTIFACT_KIND,
    payload: { ...brief, status: interrupted !== null ? 'interrupted' : 'proposed' },
    requiresConfirmation: false,
  });
  if (interrupted !== null) return interrupted;
  await host.assistant.appendMessage(request.assistantSessionId, {
    role: 'user',
    content: userMessage,
  });
  // 这句也是下一章读对话节选的分界（见 briefConversation），起草失败也要留着。
  await host.assistant.appendMessage(request.assistantSessionId, {
    role: 'assistant',
    content: summary,
  });
  // 旧版拟章纲与起草是两次调用、各有一份时长预算；合成一次后起草阶段照旧拿满一份，免得慢模型写到一半超时。
  host.renewRunDeadline();
  // 从刚记下的断点接着写：用的正是暂停后继续时会读到的那份（已脱敏的）章纲与来源。
  const stored = isObj(pending.payload.chapter_brief) ? pending.payload.chapter_brief : {};
  return draftFromBrief(host, request, {
    run,
    root,
    relative,
    target,
    brief: confirmBrief(stored, stored),
    authorConfirmed: false,
    pending,
    leadingTraces: [briefResult.trace],
  });
}

/**
 * 从起草前记下的未决调用接着写：作者在起草途中暂停后继续，或旧版停下等作者确认章纲的 run。
 * 带着作者在章纲卡片上确认（可能改过）的那版就先核对它；没带就照记下的章纲写。
 */
export async function resumeChapterWriting(
  host: FixedPipelineHost,
  request: FixedPipelineRequest,
  pending: PendingRow,
): Promise<Obj> {
  const { run, args } = request;
  const deps = {
    reader: host.reader,
    platform: host.platform,
    secrets: host.secrets,
    pluginLibraryRoot: host.pluginLibraryRoot ?? null,
  };
  const payload = isObj(pending.payload) ? pending.payload : {};
  const original = isObj(payload.chapter_brief) ? payload.chapter_brief : {};
  const authorConfirmed = args.chapter_brief !== undefined && args.chapter_brief !== null;
  const confirmed = confirmBrief(authorConfirmed ? args.chapter_brief : original, original);
  const root = await resumeProjectRoot(host, request);
  const { relative, target } = await resolveTarget(
    host.reader,
    root,
    confirmed.target_path,
    host.platform,
  );
  if (relative !== payload.target_relative)
    throw new AgentOrchestrationError('目标章节在 brief 确认期间发生变化，请重新生成 brief。');
  if (!isObj(payload.llm_prompt_context_bundle))
    throw new AgentOrchestrationError('Chapter Brief 缺少可信上下文快照，请重新生成。');
  await assertChapterSources(deps, root, target, payload.source_guard);
  return draftFromBrief(host, request, {
    run,
    root,
    relative,
    target,
    brief: confirmed,
    authorConfirmed,
    pending,
    leadingTraces: [],
  });
}

/**
 * 按已收口的章纲起草 → 检查 → 必要时定向修复一次 → 再检查；通过才产补丁。
 * 例外：检查器重试后仍不可用、程序检查又没有硬失败时，交「未经检查」的稿并强制作者确认。
 * 起草用的来源、上下文与对话节选一律取自起草前记下的未决调用，产出时把它消解掉。
 */
async function draftFromBrief(
  host: FixedPipelineHost,
  request: FixedPipelineRequest,
  input: {
    run: FixedPipelineRequest['run'];
    root: string;
    relative: string;
    target: string;
    brief: Obj;
    authorConfirmed: boolean;
    pending: PendingRow;
    /** 同一次执行里已落库的轨迹（拟章纲），后面的轨迹序号接着排。 */
    leadingTraces: readonly AgentToolTrace[];
  },
): Promise<Obj> {
  const { args, userMessage } = request;
  const { run, root, relative, target, brief: confirmed, authorConfirmed, pending } = input;
  const deps = {
    reader: host.reader,
    platform: host.platform,
    secrets: host.secrets,
    pluginLibraryRoot: host.pluginLibraryRoot ?? null,
  };
  const payload = isObj(pending.payload) ? pending.payload : {};
  const targetAbsolute = nativeProjectPath(root, target, host.platform);
  const context = await host.toolContext(run, request);
  const writer = {
    project_root: root,
    project_name: args.project_name ?? null,
    target_absolute: targetAbsolute,
    target_relative: relative,
    brief: confirmed,
    source_guard: payload.source_guard,
    llm_prompt_context_bundle: payload.llm_prompt_context_bundle,
    ...(typeof payload.conversation_excerpt === 'string'
      ? { conversation_excerpt: payload.conversation_excerpt }
      : {}),
  };
  const traces: AgentToolTrace[] = [];
  // 每步做完就落一条轨迹，思考过程跟着走，不等整章查完才一起出现。
  const execute = async (toolName: string, toolPayload: Obj) => {
    const result = await host.executeTool(run, toolName, context, toolPayload);
    await host.sink.recordToolTrace(run, result.trace, input.leadingTraces.length + traces.length);
    traces.push(result.trace);
    return result;
  };
  const draft = await execute('chapter.draft', writer);
  let content = String(draft.output.content);
  // 检查器没给出可用结果（不是稿件结论）时同一份正文再查一次。
  const checkChapter = async (attempt: number): Promise<Obj> => {
    const checkInput = { brief: confirmed, content, attempt };
    let check = await execute('chapter.check', checkInput);
    if ((check.output.check as Obj).execution_status !== 'completed')
      check = await execute('chapter.check', { ...checkInput, recheck: true });
    return check.output.check as Obj;
  };
  let finalCheck = await checkChapter(1);
  let repairCount = 0;
  if (finalCheck.status === 'repairable') {
    const repaired = await execute('chapter.repair', {
      ...writer,
      content,
      check: finalCheck,
    });
    content = String(repaired.output.content);
    repairCount = 1;
    finalCheck = await checkChapter(2);
  }
  await assertChapterSources(deps, root, target, payload.source_guard);
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
      toolTrace: [...input.leadingTraces, ...traces],
      proposedPatch: fields.proposedPatch ?? null,
      ...roles(args),
      toolArtifacts,
    });
    result._events_recorded = true;
    return result;
  };
  const executionStatus = finalCheck.execution_status;
  // 重查后检查器仍失败，说明不了稿件好坏：稿子照给，但一律要作者确认；程序查出的空稿仍拦下。
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
        authorConfirmed,
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
      ? completedPlan(authorConfirmed, 'failed', 'completed', checkerFailureDetail(executionStatus))
      : completedPlan(authorConfirmed, 'completed', 'completed'),
    agentResult: {
      summary: unchecked
        ? '章节检查重查一次后仍未取得可用结果，这份稿子未经检查。' +
          `已生成 ${relative} 的待审阅补丁，请通读后再决定是否接受。`
        : `章节草稿已通过 brief 检查，生成 ${relative} 的待审阅补丁。` +
          programAdvisoryNote(finalCheck),
      requires_user_confirmation: requiresConfirmation,
      chapter_brief: confirmed,
      chapter_check: finalCheck,
      repair_count: repairCount,
    },
    proposedPatch,
  });
}
