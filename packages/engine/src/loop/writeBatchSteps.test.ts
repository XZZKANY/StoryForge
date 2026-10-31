import { describe, expect, it } from 'vitest';
import { InputDomainError } from '../kernel/json';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { sha256Hex } from '../kernel/sha256';
import { MemoryRunStore } from '../store/runs';
import { chapterChars } from './chapterCheckProtocol';
import { REQUEST_EVIDENCE_KIND } from './requestEvidence';
import { AgentRunNotFoundError } from './runEvents';
import { AGENT_RUN_FAILED } from './runPayloads';
import { formatTokenCount, planWriteBatch } from './writeBatch';
import {
  readWriteBatchRecord,
  WRITE_BATCH_RELATIVE_PATH,
  type WriteBatchRecord,
} from './writeBatchRecord';
import {
  checkWriteBatchUndoChapter,
  markWriteBatchReviewed,
  nextWriteBatchStep,
  planWriteBatchUndo,
  previewWriteBatchResume,
  readWriteBatch,
  recordWriteBatchChapter,
  recordWriteBatchUndo,
  recoverInterruptedWriteBatch,
  resumeWriteBatch,
  startWriteBatch,
  stopWriteBatch,
  WriteBatchError,
  type WriteBatchRunDeps,
} from './writeBatchSteps';

const ROOT = '/book';
const MODEL = 'main:deepseek-v4-flash';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const pathOf = (ordinal: number) => `正文/第${String(ordinal).padStart(3, '0')}章.md`;
const SETUP = {
  '大纲/总纲.md': file('主线：林舟入城寻亲。\n'),
  '人物/主角.md': file('林舟：少年。\n'),
  '设定/世界规则.md': file('城门三更关闭。\n'),
};
const chapterFiles = (...ordinals: number[]) =>
  Object.fromEntries(ordinals.map((n) => [pathOf(n), file(`第${n}章\n\n正文。\n`)]));
const goals = (to: number) => ({
  '.storyforge/serial-plan.json': file(
    JSON.stringify({
      version: 1,
      chapters: Array.from({ length: to }, (_, index) => ({
        ordinal: index + 1,
        title: `标题${index + 1}`,
        goal: `第${index + 1}章目标`,
        status: 'pending',
      })),
    }),
  ),
});
const PASS = {
  status: 'pass',
  execution_status: 'completed',
  manuscript_hard_failure_count: 0,
  hard_failure_count: 0,
  advisory_count: 0,
  findings: [],
  repair_count: 0,
};

type RunSpec = {
  publicId: string;
  target?: string | null;
  tokens?: number[];
  status?: string;
  currentStep?: string;
  check?: object | null;
  patch?: 'auto' | 'confirm' | null;
  failure?: string;
};

/**
 * 合成作品（已写到第 1 章，计划到第 to 章）+ 内存引擎库；history 为 true 时库里先有一次写章记录
 * （historyTokens，默认 1000 token）。
 */
function harness(
  options: { to?: number; written?: number[]; history?: boolean; historyTokens?: number } = {},
) {
  const project = memoryProject(ROOT, {
    ...SETUP,
    ...chapterFiles(...(options.written ?? [1])),
    ...goals(options.to ?? 6),
  });
  const store = new MemoryRunStore();
  let hex = 0;
  const deps: WriteBatchRunDeps = {
    reader: project.reader,
    writer: project.writer,
    store,
    sessions: { getSession: async (id: number) => ({ id, project_path: ROOT }) },
    platform: 'posix',
    now: () => new Date('2026-10-30T08:00:00.123Z'),
    newHex: () => `h${++hex}`,
  };
  async function addRun(spec: RunSpec) {
    const confirm = spec.patch === 'confirm';
    const run = await store.insertRun({
      public_id: spec.publicId,
      session_id: 's',
      assistant_session_id: 1,
      goal: '写下一章',
      scope: {},
      permission_profile: 'auto',
      budget: {},
      status: spec.status ?? (spec.failure ? 'failed' : confirm ? 'paused' : 'completed'),
      root_plan: [],
      current_step: spec.currentStep ?? (confirm ? 'permission.confirm' : 'completed'),
    });
    for (const total of spec.tokens ?? [1000])
      await store.insertArtifact({
        run_id: run.id,
        kind: REQUEST_EVIDENCE_KIND,
        payload: {
          status: 'response_completed',
          usage: {
            token_usage: total,
            prompt_tokens: total - 1,
            completion_tokens: 1,
            cache_hit_tokens: null,
            token_usage_source: 'provider_usage',
          },
        },
        requires_confirmation: false,
      });
    if (spec.target !== null)
      await store.insertArtifact({
        run_id: run.id,
        kind: 'chapter_brief',
        payload: { target_path: spec.target ?? '正文/第001章.md' },
        requires_confirmation: false,
      });
    const check = spec.check === undefined ? PASS : spec.check;
    if (check !== null)
      await store.insertArtifact({
        run_id: run.id,
        kind: 'chapter_check',
        payload: check as Record<string, unknown>,
        requires_confirmation: false,
      });
    const patch = spec.patch === undefined ? 'auto' : spec.patch;
    if (patch !== null)
      await store.insertArtifact({
        run_id: run.id,
        kind: 'proposed_patch',
        payload: { file_path: `${ROOT}/${spec.target}`, requires_confirmation: confirm },
        requires_confirmation: confirm,
      });
    if (spec.failure)
      await store.appendEvent({
        run_id: run.id,
        event_type: AGENT_RUN_FAILED,
        actor: 'root-agent',
        message: spec.failure,
        payload: {},
      });
    return run;
  }
  const historyReady = options.history
    ? addRun({
        publicId: 'history',
        target: '正文/第001章.md',
        tokens: [options.historyTokens ?? 1000],
      })
    : Promise.resolve();
  const start = async (from: number, to: number, profile = 'ask') => {
    await historyReady;
    return startWriteBatch(deps, {
      project_root: ROOT,
      from,
      to,
      permission_profile: profile,
      model_key: MODEL,
    });
  };
  /** 界面一侧：跑一章、写进文件、记一笔。 */
  async function writeChapter(
    batch: WriteBatchRecord,
    ordinal: number,
    spec: Partial<RunSpec> & {
      written?: boolean;
      disputes?: number;
      text?: string;
      factsBefore?: string | null;
      factsAdded?: number | null;
    } = {},
  ) {
    const target = pathOf(ordinal);
    const runId = spec.publicId ?? `run-${ordinal}-${++hex}`;
    await addRun({ target, ...spec, publicId: runId });
    const written = spec.written ?? true;
    if (written)
      project.apply({ [target]: file(spec.text ?? `第${ordinal}章\n\n批量写的正文。\n`) });
    return recordWriteBatchChapter(deps, ROOT, batch.id, {
      ordinal,
      run_id: runId,
      written_path: written ? `${ROOT}/${target}` : null,
      snapshot_version: `snap-${ordinal}`,
      facts_before: spec.factsBefore === undefined ? `facts-${ordinal}` : spec.factsBefore,
      fact_disputes: spec.disputes ?? 0,
      facts_added: spec.factsAdded === undefined ? 2 : spec.factsAdded,
    });
  }
  const next = (batch: WriteBatchRecord, profile = 'auto', model = MODEL) =>
    nextWriteBatchStep(deps, ROOT, batch.id, { permission_profile: profile, model_key: model });
  const saved = () => readWriteBatchRecord(project.reader, ROOT);
  return { project, store, deps, addRun, start, writeChapter, next, saved };
}

async function started(h: ReturnType<typeof harness>, from: number, to: number) {
  const result = await h.start(from, to);
  if (!result.started) throw new Error(JSON.stringify(result.plan.blockers));
  return result.batch;
}

