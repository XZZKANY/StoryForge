import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routes = vi.hoisted(() => ({
  initialized: vi.fn(),
  owned: new Set<string>(),
  calls: [] as string[],
}));

// 引擎路由整块替身：只记调用与是否被加载（Python 档必须零初始化）。
vi.mock('../src/lib/engine/agentRoutes', () => {
  routes.initialized();
  return {
    ownsRun: async (runId: string) => routes.owned.has(runId),
    sendAgentUserMessage: async (request: { runId: string; sessionId: string }) => {
      routes.calls.push(`send:${request.runId}`);
      routes.owned.add(request.runId);
      return { type: 'agent_result', run_id: request.runId, session_id: request.sessionId };
    },
    sendAgentControlMessage: async (request: { runId: string; type: string }) => {
      routes.calls.push(`control:${request.runId}:${request.type}`);
      return { type: request.type, run_id: request.runId, status: 'recorded' };
    },
    agentRunEvents: async (runId: string) => {
      routes.calls.push(`events:${runId}`);
      return [];
    },
    agentRunSavePoints: async (runId: string) => {
      routes.calls.push(`save-points:${runId}`);
      return { run_id: runId };
    },
  };
});
vi.mock('../src/lib/api/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/config')>()),
  getApiConfig: async () => ({ baseUrl: 'http://python.test', apiKey: 'k' }),
}));

const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith('/control'))
    return new Response(JSON.stringify({ type: 'pause_run', status: 'recorded', run_id: 'py' }));
  if (url.endsWith('/events')) return new Response('[]');
  if (url.endsWith('/save-points')) return new Response(JSON.stringify({ run_id: 'py' }));
  const session = new URL(url).pathname.split('/')[5];
  return new Response(
    `data: ${JSON.stringify({ type: 'error', session_id: session, detail: 'python' })}\n\n`,
  );
});

beforeEach(() => {
  vi.resetModules();
  routes.initialized.mockClear();
  routes.owned.clear();
  routes.calls = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  localStorage.removeItem('engine.agentLoop');
  vi.unstubAllGlobals();
});

const load = async () => ({
  socket: await import('../src/lib/api/agent-socket'),
  runs: await import('../src/lib/api/agent-runs'),
});
const user = (runId: string) => ({
  sessionId: runId,
  runId,
  userMessage: '你好',
  permissionProfile: 'ask' as const,
});
const control = (runId: string) => ({
  sessionId: runId,
  runId,
  type: 'pause_run' as const,
});

describe('agent loop routing', () => {
  it.each(['python', 'shadow'])(
    'stays on Python without ever loading the engine (%s)',
    async (flag) => {
      localStorage.setItem('engine.agentLoop', flag);
      const { socket, runs } = await load();
      await socket.sendAgentUserMessage(user('py'));
      await socket.sendAgentControlMessage(control('py'));
      await runs.getAgentRunEvents('py');
      await runs.getAgentRunSavePoints('py');
      expect(routes.initialized).not.toHaveBeenCalled();
      expect(routes.calls).toEqual([]);
      expect(fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname)).toEqual([
        '/api/ide/agent/sessions/py/stream',
        '/api/ide/agent/sessions/py/control',
        '/api/agent-runs/py/events',
        '/api/agent-runs/py/save-points',
      ]);
    },
  );

  it('sends new runs to the engine and routes controls and reads by run ownership', async () => {
    localStorage.setItem('engine.agentLoop', 'ts');
    const { socket, runs } = await load();
    expect(await socket.sendAgentUserMessage(user('ts-run'))).toMatchObject({ run_id: 'ts-run' });
    await socket.sendAgentControlMessage(control('ts-run'));
    await runs.getAgentRunEvents('ts-run');
    await runs.getAgentRunSavePoints('ts-run');
    // Python 档跑过的历史 run 引擎不认识：控制与读照旧发给 Python。
    await socket.sendAgentControlMessage(control('old-python-run'));
    await runs.getAgentRunEvents('old-python-run');
    expect(routes.calls).toEqual([
      'send:ts-run',
      'control:ts-run:pause_run',
      'events:ts-run',
      'save-points:ts-run',
    ]);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname)).toEqual([
      '/api/ide/agent/sessions/old-python-run/control',
      '/api/agent-runs/old-python-run/events',
    ]);
  });

  it('keeps engine-owned runs on the engine after the flag goes back to python', async () => {
    localStorage.setItem('engine.agentLoop', 'ts');
    const { socket, runs } = await load();
    await socket.sendAgentUserMessage(user('ts-run'));
    localStorage.setItem('engine.agentLoop', 'python');
    await socket.sendAgentControlMessage(control('ts-run'));
    await runs.getAgentRunSavePoints('ts-run');
    await socket.sendAgentUserMessage(user('next'));
    expect(routes.calls).toEqual(['send:ts-run', 'control:ts-run:pause_run', 'save-points:ts-run']);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname)).toEqual([
      '/api/ide/agent/sessions/next/stream',
    ]);
  });

  it('after a restart on ts, reads and controls find the runs the engine database kept', async () => {
    localStorage.setItem('engine.agentLoop', 'ts');
    routes.owned.add('kept-run');
    const { socket, runs } = await load();
    await runs.getAgentRunEvents('kept-run');
    await socket.sendAgentControlMessage(control('kept-run'));
    await runs.getAgentRunSavePoints('python-run');
    expect(routes.calls).toEqual(['events:kept-run', 'control:kept-run:pause_run']);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname)).toEqual([
      '/api/agent-runs/python-run/save-points',
    ]);
  });

  it('on python, never opens the engine for reads even if it kept runs', async () => {
    localStorage.setItem('engine.agentLoop', 'python');
    routes.owned.add('kept-run');
    const { runs } = await load();
    await runs.getAgentRunEvents('kept-run');
    expect(routes.initialized).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
