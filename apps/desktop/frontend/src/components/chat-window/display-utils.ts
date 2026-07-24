import {
  semanticKindLabel,
  type ContextBundle,
  type ContextBundleFile,
} from '../../lib/project-context';
import type { AgentRun } from './types';

export function contextBudgetText(bundle: ContextBundle | null): string {
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

export function selectedContextPreview(bundle: ContextBundle | null): string {
  if (!bundle || bundle.files.length === 0) return '本轮还没有选入额外上下文';
  return bundle.files
    .slice(0, 4)
    .map((file) => file.relativePath)
    .join('、');
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
  if (run.status === 'failed') return '本轮遇到问题，详情在回复里。';

  const active =
    run.steps.find((step) => step.status === 'running') ??
    run.steps.find((step) => step.status === 'waiting') ??
    run.steps.find((step) => step.status === 'pending');
  if (!active) return '正在处理…';
  return active.detail || active.title;
}

export function roleMentionQuery(value: string): string | null {
  const match = value.match(/@[^\s，。！？!?；;：:,、]*$/);
  return match?.[0] ?? null;
}
