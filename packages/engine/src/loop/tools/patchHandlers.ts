import { insertAtAnchor, resolveAnchorLine } from '../../assistant/continuation';
import {
  AssistantLlmNotConfiguredError,
  AssistantReviseError,
  AssistantSessionNotFoundError,
  draftContinuation,
  draftFileContent,
  reviseFileContent,
} from '../../assistant/service';
import { FsToolError, resolveProjectRoot, resolveScopedPath } from '../../kernel/fsTools';
import { isObj, pythonFloatRepr, type Obj } from '../../kernel/json';
import { isManuscriptPath } from '../../kernel/manuscript';
import { pythonFixed } from '../../kernel/math';
import { cpLen, cpSlice } from '../../kernel/pythonText';
import {
  heuristicReviewReasoner,
  llmReviewReasoner,
  type ReviewReasoner,
} from '../../kernel/reviewReasoning';
import {
  buildMultiAgentReviewReport,
  continuitySubagentHandler,
  reviewReportSummary,
} from '../../kernel/reviewReport';
import type { ReviewIssue } from '../../kernel/reviewSkills';
import {
  parseOrdinal,
  publicReviseScope,
  reviseSummaryWithScope,
  scopeIssues,
  scopeWarning,
} from '../../kernel/reviseScope';
import { truncationWarning } from '../../kernel/revisionTruncation';
import type { AssistantContextBundle } from '../../kernel/writingContext';
import { missingLlmEnv } from '../../llm/config';
import { ProjectReadError } from '../../readPort';
import { authorViewFromPayload } from '../authorView';
import { PatchProposal } from '../chatLoopTypes';
import { patchRequiresConfirmation } from '../permission';
import { revisionTargetLength, targetLengthHint } from '../reviseTargetLength';
import { AgentOrchestrationError, optionalString, roleHints, roleMentions } from '../runPayloads';
import {
  SubagentExecutor,
  type ToolExecutionContext,
  type ToolHandler,
  type ToolResult,
} from './execution';
import type { ToolDeps } from './handlerDeps';
import { prepareRevisionScope, prepareRuntimeWritingContext } from './patchContext';
import {
  llmContextInputSummary,
  optionalInt,
  requiredString,
  requiredText,
  trimProseInstruction,
} from './runtimeArguments';

const TARGET_CHARS_MIN = 80;
const TARGET_CHARS_MAX = 1200;
const APPROVAL_ACTION = 'desktop.confirm_file_writeback';

/** assistant 用例的三种可预期失败转成编排错误（未生成补丁），其余原样上抛。 */
async function assistantCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (
      error instanceof AssistantLlmNotConfiguredError ||
      error instanceof AssistantReviseError ||
      error instanceof AssistantSessionNotFoundError
    )
      throw new AgentOrchestrationError(error.message);
    throw error;
  }
}

/** 审稿子代理：三个视角只取推理结果里的 issue，连续性走启发式扫描。 */
function reviewSubagents(): SubagentExecutor {
  const fromResult = (key: string) => async (payload: Obj) => {
    const result = payload.result;
    if (!isObj(result) || !Array.isArray(result.issues))
      throw new AgentOrchestrationError(`${key} 子代理缺少 ReviewSubagentResult。`);
    return { issues: result.issues };
  };
  return new SubagentExecutor([
    { role: 'plot_reviewer', handler: fromResult('plot') },
    { role: 'character_reviewer', handler: fromResult('character') },
    { role: 'prose_reviewer', handler: fromResult('prose') },
    {
      role: 'continuity_reviewer',
      handler: async (payload) => continuitySubagentHandler(payload.content),
    },
  ]);
}

const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;

const CHAPTER_FILE = /^第([零〇一二两三四五六七八九十百千\p{Nd}]+)章/u;

/**
 * 对话 AI 新建正文章节时把文件名统一成「第NNN章.md」：「第一章.md」「第一章 筑基前夜.md」按路径排序
 * 会落到「第002章.md」后面，下一章找「上一章」就找错了。同名文件已存在、章号读不出时不改。
 */
