import { compactText, pythonSplitlines, pythonStrip } from './pythonText';
import {
  REVIEW_AGENT_KEYS,
  type ReviewReasoner,
  type ReviewSubagentResult,
} from './reviewReasoning';
import {
  REVIEW_SKILLS,
  reviewContextSummary,
  suggestedActionsForReview,
  type ReviewIssue,
} from './reviewSkills';
import { sha256Hex } from './sha256';

type Bundle = { [key: string]: unknown } | null | undefined;
type ReportIssue = ReviewIssue & { id: string; category: string; suggested_action: string };

/** 子代理执行器（P3 的子代理运行时）：按角色执行并返回 `{issues}`。 */
export type ReviewSubagentExecutor = {
  run(
    role: string,
    payload: { [key: string]: unknown },
    toolName: string,
  ): Promise<{ issues: ReviewIssue[] }>;
};

export type AgentToolTrace = {
  tool_name: string;
  status: string;
  input_summary: { [key: string]: unknown };
  output_summary: { [key: string]: unknown };
};

export function issueSuggestedAction(category: string, issue: { code?: unknown }): string {
  const code = typeof issue.code === 'string' ? issue.code : '';
  if (category === 'plot') {
    if (code.includes('hook'))
      return '先对照作者目标核查章尾是否需要钩子；如确有问题，仅调整相关部分，保留刻意停顿。';
    if (code.includes('conflict'))
      return '先对照作者目标核查阻力是否必要；保留静场，不为满足默认规则强加对抗或代价。';
    return '按作者目标核查场景功能，仅处理有依据的问题，不强塞转折或损失。';
  }
  if (category === 'character') {
    if (code.includes('context')) return '先补充或引用人物小传，再校准行动动机和关系称谓。';
    return '按作者目标核查人物选择，保留刻意隐藏的动机与不可靠叙述，不自动补解释。';
  }
  if (category === 'prose') {
    if (code.includes('paragraph'))
      return '按作者目标核查长段阅读负担，确需调整时再拆分，保留刻意的节奏。';
    return '按作者目标核查具体语言问题，保留要求保留的说明、情绪命名和声音，不自动改成动作或感官。';
  }
  if (category === 'continuity') return '核对设定、伏笔、人物关系和时间线，先修正事实冲突。';
  return '按该问题做定向修订，并保持原有事实连续。';
}

export function assignIssueIds(category: string, issues: readonly ReviewIssue[]): ReportIssue[] {
  return issues.map((issue, index) => ({
    ...issue,
    id: `${category}-${index + 1}`,
    category,
    suggested_action: issueSuggestedAction(category, issue),
  }));
}

export function reviewReportMode(results: readonly ReviewSubagentResult[]): string {
  const modes = new Set(results.map((result) => result.mode));
  if (modes.size === 1 && modes.has('llm')) return 'llm';
  if (modes.has('llm')) return 'mixed';
  if (results.some((result) => result.degraded_reason)) return 'llm_failed';
  return 'heuristic_only';
}

export function agentFinding(key: string, result: ReviewSubagentResult) {
  const finding: { [key: string]: unknown } = {
    agent: REVIEW_SKILLS[key].agent,
    focus: REVIEW_SKILLS[key].focus,
    issue_count: result.issues.length,
    mode: result.mode,
  };
  if (result.coverage !== null) finding.coverage = result.coverage;
  if (result.model !== null) finding.model = result.model;
  if (result.latency_ms !== null) finding.latency_ms = result.latency_ms;
  if (result.degraded_reason !== null) finding.degraded_reason = result.degraded_reason;
  return finding;
}

function subagentOutputSummary(
  report: { agent_findings: { [key: string]: { [key: string]: unknown } } },
  key: string,
) {
  const finding = report.agent_findings[key];
  const summary: { [key: string]: unknown } = {
    issue_count: finding.issue_count,
    mode: finding.mode,
  };
  for (const optional of ['model', 'latency_ms', 'degraded_reason', 'coverage'])
    if (optional in finding) summary[optional] = finding[optional];
  return summary;
}

/** 连续性子代理：纯启发式关键词扫描，不走模型。 */
export function continuitySubagentHandler(content: unknown): { issues: ReviewIssue[] } {
  const text = compactText(content, 120000);
  const issues: ReviewIssue[] = [];
  if (['昨天才第一次', '第十天', '前后矛盾', '不一致'].some((keyword) => text.includes(keyword)))
    issues.push({
      agent: 'continuity-agent',
      severity: 'medium',
      code: 'continuity.timeline_conflict_signal',
      message: '正文存在时间线或前后文冲突信号，建议核对章节事实。',
      evidence: compactText(text, 120),
    });
  return { issues };
}

