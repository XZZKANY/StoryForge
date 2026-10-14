import {
  AssistantLlmNotConfiguredError,
  AssistantReviseError,
  chatReply,
  draftFileContent,
  reviseFileContent,
} from '../../assistant/service';
import { dumpJson } from '../../kernel/json';
import { llmContextSnapshotTraceSummary } from '../../kernel/llmContext';
import { buildCheck, checkPrompt } from '../chapterCheckProtocol';
import { prepareChapterWritingContext } from '../chapterSourceGuard';
import {
  briefPrompt,
  draftInstruction,
  parseBrief,
  repairInstruction,
} from '../chapterWritingContracts';
import { AgentOrchestrationError } from '../runPayloads';
import type { ToolHandler } from './execution';
import type { ToolDeps } from './handlerDeps';

type Obj = { [key: string]: unknown };
const cpLen = (text: string) => Array.from(text).length;

/** chapter.brief / draft / check / repair：写章管线的四步，各自落证据（adapters/chapter_writing_tools）。 */
export function chapterWritingToolHandlers(deps: ToolDeps): Record<string, ToolHandler> {
  const guardDeps = { reader: deps.reader, platform: deps.platform, secrets: deps.secrets };

  const brief: ToolHandler = async (context, payload) => {
    const seed = payload.seed as Obj;
    const provenance = llmContextSnapshotTraceSummary(
      payload.llm_context_snapshot as Parameters<typeof llmContextSnapshotTraceSummary>[0],
    );
    let parsed: Obj;
    try {
      const chat = await chatReply(context.services.assistant, {
        userMessage: briefPrompt(seed, context.userMessage),
        contextBlock: dumpJson(payload.llm_prompt_context_bundle, { ensureAscii: false }),
        assistantSessionId: context.assistantSessionId,
      });
      parsed = parseBrief(chat.reply, { seed, provenance, newHex: deps.newHex });
    } catch (error) {
      if (
        error instanceof AssistantLlmNotConfiguredError ||
        error instanceof AssistantReviseError ||
        error instanceof AgentOrchestrationError
      )
        throw new AgentOrchestrationError(error.message);
      throw error;
    }
    return {
      status: 'completed',
      output: { brief: parsed },
      trace: {
        tool_name: 'chapter.brief',
        status: 'completed',
        input_summary: { target_path: parsed.target_path, ...provenance },
        output_summary: { brief_id: parsed.brief_id, revision: parsed.revision },
      },
    };
  };

  const draft: ToolHandler = async (context, payload) => {
    const confirmed = payload.brief as Obj;
    const prepared = await prepareChapterWritingContext(guardDeps, {
      root: payload.project_root as string,
      target: payload.target_relative as string,
      bundle: payload.llm_prompt_context_bundle as Obj,
      guard: payload.source_guard as Obj,
      content: '',
      intent: 'file.create',
    });
    const response = await draftFileContent(
      context.services.assistant,
      {
        file_path: payload.target_absolute as string,
        instruction: draftInstruction(confirmed),
        project_name: (payload.project_name ?? null) as string | null,
        project_root: payload.project_root as string,
        assistant_session_id: context.assistantSessionId,
        context_bundle: prepared.contextBundle,
      },
      { preparedContext: prepared },
    );
    return {
      status: 'completed',
      output: { content: response.content, model: response.model },
      trace: {
        tool_name: 'chapter.draft',
        status: 'completed',
        input_summary: { brief_id: confirmed.brief_id, target_path: payload.target_relative },
        output_summary: { content_chars: cpLen(response.content), model: response.model },
      },
    };
  };

  const check: ToolHandler = async (context, payload) => {
    const confirmed = payload.brief as Obj;
    const content = payload.content as string;
    let raw: unknown = null;
    let providerFailed = false;
    try {
      const chat = await chatReply(context.services.assistant, {
        userMessage: checkPrompt(confirmed, content),
        contextBlock: '',
        assistantSessionId: context.assistantSessionId,
      });
      raw = chat.reply;
    } catch (error) {
      if (
        !(error instanceof AssistantLlmNotConfiguredError || error instanceof AssistantReviseError)
      )
        throw error;
      providerFailed = true;
    }
    const result = buildCheck(content, confirmed, raw, { providerFailed });
    // 通用的步骤词表没有「未完成」：精确状态留在摘要里，未完成的检查绝不显示成通过。
    const status = result.execution_status === 'completed' ? 'completed' : 'failed';
    return {
      status,
      output: { check: result },
      trace: {
        tool_name: 'chapter.check',
        status,
        input_summary: { brief_id: confirmed.brief_id, attempt: payload.attempt },
        output_summary: {
          status: result.status,
          execution_status: result.execution_status,
          execution_code: result.execution_code,
          coverage: result.coverage,
          manuscript_status: result.manuscript_status,
          manuscript_hard_failure_count: result.manuscript_hard_failure_count,
          hard_failure_count: result.hard_failure_count,
          advisory_count: result.advisory_count,
        },
      },
    };
  };

  const repair: ToolHandler = async (context, payload) => {
    const confirmed = payload.brief as Obj;
    const findings = payload.check as Obj;
    const content = payload.content as string;
    const prepared = await prepareChapterWritingContext(guardDeps, {
      root: payload.project_root as string,
      target: payload.target_relative as string,
      bundle: payload.llm_prompt_context_bundle as Obj,
      guard: payload.source_guard as Obj,
      content,
      intent: 'file.revise',
    });
    const response = await reviseFileContent(
      context.services.assistant,
      {
        file_path: payload.target_absolute as string,
        content,
        instruction: repairInstruction(findings, confirmed),
        project_name: (payload.project_name ?? null) as string | null,
        project_root: payload.project_root as string,
        assistant_session_id: context.assistantSessionId,
        context_bundle: prepared.contextBundle,
      },
      { preparedContext: prepared },
    );
    return {
      status: 'completed',
      output: { content: response.after, model: response.model },
      trace: {
        tool_name: 'chapter.repair',
        status: 'completed',
        input_summary: {
          brief_id: confirmed.brief_id,
          hard_failure_count: findings.hard_failure_count,
        },
        output_summary: { content_chars: cpLen(response.after), model: response.model },
      },
    };
  };

  return {
    'chapter.brief': brief,
    'chapter.draft': draft,
    'chapter.check': check,
    'chapter.repair': repair,
  };
}