describe('批量记录的读写', () => {
  it('writes .storyforge/write-batch.json and reads the same record back', async () => {
    const h = harness({ history: true });
    h.project.takeWrites();
    const batch = await started(h, 2, 4);
    const writes = h.project.takeWrites();
    expect(Object.keys(writes)).toEqual([WRITE_BATCH_RELATIVE_PATH]);
    expect(await h.saved()).toEqual(batch);
    expect(batch).toMatchObject({
      version: 3,
      id: 'write-batch-h1',
      from: 2,
      to: 4,
      created_at: '2026-10-30T08:00:00Z',
      model_key: MODEL,
      note: null,
      status: 'running',
      reviewed: false,
      stop: null,
    });
    expect(batch.legs).toEqual([
      {
        started_at: '2026-10-30T08:00:00Z',
        basis: 'history',
        estimated_tokens: 3000,
        cap_tokens: 4500,
        used_tokens: 0,
        runs: [],
      },
    ]);
    expect(batch.chapters.map((chapter) => [chapter.ordinal, chapter.state])).toEqual([
      [2, 'pending'],
      [3, 'pending'],
      [4, 'pending'],
    ]);
  });

  it('reports no batch when the file does not exist', async () => {
    const h = harness();
    expect(await readWriteBatch(h.deps, ROOT)).toEqual({
      batch: null,
      mismatches: [],
      can_resume: false,
      resume_from: null,
    });
  });

  const corrupt = async (mutate: (record: Record<string, unknown>) => void) => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    const raw = JSON.parse(JSON.stringify(batch)) as Record<string, unknown>;
    mutate(raw);
    h.project.apply({ [WRITE_BATCH_RELATIVE_PATH]: file(JSON.stringify(raw)) });
    return h;
  };

  it.each([
    ['an unknown version', (raw: Record<string, unknown>) => (raw.version = 4), '版本是 4'],
    ['an unknown status', (raw: Record<string, unknown>) => (raw.status = 'paused'), 'status'],
    [
      'chapters that do not match the range',
      (raw: Record<string, unknown>) => (raw.chapters as unknown[]).pop(),
      '章数和范围对不上',
    ],
    [
      'a stopped batch without a reason',
      (raw: Record<string, unknown>) => (raw.status = 'stopped'),
      'status 和 stop 对不上',
    ],
    [
      'a negative token count',
      (raw: Record<string, unknown>) =>
        ((raw.legs as Record<string, unknown>[])[0].used_tokens = -1),
      'used_tokens',
    ],
  ])('refuses a record with %s instead of treating it as no batch', async (_n, mutate, says) => {
    const h = await corrupt(mutate);
    await expect(readWriteBatch(h.deps, ROOT)).rejects.toThrow(InputDomainError);
    await expect(readWriteBatch(h.deps, ROOT)).rejects.toThrow(says);
    await expect(
      planWriteBatch(h.deps, { project_root: ROOT, from: 2, to: 3, permission_profile: 'ask' }),
    ).rejects.toThrow(InputDomainError);
  });

  it('refuses a file that is not JSON', async () => {
    const h = harness();
    h.project.apply({ [WRITE_BATCH_RELATIVE_PATH]: file('{not json') });
    await expect(readWriteBatch(h.deps, ROOT)).rejects.toThrow(InputDomainError);
  });
});

describe('开跑', () => {
  it('refuses to start on a blocker and writes nothing', async () => {
    const h = harness({ history: true });
    h.project.takeWrites();
    const result = await h.start(2, 3, 'read');
    expect(result.started).toBe(false);
    expect(result.batch).toBeNull();
    expect(result.plan.blockers.map((blocker) => blocker.code)).toEqual(['read_only']);
    expect(h.project.takeWrites()).toEqual({});
  });

  it('starts a trial leg without an estimate or cap when the book has no history', async () => {
    const h = harness();
    const batch = await started(h, 2, 4);
    expect(batch.legs[0]).toMatchObject({
      basis: 'trial',
      estimated_tokens: null,
      cap_tokens: null,
    });
    expect(batch.chapters.map((chapter) => chapter.state)).toEqual([
      'pending',
      'after_trial',
      'after_trial',
    ]);
  });

  it('marks chapters that already have a manuscript as skipped', async () => {
    const h = harness({ history: true, written: [1, 2] });
    const batch = await started(h, 2, 3);
    expect(batch.chapters.map((chapter) => chapter.state)).toEqual(['skipped_written', 'pending']);
  });

  it('needs a model key to notice a model change later', async () => {
    const h = harness({ history: true });
    await expect(
      startWriteBatch(h.deps, {
        project_root: ROOT,
        from: 2,
        to: 3,
        permission_profile: 'ask',
        model_key: ' ',
      }),
    ).rejects.toThrow(WriteBatchError);
  });

  it('refuses a range wider than 10000 chapters as a mistyped range, not a batch-size limit', async () => {
    const h = harness({ history: true });
    const plan = (to: number) =>
      planWriteBatch(h.deps, { project_root: ROOT, from: 2, to, permission_profile: 'ask' });
    const wide = await plan(10_002);
    expect(wide.blockers.map((blocker) => blocker.code)).toEqual(['invalid_range']);
    expect(wide.blockers[0].message).toContain('10001 章');
    expect(wide.blockers[0].message).toContain('防输错');
    expect(wide.blockers[0].message).toContain('每批章数不设上限');
    expect((await plan(10_001)).blockers.map((blocker) => blocker.code)).not.toContain(
      'invalid_range',
    );
  });
});

describe('上一批没审完就不能开新的一批，续写不受限', () => {
  async function stoppedBatch() {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, {
      publicId: 'r2',
      failure: '网络断了，重发两次仍失败。',
      patch: null,
      written: false,
    });
    expect(await h.next(batch)).toMatchObject({ action: 'stop', code: 'run_failed' });
    return { h, batch };
  }

  it('blocks a new batch while the last one is stopped and unreviewed, offering both ways out', async () => {
    const { h, batch } = await stoppedBatch();
    h.project.takeWrites();
    const result = await h.start(3, 4);
    expect(result.started).toBe(false);
    expect(result.batch?.id).toBe(batch.id);
    const blocker = result.plan.blockers.find((item) => item.code === 'previous_batch_unreviewed');
    expect(blocker?.message).toContain('先在清单上点「这批审完了」');
    expect(blocker?.message).toContain('续写上一批');
    expect(h.project.takeWrites()).toEqual({});

    await markWriteBatchReviewed(h.deps, ROOT, batch.id);
    const again = await h.start(2, 3);
    expect(again.started).toBe(true);
    expect(again.batch?.id).not.toBe(batch.id);
  });

  it('resumes a stopped batch without asking for the review first', async () => {
    const { h, batch } = await stoppedBatch();
    const result = await resumeWriteBatch(h.deps, {
      project_root: ROOT,
      permission_profile: 'ask',
      model_key: MODEL,
    });
    expect(result.started).toBe(true);
    expect(result.batch).toMatchObject({
      id: batch.id,
      status: 'running',
      stop: null,
      reviewed: false,
    });
  });

  it('blocks a new batch while the last one is still running', async () => {
    const h = harness({ history: true });
    await started(h, 2, 3);
    const result = await h.start(2, 3);
    expect(result.plan.blockers.map((blocker) => blocker.code)).toContain('batch_running');
  });

  it('only offers the review when the last batch finished', async () => {
    const h = harness({ history: true, to: 2 });
    const batch = await started(h, 2, 2);
    await h.writeChapter(batch, 2);
    expect(await h.next(batch)).toEqual({ action: 'finished' });
    const blocker = (await h.start(3, 3)).plan.blockers.find(
      (item) => item.code === 'previous_batch_unreviewed',
    );
    expect(blocker?.message).toContain('写完了，还没审完');
    expect(blocker?.message).not.toContain('续写');
  });

  it('refuses to mark a running batch reviewed, and to resume one that is not stopped', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    await expect(markWriteBatchReviewed(h.deps, ROOT, batch.id)).rejects.toThrow('还在写');
    await expect(
      resumeWriteBatch(h.deps, { project_root: ROOT, permission_profile: 'ask', model_key: MODEL }),
    ).rejects.toThrow(WriteBatchError);
  });
});

