import type {
  ChatWindowAgentResult,
  ReviewCategory,
  ReviewIssue,
  ReviewReport,
  StableAgentRequestPayload,
} from './types';

export function scopeWarningFromAgentResult(message: ChatWindowAgentResult): string | null {
  const warning = message.agent_result.scope_warning;
  if (!warning || typeof warning !== 'object') return null;
  const text = (warning as { message?: unknown }).message;
  return typeof text === 'string' && text.trim() ? text : null;
}

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

export function reviewReportSummary(message: ChatWindowAgentResult): string | null {
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

export function reviewReportFromMessage(message: ChatWindowAgentResult): ReviewReport | null {
  const report = message.agent_result.review_report;
  return report && typeof report === 'object' ? (report as ReviewReport) : null;
}

export function reviewCategoryLabel(category: ReviewCategory): string {
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
