import { describe, expect, it } from 'vitest';
import { AssistantSessionNotFoundError } from '../assistant/service';
import { memoryProject } from '../kernel/memoryProject.test-support';
import { TokenUsage } from '../llm/contracts';
import { tokenUsage } from '../llm/usage';
import { MemoryRunStore } from '../store/runs';
import { REQUEST_EVIDENCE_KIND } from './requestEvidence';
import { AgentRunNotFoundError } from './runEvents';
import {
  CHAR_ESTIMATE_SCALE,
  planWriteBatch,
  runUsage,
  writeChapterHistory,
  type WriteBatchPlan,
} from './writeBatch';

const ROOT = '/book';
const OTHER = '/other-book';
const file = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const SETUP = {
  '大纲/总纲.md': file('主线：林舟入城寻亲。\n'),
  '人物/主角.md': file('林舟：少年。\n'),
  '设定/世界规则.md': file('城门三更关闭。\n'),
};
const chapterFiles = (...ordinals: number[]) =>
  Object.fromEntries(
    ordinals.map((n) => [
      `正文/第${String(n).padStart(3, '0')}章.md`,
      file(`第${n}章\n\n正文。\n`),
    ]),
  );
const planFile = (chapters: object[], extra: object = {}) => ({
  '.storyforge/serial-plan.json': file(JSON.stringify({ version: 1, chapters, ...extra })),
});
const goal = (ordinal: number, fields: object = {}) => ({
  ordinal,
  title: `标题${ordinal}`,
  goal: `第${ordinal}章目标`,
  status: 'pending',
  ...fields,
});

/** 与请求证据结算时写进去的一样：tokenUsage → TokenUsage → toLegacy。 */
const settled = (usage: ReturnType<typeof tokenUsage>) => TokenUsage.fromLegacy(usage).toLegacy();
const reported = (total: number) =>
  settled(
    tokenUsage(
      { usage: { prompt_tokens: total - 10, completion_tokens: 10, total_tokens: total } },
      '',
      '',
    ),
  );

/** 按字数估：「每 4 个字 1 个 token」。 */
const chars = (count: number) => '字'.repeat(count);

type RunSpec = {
  publicId: string;
  session: number | null;
  usages?: (object | null)[];
  check?: boolean;
};

function harness(sessionProjects: Record<number, string | null> = { 1: ROOT, 2: OTHER }) {
  const store = new MemoryRunStore();
  const sessions = {
    async getSession(id: number) {
      if (!(id in sessionProjects)) throw new AssistantSessionNotFoundError(`会话 ${id} 不存在`);
      return { id, project_path: sessionProjects[id] };
    },
  };
  const runIds = new Map<string, number>();
  async function addRun(spec: RunSpec) {
    const run = await store.insertRun({
      public_id: spec.publicId,
      session_id: 's',
      assistant_session_id: spec.session,
      goal: '写下一章',
      scope: {},
      permission_profile: 'ask',
      budget: {},
      status: 'completed',
      root_plan: [],
      current_step: 'completed',
    });
    runIds.set(spec.publicId, run.id);
    for (const usage of spec.usages ?? [])
      await store.insertArtifact({
        run_id: run.id,
        kind: REQUEST_EVIDENCE_KIND,
        payload: usage === null ? { status: 'prepared' } : { status: 'response_completed', usage },
        requires_confirmation: false,
      });
    if (spec.check ?? true) await addCheck(spec.publicId);
  }
  async function addCheck(publicId: string) {
    await store.insertArtifact({
      run_id: runIds.get(publicId)!,
      kind: 'chapter_check',
      payload: { status: 'pass' },
      requires_confirmation: false,
    });
  }
  return { store, sessions, addRun, addCheck };
}

async function plan(
  files: Record<string, ReturnType<typeof file>>,
  range: { from: number; to: number },
  options: { profile?: string; history?: (h: ReturnType<typeof harness>) => Promise<void> } = {},
): Promise<WriteBatchPlan> {
  const project = memoryProject(ROOT, files);
  const h = harness();
  await options.history?.(h);
  return planWriteBatch(
    { reader: project.reader, store: h.store, sessions: h.sessions, platform: 'posix' },
    { project_root: ROOT, ...range, permission_profile: options.profile ?? 'ask' },
  );
}