/** 多视角审稿报告：三个模型 / 启发式视角 + 连续性启发式，确定性合并。 */
export async function buildMultiAgentReviewReport(
  executor: ReviewSubagentExecutor,
  options: {
    reasoner: ReviewReasoner;
    newReportId: () => string;
    filePath: string;
    content: string;
    contextBundle: Bundle;
    userMessage: string;
    requestedRoleHints?: readonly string[];
    requestedRoleMentions?: readonly string[];
  },
): Promise<[{ [key: string]: unknown }, AgentToolTrace[]]> {
  const { content, contextBundle } = options;
  const context = reviewContextSummary(contextBundle);
  const hints = [...(options.requestedRoleHints ?? [])];
  const mentions = [...(options.requestedRoleMentions ?? [])];
  const paragraphs = pythonSplitlines(content).map(pythonStrip).filter(Boolean);
  const results = await options.reasoner.reviewAll({
    content,
    paragraphs,
    contextBundle,
    authorInstruction: options.userMessage,
  });
  const byKey = Object.fromEntries(REVIEW_AGENT_KEYS.map((key, index) => [key, results[index]]));
  const run = async (key: string) =>
    assignIssueIds(
      key,
      (await executor.run(`${key}_reviewer`, { result: byKey[key] }, 'file.review')).issues,
    );
  const plotIssues = await run('plot');
  const characterIssues = await run('character');
  const proseIssues = await run('prose');
  const continuity = await executor.run(
    'continuity_reviewer',
    { content, context_bundle: contextBundle },
    'file.review',
  );
  const issues = [
    ...plotIssues,
    ...characterIssues,
    ...proseIssues,
    ...assignIssueIds('continuity', continuity.issues),
  ];
  const suggestedActions = suggestedActionsForReview({ plotIssues, characterIssues, proseIssues });
  if (continuity.issues.length)
    suggestedActions.push('先核对设定、伏笔、人物关系和时间线，再处理语言层润色。');
  const report = {
    kind: 'review_report',
    report_id: `review-${options.newReportId()}`,
    content_sha256: sha256Hex(content),
    file_path: options.filePath,
    user_goal: options.userMessage,
    mode: reviewReportMode(results),
    requested_role_hints: hints,
    requested_role_mentions: mentions,
    context,
    agent_findings: {
      plot: agentFinding('plot', byKey.plot),
      character: agentFinding('character', byKey.character),
      prose: agentFinding('prose', byKey.prose),
      continuity: {
        agent: 'continuity-agent',
        focus: '设定、伏笔、人物关系、时间线和前后文事实冲突',
        issue_count: continuity.issues.length,
        mode: 'heuristic',
      },
    },
    issues,
    suggested_actions: suggestedActions,
  };
  const length = Array.from(content).length;
  const trace = (key: string, extra: { [key: string]: unknown } = {}): AgentToolTrace => ({
    tool_name: `subagent.${key}_reviewer`,
    status: 'completed',
    input_summary: {
      content_chars: length,
      ...extra,
      requested_role_hints: hints,
      explicitly_requested: hints.includes(`${key}_reviewer`),
    },
    output_summary: subagentOutputSummary(report, key),
  });
  const traces = [
    trace('plot'),
    trace('character'),
    trace('prose'),
    trace('continuity', { context_file_count: context.file_count }),
    {
      tool_name: 'subagent.synthesizer',
      status: 'completed',
      input_summary: { issue_count: issues.length, requested_role_hints: hints },
      output_summary: {
        suggested_action_count: suggestedActions.length,
        strategy: 'deterministic_merge',
      },
    },
  ];
  return [report, traces];
}

function agentIssueCount(findings: { [key: string]: unknown }, key: string): number {
  const item = findings[key];
  const count =
    item && typeof item === 'object' ? (item as { issue_count?: unknown }).issue_count : null;
  return typeof count === 'number' && Number.isInteger(count) ? count : 0;
}

function degradedReviewAgents(findings: { [key: string]: unknown }): string[] {
  const degraded: string[] = [];
  for (const key of REVIEW_AGENT_KEYS) {
    const item = findings[key] as { [key: string]: unknown } | undefined;
    if (item && typeof item === 'object' && item.mode === 'heuristic' && item.degraded_reason)
      degraded.push(String(item.agent || key));
  }
  return degraded;
}

/** 给作者看的审稿摘要：如实说明启发式预扫 / 降级视角，不冒充模型审稿。 */
export function reviewReportSummary(report: { [key: string]: unknown }): string {
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const rawFindings = report.agent_findings;
  const findings =
    rawFindings && typeof rawFindings === 'object' && !Array.isArray(rawFindings)
      ? (rawFindings as { [key: string]: unknown })
      : {};
  const summary =
    `多视角审稿完成：返回 ${issues.length} 个待核查项。` +
    `剧情 ${agentIssueCount(findings, 'plot')} 个，人物 ${agentIssueCount(findings, 'character')} 个，` +
    `文风节奏 ${agentIssueCount(findings, 'prose')} 个，连续性 ${agentIssueCount(findings, 'continuity')} 个。`;
  const mode = report.mode;
  if (mode === 'heuristic_only')
    return `${summary} 未配置 LLM，本轮为启发式预扫，非模型审稿，尚未评估作者要求与例外。`;
  if (mode === 'llm_failed') {
    const degraded = degradedReviewAgents(findings);
    const suffix = degraded.length ? ` 失败视角：${degraded.join(', ')}。` : '';
    return `${summary} 已配置 LLM，但全部子代理调用失败，已整体降级为启发式预扫，尚未评估作者要求与例外。${suffix}`;
  }
  if (mode === 'mixed') {
    const degraded = degradedReviewAgents(findings);
    const suffix = degraded.length ? ` 降级视角：${degraded.join(', ')}。` : '';
    return `${summary} 部分 LLM 子代理失败，已按单项降级为启发式预扫，降级项尚未评估作者要求与例外。${suffix}`;
  }
  return summary;
}
