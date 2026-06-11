import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import IdePage from '../app/ide/page';

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.STORYFORGE_API_BASE_URL;
const originalApiKey = process.env.STORYFORGE_API_KEY;

function restoreEnvValue(
  key: 'STORYFORGE_API_BASE_URL' | 'STORYFORGE_API_KEY',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnvValue('STORYFORGE_API_BASE_URL', originalBaseUrl);
  restoreEnvValue('STORYFORGE_API_KEY', originalApiKey);
});

test('IdePage 根据 inspector query 读取 Context Snapshot 并渲染 Inspector', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  process.env.STORYFORGE_API_KEY = 'unit-key';
  const calls: Array<{ readonly url: URL; readonly init: RequestInit }> = [];
  globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: url as URL, init: init ?? {} });
    return new Response(
      JSON.stringify({
        compiled_context_id: 'ctx_unit',
        book_id: 1,
        chapter_id: 2,
        scene_id: 3,
        budget: { token_budget: 100, used_tokens: 64, dropped_tokens: 12, truncated: false },
        injected_blocks: [],
        dropped_blocks: [],
        debug_summary: ['从页面 URL 读取快照。'],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const node = await IdePage({ searchParams: Promise.resolve({ inspector: 'ctx_unit' }) });
  const html = renderToStaticMarkup(node);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url.toString(),
    'https://api.storyforge.test/api/ide/context-snapshot/ctx_unit',
  );
  assert.equal((calls[0].init.headers as Headers).get('X-StoryForge-API-Key'), 'unit-key');
  assert.ok(html.includes('data-active-inspector-id="ctx_unit"'));
  assert.ok(html.includes('Context Inspector'));
  assert.ok(html.includes('从页面 URL 读取快照'));
});

test('IdePage 根据 memory 面板和 book query 读取 Story Memory 并渲染 Explorer', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  process.env.STORYFORGE_API_KEY = 'unit-key';
  const calls: Array<{ readonly url: URL; readonly init: RequestInit }> = [];
  globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: url as URL, init: init ?? {} });
    return new Response(
      JSON.stringify({
        filters: {
          book_id: 7,
          entity_type: null,
          entity_id: 'linlan',
          fact_type: 'status',
          chapter: null,
          conflict_status: 'all',
        },
        items: [
          {
            memory_id: 'memory:7',
            entity_type: 'character',
            entity_id: 'linlan',
            fact_type: 'status',
            value: '林岚保留机械师公开身份',
            source_ref: 'chapter:2',
            source_chapter_id: null,
            valid_from_chapter: 2,
            valid_to_chapter: null,
            confidence: 0.93,
            immutable: true,
            revision: 1,
            conflict_ids: [],
          },
        ],
        conflict_queue: [],
        total: 1,
        conflicted_count: 0,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const node = await IdePage({
    searchParams: Promise.resolve({ book: '7', 'panel.left': 'memory' }),
  });
  const html = renderToStaticMarkup(node);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.toString(), 'https://api.storyforge.test/api/ide/story-memory/query');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, JSON.stringify({ book_id: 7 }));
  assert.ok(html.includes('Story Memory Explorer'));
  assert.ok(html.includes('book=7'));
  assert.ok(html.includes('林岚保留机械师公开身份'));
});

