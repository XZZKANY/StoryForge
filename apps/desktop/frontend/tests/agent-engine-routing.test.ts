import { beforeEach, expect, it, vi } from 'vitest';

const routes = vi.hoisted(() => ({ initialized: vi.fn(), calls: [] as string[] }));

// 引擎路由整块替身：只记调用与加载次数。
vi.mock('../src/lib/engine/agentRoutes', () => {
  routes.initialized();
  return {
    sendAgentUserMessage: async (request: { runId: string; sessionId: string }) => {
      routes.calls.push(`send:${request.runId}`);
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

beforeEach(() => {
  vi.resetModules();
  routes.initialized.mockClear();
  routes.calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('agent 循环在进程内跑，不该再发 HTTP');
    }),
  );
});

it('messages, controls and reads all go to the in-process engine, loaded once', async () => {
  const socket = await import('../src/lib/api/agent-socket');
  const runs = await import('../src/lib/api/agent-runs');
  const request = { sessionId: 'r1', runId: 'r1', userMessage: '你好', permissionProfile: 'ask' };
  expect(await socket.sendAgentUserMessage(request as never)).toMatchObject({
    type: 'agent_result',
    run_id: 'r1',
  });
  await socket.sendAgentControlMessage({ sessionId: 'r1', runId: 'r1', type: 'pause_run' });
  await runs.getAgentRunEvents('r1');
  await runs.getAgentRunSavePoints('r1');
  expect(routes.calls).toEqual(['send:r1', 'control:r1:pause_run', 'events:r1', 'save-points:r1']);
  expect(routes.initialized).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