const codes = (result: WriteBatchPlan) => result.blockers.map((item) => item.code);
const statuses = (result: WriteBatchPlan) =>
  result.chapters.map((chapter) => [chapter.ordinal, chapter.status]);

describe('单次运行的用量', () => {
  it('adds up every model request, scaling char-count estimates to 1.5 tokens per char', async () => {
    const h = harness();
    await h.addRun({
      publicId: 'run-1',
      session: 1,
      usages: [
        reported(1000),
        // 服务商什么都没报：usage.ts 按 4 字 1 token 估出 100 + 200。
        settled(tokenUsage(null, chars(400), chars(800))),
        // 服务商报了总数和缓存命中，只是没拆分：总数是真的。
        settled(tokenUsage({ usage: { total_tokens: 900, prompt_cache_hit_tokens: 0 } }, '', '')),
        // 报的总数比按字数估的输入还少：拆出来的输出是 0，也是真总数。
        settled(tokenUsage({ usage: { total_tokens: 50 } }, chars(400), '')),
        settled(new TokenUsage().toLegacy()),
        null,
      ],
    });
    expect(CHAR_ESTIMATE_SCALE).toBe(6);
    expect(await runUsage(h.store, 'run-1')).toEqual({
      run_id: 'run-1',
      tokens: 1000 + 300 * 6 + 900 + 50,
      calls: 6,
      estimated_calls: 1,
      unknown_calls: 2,
    });
  });

  it('reports a missing run instead of returning zero usage', async () => {
    await expect(runUsage(new MemoryRunStore(), 'run-x')).rejects.toBeInstanceOf(
      AgentRunNotFoundError,
    );
  });
});

describe('本作品的写章用量记录', () => {
  it('takes the 10 most recent checked chapter runs of this book only', async () => {
    const h = harness({ 1: ROOT, 2: OTHER, 3: `${ROOT}/` });
    for (let n = 1; n <= 12; n++)
      await h.addRun({
        publicId: `r${n}`,
        session: n % 2 ? 1 : 3,
        usages: [reported(n * 100)],
        check: false,
      });
    // 「最近」看检查结论落下的先后：r1 最后才查完。
    for (let n = 2; n <= 12; n++) await h.addCheck(`r${n}`);
    await h.addCheck('r1');
    await h.addRun({ publicId: 'other-book', session: 2, usages: [reported(99_999)] });
    await h.addRun({ publicId: 'deleted-session', session: 7, usages: [reported(99_999)] });
    await h.addRun({ publicId: 'no-session', session: null, usages: [reported(99_999)] });
    await h.addRun({ publicId: 'chat', session: 1, usages: [reported(99_999)], check: false });
    await h.addRun({ publicId: 'no-evidence', session: 1, usages: [] });

    const history = await writeChapterHistory(
      { store: h.store, sessions: h.sessions, platform: 'posix' },
      ROOT,
    );
    expect(history.run_ids).toEqual([
      'r1',
      'r12',
      'r11',
      'r10',
      'r9',
      'r8',
      'r7',
      'r6',
      'r5',
      'r4',
    ]);
    expect(history.sample_count).toBe(10);
    const tokens = [1, 12, 11, 10, 9, 8, 7, 6, 5, 4].map((n) => n * 100);
    expect(history.average_tokens).toBe(Math.round(tokens.reduce((a, b) => a + b) / 10));
    expect(history.min_tokens).toBe(100);
    expect(history.max_tokens).toBe(1200);
    expect(history.calls).toBe(10);
  });

  it('counts the char-estimated requests among the samples', async () => {
    const h = harness();
    await h.addRun({
      publicId: 'r1',
      session: 1,
      usages: [reported(1000), settled(tokenUsage(null, chars(40), chars(40)))],
    });
    const history = await writeChapterHistory(
      { store: h.store, sessions: h.sessions, platform: 'posix' },
      ROOT,
    );
    expect(history).toMatchObject({
      sample_count: 1,
      average_tokens: 1000 + 20 * 6,
      calls: 2,
      estimated_calls: 1,
      unknown_calls: 0,
    });
  });
});

