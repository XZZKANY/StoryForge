import React from 'react';
import { redirect } from 'next/navigation';

import { apiFetch, readJson, type ApiFetchInit } from '../../lib/api-client';
import { parseAssistantIntent, type AssistantIntent } from '../../components/home/assistant-intent';

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
  readonly workspace_id: number | null;
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

export type BlueprintWorkflowActionDependencies = {
  readonly apiFetch: (path: string, init: ApiFetchInit) => Promise<Response>;
  readonly redirect: (url: string) => never;
};

export function createBlueprintRequest(bookId: number, intent?: AssistantIntent): ApiRequest {
  const targetChapterCount = intent?.targetChapterCount ?? 3;
  const targetWordCount = intent?.targetWordCount ?? targetChapterCount * 1500;
  const metadata: Record<string, unknown> = intent
    ? {
        assistant_task_type: intent.taskType,
        requested_artifacts: intent.requestedArtifacts,
        continuation_mode: intent.continuationMode,
      }
    : { pov: '林岚', location: '雾港' };
  if (intent?.batchChapterCount) {
    metadata.batch_chapter_count = intent.batchChapterCount;
  }
  if (intent?.volumeCount) {
    metadata.volume_count = intent.volumeCount;
  }

  return {
    path: '/api/blueprints',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        book_id: bookId,
        premise: intent?.premise ?? '林岚在雾港追查失真的灯塔信号。',
        tone: intent?.tone ?? '克制悬疑',
        target_word_count: targetWordCount,
        target_chapter_count: targetChapterCount,
        chapter_word_count_min: 1000,
        chapter_word_count_max: 1800,
        metadata,
      }),
    },
  };
}

export function triggerChapterPlanRequest(blueprintId: number): ApiRequest {
  return { path: `/api/blueprints/${blueprintId}/chapter-plan`, init: { method: 'POST' } };
}

export function lockBlueprintRequest(blueprintId: number): ApiRequest {
  return { path: `/api/blueprints/${blueprintId}/lock`, init: { method: 'POST' } };
}

export function createBookRunRequest(
  bookId: number,
  blueprintId: number,
  budget?: {
    readonly chapterBudget?: number;
    readonly tokenBudget?: number;
    readonly timeBudgetSec?: number;
  },
): ApiRequest {
  const body: Record<string, number> = { book_id: bookId, blueprint_id: blueprintId };
  if (budget?.chapterBudget) body.chapter_budget = budget.chapterBudget;
  if (budget?.tokenBudget) body.token_budget = budget.tokenBudget;
  if (budget?.timeBudgetSec) body.time_budget_sec = budget.timeBudgetSec;
  return {
    path: '/api/book-runs',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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

function readFormPositiveInt(formData: FormData, key: string): number | undefined {
  const value = formData.get(key);
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function postAndReadJson<T>(
  request: ApiRequest,
  dependencies: BlueprintWorkflowActionDependencies,
): Promise<T> {
  const response = await dependencies.apiFetch(request.path, request.init);
  if (!response.ok) {
    throw new Error(`API 返回 ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function createBlueprintWorkflowAction(
  formData: FormData,
  dependencies: BlueprintWorkflowActionDependencies = { apiFetch, redirect },
): Promise<never> {
  'use server';

  const action = formData.get('blueprint_action');
  const bookId = readFormPositiveInt(formData, 'book_id') ?? 1;
  const blueprintId = readFormPositiveInt(formData, 'blueprint_id');
  const rawIntent = formData.get('intent');
  const assistantIntent =
    typeof rawIntent === 'string' && rawIntent.trim() ? parseAssistantIntent(rawIntent) : undefined;
  let nextUrl = '/?view=projects';

  try {
    if (action === 'create-blueprint') {
      const created = await postAndReadJson<BlueprintRead>(
        createBlueprintRequest(bookId, assistantIntent),
        dependencies,
      );
      nextUrl = `/?view=projects&blueprint_id=${created.id}`;
    } else if (action === 'lock-blueprint' && blueprintId) {
      const locked = await postAndReadJson<BlueprintRead>(
        lockBlueprintRequest(blueprintId),
        dependencies,
      );
      nextUrl = `/?view=projects&blueprint_id=${locked.id}`;
    } else if (action === 'trigger-chapter-plan' && blueprintId) {
      await postAndReadJson(triggerChapterPlanRequest(blueprintId), dependencies);
      nextUrl = `/?view=projects&blueprint_id=${blueprintId}`;
    } else if (action === 'start-book-run' && blueprintId) {
      const bookRun = await postAndReadJson<BookRunRead>(
        createBookRunRequest(bookId, blueprintId),
        dependencies,
      );
      nextUrl = `/?view=projects&blueprint_id=${blueprintId}&book_run_id=${bookRun.id}`;
    }
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : '未知错误');
    nextUrl = `/?view=projects&blueprint_error=${message}`;
  }
  return dependencies.redirect(nextUrl);
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
    (typeof item.workspace_id === 'number' || item.workspace_id === null) &&
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
