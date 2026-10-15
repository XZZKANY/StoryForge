import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import golden from '../../../../packages/engine/golden/p5-shadow.windows.json';

type Scenario = (typeof golden.scenarios)[number];
type Appended = { log: string; record: Record<string, unknown> };

const engine = vi.hoisted(() => ({
  source: {} as Record<string, string>,
  sent: [] as unknown[],
  appended: [] as { log: string; record: Record<string, unknown> }[],
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.10' }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args: { log: string; record: Record<string, unknown> }) => {
    if (command !== 'engine_shadow_append') throw new Error(`unexpected command ${command}`);
    engine.appended.push(args);
    return true;
  }),
}));
vi.mock('../src/lib/engine/llm', () => ({
  nativeLlmSource: async () => ({
    source: engine.source,
    secrets: { values: [engine.source.STORYFORGE_LLM_API_KEY] },
  }),
  nativeHttpPort: () => ({
    send: async (request: unknown) => {
      engine.sent.push(request);
      throw new Error('the shadow must not reach the network');
    },
  }),
}));
vi.mock('../src/lib/engine/reader', async () => {
  const fixture = (await import('../../../../packages/engine/golden/p5-shadow.windows.json'))
    .default;
  const { memoryProject } =
    await import('../../../../packages/engine/src/kernel/memoryProject.test-support');
  return { nativeProjectReader: memoryProject(fixture.project_root, fixture.files).reader };
});
vi.mock('../src/lib/api/config', () => ({
  getApiConfig: async () => ({ baseUrl: 'http://python.invalid', apiKey: 'transport-key' }),
  trimApiBaseUrl: (url: string) => url.replace(/\/+$/, ''),
}));

const ROOT = golden.project_root;
let fetched: { method: string; url: string; headers: Record<string, string> }[] = [];

/** Python 侧：照预言机录下的路由响应原样回放；会话只读接口按真实形状回。 */
function stubPython(scenario: Scenario, edit?: (body: string) => string) {
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      fetched.push({
        method: init.method!,
        url,
        headers: { ...(init.headers as Record<string, string>) },
      });
      if (
        init.method === 'GET' &&
        url === `http://python.invalid/api/assistant/sessions/${golden.bound_session_id}`
      )
        return new Response(JSON.stringify({ id: golden.bound_session_id, project_path: ROOT }));
      const response = scenario.response;
      const body =
        typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
      return new Response(edit ? edit(body) : body, { status: response.status });
    }),
  );
}

async function send(scenario: Scenario) {
  const api = await import('../src/lib/api/assistant');
  const payload = scenario.payload as Record<string, unknown>;
  if (scenario.kind === 'revise')
    return api.reviseFileContent({
      filePath: payload.file_path as string,
      content: payload.content as string,
      instruction: payload.instruction as string,
      projectName: (payload.project_name as string | undefined) ?? null,
      projectRoot: (payload.project_root as string | undefined) ?? null,
      assistantSessionId: (payload.assistant_session_id as number | undefined) ?? null,
      qualityGate: payload.quality_gate as 'polish' | undefined,
    });
  const bundle = payload.context_bundle as
    | {
        project_root: string;
        current_file: string;
        files: {
          path: string;
          relative_path: string;
          kind: string;
          title: string;
          excerpt: string;
        }[];
      }
    | undefined;
  return api.streamContinueProse({
    filePath: payload.file_path as string,
    content: payload.content as string,
    cursorLine: (payload.cursor_line as number | undefined) ?? 0,
    instruction: (payload.instruction as string | undefined) ?? null,
    projectRoot: (payload.project_root as string | undefined) ?? null,
    assistantSessionId: (payload.assistant_session_id as number | undefined) ?? null,
    targetChars: (payload.target_chars as number | undefined) ?? null,
    contextBundle: bundle && {
      projectRoot: bundle.project_root,
      currentFile: bundle.current_file,
      files: bundle.files.map((file) => ({
        path: file.path,
        relativePath: file.relative_path,
        kind: file.kind,
        title: file.title,
        excerpt: file.excerpt,
      })),
    },
  } as Parameters<typeof api.streamContinueProse>[0]);
}

async function settled(): Promise<{ checks: Appended[]; diffs: Appended[] }> {
  await vi.waitFor(() =>
    expect(engine.appended.filter((item) => item.log === 'checks')).toHaveLength(1),
  );
  // 有差异时 diffs 紧跟 checks 写入。
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    checks: engine.appended.filter((item) => item.log === 'checks'),
    diffs: engine.appended.filter((item) => item.log === 'diffs'),
  };
}