describe('批量写章计划', () => {
  const book = {
    ...SETUP,
    ...chapterFiles(1, 2, 3),
    ...planFile([
      goal(1, { status: 'done' }),
      goal(2, { status: 'done' }),
      // 计划还说没写，正文已经在了：跳过。
      goal(3, { status: 'pending' }),
      // 计划说写了，正文里没有：要写。
      goal(4, { status: 'done' }),
      goal(5),
      goal(6, { path: '正文/卷二/第六章.md' }),
    ]),
  };

  it('tells which chapters have an outline, only for chapters it will write', async () => {
    const result = await plan(
      {
        ...book,
        '大纲/第3章细纲.md': file('第三章已经写了，细纲留着。\n'),
        '大纲/第4章细纲.md': file('开场先写城门守卫议论他。\n'),
        '大纲/第5章细纲.md': file('   \n'),
      },
      { from: 3, to: 6 },
    );
    expect(result.chapters.map((chapter) => [chapter.ordinal, chapter.outline_path])).toEqual([
      [3, null],
      [4, '大纲/第4章细纲.md'],
      [5, null],
      [6, null],
    ]);
  });

  it('lists the setting files the AI will not see in full, without blocking the batch', async () => {
    const long = { ...book, '人物/主角.md': file('字'.repeat(6100)) };
    const result = await plan(long, { from: 4, to: 5 });
    expect(result.source_warnings).toEqual([
      '「人物/主角.md」共 6100 字，每章只放得下 6000 字：只带开头 6000 字，后面的内容 AI 写章时看不到。',
    ]);
    expect(codes(result)).toEqual(codes(await plan(book, { from: 4, to: 5 })));
    expect((await plan(book, { from: 4, to: 5 })).source_warnings).toEqual([]);
    // 没有要写的章就不提。
    expect((await plan(long, { from: 1, to: 3 })).source_warnings).toEqual([]);
  });

  it('skips chapters whose manuscript exists, whatever the plan status says', async () => {
    const result = await plan(book, { from: 3, to: 6 });
    expect(statuses(result)).toEqual([
      [3, 'skip_written'],
      [4, 'write'],
      [5, 'after_trial'],
      [6, 'after_trial'],
    ]);
    expect(result.chapters[0]).toMatchObject({ written_path: '正文/第003章.md' });
    expect(result.chapters.map((chapter) => chapter.target_path)).toEqual([
      '正文/第003章.md',
      '正文/第004章.md',
      '正文/第005章.md',
      '正文/卷二/第六章.md',
    ]);
    expect(result.chapters[1]).toMatchObject({
      title: '标题4',
      goal: '第4章目标',
      written_path: null,
    });
    expect(result.blockers).toEqual([]);
    expect(result.can_start).toBe(true);
  });

  it('refuses to start past an unwritten chapter', async () => {
    const result = await plan(book, { from: 5, to: 6 });
    expect(result.blockers[0]).toMatchObject({ code: 'gap_before_start', chapters: [4] });
    expect(result.blockers[0].message).toContain('第 4 章还没有正文');
    expect(result.can_start).toBe(false);
  });

  it('lists the chapters to write that have no goal in the plan', async () => {
    const result = await plan(
      { ...SETUP, ...chapterFiles(1, 2, 3), ...planFile([goal(4), goal(5, { goal: '  ' })]) },
      { from: 4, to: 7 },
    );
    expect(codes(result)).toEqual(['missing_goal']);
    expect(result.blockers[0].chapters).toEqual([5, 6, 7]);
    expect(result.blockers[0].message).toContain('第 5–7 章在连载计划里没写本章目标');
    expect(result.blockers[0].message).toContain('可以让 AI 起草目标，你确认');
  });

  it('asks for goals when the book has no plan at all', async () => {
    const result = await plan({ ...SETUP, ...chapterFiles(1) }, { from: 2, to: 3 });
    expect(result.blockers[0]).toMatchObject({ code: 'missing_goal', chapters: [2, 3] });
    expect(result.blockers[0].message).toContain('还没有连载计划');
  });

  it('refuses the whole batch on the read-only profile', async () => {
    const result = await plan(book, { from: 4, to: 5 }, { profile: 'read' });
    expect(codes(result)).toEqual(['read_only']);
    expect(result.permission_profile).toBe('read');
    expect(result.can_start).toBe(false);
  });

  it('refuses the first chapter while setup files are missing', async () => {
    const result = await plan(
      { ...planFile([goal(1), goal(2)]), '人物/主角.md': file('林舟。\n') },
      { from: 1, to: 2 },
    );
    expect(codes(result)).toEqual(['setup_incomplete']);
    expect(result.blockers[0].message).toContain('还缺总纲、世界规则文件');
  });

  it('starts the first chapter once setup is complete', async () => {
    const result = await plan({ ...SETUP, ...planFile([goal(1), goal(2)]) }, { from: 1, to: 2 });
    expect(result.blockers).toEqual([]);
  });

  it.each([
    [0, 3],
    [5, 3],
    [1.5, 3],
    [1, Number.NaN],
  ])('rejects the range %s–%s', async (from, to) => {
    const result = await plan(book, { from, to });
    expect(codes(result)).toEqual(['invalid_range']);
    expect(result.chapters).toEqual([]);
    expect(result.can_start).toBe(false);
  });

  it('says so when every chapter in range is already written', async () => {
    const result = await plan(book, { from: 1, to: 3 });
    expect(codes(result)).toEqual(['nothing_to_write']);
    expect(result.basis).toBeNull();
  });

  it('refuses chapters the author marked stuck', async () => {
    const result = await plan(
      { ...SETUP, ...chapterFiles(1), ...planFile([goal(2, { status: 'blocked' }), goal(3)]) },
      { from: 2, to: 3 },
    );
    expect(result.blockers[0]).toMatchObject({ code: 'chapter_blocked', chapters: [2] });
  });

  it('refuses a target file that already exists at another position', async () => {
    // 第 3 章（路径序第三个）是 第004章.md；第 4 章的默认目标 第004章.md 已被占了。
    const result = await plan(
      { ...SETUP, ...chapterFiles(1, 2, 4), ...planFile([goal(4)]) },
      { from: 4, to: 4 },
    );
    expect(result.blockers[0]).toMatchObject({ code: 'target_unavailable', chapters: [4] });
  });

  it('estimates from the book history: average × chapters, cap = ceil(estimate × 1.5)', async () => {
    const result = await plan(
      book,
      { from: 4, to: 6 },
      {
        history: async (h) => {
          await h.addRun({ publicId: 'a', session: 1, usages: [reported(1000)] });
          await h.addRun({ publicId: 'b', session: 1, usages: [reported(2000)] });
          await h.addRun({ publicId: 'c', session: 1, usages: [reported(4000)] });
          await h.addRun({ publicId: 'elsewhere', session: 2, usages: [reported(50_000)] });
        },
      },
    );
    expect(result.basis).toBe('history');
    expect(result.estimate).toEqual({
      chapter_count: 3,
      sample_count: 3,
      average_tokens: 2333,
      min_tokens: 1000,
      max_tokens: 4000,
      estimated_calls: 0,
      unknown_calls: 0,
      estimated_tokens: 6999,
      cap_tokens: 10499,
    });
    expect(statuses(result)).toEqual([
      [4, 'write'],
      [5, 'write'],
      [6, 'write'],
    ]);
    expect(result.note).toBeNull();
  });

  it('writes only the first chapter as a trial when the book has no history', async () => {
    const result = await plan(
      book,
      { from: 4, to: 6 },
      {
        history: async (h) => {
          await h.addRun({ publicId: 'elsewhere', session: 2, usages: [reported(50_000)] });
        },
      },
    );
    expect(result.basis).toBe('trial');
    expect(result.estimate).toBeNull();
    expect(statuses(result)).toEqual([
      [4, 'write'],
      [5, 'after_trial'],
      [6, 'after_trial'],
    ]);
    expect(result.note).toContain('先只写第 4 章量一量');
    expect(result.note).toContain('剩下 2 章');
  });

  it('has no chapter-count limit', async () => {
    const goals = Array.from({ length: 40 }, (_, index) => goal(index + 2));
    const result = await plan(
      { ...SETUP, ...chapterFiles(1), ...planFile(goals) },
      { from: 2, to: 41 },
    );
    expect(result.chapters).toHaveLength(40);
    expect(result.can_start).toBe(true);
  });
});
