import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@storyforge/engine';
import { nodeSqliteDb } from '../../../../packages/engine/src/store/nodeSqlite.test-support';

const ROOT = 'D:\\book';
const fixture = vi.hoisted(() => ({ db: null as Db | null }));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('./support/http-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./support/http-config')>()),
  getApiConfig: async () => ({ baseUrl: 'http://python.test', apiKey: 'k' }),
}));
vi.mock('../src/lib/engine/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/llm')>()),
  nativeLlmSource: async () => {
    throw new Error('模型配置读不出');
  },
}));
vi.mock('../src/lib/engine/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/assistant')>()),
  platform: () => 'windows' as const,
}));
vi.mock('../src/lib/engine/db', () => ({
  nativeEngineDb: {
    select: (...args: Parameters<Db['select']>) => fixture.db!.select(...args),
    transaction: (...args: Parameters<Db['transaction']>) => fixture.db!.transaction(...args),
  },
}));

const fetchMock = vi.fn(
  async () =>
    new Response(
      JSON.stringify({
        project_root: ROOT,
        assistant_session_id: 1,
        entries: [],
        truncated: false,
      }),
      { status: 200 },
    ),
);

// 冷加载整个引擎包在满载机器上会超过单条用例的 5 秒预算，先在这里加载
// （之后每条用例 resetModules 只重新求值，不再转换）。
beforeAll(async () => {
  await import('../src/lib/engine/store');
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  fixture.db = nodeSqliteDb();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** 一次 ts 档写章 run 留下的 brief / 检查 / 只读候选稿（形状照写章管线的产物）。 */
async function seedRun() {
  const { engineRuns, engineSessions } = await import('../src/lib/engine/store');
  const sessions = await engineSessions({ values: [] });
  const session = await sessions.createSession({
    title: '写第三章',
    task_type: 'ide_agent_orchestration',
    project_path: ROOT,
    messages: [],
  });
  const { store } = await engineRuns();
  const services = { store, secrets: { values: [] } };
  const events = await import('../../../../packages/engine/src/loop/runEvents');
  const { checkSource } = await import('../../../../packages/engine/src/loop/chapterCheckProtocol');
  const { sha256Hex } = await import('../../../../packages/engine/src/kernel/sha256');
  const { run } = await events.startAgentUserMessageRun(services, {
    agentSessionId: 'agent-1',
    message: { user_message: '写第三章', run_id: 'run-1' },
    newRunId: () => 'unused',
  });
  await store.updateRun(run.id, { assistant_session_id: session.id });
  const brief = { brief_id: 'brief-1', revision: 1, target_path: '正文/第003章.md' };
  await events.recordAgentArtifact(services, run, { kind: 'chapter_brief', payload: brief });
  const content = '第三章正文。';
  const source = checkSource(content, brief);
  const { artifact: check } = await events.recordAgentArtifact(services, run, {
    kind: 'chapter_check',
    payload: {
      protocol_version: 2,
      content_sha256: source.content_sha256,
      brief_sha256: source.brief_sha256,
      execution_status: 'completed',
      manuscript_status: 'pass',
      manuscript_hard_failure_count: 0,
      advisory_count: 0,
      coverage: {
        supplied_content_chars: 6,
        source_verified: true,
        findings_received: 0,
        findings_validated: 0,
        findings_limit: 20,
        result_complete: true,
      },
      findings: [],
    },
  });
  await events.recordAgentArtifact(services, run, {
    kind: 'chapter_candidate',
    payload: {
      read_only: true,
      content,
      target_path: brief.target_path,
      brief_id: brief.brief_id,
      brief_sha256: source.brief_sha256,
      content_sha256: sha256Hex(content),
    },
  });
  return { sessionId: session.id, checkId: check.id };
}

describe('chapter check history follows the agent loop flag', () => {
  it('reads the engine database on ts and decodes it like the Python response', async () => {
    const { sessionId, checkId } = await seedRun();
    const { queryChapterCheckHistory } = await import('../src/lib/api/chapter-checks');
    const history = await queryChapterCheckHistory({
      project_root: ROOT,
      assistant_session_id: sessionId,
      limit: 20,
    });
    expect(history.truncated).toBe(false);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({
      runId: 'run-1',
      artifactId: checkId,
      targetPath: '正文/第003章.md',
      candidateContent: '第三章正文。',
      candidateError: null,
      check: { executionStatus: 'completed', manuscriptStatus: 'pass' },
    });
    expect(history.entries[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    // 404 / 409 照 Python 路由的 detail 交给调用方，是普通 Error。
    const missing = await queryChapterCheckHistory({
      project_root: ROOT,
      assistant_session_id: 99,
      limit: 20,
    }).catch((error: unknown) => error);
    expect((missing as Error).constructor).toBe(Error);
    expect((missing as Error).message).toBe('AI 会话不存在：99。');
    await expect(
      queryChapterCheckHistory({
        project_root: 'D:\\other',
        assistant_session_id: sessionId,
        limit: 20,
      }),
    ).rejects.toThrow('AI 会话归属冲突，请使用当前作品的会话。');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
