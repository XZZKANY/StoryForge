import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Db, ProjectReader, ProjectWriter } from '@storyforge/engine';
import { memoryProject } from '../../../../packages/engine/src/kernel/memoryProject.test-support';
import { nodeSqliteDb } from '../../../../packages/engine/src/store/nodeSqlite.test-support';

const ROOT = 'D:\\book';

const fixture = vi.hoisted(() => ({
  reader: null as unknown as ProjectReader,
  writer: null as unknown as ProjectWriter,
  writes: null as unknown as () => Record<string, Uint8Array>,
  db: null as unknown as Db,
  source: {} as Record<string, string>,
  sent: [] as { url: string; body: { model?: string; messages?: unknown[] } }[],
  reply: null as null | (() => Promise<string>),
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.16' }));
vi.mock('../src/lib/engine/llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/engine/llm')>()),
  nativeLlmSource: async (slot: string) => ({
    source: slot === 'main' ? fixture.source : {},
    secrets: { values: [] },
  }),
  nativeHttpPort: () => ({
    async send(request: { url: string; body: Uint8Array | null }) {
      fixture.sent.push({
        url: request.url,
        body: JSON.parse(new TextDecoder().decode(request.body!)),
      });
      const text = await fixture.reply!();
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: (async function* () {
          yield new TextEncoder().encode(text);
        })(),
        close() {},
      };
    },
  }),
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
vi.mock('../src/lib/engine/writer', () => ({
  nativeProjectWriter: {
    writeProjectFile: (...args: Parameters<ProjectWriter['writeProjectFile']>) =>
      fixture.writer.writeProjectFile(...args),
  },
}));
vi.mock('../src/lib/engine/db', () => ({
  nativeEngineDb: {
    select: (sql: string, params?: never[]) => fixture.db.select(sql, params),
    transaction: (steps: never[]) => fixture.db.transaction(steps),
  },
}));

const encoded = (text: string) => ({
  chunks: [{ base64: btoa(String.fromCharCode(...new TextEncoder().encode(text))), repeat: 1 }],
});
const BOOK = {
  '正文/第001章.md': encoded('第一章 风起\n\n雨夜里他推开门。\n'),
  '正文/第002章.md': encoded('第二章 夜行\n\n钟声响了三下。\n'),
  '参考/长篇.txt': encoded(
    Array.from({ length: 5 }, (_, i) => `第${i + 1}章 标题${i + 1}\n第${i + 1}章正文。`).join('\n'),
  ),
};
const CONFIGURED = {
  STORYFORGE_LLM_PROVIDER: 'openai',
  STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
  STORYFORGE_LLM_API_KEY: '[已隐藏的密钥]',
  STORYFORGE_LLM_MODEL: 'deepseek-v4',
};
const completion = (content: string) =>
  JSON.stringify({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 },
  });
const ANALYSIS = completion(
  JSON.stringify({ story_structure: '结构', craft_methods: { summary: '手法' } }),
);

const run = async (commandId: string, args: Record<string, unknown>) =>
  (await import('../src/lib/api/ide-commands')).executeIdeCommand(commandId, args);
const payload = (result: Record<string, unknown>) => result.payload as Record<string, never>;

// 冷加载整个引擎包在满载机器上会超过单条用例的 5 秒预算，先在这里加载。
beforeAll(async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/141.0.0.0',
  );
  await import('../src/lib/engine/ideCommands');
  // 引擎库在一个 WebView 里只打开一次（engineRuns 是 once）：整个文件共用一个库。
  fixture.db = nodeSqliteDb();
}, 60_000);

