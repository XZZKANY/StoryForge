import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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

beforeEach(() => engine.initialized.mockClear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

async function expectPythonTransportOnly() {
  const { reviseFileContent, probeProviderHealth } = await import('../src/lib/api/assistant');
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/provider-health')
      ? new Response(JSON.stringify({ status: 'ok', reachable: true }), { status: 200 })
      : new Response(
          JSON.stringify({
            before: 'a',
            after: 'b',
            summary: 's',
            model: 'm',
            latency_ms: 1,
            completion_tokens: 2,
            assistant_session_id: 3,
          }),
          { status: 200 },
        ),
  );
  vi.stubGlobal('fetch', fetchMock);
  await reviseFileContent({ filePath: 'a.md', content: 'a', instruction: '改' });
  await probeProviderHealth();
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'http://synthetic-api.invalid/api/assistant/revise',
    'http://synthetic-api.invalid/api/assistant/provider-health',
  ]);
  expect(engine.initialized).not.toHaveBeenCalled();
}

// 独立成文件：vitest 按文件隔离模块，引擎模块在这里一定是首次加载，「零初始化」才有意义。
// 影子档（P5-1）要在引擎里复算 prompt，见 assistant-engine-shadow。
it('python keeps the single Python transport and never initializes the engine', async () => {
  localStorage.setItem('engine.assistant', 'python');
  await expectPythonTransportOnly();
});

// 装机版默认影子档（P5-1 预览版）；作者在设置里切回 Python 后，零初始化引擎、只走 Python。
it('production switched back to Python keeps the single Python transport', async () => {
  vi.stubEnv('DEV', false);
  localStorage.setItem('engine.assistant', 'python');
  await expectPythonTransportOnly();
});