describe('下一步：规则 1 上一章没写成就停在那一章', () => {
  it('stops at a chapter whose run failed, with the failure in the message', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, {
      failure: '本轮执行时间预算已用完。',
      patch: null,
      written: false,
    });
    const step = await h.next(batch);
    expect(step).toEqual({
      action: 'stop',
      code: 'run_failed',
      message: '第 2 章的运行失败了：本轮执行时间预算已用完。',
      ordinal: 2,
    });
    const saved = await h.saved();
    expect(saved).toMatchObject({ status: 'stopped', stop: { code: 'run_failed', ordinal: 2 } });
    expect(saved!.chapters[0].state).toBe('stopped_here');
    // 停了以后再问，原样回报，不再判断。
    expect(await h.next(batch)).toEqual(step);
  });

  it('stops at a chapter the check blocked', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, {
      check: {
        ...PASS,
        status: 'blocked',
        manuscript_hard_failure_count: 2,
        hard_failure_count: 2,
        findings: [{}, {}],
      },
      patch: null,
      written: false,
    });
    expect(await h.next(batch)).toMatchObject({
      action: 'stop',
      code: 'check_blocked',
      ordinal: 2,
    });
    expect((await h.saved())!.chapters[0].check).toEqual({
      verdict: 'blocked',
      issue_count: 2,
      summary: '检查拦下：2 个硬问题',
    });
  });

  it('stops at a chapter whose run was stopped by the author', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { status: 'stopped', patch: null, check: null, written: false });
    expect(await h.next(batch)).toMatchObject({ action: 'stop', code: 'run_stopped', ordinal: 2 });
  });

  it('stops at a chapter whose run handed in no revision', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { patch: null, check: null, written: false });
    expect(await h.next(batch)).toMatchObject({ action: 'stop', code: 'no_revision', ordinal: 2 });
  });
});

describe('下一步：规则 2 修订要作者处理就停在那一章', () => {
  it('stops when the revision needs the author to accept it', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, {
      patch: 'confirm',
      check: { ...PASS, status: 'blocked', execution_status: 'failed', hard_failure_count: 1 },
      written: false,
    });
    const step = await h.next(batch);
    expect(step).toMatchObject({ action: 'stop', code: 'needs_confirmation', ordinal: 2 });
    expect(step.action === 'stop' && step.message).toContain('检查器重查后仍没给出结果');
    expect((await h.saved())!.chapters[0].check?.verdict).toBe('unchecked');
  });

  it('stops even if the author already accepted that revision', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { patch: 'confirm', status: 'completed' });
    expect(await h.next(batch)).toMatchObject({ code: 'needs_confirmation', ordinal: 2 });
    expect((await h.saved())!.chapters[0].state).toBe('written');
  });

  it('stops when writing into the file was blocked', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { written: false });
    expect(await h.next(batch)).toMatchObject({
      action: 'stop',
      code: 'writeback_blocked',
      ordinal: 2,
    });
  });

  it('checks the run before the revision: a failed run wins over a pending revision', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, {
      patch: 'confirm',
      failure: '作者拒绝了权限请求。',
      written: false,
    });
    expect(await h.next(batch)).toMatchObject({ code: 'run_failed' });
  });
});

describe('下一步：规则 3–6 在开下一章之前判断', () => {
  it('stops before the next chapter when facts disagreed (rule 3)', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { disputes: 2 });
    const step = await h.next(batch);
    expect(step).toMatchObject({ action: 'stop', code: 'fact_disputes', ordinal: 3 });
    expect(step.action === 'stop' && step.message).toContain('有 2 条和已记的对不上');
    expect((await h.saved())!.chapters[0].state).toBe('written');
  });

  it('reports the fact disputes before the cap when both apply', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { disputes: 1, tokens: [9000] });
    expect(await h.next(batch)).toMatchObject({ code: 'fact_disputes' });
  });

  it('reports a failed chapter before its fact disputes', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { disputes: 1, patch: null, failure: '断网', written: false });
    expect(await h.next(batch)).toMatchObject({ code: 'run_failed' });
  });

  it('stops when the profile turned read-only (rule 4)', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2);
    expect(await h.next(batch, 'read')).toMatchObject({ code: 'read_only', ordinal: 3 });
  });

  it('stops when the model changed since this leg started (rule 4)', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2);
    const step = await h.next(batch, 'auto', 'main:other-model');
    expect(step).toMatchObject({ code: 'model_changed', ordinal: 3 });
    expect(step.action === 'stop' && step.message).toContain('重新估');
  });

  it('checks read-only before the cap', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { tokens: [9000] });
    expect(await h.next(batch, 'read')).toMatchObject({ code: 'read_only' });
  });

  it('stops once the leg has used exactly its cap (rule 5)', async () => {
    const h = harness({ history: true, historyTokens: 100_000 });
    // 历史每章 10 万：三章预估 30 万，上限 45 万。
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { tokens: [400_000] });
    expect(await h.next(batch)).toMatchObject({ action: 'write', ordinal: 3 });
    await h.writeChapter(batch, 3, { tokens: [50_000] });
    const step = await h.next(batch);
    expect(step).toMatchObject({ action: 'stop', code: 'cap_reached', ordinal: 4 });
    expect(step.action === 'stop' && step.message).toContain('已用 45 万 / 上限 45 万 token');
    expect(step.action === 'stop' && step.message).not.toContain('超出');
    // 记录里存的仍是原始整数。
    expect((await h.saved())!.legs[0]).toMatchObject({ used_tokens: 450_000, cap_tokens: 450_000 });
  });

  it('finishes the chapter that crossed the cap and states the overshoot', async () => {
    const h = harness({ history: true, historyTokens: 100_000 });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { tokens: [523_456] });
    const step = await h.next(batch);
    expect(step).toMatchObject({ code: 'cap_reached', ordinal: 3 });
    expect(step.action === 'stop' && step.message).toContain(
      '已用 52.3 万 / 上限 45 万 token，超出 7.3 万',
    );
    expect((await h.saved())!.chapters[0]).toMatchObject({ state: 'written', tokens: 523_456 });
  });

  it('keeps going just under the cap', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { tokens: [4499] });
    expect(await h.next(batch)).toMatchObject({ action: 'write', ordinal: 3 });
  });

  it('stops after the trial chapter so the rest can be estimated (rule 6)', async () => {
    const h = harness();
    const batch = await started(h, 2, 4);
    expect(await h.next(batch)).toMatchObject({ action: 'write', ordinal: 2 });
    await h.writeChapter(batch, 2, { tokens: [7000] });
    const step = await h.next(batch);
    expect(step).toMatchObject({ action: 'stop', code: 'trial_done', ordinal: 3 });
    expect(step.action === 'stop' && step.message).toContain('量完了');
    expect(step.action === 'stop' && step.message).toContain('剩下 2 章的预估');
  });

  it('finishes instead of stopping when no chapter is left to write', async () => {
    const h = harness({ history: true, to: 2 });
    const batch = await started(h, 2, 2);
    await h.writeChapter(batch, 2, { disputes: 3, tokens: [9000] });
    expect(await h.next(batch)).toEqual({ action: 'finished' });
    expect(await h.saved()).toMatchObject({ status: 'finished', stop: null });
  });
});

