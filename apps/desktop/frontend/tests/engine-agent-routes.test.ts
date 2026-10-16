import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentHostRejection, JsonFloat, MemoryRunStore } from '@storyforge/engine';

const host = vi.hoisted(() => ({
  deps: { marker: 'deps' },
  bodies: [] as unknown[],
  frames: [] as unknown[],
  failure: null as unknown,
  controlReply: null as unknown,
  controls: [] as unknown[],
}));

vi.mock('@storyforge/engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('@storyforge/engine')>();
  return {
    ...original,
    streamAgentUserMessage: async (
      deps: unknown,
      sessionId: string,
      body: unknown,
      onFrame: (frame: unknown) => void,
    ) => {
      expect(deps).toBe(host.deps);
      host.bodies.push({ sessionId, body });
      if (host.failure) throw host.failure;
      for (const frame of host.frames) onFrame(frame);
    },
    postAgentControl: async (deps: unknown, sessionId: string, body: unknown) => {
      expect(deps).toBe(host.deps);
      host.controls.push({ sessionId, body });
      if (host.failure) throw host.failure;
      return host.controlReply;
    },
  };
});
vi.mock('../src/lib/engine/agent', () => ({
  engineAgentDeps: async () => host.deps,
  engineReadDeps: async () => host.deps,
}));
vi.mock('../src/lib/engine/store', async () => {
  const { LoopCheckpointStore, MemoryRunStore: Store } = await import('@storyforge/engine');
  const runs = { store: new Store(), checkpoints: new LoopCheckpointStore() };
  return { engineRuns: vi.fn(async () => runs) };
});

import * as routes from '../src/lib/engine/agentRoutes';
import { engineRuns } from '../src/lib/engine/store';

beforeEach(() => {
  host.bodies = [];
  host.frames = [];
  host.failure = null;
  host.controls = [];
});

const request = {
  sessionId: 'run-1',
  runId: 'run-1',
  userMessage: '你好',
  assistantSessionId: 7,
  intent: 'chat.explain',
  permissionProfile: 'auto' as const,
  args: { project_path: 'D:/book' },
  agentRoleHints: ['plot_reviewer'],
  agentRoleMentions: ['@情节'],
};

describe('engine agent routes', () => {
  it('sends the same body the SSE route would post', async () => {
    host.frames = [{ type: 'agent_result', run_id: 'run-1', session_id: 'run-1' }];
    await routes.sendAgentUserMessage(request);
    expect(host.bodies).toEqual([
      {
        sessionId: 'run-1',
        body: {
          user_message: '你好',
          run_id: 'run-1',
          assistant_session_id: 7,
          intent: 'chat.explain',
          permission_profile: 'auto',
          args: {
            project_path: 'D:/book',
            agent_role_hints: ['plot_reviewer'],
            agent_role_mentions: ['@情节'],
          },
        },
      },
    ]);
    await routes.sendAgentUserMessage({ ...request, assistantSessionId: null });
    expect(host.bodies[1]).not.toHaveProperty('body.assistant_session_id');
  });

  it('hands every frame over in order, wire-encoded, and resolves with the terminal frame', async () => {
    host.frames = [
      { type: 'agent_run_started', run_id: 'run-1' },
      { type: 'agent_step', cost: new JsonFloat(2) },
      { type: 'error', session_id: 'run-1', detail: '会话不存在' },
    ];
    const seen: unknown[] = [];
    const result = await routes.sendAgentUserMessage({
      ...request,
      onEvent: (message) => seen.push(message),
    });
    expect(seen).toEqual([
      { type: 'agent_run_started', run_id: 'run-1' },
      { type: 'agent_step', cost: 2 },
      { type: 'error', session_id: 'run-1', detail: '会话不存在' },
    ]);
    expect(seen[1]).not.toBe(host.frames[1]);
    expect(result).toEqual(seen[2]);
  });

  it('fails when the stream ends without a terminal frame', async () => {
    host.frames = [{ type: 'agent_run_started', run_id: 'run-1' }];
    await expect(routes.sendAgentUserMessage(request)).rejects.toThrow(
      'Agent 流在返回结果前结束。',
    );
  });

  it('turns a host rejection into a plain Error', async () => {
    host.failure = new AgentHostRejection(422, null);
    const failure = await routes.sendAgentUserMessage(request).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AgentHostRejection);
    expect((failure as Error).message).toBe('API 返回 422');
    const controlFailure = await routes
      .sendAgentControlMessage({ sessionId: 's', runId: 'r', type: 'pause_run' })
      .catch((error: unknown) => error);
    expect(controlFailure).not.toBeInstanceOf(AgentHostRejection);
    host.failure = null;
  });

  it('passes the control payload through and wire-encodes the ack', async () => {
    host.controlReply = {
      type: 'pause_run',
      run_id: 'r',
      resumed_result: { cost: new JsonFloat(1) },
    };
    const ack = await routes.sendAgentControlMessage({
      sessionId: 's',
      runId: 'r',
      type: 'pause_run',
      payload: { source: 'desktop.timeline' },
    });
    expect(host.controls).toEqual([
      {
        sessionId: 's',
        body: { type: 'pause_run', run_id: 'r', payload: { source: 'desktop.timeline' } },
      },
    ]);
    expect(ack).toEqual({ type: 'pause_run', run_id: 'r', resumed_result: { cost: 1 } });
    await routes.sendAgentControlMessage({ sessionId: 's', runId: 'r', type: 'stop_run' });
    expect(host.controls[1]).toMatchObject({ body: { payload: {} } });
  });

  it('owns only the runs in its own store', async () => {
    expect(await routes.ownsRun('run-x')).toBe(false);
    await ((await engineRuns()).store as unknown as MemoryRunStore).insertRun({
      public_id: 'run-x',
      session_id: 's',
      assistant_session_id: null,
      goal: '',
      scope: {},
      permission_profile: 'ask',
      budget: {},
      status: 'running',
      root_plan: [],
      current_step: null,
    });
    expect(await routes.ownsRun('run-x')).toBe(true);
  });

  it('owns nothing when the engine database cannot be opened', async () => {
    vi.mocked(engineRuns).mockRejectedValueOnce(
      new Error('引擎库版本 2 比这个版本的 StoryForge 新'),
    );
    expect(await routes.ownsRun('run-x')).toBe(false);
    expect(await routes.ownsRun('run-x')).toBe(true);
  });
});
