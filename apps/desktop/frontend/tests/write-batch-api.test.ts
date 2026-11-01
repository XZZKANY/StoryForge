/** `/写 a-b` 批量写章：lib/api 经引擎出计划、读单次运行用量（真引擎库 + 合成作品），回包按契约解码。 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db, ProjectReader } from '@storyforge/engine';
import { memoryProject } from '../../../../packages/engine/src/kernel/memoryProject.test-support';
import { nodeSqliteDb } from '../../../../packages/engine/src/store/nodeSqlite.test-support';
import {
  decodeRunUsage,
  decodeWriteBatchPlan,
  WriteBatchShapeError,
} from '../src/lib/api/write-batch';

const ROOT = 'D:\\book';
const fixture = vi.hoisted(() => ({
  db: null as Db | null,
  reader: null as unknown as ProjectReader,
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.2.3' }));
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
vi.mock('../src/lib/engine/reader', () => ({
  nativeProjectReader: {
    resolveProjectPath: (...args: Parameters<ProjectReader['resolveProjectPath']>) =>
      fixture.reader.resolveProjectPath(...args),
    inspectProjectPath: (...args: Parameters<ProjectReader['inspectProjectPath']>) =>
      fixture.reader.inspectProjectPath(...args),
    readProjectDirectory: (...args: Parameters<ProjectReader['readProjectDirectory']>) =>
      fixture.reader.readProjectDirectory(...args),
    readProjectBytes: (...args: Parameters<ProjectReader['readProjectBytes']>) =>
      fixture.reader.readProjectBytes(...args),
  },
}));

const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const goal = (ordinal: number) => ({ ordinal, title: `标题${ordinal}`, goal: `目标${ordinal}` });
const usage = (total: number) => ({
  token_usage: total,
  prompt_tokens: total - 10,
  completion_tokens: 10,
  cache_hit_tokens: null,
  token_usage_source: 'provider_usage',
});

// 第一次调用才动态加载整个引擎包，满载机器上会超过单条用例的 5 秒预算，先在这里加载。
beforeAll(async () => {
  await import('../src/lib/engine/writeBatch');
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  fixture.db = nodeSqliteDb();
  fixture.reader = memoryProject(ROOT, {
    '大纲/总纲.md': file('主线。\n'),
    '人物/主角.md': file('林舟。\n'),
    '设定/世界规则.md': file('城门三更关闭。\n'),
    '正文/第001章.md': file('第一章\n\n正文。\n'),
    '.storyforge/serial-plan.json': file(
      JSON.stringify({ version: 1, chapters: [goal(1), goal(2), goal(3)] }),
    ),
  }).reader;
});

/** 引擎库里一次本作品的写章运行：两次模型请求、一条检查结论。 */
async function seedChapterRun(publicId: string, tokens: number[]) {
  const { engineRuns, engineSessions } = await import('../src/lib/engine/store');
  const sessions = await engineSessions({ values: [] });
  const session = await sessions.createSession({
    title: '写第一章',
    task_type: 'ide_agent_orchestration',
    project_path: ROOT,
    messages: [],
  });
  const { store } = await engineRuns();
  const run = await store.insertRun({
    public_id: publicId,
    session_id: 'agent-1',
    assistant_session_id: session.id,
    goal: '写第一章',
    scope: {},
    permission_profile: 'auto',
    budget: {},
    status: 'completed',
    root_plan: [],
    current_step: 'completed',
  });
  for (const total of tokens)
    await store.insertArtifact({
      run_id: run.id,
      kind: 'model_request_evidence',
      payload: { status: 'response_completed', usage: usage(total) },
      requires_confirmation: false,
    });
  await store.insertArtifact({
    run_id: run.id,
    kind: 'chapter_check',
    payload: { status: 'pass' },
    requires_confirmation: false,
  });
}

