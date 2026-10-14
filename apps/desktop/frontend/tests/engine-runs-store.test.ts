import { beforeEach, expect, it, vi } from 'vitest';
import { migrateEngineDb, SqlRunStore, type Db, type RunRecord } from '@storyforge/engine';
import { nodeSqliteDb } from '../../../../packages/engine/src/store/nodeSqlite.test-support';

const fixture = vi.hoisted(() => ({ db: null as unknown as Db, failSelects: 0 }));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('../src/lib/engine/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/llm')>()),
  nativeLlmSource: async () => ({ source: {}, secrets: { values: [] } }),
}));
// 引擎库端口换成 node:sqlite（同一个 SQLite），可以让前几次读失败。
vi.mock('../src/lib/engine/db', () => ({
  nativeEngineDb: {
    select: (sql: string, params?: never[]) =>
      fixture.failSelects-- > 0
        ? Promise.reject(new Error('引擎库被占用'))
        : fixture.db.select(sql, params),
    transaction: (steps: never[]) => fixture.db.transaction(steps),
  },
}));

const run = (publicId: string, status: string): Omit<RunRecord, 'id'> => ({
  public_id: publicId,
  session_id: publicId,
  assistant_session_id: null,
  goal: '',
  scope: {},
  permission_profile: 'ask',
  budget: {},
  status,
  root_plan: [],
  current_step: status,
});

beforeEach(() => {
  vi.resetModules();
  fixture.db = nodeSqliteDb();
  fixture.failSelects = 0;
});

it('opens once per WebView and reaps the runs the previous one left running', async () => {
  // 上一次启动写下的库：一个跑到一半的 run、一个等作者确认的 run。
  await migrateEngineDb(fixture.db);
  const before = await SqlRunStore.open(fixture.db, () => '2026-10-13 09:00:00');
  await before.insertRun(run('left-running', 'running'));
  await before.insertRun(run('left-paused', 'paused'));

  const { engineRuns, engineReadDeps } = await import('../src/lib/engine/agent');
  const [first, second] = await Promise.all([engineRuns(), engineRuns()]);
  expect(second).toBe(first);
  expect((await engineReadDeps()).store).toBe(first.store);

  const reaped = (await first.store.findRun('left-running'))!;
  expect(reaped).toMatchObject({ status: 'failed', current_step: 'failed' });
  expect((await first.store.events(reaped.id)).map((event) => event.payload)).toEqual([
    { reason: 'process_restart', run_id: 'left-running', permission_profile: 'ask' },
  ]);
  expect((await first.store.findRun('left-paused'))!.status).toBe('paused');
  // 与 Python 库同一种时间戳（UTC、精确到秒），旧库导入的行与新行能一起排序。
  const [row] = await fixture.db.select('SELECT created_at, updated_at FROM agent_run_events');
  expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  expect(Math.abs(Date.parse(`${row.created_at}Z`) - Date.now())).toBeLessThan(60_000);
});

it('does not keep a failed open: the next call tries again', async () => {
  fixture.failSelects = 1;
  const { engineRuns } = await import('../src/lib/engine/agent');
  await expect(engineRuns()).rejects.toThrow('引擎库被占用');
  const runs = await engineRuns();
  await runs.store.insertRun(run('fresh', 'running'));
  expect(await fixture.db.select('SELECT public_id FROM agent_runs')).toEqual([
    { public_id: 'fresh' },
  ]);
});
