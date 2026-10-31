import type { BookBreakdownPreview } from '../app/useProjectCommands';
import type { BookProfileHandle } from '../app/useBookProfile';
import { BookOpen, FileText, X } from '../icons/shell-icons';
import { Button } from '../ui';

const BREAKDOWN_FIELD_LABELS: Record<string, string> = {
  story_structure: '故事结构',
  characters_and_relations: '角色与关系',
  conflict_and_rhythm: '冲突与节奏',
  setting_and_world: '设定与世界观',
  craft_methods: '写作技法',
  transferable_insights: '可迁移洞察',
};

function breakdownStatusLabel(status?: string): string {
  if (status === 'completed') return '模型分析完成';
  if (status === 'completed_deterministic') return '确定性底稿';
  if (status === 'stale') return '需要重新生成';
  return status ?? '未知状态';
}

// 作品视图「拆书」分区的内容：生成 / 取消拆书报告，报告预览与拆出的写法 skill。
export function BookBreakdownBody({
  handle,
  onRunBreakdown,
  breakdown,
  breakdownRunning,
  breakdownCancelling,
  onCancelBreakdown,
  onOpenBreakdown,
  onAdoptBreakdownSkills,
}: {
  handle: BookProfileHandle;
  onRunBreakdown: () => void;
  breakdown?: BookBreakdownPreview | null;
  breakdownRunning: boolean;
  breakdownCancelling: boolean;
  onCancelBreakdown: () => void;
  onOpenBreakdown: (format?: 'json' | 'markdown') => void;
  onAdoptBreakdownSkills: () => void;
}) {
  return (
    <div className="px-3">
      <p className="text-3xs leading-relaxed text-subtle">
        把想学的书（txt / md / docx）放进作品的「资料」或「参考」文件夹，拆书就只拆它们；
        没有就拆这本书自己的正文。拆完会多出几份写法 skill，点「放进 写法/」才落进作品。
      </p>
      <div className="mt-2 flex gap-1.5">
        <Button
          size="xs"
          onClick={onRunBreakdown}
          disabled={handle.loading || breakdownRunning}
          leadingIcon={<BookOpen size={12} strokeWidth={1.7} />}
          data-testid="book-breakdown-run"
        >
          {breakdownRunning ? '生成中…' : '生成拆书报告'}
        </Button>
        {breakdownRunning && (
          <Button
            size="xs"
            onClick={onCancelBreakdown}
            disabled={breakdownCancelling}
            leadingIcon={<X size={12} strokeWidth={1.7} />}
            data-testid="book-breakdown-cancel"
          >
            {breakdownCancelling ? '取消中…' : '取消'}
          </Button>
        )}
      </div>
      {breakdown && (
        <div className="mt-2 border-t border-border pt-2" data-testid="book-breakdown-preview">
          <div className="flex items-center justify-between gap-2 text-3xs text-muted">
            <span>
              {breakdown.stale ? '报告已过期' : '报告可用'} · {breakdown.chapter_count ?? 0} 章
            </span>
            <span className={breakdown.stale ? 'text-warning' : 'text-subtle'}>
              {breakdownStatusLabel(breakdown.status)}
            </span>
          </div>
          <ul className="mt-1 space-y-1" data-testid="book-breakdown-fields">
            {Object.entries(breakdown.analysis ?? {}).map(([key, value]) => (
              <li
                key={key}
                className="max-h-[3.75rem] overflow-hidden text-3xs leading-relaxed text-subtle"
              >
                <span className="text-muted">{BREAKDOWN_FIELD_LABELS[key] ?? key}</span>：
                {value.summary ?? '待补充'}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-1.5">
            <Button
              size="compact"
              onClick={() => onOpenBreakdown('markdown')}
              leadingIcon={<FileText size={11} strokeWidth={1.7} />}
              data-testid="book-breakdown-open"
            >
              打开 Markdown
            </Button>
            <Button
              size="compact"
              onClick={() => onOpenBreakdown('json')}
              leadingIcon={<BookOpen size={11} strokeWidth={1.7} />}
              data-testid="book-breakdown-open-json"
            >
              查看 JSON
            </Button>
          </div>
          {breakdown.writing_skills && (
            <div
              className="mt-2 text-3xs leading-relaxed text-subtle"
              data-testid="book-breakdown-skills"
            >
              {breakdown.writing_skills.count ? (
                <>
                  <div>拆出的写法 skill：{(breakdown.writing_skills.names ?? []).join('、')}</div>
                  <Button
                    size="compact"
                    className="mt-1"
                    onClick={onAdoptBreakdownSkills}
                    data-testid="book-breakdown-adopt-skills"
                  >
                    放进 写法/
                  </Button>
                </>
              ) : (
                <div>这次没拆出写法 skill（{breakdown.writing_skills.error ?? '原因不明'}）。</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
