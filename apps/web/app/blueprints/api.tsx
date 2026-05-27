import React from 'react';

import { readJson } from '../../lib/api-client';

export type BlueprintRead = {
  readonly id: number;
  readonly book_id: number;
  readonly premise: string;
  readonly tone: string;
  readonly target_word_count: number;
  readonly target_chapter_count: number;
  readonly chapter_word_count_min: number;
  readonly chapter_word_count_max: number;
  readonly status: string;
  readonly version: number;
  readonly metadata: Record<string, unknown>;
};

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

export function createBlueprintRequest(bookId: number): ApiRequest {
  return {
    path: '/api/blueprints',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        book_id: bookId,
        premise: '林岚在雾港追查失真的灯塔信号。',
        tone: '克制悬疑',
        target_word_count: 4500,
        target_chapter_count: 3,
        chapter_word_count_min: 1000,
        chapter_word_count_max: 1800,
        metadata: { pov: '林岚', location: '雾港' },
      }),
    },
  };
}

export function triggerChapterPlanRequest(blueprintId: number): ApiRequest {
  return { path: `/api/blueprints/${blueprintId}/chapter-plan`, init: { method: 'POST' } };
}

export function createBookRunRequest(bookId: number, blueprintId: number): ApiRequest {
  return {
    path: '/api/book-runs',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ book_id: bookId, blueprint_id: blueprintId }),
    },
  };
}

export async function readBlueprint(blueprintId: number): Promise<BlueprintRead | null> {
  const result = await readJson<BlueprintRead>(`/api/blueprints/${blueprintId}`, {
    validate: isBlueprintRead,
    invalidMessage: 'Blueprint API 返回格式不符合预期',
  });
  return result.status === 'ready' ? result.data : null;
}

export async function readBookRun(bookRunId: number): Promise<BookRunRead | null> {
  const result = await readJson<BookRunRead>(`/api/book-runs/${bookRunId}`, {
    validate: isBookRunRead,
    invalidMessage: 'BookRun API 返回格式不符合预期',
  });
  return result.status === 'ready' ? result.data : null;
}

export function BlueprintWorkbench({
  blueprint,
  bookRun,
}: {
  readonly blueprint: BlueprintRead | null;
  readonly bookRun: BookRunRead | null;
}) {
  return (
    <section aria-labelledby="blueprint-workbench-title">
      <h2 id="blueprint-workbench-title">全书编排状态</h2>
      {blueprint ? (
        <dl>
          <dt>Blueprint</dt>
          <dd>Blueprint #{blueprint.id}</dd>
          <dt>状态</dt>
          <dd>{blueprint.status}</dd>
          <dt>规模</dt>
          <dd>
            {blueprint.target_chapter_count} 章 / {blueprint.target_word_count} 字
          </dd>
          <dt>立意</dt>
          <dd>{blueprint.premise}</dd>
        </dl>
      ) : (
        <p>当前没有可展示的 Blueprint。</p>
      )}
      {bookRun ? (
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
      ) : (
        <p>当前没有可展示的 BookRun。</p>
      )}
    </section>
  );
}

function isBlueprintRead(value: unknown): value is BlueprintRead {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<BlueprintRead>;
  return (
    typeof item.id === 'number' &&
    typeof item.book_id === 'number' &&
    typeof item.premise === 'string' &&
    typeof item.tone === 'string' &&
    typeof item.target_word_count === 'number' &&
    typeof item.target_chapter_count === 'number' &&
    typeof item.chapter_word_count_min === 'number' &&
    typeof item.chapter_word_count_max === 'number' &&
    typeof item.status === 'string' &&
    typeof item.version === 'number' &&
    typeof item.metadata === 'object' &&
    item.metadata !== null
  );
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
