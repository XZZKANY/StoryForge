/** `/写 a-b` 批量写章的记录与下一步：lib/api 经引擎读写 `.storyforge/write-batch.json`（真引擎库 + 合成作品），回包按契约解码。 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db, ProjectReader, ProjectWriter } from '@storyforge/engine';
import { memoryProject } from '../../../../packages/engine/src/kernel/memoryProject.test-support';
import { nodeSqliteDb } from '../../../../packages/engine/src/store/nodeSqlite.test-support';
import {
  decodeWriteBatch,
  decodeWriteBatchStep,
  decodeWriteBatchUndoPlan,
  decodeWriteBatchView,
  WriteBatchShapeError,
} from '../src/lib/api/write-batch';

const ROOT = 'D:\\book';
const MODEL = 'main:deepseek-v4-flash';
const fixture = vi.hoisted(() => ({
  db: null as Db | null,
  project: null as unknown as {
    reader: ProjectReader;
    writer: ProjectWriter;
    apply(changes: Record<string, { chunks: { base64: string; repeat: number }[] } | null>): void;
  },
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
      fixture.project.reader.resolveProjectPath(...args),
    inspectProjectPath: (...args: Parameters<ProjectReader['inspectProjectPath']>) =>
      fixture.project.reader.inspectProjectPath(...args),
    readProjectDirectory: (...args: Parameters<ProjectReader['readProjectDirectory']>) =>
      fixture.project.reader.readProjectDirectory(...args),
    readProjectBytes: (...args: Parameters<ProjectReader['readProjectBytes']>) =>
      fixture.project.reader.readProjectBytes(...args),
  },
}));
vi.mock('../src/lib/engine/writer', () => ({
  nativeProjectWriter: {
    writeProjectFile: (...args: Parameters<ProjectWriter['writeProjectFile']>) =>
      fixture.project.writer.writeProjectFile(...args),
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
const PASS = {
  status: 'pass',
  execution_status: 'completed',
  manuscript_hard_failure_count: 0,
  findings: [],
};

// 第一次调用才动态加载整个引擎包，满载机器上会超过单条用例的 5 秒预算，先在这里加载。
beforeAll(async () => {
  await import('../src/lib/engine/writeBatch');
}, 60_000);

beforeEach(() => {
  vi.resetModules();
  fixture.db = nodeSqliteDb();
  fixture.project = memoryProject(ROOT, {
    '大纲/总纲.md': file('主线。\n'),
    '人物/主角.md': file('林舟。\n'),
    '设定/世界规则.md': file('城门三更关闭。\n'),
    '正文/第001章.md': file('第一章\n\n正文。\n'),
    '.storyforge/serial-plan.json': file(
      JSON.stringify({ version: 1, chapters: [goal(1), goal(2), goal(3)] }),
    ),
  });
});

/** 引擎库里一次本作品的写章运行：一次模型请求、章纲、检查结论与一份不用作者点的修订。 */
async function seedChapterRun(publicId: string, target: string, tokens: number) {
  const { engineRuns, engineSessions } = await import('../src/lib/engine/store');
  const sessions = await engineSessions({ values: [] });
  const session = await sessions.createSession({
    title: '写章',
    task_type: 'ide_agent_orchestration',
    project_path: ROOT,
    messages: [],
  });
  const { store } = await engineRuns();
  const run = await store.insertRun({
    public_id: publicId,
    session_id: 'agent-1',
    assistant_session_id: session.id,
    goal: '写章',
    scope: {},
    permission_profile: 'auto',
    budget: {},
    status: 'completed',
    root_plan: [],
    current_step: 'completed',
  });
  const artifact = (kind: string, payload: Record<string, unknown>) =>
    store.insertArtifact({ run_id: run.id, kind, payload, requires_confirmation: false });
  await artifact('model_request_evidence', { status: 'response_completed', usage: usage(tokens) });
  await artifact('chapter_brief', { target_path: target });
  await artifact('chapter_check', PASS);
  await artifact('proposed_patch', {
    file_path: `${ROOT}\\${target}`,
    requires_confirmation: false,
  });
}

