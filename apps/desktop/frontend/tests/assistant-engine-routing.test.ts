import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
  initialized: vi.fn(),
  sent: [] as { url: string; body: unknown }[],
  replies: [] as { status: number; chunks: string[] }[],
  source: {} as Record<string, string>,
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
vi.mock('../src/lib/api/config', () => ({
  getApiConfig: async () => ({ baseUrl: 'http://synthetic-api.invalid/', apiKey: 'transport-key' }),
  trimApiBaseUrl: (url: string) => url.replace(/\/+$/, ''),
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

type StoreCall = { method: string; url: string; body: Record<string, unknown> | null };
let storeCalls: StoreCall[] = [];
let nextId = 1;

function stubStore(overrides: Record<string, Response> = {}) {
  storeCalls = [];
  nextId = 1;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(init.body as string) : null;
      storeCalls.push({ method: init.method!, url, body });
      const override = overrides[`${init.method} ${url}`];
      if (override) return override;
      const id = nextId++;
      return new Response(
        JSON.stringify({ id, project_path: 'D:/book', input_summary: body?.input_summary ?? {} }),
        { status: 200 },
      );
    }),
  );
}

// 冷加载整个引擎包在满载机器上会超过单条用例的 5 秒预算，先在这里加载。
beforeAll(async () => {
  await import('../src/lib/engine/assistant');
}, 60_000);

beforeEach(() => {
  engine.initialized.mockClear();
  engine.sent = [];
  engine.replies = [];
  engine.source = { ...SOURCE };
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('dev routes revise and provider health to the engine when no preference is set', async () => {
  stubStore();
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
  expect(storeCalls.map((call) => call.url)).not.toContain(
    'http://synthetic-api.invalid/api/assistant/revise',
  );
});

it('ts revises through the engine and records the evidence chain in the Python session store', async () => {
  localStorage.setItem('engine.assistant', 'ts');
  stubStore();
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
    assistantSessionId: 1,
  });
  expect(storeCalls.map((call) => `${call.method} ${call.url}`)).toEqual([
    'POST http://synthetic-api.invalid/api/assistant/sessions',
    'POST http://synthetic-api.invalid/api/assistant/sessions/1/tool-calls',
    'PATCH http://synthetic-api.invalid/api/assistant/tool-calls/2',
    'PATCH http://synthetic-api.invalid/api/assistant/tool-calls/2',
    'POST http://synthetic-api.invalid/api/assistant/sessions/1/messages',
  ]);
  expect(storeCalls[0].body).toEqual({
    title: '修订 正文/第001章.md',
    task_type: 'desktop_revise',
    project_path: 'D:/book',
    messages: [{ role: 'user', content: '改成她' }],
  });
  expect(storeCalls[2].body).toHaveProperty('input_summary.generation_sources.version');
  expect(storeCalls[3].body).toMatchObject({
    status: 'completed',
    output_summary: { after_chars: 4 },
  });
  expect(engine.sent).toHaveLength(1);
  expect(engine.sent[0]).toMatchObject({
    url: 'https://llm.example/v1/chat/completions',
    body: { model: 'deepseek-v4', stream: true },
  });
});

it('ts continues with deltas and returns the post-processed done text', async () => {
  localStorage.setItem('engine.assistant', 'ts');
  stubStore();
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
    assistantSessionId: 1,
  });
  expect(engine.sent[0].body).toMatchObject({ max_completion_tokens: 900, stream: true });
});

it('ts surfaces the same plain error text Python would put in detail', async () => {
  localStorage.setItem('engine.assistant', 'ts');
  engine.source = { ...SOURCE, STORYFORGE_LLM_MODEL: '' };
  stubStore();
  const { reviseFileContent, streamContinueProse } = await import('../src/lib/api/assistant');
  const error = await reviseFileContent({
    filePath: 'a.md',
    content: 'a',
    instruction: '改',
  }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).constructor).toBe(Error);
  expect((error as Error).message).toBe('真实 LLM 未配置，缺少环境变量：STORYFORGE_LLM_MODEL');
  expect(storeCalls).toEqual([]);

  engine.source = { ...SOURCE };
  stubStore({
    'GET http://synthetic-api.invalid/api/assistant/sessions/7': new Response(
      JSON.stringify({ detail: 'Assistant 会话不存在：7。' }),
      { status: 404 },
    ),
  });
  await expect(
    streamContinueProse({ filePath: 'a.md', content: 'a', cursorLine: 1, assistantSessionId: 7 }),
  ).rejects.toThrow('Assistant 会话不存在：7。');
});

it('ts turns an error frame into a thrown error, like the Python SSE parser', async () => {
  localStorage.setItem('engine.assistant', 'ts');
  stubStore();
  engine.replies.push({ status: 200, chunks: sse('他推开门走进雨里去了。') });
  const { streamContinueProse } = await import('../src/lib/api/assistant');
  await expect(
    streamContinueProse({ filePath: 'a.md', content: '他推开门走进雨里去了。', cursorLine: 1 }),
  ).rejects.toThrow('模型这一轮没有写出新内容（可能只是复述了上文）。');
});

it('ts stops at the next stream read once the author cancels and records the run as paused', async () => {
  localStorage.setItem('engine.assistant', 'ts');
  stubStore();
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
  const last = storeCalls[storeCalls.length - 1];
  expect(last).toMatchObject({
    method: 'PATCH',
    body: { status: 'paused', output_summary: { interruption_reason: 'stopped' } },
  });
});

it('ts probes provider health through the engine', async () => {
  localStorage.setItem('engine.assistant', 'ts');
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