// 冷加载整个引擎包在满载机器上会超过单条用例的 5 秒预算，先在这里加载。
beforeAll(async () => {
  await import('../src/lib/engine/shadow');
}, 60_000);

beforeEach(() => {
  engine.sent = [];
  engine.appended = [];
  localStorage.setItem('engine.assistant', 'shadow');
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

for (const scenario of golden.scenarios) {
  it(`judges the engine's own request equal to Python's: ${scenario.id}`, async () => {
    engine.source = scenario.source as Record<string, string>;
    stubPython(scenario);
    const result = await send(scenario);

    // 作者拿到的是 Python 的结果。
    if (scenario.kind === 'revise') {
      const body = scenario.response.body as { after: string; assistant_session_id: number };
      expect(result).toMatchObject({
        after: body.after,
        assistantSessionId: body.assistant_session_id,
      });
    } else expect((result as { text: string }).text).toBe('林舟站在檐下，没有说话。');

    const { checks, diffs } = await settled();
    expect(checks[0].record).toMatchObject({
      surface: scenario.kind === 'revise' ? 'assistant.revise' : 'assistant.continue',
      outcome: 'match',
      step: 'agent.model',
      python_requests: 1,
      app_version: '0.1.10',
    });
    expect(checks[0].record.ts_digest).toBe(checks[0].record.python_digest);
    expect(diffs).toEqual([]);
    // 引擎这一侧不出网、不写会话：除了 Python 那一个请求，最多只读一次会话归属。
    expect(engine.sent).toEqual([]);
    expect(fetched.filter((call) => call.method !== 'GET')).toHaveLength(1);
    expect(fetched.find((call) => call.method === 'POST')!.headers['X-StoryForge-Shadow']).toBe(
      'prompts',
    );
  });
}

it('records where the prompts part ways, without the text', async () => {
  const scenario = golden.scenarios.find((item) => item.id === 'revise-new-session')!;
  engine.source = scenario.source as Record<string, string>;
  // Python 的 system prompt 被改动一个字（摘要随之不同）：差异要落在 messages[0].content 上。
  stubPython(scenario, (body) => {
    const data = JSON.parse(body) as {
      shadow_requests: { request: { messages: { content: string }[] }; request_digest: string }[];
    };
    const capture = data.shadow_requests[0];
    capture.request.messages[0].content = capture.request.messages[0].content.replace(
      '修订',
      '修改',
    );
    capture.request_digest = 'f'.repeat(64);
    return JSON.stringify(data);
  });
  await send(scenario);
  const { checks, diffs } = await settled();
  expect(checks[0].record.outcome).toBe('diff');
  const [difference] = diffs[0].record.differences as Record<string, unknown>[];
  expect(difference).toMatchObject({
    path: 'messages[0].content',
    kind: 'text',
    python_span: 1,
    ts_span: 1,
  });
  expect(JSON.stringify(diffs[0].record)).not.toContain('修');
});

it('a broken engine side still hands the author the Python result', async () => {
  const scenario = golden.scenarios.find((item) => item.id === 'continue-instruction')!;
  engine.source = {};
  stubPython(scenario);
  const result = await send(scenario);
  expect((result as { text: string }).text).toBe('林舟站在檐下，没有说话。');
  const { checks, diffs } = await settled();
  expect(checks[0].record).toMatchObject({ outcome: 'diff', ts_digest: null });
  expect(checks[0].record.ts_error).toEqual(expect.any(String));
  expect(diffs[0].record.differences).toEqual([{ path: 'request', kind: 'missing_in_ts' }]);
});

it('python mode sends no shadow header and records nothing', async () => {
  localStorage.setItem('engine.assistant', 'python');
  const scenario = golden.scenarios.find((item) => item.id === 'revise-projectless')!;
  stubPython(scenario);
  await send(scenario);
  expect(fetched).toHaveLength(1);
  expect(fetched[0].headers['X-StoryForge-Shadow']).toBeUndefined();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(engine.appended).toEqual([]);
});

it('a Python failure reaches the author unchanged and nothing is compared', async () => {
  const scenario = golden.scenarios.find((item) => item.id === 'revise-projectless')!;
  engine.source = scenario.source as Record<string, string>;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ detail: '上游 502' }), { status: 502 })),
  );
  await expect(send(scenario)).rejects.toThrow('上游 502');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(engine.appended).toEqual([]);
});