describe('下一步：规则 7 以正文为准取下一章', () => {
  it('writes the chapters in order with the plan goal, then finishes', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    expect(await h.next(batch)).toEqual({
      action: 'write',
      ordinal: 2,
      target_path: '正文/第002章.md',
      goal: '第2章目标',
      title: '标题2',
      note: null,
    });
    await h.writeChapter(batch, 2);
    expect(await h.next(batch)).toMatchObject({ action: 'write', ordinal: 3, goal: '第3章目标' });
    await h.writeChapter(batch, 3);
    expect(await h.next(batch)).toEqual({ action: 'finished' });
  });

  it('skips a chapter the author wrote meanwhile and marks it', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2);
    h.project.apply({ [pathOf(3)]: file('第3章\n\n作者自己写的。\n') });
    expect(await h.next(batch)).toMatchObject({ action: 'write', ordinal: 4 });
    expect((await h.saved())!.chapters.map((chapter) => chapter.state)).toEqual([
      'written',
      'skipped_written',
      'pending',
    ]);
  });

  it('writes a chapter again when its file is gone, whatever the record says', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2);
    h.project.apply({ [pathOf(2)]: null });
    expect(await h.next(batch)).toMatchObject({ action: 'write', ordinal: 2 });
    const view = await readWriteBatch(h.deps, ROOT);
    expect(view.mismatches).toEqual([
      {
        ordinal: 2,
        kind: 'missing',
        message: '记录说第 2 章写进了 正文/第002章.md，正文里找不到了：以正文为准。',
      },
    ]);
  });

  it('flags chapters changed after writing and chapters written outside the batch', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2);
    await h.writeChapter(batch, 3, { written: false });
    await h.next(batch);
    h.project.apply({
      [pathOf(2)]: file('第2章\n\n作者审稿时改过。\n'),
      [pathOf(3)]: file('第3章\n\n作者接受了修订。\n'),
    });
    const view = await readWriteBatch(h.deps, ROOT);
    expect(view.mismatches.map((item) => [item.ordinal, item.kind])).toEqual([
      [2, 'changed'],
      [3, 'written_outside'],
    ]);
  });
});

describe('记一章', () => {
  it('computes the fingerprint, length, usage and check itself, ignoring what the interface claims', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    const text = '第2章\n\n雨落在城门上。\n';
    await h.addRun({
      publicId: 'r2',
      target: pathOf(2),
      tokens: [1200, 300],
      check: { ...PASS, advisory_count: 2, findings: [{}, {}], repair_count: 1 },
    });
    h.project.apply({ [pathOf(2)]: file(text) });
    const record = await recordWriteBatchChapter(h.deps, ROOT, batch.id, {
      ordinal: 2,
      run_id: 'r2',
      written_path: `${ROOT}/${pathOf(2)}`,
      snapshot_version: 'snap-2',
      facts_before: 'facts-v7',
      fact_disputes: 0,
      facts_added: 4,
      written_sha256: 'from-the-interface',
      chars: 1,
      tokens: 1,
    } as Parameters<typeof recordWriteBatchChapter>[3]);
    expect(record.chapters[0]).toEqual({
      ordinal: 2,
      target_path: pathOf(2),
      state: 'written',
      run_id: 'r2',
      written_sha256: sha256Hex(new TextEncoder().encode(text)),
      chars: chapterChars(text),
      check: { verdict: 'pass', issue_count: 2, summary: '修过一次后通过，有 2 条建议' },
      tokens: 1500,
      snapshot_version: 'snap-2',
      facts_before: 'facts-v7',
      fact_disputes: 0,
      facts_added: 4,
    });
    expect(record.legs[0]).toMatchObject({
      used_tokens: 1500,
      runs: [{ ordinal: 2, run_id: 'r2', tokens: 1500 }],
    });
    expect(await h.saved()).toEqual(record);
  });

  it('does not count the same run twice', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    await h.writeChapter(batch, 2, { publicId: 'r2', tokens: [800] });
    const again = await recordWriteBatchChapter(h.deps, ROOT, batch.id, {
      ordinal: 2,
      run_id: 'r2',
      written_path: `${ROOT}/${pathOf(2)}`,
      snapshot_version: null,
      facts_before: null,
      fact_disputes: 0,
    });
    expect(again.legs[0]).toMatchObject({ used_tokens: 800, runs: [{ run_id: 'r2' }] });
  });

  it('refuses inconsistent reports from the interface', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    const record = (fields: Partial<Parameters<typeof recordWriteBatchChapter>[3]>) =>
      recordWriteBatchChapter(h.deps, ROOT, batch.id, {
        ordinal: 2,
        run_id: 'r2',
        written_path: `${ROOT}/${pathOf(2)}`,
        snapshot_version: null,
        facts_before: null,
        fact_disputes: 0,
        ...fields,
      });
    await expect(record({ run_id: 'nope' })).rejects.toThrow(AgentRunNotFoundError);
    await h.addRun({ publicId: 'busy', target: pathOf(2), status: 'running' });
    await expect(record({ run_id: 'busy' })).rejects.toThrow('还没结束');
    await h.addRun({ publicId: 'other', target: pathOf(3) });
    await expect(record({ run_id: 'other' })).rejects.toThrow('不是第 2 章');
    await h.addRun({ publicId: 'r2', target: pathOf(2) });
    // 文件还没写进去。
    await expect(record({})).rejects.toThrow('正文里找不到这个文件');
    h.project.apply({ [pathOf(2)]: file('第2章\n\n正文。\n') });
    await expect(record({ written_path: `${ROOT}/${pathOf(3)}` })).rejects.toThrow(
      '不是第 2 章的目标文件',
    );
    await expect(record({ ordinal: 9 })).rejects.toThrow('不在这一批的范围');
    await expect(record({ fact_disputes: -1 })).rejects.toThrow(WriteBatchError);
    await expect(record({ facts_added: -1 })).rejects.toThrow(WriteBatchError);
    await h.addRun({ publicId: 'no-patch', target: pathOf(2), patch: null });
    await expect(record({ run_id: 'no-patch' })).rejects.toThrow('没有交出修订');
  });

  it('refuses to record into a batch that is not the latest or not running', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    await expect(
      recordWriteBatchChapter(h.deps, ROOT, 'write-batch-old', {
        ordinal: 2,
        run_id: 'r',
        written_path: null,
        snapshot_version: null,
        facts_before: null,
        fact_disputes: 0,
      }),
    ).rejects.toThrow('不是最近一批');
    await stopWriteBatch(h.deps, ROOT, batch.id, {
      code: 'author_stopped',
      message: '作者停下了。',
    });
    await expect(h.writeChapter(batch, 2)).rejects.toThrow('停下或写完了');
  });
});

describe('停下与恢复', () => {
  it('stops on the author request at the next chapter to write', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2);
    const stopped = await stopWriteBatch(h.deps, ROOT, batch.id, {
      code: 'author_stopped',
      message: '作者按了停止。',
    });
    expect(stopped).toMatchObject({
      status: 'stopped',
      stop: { code: 'author_stopped', message: '作者按了停止。', ordinal: 3 },
    });
    // 已停的批再停一次不改原因。
    const again = await stopWriteBatch(h.deps, ROOT, batch.id, {
      code: 'app_closed',
      message: '应用关了。',
    });
    expect(again.stop?.code).toBe('author_stopped');
  });

  it('only accepts the stop reasons the interface can know', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await expect(
      stopWriteBatch(h.deps, ROOT, batch.id, { code: 'cap_reached', message: '假装到上限了' }),
    ).rejects.toThrow(WriteBatchError);
  });

  it('turns a batch left running by a closed app into a stopped one, without resuming it', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2);
    const recovered = await recoverInterruptedWriteBatch(h.deps, ROOT);
    expect(recovered.recovered).toBe(true);
    expect(recovered.batch).toMatchObject({
      status: 'stopped',
      stop: { code: 'app_closed', ordinal: 3 },
    });
    expect(recovered.batch?.stop?.message).toContain('停在第 3 章');
    expect(await h.next(batch)).toMatchObject({ action: 'stop', code: 'app_closed' });
    expect(await recoverInterruptedWriteBatch(h.deps, ROOT)).toMatchObject({ recovered: false });
  });

  it('has nothing to recover without a batch', async () => {
    const h = harness();
    expect(await recoverInterruptedWriteBatch(h.deps, ROOT)).toEqual({
      recovered: false,
      batch: null,
    });
  });
});

