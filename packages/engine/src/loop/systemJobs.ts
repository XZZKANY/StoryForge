import { compactText, PYTHON_WHITESPACE, pythonStrip } from '../kernel/pythonText';
import type { SecretContext } from '../kernel/redaction';
import type { ChatResponse } from '../llm/contracts';
import { RunInterrupted, type RunControl } from '../llm/control';
import { errorUsageSummary } from '../llm/client';
import { LlmConfigError, requiredEnv, type LlmSource } from '../llm/config';
import { ProviderError } from '../llm/contracts';
import type { ModelObservation } from '../llm/observation';
import { LlmError } from '../llm/payload';
import type { AssistantStore } from '../assistant/service';
import {
  COMPACTION_CHAR_THRESHOLD,
  COMPACTION_MESSAGE_THRESHOLD,
  COMPACTION_RETAINED_MESSAGE_COUNT,
  CompactionRejected,
  ContextBudgetError,
  createCompactionCheckpoint,
  messageSources,
  SYSTEM_COMPACTION_ARTIFACT_KIND,
  type CompactionProvider,
  type ConversationSources,
  type MessageRow,
} from './conversationHistory';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const cpLen = (text: string) => Array.from(text).length;

export const TITLE_JOB_NAME = 'conversation.title.generate';
export const SUMMARY_JOB_NAME = 'conversation.summary.update';
export const COMPACTION_JOB_NAME = 'conversation.compact';
export const SYSTEM_SUMMARY_ARTIFACT_KIND = 'system_summary';
const DEFAULT_TITLE = '新的创作会话';

/** 一个隐藏系统任务：事件载荷、写进结果的投影，以及可选的 artifact。 */
export type SystemJobPlan = {
  readonly key: string;
  readonly eventPayload: Obj;
  readonly resultPayload: Obj;
  readonly artifactKind: string | null;
  readonly artifactPayload: Obj | null;
};

type MessageRecord = { id: number | null; role: string; content: string };