describe('lib/api 经引擎记批量、问下一步', () => {
  it('keeps the author note and the chapter titles in the record, and previews a resume read-only', async () => {
    await seedChapterRun('history', '正文/第001章.md', 1000);
    const api = await import('../src/lib/api/write-batch');
    const started = await api.startWriteBatch({
      projectRoot: ROOT,
      from: 2,
      to: 3,
      permissionProfile: 'ask',
      modelKey: MODEL,
      note: '节奏快一点',
    });
    if (!started.started) throw new Error('应能开跑');
    expect(started.batch.note).toBe('节奏快一点');
    const step = await api.nextWriteBatchStep({
      projectRoot: ROOT,
      batchId: started.batch.id,
      permissionProfile: 'auto',
      modelKey: MODEL,
    });
    expect(step).toMatchObject({ action: 'write', ordinal: 2, title: '标题2', note: '节奏快一点' });
    const stopped = await api.stopWriteBatch({
      projectRoot: ROOT,
      batchId: started.batch.id,
      code: 'scheduler_error',
      message: '第 2 章出错停下：读不出文件',
    });
    expect(stopped.stop).toEqual({
      code: 'scheduler_error',
      message: '第 2 章出错停下：读不出文件',
      ordinal: 2,
    });
    const before = await api.readWriteBatch(ROOT);
    expect(before.batch?.chapters.map((chapter) => chapter.title)).toEqual(['标题2', '标题3']);
    expect(before.batch?.note).toBe('节奏快一点');
    const plan = await api.previewWriteBatchResume({
      projectRoot: ROOT,
      permissionProfile: 'ask',
      modelKey: MODEL,
    });
    expect(plan.can_start).toBe(true);
    expect(plan.chapters.map((chapter) => chapter.status)).toEqual(['write', 'write']);
    expect(await api.readWriteBatch(ROOT)).toEqual(before);
  });

  it('starts, records a chapter, asks the next step, stops and is reviewed', async () => {
    await seedChapterRun('history', '正文/第001章.md', 1000);
    const api = await import('../src/lib/api/write-batch');
    const started = await api.startWriteBatch({
      projectRoot: ROOT,
      from: 2,
      to: 3,
      permissionProfile: 'ask',
      modelKey: MODEL,
    });
    if (!started.started) throw new Error('应能开跑');
    const batch = started.batch;
    expect(batch).toMatchObject({ from: 2, to: 3, status: 'running', model_key: MODEL });
    expect(batch.legs[0]).toMatchObject({
      basis: 'history',
      estimated_tokens: 2000,
      cap_tokens: 3000,
    });

    const step = {
      projectRoot: ROOT,
      batchId: batch.id,
      permissionProfile: 'auto',
      modelKey: MODEL,
    } as const;
    expect(await api.nextWriteBatchStep(step)).toEqual({
      action: 'write',
      ordinal: 2,
      target_path: '正文/第002章.md',
      goal: '目标2',
      title: '标题2',
      note: null,
    });
    await seedChapterRun('run-2', '正文/第002章.md', 1500);
    fixture.project.apply({ '正文/第002章.md': file('第二章\n\n批量写的。\n') });
    const recorded = await api.recordWriteBatchChapter({
      projectRoot: ROOT,
      batchId: batch.id,
      ordinal: 2,
      runId: 'run-2',
      writtenPath: `${ROOT}\\正文\\第002章.md`,
      snapshotVersion: 'snap-2',
      factsBefore: null,
      factDisputes: 0,
      factsAdded: 4,
    });
    expect(recorded.chapters[0]).toMatchObject({
      state: 'written',
      tokens: 1500,
      check: { verdict: 'pass', issue_count: 0, summary: '通过' },
      snapshot_version: 'snap-2',
      facts_added: 4,
    });
    expect(recorded.chapters[0].written_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recorded.legs[0].used_tokens).toBe(1500);
    expect(await api.nextWriteBatchStep(step)).toMatchObject({ action: 'write', ordinal: 3 });

    const stopped = await api.stopWriteBatch({
      projectRoot: ROOT,
      batchId: batch.id,
      code: 'author_stopped',
      message: '作者按了停止。',
    });
    expect(stopped.stop).toEqual({ code: 'author_stopped', message: '作者按了停止。', ordinal: 3 });
    expect(await api.readWriteBatch(ROOT)).toMatchObject({
      batch: { status: 'stopped' },
      mismatches: [],
      can_resume: true,
      resume_from: 3,
    });

    const blocked = await api.startWriteBatch({
      projectRoot: ROOT,
      from: 3,
      to: 3,
      permissionProfile: 'ask',
      modelKey: MODEL,
    });
    expect(blocked.started).toBe(false);
    expect(blocked.plan.blockers.map((item) => item.code)).toContain('previous_batch_unreviewed');
    expect((await api.markWriteBatchReviewed(ROOT, batch.id)).reviewed).toBe(true);
  });

  it('plans an undo newest first, checks a chapter before deleting it, and records what was deleted', async () => {
    await seedChapterRun('history', '正文/第001章.md', 1000);
    const api = await import('../src/lib/api/write-batch');
    const started = await api.startWriteBatch({
      projectRoot: ROOT,
      from: 2,
      to: 3,
      permissionProfile: 'ask',
      modelKey: MODEL,
    });
    if (!started.started) throw new Error('应能开跑');
    const id = started.batch.id;
    const step = {
      projectRoot: ROOT,
      batchId: id,
      permissionProfile: 'auto',
      modelKey: MODEL,
    } as const;
    for (const ordinal of [2, 3]) {
      expect(await api.nextWriteBatchStep(step)).toMatchObject({ action: 'write', ordinal });
      const target = `正文/第00${ordinal}章.md`;
      await seedChapterRun(`run-${ordinal}`, target, 1500);
      fixture.project.apply({ [target]: file(`第${ordinal}章\n\n批量写的。\n`) });
      await api.recordWriteBatchChapter({
        projectRoot: ROOT,
        batchId: id,
        ordinal,
        runId: `run-${ordinal}`,
        writtenPath: `${ROOT}\\正文\\第00${ordinal}章.md`,
        snapshotVersion: `snap-${ordinal}`,
        factsBefore: `facts-${ordinal}`,
        factDisputes: 0,
        factsAdded: 1,
      });
    }
    expect(await api.nextWriteBatchStep(step)).toEqual({ action: 'finished' });

    const plan = await api.planWriteBatchUndo(ROOT, id, 2);
    expect(plan).toMatchObject({ from: 2, to: 3, facts_before: 'facts-2', can_undo: true });
    expect(plan.chapters.map((chapter) => [chapter.ordinal, chapter.facts_restore])).toEqual([
      [3, 'facts-3'],
      [2, 'facts-2'],
    ]);
    expect(await api.checkWriteBatchUndoChapter(ROOT, id, 3)).toBeNull();
    fixture.project.apply({ '正文/第003章.md': file('第三章\n\n作者改过。\n') });
    expect(await api.checkWriteBatchUndoChapter(ROOT, id, 3)).toMatchObject({ code: 'changed' });
    expect((await api.planWriteBatchUndo(ROOT, id, 2)).can_undo).toBe(false);

    fixture.project.apply({ '正文/第003章.md': null, '正文/第002章.md': null });
    const undone = await api.recordWriteBatchUndo({
      projectRoot: ROOT,
      batchId: id,
      fromOrdinal: 2,
      deleted: [3, 2],
      failure: null,
      factsRestored: true,
      factsError: null,
    });
    expect(undone.chapters.map((chapter) => chapter.state)).toEqual(['undone', 'undone']);
    expect(undone.stop).toMatchObject({ code: 'undone', ordinal: 2 });
    expect(await api.readWriteBatch(ROOT)).toMatchObject({ can_resume: true, resume_from: 2 });
  });

  it('stops a batch the app left running when the book is opened again', async () => {
    const api = await import('../src/lib/api/write-batch');
    expect(await api.recoverInterruptedWriteBatch(ROOT)).toEqual({ recovered: false, batch: null });
    const started = await api.startWriteBatch({
      projectRoot: ROOT,
      from: 2,
      to: 3,
      permissionProfile: 'ask',
      modelKey: MODEL,
    });
    expect(started.started).toBe(true);
    const recovered = await api.recoverInterruptedWriteBatch(ROOT);
    expect(recovered.recovered).toBe(true);
    expect(recovered.batch?.stop).toMatchObject({ code: 'app_closed', ordinal: 2 });
  });

  it('reports a broken record instead of pretending there is no batch', async () => {
    fixture.project.apply({ '.storyforge/write-batch.json': file('{"version": 9}') });
    const api = await import('../src/lib/api/write-batch');
    await expect(api.readWriteBatch(ROOT)).rejects.toThrow('版本是 9');
  });
});