describe('lib/api 经引擎出批量写章计划', () => {
  it('plans from the engine database and the project files', async () => {
    await seedChapterRun('run-1', [3000, 1000]);
    const { planWriteBatch, loadRunUsage } = await import('../src/lib/api/write-batch');
    expect(await loadRunUsage('run-1')).toEqual({
      run_id: 'run-1',
      tokens: 4000,
      calls: 2,
      estimated_calls: 0,
      unknown_calls: 0,
    });
    const plan = await planWriteBatch({
      projectRoot: ROOT,
      from: 2,
      to: 3,
      permissionProfile: 'ask',
    });
    expect(plan.can_start).toBe(true);
    expect(plan.basis).toBe('history');
    expect(plan.chapters.map((chapter) => [chapter.ordinal, chapter.status])).toEqual([
      [2, 'write'],
      [3, 'write'],
    ]);
    expect(plan.chapters[0].target_path).toBe('正文/第002章.md');
    expect(plan.estimate).toMatchObject({
      sample_count: 1,
      average_tokens: 4000,
      estimated_tokens: 8000,
      cap_tokens: 12000,
    });
  });

  it('goes to a trial chapter on a book without history, and refuses read-only', async () => {
    const { planWriteBatch } = await import('../src/lib/api/write-batch');
    const plan = await planWriteBatch({
      projectRoot: ROOT,
      from: 2,
      to: 3,
      permissionProfile: 'read',
    });
    expect(plan.basis).toBe('trial');
    expect(plan.estimate).toBeNull();
    expect(plan.chapters.map((chapter) => chapter.status)).toEqual(['write', 'after_trial']);
    expect(plan.blockers.map((blocker) => blocker.code)).toEqual(['read_only']);
    expect(plan.can_start).toBe(false);
  });

  it('reports a missing run instead of zero usage', async () => {
    const { loadRunUsage } = await import('../src/lib/api/write-batch');
    await expect(loadRunUsage('run-x')).rejects.toThrow('找不到这次 AI 运行。');
  });
});

describe('批量写章回包的解码', () => {
  const PLAN = {
    project_root: ROOT,
    from: 2,
    to: 2,
    permission_profile: 'auto',
    chapters: [
      {
        ordinal: 2,
        target_path: '正文/第002章.md',
        title: null,
        goal: '目标',
        status: 'write',
        written_path: null,
        outline_path: '大纲/第2章细纲.md',
        extra: 'dropped',
      },
    ],
    blockers: [],
    can_start: true,
    basis: 'trial',
    estimate: null,
    note: '先只写第 2 章',
    source_warnings: ['「大纲/总纲.md」共 7797 字，每章只放得下 6000 字。'],
  };

  it('keeps only the contract fields', () => {
    const plan = decodeWriteBatchPlan({ ...PLAN, internal: true });
    expect(plan).not.toHaveProperty('internal');
    expect(plan.chapters[0]).not.toHaveProperty('extra');
    expect(plan.chapters[0].outline_path).toBe('大纲/第2章细纲.md');
    expect(plan.source_warnings).toEqual(PLAN.source_warnings);
    expect(
      decodeRunUsage({
        run_id: 'r',
        tokens: 1,
        calls: 1,
        estimated_calls: 0,
        unknown_calls: 0,
        x: 1,
      }),
    ).not.toHaveProperty('x');
  });

  it.each([
    ['unknown chapter status', { chapters: [{ ...PLAN.chapters[0], status: 'maybe' }] }],
    ['outline path that is not text', { chapters: [{ ...PLAN.chapters[0], outline_path: 3 }] }],
    ['unknown blocker code', { blockers: [{ code: 'later', message: '', chapters: [] }] }],
    [
      'estimate without history basis',
      {
        basis: 'trial',
        estimate: {
          chapter_count: 1,
          sample_count: 1,
          average_tokens: 5,
          min_tokens: 5,
          max_tokens: 5,
          estimated_calls: 0,
          unknown_calls: 0,
          estimated_tokens: 5,
          cap_tokens: 8,
        },
      },
    ],
    ['history basis without estimate', { basis: 'history', estimate: null }],
    ['missing can_start', { can_start: undefined }],
    ['missing source warnings', { source_warnings: undefined }],
    ['source warning that is not text', { source_warnings: [3] }],
  ])('rejects %s', (_name, change) => {
    expect(() => decodeWriteBatchPlan({ ...PLAN, ...change })).toThrow(WriteBatchShapeError);
  });

  it('rejects negative usage', () => {
    expect(() =>
      decodeRunUsage({ run_id: 'r', tokens: -1, calls: 1, estimated_calls: 0, unknown_calls: 0 }),
    ).toThrow(WriteBatchShapeError);
  });
});
