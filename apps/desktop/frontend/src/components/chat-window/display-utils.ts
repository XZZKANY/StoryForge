import {
  semanticKindLabel,
  type ContextBundle,
  type ContextBundleFile,
} from '../../lib/project-context';
import type { AgentRun } from './types';

/** 参考资料没送全的原因；单份文件只送摘录不算。旧数据只记了 truncated 时不编数字。 */
export function contextCoverageWarnings(budget: ContextBundle['budget']): string[] {
  const overflow = budget.overflowCount ?? 0;
  const unreadable = budget.unreadableCount ?? 0;
  const warnings = [
    ...(overflow > 0 ? [`超出席位 ${overflow}`] : []),
    ...(unreadable > 0 ? [`读取失败 ${unreadable}`] : []),
  ];
  if (warnings.length === 0 && budget.truncated) return ['已截断（原因未记录）'];
  return warnings;
}

export function contextBudgetText(bundle: ContextBundle | null): string {
  if (!bundle) return '上下文尚未生成';
  const kinds = Object.entries(bundle.summary.counts)
    .filter(([, count]) => count > 0)
    .slice(0, 4)
    .map(([kind, count]) => `${semanticKindLabel(kind as ContextBundleFile['kind'])}${count}`)
    .join('、');
  const budget = bundle.budget;
  const warnings = contextCoverageWarnings(budget)
    .map((warning) => `；${warning}`)
    .join('');
  const pinned = budget.pinnedFileCount ? `；pin ${budget.pinnedFileCount}` : '';
  return `上下文 ${budget.fileCount}/${budget.maxFiles} 文件，${budget.charCount} 字符${pinned}${warnings}${kinds ? `；项目里：${kinds}` : ''}`;
}

export function runStatusText(run: AgentRun | null): string | null {
  if (!run) return null;
  if (run.status === 'waiting') {
    const permission = run.steps.some(
      (step) => step.id === 'permission-required' && step.status === 'waiting',
    );
    return permission
      ? '等待你确认：批准权限或在 diff 里确认写回。'
      : '等待确认：需要你在 diff 或导出动作里确认。';
  }
  if (run.status === 'completed') return '本轮已完成。';
  if (run.status === 'paused') return '已暂停 · 点“恢复”继续本轮。';
  // 作者主动停止是中性收尾，不套用「遇到问题…详情在回复里」的失败措辞（此刻没有失败回复）。
  if (run.status === 'stopped') return '已由你停止本轮。';
  if (isAuthorRejection(run)) return '你拒绝了这次修改。';
  if (run.status === 'failed') return '本轮遇到问题，详情在回复里。';

  const active =
    run.steps.find((step) => step.status === 'running') ??
    run.steps.find((step) => step.status === 'waiting') ??
    run.steps.find((step) => step.status === 'pending');
  if (!active) return '正在处理…';
  return active.detail || active.title;
}

/**
 * 供屏幕阅读器播报的运行相位。与 runStatusText 不同：这是「相位级」措辞，
 * 同一相位内步骤 / 详情再怎么变都返回同一句稳定文本 → live region 只在相位切换
 * （运行 → 等待确认 → 暂停 → 终态）时念诵一次，不被长程 run 的逐步详情吵到。
 * 无 run 时返回 ''，让 live region 保持静默。
 */
export function runLivePhaseText(run: AgentRun | null): string {
  if (!run) return '';
  if (run.status === 'waiting') {
    const permission = run.steps.some(
      (step) => step.id === 'permission-required' && step.status === 'waiting',
    );
    return permission
      ? '需要你的确认：Agent 请求权限或已生成修订，等待你批准或拒绝。'
      : 'AI 修订已生成，请你确认接受或拒绝。';
  }
  if (run.status === 'paused') return '本轮已暂停。';
  if (run.status === 'stopped') return '本轮已由你停止。';
  if (isAuthorRejection(run)) return '你拒绝了这次修改。';
  if (run.status === 'failed') return '本轮遇到问题，详情在回复里。';
  if (run.status === 'completed') return '本轮已完成。';
  // 运行中：恒定一句，不随步骤详情变化，避免长程 run 每一步都念一遍。
  return 'Agent 正在处理本轮…';
}

/** 拒绝修改是作者的正常决定：引擎记成 failed，界面不能按失败报。 */
export function isAuthorRejection(run: AgentRun | null | undefined): boolean {
  return run?.status === 'failed' && run.rejectedByAuthor === true;
}

export function roleMentionQuery(value: string): string | null {
  const match = value.match(/@[^\s，。！？!?；;：:,、]*$/);
  return match?.[0] ?? null;
}