describe('批量记录回包的解码', () => {
  const CHAPTER = {
    ordinal: 2,
    target_path: '正文/第002章.md',
    state: 'written',
    run_id: 'r',
    written_sha256: 'a'.repeat(64),
    chars: 1200,
    check: { verdict: 'pass', issue_count: 0, summary: '通过', extra: 1 },
    tokens: 5000,
    snapshot_version: 'v',
    facts_before: null,
    fact_disputes: 0,
    facts_added: 3,
    extra: 'dropped',
  };
  const BATCH = {
    version: 3,
    id: 'write-batch-1',
    from: 2,
    to: 2,
    created_at: '2026-10-30T08:00:00Z',
    model_key: MODEL,
    note: null,
    status: 'running',
    reviewed: false,
    stop: null,
    legs: [
      {
        started_at: '2026-10-30T08:00:00Z',
        basis: 'trial',
        estimated_tokens: null,
        cap_tokens: null,
        used_tokens: 5000,
        runs: [{ ordinal: 2, run_id: 'r', tokens: 5000 }],
      },
    ],
    chapters: [CHAPTER],
    internal: true,
  };
  const STOP = { code: 'author_stopped', message: '作者按了停止。', ordinal: 2 };

  it('keeps only the contract fields', () => {
    const batch = decodeWriteBatch(BATCH);
    expect(batch).not.toHaveProperty('internal');
    expect(batch.chapters[0]).not.toHaveProperty('extra');
    expect(batch.chapters[0].check).not.toHaveProperty('extra');
    expect(
      decodeWriteBatchStep({ action: 'stop', code: 'cap_reached', message: 'm', ordinal: 3, x: 1 }),
    ).toEqual({ action: 'stop', code: 'cap_reached', message: 'm', ordinal: 3 });
    expect(
      decodeWriteBatchView({ batch: null, mismatches: [], can_resume: false, resume_from: null }),
    ).toEqual({ batch: null, mismatches: [], can_resume: false, resume_from: null });
  });

  it.each([
    ['unknown chapter state', { chapters: [{ ...CHAPTER, state: 'maybe' }] }],
    ['stopped without a reason', { status: 'stopped' }],
    ['a reason on a running batch', { stop: { code: 'app_closed', message: 'm', ordinal: null } }],
    ['unknown stop code', { status: 'stopped', stop: { code: 'later', message: 'm', ordinal: 2 } }],
    ['negative leg usage', { legs: [{ ...BATCH.legs[0], used_tokens: -1 }] }],
    ['missing reviewed', { reviewed: undefined }],
    ['a note that is not text', { note: 3 }],
    ['a chapter without the facts count', { chapters: [{ ...CHAPTER, facts_added: undefined }] }],
  ])('rejects %s', (_name, change) => {
    expect(() => decodeWriteBatch({ ...BATCH, ...change })).toThrow(WriteBatchShapeError);
  });

  it.each([
    ['unknown action', { action: 'pause' }],
    ['a write step without a target', { action: 'write', ordinal: 2, goal: null }],
    [
      'a write step without the note and title',
      { action: 'write', ordinal: 2, target_path: '正文/第002章.md', goal: null },
    ],
    [
      'a stop step with a made-up code',
      { action: 'stop', code: 'tired', message: 'm', ordinal: 2 },
    ],
  ])('rejects a next step with %s', (_name, step) => {
    expect(() => decodeWriteBatchStep(step)).toThrow(WriteBatchShapeError);
  });

  it('rejects an unknown mismatch kind', () => {
    expect(() =>
      decodeWriteBatchView({
        batch: null,
        mismatches: [{ ordinal: 2, kind: 'odd', message: 'm' }],
        can_resume: false,
        resume_from: null,
      }),
    ).toThrow(WriteBatchShapeError);
  });

  it.each([
    ['without a batch', { batch: null, resume_from: 2 }],
    ['on a running batch', { batch: BATCH, resume_from: 2 }],
    [
      'without a chapter to resume from',
      { batch: { ...BATCH, status: 'stopped', stop: STOP }, resume_from: null },
    ],
    ['with a missing can_resume', { batch: null, resume_from: null, can_resume: undefined }],
  ])('rejects a view that offers to resume %s', (_name, change) => {
    expect(() => decodeWriteBatchView({ mismatches: [], can_resume: true, ...change })).toThrow(
      WriteBatchShapeError,
    );
  });

  it('accepts a stopped batch that can resume, with the chapter titles read from the plan', () => {
    const view = decodeWriteBatchView({
      batch: {
        ...BATCH,
        status: 'stopped',
        stop: { ...STOP, code: 'scheduler_error' },
        chapters: [{ ...CHAPTER, title: '标题2', goal: '目标2' }],
      },
      mismatches: [],
      can_resume: true,
      resume_from: 2,
    });
    expect(view).toMatchObject({ can_resume: true, resume_from: 2 });
    expect(view.batch?.chapters[0]).toMatchObject({
      ordinal: 2,
      title: '标题2',
      goal: '目标2',
      facts_added: 3,
    });
    expect(view.batch?.chapters[0]).not.toHaveProperty('extra');
    expect(view.batch?.stop?.code).toBe('scheduler_error');
  });

  it('rejects a view whose chapters miss the title', () => {
    expect(() =>
      decodeWriteBatchView({ batch: BATCH, mismatches: [], can_resume: false, resume_from: 2 }),
    ).toThrow(WriteBatchShapeError);
  });

  it('rejects a view whose chapters miss the goal', () => {
    expect(() =>
      decodeWriteBatchView({
        batch: { ...BATCH, chapters: [{ ...CHAPTER, title: '标题2' }] },
        mismatches: [],
        can_resume: false,
        resume_from: 2,
      }),
    ).toThrow(WriteBatchShapeError);
  });

  it('accepts an undone chapter and a batch stopped by the undo', () => {
    const batch = decodeWriteBatch({
      ...BATCH,
      status: 'stopped',
      stop: { code: 'undone', message: '撤销了第 2 章。', ordinal: 2 },
      chapters: [{ ...CHAPTER, state: 'undone' }],
    });
    expect(batch.chapters[0].state).toBe('undone');
    expect(batch.stop?.code).toBe('undone');
  });
});