describe('续写', () => {
  it('opens a new leg with a fresh estimate and cap, and retries the chapter it stopped at', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { tokens: [3000] });
    await h.writeChapter(batch, 3, { tokens: [1000], patch: null, check: null, written: false });
    expect(await h.next(batch)).toMatchObject({ code: 'no_revision', ordinal: 3 });

    const result = await resumeWriteBatch(h.deps, {
      project_root: ROOT,
      permission_profile: 'ask',
      model_key: 'main:new-model',
    });
    expect(result.started).toBe(true);
    const resumed = result.batch!;
    // 历史现在是 1000（开跑前那章）与 3000（第 2 章）；第 3 章那次没走到检查结论，不算样本。
    expect(resumed.legs[1]).toMatchObject({
      basis: 'history',
      estimated_tokens: 4000,
      cap_tokens: 6000,
      used_tokens: 0,
      runs: [],
    });
    expect(resumed).toMatchObject({ status: 'running', stop: null, model_key: 'main:new-model' });
    expect(
      resumed.chapters.map((chapter) => [chapter.ordinal, chapter.state, chapter.run_id]),
    ).toEqual([
      [2, 'written', expect.any(String)],
      [3, 'pending', null],
      [4, 'pending', null],
    ]);
    expect(await h.next(resumed, 'auto', 'main:new-model')).toMatchObject({
      action: 'write',
      ordinal: 3,
    });
  });

  it('estimates the rest from the trial chapter', async () => {
    const h = harness();
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2, { tokens: [2000] });
    expect(await h.next(batch)).toMatchObject({ code: 'trial_done' });
    const resumed = (
      await resumeWriteBatch(h.deps, {
        project_root: ROOT,
        permission_profile: 'ask',
        model_key: MODEL,
      })
    ).batch!;
    expect(resumed.legs[1]).toMatchObject({
      basis: 'history',
      estimated_tokens: 4000,
      cap_tokens: 6000,
    });
    expect(resumed.chapters.map((chapter) => chapter.state)).toEqual([
      'written',
      'pending',
      'pending',
    ]);
    expect(await h.next(resumed)).toMatchObject({ action: 'write', ordinal: 3 });
  });

  it('marks the batch finished instead of leaving it stuck when every chapter has a manuscript', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    // 停在最后一章等作者处理；作者自己把这章接受了。
    await h.writeChapter(batch, 2);
    await h.writeChapter(batch, 3, { written: false });
    expect(await h.next(batch)).toMatchObject({ code: 'writeback_blocked', ordinal: 3 });
    h.project.apply({ [pathOf(3)]: file('第3章\n\n作者接受的修订。\n') });
    expect(await readWriteBatch(h.deps, ROOT)).toMatchObject({
      can_resume: false,
      resume_from: null,
    });

    const result = await resumeWriteBatch(h.deps, {
      project_root: ROOT,
      permission_profile: 'ask',
      model_key: MODEL,
    });
    expect(result.started).toBe(false);
    expect(result.plan.blockers).toEqual([
      {
        code: 'batch_all_written',
        message: '这一批（第 2–3 章）的章都已经有正文了，没有要续写的：去清单上审完就行。',
        chapters: [],
      },
    ]);
    expect(result.batch).toMatchObject({ status: 'finished', stop: null, legs: [{}] });
    expect(await h.saved()).toEqual(result.batch);
    // 写完了：再开新的一批只差「审完」。
    const blocker = (await h.start(4, 4)).plan.blockers.map((item) => item.code);
    expect(blocker).toEqual(['previous_batch_unreviewed']);
    await markWriteBatchReviewed(h.deps, ROOT, batch.id);
    expect((await h.start(4, 4)).started).toBe(true);
  });
});

describe('读记录时告诉界面能不能续写', () => {
  it('offers to resume a stopped batch from the next chapter without a manuscript', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 5);
    await h.writeChapter(batch, 2, { disputes: 1 });
    await h.next(batch);
    // 作者停下后自己写了第 3 章：从第 4 章接着写。
    h.project.apply({ [pathOf(3)]: file('第3章\n\n作者写的。\n') });
    expect(await readWriteBatch(h.deps, ROOT)).toMatchObject({
      batch: { status: 'stopped' },
      can_resume: true,
      resume_from: 4,
    });
  });

  it('does not offer to resume a running or finished batch, or no batch at all', async () => {
    const h = harness({ history: true, to: 3 });
    expect(await readWriteBatch(h.deps, ROOT)).toEqual({
      batch: null,
      mismatches: [],
      can_resume: false,
      resume_from: null,
    });
    const batch = await started(h, 2, 3);
    expect(await readWriteBatch(h.deps, ROOT)).toMatchObject({ can_resume: false, resume_from: 2 });
    await h.writeChapter(batch, 2);
    await h.writeChapter(batch, 3);
    expect(await h.next(batch)).toEqual({ action: 'finished' });
    expect(await readWriteBatch(h.deps, ROOT)).toMatchObject({
      can_resume: false,
      resume_from: null,
    });
  });
});

describe('给作者看的 token 数', () => {
  it.each([
    [523_456, '52.3 万'],
    [600_000, '60 万'],
    [599_960, '60 万'],
    [10_000, '1 万'],
    [4500, '0.5 万'],
    [0, '0 万'],
    [400, '不到 0.1 万'],
  ])('says %i tokens as %s', (tokens, text) => {
    expect(formatTokenCount(tokens)).toBe(text);
  });
});

