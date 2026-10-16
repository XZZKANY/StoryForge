import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@storyforge/engine';
import { nodeSqliteDb } from '../../../../packages/engine/src/store/nodeSqlite.test-support';

const fixture = vi.hoisted(() => ({ db: null as Db | null, selects: 0 }));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('../src/lib/api/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/config')>()),
  getApiConfig: async () => ({ baseUrl: 'http://python.test', apiKey: 'k' }),
}));
vi.mock('../src/lib/engine/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/llm')>()),
  nativeLlmSource: async (slot: string) => ({
    source: {},
    secrets: { values: slot === 'main' ? ['sk-main-secret-1'] : ['润色专用口令七七七'] },
  }),
}));
// 引擎库换成 node:sqlite；数一数被读了几次，Python 档必须一次都不碰。
vi.mock('../src/lib/engine/db', () => ({
  nativeEngineDb: {
    select: (...args: Parameters<Db['select']>) => {
      fixture.selects += 1;
      return fixture.db!.select(...args);
    },
    transaction: (...args: Parameters<Db['transaction']>) => fixture.db!.transaction(...args),
  },
}));

const fetchMock = vi.fn(async () => new Response('[]'));

// 冷加载整个引擎包在满载机器上会超过单条用例的 5 秒预算，先在这里加载
// （之后每条用例 resetModules 只重新求值，不再转换）。
beforeAll(async () => {
  await import('../src/lib/engine/store');
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  fixture.db = nodeSqliteDb();
  fixture.selects = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const sessionsApi = () => import('../src/lib/api/assistant');

describe('left rail sessions live in the engine database', () => {
  it('reads the engine database on ts, in the Python API shape', async () => {
    const { engineSessions } = await import('../src/lib/engine/store');
    const store = await engineSessions({ values: [] });
    await store.createSession({
      title: '别的书',
      task_type: 'ide_agent_orchestration',
      project_path: 'D:/other',
      messages: [],
    });
    const ref = await store.createSession({
      title: 'IDE Agent: 钥匙 润色专用口令七七七',
      task_type: 'ide_agent_orchestration',
      project_path: 'D:/book',
      messages: [{ role: 'user', content: '你好' }],
    });
    const { listAssistantSessions, getAssistantSession } = await sessionsApi();
    const listed = await listAssistantSessions({ projectPath: 'D:/book', limit: 20 });
    expect(listed.map((row) => row.id)).toEqual([ref.id]);
    // 读模型照接口再脱敏一次（两个模型槽的 key 都盖住），时间戳照 Python 接口的格式。
    expect(listed[0]).toMatchObject({
      title: 'IDE Agent: 钥匙 [REDACTED]',
      project_path: 'D:/book',
    });
    expect(listed[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(listed[0].messages[0]).toMatchObject({ session_id: ref.id, role: 'user' });
    expect((await listAssistantSessions()).map((row) => row.id)).toEqual([2, 1]);
    expect(await listAssistantSessions({ limit: 0 })).toHaveLength(1);
    // 空项目路径与 Python 路由一样不过滤（前端只在有值时才带这个参数）。
    expect(await listAssistantSessions({ projectPath: '' })).toHaveLength(2);
    expect((await getAssistantSession(ref.id)).title).toBe('IDE Agent: 钥匙 [REDACTED]');
    await expect(getAssistantSession(99)).rejects.toThrow('Assistant 会话不存在：99。');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caps the list at 50 like the Python route', async () => {
    const { engineSessions } = await import('../src/lib/engine/store');
    await engineSessions({ values: [] });
    await fixture.db!.transaction([
      {
        sql:
          'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 60) ' +
          'INSERT INTO assistant_sessions (title, task_type, project_path, created_at, updated_at) ' +
          "SELECT 'x', 't', NULL, '2026-10-14 00:00:00', '2026-10-14 00:00:00' FROM n",
      },
    ]);
    const { listAssistantSessions } = await sessionsApi();
    expect(await listAssistantSessions({ limit: 99 })).toHaveLength(50);
    expect(await listAssistantSessions()).toHaveLength(20);
  });
});

describe('Ctrl+K / continue record their sessions beside the agent loop', () => {
  it('uses the engine database', async () => {
    const assistant = await import('../src/lib/engine/assistant');
    // 模块已重置：类要从同一轮加载的引擎模块里取。
    const { SqlAssistantStore } = await import('@storyforge/engine');
    expect((await assistant.engineAssistantDeps()).store).toBeInstanceOf(SqlAssistantStore);
  });
});