describe('撤销计划的解码', () => {
  const PLAN = {
    batch_id: 'write-batch-1',
    from: 2,
    to: 3,
    chapters: [
      {
        ordinal: 3,
        target_path: '正文/第003章.md',
        written_sha256: 'b',
        facts_restore: 'f3',
        x: 1,
      },
      { ordinal: 2, target_path: '正文/第002章.md', written_sha256: 'a', facts_restore: 'f2' },
    ],
    facts_before: 'f2',
    blockers: [],
    can_undo: true,
    extra: true,
  };

  it('keeps only the contract fields', () => {
    const plan = decodeWriteBatchUndoPlan(PLAN);
    expect(plan).not.toHaveProperty('extra');
    expect(plan.chapters[0]).not.toHaveProperty('x');
    expect(plan.chapters.map((chapter) => chapter.ordinal)).toEqual([3, 2]);
  });

  it.each([
    ['chapters not newest first', { chapters: [...PLAN.chapters].reverse() }],
    ['can_undo with a blocker', { blockers: [{ code: 'changed', message: 'm', chapters: [3] }] }],
    ['can_undo with nothing to delete', { chapters: [], to: null }],
    [
      'an unknown blocker',
      { can_undo: false, blockers: [{ code: 'odd', message: 'm', chapters: [] }] },
    ],
  ])('rejects %s', (_name, change) => {
    expect(() => decodeWriteBatchUndoPlan({ ...PLAN, ...change })).toThrow(WriteBatchShapeError);
  });
});
