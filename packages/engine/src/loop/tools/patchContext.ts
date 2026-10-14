import { normcase } from '../../kernel/generationSources';
import { buildLlmContextSnapshot } from '../../kernel/llmContext';
import type { PlainJson, SecretContext } from '../../kernel/redaction';
import { verifyReviewSource } from '../../kernel/reviseDelivery';
import {
  resolveReviseScope,
  revisionReferencesReview,
  scopedReviseInstruction,
  type ReviseScope,
} from '../../kernel/reviseScope';
import {
  writingContextFromSnapshot,
  type PreparedWritingContext,
} from '../../kernel/writingContext';
import type { ProjectReader } from '../../readPort';
import { currentConversationReview } from '../reviewSources';
import type { ToolExecutionContext } from './execution';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type PatchContextDeps = {
  readonly reader: ProjectReader;
  readonly platform: 'windows' | 'posix';
  readonly secrets: SecretContext;
};

/**
 * writer 派发时用后端自己的来源输入刷新上下文快照（patches/writing_context）：
 * 自动检索结果不算作者请求，不能被重新钉住；循环读到的文件另走后端交接。
 */
export async function prepareRuntimeWritingContext(
  deps: PatchContextDeps,
  context: ToolExecutionContext,
  payload: Obj,
  intent: string,
): Promise<PreparedWritingContext> {
  const candidate = payload.project_root || context.args.project_path;
  const root = typeof candidate === 'string' && candidate.trim() ? candidate : null;
  payload.project_root = root;
  let original = context.args.context_bundle;
  if (!isObj(original)) original = payload.context_bundle;
  const previous = isObj(payload.llm_context_snapshot) ? payload.llm_context_snapshot : {};
  const bundle: Obj = isObj(original) ? { ...original } : {};
  // 固定适配器可以不经原始钉选就备好记忆与章节值。
  for (const key of ['story_memory', 'chapter_context'])
    if (!(key in bundle) && isObj(previous[key])) bundle[key] = previous[key];
  const previousFiles = previous.context_files;
  if (!isObj(original) && Array.isArray(previousFiles)) {
    const key = (item: Obj) => normcase(String(item.relative_path || ''), deps.platform);
    const automatic = new Set(
      previousFiles
        .filter(isObj)
        .filter((item) => item.selection_source === 'auto_retrieved')
        .map(key),
    );
    bundle.files = previousFiles.filter(
      (item) =>
        isObj(item) && item.selection_source !== 'loop_fs_read' && !automatic.has(key(item)),
    );
  }
  bundle.project_root = root || 'storyforge://llm-context';
  bundle.current_file = payload.file_path;
  const extra = context.writingReadSources.length
    ? [...context.writingReadSources]
    : (Array.isArray(previousFiles) ? previousFiles : []).filter(
        (item) => isObj(item) && item.selection_source === 'loop_fs_read',
      );
  const content = String(payload.content || '');
  const snapshot = await buildLlmContextSnapshot(
    deps.reader,
    {
      runState: {
        public_id: context.run.public_id,
        goal: context.run.goal,
        status: context.run.status,
        current_step: context.run.current_step,
      },
      intent,
      userMessage: context.userMessage,
      filePath: String((root ? payload._trace_file_path : null) || payload.file_path),
      content,
      contextBundle: bundle as PlainJson,
      roleHints: (previous.role_hints ?? null) as PlainJson[] | null,
      roleMentions: (previous.role_mentions ?? null) as PlainJson[] | null,
      // 选中的修订问题已在限定指令里；不能把未选中的合成报告再当第二条 writer 通道。
      reviewReport: (intent === 'file.revise'
        ? null
        : (previous.review_report ?? null)) as PlainJson,
      eventHistory: context.run.events as PlainJson[],
      artifacts: intent === 'file.revise' ? null : (context.run.artifacts as PlainJson[]),
      extraContextFiles: extra as PlainJson[],
    },
    { platform: deps.platform, secrets: deps.secrets },
  );
  payload.llm_context_snapshot = snapshot;
  const prepared = writingContextFromSnapshot(snapshot, {
    projectRoot: root,
    filePath: String(payload.file_path),
    content,
    intent,
    platform: deps.platform,
    secrets: deps.secrets,
  });
  payload.llm_prompt_context_bundle = prepared.contextBundle;
  return prepared;
}

/** 修订前先认定审稿报告归属与作者范围，writer 才能拿到其中任何一样（patches/revise_input）。 */
export async function prepareRevisionScope(
  deps: PatchContextDeps,
  context: ToolExecutionContext,
  payload: Obj,
  target: { instruction: string; filePath: string; content: string; projectRoot: string | null },
): Promise<[Obj | null, ReviseScope, string]> {
  let instruction = target.instruction;
  let report: Obj | null = isObj(payload.review_report) ? payload.review_report : null;
  const directed = revisionReferencesReview(context.userMessage);
  if (report !== null || directed)
    report = await currentConversationReview(
      context.services.conversation,
      context.assistantSessionId,
      { offered: report, transient: context.currentReviewReport, required: directed },
    );
  if (directed) instruction = context.userMessage;
  await verifyReviewSource(
    deps.reader,
    report,
    target.filePath,
    target.content,
    target.projectRoot,
  );
  const scope = resolveReviseScope(
    report as never,
    { ...payload, instruction },
    { authorInstruction: directed ? context.userMessage : null },
  );
  return [
    report,
    scope,
    scopedReviseInstruction(instruction, report as never, scope, deps.secrets),
  ];
}