export async function normalizedChapterPath(
  reader: ToolDeps['reader'],
  root: string,
  filePath: string,
  relativePath: string,
): Promise<{ filePath: string; relativePath: string } | null> {
  const relative = relativePath.replace(/\\/g, '/');
  if (!isManuscriptPath(relative)) return null;
  const name = basename(relative);
  const match = CHAPTER_FILE.exec(name);
  const ordinal = match ? parseOrdinal(match[1]) : null;
  if (ordinal === null || ordinal > 999n) return null;
  const wanted = `第${String(ordinal).padStart(3, '0')}章.md`;
  if (wanted === name) return null;
  const renamedRelative = `${relative.slice(0, relative.length - name.length)}${wanted}`;
  try {
    const existing = await reader.inspectProjectPath(root, renamedRelative);
    if (existing.entryKind !== 'missing') return null;
  } catch (error) {
    if (error instanceof ProjectReadError) return null;
    throw error;
  }
  const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return { filePath: `${filePath.slice(0, cut + 1)}${wanted}`, relativePath: renamedRelative };
}

/** file.review / file.revise / file.create / prose.continue / project.trim_prose / judge.run。 */
export function patchToolHandlers(deps: ToolDeps): Record<string, ToolHandler> {
  const { reader, platform, secrets } = deps;
  const contextDeps = { reader, platform, secrets };
  const subagents = reviewSubagents();
  const requiresConfirmation = (context: ToolExecutionContext) =>
    patchRequiresConfirmation(context.run.permission_profile);

  /** 配置了模型才走模型审稿；运行控制下逐视角检查中断。 */
  async function reviewReasoner(context: ToolExecutionContext): Promise<ReviewReasoner> {
    const llm = await context.services.assistant.llm();
    if (missingLlmEnv(llm.source).length) return heuristicReviewReasoner;
    const model = llm.source.STORYFORGE_LLM_MODEL;
    return llmReviewReasoner({
      callLlm: (prompts) =>
        llm.call(prompts) as Promise<{ content: unknown; latency_ms?: unknown }>,
      model: typeof model === 'string' ? model : null,
      checkInterruption: () => context.services.checkInterruption('before_review_role'),
    });
  }

  const fileReview: ToolHandler = async (context, payload) => {
    const filePath = requiredString(payload, 'file_path');
    const content = requiredString(payload, 'content');
    const bundle = isObj(payload.context_bundle) ? payload.context_bundle : null;
    const promptBundle = isObj(payload.llm_prompt_context_bundle)
      ? payload.llm_prompt_context_bundle
      : bundle;
    const [report, traces] = await buildMultiAgentReviewReport(
      {
        run: (role, input, toolName) =>
          subagents.run(role, input, toolName) as Promise<{ issues: ReviewIssue[] }>,
      },
      {
        reasoner: await reviewReasoner(context),
        newReportId: deps.newHex,
        filePath,
        content,
        contextBundle: promptBundle,
        userMessage: context.userMessage,
        requestedRoleHints: roleHints(context.args),
        requestedRoleMentions: roleMentions(context.args),
      },
    );
    const summary = reviewReportSummary(report);
    const issueCount = (report.issues as unknown[]).length;
    return {
      status: 'completed',
      output: { review_report: report, summary, traces },
      summary,
      payload: { review_report: report },
      artifacts: [{ kind: 'review_report', payload: report, requires_confirmation: false }],
      metrics: { issue_count: issueCount, mode: report.mode },
      trace: {
        tool_name: 'file.review',
        status: 'completed',
        input_summary: {
          file_path: optionalString(payload._trace_file_path) ?? filePath,
          content_chars: cpLen(content),
          ...llmContextInputSummary(payload.llm_context_snapshot),
        },
        output_summary: { issue_count: issueCount, mode: report.mode },
      },
    };
  };

  const fileRevise: ToolHandler = async (context, payload) => {
    const filePath = requiredString(payload, 'file_path');
    const traceFilePath = optionalString(payload._trace_file_path) ?? filePath;
    // 空文件也要能修订：作者建好空章节文件后直接说「写这章」，走的就是这条路。
    const content = requiredText(payload, 'content');
    const projectRoot =
      optionalString(payload.project_root) ?? optionalString(context.args.project_path);
    const instruction = optionalString(payload.instruction) ?? context.userMessage;
    const [, scope, effectiveInstruction] = await prepareRevisionScope(
      contextDeps,
      context,
      payload,
      { instruction, filePath, content, projectRoot },
    );
    const appliedScope = publicReviseScope(scope);
    const prepared = await prepareRuntimeWritingContext(
      contextDeps,
      context,
      payload,
      'file.revise',
    );
    const response = await assistantCall(() =>
      reviseFileContent(
        context.services.assistant,
        {
          file_path: filePath,
          content,
          instruction: effectiveInstruction,
          project_name: optionalString(payload.project_name),
          project_root: projectRoot,
          assistant_session_id: context.assistantSessionId,
          context_bundle: prepared.contextBundle,
        },
        { authorInstruction: context.userMessage, preparedContext: prepared, writtenFacts: true },
      ),
    );
    // 改完一字没变：不生成补丁，免得作者面对一个 +0 / -0 的「改好了」还得点接受或拒绝。
    if (response.after === response.before) {
      const unchangedSummary = '修订结果与原文一字不差，没有生成修订。';
      return {
        status: 'completed',
        output: {
          file_path: filePath,
          unchanged: true,
          summary: unchangedSummary,
          model: response.model,
          latency_ms: response.latency_ms,
          completion_tokens: response.completion_tokens,
          assistant_session_id: response.assistant_session_id,
          applied_scope: appliedScope,
        },
        summary: unchangedSummary,
        metrics: {
          after_chars: cpLen(response.after),
          completion_tokens: response.completion_tokens,
          latency_ms: response.latency_ms,
        },
        trace: {
          tool_name: 'file.revise',
          status: 'completed',
          input_summary: {
            file_path: traceFilePath,
            content_chars: cpLen(content),
            review_issue_count: scopeIssues(scope).length,
            applied_scope: appliedScope,
            ...llmContextInputSummary(payload.llm_context_snapshot),
          },
          output_summary: {
            file_path: traceFilePath,
            unchanged: true,
            model: response.model,
            latency_ms: response.latency_ms,
            completion_tokens: response.completion_tokens,
            applied_scope: appliedScope,
          },
        },
      };
    }
    let summary = reviseSummaryWithScope(response.summary, scope);
    const warning = scopeWarning(scope, response.before, response.after);
    if (warning !== null) summary = `${summary} ${warning.message}`;
    const truncation = truncationWarning(response.before, response.after);
    if (truncation !== null) summary = `${summary} ${truncation.message}`;
    // 字数没落在作者要的目标里只提示：不改确认档位、不重写。
    const lengthHint = targetLengthHint(
      revisionTargetLength([context.userMessage, instruction]),
      response.after,
    );
    if (lengthHint !== null) summary = `${summary} ${lengthHint.message}`;
    // 疑似半截的新稿不能在自动档下不经作者过目就整份落盘。
    const confirm = requiresConfirmation(context) || truncation !== null;
    const proposedPatch: Obj = {
      id: `file-revision-${deps.newHex()}`,
      kind: 'file_revision',
      file_path: filePath,
      before: response.before,
      after: response.after,
      requires_confirmation: confirm,
      approval_action: APPROVAL_ACTION,
    };
    const output: Obj = {
      file_path: filePath,
      before: response.before,
      after: response.after,
      summary,
      model: response.model,
      latency_ms: response.latency_ms,
      completion_tokens: response.completion_tokens,
      assistant_session_id: response.assistant_session_id,
      applied_scope: appliedScope,
      proposed_patch: proposedPatch,
    };
    const outputSummary: Obj = {
      file_path: traceFilePath,
      patch_id: proposedPatch.id,
      after_chars: cpLen(response.after),
      model: response.model,
      latency_ms: response.latency_ms,
      completion_tokens: response.completion_tokens,
      applied_scope: appliedScope,
    };
    if (warning !== null) {
      output.scope_warning = warning;
      outputSummary.scope_warning = warning;
    }
    if (truncation !== null) {
      output.truncation_warning = truncation;
      outputSummary.truncation_warning = truncation;
    }
    if (lengthHint !== null) {
      output.length_hint = lengthHint;
      outputSummary.length_hint = lengthHint;
    }
    return {
      status: 'completed',
      output,
      summary,
      payload: { proposed_patch: proposedPatch },
      artifacts: [
        { kind: 'proposed_patch', payload: proposedPatch, requires_confirmation: confirm },
      ],
      metrics: {
        after_chars: cpLen(response.after),
        completion_tokens: response.completion_tokens,
        latency_ms: response.latency_ms,
      },
      patch_proposal: PatchProposal.fromPayload(proposedPatch),
      trace: {
        tool_name: 'file.revise',
        status: 'completed',
        input_summary: {
          file_path: traceFilePath,
          content_chars: cpLen(content),
          review_issue_count: scopeIssues(scope).length,
          applied_scope: appliedScope,
          ...llmContextInputSummary(payload.llm_context_snapshot),
        },
        output_summary: outputSummary,
      },
    };
  };

  const fileCreate: ToolHandler = async (context, requested) => {
    const requestedPath = requiredString(requested, 'file_path');
    const requestedTrace = optionalString(requested._trace_file_path) ?? requestedPath;
    const projectRoot = optionalString(requested.project_root);
    const renamed =
      projectRoot === null
        ? null
        : await normalizedChapterPath(deps.reader, projectRoot, requestedPath, requestedTrace);
    const payload = renamed
      ? {
          ...requested,
          file_path: renamed.filePath,
          ...(requested._trace_file_path !== undefined
            ? { _trace_file_path: renamed.relativePath }
            : {}),
        }
      : requested;
    const filePath = renamed?.filePath ?? requestedPath;
    const traceFilePath = renamed?.relativePath ?? requestedTrace;
    const instruction = optionalString(payload.instruction) ?? context.userMessage;
    const prepared = await prepareRuntimeWritingContext(
      contextDeps,
      context,
      payload,
      'file.create',
    );
    const response = await assistantCall(() =>
      draftFileContent(
        context.services.assistant,
        {
          file_path: filePath,
          instruction,
          project_name: optionalString(payload.project_name),
          project_root: optionalString(payload.project_root),
          assistant_session_id: context.assistantSessionId,
          context_bundle: prepared.contextBundle,
        },
        { preparedContext: prepared },
      ),
    );
    const confirm = requiresConfirmation(context);
    const proposedPatch: Obj = {
      id: `file-creation-${deps.newHex()}`,
      kind: 'file_revision',
      created_by_tool: 'file.create',
      file_path: filePath,
      before: '',
      after: response.content,
      requires_confirmation: confirm,
      approval_action: APPROVAL_ACTION,
    };
    return {
      status: 'completed',
      output: {
        file_path: filePath,
        before: '',
        after: response.content,
        summary: response.summary,
        model: response.model,
        latency_ms: response.latency_ms,
        completion_tokens: response.completion_tokens,
        assistant_session_id: response.assistant_session_id,
        proposed_patch: proposedPatch,
      },
      summary: response.summary,
      payload: { proposed_patch: proposedPatch },
      artifacts: [
        { kind: 'proposed_patch', payload: proposedPatch, requires_confirmation: confirm },
      ],
      metrics: {
        content_chars: cpLen(response.content),
        completion_tokens: response.completion_tokens,
        latency_ms: response.latency_ms,
      },
      patch_proposal: PatchProposal.fromPayload(proposedPatch),
      trace: {
        tool_name: 'file.create',
        status: 'completed',
        input_summary: {
          file_path: traceFilePath,
          ...(renamed ? { requested_file_path: requestedTrace } : {}),
          instruction: cpSlice(instruction, 200),
          ...llmContextInputSummary(payload.llm_context_snapshot),
        },
        output_summary: {
          file_path: traceFilePath,
          content_chars: cpLen(response.content),
          model: response.model,
          patch_id: proposedPatch.id,
        },
      },
    };
  };

  /**
   * 落点优先级：模型显式 anchor_line > 作者当前光标 > 文件末尾。作者的光标才是「接着写」的真落点，
   * 但只在它指向同一个文件时复用；身份认不出就落到目标文件末尾。
   */
  async function continueCursorLine(context: ToolExecutionContext, payload: Obj, content: string) {
    const explicit = optionalInt(payload.anchor_line);
    if (explicit !== null && explicit > 0) return explicit;
    const view = authorViewFromPayload(context.args);
    const root = payload.project_root;
    const target = payload.file_path;
    if (
      view.cursor_line > 0 &&
      view.file_path &&
      typeof root === 'string' &&
      typeof target === 'string'
    ) {
      try {
        await resolveProjectRoot(reader, root);
        const resolved = await resolveScopedPath(reader, root, target.replace(/\\/g, '/'));
        const viewed = await resolveScopedPath(reader, root, view.file_path.replace(/\\/g, '/'));
        if (resolved === viewed) return view.cursor_line;
      } catch (error) {
        // 身份不明确时不复用光标（Python 吞 FsToolError / OSError / ValueError）。
        if (!(error instanceof FsToolError || error instanceof ProjectReadError)) throw error;
      }
    }
    return content.replace(/\r\n/g, '\n').split('\n').length;
  }

  const proseContinue: ToolHandler = async (context, payload) => {
    const filePath = requiredString(payload, 'file_path');
    const content = payload.content;
    if (typeof content !== 'string') throw new FsToolError('缺少正文，无法续写。');
    const targetChars = optionalInt(payload.target_chars);
    if (
      targetChars !== null &&
      !(targetChars >= TARGET_CHARS_MIN && targetChars <= TARGET_CHARS_MAX)
    )
      throw new FsToolError(`target_chars 必须在 ${TARGET_CHARS_MIN}–${TARGET_CHARS_MAX} 之间。`);
    const cursorLine = await continueCursorLine(context, payload, content);
    const anchorLine = resolveAnchorLine(content, cursorLine);
    const prepared = await prepareRuntimeWritingContext(
      contextDeps,
      context,
      payload,
      'prose.continue',
    );
    const response = await assistantCall(() =>
      draftContinuation(
        context.services.assistant,
        {
          file_path: filePath,
          content,
          cursor_line: anchorLine,
          instruction: optionalString(payload.instruction),
          project_root: optionalString(payload.project_root),
          project_name: optionalString(payload.project_name),
          assistant_session_id: context.assistantSessionId,
          target_chars: targetChars,
          context_bundle: prepared.contextBundle,
        },
        { preparedContext: prepared, deliveries: context.deliveries },
      ),
    );
    const after = insertAtAnchor(content, anchorLine, response.content);
    const insertedChars = cpLen(response.content);
    const confirm = requiresConfirmation(context);
    const proposedPatch: Obj = {
      id: `prose-continue-${deps.newHex()}`,
      kind: 'prose_continue',
      file_path: filePath,
      before: content,
      after,
      continue_audit: {
        anchor_line: anchorLine,
        cursor_line: cursorLine,
        inserted_chars: insertedChars,
      },
      requires_confirmation: confirm,
      approval_action: APPROVAL_ACTION,
    };
    // 无论权限档位，后端此时只生成提案，不能冒称 Desktop 已完成写回。
    const note = confirm ? '等你确认后才会写进文件。' : '将由编辑器按作品权限写进文件。';
    const summary = `已在第 ${anchorLine} 行之后续写约 ${insertedChars} 字，${note}`;
    return {
      status: 'completed',
      output: {
        file_path: filePath,
        before: content,
        after,
        summary,
        model: response.model,
        latency_ms: response.latency_ms,
        completion_tokens: response.completion_tokens,
        assistant_session_id: response.assistant_session_id,
        anchor_line: anchorLine,
        inserted_chars: insertedChars,
        proposed_patch: proposedPatch,
      },
      summary,
      payload: { proposed_patch: proposedPatch },
      artifacts: [
        { kind: 'proposed_patch', payload: proposedPatch, requires_confirmation: confirm },
      ],
      metrics: {
        inserted_chars: insertedChars,
        completion_tokens: response.completion_tokens,
        latency_ms: response.latency_ms,
      },
      patch_proposal: PatchProposal.fromPayload(proposedPatch),
      trace: {
        tool_name: 'prose.continue',
        status: 'completed',
        input_summary: {
          file_path: optionalString(payload._trace_file_path) ?? basename(filePath),
          anchor_line: anchorLine,
          target_chars: targetChars,
          ...llmContextInputSummary(payload.llm_context_snapshot),
        },
        output_summary: { inserted_chars: insertedChars, anchor_line: anchorLine },
      },
    };
  };

  const trimProse: ToolHandler = async (context, payload) => {
    const filePath = requiredString(payload, 'file_path');
    const content = requiredString(payload, 'content');
    const targetPercent = optionalInt(payload.target_percent) || 15;
    if (targetPercent < 1 || targetPercent > 50)
      throw new FsToolError('target_percent 必须在 1–50 之间。');
    const bundle = payload.llm_prompt_context_bundle || payload.context_bundle;
    const response = await assistantCall(() =>
      reviseFileContent(context.services.assistant, {
        file_path: filePath,
        content,
        instruction: trimProseInstruction(targetPercent),
        project_name: optionalString(payload.project_name),
        project_root: optionalString(payload.project_root),
        assistant_session_id: context.assistantSessionId,
        context_bundle: (bundle || null) as AssistantContextBundle | null,
      }),
    );
    const originalChars = cpLen(content);
    const compressedChars = cpLen(response.after);
    // Python 的 round(x, 1)：按真实二进制值四舍六入，结果仍是浮点，文案按 repr 写。
    const actualPercent = originalChars
      ? Number(pythonFixed((1 - compressedChars / originalChars) * 100, 1))
      : 0;
    const percentText = originalChars ? pythonFloatRepr(actualPercent) : '0';
    const trimAudit = {
      original_chars: originalChars,
      compressed_chars: compressedChars,
      target_percent: targetPercent,
      actual_percent: actualPercent,
    };
    // 压完一字没变：不出补丁，免得作者对着 +0 / -0 的「压缩完成」还要点接受（同 file.revise）。
    if (response.after === response.before) {
      const unchangedSummary = `压缩结果与原文一字不差（${originalChars} 字），没有生成修订。`;
      return {
        status: 'completed',
        output: {
          file_path: filePath,
          unchanged: true,
          summary: unchangedSummary,
          model: response.model,
          latency_ms: response.latency_ms,
          completion_tokens: response.completion_tokens,
          assistant_session_id: response.assistant_session_id,
          trim_audit: trimAudit,
        },
        summary: unchangedSummary,
        metrics: {
          after_chars: compressedChars,
          completion_tokens: response.completion_tokens,
          latency_ms: response.latency_ms,
          compression_percent: actualPercent,
        },
        trace: {
          tool_name: 'project.trim_prose',
          status: 'completed',
          input_summary: { file_path: filePath, target_percent: targetPercent },
          output_summary: {
            original_chars: originalChars,
            compressed_chars: compressedChars,
            compression_percent: actualPercent,
            unchanged: true,
          },
        },
      };
    }
    const confirm = requiresConfirmation(context);
    const proposedPatch: Obj = {
      id: `prose-trim-${deps.newHex()}`,
      kind: 'prose_trim',
      file_path: filePath,
      before: response.before,
      after: response.after,
      trim_audit: trimAudit,
      requires_confirmation: confirm,
      approval_action: APPROVAL_ACTION,
    };
    const summary = `压缩完成：${originalChars} → ${compressedChars} 字（${percentText}%），目标 ${targetPercent}%。`;
    return {
      status: 'completed',
      output: {
        file_path: filePath,
        before: response.before,
        after: response.after,
        summary,
        model: response.model,
        latency_ms: response.latency_ms,
        completion_tokens: response.completion_tokens,
        assistant_session_id: response.assistant_session_id,
        trim_audit: trimAudit,
        proposed_patch: proposedPatch,
      },
      summary,
      payload: { proposed_patch: proposedPatch },
      artifacts: [
        { kind: 'proposed_patch', payload: proposedPatch, requires_confirmation: confirm },
      ],
      metrics: {
        after_chars: compressedChars,
        completion_tokens: response.completion_tokens,
        latency_ms: response.latency_ms,
        compression_percent: actualPercent,
      },
      patch_proposal: PatchProposal.fromPayload(proposedPatch),
      trace: {
        tool_name: 'project.trim_prose',
        status: 'completed',
        input_summary: { file_path: filePath, target_percent: targetPercent },
        output_summary: {
          original_chars: originalChars,
          compressed_chars: compressedChars,
          compression_percent: actualPercent,
        },
      },
    };
  };

  /** 对生成内容做确定性轻量自检（file.revise 固定管线产字后调用）。 */
  const judgeRun: ToolHandler = async (_context, payload) => {
    const content = String(payload.content || '');
    const issueCount = ['这说明', '其实', '显然'].some((marker) => content.includes(marker))
      ? 1
      : 0;
    const output = { issue_count: issueCount, mode: 'proposed_patch_smoke' };
    const result: ToolResult = {
      status: 'completed',
      output,
      trace: {
        tool_name: 'judge.run',
        status: 'completed',
        input_summary: { content_chars: cpLen(content), mode: 'proposed_patch_smoke' },
        output_summary: output,
      },
    };
    return result;
  };

  return {
    'file.review': fileReview,
    'file.revise': fileRevise,
    'file.create': fileCreate,
    'prose.continue': proseContinue,
    'project.trim_prose': trimProse,
    'judge.run': judgeRun,
  };
}
