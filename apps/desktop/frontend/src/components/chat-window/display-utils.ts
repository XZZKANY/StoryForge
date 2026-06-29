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

export function roleMentionQuery(value: string): string | null {
  const match = value.match(/@[^\s，。！？!?；;：:,、]*$/);
  return match?.[0] ?? null;
}
