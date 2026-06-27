/**
 * 对话窗口
 * 显示完整的消息历史流，并驱动 Agent 作者闭环。
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  AUTHOR_LOOP_RESULT_EVENT,
  emitAcceptCurrentFileSuggestion,
  emitExportCurrentFile,
  emitFileSuggestion,
  emitReviewIssues,
  emitSuggestionResult,
  flushActiveEditorToDisk,
  REVIEW_CURRENT_EVENT,
  REVISE_ISSUE_EVENT,
  SUGGESTION_RESULT_EVENT,
  type AuthorLoopResult,
  type SuggestionResult,
} from '../lib/assistant-events';
import { createRemoteFileSuggestion } from '../lib/assistant-suggestions';
import {
  AGENT_ROLE_SUGGESTIONS,
  extractAgentRoleMentions,
  isKnownAgentRoleMention,
  mapAgentRoleMentionsToHints,
} from '../lib/agent-roles';
import {
  getAssistantSession,
  sendAgentControlMessage,
  sendAgentUserMessage,
  subscribeWritingRunEvents,
  toAssistantContextBundlePayload,
  isAgentControlAckMessage,
  isAgentErrorMessage,
  isAgentPermissionRequiredMessage,
  isAgentRunStartedMessage,
  isAgentStepEventMessage,
  isAgentToolTraceEventMessage,
  isAgentResultMessage,
  type AgentControlMessageType,
  type AgentPlanStep,
  type AgentResultMessage,
  type AgentSocketMessage,
  type AgentToolTrace,
  type WritingRunEvent,
} from '../lib/api-client';
import {
  detectLocalConversationAction,
  type LocalConversationAction,
} from '../lib/local-conversation-action';
import {
  buildContextBundle,
  buildProjectIndex,
  classifyRelativePath,
  relativeToProject,
  semanticKindLabel,
  type ContextBundle,
  type ContextBundleFile,
  type SemanticFile,
} from '../lib/project-context';
import { TauriFileSystem } from '../lib/tauri-fs';
import { AgentStepsPanel } from './AgentStepsPanel';

type ChatWindowProps = {
  projectPath: string | null;
  currentFile: string | null;
  assistantSessionId?: number | null;
  layoutMode?: 'normal' | 'custom' | 'assistant-only' | 'workspace-only';
  onCollapse?: () => void;
  onFocusOnly?: () => void;
  onRestoreLayout?: () => void;
  onAssistantSessionChange?: (assistantSessionId: number | null) => void;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type AgentStepStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed';

type AgentStep = {
  id: string;
  title: string;
  tool: string;
  status: AgentStepStatus;
  detail: string;
};

type AgentRun = {
  id: string;
  sessionId: string;
  goal: string;
  status: 'running' | 'waiting' | 'completed' | 'failed';
  steps: AgentStep[];
};

type RetryRequest = {
  goal: string;
  action: LocalConversationAction;
  intent?: 'file.revise';
};

type WritingRunProjection = {
  writingRunId: number;
  status: string;
  currentChapterIndex: number | null;
  totalChapters: number | null;
  completedCount: number | null;
  latestEvent: string;
  failureReason?: string | null;
};

type AgentRunControlHandlers = {
  onApprovePermission: () => void;
  onDenyPermission: () => void;
  onPauseRun: () => void;
  onResumeRun: () => void;
  onStopRun: () => void;
};

type ReviewReport = Record<string, unknown>;
type ReviewCategory = 'plot' | 'character' | 'prose' | 'continuity';
type ReviewIssue = {
  id: string;
  category: ReviewCategory;
  severity: string;
  message: string;
  evidence: string;
  suggestedAction: string;
};

type ContextAppendResult = {
  bundle: ContextBundle;
  missingPaths: string[];
};

export type StableAgentRequestPayload = {
  project_path: string;
  current_file: string;
  file_path: string;
  content: string;
  instruction: string;
  context: string;
  selection: string;
  project_name: string | null;
  assistant_session_id: number | null;
  context_bundle: ReturnType<typeof toAssistantContextBundlePayload>;
  review_report?: ReviewReport;
  selected_issue_ids?: string[];
  included_categories?: ReviewCategory[];
};

function basename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function relativePath(projectPath: string | null, filePath: string): string {
  if (!projectPath) return basename(filePath);
  const root = projectPath.replace(/[/\\]+$/, '');
  if (filePath.startsWith(root)) {
    return filePath.slice(root.length).replace(/^[/\\]+/, '');
  }
  return basename(filePath);
}

function joinProjectPath(projectPath: string, child: string): string {
  const separator = projectPath.includes('\\') ? '\\' : '/';
  return `${projectPath.replace(/[/\\]+$/, '')}${separator}${child.replace(/^[/\\]+/, '')}`;
}

function looksAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(path) || path.startsWith('/') || path.startsWith('\\');
}

function extractContextReferences(text: string): string[] {
  const matches = Array.from(text.matchAll(/@([^\s，。！？!?；;：:,、]+)/g));
  return matches
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => !isKnownAgentRoleMention(`@${value}`));
}

function mapAgentStepStatus(status: string): AgentStepStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'needs_approval' || status === 'needs_confirmation' || status === 'paused')
    return 'waiting';
  if (status === 'running') return 'running';
  return 'pending';
}

function planStepTitle(step: string): string {
  const titleByStep: Record<string, string> = {
    intent: '识别意图',
    respond: '生成回答',
    revise: '生成修订',
    approval: '等待作者确认',
    load_scene_packet: '读取场景包',
    'judge.run': '运行 Judge',
    'judge.repair': '生成修复建议',
    'bookrun.start': '启动写作任务',
    'context-agent': '选择上下文',
    'plot-agent': '剧情结构审稿',
    'character-agent': '人物一致性审稿',
    'prose-agent': '文风节奏审稿',
    'synthesizer-agent': '合并审稿报告',
    audit: '记录审计',
  };
  return titleByStep[step] ?? step;
}

function toolTraceDetail(trace: AgentToolTrace): string {
  if (trace.error_message) return trace.error_message;
  const output = trace.output_summary ?? {};
  const audit = trace.audit_event_id ? `；审计 ${trace.audit_event_id}` : '';
  const model = typeof output.model === 'string' ? `；模型 ${output.model}` : '';
  const latency = typeof output.latency_ms === 'number' ? `；${output.latency_ms}ms` : '';
  const contextCount =
    typeof output.context_file_count === 'number' ? `；上下文 ${output.context_file_count} 个` : '';
  const issueCount =
    typeof output.issue_count === 'number' ? `；问题 ${output.issue_count} 个` : '';
  const actionCount =
    typeof output.suggested_action_count === 'number'
      ? `；建议 ${output.suggested_action_count} 条`
      : '';
  return `${trace.status}${model}${latency}${contextCount}${issueCount}${actionCount}${audit}`;
}

function stepsFromAgentResult(message: AgentResultMessage): AgentStep[] {
  const planSteps = message.plan.map((step: AgentPlanStep, index) => ({
    id: `plan-${index}-${step.step}`,
    title: planStepTitle(step.step),
    tool: step.step,
    status: mapAgentStepStatus(step.status),
    detail: step.detail,
  }));
  const toolSteps = message.tool_trace.map((trace: AgentToolTrace, index) => ({
    id: `tool-${index}-${trace.tool_name}`,
    title: trace.tool_name,
    tool: trace.tool_name,
    status: mapAgentStepStatus(trace.status),
    detail: toolTraceDetail(trace),
  }));
  return [...planSteps, ...toolSteps];
}

function stepFromAgentPlanEvent(
  index: number,
  step: string,
  detail: string,
  status: string,
): AgentStep {
  return {
    id: `plan-${index}-${step}`,
    title: planStepTitle(step),
    tool: step,
    status: mapAgentStepStatus(status),
    detail,
  };
}

function stepFromToolTraceEvent(index: number, trace: AgentToolTrace): AgentStep {
  return {
    id: `tool-${index}-${trace.tool_name}`,
    title: trace.tool_name,
    tool: trace.tool_name,
    status: mapAgentStepStatus(trace.status),
    detail: toolTraceDetail(trace),
  };
}

function contextBudgetText(bundle: ContextBundle | null): string {
  if (!bundle) return '上下文尚未生成';
  const kinds = Object.entries(bundle.summary.counts)
    .filter(([, count]) => count > 0)
    .slice(0, 4)
    .map(([kind, count]) => `${semanticKindLabel(kind as ContextBundleFile['kind'])}${count}`)
    .join('、');
  const budget = bundle.budget;
  const truncated = budget.truncated ? '；已截断' : '';
  const pinned = budget.pinnedFileCount ? `；pin ${budget.pinnedFileCount}` : '';
  return `上下文 ${budget.fileCount}/${budget.maxFiles} 文件，${budget.charCount} 字符${pinned}${truncated}${kinds ? `；${kinds}` : ''}`;
}

function selectedContextPreview(bundle: ContextBundle | null): string {
  if (!bundle || bundle.files.length === 0) return '本轮还没有选入额外上下文';
  return bundle.files
    .slice(0, 4)
    .map((file) => file.relativePath)
    .join('、');
}

function fileRevisionPatch(message: AgentResultMessage): {
  id?: string;
  file_path: string;
  before: string;
  after: string;
} | null {
  const patch = message.proposed_patch;
  if (!patch || patch.kind !== 'file_revision') return null;
  if (
    typeof patch.file_path === 'string' &&
    typeof patch.before === 'string' &&
    typeof patch.after === 'string'
  ) {
    return {
      id: typeof patch.id === 'string' ? patch.id : undefined,
      file_path: patch.file_path,
      before: patch.before,
      after: patch.after,
    };
  }
  return null;
}

function modelFromToolTrace(message: AgentResultMessage): string {
  for (const trace of message.tool_trace) {
    const model = trace.output_summary?.model;
    if (typeof model === 'string' && model.trim()) return model;
  }
  return 'StoryForge Agent';
}

function issueIdsFromAgentResult(message: AgentResultMessage): string[] {
  const scope = message.agent_result.applied_scope;
  if (!scope || typeof scope !== 'object') return [];
  const ids = (scope as { issue_ids?: unknown }).issue_ids;
  return Array.isArray(ids) ? ids.filter((item): item is string => typeof item === 'string') : [];
}

export function scopeWarningFromAgentResult(message: AgentResultMessage): string | null {
  const warning = message.agent_result.scope_warning;
  if (!warning || typeof warning !== 'object') return null;
  const text = (warning as { message?: unknown }).message;
  return typeof text === 'string' && text.trim() ? text : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function writingRunIdFromResult(message: AgentResultMessage): number | null {
  return (
    numberOrNull(message.agent_result.writing_run_id) ??
    numberOrNull(message.agent_result.writing_run?.writing_run_id) ??
    numberOrNull(message.agent_result.book_run_id) ??
    numberOrNull(message.agent_result.book_run?.id)
  );
}

export function applyWritingRunEventProjection(
  current: WritingRunProjection | null,
  event: WritingRunEvent,
): WritingRunProjection | null {
  const writingRun = event.data.writing_run;
  const writingRunId =
    numberOrNull(event.data.writing_run_id) ??
    (writingRun && typeof writingRun === 'object'
      ? numberOrNull((writingRun as { writing_run_id?: unknown }).writing_run_id)
      : null);
  const resolvedWritingRunId =
    writingRunId ?? numberOrNull(event.data.book_run_id) ?? current?.writingRunId ?? null;
  if (resolvedWritingRunId === null) return current;
  if (event.event === 'progress') {
    return {
      writingRunId: resolvedWritingRunId,
      status:
        typeof event.data.status === 'string' ? event.data.status : (current?.status ?? 'running'),
      currentChapterIndex:
        numberOrNull(event.data.current_chapter_index) ?? current?.currentChapterIndex ?? null,
      totalChapters: numberOrNull(event.data.total_chapters) ?? current?.totalChapters ?? null,
      completedCount: numberOrNull(event.data.completed_count) ?? current?.completedCount ?? null,
      latestEvent: 'progress',
      failureReason: current?.failureReason ?? null,
    };
  }
  const blocked = event.data.blocked_chapter;
  const failureReason =
    typeof event.data.pause_reason === 'string'
      ? event.data.pause_reason
      : blocked && typeof blocked === 'object'
        ? '存在阻塞章节'
        : (current?.failureReason ?? null);
  return {
    writingRunId: resolvedWritingRunId,
    status: current?.status ?? 'running',
    currentChapterIndex: current?.currentChapterIndex ?? null,
    totalChapters: current?.totalChapters ?? null,
    completedCount: current?.completedCount ?? null,
    latestEvent: event.event,
    failureReason,
  };
}

function deriveConversationTitle(text: string): string {
  const compact = text
    .replace(/\s+/g, '')
    .replace(/[，。！？!?；;：:,.、]/g, '')
    .trim();
  if (!compact) return '新的创作会话';

  const title = compact
    .replace(/^请?帮我?/, '')
    .replace(/^我想/, '')
    .slice(0, 12);
  return title || '新的创作会话';
}

function toConversationMessage(role: string, content: string): Message | null {
  if (role !== 'user' && role !== 'assistant') return null;
  return { role, content };
}

function compactConversationMessages(
  messages: Array<{ role: string; content: string }>,
): Message[] {
  return messages
    .map((message) => toConversationMessage(message.role, message.content))
    .filter((message): message is Message => message !== null);
}

function titleFromSystemJobs(message: AgentResultMessage): string | null {
  const title = message.system_jobs?.title?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}

// 审稿可能在真实模型未配置或调用失败时静默降级为启发式关键词检查；
// 把来源标注透出来，避免把启发式结果误当成真模型审稿。
function reviewSourceLine(
  mode: unknown,
  agentFindings: Record<string, { degraded_reason?: unknown }> | undefined,
): string | null {
  const reasons = agentFindings
    ? Object.values(agentFindings)
        .map((finding) =>
          finding && typeof finding.degraded_reason === 'string' ? finding.degraded_reason : null,
        )
        .filter((reason): reason is string => Boolean(reason))
    : [];
  const reasonTail = reasons.length ? `（${reasons[0]}）` : '';
  switch (mode) {
    case 'llm':
      return '审稿来源：真实模型三视角（剧情 / 人物 / 文风）。';
    case 'mixed':
      return `⚠ 审稿来源：部分视角真实模型、部分降级为启发式关键词检查${reasonTail}。`;
    case 'llm_failed':
      return `⚠ 审稿来源：真实模型调用全部失败，已降级为启发式关键词检查；以下结论仅供参考，不等于真模型审稿${reasonTail}。`;
    case 'heuristic_only':
      return 'ℹ 审稿来源：未配置真实模型，当前为启发式关键词检查。';
    default:
      return null;
  }
}

function reviewReportSummary(message: AgentResultMessage): string | null {
  const report = message.agent_result.review_report;
  if (!report || typeof report !== 'object') return null;
  const record = report as {
    issues?: unknown;
    suggested_actions?: unknown;
    context?: { file_count?: unknown; kinds?: unknown };
    mode?: unknown;
    agent_findings?: Record<string, { issue_count?: unknown; degraded_reason?: unknown }>;
  };
  const issues = reviewIssuesFromReport(report as ReviewReport);
  const actions = Array.isArray(record.suggested_actions)
    ? record.suggested_actions.filter((item): item is string => typeof item === 'string')
    : [];
  const contextFileCount =
    typeof record.context?.file_count === 'number' ? record.context.file_count : 0;
  const kinds = Array.isArray(record.context?.kinds)
    ? record.context.kinds.filter((item): item is string => typeof item === 'string')
    : [];
  const finding = (key: string) => {
    const count = record.agent_findings?.[key]?.issue_count;
    return typeof count === 'number' ? count : 0;
  };

  const issueLines = issues.slice(0, 5).map((issue, index) => {
    return `${index + 1}. [${issue.id}/${issue.severity}] ${issue.message}\n   建议：${issue.suggestedAction}`;
  });

  const sourceLine = reviewSourceLine(record.mode, record.agent_findings);

  return [
    message.agent_result.summary ?? '多视角审稿完成。',
    sourceLine,
    `上下文：读取 ${contextFileCount} 个文件${kinds.length ? `（${kinds.join('、')}）` : ''}。`,
    `视角：剧情 ${finding('plot')} 个，人物 ${finding('character')} 个，文风节奏 ${finding('prose')} 个，连续性 ${finding('continuity')} 个。`,
    issueLines.length ? `问题：\n${issueLines.join('\n')}` : '问题：未发现明显结构性问题。',
    actions.length
      ? `建议：\n${actions.map((action, index) => `${index + 1}. ${action}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function reviewReportFromMessage(message: AgentResultMessage): ReviewReport | null {
  const report = message.agent_result.review_report;
  return report && typeof report === 'object' ? (report as ReviewReport) : null;
}

function reviewCategoryLabel(category: ReviewCategory): string {
  if (category === 'plot') return '剧情';
  if (category === 'character') return '人物';
  if (category === 'continuity') return '连续性';
  return '文风';
}

function isReviewCategory(value: unknown): value is ReviewCategory {
  return value === 'plot' || value === 'character' || value === 'prose' || value === 'continuity';
}

export function reviewIssuesFromReport(report: ReviewReport | null): ReviewIssue[] {
  const rawIssues = report?.issues;
  if (!Array.isArray(rawIssues)) return [];
  return rawIssues.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
    const category = isReviewCategory(record.category) ? record.category : null;
    const message =
      typeof record.message === 'string' && record.message.trim() ? record.message.trim() : '';
    if (!id || !category || !message) return [];
    const suggestedAction =
      typeof record.suggested_action === 'string' && record.suggested_action.trim()
        ? record.suggested_action.trim()
        : typeof record.suggestedAction === 'string' && record.suggestedAction.trim()
          ? record.suggestedAction.trim()
          : '按该问题做定向修订，并保持原有事实连续。';
    return [
      {
        id,
        category,
        severity:
          typeof record.severity === 'string' && record.severity.trim()
            ? record.severity.trim()
            : 'info',
        message,
        evidence:
          typeof record.evidence === 'string' && record.evidence.trim()
            ? record.evidence.trim()
            : '未提供证据。',
        suggestedAction,
      },
    ];
  });
}

export function extractIssueScopeFromInstruction(
  instruction: string,
  report: ReviewReport | null,
): Pick<StableAgentRequestPayload, 'selected_issue_ids' | 'included_categories'> {
  const issues = reviewIssuesFromReport(report);
  if (issues.length === 0) return {};
  const normalized = instruction.toLowerCase();
  const selectedIssueIds = issues
    .map((issue) => issue.id)
    .filter((id) => normalized.includes(id.toLowerCase()));
  const includedCategories: ReviewCategory[] = [];
  const wantsOnly = /只|仅|单独|only/.test(instruction);
  if (wantsOnly && /剧情|结构|冲突|钩子|plot/.test(instruction)) includedCategories.push('plot');
  if (wantsOnly && /人物|角色|动机|称谓|关系|character/.test(instruction))
    includedCategories.push('character');
  if (wantsOnly && /文风|语言|行文|润色|节奏|prose/.test(instruction))
    includedCategories.push('prose');
  if (wantsOnly && /一致性|设定|伏笔|时间线|前后文|continuity/.test(instruction))
    includedCategories.push('continuity');
  return {
    ...(selectedIssueIds.length ? { selected_issue_ids: selectedIssueIds } : {}),
    ...(includedCategories.length
      ? { included_categories: Array.from(new Set(includedCategories)) }
      : {}),
  };
}

export function buildStableAgentRequestPayload(params: {
  projectPath: string;
  currentFile: string;
  content: string;
  instruction: string;
  projectName: string | null;
  assistantSessionId: number | null;
  contextBundle: ContextBundle;
  reviewReport: ReviewReport | null;
}): StableAgentRequestPayload {
  const scope = extractIssueScopeFromInstruction(params.instruction, params.reviewReport);
  return {
    project_path: params.projectPath,
    current_file: params.currentFile,
    file_path: params.currentFile,
    content: params.content,
    instruction: params.instruction,
    context: params.content,
    selection: params.content,
    project_name: params.projectName,
    assistant_session_id: params.assistantSessionId,
    context_bundle: toAssistantContextBundlePayload(params.contextBundle),
    ...(params.reviewReport ? { review_report: params.reviewReport } : {}),
    ...scope,
  };
}

async function appendExplicitContextFiles(
  bundle: ContextBundle,
  projectPath: string,
  explicitPaths: string[],
): Promise<ContextAppendResult> {
  const seen = new Set(bundle.files.map((file) => file.path));
  const seenRelative = new Set(
    bundle.files.map((file) => file.relativePath.replace(/\\/g, '/').toLowerCase()),
  );
  const added: ContextBundleFile[] = [];
  const missingPaths: string[] = [];
  for (const rawPath of explicitPaths) {
    const trimmed = rawPath.trim();
    if (!trimmed) continue;
    const path = looksAbsolutePath(trimmed) ? trimmed : joinProjectPath(projectPath, trimmed);
    const relativeCandidate = relativeToProject(projectPath, path);
    if (seen.has(path) || seenRelative.has(relativeCandidate.replace(/\\/g, '/').toLowerCase()))
      continue;
    try {
      const content = await TauriFileSystem.readFile(path);
      added.push({
        path,
        relativePath: relativeCandidate,
        kind: classifyRelativePath(relativeCandidate),
        title: basename(path),
        excerpt: content.trim().slice(0, 1200),
      });
      seen.add(path);
      seenRelative.add(relativeCandidate.replace(/\\/g, '/').toLowerCase());
    } catch {
      missingPaths.push(trimmed);
    }
  }
  if (added.length === 0) {
    return {
      bundle: {
        ...bundle,
        budget: {
          ...bundle.budget,
          missingPinnedFiles: Array.from(
            new Set([...bundle.budget.missingPinnedFiles, ...missingPaths]),
          ),
        },
      },
      missingPaths,
    };
  }
  const files = [...added, ...bundle.files].slice(0, 12);
  const missing = Array.from(new Set([...bundle.budget.missingPinnedFiles, ...missingPaths]));
  return {
    bundle: {
      ...bundle,
      files,
      budget: {
        ...bundle.budget,
        fileCount: files.length,
        charCount: files.reduce((total, file) => total + file.excerpt.length, 0),
        maxFiles: Math.max(bundle.budget.maxFiles, 12),
        truncated: bundle.budget.truncated || added.length + bundle.files.length > files.length,
        pinnedFileCount: Math.min(files.length, bundle.budget.pinnedFileCount + added.length),
        missingPinnedFiles: missing,
      },
    },
    missingPaths: missing,
  };
}

function runStatusText(run: AgentRun | null): string | null {
  if (!run) return null;
  if (run.status === 'waiting') return '等待确认：需要你在右侧 diff 或导出动作里确认。';
  if (run.status === 'completed') return '本轮已完成。';
  if (run.status === 'failed') return '本轮遇到问题，详情在回复里。';

  const active =
    run.steps.find((step) => step.status === 'running') ??
    run.steps.find((step) => step.status === 'waiting') ??
    run.steps.find((step) => step.status === 'pending');
  if (!active) return '正在整理这一轮回复。';
  if (active.id === 'context')
    return active.detail.startsWith('读取') ? active.detail : `正在读取：${active.detail}`;
  if (active.id === 'draft') return `正在读取：${active.detail.replace(/^读取\s*/, '')}`;
  if (active.id === 'orchestrate') return '正在整理：创作判断与下一步建议';
  return active.detail || active.title;
}

export function ChatWindow({
  projectPath,
  currentFile,
  assistantSessionId,
  layoutMode: _layoutMode = 'normal',
  onCollapse: _onCollapse,
  onFocusOnly: _onFocusOnly,
  onRestoreLayout: _onRestoreLayout,
  onAssistantSessionChange,
}: ChatWindowProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [conversationTitle, setConversationTitle] = useState('新的创作会话');
  const [lastReviewReport, setLastReviewReport] = useState<ReviewReport | null>(null);
  const [lastReviewReportFile, setLastReviewReportFile] = useState<string | null>(null);
  const [explicitContextPaths, setExplicitContextPaths] = useState<string[]>([]);
  const [contextCandidates, setContextCandidates] = useState<SemanticFile[]>([]);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [lastContextBundle, setLastContextBundle] = useState<ContextBundle | null>(null);
  const [missingContextPaths, setMissingContextPaths] = useState<string[]>([]);
  const [writingRunProjection, setWritingRunProjection] = useState<WritingRunProjection | null>(
    null,
  );

  const projectName = projectPath ? basename(projectPath) : null;
  const contextRef = currentFile ? relativePath(projectPath, currentFile) : null;

  const contextRefRef = useRef<string | null>(contextRef);
  const currentFileRef = useRef<string | null>(currentFile);
  const projectPathRef = useRef<string | null>(projectPath);
  const agentRunIdRef = useRef<string | null>(null);
  const assistantSessionIdRef = useRef<number | null>(assistantSessionId ?? null);
  const unsubscribeWritingRunRef = useRef<(() => void) | null>(null);
  // 每次渲染后把最新值同步到 ref，供 WebSocket / 异步回调读取最新 props，避免闭包读到旧值。
  useEffect(() => {
    contextRefRef.current = contextRef;
    currentFileRef.current = currentFile;
    projectPathRef.current = projectPath;
    assistantSessionIdRef.current = assistantSessionId ?? null;
  });

  useEffect(() => {
    return () => {
      unsubscribeWritingRunRef.current?.();
      unsubscribeWritingRunRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!assistantSessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 会话切空时同步重置会话派生态，React18 合法模式
      setMessages([]);
      setConversationTitle('新的创作会话');
      setLastReviewReport(null);
      setLastReviewReportFile(null);
      setExplicitContextPaths([]);
      return () => {
        cancelled = true;
      };
    }

    void getAssistantSession(assistantSessionId)
      .then((session) => {
        if (cancelled) return;
        setConversationTitle(session.title.replace(/^IDE Agent:\s*/, '') || '新的创作会话');
        setMessages(compactConversationMessages(session.messages));
      })
      .catch(() => {
        if (!cancelled) onAssistantSessionChange?.(null);
      });

    return () => {
      cancelled = true;
    };
  }, [assistantSessionId, onAssistantSessionChange]);

  useEffect(() => {
    if (!projectPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 无项目时同步重置上下文派生态，React18 合法模式
      setContextCandidates([]);
      setLastContextBundle(null);
      setMissingContextPaths([]);
      setContextPickerOpen(false);
      return;
    }

    let cancelled = false;
    void buildProjectIndex(projectPath)
      .then((index) => {
        if (cancelled) return;
        setContextCandidates(
          index.files.filter((file) => file.kind !== 'export' && file.kind !== 'quality'),
        );
      })
      .catch(() => {
        if (!cancelled) setContextCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 当前文件变化时同步重置上下文/审稿派生态，React18 合法模式
    setLastContextBundle(null);
    setMissingContextPaths([]);
    setContextPickerOpen(false);
    if (lastReviewReportFile && currentFile && lastReviewReportFile !== currentFile) {
      setLastReviewReport(null);
      setLastReviewReportFile(null);
    }
  }, [currentFile, lastReviewReportFile]);

  const updateAgentStep = useCallback((stepId: string, patch: Partial<AgentStep>) => {
    setAgentRun((run) => {
      if (!run) return run;
      return {
        ...run,
        steps: run.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
      };
    });
  }, []);

  const updateAgentStatus = useCallback((status: AgentRun['status']) => {
    setAgentRun((run) => (run ? { ...run, status } : run));
    setAgentBusy(status === 'running');
  }, []);

  const addExplicitContext = useCallback(() => {
    setContextPickerOpen((open) => !open);
  }, []);

  const togglePinnedContext = useCallback((path: string) => {
    setExplicitContextPaths((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path].slice(-12),
    );
  }, []);

  const applyAgentStreamEvent = useCallback(
    (message: AgentSocketMessage) => {
      if (isAgentRunStartedMessage(message)) {
        updateAgentStep('orchestrate', {
          status: 'running',
          detail: `Agent run ${message.run_id} 已开始`,
        });
        return;
      }
      if (isAgentStepEventMessage(message)) {
        const nextStep = stepFromAgentPlanEvent(
          message.index,
          message.step,
          message.detail,
          message.status,
        );
        setAgentRun((run) => {
          if (!run) return run;
          const exists = run.steps.some((step) => step.id === nextStep.id);
          return {
            ...run,
            steps: exists
              ? run.steps.map((step) => (step.id === nextStep.id ? nextStep : step))
              : [...run.steps, nextStep],
          };
        });
        return;
      }
      if (isAgentToolTraceEventMessage(message)) {
        const nextStep = stepFromToolTraceEvent(message.index, message.trace);
        setAgentRun((run) => {
          if (!run) return run;
          const exists = run.steps.some((step) => step.id === nextStep.id);
          return {
            ...run,
            steps: exists
              ? run.steps.map((step) => (step.id === nextStep.id ? nextStep : step))
              : [...run.steps, nextStep],
          };
        });
        return;
      }
      if (isAgentPermissionRequiredMessage(message)) {
        const nextStep: AgentStep = {
          id: 'permission-required',
          title: '等待权限确认',
          tool: 'permission-gate',
          status: 'waiting',
          detail: message.proposed_patch
            ? '已生成待确认补丁，写回前需要作者批准。'
            : '该步骤需要作者批准后才能继续。',
        };
        setAgentRun((run) => {
          if (!run) return run;
          const exists = run.steps.some((step) => step.id === nextStep.id);
          return {
            ...run,
            status: 'waiting',
            steps: exists
              ? run.steps.map((step) => (step.id === nextStep.id ? nextStep : step))
              : [...run.steps, nextStep],
          };
        });
        setAgentBusy(false);
        return;
      }
      if (isAgentControlAckMessage(message)) {
        const nextStatus: AgentRun['status'] =
          message.type === 'stop_run' || message.type === 'permission_denied'
            ? 'failed'
            : message.type === 'pause_run'
              ? 'waiting'
              : message.type === 'resume_run'
                ? 'running'
                : 'completed';
        setAgentRun((run) => (run ? { ...run, status: nextStatus } : run));
        setAgentBusy(nextStatus === 'running');
      }
    },
    [updateAgentStep],
  );

  const runAuthorAgent = useCallback(
    async (
      goal: string,
      action: LocalConversationAction = detectLocalConversationAction(goal),
      // 前端已知用户点的是「修订」时显式带上 intent，绕开后端 _detect_intent 关键词分类
      // （「问题/节奏/结构」恰是 file.review 关键词，会把修订指令误判成再次审稿）。
      intent?: 'file.revise',
    ) => {
      if (agentBusy) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: '这轮还在整理。我先把当前读取、修订或确认收口，再接新的问题。',
          },
        ]);
        return;
      }

      const writebackOnly = action === 'file.writeback';
      const project = projectPathRef.current;
      const file = currentFileRef.current;
      const ref = contextRefRef.current;
      if (!project) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: writebackOnly
              ? '当前没有待写回的修订。'
              : '我需要先知道这是哪个项目。打开本地项目目录后，我们就可以直接围绕稿件聊。',
          },
        ]);
        return;
      }
      if (!file || !ref) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: writebackOnly
              ? '当前没有待写回的修订。'
              : '我需要先看到右侧当前稿件。打开正文文件后，我会按你的问题来审、聊或给方案。',
          },
        ]);
        return;
      }

      const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      agentRunIdRef.current = runId;
      setAgentBusy(true);
      setRetryRequest(null);
      setAgentRun({
        id: runId,
        sessionId: runId,
        goal,
        status: 'running',
        steps: [
          {
            id: 'plan',
            title: '理解目标并制定步骤',
            tool: 'agent.orchestrator',
            status: 'pending',
            detail: '等待后端 Agent 编排',
          },
          {
            id: 'context',
            title: '扫描项目上下文',
            tool: 'project.context',
            status: 'pending',
            detail: '等待执行',
          },
          {
            id: 'draft',
            title: '读取当前稿件',
            tool: 'filesystem.read_file',
            status: 'pending',
            detail: '等待执行',
          },
          {
            id: 'orchestrate',
            title: '调用 Agent Orchestrator',
            tool: 'ide.agent.websocket',
            status: 'pending',
            detail: '等待执行',
          },
          {
            id: 'approval',
            title: '等待作者确认并收口',
            tool: 'author.approval',
            status: 'pending',
            detail: '等待执行',
          },
        ],
      });

      const exportOnly = action === 'file.export';
      updateAgentStep('plan', {
        status: 'completed',
        detail: exportOnly
          ? '目标判断为导出当前稿'
          : writebackOnly
            ? '目标判断为确认写回当前待审补丁'
            : '目标交给后端 Agent Orchestrator 判定',
      });

      try {
        if (writebackOnly) {
          updateAgentStep('context', {
            status: 'completed',
            detail: '确认写回不重新读取项目上下文',
          });
          updateAgentStep('draft', { status: 'completed', detail: '复用作者已查看的 diff' });
          updateAgentStep('orchestrate', { status: 'completed', detail: '无需后端重新生成修订' });
          updateAgentStep('approval', { status: 'running', detail: '正在写回当前待审补丁' });
          emitAcceptCurrentFileSuggestion();
          updateAgentStatus('waiting');
          return;
        }

        updateAgentStep('context', {
          status: 'running',
          detail: '读取大纲、人物、设定、世界观、时间线和伏笔摘要',
        });
        const contextRefs = Array.from(
          new Set([...explicitContextPaths, ...extractContextReferences(goal)]),
        );
        const appendedContext = await appendExplicitContextFiles(
          await buildContextBundle({
            projectPath: project,
            currentFile: file,
            pinnedFiles: explicitContextPaths,
          }),
          project,
          contextRefs,
        );
        const contextBundle = appendedContext.bundle;
        setLastContextBundle(contextBundle);
        setMissingContextPaths(appendedContext.missingPaths);
        updateAgentStep('context', {
          status: 'completed',
          detail: `${contextBudgetText(contextBundle)}；${selectedContextPreview(contextBundle)}`,
        });
        if (appendedContext.missingPaths.length > 0) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: `这些 @上下文没有读到：${appendedContext.missingPaths.join('、')}。我会继续用已选上下文处理这一轮。`,
            },
          ]);
        }

        updateAgentStep('draft', { status: 'running', detail: `读取 ${ref}` });
        await flushActiveEditorToDisk(file);
        const content = await TauriFileSystem.readFile(file);
        updateAgentStep('draft', {
          status: 'completed',
          detail: `当前稿件 ${content.length} 字符，约 ${content.split(/\n\s*\n/).filter(Boolean).length} 段`,
        });

        if (exportOnly) {
          updateAgentStep('orchestrate', {
            status: 'completed',
            detail: '无需后端修订，进入导出动作',
          });
          updateAgentStep('approval', { status: 'running', detail: '正在导出当前稿' });
          emitExportCurrentFile();
          updateAgentStatus('waiting');
          return;
        }

        updateAgentStep('orchestrate', {
          status: 'running',
          detail: '发送原文、当前稿和项目上下文，等待后端判定意图',
        });
        const payload = buildStableAgentRequestPayload({
          projectPath: project,
          currentFile: file,
          content,
          instruction: goal,
          projectName,
          assistantSessionId: assistantSessionIdRef.current,
          contextBundle,
          reviewReport: lastReviewReport,
        });
        const agentRoleMentions = extractAgentRoleMentions(goal);
        const agentRoleHints = mapAgentRoleMentionsToHints(agentRoleMentions);
        const response = await sendAgentUserMessage({
          sessionId: runId,
          runId,
          stream: true,
          assistantSessionId: assistantSessionIdRef.current,
          userMessage: goal,
          intent,
          args: payload,
          agentRoleHints,
          agentRoleMentions,
          onEvent: applyAgentStreamEvent,
        });

        if (isAgentErrorMessage(response)) {
          updateAgentStep('orchestrate', { status: 'failed', detail: response.detail });
          updateAgentStatus('failed');
          setRetryRequest({ goal, action, intent });
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `这轮没跑通：${response.detail}` },
          ]);
          return;
        }

        if (!isAgentResultMessage(response)) {
          const detail = `Agent 返回了暂不支持的消息：${response.type}`;
          updateAgentStep('orchestrate', { status: 'failed', detail });
          updateAgentStatus('failed');
          setRetryRequest({ goal, action, intent });
          setMessages((prev) => [...prev, { role: 'assistant', content: detail }]);
          return;
        }

        assistantSessionIdRef.current = response.assistant_session_id;
        onAssistantSessionChange?.(response.assistant_session_id);
        const systemTitle = titleFromSystemJobs(response);
        if (systemTitle) setConversationTitle(systemTitle);
        const startedWritingRunId = writingRunIdFromResult(response);
        if (startedWritingRunId !== null) {
          unsubscribeWritingRunRef.current?.();
          setWritingRunProjection({
            writingRunId: startedWritingRunId,
            status: 'running',
            currentChapterIndex: null,
            totalChapters: null,
            completedCount: null,
            latestEvent: 'started',
            failureReason: null,
          });
          void subscribeWritingRunEvents(
            startedWritingRunId,
            (event) =>
              setWritingRunProjection((current) => applyWritingRunEventProjection(current, event)),
            () =>
              setWritingRunProjection((current) =>
                current
                  ? {
                      ...current,
                      latestEvent: 'error',
                      failureReason: '写作任务进度订阅失败',
                    }
                  : current,
              ),
          )
            .then((unsubscribe) => {
              unsubscribeWritingRunRef.current = unsubscribe;
            })
            .catch(() => {
              setWritingRunProjection((current) =>
                current
                  ? {
                      ...current,
                      latestEvent: 'error',
                      failureReason: '写作任务进度订阅失败',
                    }
                  : current,
              );
            });
        }

        const agentSteps = stepsFromAgentResult(response);
        setAgentRun((run) =>
          run
            ? {
                ...run,
                status: response.agent_result.requires_user_confirmation ? 'waiting' : 'completed',
                steps: [
                  {
                    id: 'context',
                    title: '扫描项目上下文',
                    tool: 'project.context',
                    status: 'completed',
                    detail: `载入 ${contextBundle.files.length} 个上下文文件`,
                  },
                  {
                    id: 'draft',
                    title: '读取当前稿件',
                    tool: 'filesystem.read_file',
                    status: 'completed',
                    detail: `当前稿件 ${content.length} 字符`,
                  },
                  {
                    id: 'orchestrate',
                    title: '整理回复',
                    tool: 'ide.agent.websocket',
                    status: 'completed',
                    detail: `intent=${response.intent}；assistant_session=${response.assistant_session_id}`,
                  },
                  ...agentSteps,
                  {
                    id: 'approval',
                    title: '等待作者确认并收口',
                    tool: 'author.approval',
                    status: response.agent_result.requires_user_confirmation
                      ? 'waiting'
                      : 'completed',
                    detail: response.agent_result.requires_user_confirmation
                      ? '等待作者在右侧 diff 面板确认'
                      : '无需写回确认',
                  },
                ],
              }
            : run,
        );
        setAgentBusy(false);

        const proposed = fileRevisionPatch(response);
        if (proposed) {
          emitFileSuggestion(
            createRemoteFileSuggestion({
              id: proposed.id,
              filePath: proposed.file_path,
              before: proposed.before,
              after: proposed.after,
              summary: response.agent_result.summary ?? 'Agent 已生成修订建议。',
              model: modelFromToolTrace(response),
              userIntent: goal,
              assistantSessionId: response.assistant_session_id,
              issueIds: issueIdsFromAgentResult(response),
              contextFiles: contextBundle.files.map((file) => file.relativePath),
              scopeWarning: scopeWarningFromAgentResult(response) ?? undefined,
            }),
          );
          emitSuggestionResult({
            filePath: proposed.file_path,
            status: 'ready',
            message: response.agent_result.summary ?? 'Agent 已生成修订建议。',
            assistantSessionId: response.assistant_session_id,
          });
          updateAgentStatus('waiting');
          return;
        }

        const reviewSummary = reviewReportSummary(response);
        if (reviewSummary) {
          const reviewReportForMarkers = reviewReportFromMessage(response);
          setLastReviewReport(reviewReportForMarkers);
          setLastReviewReportFile(file);
          emitReviewIssues(file, reviewIssuesFromReport(reviewReportForMarkers));
          setMessages((prev) => [...prev, { role: 'assistant', content: reviewSummary }]);
          updateAgentStatus('completed');
          return;
        }

        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: response.agent_result.summary ?? '这轮已经完成。' },
        ]);
        updateAgentStatus(
          response.agent_result.requires_user_confirmation ? 'waiting' : 'completed',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateAgentStep('orchestrate', { status: 'failed', detail: message });
        updateAgentStatus('failed');
        setRetryRequest({ goal, action });
        setMessages((prev) => [...prev, { role: 'assistant', content: `这轮没跑通：${message}` }]);
      }
    },
    [
      agentBusy,
      applyAgentStreamEvent,
      explicitContextPaths,
      lastReviewReport,
      onAssistantSessionChange,
      projectName,
      updateAgentStatus,
      updateAgentStep,
    ],
  );

  const retryLastFailedRun = useCallback(() => {
    if (!retryRequest || agentBusy) return;
    setMessages((prev) => [...prev, { role: 'user', content: `重试：${retryRequest.goal}` }]);
    void runAuthorAgent(retryRequest.goal, retryRequest.action, retryRequest.intent);
  }, [agentBusy, retryRequest, runAuthorAgent]);

  const reviseReviewIssue = useCallback(
    (issue: ReviewIssue) => {
      const ask = `只修 ${issue.id}：${issue.message}`;
      setMessages((prev) => [...prev, { role: 'user', content: ask }]);
      void runAuthorAgent(ask, undefined, 'file.revise');
    },
    [runAuthorAgent],
  );

  const reviseSelectedReviewIssues = useCallback(
    (issues: ReviewIssue[]) => {
      if (issues.length === 0) return;
      const ask = `修选中问题：${issues.map((issue) => issue.id).join(' ')}。`;
      setMessages((prev) => [...prev, { role: 'user', content: ask }]);
      void runAuthorAgent(ask, undefined, 'file.revise');
    },
    [runAuthorAgent],
  );

  const reviseReviewCategory = useCallback(
    (category: ReviewCategory) => {
      const ask = `只修${reviewCategoryLabel(category)}问题`;
      setMessages((prev) => [...prev, { role: 'user', content: ask }]);
      void runAuthorAgent(ask, undefined, 'file.revise');
    },
    [runAuthorAgent],
  );

  useEffect(() => {
    const onReviseIssue = (event: Event) => {
      const detail = (event as CustomEvent<{ issueId: string }>).detail;
      if (!detail?.issueId) return;
      if (
        lastReviewReportFile &&
        currentFileRef.current &&
        lastReviewReportFile !== currentFileRef.current
      ) {
        return;
      }
      const issue = reviewIssuesFromReport(lastReviewReport).find(
        (item) => item.id === detail.issueId,
      );
      if (issue) reviseReviewIssue(issue);
    };
    window.addEventListener(REVISE_ISSUE_EVENT, onReviseIssue);
    return () => window.removeEventListener(REVISE_ISSUE_EVENT, onReviseIssue);
  }, [lastReviewReport, lastReviewReportFile, reviseReviewIssue]);

  const sendAgentRunControl = useCallback(
    async (type: AgentControlMessageType) => {
      const run = agentRun;
      if (!run) return;
      try {
        const ack = await sendAgentControlMessage({
          sessionId: run.sessionId,
          runId: run.id,
          type,
          payload: { source: 'desktop.timeline' },
        });
        if (isAgentErrorMessage(ack)) {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Agent 控制失败：${ack.detail}` },
          ]);
          return;
        }
        applyAgentStreamEvent(ack);
        if (type === 'approve_permission') {
          updateAgentStep('permission-required', {
            status: 'completed',
            detail: '作者已批准权限请求。',
          });
          updateAgentStatus('completed');
        } else if (type === 'deny_permission') {
          updateAgentStep('permission-required', {
            status: 'failed',
            detail: '作者已拒绝权限请求。',
          });
          updateAgentStatus('failed');
        } else if (type === 'pause_run') {
          updateAgentStatus('waiting');
        } else if (type === 'resume_run') {
          updateAgentStatus('running');
        } else if (type === 'stop_run') {
          updateAgentStatus('failed');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Agent 控制失败：${message}` },
        ]);
      }
    },
    [agentRun, applyAgentStreamEvent, updateAgentStatus, updateAgentStep],
  );

  const agentRunControls: AgentRunControlHandlers = {
    onApprovePermission: () => void sendAgentRunControl('approve_permission'),
    onDenyPermission: () => void sendAgentRunControl('deny_permission'),
    onPauseRun: () => void sendAgentRunControl('pause_run'),
    onResumeRun: () => void sendAgentRunControl('resume_run'),
    onStopRun: () => void sendAgentRunControl('stop_run'),
  };

  // 命令面板触发"审查当前文件"
  useEffect(() => {
    const onReview = () => {
      const ref = contextRefRef.current;
      if (!ref) return;
      const ask = `审查 ${ref} 的结构与节奏`;
      setConversationTitle(deriveConversationTitle(ask));
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: ask },
        {
          role: 'assistant',
          content: `可以。我按商业连载节奏看，重点检查冲突进入、信息密度和章尾钩子。\n\n我会先看当前稿和项目上下文；这轮只给判断和建议，不直接写回文件。`,
        },
      ]);
      void runAuthorAgent(ask);
    };
    window.addEventListener(REVIEW_CURRENT_EVENT, onReview);
    return () => window.removeEventListener(REVIEW_CURRENT_EVENT, onReview);
  }, [runAuthorAgent]);

  // 右侧 Editor 回传真实修订结果
  useEffect(() => {
    const onResult = (event: Event) => {
      const result = (event as CustomEvent<SuggestionResult>).detail;
      if (!result) return;
      const ref = result.filePath ? relativePath(projectPathRef.current, result.filePath) : null;
      const content =
        result.status === 'ready'
          ? `已生成对 \`${ref ?? result.filePath}\` 的 AI 修订，请在右侧查看 diff，可接受、拒绝或保存旁注。`
          : `AI 修订失败：${result.message}`;
      if (agentRunIdRef.current) {
        updateAgentStep('revise', {
          status: result.status === 'ready' ? 'completed' : 'failed',
          detail: result.message,
        });
        updateAgentStep('approval', {
          status: result.status === 'ready' ? 'waiting' : 'failed',
          detail: result.status === 'ready' ? '等待作者在右侧 diff 面板确认' : result.message,
        });
        updateAgentStatus(result.status === 'ready' ? 'waiting' : 'failed');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    };
    window.addEventListener(SUGGESTION_RESULT_EVENT, onResult);
    return () => window.removeEventListener(SUGGESTION_RESULT_EVENT, onResult);
  }, [updateAgentStatus, updateAgentStep]);

  useEffect(() => {
    const onAuthorLoopResult = (event: Event) => {
      const result = (event as CustomEvent<AuthorLoopResult>).detail;
      if (!result) return;
      const ref = relativePath(projectPathRef.current, result.filePath);
      const content =
        result.status === 'completed'
          ? result.action === 'exported'
            ? `作者闭环已完成：\`${ref}\` 已导出为交付稿。\n${result.artifactPath ?? result.message}`
            : `作者闭环已完成：\`${ref}\` 已写回正文，并生成闭环记录。\n${result.recordPath ?? result.message}`
          : `作者闭环失败：${result.message}`;
      if (agentRunIdRef.current) {
        updateAgentStep('approval', {
          status: result.status === 'completed' ? 'completed' : 'failed',
          detail: result.artifactPath ?? result.recordPath ?? result.message,
        });
        updateAgentStatus(result.status === 'completed' ? 'completed' : 'failed');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    };
    window.addEventListener(AUTHOR_LOOP_RESULT_EVENT, onAuthorLoopResult);
    return () => window.removeEventListener(AUTHOR_LOOP_RESULT_EVENT, onAuthorLoopResult);
  }, [updateAgentStatus, updateAgentStep]);

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || !projectPath) return;

    const instruction = input.trim();
    if (messages.length === 0) setConversationTitle(deriveConversationTitle(instruction));
    const userMessage: Message = { role: 'user', content: instruction };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    await runAuthorAgent(instruction);
  }, [input, messages.length, projectPath, runAuthorAgent]);

  const handleComposerSubmit = useCallback(
    async (value: string) => {
      const instruction = value.trim();
      if (!instruction || !projectPath) return;
      if (messages.length === 0) setConversationTitle(deriveConversationTitle(instruction));
      setMessages((prev) => [...prev, { role: 'user', content: instruction }]);
      await runAuthorAgent(instruction);
    },
    [messages.length, projectPath, runAuthorAgent],
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-[#18181B]">
      <ConversationHeader title={conversationTitle} />

      <MessageList
        messages={messages}
        projectName={projectName}
        currentFileLabel={contextRef}
        disabled={!projectPath || agentBusy}
        onSubmit={handleComposerSubmit}
        agentRun={agentRun}
        writingRunProjection={writingRunProjection}
        explicitContextPaths={explicitContextPaths}
        contextCandidates={contextCandidates}
        contextPickerOpen={contextPickerOpen}
        lastContextBundle={lastContextBundle}
        missingContextPaths={missingContextPaths}
        onAddContext={addExplicitContext}
        onTogglePinnedContext={togglePinnedContext}
        reviewIssues={reviewIssuesFromReport(lastReviewReport)}
        onReviseIssue={reviseReviewIssue}
        onReviseIssues={reviseSelectedReviewIssues}
        onReviseCategory={reviseReviewCategory}
        agentRunControls={agentRunControls}
      />

      {runStatusText(agentRun) && (
        <LightweightStatus
          text={runStatusText(agentRun) ?? ''}
          retryVisible={agentRun?.status === 'failed' && retryRequest !== null && !agentBusy}
          onRetry={retryLastFailedRun}
        />
      )}

      {messages.length > 0 && (
        <ComposerBox
          value={input}
          disabled={!projectPath}
          busy={agentBusy}
          currentFileLabel={contextRef}
          explicitContextPaths={explicitContextPaths}
          onAddContext={addExplicitContext}
          onChange={setInput}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}

function ConversationHeader({ title }: { title: string }) {
  return (
    <header className="flex h-10 flex-shrink-0 items-center gap-3 border-b border-[#3A3A40] bg-[#202024] px-4">
      <h1 className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#EDEDED]">{title}</h1>
      <button
        type="button"
        className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-[#A8A8B0] transition-colors hover:bg-[#2A2A30] hover:text-[#EDEDED]"
        title="更多"
      >
        ...
      </button>
    </header>
  );
}

function MessageList({
  messages,
  projectName,
  currentFileLabel,
  disabled,
  onSubmit,
  agentRun,
  writingRunProjection,
  explicitContextPaths,
  contextCandidates,
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
  reviewIssues,
  onReviseIssue,
  onReviseIssues,
  onReviseCategory,
  agentRunControls,
}: {
  messages: Message[];
  projectName: string | null;
  currentFileLabel: string | null;
  disabled: boolean;
  onSubmit: (value: string) => void;
  agentRun: AgentRun | null;
  writingRunProjection: WritingRunProjection | null;
  explicitContextPaths: string[];
  contextCandidates: SemanticFile[];
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
  reviewIssues: ReviewIssue[];
  onReviseIssue: (issue: ReviewIssue) => void;
  onReviseIssues: (issues: ReviewIssue[]) => void;
  onReviseCategory: (category: ReviewCategory) => void;
  agentRunControls: AgentRunControlHandlers;
}) {
  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1">
        <EmptyConversation
          projectName={projectName}
          currentFileLabel={currentFileLabel}
          disabled={disabled}
          onSubmit={onSubmit}
          explicitContextPaths={explicitContextPaths}
          contextCandidates={contextCandidates}
          contextPickerOpen={contextPickerOpen}
          lastContextBundle={lastContextBundle}
          missingContextPaths={missingContextPaths}
          onAddContext={onAddContext}
          onTogglePinnedContext={onTogglePinnedContext}
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
      <div className="mx-auto flex w-full max-w-[800px] flex-col gap-6">
        {messages.map((message, index) => (
          <MessageItem key={index} message={message} />
        ))}

        {/* Agent 执行步骤面板 */}
        {agentRun && agentRun.steps.length > 0 && (
          <div className="animate-slide-up-fade space-y-2">
            <AgentRunControlBar run={agentRun} controls={agentRunControls} />
            <AgentStepsPanel run={agentRun} />
          </div>
        )}

        {writingRunProjection && <WritingRunProgressPanel projection={writingRunProjection} />}

        <ContextSummaryPanel
          currentFileLabel={currentFileLabel}
          explicitContextPaths={explicitContextPaths}
          contextCandidates={contextCandidates}
          contextPickerOpen={contextPickerOpen}
          lastContextBundle={lastContextBundle}
          missingContextPaths={missingContextPaths}
          onAddContext={onAddContext}
          onTogglePinnedContext={onTogglePinnedContext}
        />

        {reviewIssues.length > 0 && (
          <ReviewIssueActions
            issues={reviewIssues}
            onReviseIssue={onReviseIssue}
            onReviseIssues={onReviseIssues}
            onReviseCategory={onReviseCategory}
          />
        )}
      </div>
    </div>
  );
}

function ReviewIssueActions({
  issues,
  onReviseIssue,
  onReviseIssues,
  onReviseCategory,
}: {
  issues: ReviewIssue[];
  onReviseIssue: (issue: ReviewIssue) => void;
  onReviseIssues: (issues: ReviewIssue[]) => void;
  onReviseCategory: (category: ReviewCategory) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<ReviewCategory | 'all'>('all');
  const categories = Array.from(new Set(issues.map((issue) => issue.category)));
  const visibleIssues =
    categoryFilter === 'all' ? issues : issues.filter((issue) => issue.category === categoryFilter);
  const selectedIssues = issues.filter((issue) => selectedIds.has(issue.id));
  const toggleIssue = (issueId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  };
  return (
    <section
      className="animate-slide-up-fade border-t border-[#333338] pt-4"
      data-testid="review-issue-actions"
    >
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={`h-7 rounded-md border px-2.5 text-xs ${categoryFilter === 'all' ? 'border-[#7FB1FF] bg-[#253044] text-[#EAF2FF]' : 'border-[#45454C] text-[#D8D8DD] hover:bg-[#2A2A30]'}`}
          onClick={() => setCategoryFilter('all')}
          data-testid="review-category-all"
        >
          全部
        </button>
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            className={`h-7 rounded-md border px-2.5 text-xs ${categoryFilter === category ? 'border-[#7FB1FF] bg-[#253044] text-[#EAF2FF]' : 'border-[#45454C] text-[#D8D8DD] hover:bg-[#2A2A30]'}`}
            onClick={() => setCategoryFilter(category)}
            data-testid={`review-category-${category}`}
          >
            {reviewCategoryLabel(category)}
          </button>
        ))}
        {categories.map((category) => (
          <button
            key={`revise-${category}`}
            type="button"
            className="h-7 rounded-md border border-[#45454C] px-2.5 text-xs text-[#D8D8DD] hover:bg-[#2A2A30]"
            onClick={() => onReviseCategory(category)}
            data-testid={`review-revise-category-${category}`}
          >
            只修{reviewCategoryLabel(category)}
          </button>
        ))}
        <button
          type="button"
          className="h-7 rounded-md bg-[#E6E6E6] px-2.5 text-xs text-[#111111] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={selectedIssues.length === 0}
          onClick={() => onReviseIssues(selectedIssues)}
          data-testid="review-revise-selected"
        >
          修选中问题
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {visibleIssues.map((issue) => (
          <div
            key={issue.id}
            className="rounded-md border border-[#333338] bg-[#202024] px-3 py-2"
            data-testid="review-issue"
            data-issue-id={issue.id}
          >
            <div className="flex min-w-0 items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 flex-shrink-0"
                checked={selectedIds.has(issue.id)}
                onChange={() => toggleIssue(issue.id)}
                aria-label={`选择 ${issue.id}`}
                data-testid="review-issue-checkbox"
                data-issue-id={issue.id}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-[#EDEDED]">
                  {issue.id} · {reviewCategoryLabel(issue.category)} · {issue.severity}
                </div>
                <p className="mt-1 text-xs leading-5 text-[#CFCFD4]">{issue.message}</p>
                <p className="mt-1 text-xs leading-5 text-[#92929A]">{issue.suggestedAction}</p>
              </div>
              <button
                type="button"
                className="h-7 flex-shrink-0 rounded-md bg-[#E6E6E6] px-2.5 text-xs text-[#111111] hover:bg-white"
                onClick={() => onReviseIssue(issue)}
              >
                只修此条
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AgentRunControlBar({
  run,
  controls,
}: {
  run: AgentRun;
  controls: AgentRunControlHandlers;
}) {
  const waitingForPermission = run.steps.some(
    (step) => step.id === 'permission-required' && step.status === 'waiting',
  );
  const canPause = run.status === 'running';
  const canResume = run.status === 'waiting' && !waitingForPermission;
  const canStop = run.status === 'running' || run.status === 'waiting';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#333338] bg-[#202024] px-3 py-2">
      <div className="min-w-0 flex-1 text-xs text-[#A8A8B0]">AgentRun #{run.id}</div>
      {waitingForPermission && (
        <>
          <button
            type="button"
            className="h-7 rounded-md bg-[#E6E6E6] px-2.5 text-xs text-[#111111] hover:bg-white"
            onClick={controls.onApprovePermission}
            title="批准权限请求"
          >
            批准
          </button>
          <button
            type="button"
            className="h-7 rounded-md border border-[#5A2F2F] px-2.5 text-xs text-[#FFB8B0] hover:bg-[#3A1F1F]"
            onClick={controls.onDenyPermission}
            title="拒绝权限请求"
          >
            拒绝
          </button>
        </>
      )}
      <button
        type="button"
        className="h-7 rounded-md border border-[#45454C] px-2.5 text-xs text-[#D8D8DD] hover:bg-[#2A2A30] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={controls.onPauseRun}
        disabled={!canPause}
        title="暂停 AgentRun"
      >
        暂停
      </button>
      <button
        type="button"
        className="h-7 rounded-md border border-[#45454C] px-2.5 text-xs text-[#D8D8DD] hover:bg-[#2A2A30] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={controls.onResumeRun}
        disabled={!canResume}
        title="恢复 AgentRun"
      >
        恢复
      </button>
      <button
        type="button"
        className="h-7 rounded-md border border-[#5A2F2F] px-2.5 text-xs text-[#FFB8B0] hover:bg-[#3A1F1F] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={controls.onStopRun}
        disabled={!canStop}
        title="停止 AgentRun"
      >
        停止
      </button>
    </div>
  );
}

export function WritingRunProgressPanel({ projection }: { projection: WritingRunProjection }) {
  const chapters = projection.totalChapters
    ? `${projection.completedCount ?? 0}/${projection.totalChapters}`
    : projection.completedCount !== null
      ? `${projection.completedCount} 已完成`
      : '等待章节进度';
  return (
    <section
      className="animate-slide-up-fade rounded-md border border-[#333338] bg-[#202024] px-3 py-2"
      data-testid="writing-run-progress"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[#EDEDED]">
            写作任务 #{projection.writingRunId} · {projection.status}
          </div>
          <div className="mt-1 truncate text-xs text-[#92929A]">
            章节：{chapters}；最近事件：{projection.latestEvent}
            {projection.currentChapterIndex !== null
              ? `；当前第 ${projection.currentChapterIndex} 章`
              : ''}
          </div>
        </div>
        <span className="rounded-md border border-[#3E4B64] px-2 py-1 text-xs text-[#D8E7FF]">
          managed
        </span>
      </div>
      {projection.failureReason && (
        <div className="mt-2 text-xs text-[#FFB86B]" data-testid="writing-run-failure-reason">
          {projection.failureReason}
        </div>
      )}
    </section>
  );
}

function ContextSummaryPanel({
  currentFileLabel,
  explicitContextPaths,
  contextCandidates,
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
}: {
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  contextCandidates: SemanticFile[];
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
}) {
  const visibleCandidates = contextCandidates
    .filter((file) => file.relativePath !== currentFileLabel)
    .slice(0, 24);
  return (
    <section
      className="animate-slide-up-fade rounded-md border border-[#333338] bg-[#202024] px-3 py-2"
      data-testid="context-summary"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[#EDEDED]">
            {contextBudgetText(lastContextBundle)}
          </div>
          <div className="mt-1 truncate text-xs text-[#92929A]">
            当前：{currentFileLabel ?? '未选择文件'}；已选：
            {selectedContextPreview(lastContextBundle)}
          </div>
        </div>
        <button
          type="button"
          className="h-7 flex-shrink-0 rounded-md border border-[#45454C] px-2.5 text-xs text-[#D8D8DD] hover:bg-[#2A2A30]"
          onClick={onAddContext}
          data-testid="context-picker-toggle"
        >
          添加上下文
        </button>
      </div>

      {explicitContextPaths.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="pinned-context-list">
          {explicitContextPaths.map((path) => (
            <button
              key={path}
              type="button"
              className="max-w-full truncate rounded-md border border-[#3E4B64] bg-[#253044] px-2 py-1 text-xs text-[#D8E7FF] hover:bg-[#2F3C55]"
              title="取消 pin"
              onClick={() => onTogglePinnedContext(path)}
            >
              pin {path}
            </button>
          ))}
        </div>
      )}

      {missingContextPaths.length > 0 && (
        <div className="mt-2 text-xs text-[#FFB86B]" data-testid="missing-context-warning">
          未读到：{missingContextPaths.join('、')}
        </div>
      )}

      {contextPickerOpen && (
        <div
          className="mt-3 grid max-h-52 grid-cols-1 gap-1 overflow-y-auto border-t border-[#333338] pt-2"
          data-testid="context-picker"
        >
          {visibleCandidates.length === 0 ? (
            <div className="px-2 py-1 text-xs text-[#92929A]">
              当前项目还没有可选的 Markdown 上下文。
            </div>
          ) : (
            visibleCandidates.map((file) => {
              const pinned =
                explicitContextPaths.includes(file.relativePath) ||
                explicitContextPaths.includes(file.path);
              return (
                <button
                  key={file.path}
                  type="button"
                  className={`flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs ${
                    pinned ? 'bg-[#2F3C55] text-[#EAF2FF]' : 'text-[#CFCFD4] hover:bg-[#2A2A30]'
                  }`}
                  onClick={() => onTogglePinnedContext(file.relativePath)}
                  data-testid="context-candidate"
                  data-context-path={file.relativePath}
                >
                  <span className="w-10 flex-shrink-0 text-[#92929A]">
                    {semanticKindLabel(file.kind)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{file.relativePath}</span>
                  <span className="flex-shrink-0 text-[#8F8F8F]">{pinned ? 'pinned' : 'pin'}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}

function MessageItem({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end animate-slide-up-fade">
        <div className="max-w-[68%] rounded-lg bg-[#262626] px-3.5 py-2.5 text-sm leading-6 text-[#EDEDED]">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <article className="max-w-[760px] animate-slide-up-fade">
      <div className="mb-2 text-xs font-medium text-[#AFAFAF]">StoryForge</div>
      <div className="text-sm leading-7 text-[#E6E6E6]">
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>
    </article>
  );
}

function EmptyConversation({
  projectName,
  currentFileLabel,
  disabled,
  onSubmit,
  explicitContextPaths,
  contextCandidates,
  contextPickerOpen,
  lastContextBundle,
  missingContextPaths,
  onAddContext,
  onTogglePinnedContext,
}: {
  projectName: string | null;
  currentFileLabel: string | null;
  disabled: boolean;
  onSubmit: (value: string) => void;
  explicitContextPaths: string[];
  contextCandidates: SemanticFile[];
  contextPickerOpen: boolean;
  lastContextBundle: ContextBundle | null;
  missingContextPaths: string[];
  onAddContext: () => void;
  onTogglePinnedContext: (path: string) => void;
}) {
  const [value, setValue] = useState('');

  const submit = () => {
    const next = value.trim();
    if (!next || disabled) return;
    setValue('');
    onSubmit(next);
  };

  return (
    <div className="flex h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[680px] translate-y-[-3vh]">
        <div className="mb-4 px-1">
          <div className="text-[13px] font-medium text-[#EDEDED]">StoryForge</div>
          <div className="mt-1 truncate text-xs text-[#8F8F8F]">
            {projectName
              ? `${projectName}${currentFileLabel ? ` · ${currentFileLabel}` : ''}`
              : '打开项目后即可开始创作会话'}
          </div>
        </div>

        <ComposerSurface
          value={value}
          disabled={disabled}
          busy={false}
          currentFileLabel={currentFileLabel}
          explicitContextPaths={explicitContextPaths}
          onAddContext={onAddContext}
          onChange={setValue}
          onSubmit={submit}
        />
        <div className="mt-3">
          <ContextSummaryPanel
            currentFileLabel={currentFileLabel}
            explicitContextPaths={explicitContextPaths}
            contextCandidates={contextCandidates}
            contextPickerOpen={contextPickerOpen}
            lastContextBundle={lastContextBundle}
            missingContextPaths={missingContextPaths}
            onAddContext={onAddContext}
            onTogglePinnedContext={onTogglePinnedContext}
          />
        </div>
      </div>
    </div>
  );
}

function LightweightStatus({
  text,
  retryVisible = false,
  onRetry,
}: {
  text: string;
  retryVisible?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-[#333338] bg-[#202024] px-5 py-2">
      <div className="mx-auto flex max-w-[800px] items-center gap-3">
        <div className="min-w-0 flex-1 truncate text-xs text-[#A8A8B0]">{text}</div>
        {retryVisible && (
          <button
            type="button"
            className="h-7 flex-shrink-0 rounded-md border border-[#4A4A52] px-2.5 text-xs text-[#EDEDED] hover:bg-[#2A2A30]"
            onClick={onRetry}
          >
            重试本轮
          </button>
        )}
      </div>
    </div>
  );
}

function ComposerBox({
  value,
  disabled,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
  explicitContextPaths,
  onAddContext,
}: {
  value: string;
  disabled: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  onAddContext: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-[#3A3A40] bg-[#18181B] px-4 py-3">
      <div className="mx-auto max-w-[800px]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <ComposerSurface
            value={value}
            disabled={disabled}
            busy={busy}
            currentFileLabel={currentFileLabel}
            explicitContextPaths={explicitContextPaths}
            onAddContext={onAddContext}
            onChange={onChange}
            onSubmit={onSubmit}
          />
        </form>
      </div>
    </div>
  );
}

function roleMentionQuery(value: string): string | null {
  const match = value.match(/@[^\s，。！？!?；;：:,、]*$/);
  return match?.[0] ?? null;
}

function ComposerSurface({
  value,
  disabled,
  busy,
  currentFileLabel,
  onChange,
  onSubmit,
  explicitContextPaths,
  onAddContext,
}: {
  value: string;
  disabled: boolean;
  busy: boolean;
  currentFileLabel: string | null;
  explicitContextPaths: string[];
  onAddContext: () => void;
  onChange: (value: string) => void;
  onSubmit?: () => void;
}) {
  const canSubmit = value.trim() && !disabled && !busy;
  const roleQuery = roleMentionQuery(value);
  const roleSuggestions =
    roleQuery === null
      ? []
      : AGENT_ROLE_SUGGESTIONS.filter((item) =>
          item.mention.toLowerCase().startsWith(roleQuery.toLowerCase()),
        );
  const insertRoleMention = (mention: string) => {
    const nextValue =
      roleQuery === null
        ? `${value}${value.endsWith(' ') || !value ? '' : ' '}${mention} `
        : value.replace(/@[^\s，。！？!?；;：:,、]*$/, `${mention} `);
    onChange(nextValue);
  };

  return (
    <div className="relative min-h-[118px] rounded-xl border border-[#45454C] bg-[#2A2A30] shadow-[0_18px_64px_rgba(0,0,0,0.24)]">
      {roleSuggestions.length > 0 && !disabled && !busy && (
        <div
          className="absolute bottom-[108px] left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5 rounded-md border border-[#3A3A40] bg-[#202024] px-2 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.28)]"
          data-testid="agent-role-suggestions"
        >
          {roleSuggestions.map((item) => (
            <button
              key={item.mention}
              type="button"
              className="h-7 rounded-md border border-[#45454C] px-2.5 text-xs text-[#D8D8DD] hover:border-[#7FB1FF] hover:bg-[#253044] hover:text-[#EAF2FF]"
              onClick={() => insertRoleMention(item.mention)}
              data-testid="agent-role-suggestion"
              data-role-name={item.roleName}
            >
              {item.mention}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || busy}
        rows={3}
        className="h-[70px] w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-6 text-[#F1F1F2] outline-none placeholder:text-[#9A9AA2] disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={
          disabled ? '打开项目后即可使用 StoryForge' : '输入想法、问题，或 @剧情 @人物 点名角色...'
        }
        aria-label="给 StoryForge 发送消息"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSubmit?.();
          }
        }}
      />
      <div className="flex h-12 items-center gap-2 px-3 pb-3">
        <button
          type="button"
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#333333] text-lg leading-none text-[#BDBDBD] transition-colors hover:bg-[#3D3D3D] hover:text-white"
          title="添加上下文"
          onClick={onAddContext}
        >
          +
        </button>
        <span className="max-w-[38%] truncate rounded-md border border-[#333333] px-2 py-1 text-xs text-[#BDBDBD]">
          @ {currentFileLabel ?? '当前文件'}
        </span>
        {explicitContextPaths.slice(-2).map((path) => (
          <span
            key={path}
            className="max-w-[22%] truncate rounded-md border border-[#333333] px-2 py-1 text-xs text-[#BDBDBD]"
            title={path}
          >
            @ {path}
          </span>
        ))}
        <span className="ml-auto min-w-0 truncate text-xs text-[#8F8F8F]">
          StoryForge · Claude · 编辑模式
        </span>
        <button
          type={onSubmit ? 'button' : 'submit'}
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[#E6E6E6] text-sm text-[#111111] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          title="发送"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
