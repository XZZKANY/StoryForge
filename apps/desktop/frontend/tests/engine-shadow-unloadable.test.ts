import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// 影子模块加载失败（发行版分包缺失、Worker 起不来等）：作者的请求照走 Python。
vi.mock('../src/lib/engine/shadow', () => {
  throw new Error('chunk failed to load');
});
vi.mock('../src/lib/engine/agentShadow', () => {
  throw new Error('chunk failed to load');
});
vi.mock('../src/lib/api/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/config')>()),
  getApiConfig: async () => ({ baseUrl: 'http://python.test', apiKey: 'k' }),
}));

const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  if (url.endsWith('/revise'))
    return new Response(
      JSON.stringify({
        before: 'a',
        after: 'b',
        summary: 's',
        model: 'm',
        latency_ms: 1,
        completion_tokens: 2,
        assistant_session_id: 3,
      }),
    );
  const session = new URL(url).pathname.split('/')[5];
  void init;
  return new Response(
    `data: ${JSON.stringify({ type: 'error', session_id: session, detail: 'python' })}\n\n`,
  );
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.setItem('engine.assistant', 'shadow');
  localStorage.setItem('engine.agentLoop', 'shadow');
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('an unloadable shadow module still revises through Python, without the shadow header', async () => {
  const { reviseFileContent } = await import('../src/lib/api/assistant');
  const result = await reviseFileContent({ filePath: 'a.md', content: 'a', instruction: '改' });
  expect(result.after).toBe('b');
  const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
  expect(headers['X-StoryForge-Shadow']).toBeUndefined();
});

it('an unloadable agent shadow module still sends the message to Python', async () => {
  const { sendAgentUserMessage } = await import('../src/lib/api/agent-socket');
  const result = await sendAgentUserMessage({
    sessionId: 'run-1',
    runId: 'run-1',
    userMessage: '你好',
    permissionProfile: 'ask',
  });
  expect(result).toMatchObject({ type: 'error', detail: 'python' });
  expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/api/ide/agent/sessions/run-1/stream');
});
