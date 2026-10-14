import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Db, LegacySnapshotSource } from '@storyforge/engine';
import golden from '../../../../packages/engine/golden/p4-legacy-import.json';
import {
  nodeLegacySource,
  nodeSqliteDb,
} from '../../../../packages/engine/src/store/nodeSqlite.test-support';

const fixture = vi.hoisted(() => ({
  db: null as unknown as Db,
  python: null as unknown as LegacySnapshotSource,
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('../src/lib/engine/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/llm')>()),
  nativeLlmSource: async () => ({ source: {}, secrets: { values: [] } }),
}));
// 引擎库与旧库的原生端口都换成 node:sqlite：旧库是预言机用 Python 服务写出来的合成库。
vi.mock('../src/lib/engine/db', () => ({
  nativeEngineDb: {
    select: (...args: Parameters<Db['select']>) => fixture.db.select(...args),
    transaction: (...args: Parameters<Db['transaction']>) => fixture.db.transaction(...args),
  },
  nativePythonDb: {
    snapshot: (queries: readonly string[]) => fixture.python.snapshot(queries),
  },
}));

const count = async (table: string) =>
  Number((await fixture.db.select(`SELECT COUNT(*) AS n FROM ${table}`))[0].n);

// 冷加载整个引擎包在满载机器上会超过单条用例的 5 秒预算，先在这里加载
// （之后每条用例 resetModules 只重新求值，不再转换）。
beforeAll(async () => {
  await import('../src/lib/engine/store');
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DEV', true);
  fixture.db = nodeSqliteDb();
  localStorage.clear();
  localStorage.setItem('engine.agentLoop', 'ts');
});

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
});

it('imports the Python database on the first open when switched on, before the reaper runs', async () => {
  localStorage.setItem('engine.legacyImport', 'on');
  const python = nodeLegacySource(golden.legacy_sql);
  fixture.python = python;
  const { engineRuns } = await import('../src/lib/engine/store');
  const { listEngineSessions } = await import('../src/lib/engine/sessions');
  const [{ store }, sessions] = await Promise.all([engineRuns(), listEngineSessions()]);
  expect(python.snapshots).toBe(1);
  // 左栏照 Python 的排序：updated_at 倒序，同一时刻按 id 倒序。
  expect(sessions.map((session) => session.id)).toEqual([2, 3, 1, 4]);
  // Python 档跑到一半的 run 导入后才被收尸；等作者确认的 run 保持 paused。
  expect(await store.findRun('legacy-run-4')).toMatchObject({ status: 'failed' });
  expect(await store.findRun('legacy-run-2')).toMatchObject({ status: 'paused' });
  expect(await count('engine_meta')).toBe(1);

  // 下一个 WebView：有标记，不再读旧库。
  vi.resetModules();
  python.exec(
    "INSERT INTO assistant_sessions (title, task_type, created_at, updated_at) VALUES ('后来的', 'x', '2026-07-09 00:00:00', '2026-07-09 00:00:00')",
  );
  await (await import('../src/lib/engine/store')).engineRuns();
  expect(python.snapshots).toBe(1);
  expect(await count('assistant_sessions')).toBe(4);
});

it.each([
  ['switched off in dev', null, true],
  ['release builds even when switched on', 'on', false],
])('never reads the Python database when %s', async (_label, flag, dev) => {
  vi.stubEnv('DEV', dev);
  if (flag) localStorage.setItem('engine.legacyImport', flag);
  const snapshot = vi.fn();
  fixture.python = { snapshot };
  const { engineRuns } = await import('../src/lib/engine/store');
  await engineRuns();
  expect(snapshot).not.toHaveBeenCalled();
  expect(await count('engine_meta')).toBe(0);
});

it('a failed import is not cached and the engine writes nothing until it succeeds', async () => {
  localStorage.setItem('engine.legacyImport', 'on');
  const python = nodeLegacySource(golden.legacy_sql);
  let locked = true;
  fixture.python = {
    snapshot: (queries) =>
      locked ? Promise.reject(new Error('database is locked')) : python.snapshot(queries),
  };
  const { engineRuns, engineSessions } = await import('../src/lib/engine/store');
  await expect(engineRuns()).rejects.toThrow('database is locked');
  await expect(engineSessions({ values: [] })).rejects.toThrow('database is locked');
  expect(await count('agent_runs')).toBe(0);
  expect(await count('engine_meta')).toBe(0);
  locked = false;
  const { store } = await engineRuns();
  expect((await store.allRuns()).map((run) => run.public_id)).toEqual([
    'legacy-run-1',
    'legacy-run-2',
    'legacy-run-3',
    'legacy-run-4',
    'legacy-run-5',
  ]);
});
