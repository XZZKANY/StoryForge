import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Db } from '@storyforge/engine';
import { nodeSqliteDb } from '../../../../packages/engine/src/store/nodeSqlite.test-support';

const engine = vi.hoisted(() => ({
  initialized: vi.fn(),
  sent: [] as { url: string; body: unknown }[],
  replies: [] as { status: number; chunks: string[] }[],
  source: {} as Record<string, string>,
  db: null as unknown as Db,
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('../src/lib/engine/llm', () => {
  engine.initialized();
  return {
    nativeLlmSource: async () => ({ source: engine.source, secrets: { values: [] } }),
    nativeHttpPort: () => ({
      async send(request: { url: string; body: Uint8Array | null }) {
        engine.sent.push({
          url: request.url,
          body: request.body ? JSON.parse(new TextDecoder().decode(request.body)) : null,
        });
        const reply = engine.replies.shift()!;
        const encoder = new TextEncoder();
        let closed = false;
        return {
          status: reply.status,
          headers: { 'content-type': 'text/event-stream' },
          body: (async function* () {
            for (const chunk of reply.chunks) {
              if (closed) return;
              yield encoder.encode(chunk);
            }
          })(),
          close() {
            closed = true;
          },
        };
      },
    }),
  };
});
vi.mock('../src/lib/engine/reader', () => {
  engine.initialized();
  // 合成空项目：项目根存在、没有任何文件。
  return {
    nativeProjectReader: {
      async resolveProjectPath(_root: string, path: string) {
        const relative = path.replace(/^D:\/book\/?/, '') || '.';
        return { relativePath: relative, resolvedRelativePath: relative };
      },
      async inspectProjectPath(_root: string, path: string) {
        const kind = path === '.' ? 'directory' : 'missing';
        return { entryKind: kind, targetKind: kind, isReparsePoint: false, sizeBytes: 0 };
      },
      async readProjectDirectory() {
        return { names: [], exceeded: false, terminalError: null };
      },
      async readProjectBytes() {
        const { ProjectReadError } = await import('@storyforge/engine');
        throw new ProjectReadError('missing');
      },
    },
  };
});
// 会话与工具调用证据链写进引擎库（node:sqlite 替身）。
vi.mock('../src/lib/engine/db', () => ({
  nativeEngineDb: {
    select: (sql: string, params?: never[]) => engine.db.select(sql, params),
    transaction: (steps: never[]) => engine.db.transaction(steps),
  },
  nativePythonDb: { snapshot: async () => null },
}));

const SOURCE = {
  STORYFORGE_LLM_PROVIDER: 'openai',
  STORYFORGE_LLM_BASE_URL: 'https://llm.example/v1',
  STORYFORGE_LLM_API_KEY: '[已隐藏的密钥]',
  STORYFORGE_LLM_MODEL: 'deepseek-v4',
};
const sse = (...texts: string[]) => [
  ...texts.map(
    (text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
  ),
  `data: ${JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  })}\n\n`,
  'data: [DONE]\n\n',
];

type Row = Record<string, unknown>;
const rows = (sql: string, params: unknown[] = []) =>
  engine.db.select(sql, params as never[]) as Promise<Row[]>;
const json = (value: unknown) => JSON.parse(String(value)) as Record<string, unknown>;
const latestSession = async () =>
  (await rows('SELECT * FROM assistant_sessions ORDER BY id DESC LIMIT 1'))[0];

// 冷加载整个引擎包在满载机器上会超过单条用例的 5 秒预算，先在这里加载。
beforeAll(async () => {
  await import('../src/lib/engine/assistant');
  // 引擎库在一个 WebView 里只打开一次：整个文件共用一个库。
  engine.db = nodeSqliteDb();
}, 60_000);

beforeEach(() => {
  engine.initialized.mockClear();
  engine.sent = [];
  engine.replies = [];
  engine.source = { ...SOURCE };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('修订、续写与会话都在进程内跑，不该再发 HTTP');
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('revise and provider health run on the engine', async () => {
  engine.replies.push(
    { status: 200, chunks: sse('她回头。') },
    { status: 200, chunks: [JSON.stringify({ data: [{ id: 'deepseek-v4' }] })] },
  );
  const { reviseFileContent, probeProviderHealth } = await import('../src/lib/api/assistant');
  await reviseFileContent({ filePath: 'a.md', content: '他回头。', instruction: '改成她' });
  await probeProviderHealth();
  expect(engine.sent.map((request) => request.url)).toEqual([
    'https://llm.example/v1/chat/completions',
    'https://llm.example/v1/models',
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it('revises through the engine and records the evidence chain in the engine database', async () => {
  engine.replies.push({ status: 200, chunks: sse('她回头。') });
  const { reviseFileContent } = await import('../src/lib/api/assistant');
  const result = await reviseFileContent({
    filePath: '正文/第001章.md',
    content: '他回头。',
    instruction: '改成她',
    projectRoot: 'D:/book',
  });
  expect(result).toEqual({
    before: '他回头。',
    after: '她回头。',
    summary: '已按指令修订 正文/第001章.md，修订后约 4 字。',
    model: 'deepseek-v4',
    latencyMs: expect.any(Number),
    completionTokens: 2,
    assistantSessionId: expect.any(Number),
  });
  const session = await latestSession();
  expect(session).toMatchObject({
    id: result.assistantSessionId,
    title: '修订 正文/第001章.md',
    task_type: 'desktop_revise',
    project_path: 'D:/book',
  });
  const messages = await rows(
    'SELECT role, content FROM assistant_messages WHERE session_id = $1 ORDER BY id',
    [session.id],
  );
  expect(messages[0]).toEqual({ role: 'user', content: '改成她' });
  expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  const [call] = await rows('SELECT * FROM assistant_tool_calls WHERE session_id = $1', [
    session.id,
  ]);
  expect(call.status).toBe('completed');
  expect(json(call.input_summary)).toHaveProperty('generation_sources.version');
  expect(json(call.output_summary)).toMatchObject({ after_chars: 4 });
  expect(engine.sent).toHaveLength(1);
  expect(engine.sent[0]).toMatchObject({
    url: 'https://llm.example/v1/chat/completions',
    body: { model: 'deepseek-v4', stream: true },
  });
});

it('continues with deltas and returns the post-processed done text', async () => {
  engine.replies.push({ status: 200, chunks: sse('他推开门。', '雨很大。半') });
  const { streamContinueProse } = await import('../src/lib/api/assistant');
  const deltas: string[] = [];
  const result = await streamContinueProse({
    filePath: '正文/第001章.md',
    content: '上文。\n',
    cursorLine: 1,
    projectRoot: 'D:/book',
    onDelta: (text) => deltas.push(text),
  });
  expect(deltas).toEqual(['他推开门。', '雨很大。半']);
  expect(result).toEqual({
    text: '他推开门。雨很大。',
    model: 'deepseek-v4',
    assistantSessionId: (await latestSession()).id,
  });
  expect(engine.sent[0].body).toMatchObject({ max_completion_tokens: 900, stream: true });
});

it('surfaces plain error texts (the same ones Python put in detail)', async () => {
  engine.source = { ...SOURCE, STORYFORGE_LLM_MODEL: '' };
  const before = (await rows('SELECT id FROM assistant_sessions')).length;
  const { reviseFileContent, streamContinueProse } = await import('../src/lib/api/assistant');
  const error = await reviseFileContent({
    filePath: 'a.md',
    content: 'a',
    instruction: '改',
  }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).constructor).toBe(Error);
  expect((error as Error).message).toBe('真实 LLM 未配置，缺少环境变量：STORYFORGE_LLM_MODEL');
  expect((await rows('SELECT id FROM assistant_sessions')).length).toBe(before);

  engine.source = { ...SOURCE };
  await expect(
    streamContinueProse({ filePath: 'a.md', content: 'a', cursorLine: 1, assistantSessionId: 999 }),
  ).rejects.toThrow('Assistant 会话不存在：999。');
});

it('turns an error frame into a thrown error', async () => {
  engine.replies.push({ status: 200, chunks: sse('他推开门走进雨里去了。') });
  const { streamContinueProse } = await import('../src/lib/api/assistant');
  await expect(
    streamContinueProse({ filePath: 'a.md', content: '他推开门走进雨里去了。', cursorLine: 1 }),
  ).rejects.toThrow('模型这一轮没有写出新内容（可能只是复述了上文）。');
});

it('stops at the next stream read once the author cancels and records the call as paused', async () => {
  engine.replies.push({ status: 200, chunks: sse('他推开门。', '雨很大。') });
  const { streamContinueProse } = await import('../src/lib/api/assistant');
  const controller = new AbortController();
  const outcome = await streamContinueProse({
    filePath: '正文/第001章.md',
    content: '上文。\n',
    cursorLine: 1,
    projectRoot: 'D:/book',
    signal: controller.signal,
    onDelta: () => controller.abort(),
  }).catch((caught: unknown) => caught);
  expect((outcome as Error).name).toBe('RunInterrupted');
  const [last] = await rows('SELECT * FROM assistant_tool_calls ORDER BY id DESC LIMIT 1');
  expect(last.status).toBe('paused');
  expect(json(last.output_summary)).toMatchObject({ interruption_reason: 'stopped' });
});

it('probes provider health through the engine', async () => {
  engine.replies.push({
    status: 200,
    chunks: [JSON.stringify({ data: [{ id: 'deepseek-v4' }] })],
  });
  const { probeProviderHealth } = await import('../src/lib/api/assistant');
  const health = await probeProviderHealth();
  expect(health).toMatchObject({
    status: 'ok',
    reachable: true,
    baseUrl: 'https://llm.example/v1',
    model: 'deepseek-v4',
    modelCount: 1,
    models: ['deepseek-v4'],
    detail: null,
    missingEnv: [],
  });
  expect(engine.sent[0].url).toBe('https://llm.example/v1/models');
});
