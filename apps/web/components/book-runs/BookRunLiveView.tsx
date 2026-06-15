'use client';

import type { BookRunRead } from '../../app/book-runs/api';

type BookRunLiveViewProps = {
  readonly initialBookRun: BookRunRead;
  readonly bookRunId: number;
};

export function BookRunLiveView({ initialBookRun }: BookRunLiveViewProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-panel p-6">
        <h2 className="text-xl font-semibold text-foreground">BookRun #{initialBookRun.id}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">状态</dt>
            <dd className="mt-1 text-base font-medium text-foreground">{initialBookRun.status}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">当前章节</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              {initialBookRun.current_chapter_index + 1} / {initialBookRun.total_chapters}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Token 消耗</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              {initialBookRun.tokens_used.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">耗时</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              {Math.floor(initialBookRun.elapsed_time_sec / 60)}分{' '}
              {initialBookRun.elapsed_time_sec % 60}秒
            </dd>
          </div>
        </div>
      </div>
    </div>
  );
}