describe('作者要求与章名进记录（版本 2）', () => {
  const startWith = async (h: ReturnType<typeof harness>, note: unknown) =>
    startWriteBatch(h.deps, {
      project_root: ROOT,
      from: 2,
      to: 3,
      permission_profile: 'ask',
      model_key: MODEL,
      note: note as string | null,
    });

  it('stores the note the author typed after the range and hands it out with every chapter', async () => {
    const h = harness({ history: true });
    const result = await startWith(h, '  这几章节奏快一点\n多写对话  ');
    if (!result.started) throw new Error('should start');
    expect(result.batch.note).toBe('这几章节奏快一点\n多写对话');
    expect((await h.saved())?.note).toBe('这几章节奏快一点\n多写对话');
    expect(await h.next(result.batch)).toMatchObject({
      action: 'write',
      ordinal: 2,
      title: '标题2',
      note: '这几章节奏快一点\n多写对话',
    });
    await h.writeChapter(result.batch, 2);
    expect(await h.next(result.batch)).toMatchObject({ ordinal: 3, title: '标题3' });
  });

  it('keeps a blank note as none and refuses a note that is not text', async () => {
    const h = harness({ history: true });
    const result = await startWith(h, '   ');
    expect(result.started && result.batch.note).toBeNull();
    const other = harness({ history: true });
    await expect(startWith(other, 42)).rejects.toThrow(WriteBatchError);
  });

  it('gives each chapter its plan title when read, without storing the titles', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    const view = await readWriteBatch(h.deps, ROOT);
    expect(view.batch?.chapters.map((chapter) => [chapter.ordinal, chapter.title])).toEqual([
      [2, '标题2'],
      [3, '标题3'],
    ]);
    const raw = JSON.parse(
      new TextDecoder().decode(
        (await h.project.reader.readProjectBytes(ROOT, WRITE_BATCH_RELATIVE_PATH, 1 << 20)).bytes,
      ),
    ) as { chapters: Record<string, unknown>[] };
    expect(raw.chapters.every((chapter) => !('title' in chapter))).toBe(true);
    expect(batch.chapters.every((chapter) => !('title' in chapter))).toBe(true);
  });

  it('reads a version 1 record (no note) and writes it back as version 3', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    const raw = JSON.parse(JSON.stringify(batch)) as Record<string, unknown>;
    raw.version = 1;
    delete raw.note;
    for (const chapter of raw.chapters as Record<string, unknown>[]) delete chapter.facts_added;
    h.project.apply({ [WRITE_BATCH_RELATIVE_PATH]: file(JSON.stringify(raw)) });
    expect((await readWriteBatch(h.deps, ROOT)).batch).toMatchObject({ version: 3, note: null });
    expect(await h.next(batch)).toMatchObject({ action: 'write', ordinal: 2, note: null });
    const written = JSON.parse(
      new TextDecoder().decode(
        (await h.project.reader.readProjectBytes(ROOT, WRITE_BATCH_RELATIVE_PATH, 1 << 20)).bytes,
      ),
    ) as Record<string, unknown>;
    expect(written).toMatchObject({ version: 3, note: null });
  });

  it('refuses a version 2 record without the note field', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    const raw = JSON.parse(JSON.stringify(batch)) as Record<string, unknown>;
    raw.version = 2;
    for (const chapter of raw.chapters as Record<string, unknown>[]) delete chapter.facts_added;
    delete raw.note;
    h.project.apply({ [WRITE_BATCH_RELATIVE_PATH]: file(JSON.stringify(raw)) });
    await expect(readWriteBatch(h.deps, ROOT)).rejects.toThrow(InputDomainError);
  });
});

describe('界面出错停下', () => {
  it('accepts scheduler_error from the interface and keeps its message as is', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2);
    const stopped = await stopWriteBatch(h.deps, ROOT, batch.id, {
      code: 'scheduler_error',
      message: '第 3 章出错停下：写进的文件不是第 3 章的目标文件',
    });
    expect(stopped.stop).toEqual({
      code: 'scheduler_error',
      message: '第 3 章出错停下：写进的文件不是第 3 章的目标文件',
      ordinal: 3,
    });
    expect((await h.saved())?.stop?.code).toBe('scheduler_error');
    expect(await h.next(batch)).toMatchObject({ action: 'stop', code: 'scheduler_error' });
  });
});

describe('续写前只读的预览', () => {
  /** 预览走的写口记下每一次写（连内容不变的重写也算：内存作品只记有变化的写）。 */
  const writesDuring = async <T>(
    h: ReturnType<typeof harness>,
    run: (deps: WriteBatchRunDeps) => Promise<T>,
  ) => {
    const paths: string[] = [];
    const deps: WriteBatchRunDeps = {
      ...h.deps,
      writer: {
        writeProjectFile: async (base, path, bytes) => {
          paths.push(path);
          return h.deps.writer.writeProjectFile(base, path, bytes);
        },
      },
    };
    return { result: await run(deps), paths };
  };
  const preview = async (h: ReturnType<typeof harness>) => {
    const { result, paths } = await writesDuring(h, (deps) =>
      previewWriteBatchResume(deps, ROOT, { permission_profile: 'ask', model_key: MODEL }),
    );
    expect(paths).toEqual([]);
    return result;
  };
  const resume = (h: ReturnType<typeof harness>) =>
    resumeWriteBatch(h.deps, { project_root: ROOT, permission_profile: 'ask', model_key: MODEL });

  it('shows the same plan the resume would use, without touching the record', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2);
    await h.writeChapter(batch, 3, { patch: null, check: null, written: false });
    await h.next(batch);
    const before = await h.saved();
    h.project.takeWrites();
    const plan = await preview(h);
    expect(h.project.takeWrites()).toEqual({});
    expect(await h.saved()).toEqual(before);
    expect(plan.can_start).toBe(true);
    expect(plan.chapters.map((chapter) => [chapter.ordinal, chapter.status])).toEqual([
      [2, 'skip_written'],
      [3, 'write'],
      [4, 'write'],
    ]);
    const resumed = await resume(h);
    expect(resumed.started).toBe(true);
    expect(resumed.plan).toEqual(plan);
  });

  it('says the batch is all written without marking it finished', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    await h.writeChapter(batch, 2);
    await h.writeChapter(batch, 3, { written: false });
    await h.next(batch);
    h.project.apply({ [pathOf(3)]: file('第3章\n\n作者接受的修订。\n') });
    h.project.takeWrites();
    const plan = await preview(h);
    expect(plan.blockers.map((blocker) => blocker.code)).toEqual(['batch_all_written']);
    expect(plan.can_start).toBe(false);
    expect(h.project.takeWrites()).toEqual({});
    expect((await h.saved())?.status).toBe('stopped');
  });

  it('refuses to preview a batch that is not stopped, or no batch', async () => {
    const h = harness({ history: true });
    await expect(preview(h)).rejects.toThrow(WriteBatchError);
    await started(h, 2, 3);
    await expect(preview(h)).rejects.toThrow('还在写');
  });
});

