import { useEffect, useRef } from 'react';

import { emitOpenFileRequest } from '../../lib/assistant-events';
import { resolveProjectRelativePath } from '../../lib/project-context';
import { Button, PlainButton } from '../ui';

import { CHECK_SCOPE_NOTE } from './check-scope';
import type { WriteBatchResult } from './write-batch-run';
import {
  chapterRows,
  plannedChapterCount,
  undoFactsNotice,
  undoRangeLabel,
  writtenChapterCount,
  type WriteBatchChapterRow,
} from './write-batch-view';

function cardTitle(result: WriteBatchResult): string {
  const status = result.batch?.status;
  if (status === 'finished') return '这一批写完了';
  if (status === 'stopped') return '这一批停下了';
  if (status === 'running') return '这一批还在写';
  return '批量写章';
}

/** 「这一批写了 N 章（计划 M 章）· 共用 X 万（预估 Y、上限 Z）」：不止一段时预估与上限说的是最近一段。 */
function summaryText(result: WriteBatchResult): string | null {
  const batch = result.batch;
  if (!batch) return null;
  const budget = [
    result.estimate ? `预估 ${result.estimate}` : null,
    result.cap ? `上限 ${result.cap}` : null,
  ].filter(Boolean);
  const leg = budget.length ? `（${result.legs > 1 ? '最近一段' : ''}${budget.join('、')}）` : '';
  return (
    `这一批写了 ${writtenChapterCount(batch)} 章（计划 ${plannedChapterCount(batch)} 章）` +
    (result.used ? `· 共用 ${result.used}${leg}` : '')
  );
}

/**
 * 撤销的第二步，在那一行里：台账说明与确认按钮挨在一起，展开时滚进视野
 * （清单在卡内滚动，放在行尾或卡片底部时说明会被挤出视野）。
 */