test('IdePage 根据 artifacts 面板和 artifact query 读取 Artifact Preview', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  process.env.STORYFORGE_API_KEY = 'unit-key';
  const calls: Array<{ readonly url: URL; readonly init: RequestInit }> = [];
  globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: url as URL, init: init ?? {} });
    return new Response(
      JSON.stringify({
        artifact: {
          id: 7,
          workspace_id: 3,
          artifact_type: 'book_export',
          lineage_key: 'book-run:42:markdown',
          name: 'book.md',
          status: 'ready',
          storage_uri: 'memory://book-runs/42/book-v2.md',
          mime_type: 'text/markdown',
          size_bytes: 128,
          version: 2,
        },
        preview: {
          format: 'markdown',
          content_preview: '# 雾港航线\n\n正文',
          summary: { lineage_key: 'book-run:42:markdown' },
        },
        download: {
          download_mode: 'payload_preview',
          mime_type: 'text/markdown',
          storage_uri: 'memory://book-runs/42/book-v2.md',
          content_preview: '# 雾港航线',
          payload_summary: {},
        },
        versions: [
          { id: 7, version: 2, name: 'book.md', status: 'ready', created_at: '2026-05-28' },
        ],
        trace: {
          book_run: { id: 42, label: 'BookRun', href: '/ide?panel.bottom=runs&book_run=42' },
          model_run: {
            id: 101,
            label: 'ModelRun',
            href: '/ide?panel.bottom=runs&model_run=101',
            context_href: '/ide?inspector=ctx_artifact',
          },
          judge_report: {
            id: 202,
            label: 'JudgeReport',
            href: '/ide?panel.bottom=problems&judge_report=202',
            context_href: '/ide?inspector=ctx_artifact',
          },
          approve: {
            id: 303,
            label: 'Approve',
            href: '/ide?tab=scene:303',
            context_href: '/ide?inspector=ctx_artifact',
          },
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const node = await IdePage({
    searchParams: Promise.resolve({
      artifact: '7',
      workspace_id: '3',
      'panel.bottom': 'artifacts',
    }),
  });
  const html = renderToStaticMarkup(node);

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url.toString(),
    'https://api.storyforge.test/api/ide/artifacts/7/preview?workspace_id=3',
  );
  assert.equal(calls[0].init.method, undefined);
  assert.ok(html.includes('Artifact #7'));
  assert.ok(html.includes('# 雾港航线'));
  assert.ok(html.includes('v2 · Artifact #7'));
  assert.ok(html.includes('data-trace-kind="book_run"'));
  assert.ok(html.includes('href="/ide?panel.bottom=runs&amp;book_run=42"'));
  assert.ok(html.includes('href="/ide?inspector=ctx_artifact"'));
});

test('IdePage 根据 scene query 读取场景正文和 diagnostics 并渲染 JudgeRepairWorkbench', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  process.env.STORYFORGE_API_KEY = 'unit-key';
  const calls: Array<{ readonly url: URL; readonly init: RequestInit }> = [];
  globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    const requestUrl = url as URL;
    calls.push({ url: requestUrl, init: init ?? {} });
    if (requestUrl.pathname === '/api/ide/scenes/3') {
      return new Response(
        JSON.stringify({
          id: 3,
          chapter_id: 2,
          book_id: 1,
          title: '码头',
          status: 'draft',
          content: '林岚走向北岸灯塔。',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (requestUrl.pathname === '/api/ide/diagnostics') {
      return new Response(
        JSON.stringify([
          {
            id: 'judge:9',
            severity: 'error',
            code: 'setting_conflict',
            message: '北岸灯塔位置冲突',
            range: { start: 4, end: 8 },
            source: 'judge',
            evidence: [{ source_ref: 'asset:1', quote: '灯塔在南岸' }],
            quickFixes: [
              {
                command_id: 'judge.repair',
                title: '生成定向修复',
                args: { issue_id: 9, scene_id: 3 },
              },
            ],
          },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const node = await IdePage({
    searchParams: Promise.resolve({ scene: '3', 'panel.bottom': 'problems' }),
  });
  const html = renderToStaticMarkup(node);

  assert.deepEqual(
    calls.map((call) => call.url.toString()),
    [
      'https://api.storyforge.test/api/ide/scenes/3',
      'https://api.storyforge.test/api/ide/diagnostics?scene_id=3',
    ],
  );
  for (const call of calls) {
    assert.equal((call.init.headers as Headers).get('X-StoryForge-API-Key'), 'unit-key');
  }
  assert.ok(html.includes('data-testid="judge-repair-workbench"'));
  assert.ok(html.includes('data-active-scene-id="3"'));
  assert.ok(html.includes('林岚走向北岸灯塔'));
  assert.ok(html.includes('北岸灯塔位置冲突'));
  assert.ok(html.includes('data-command-chain="judge.run judge.repair judge.approve"'));
  assert.ok(html.includes('data-command-id="judge.run"'));
  assert.ok(html.includes('data-command-id="judge.repair"'));
  assert.ok(
    html.includes(
      'data-command-args="{&quot;scene_id&quot;:3,&quot;content&quot;:&quot;林岚走向北岸灯塔。&quot;}"',
    ),
  );
});

test('IdePage 根据 runs 面板和 book_run query 读取 BookRun 与 SSE 快照事件', async () => {
  process.env.STORYFORGE_API_BASE_URL = 'https://api.storyforge.test';
  process.env.STORYFORGE_API_KEY = 'unit-key';
  const calls: Array<{ readonly url: URL; readonly init: RequestInit }> = [];
  globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    const requestUrl = url as URL;
    calls.push({ url: requestUrl, init: init ?? {} });
    if (requestUrl.pathname === '/api/book-runs/12') {
      return new Response(
        JSON.stringify({
          id: 12,
          book_id: 7,
          blueprint_id: 8,
          status: 'awaiting_review',
          current_chapter_index: 3,
          total_chapters: 5,
          progress: {
            blocked_chapter: { chapter_index: 3, judge_report_id: 31, repair_patch_id: 32 },
            provider_fallback: { from: 'primary', to: 'backup', reason: 'rate_limit' },
          },
          checkpoint: [
            { chapter_index: 2, model_run_id: 21, judge_report_id: 22, approved_scene_id: 23 },
          ],
          token_budget: 1000,
          tokens_used: 840,
          time_budget_sec: 300,
          elapsed_time_sec: 61,
          chapter_budget: null,
          estimated_cost: 0.42,
          cost_summary: { estimated_cost: 0.42 },
          created_at: '2026-05-28T00:00:00Z',
          updated_at: '2026-05-28T00:00:01Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (requestUrl.pathname === '/api/ide/runs/12/events') {
      return new Response(
        [
          'event: progress',
          'data: {"book_run_id":12,"status":"awaiting_review"}',
          '',
          'event: checkpoint',
          'data: {"latest_checkpoint":{"chapter_index":2}}',
          '',
          'event: budget',
          'data: {"tokens_remaining":160}',
          '',
        ].join('\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const node = await IdePage({
    searchParams: Promise.resolve({ book_run: '12', 'panel.bottom': 'runs' }),
  });
  const html = renderToStaticMarkup(node);

  assert.deepEqual(
    calls.map((call) => call.url.toString()),
    [
      'https://api.storyforge.test/api/book-runs/12',
      'https://api.storyforge.test/api/ide/runs/12/events',
    ],
  );
  for (const call of calls) {
    assert.equal((call.init.headers as Headers).get('X-StoryForge-API-Key'), 'unit-key');
  }
  assert.ok(html.includes('BookRun #12'));
  assert.ok(html.includes('awaiting_review'));
  assert.ok(html.includes('data-events-url="/api/book-runs/12/events"'));
  assert.ok(!html.includes('data-events-url="/api/ide/runs/12/events"'));
  assert.ok(html.includes('data-run-event="progress"'));
  assert.ok(html.includes('data-run-event="checkpoint"'));
  assert.ok(html.includes('data-run-event="budget"'));
  assert.ok(html.includes('tokens_remaining=160'));
  assert.ok(html.includes('data-blocked-chapter-index="3"'));
});