describe('撤销第 k 章及之后', () => {
  /** 写完第 2–5 章（每章记账前的台账版本是 facts-2…facts-5），这一批写完。 */
  async function writtenBatch(h: ReturnType<typeof harness>) {
    const batch = await started(h, 2, 5);
    for (const ordinal of [2, 3, 4, 5]) await h.writeChapter(batch, ordinal);
    expect(await h.next(batch)).toEqual({ action: 'finished' });
    return batch;
  }
  /** 重开应用后的样子：只有作品文件，没有引擎库、没有内存里的东西；任何一次写都算错。 */
  const reopened = (h: ReturnType<typeof harness>) => ({
    reader: h.project.reader,
    platform: 'posix' as const,
    writer: {
      writeProjectFile: async () => {
        throw new Error('只读的一步写了文件');
      },
    },
  });
  const sha = (h: ReturnType<typeof harness>, ordinal: number) =>
    h.saved().then((record) => record!.chapters.find((c) => c.ordinal === ordinal)!.written_sha256);
  const deleteFiles = (h: ReturnType<typeof harness>, ...ordinals: number[]) =>
    h.project.apply(Object.fromEntries(ordinals.map((ordinal) => [pathOf(ordinal), null])));
  const undo = (
    h: ReturnType<typeof harness>,
    batchId: string,
    from: number,
    input: Partial<Parameters<typeof recordWriteBatchUndo>[4]> = {},
  ) =>
    recordWriteBatchUndo(h.deps, ROOT, batchId, from, {
      deleted: [],
      failure: null,
      facts_restored: true,
      facts_error: null,
      ...input,
    });

  it('lists the chapters to delete newest first with their fingerprints, from the record alone', async () => {
    const h = harness({ history: true });
    const batch = await writtenBatch(h);
    const plan = await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3);
    expect(plan).toMatchObject({
      batch_id: batch.id,
      from: 3,
      to: 5,
      facts_before: 'facts-3',
      blockers: [],
      can_undo: true,
    });
    expect(plan.chapters).toEqual([
      {
        ordinal: 5,
        target_path: pathOf(5),
        written_sha256: await sha(h, 5),
        facts_restore: 'facts-5',
      },
      {
        ordinal: 4,
        target_path: pathOf(4),
        written_sha256: await sha(h, 4),
        facts_restore: 'facts-4',
      },
      {
        ordinal: 3,
        target_path: pathOf(3),
        written_sha256: await sha(h, 3),
        facts_restore: 'facts-3',
      },
    ]);
    expect(await checkWriteBatchUndoChapter(reopened(h), ROOT, batch.id, 4)).toBeNull();
  });

  it('restores the ledger to the first version recorded from chapter k on', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 5);
    await h.writeChapter(batch, 2);
    await h.writeChapter(batch, 3, { factsBefore: null });
    await h.writeChapter(batch, 4);
    await h.writeChapter(batch, 5, { factsBefore: null });
    await h.next(batch);
    const plan = await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3);
    expect(plan.chapters.map((c) => [c.ordinal, c.facts_restore])).toEqual([
      [5, null],
      [4, 'facts-4'],
      [3, 'facts-4'],
    ]);
    expect(plan.facts_before).toBe('facts-4');
  });

  it('blocks chapters the author changed or deleted after they were written', async () => {
    const h = harness({ history: true });
    const batch = await writtenBatch(h);
    h.project.apply({ [pathOf(4)]: file('第4章\n\n作者改过的。\n') });
    deleteFiles(h, 5);
    const plan = await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3);
    expect(plan.can_undo).toBe(false);
    expect(plan.blockers.map((b) => [b.code, b.chapters])).toEqual([
      ['changed', [4]],
      ['missing', [5]],
    ]);
    expect(plan.blockers[0].message).toContain('撤销会吃掉你的改动');
    expect(await checkWriteBatchUndoChapter(reopened(h), ROOT, batch.id, 4)).toMatchObject({
      code: 'changed',
      chapters: [4],
    });
    expect(await checkWriteBatchUndoChapter(reopened(h), ROOT, batch.id, 5)).toMatchObject({
      code: 'missing',
    });
    expect(await checkWriteBatchUndoChapter(reopened(h), ROOT, batch.id, 3)).toBeNull();
  });

  it('blocks when manuscripts not written by this batch come after chapter k', async () => {
    const h = harness({ history: true });
    const batch = await writtenBatch(h);
    h.project.apply({ [pathOf(7)]: file('第7章\n\n作者自己写的。\n') });
    const plan = await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3);
    expect(plan.blockers.map((b) => [b.code, b.chapters])).toEqual([['outside_chapters', [6]]]);
    expect(plan.blockers[0].message).toContain(pathOf(7));
    expect(plan.can_undo).toBe(false);
    // 撤最后一章也一样：它后面还有批外正文。
    expect((await planWriteBatchUndo(reopened(h), ROOT, batch.id, 5)).can_undo).toBe(false);

    // 批量中途作者自己写了第 3 章（记录里跳过）：从第 2 章撤会让它往前错位。
    const inside = harness({ history: true });
    const second = await started(inside, 2, 4);
    await inside.writeChapter(second, 2);
    inside.project.apply({ [pathOf(3)]: file('第3章\n\n作者自己写的。\n') });
    expect(await inside.next(second)).toMatchObject({ action: 'write', ordinal: 4 });
    await inside.writeChapter(second, 4);
    expect(await inside.next(second)).toEqual({ action: 'finished' });
    const blocked = await planWriteBatchUndo(reopened(inside), ROOT, second.id, 2);
    expect(blocked.blockers.map((b) => [b.code, b.chapters])).toEqual([['outside_chapters', [3]]]);
    // 从第 4 章撤：后面没有批外正文，可以撤。
    expect((await planWriteBatchUndo(reopened(inside), ROOT, second.id, 4)).can_undo).toBe(true);
  });

  it('refuses while the batch is still running, and from a chapter it did not write', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 4);
    await h.writeChapter(batch, 2);
    const running = await planWriteBatchUndo(reopened(h), ROOT, batch.id, 2);
    expect(running.blockers.map((b) => b.code)).toEqual(['batch_running']);
    expect(await checkWriteBatchUndoChapter(reopened(h), ROOT, batch.id, 2)).toMatchObject({
      code: 'batch_running',
    });
    await stopWriteBatch(h.deps, ROOT, batch.id, { code: 'author_stopped', message: '停了。' });
    const pending = await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3);
    expect(pending).toMatchObject({ can_undo: false, chapters: [], to: null });
    expect(pending.blockers.map((b) => b.code)).toEqual(['not_batch_written']);
    await expect(planWriteBatchUndo(reopened(h), ROOT, batch.id, 9)).rejects.toThrow('不在这一批');
    await expect(planWriteBatchUndo(reopened(h), ROOT, 'write-batch-old', 2)).rejects.toThrow(
      '不是最近一批',
    );
  });

  it('records the undo from the files actually gone, and the batch resumes from chapter k', async () => {
    const h = harness({ history: true });
    const batch = await writtenBatch(h);
    deleteFiles(h, 5, 4, 3);
    const record = await undo(h, batch.id, 3, { deleted: [5, 4, 3] });
    expect(record.version).toBe(3);
    expect(record.chapters.map((c) => [c.ordinal, c.state])).toEqual([
      [2, 'written'],
      [3, 'undone'],
      [4, 'undone'],
      [5, 'undone'],
    ]);
    expect(record).toMatchObject({ status: 'stopped', stop: { code: 'undone', ordinal: 3 } });
    expect(record.stop!.message).toContain('撤销了第 3–5 章');
    expect(record.stop!.message).toContain('事实台账回到第 3 章记账前');
    expect(record.stop!.message).toContain('从第 3 章接着写');
    expect(await h.saved()).toEqual(record);
    // 重开应用后读回来：撤销过的章不算写了，续写从第 3 章起。
    const view = await readWriteBatch(reopened(h), ROOT);
    expect(view).toMatchObject({ can_resume: true, resume_from: 3, mismatches: [] });
    expect(await h.next(batch)).toMatchObject({ action: 'stop', code: 'undone' });
    const resumed = await resumeWriteBatch(h.deps, {
      project_root: ROOT,
      permission_profile: 'ask',
      model_key: MODEL,
    });
    expect(resumed.started).toBe(true);
    expect(resumed.batch!.chapters.map((c) => [c.ordinal, c.state])).toEqual([
      [2, 'written'],
      [3, 'pending'],
      [4, 'pending'],
      [5, 'pending'],
    ]);
    expect(await h.next(batch)).toMatchObject({ action: 'write', ordinal: 3 });
  });

  it('records a partial undo honestly: only the chapters gone, and where it stopped', async () => {
    const h = harness({ history: true });
    const batch = await writtenBatch(h);
    deleteFiles(h, 5, 4);
    const record = await undo(h, batch.id, 3, {
      deleted: [5, 4],
      failure: '第 3 章在编辑器里有未保存的修改',
      facts_restored: false,
      facts_error: 'facts.json 刚被别处改过',
    });
    expect(record.chapters.map((c) => [c.ordinal, c.state])).toEqual([
      [2, 'written'],
      [3, 'written'],
      [4, 'undone'],
      [5, 'undone'],
    ]);
    expect(record.stop).toMatchObject({ code: 'undone', ordinal: 4 });
    expect(record.stop!.message).toContain('撤销了第 4–5 章');
    expect(record.stop!.message).toContain('没撤完就停下了：第 3 章在编辑器里有未保存的修改');
    expect(record.stop!.message).toContain('事实台账没能恢复（facts.json 刚被别处改过）');
  });

  it('refuses an undo record that does not match the files', async () => {
    const h = harness({ history: true });
    const batch = await writtenBatch(h);
    await expect(undo(h, batch.id, 3, { deleted: [5] })).rejects.toThrow('文件还在');
    deleteFiles(h, 4);
    await expect(undo(h, batch.id, 3, { deleted: [4] })).rejects.toThrow('不能跳过');
    await expect(undo(h, batch.id, 3, { deleted: [] })).rejects.toThrow('没有删掉任何一章');
    deleteFiles(h, 2);
    await expect(undo(h, batch.id, 3, { deleted: [2] })).rejects.toThrow('第 3 章及之后');
    expect((await h.saved())?.status).toBe('finished');

    const running = harness({ history: true });
    const live = await started(running, 2, 3);
    await running.writeChapter(live, 2);
    deleteFiles(running, 2);
    await expect(undo(running, live.id, 2, { deleted: [2] })).rejects.toThrow('还在写');
  });

  it('marks a re-created undone chapter as written outside the record', async () => {
    const h = harness({ history: true });
    const batch = await writtenBatch(h);
    deleteFiles(h, 5);
    await undo(h, batch.id, 5, { deleted: [5] });
    h.project.apply({ [pathOf(5)]: file('第5章\n\n作者重写的。\n') });
    const view = await readWriteBatch(reopened(h), ROOT);
    expect(view.mismatches).toEqual([
      { ordinal: 5, kind: 'written_outside', message: expect.stringContaining('已经撤销了') },
    ]);
  });

  it('keeps the facts count it was given, and reads older records as unknown', async () => {
    const h = harness({ history: true });
    const batch = await started(h, 2, 3);
    await h.writeChapter(batch, 2, { factsAdded: 3, disputes: 1 });
    await h.writeChapter(batch, 3, { factsAdded: null });
    const view = await readWriteBatch(reopened(h), ROOT);
    expect(view.batch!.chapters.map((c) => [c.ordinal, c.facts_added, c.fact_disputes])).toEqual([
      [2, 3, 1],
      [3, null, 0],
    ]);
    expect(view.batch!.chapters.map((c) => c.goal)).toEqual(['第2章目标', '第3章目标']);
  });

  it('refuses undone in an older record, and a version 3 record without facts_added', async () => {
    const h = harness({ history: true });
    const batch = await writtenBatch(h);
    deleteFiles(h, 5);
    const record = await undo(h, batch.id, 5, { deleted: [5] });
    const older = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    older.version = 2;
    for (const chapter of older.chapters as Record<string, unknown>[]) delete chapter.facts_added;
    h.project.apply({ [WRITE_BATCH_RELATIVE_PATH]: file(JSON.stringify(older)) });
    await expect(readWriteBatch(h.deps, ROOT)).rejects.toThrow(InputDomainError);
    const missing = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    delete (missing.chapters as Record<string, unknown>[])[0].facts_added;
    h.project.apply({ [WRITE_BATCH_RELATIVE_PATH]: file(JSON.stringify(missing)) });
    await expect(readWriteBatch(h.deps, ROOT)).rejects.toThrow(InputDomainError);
  });
});

