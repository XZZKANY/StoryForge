import React from 'react';

import { readJson } from '../../lib/api-client';

export type BookRunRead = {
  readonly id: number;
  readonly book_id: number;
  readonly blueprint_id: number;
  readonly status: string;
  readonly current_chapter_index: number;
  readonly total_chapters: number;
  readonly progress: Record<string, unknown>;
  readonly checkpoint: readonly Record<string, unknown>[];
  readonly token_budget: number | null;
  readonly tokens_used: number;
  readonly time_budget_sec: number | null;
  readonly elapsed_time_sec: number;
  readonly chapter_budget: number | null;
  readonly estimated_cost: number;
  readonly cost_summary: Record<string, unknown>;
};

export type ApiRequest = {
  readonly path: string;
  readonly init: RequestInit;
};
export async function readBookRun(bookRunId: number): Promise<BookRunRead | null> {
  const result = await readJson<BookRunRead>(`/api/book-runs/${bookRunId}`, {
    validate: isBookRunRead,
    invalidMessage: 'BookRun API 返回格式不符合预期',
  });
  return result.status === 'ready' ? result.data : null;
}

export function exportMarkdownRequest(bookRunId: number): ApiRequest {
  return { path: `/api/book-runs/${bookRunId}/exports/markdown`, init: { method: 'POST' } };
}

export function exportAuditReportRequest(bookRunId: number): ApiRequest {
  return { path: `/api/book-runs/${bookRunId}/exports/audit-report`, init: { method: 'POST' } };
}

export function exportEpubRequest(bookRunId: number): ApiRequest {
  return { path: `/api/book-runs/${bookRunId}/exports/epub`, init: { method: 'POST' } };
}

export function BookRunStatusPanel({ bookRun }: { readonly bookRun: BookRunRead | null }) {
  if (!bookRun) {
    return (
      <section aria-labelledby="book-run-status-title">
        <h2 id="book-run-status-title">BookRun 状态</h2>
        <p>当前没有可展示的 BookRun。请从 Blueprint 页面启动运行，或在地址中提供 book_run_id。</p>
      </section>
    );
  }

  const latestEvent = latestProgressEvent(bookRun);
  return (
    <section aria-labelledby="book-run-status-title">
      <h2 id="book-run-status-title">BookRun 状态</h2>
      <dl>
        <dt>BookRun</dt>
        <dd>BookRun #{bookRun.id}</dd>
        <dt>运行状态</dt>
        <dd>{bookRun.status}</dd>
        <dt>章节进度</dt>
        <dd>
          {bookRun.current_chapter_index} / {bookRun.total_chapters}
        </dd>
        <dt>Token</dt>
        <dd>
          {bookRun.tokens_used} / {bookRun.token_budget ?? '未设置'}
        </dd>
        <dt>剩余预算</dt>
        <dd>{formatOptionalNumber(bookRun.cost_summary.tokens_remaining)}</dd>
        <dt>估算成本</dt>
        <dd>{bookRun.estimated_cost.toFixed(2)}</dd>
      </dl>
      <section aria-labelledby="book-run-latest-event-title">
        <h3 id="book-run-latest-event-title">最近事件</h3>
        {latestEvent ? (
          <p>
            章节 {formatOptionalNumber(latestEvent.chapter_index)}：model_run_id=
            {formatOptionalNumber(latestEvent.model_run_id)}，judge_report_id=
            {formatOptionalNumber(latestEvent.judge_report_id)}，approved_scene_id=
            {formatOptionalNumber(latestEvent.approved_scene_id)}
          </p>
        ) : (
          <p>暂无章节事件。</p>
        )}
      </section>
      <p>
        <a href={`/book-runs/${bookRun.id}/audit`}>查看全书审计页</a>
      </p>
    </section>
  );
}

function latestProgressEvent(bookRun: BookRunRead): Record<string, unknown> | null {
  const rawCompleted = bookRun.progress.completed_chapters;
  const completed = Array.isArray(rawCompleted) ? rawCompleted : [];
  const latest = completed.at(-1);
  if (latest && typeof latest === 'object') return latest as Record<string, unknown>;
  const checkpoint = bookRun.checkpoint.at(-1);
  return checkpoint && typeof checkpoint === 'object' ? checkpoint : null;
}
function isBookRunRead(value: unknown): value is BookRunRead {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<BookRunRead>;
  return (
    typeof item.id === 'number' &&
    typeof item.book_id === 'number' &&
    typeof item.blueprint_id === 'number' &&
    typeof item.status === 'string' &&
    typeof item.current_chapter_index === 'number' &&
    typeof item.total_chapters === 'number' &&
    typeof item.progress === 'object' &&
    item.progress !== null &&
    Array.isArray(item.checkpoint) &&
    (typeof item.token_budget === 'number' || item.token_budget === null) &&
    typeof item.tokens_used === 'number' &&
    (typeof item.time_budget_sec === 'number' || item.time_budget_sec === null) &&
    typeof item.elapsed_time_sec === 'number' &&
    (typeof item.chapter_budget === 'number' || item.chapter_budget === null) &&
    typeof item.estimated_cost === 'number' &&
    typeof item.cost_summary === 'object' &&
    item.cost_summary !== null
  );
}

function formatOptionalNumber(value: unknown): string {
  return typeof value === 'number' ? String(value) : '未设置';
}