const MENTION = new RegExp(`@(?:(?!${PYTHON_WHITESPACE})[\\s\\S])+`, 'gu');
const WHITESPACE = new RegExp(`${PYTHON_WHITESPACE}+`, 'gu');
const PUNCTUATION = /[，。！？!?；;：:,.、`*_#[\]（）()<>《》"'“”‘’]/gu;
const TITLE_PREFIXES = ['请帮我', '帮我', '请你', '请', '我想', '我要', '把这个', '把当前', '这个'];

/** 确定性标题：去掉 @提及、空白与标点、常见请求前缀，最多 18 个字。 */
export function deriveTitle(text: string): string {
  let compact = text.replace(MENTION, '').replace(WHITESPACE, '');
  compact = pythonStrip(compact.replace(PUNCTUATION, ''));
  const prefix = TITLE_PREFIXES.find((item) => compact.startsWith(item));
  if (prefix !== undefined) compact = compact.slice(prefix.length);
  compact = compact
    .split('当前章节的结构人物和节奏')
    .join('当前章节审稿')
    .split('当前章节的结构与节奏')
    .join('当前章节审稿');
  return Array.from(compact).slice(0, 18).join('') || DEFAULT_TITLE;
}

function shouldUpdateTitle(title: string): boolean {
  const stripped = pythonStrip(title);
  return !stripped || stripped === DEFAULT_TITLE || stripped.startsWith('IDE Agent:');
}

const strippedText = (value: unknown): string | null =>
  typeof value === 'string' && pythonStrip(value) ? pythonStrip(value) : null;

function messageRecords(messages: readonly MessageRow[]): MessageRecord[] {
  return messages
    .filter((message) => typeof message.role === 'string' && typeof message.content === 'string')
    .map((message) => ({
      id: Number.isInteger(message.id) ? message.id : null,
      role: message.role,
      content: message.content,
    }));
}

const firstUserMessage = (records: MessageRecord[]) =>
  records.find((record) => record.role === 'user' && pythonStrip(record.content))?.content ?? null;

function lastRoleMessage(records: MessageRecord[], role: string): string | null {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (record.role === role && pythonStrip(record.content))
      return compactText(record.content, 600);
  }
  return null;
}

function titleJob(sessionId: number, currentTitle: string, records: MessageRecord[], result: Obj) {
  const first = firstUserMessage(records);
  const sourceText = first ?? strippedText(result.user_message) ?? currentTitle;
  const output: Obj = {
    job_name: TITLE_JOB_NAME,
    actor: 'system-title-agent',
    hidden: true,
    mode: 'deterministic',
    status: 'completed',
    assistant_session_id: sessionId,
    title: deriveTitle(sourceText),
    updated_session_title: shouldUpdateTitle(currentTitle),
  };
  return {
    key: 'title',
    eventPayload: {
      ...output,
      message: '隐藏标题任务已生成会话标题。',
      source: first ? 'first_user_message' : 'agent_result',
    },
    resultPayload: output,
    artifactKind: null,
    artifactPayload: null,
  };
}

function summaryJob(sessionId: number, records: MessageRecord[], result: Obj): SystemJobPlan {
  const agent = isObj(result.agent_result) ? result.agent_result : {};
  const toolTrace = Array.isArray(result.tool_trace) ? result.tool_trace : [];
  const report = isObj(agent.review_report) ? agent.review_report : {};
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const summary = strippedText(agent.summary) ?? 'AgentRun 已完成。';
  const payload: Obj = {
    kind: SYSTEM_SUMMARY_ARTIFACT_KIND,
    job_name: SUMMARY_JOB_NAME,
    hidden: true,
    mode: 'deterministic',
    assistant_session_id: sessionId,
    intent: result.intent ?? null,
    message_count: records.length,
    last_user_message: lastRoleMessage(records, 'user'),
    assistant_summary: compactText(summary, 600),
    tool_count: toolTrace.length,
    review_issue_count: issues.length,
    requires_user_confirmation: Boolean(
      agent.requires_user_confirmation || agent.confirmation_required,
    ),
  };
  const output: Obj = {
    job_name: SUMMARY_JOB_NAME,
    actor: 'system-summary-agent',
    hidden: true,
    mode: 'deterministic',
    status: 'completed',
    assistant_session_id: sessionId,
    summary: payload.assistant_summary,
    message_count: payload.message_count,
    tool_count: payload.tool_count,
    review_issue_count: payload.review_issue_count,
  };
  return {
    key: 'summary',
    eventPayload: { ...output, message: '隐藏摘要任务已更新会话摘要。' },
    resultPayload: output,
    artifactKind: SYSTEM_SUMMARY_ARTIFACT_KIND,
    artifactPayload: payload,
  };
}

const COMPACTION_OUTPUT_KEYS = new Set([
  'status',
  'assistant_session_id',
  'covered_through_message_id',
  'message_count',
  'compacted_message_count',
  'retained_message_count',
  'summary',
  'code',
]);

/** 标题 / 短摘要是确定性的；只有校验过的模型检查点才能发布压缩。 */
export function buildConversationSystemJobs(input: {
  assistantSessionId: number;
  currentTitle: string;
  messages: readonly MessageRow[];
  result: Obj;
  compactionPayload: Obj | null;
}): SystemJobPlan[] {
  const records = messageRecords(input.messages);
  const jobs: SystemJobPlan[] = [
    titleJob(input.assistantSessionId, input.currentTitle, records, input.result),
    summaryJob(input.assistantSessionId, records, input.result),
  ];
  if (input.compactionPayload !== null) jobs.push(compactionJob(input.compactionPayload));
  return jobs;
}

/** 压缩任务的事件 / 结果投影；只有校验过的检查点才带 artifact。 */
export function compactionJob(compaction: Obj): SystemJobPlan {
  const output: Obj = Object.fromEntries(
    Object.entries(compaction).filter(([key]) => COMPACTION_OUTPUT_KEYS.has(key)),
  );
  Object.assign(output, {
    job_name: COMPACTION_JOB_NAME,
    actor: 'system-compaction-agent',
    hidden: true,
    mode: 'model_checkpoint',
  });
  const completed = output.status === 'completed';
  return {
    key: 'compaction',
    eventPayload: {
      ...output,
      message: completed ? '隐藏压缩检查点已验证。' : '压缩未发布；原始历史和旧有效检查点保留。',
    },
    resultPayload: output,
    artifactKind: completed ? SYSTEM_COMPACTION_ARTIFACT_KIND : null,
    artifactPayload: completed ? compaction : null,
  };
}

export type CompactionDeps = {
  readonly conversation: ConversationSources;
  readonly assistant: AssistantStore;
  readonly source: LlmSource;
  readonly secrets: SecretContext;
  /** 按配置装配模型；配置不全时抛 LlmConfigError。 */
  readonly buildProvider: (source: LlmSource) => CompactionProvider;
  readonly control: RunControl | null;
  readonly observation: ModelObservation | null;
};

/** 一次压缩：只调一次模型，用量另记一条工具调用；失败不伪造摘要。 */
export async function prepareConversationCompaction(
  deps: CompactionDeps,
  sessionId: number,
): Promise<Obj | null> {
  const messages = await messageSources(deps.conversation, sessionId);
  if (
    messages.length <= COMPACTION_MESSAGE_THRESHOLD &&
    messages.reduce((sum, source) => sum + cpLen(source.content), 0) <= COMPACTION_CHAR_THRESHOLD
  )
    return null;
  const inputSummary = { purpose: 'context_checkpoint', source_message_count: messages.length };
  let responseRecorded = false;
  const recordUsage = async (response: ChatResponse) => {
    await deps.assistant.createToolCall(sessionId, {
      tool_name: 'conversation.compact',
      status: response.finishReason === 'stop' ? 'completed' : 'failed',
      input_summary: inputSummary,
      output_summary: {
        finish_reason: response.finishReason,
        ...response.usage.toLegacy(),
        checkpoint_publication: 'separate_artifact',
      },
    });
    responseRecorded = true;
  };
  const recordFailedUsage = async (error: unknown, status: 'paused' | 'failed') => {
    if (responseRecorded) return;
    await deps.assistant.createToolCall(sessionId, {
      tool_name: 'conversation.compact',
      status,
      input_summary: inputSummary,
      output_summary: { ...errorUsageSummary(error), checkpoint_publication: 'not_published' },
    });
  };
  try {
    return await createCompactionCheckpoint(deps.conversation, sessionId, {
      provider: deps.buildProvider(deps.source),
      model: requiredEnv(deps.source, 'STORYFORGE_LLM_MODEL'),
      secrets: deps.secrets,
      control: deps.control,
      observation: deps.observation,
      // 分片时每次请求各记一条用量；失败的那次也要记，不被前面成功的请求挡掉。
      onRequestStart: () => {
        responseRecorded = false;
      },
      onResponse: recordUsage,
    });
  } catch (error) {
    if (error instanceof RunInterrupted) {
      await recordFailedUsage(error, 'paused');
      throw error;
    }
    if (
      !(
        error instanceof LlmConfigError ||
        error instanceof LlmError ||
        error instanceof ProviderError ||
        error instanceof CompactionRejected ||
        error instanceof ContextBudgetError
      )
    )
      throw error;
    if (error instanceof LlmError || error instanceof ProviderError)
      await recordFailedUsage(error, 'failed');
    return {
      status: 'failed',
      assistant_session_id: sessionId,
      code: error instanceof ContextBudgetError ? 'context_budget' : 'compaction_rejected',
      message_count: messages.length,
      compacted_message_count: Math.max(0, messages.length - COMPACTION_RETAINED_MESSAGE_COUNT),
      retained_message_count: Math.min(messages.length, COMPACTION_RETAINED_MESSAGE_COUNT),
    };
  }
}
