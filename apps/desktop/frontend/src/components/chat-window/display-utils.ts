import type { ContextBundle } from '../../lib/project-context';
import type { AgentRun } from './types';

export type ContextCoverageWarning = {
  /** 挂在参考资料那一行上的短话。 */
  text: string;
  /** 展开后说清楚的一句。 */
  detail: string;
  /** 份数满了挤掉几份是常态，不亮警告色；读不出才是要作者管的事。 */
  tone: 'note' | 'warning';
};

/** 参考资料没带全的原因；单份文件只带摘录不算。旧数据只记了 truncated 时不编数字。 */
export function contextCoverageWarnings(budget: ContextBundle['budget']): ContextCoverageWarning[] {
  const overflow = budget.overflowCount ?? 0;
  const unreadable = budget.unreadableCount ?? 0;
  const warnings: ContextCoverageWarning[] = [
    ...(overflow > 0
      ? [
          {
            text: `${overflow} 份没带上`,
            detail: `另有 ${overflow} 份没带上：每轮最多带 ${budget.maxFiles} 份，想带上哪份就点「添加」固定它。`,
            tone: 'note' as const,
          },
        ]
      : []),
    ...(unreadable > 0
      ? [
          {
            text: `${unreadable} 份读不出`,
            detail: `${unreadable} 份读不出或是空的，没带上。`,
            tone: 'warning' as const,
          },
        ]
      : []),
  ];
  if (warnings.length === 0 && budget.truncated)
    return [{ text: '没带全', detail: '有资料没带全，原因没记下。', tone: 'note' }];
  return warnings;
}

/** 展开参考资料那一行时的第一句：这一轮带了几份、多少字。 */
export function contextBudgetText(bundle: ContextBundle | null): string {
  if (!bundle) return '上下文尚未生成';
  const { fileCount, charCount, pinnedFileCount } = bundle.budget;
  const pinned = pinnedFileCount ? `，其中固定 ${pinnedFileCount} 份` : '';
  return `这一轮带了 ${fileCount} 份参考资料，共 ${charCount} 字${pinned}。`;
}

export function runStatusText(run: AgentRun | null): string | null {
  if (!run) return null;
  if (run.status === 'waiting') {
    const permission = run.steps.some(
      (step) => step.id === 'permission-required' && step.status === 'waiting',
    );
    return permission
      ? '等待你确认：批准权限或在对比里确认写进文件。'
      : '等待确认：需要你在对比或导出动作里确认。';
  }
  if (run.status === 'completed') return '本轮已完成。';
  if (run.status === 'paused') return '已暂停 · 点“恢复”继续本轮。';
  // 作者主动停止是中性收尾，不套用「遇到问题…详情在回复里」的失败措辞（此刻没有失败回复）。
  if (run.status === 'stopped') return '已由你停止本轮。';
  if (isAuthorRejection(run)) return '你拒绝了这次修订。';
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
      ? '需要你的确认：AI 请求权限或已生成修订，等待你批准或拒绝。'
      : 'AI 修订已生成，请你确认接受或拒绝。';
  }
  if (run.status === 'paused') return '本轮已暂停。';
  if (run.status === 'stopped') return '本轮已由你停止。';
  if (isAuthorRejection(run)) return '你拒绝了这次修订。';
  if (run.status === 'failed') return '本轮遇到问题，详情在回复里。';
  if (run.status === 'completed') return '本轮已完成。';
  // 运行中：恒定一句，不随步骤详情变化，避免长程 run 每一步都念一遍。
  return 'AI 正在处理本轮…';
}

/** 拒绝修改是作者的正常决定：引擎记成 failed，界面不能按失败报。 */
export function isAuthorRejection(run: AgentRun | null | undefined): boolean {
  return run?.status === 'failed' && run.rejectedByAuthor === true;
}

export function roleMentionQuery(value: string): string | null {
  const match = value.match(/@[^\s，。！？!?；;：:,、]*$/);
  return match?.[0] ?? null;
}

/** 打 `/` 后的技能候选：名字以输入开头的排前面，其次是名字里含有输入的；空输入列全部。 */
export function matchSkillCommands<T extends { name: string }>(
  skills: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...skills];
  const name = (skill: T) => skill.name.toLowerCase();
  return [
    ...skills.filter((skill) => name(skill).startsWith(needle)),
    ...skills.filter((skill) => !name(skill).startsWith(needle) && name(skill).includes(needle)),
  ];
}