function UndoConfirm({
  label,
  notice,
  pending,
  onConfirm,
  onCancel,
}: {
  label: string;
  notice: { text: string; emphasis: boolean } | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  return (
    <div className="mt-1" ref={ref} data-testid="write-batch-undo-confirm-block">
      {notice && (
        <p
          className={`text-xs ${notice.emphasis ? 'font-medium text-warning' : 'text-muted'}`}
          role={notice.emphasis ? 'alert' : undefined}
          data-testid="write-batch-undo-facts"
          data-emphasis={notice.emphasis ? 'true' : 'false'}
        >
          {notice.text}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Button
          type="button"
          size="xs"
          variant="danger"
          className="text-xs"
          disabled={pending}
          onClick={onConfirm}
          data-testid="write-batch-undo-confirm"
        >
          {label}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          className="text-xs"
          onClick={onCancel}
          data-testid="write-batch-undo-cancel"
        >
          取消
        </Button>
      </div>
    </div>
  );
}

function ChapterFacts({ facts }: { facts: WriteBatchChapterRow['facts'] }) {
  if (facts === null) return null;
  if (facts === 'unknown') return <span data-testid="write-batch-row-facts">· 新记下的事实 —</span>;
  return (
    <span data-testid="write-batch-row-facts">
      · 新记下的事实 {facts.total} 条
      {facts.pending > 0 && (
        <span className="text-warning" data-testid="write-batch-row-pending">
          （其中待定 {facts.pending} 条）
        </span>
      )}
    </span>
  );
}

/**
 * 批量停下或写完后，在对话里确认卡的位置出这张清单（同一套样式，不弹窗）：顶部汇总与停下原因（引擎原文），
 * 每章一行（章名点了打开 · 字数 · 检查 · 本章目标 · 新记下的事实 · 用量 · 对不上的标注 · 撤销这章及之后），
 * 底部「这批审完了」「从第 k 章接着写」「关闭」常驻。撤销先在行内就地两步确认，不弹居中窗口：
 * 第一次点只读地问引擎能不能撤，第二步写明台账会整份回退（作者之后改过台账时醒目提示）。
 * 不放质量分、通过率之类的总评：检查通过不等于写得好。
 */
export function WriteBatchResultCard({
  result,
  projectPath,
  onReviewed,
  onResume,
  onPrepareUndo,
  onCancelUndo,
  onUndo,
  onClose,
}: {
  result: WriteBatchResult;
  projectPath: string;
  onReviewed: () => void;
  onResume: () => void;
  /** 第一次点「撤销这章及之后」：问引擎能不能撤。 */
  onPrepareUndo: (ordinal: number) => void;
  onCancelUndo: () => void;
  /** 确认了：从这一章起撤销到这一批写进文件的最后一章。 */
  onUndo: (ordinal: number) => void;
  onClose: () => void;
}) {
  const batch = result.batch;
  const rows = batch ? chapterRows(batch, result.mismatches) : [];
  const finished = batch?.status === 'finished';
  const confirm = result.undoConfirm;
  const factsNotice = confirm ? undoFactsNotice(confirm.from, confirm.factsLedger) : null;
  // 出错停下时引擎记下的停下原因里已经带着这句错，不再重复一遍。
  const error = result.error && !batch?.stop?.message.includes(result.error) ? result.error : null;
  const title = cardTitle(result);
  const summary = summaryText(result);
  const open = (row: WriteBatchChapterRow) => {
    const filePath = resolveProjectRelativePath(projectPath, row.targetPath);
    if (filePath) emitOpenFileRequest(filePath);
  };
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
        {summary && (
          <div className="mt-0.5 text-xs text-muted" data-testid="write-batch-result-summary">
            {summary}
          </div>
        )}
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
      <div className="min-h-0 overflow-y-auto">
        {result.undoBlockers.length > 0 && (
          <div
            className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2"
            data-testid="write-batch-undo-blockers"
          >
            <div className="text-xs font-medium text-warning">还不能撤销</div>
            <ul className="mt-1 space-y-1 text-xs text-foreground">
              {result.undoBlockers.map((message) => (
                <li key={message} data-testid="write-batch-undo-blocker">
                  {message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {rows.length > 0 && (
          <ul
            className="mt-2 max-h-44 min-h-0 divide-y divide-border/60 overflow-y-auto"
            data-testid="write-batch-result-chapters"
          >
            {rows.map((row) => (
              <li
                key={row.ordinal}
                className="flex items-start gap-2 py-1.5"
                data-testid="write-batch-result-chapter"
                data-ordinal={row.ordinal}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-1 text-xs text-foreground">
                    {row.openable ? (
                      <PlainButton
                        className="text-left font-medium hover:underline"
                        onClick={() => open(row)}
                        data-testid="write-batch-row-open"
                      >
                        {row.name}
                      </PlainButton>
                    ) : (
                      <span className="font-medium" data-testid="write-batch-row-name">
                        {row.name}
                      </span>
                    )}
                    {row.chars && <span data-testid="write-batch-row-chars">· {row.chars}</span>}
                    <span data-testid="write-batch-row-check">· {row.check}</span>
                    <ChapterFacts facts={row.facts} />
                    {result.chapterTokens[row.ordinal] && (
                      <span data-testid="write-batch-row-tokens">
                        · 用量 {result.chapterTokens[row.ordinal]}
                      </span>
                    )}
                  </div>
                  {row.goal && (
                    <div
                      className="mt-0.5 truncate text-3xs text-subtle"
                      title={row.goal}
                      data-testid="write-batch-row-goal"
                    >
                      目标：{row.goal}
                    </div>
                  )}
                  {row.factsWarning && (
                    <div
                      className="mt-0.5 text-3xs text-warning"
                      data-testid="write-batch-row-facts-warning"
                    >
                      {row.factsWarning}
                    </div>
                  )}
                  {row.mismatch && (
                    <div
                      className="mt-0.5 text-3xs text-warning"
                      data-testid="write-batch-row-mismatch"
                    >
                      {row.mismatch}
                    </div>
                  )}
                  {row.undoable && batch && confirm?.from === row.ordinal && (
                    <UndoConfirm
                      label={`确认撤销${undoRangeLabel(confirm.from, confirm.to)}？`}
                      notice={factsNotice}
                      pending={result.pending}
                      onConfirm={() => onUndo(row.ordinal)}
                      onCancel={onCancelUndo}
                    />
                  )}
                </div>
                {row.undoable && batch && confirm?.from !== row.ordinal && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="secondary"
                      className="text-xs"
                      disabled={result.pending}
                      onClick={() => onPrepareUndo(row.ordinal)}
                      data-testid="write-batch-undo"
                    >
                      撤销这章及之后
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {batch && writtenChapterCount(batch) > 0 && (
          <p className="mt-1 text-3xs text-subtle" data-testid="write-batch-check-scope">
            {CHECK_SCOPE_NOTE}
          </p>
        )}
      </div>
      <div
        className="mt-3 flex flex-shrink-0 flex-wrap items-center justify-end gap-2"
        data-testid="write-batch-result-footer"
      >
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