describe('撤销前看台账在这一批之后动没动过', () => {
  const LEDGER = '.storyforge/canon/facts.json';
  const ledger = (ids: string[]) => file(JSON.stringify({ version: 1, facts: ids }));
  const reopened = (h: ReturnType<typeof harness>) => ({
    reader: h.project.reader,
    platform: 'posix' as const,
  });
  /** 写完第 2–4 章，每章记一笔前台账多一条事实（记账落定后才记一笔）。 */
  async function batchWithFacts(h: ReturnType<typeof harness>) {
    const batch = await started(h, 2, 4);
    const ids: string[] = [];
    for (const ordinal of [2, 3, 4]) {
      ids.push(`fact_${ordinal}`);
      h.project.apply({ [LEDGER]: ledger([...ids]) });
      await h.writeChapter(batch, ordinal);
    }
    expect(await h.next(batch)).toEqual({ action: 'finished' });
    return batch;
  }

  it('unchanged when the ledger is still what the batch last recorded', async () => {
    const h = harness({ history: true });
    const batch = await batchWithFacts(h);
    expect((await h.saved())?.facts_ledger_sha256).toMatch(/^[0-9a-f]{64}$/);
    const plan = await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3);
    expect(plan).toMatchObject({ facts_before: 'facts-3', facts_ledger: 'unchanged' });
  });

  it('changed when the author edited or removed the ledger afterwards', async () => {
    const h = harness({ history: true });
    const batch = await batchWithFacts(h);
    h.project.apply({ [LEDGER]: ledger(['fact_2', 'fact_3', 'fact_4', '作者在观测镜里定的']) });
    expect((await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3)).facts_ledger).toBe('changed');
    h.project.apply({ [LEDGER]: null });
    expect((await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3)).facts_ledger).toBe('changed');
  });

  it('unknown without a recorded fingerprint, and null when there is no ledger to restore', async () => {
    const h = harness({ history: true });
    const batch = await batchWithFacts(h);
    const raw = JSON.parse(JSON.stringify(await h.saved())) as Record<string, unknown>;
    raw.facts_ledger_sha256 = null;
    h.project.apply({ [WRITE_BATCH_RELATIVE_PATH]: file(JSON.stringify(raw)) });
    expect((await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3)).facts_ledger).toBe('unknown');

    const none = harness({ history: true });
    const second = await started(none, 2, 3);
    await none.writeChapter(second, 2, { factsBefore: null });
    await none.writeChapter(second, 3, { factsBefore: null });
    await none.next(second);
    expect(await planWriteBatchUndo(reopened(none), ROOT, second.id, 2)).toMatchObject({
      facts_before: null,
      facts_ledger: null,
    });
  });

  it('takes the restored ledger as the new baseline after an undo', async () => {
    const h = harness({ history: true });
    const batch = await batchWithFacts(h);
    h.project.apply({ [pathOf(4)]: null, [LEDGER]: ledger(['fact_2', 'fact_3']) });
    await recordWriteBatchUndo(h.deps, ROOT, batch.id, 4, {
      deleted: [4],
      failure: null,
      facts_restored: true,
      facts_error: null,
    });
    expect((await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3)).facts_ledger).toBe(
      'unchanged',
    );
    // 台账没恢复成就不换基准：作者的改动照样看得出来。
    const other = harness({ history: true });
    const kept = await batchWithFacts(other);
    other.project.apply({ [pathOf(4)]: null, [LEDGER]: ledger(['作者改过']) });
    await recordWriteBatchUndo(other.deps, ROOT, kept.id, 4, {
      deleted: [4],
      failure: null,
      facts_restored: false,
      facts_error: 'facts.json 刚被别处改过',
    });
    expect((await planWriteBatchUndo(reopened(other), ROOT, kept.id, 3)).facts_ledger).toBe(
      'changed',
    );
  });

  it('reads an older record as having no fingerprint', async () => {
    const h = harness({ history: true });
    const batch = await batchWithFacts(h);
    const raw = JSON.parse(JSON.stringify(await h.saved())) as Record<string, unknown>;
    raw.version = 2;
    delete raw.facts_ledger_sha256;
    for (const chapter of raw.chapters as Record<string, unknown>[]) delete chapter.facts_added;
    h.project.apply({ [WRITE_BATCH_RELATIVE_PATH]: file(JSON.stringify(raw)) });
    expect((await readWriteBatch(reopened(h), ROOT)).batch?.facts_ledger_sha256).toBeNull();
    expect((await planWriteBatchUndo(reopened(h), ROOT, batch.id, 3)).facts_ledger).toBe('unknown');
    const missing = JSON.parse(JSON.stringify(await h.saved())) as Record<string, unknown>;
    delete missing.facts_ledger_sha256;
    missing.version = 3;
    for (const chapter of missing.chapters as Record<string, unknown>[]) chapter.facts_added = null;
    h.project.apply({ [WRITE_BATCH_RELATIVE_PATH]: file(JSON.stringify(missing)) });
    await expect(readWriteBatch(h.deps, ROOT)).rejects.toThrow(InputDomainError);
  });
});
