import { Button } from '../ui';

import type { WriteBatchResult } from './useWriteBatchScheduler';
import { chapterLines, writtenChapterCount } from './write-batch-view';

function cardTitle(result: WriteBatchResult): string {
  const batch = result.batch;
  if (!batch) return '批量写章';
  const done = `写了 ${writtenChapterCount(batch)} 章${result.used ? `，用了 ${result.used}` : ''}`;
  if (batch.status === 'finished') return `这一批写完了：${done}`;
  if (batch.status === 'stopped') return `这一批停下了：${done}`;
  return `这一批还在写：${done}`;
}

/**
 * 批量停下或写完后，在对话里确认卡的位置出这张卡（同一套样式，不弹窗）：停下的原因照引擎原文，
 * 每章一行（章名 · 字数 · 检查），「这批审完了」（没审完不能开新的一批），能续写时「从第 k 章接着写」。
 * 完整清单与「撤销第 k 章及之后」是下一刀。
 */
export function WriteBatchResultCard({
  result,
  onReviewed,
  onResume,
  onClose,
}: {
  result: WriteBatchResult;
  onReviewed: () => void;
  onResume: () => void;
  onClose: () => void;
}) {
  const batch = result.batch;
  const lines = batch ? chapterLines(batch, result.titles) : [];
  const finished = batch?.status === 'finished';
  // 出错停下时引擎记下的停下原因里已经带着这句错，不再重复一遍。
  const error = result.error && !batch?.stop?.message.includes(result.error) ? result.error : null;
  const title = cardTitle(result);
  return (
    <section
      className="flex min-h-0 flex-col rounded-lg border border-agent/40 bg-panel px-3 py-3"
      aria-label={title}
      data-testid="write-batch-result"
    >
      <div className="flex-shrink-0">
        <div
          className="text-xs font-semibold text-foreground"
          data-testid="write-batch-result-title"
        >
          {title}
        </div>
        {batch?.stop && (
          <p className="mt-1 text-xs text-foreground" data-testid="write-batch-stop-reason">
            {batch.stop.message}
          </p>
        )}
        {result.notice && (
          <p className="mt-1 text-xs text-muted" data-testid="write-batch-result-notice">
            {result.notice}
          </p>
        )}
        {error && (
          <p
            className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning"
            data-testid="write-batch-result-error"
          >
            {error}
          </p>
        )}
      </div>
      {lines.length > 0 && (
        <ul
          className="mt-2 max-h-44 min-h-0 divide-y divide-border/60 overflow-y-auto"
          data-testid="write-batch-result-chapters"
        >
          {lines.map((line) => (
            <li
              key={line.ordinal}
              className="py-1.5 text-xs text-foreground"
              data-testid="write-batch-result-chapter"
            >
              {line.text}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
        {batch?.reviewed && (
          <span className="mr-auto text-3xs text-subtle" data-testid="write-batch-reviewed-done">
            已标审完
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="text-xs"
          onClick={onClose}
          data-testid="write-batch-result-close"
        >
          关闭
        </Button>
        {batch && !batch.reviewed && batch.status !== 'running' && (
          <Button
            type="button"
            size="sm"
            variant={finished ? 'primary' : 'secondary'}
            className="text-xs"
            disabled={result.pending}
            onClick={onReviewed}
            data-testid="write-batch-reviewed"
          >
            这批审完了
          </Button>
        )}
        {result.canResume && result.resumeFrom !== null && (
          <Button
            type="button"
            size="sm"
            variant="agent"
            className="text-xs"
            disabled={result.pending}
            onClick={onResume}
            data-testid="write-batch-resume"
          >
            从第 {result.resumeFrom} 章接着写
          </Button>
        )}
      </div>
    </section>
  );
}