beforeEach(() => {
  const project = memoryProject(ROOT, BOOK);
  fixture.reader = project.reader;
  fixture.writer = project.writer;
  fixture.writes = () => project.takeWrites();
  fixture.source = {};
  fixture.sent = [];
  fixture.reply = null;
  vi.stubEnv('DEV', true);
  localStorage.setItem('engine.ideCommands', 'ts');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('the ts route must not reach the Python API');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

it('book.context answers in process with the HTTP response body', async () => {
  const result = await run('book.context', {
    project_root: ROOT,
    current_file: `${ROOT}\\正文\\第002章.md`,
  });
  expect(result).toMatchObject({ command_id: 'book.context', status: 'accepted' });
  expect(payload(result).book_context).toMatchObject({
    total_chapters: 2,
    current_ordinal: 2,
    current_relative_path: '正文/第002章.md',
  });
});

it('canon.refresh writes the derived cache through the native .storyforge writer', async () => {
  const result = await run('canon.refresh', { project_root: ROOT });
  expect(payload(result).canon).toBeDefined();
  // 还没有 canon.json 时先建一份空声明，再出派生缓存。
  expect(Object.keys(fixture.writes()).sort()).toEqual([
    '.storyforge/canon/canon.json',
    '.storyforge/canon/derived/dossier.md',
    '.storyforge/canon/derived/presence.json',
    '.storyforge/canon/derived/report.json',
  ]);
});

it("errors carry Python's detail text as a plain Error", async () => {
  const missing = await run('canon.refresh', {}).catch((error: Error) => error);
  expect(missing).toBeInstanceOf(Error);
  expect((missing as Error).message).toBe('canon.refresh 需要 project_root。');
  expect((missing as { status?: unknown }).status).toBeUndefined();
  await expect(run('nope', {})).rejects.toThrow('未知 IDE 命令：nope');
});

it('book.breakdown without a configured model stays deterministic and is recorded as a run', async () => {
  const result = await run('book.breakdown', { project_root: ROOT, target_count: 3 });
  const breakdown = payload(result).breakdown as Record<string, unknown>;
  expect(breakdown.status).toBe('completed_deterministic');
  expect(breakdown).not.toHaveProperty('model_error');
  expect(breakdown.analysis_id).toMatch(/^[0-9a-f]{32}$/);
  expect(breakdown.run_id).toBe(`breakdown-${breakdown.analysis_id}`);
  expect(fixture.sent).toEqual([]);

  const { engineRuns } = await import('../src/lib/engine/store');
  const { store } = await engineRuns();
  const recorded = (await store.findRun(String(breakdown.run_id)))!;
  expect(recorded).toMatchObject({
    session_id: `breakdown:${breakdown.analysis_id}`,
    goal: '生成结构化拆书报告',
    status: 'completed',
  });
  const [artifact] = await store.artifacts(recorded.id);
  expect(artifact).toMatchObject({ id: breakdown.artifact_id, kind: 'book_breakdown_report' });
  expect(artifact.payload).toMatchObject({ provider: null, model: null, retries: 0 });
});

it('book.breakdown with a configured model sends one request through the native port', async () => {
  fixture.source = CONFIGURED;
  fixture.reply = async () => ANALYSIS;
  const result = await run('book.breakdown', { project_root: ROOT, analysis_id: 'run-1' });
  const breakdown = payload(result).breakdown as Record<string, unknown>;
  expect(breakdown).toMatchObject({
    status: 'completed',
    provider: 'openai',
    model: 'deepseek-v4',
    run_id: 'breakdown-run-1',
  });
  expect(fixture.sent).toHaveLength(1);
  expect(fixture.sent[0].url).toBe('https://llm.example/v1/chat/completions');
  expect(fixture.sent[0].body.model).toBe('deepseek-v4');
});

it('a cancel command reaches the breakdown that is still waiting for the model', async () => {
  fixture.source = CONFIGURED;
  let release = () => {};
  fixture.reply = () =>
    new Promise((resolve) => {
      release = () => resolve(ANALYSIS);
    });
  const pending = run('book.breakdown', { project_root: ROOT, analysis_id: 'slow' });
  await vi.waitFor(() => expect(fixture.sent).toHaveLength(1));
  const cancel = await run('book.breakdown.cancel', { analysis_id: 'slow' });
  expect(payload(cancel).breakdown).toEqual({ analysis_id: 'slow', cancellation_requested: true });
  release();
  // 取消在模型返回后的检查点生效：报告照常落盘，状态是 cancelled，只含确定性底稿。
  expect(payload(await pending).breakdown).toMatchObject({ status: 'cancelled', model: null });
  expect((await run('book.breakdown.cancel', { analysis_id: 'slow' })).payload).toMatchObject({
    breakdown: { cancellation_requested: false },
  });
});
