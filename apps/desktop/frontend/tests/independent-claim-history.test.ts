import { beforeEach, expect, test, vi } from 'vitest';
import {
  reconstructAgentResultFromEvents,
  type AgentRunEventRecord,
} from '../src/lib/api/agent-run-events';
import { settleSuggestionRun } from '../src/lib/suggestion-recovery';
const state = vi.hoisted(() => ({
  events: [] as AgentRunEventRecord[],
  descriptor: null as unknown,
  control: vi.fn(),
}));
vi.mock('../src/lib/api/assistant', () => ({
  getAssistantSession: async () => ({ id: 7, project_path: '/project' }),
}));
vi.mock('../src/lib/api/agent-runs', () => ({ getAgentRunEvents: async () => state.events }));
vi.mock('../src/lib/api/agent-socket', () => ({
  sendAgentControlMessage: state.control,
  isAgentErrorMessage: () => false,
}));
vi.mock('../src/lib/tauri-fs', () => ({
  TauriFileSystem: {
    pathExists: async () => true,
    readProjectFile: async () => JSON.stringify(state.descriptor),
  },
}));
const context = { runId: 'run', sessionId: 'session' };
const start = {
  event_type: 'agent_execution_started',
  payload: { run_id: 'run', session_id: 'session' },
};
const claim = {
  event_type: 'agent_execution_claimed',
  payload: { control_event_id: 99, runtime_state: 'in_flight' },
};
const patch = { id: 'patch', file_path: 'chapter.md', before: 'before', after: 'after' };
const pending = {
  event_type: 'permission_required',
  payload: { assistant_session_id: 7, proposed_patch: patch },
};
const completed = {
  event_type: 'agent_run_completed',
  payload: {
    assistant_session_id: 7,
    run_id: 'run',
    session_id: 'session',
    control_type: 'approve_permission',
  },
};
const descriptor = () => ({
  version: 1 as const,
  owner: 'owner',
  proposal: {
    id: 'patch',
    filePath: '/project/chapter.md',
    title: 'Edit',
    summary: 'Edit',
    before: 'before',
    after: 'after',
    note: '',
    createdAt: 1,
    assistantSessionId: 7,
    runId: 'run',
    requiresConfirmation: true,
  },
  requests: [],
});
beforeEach(() => {
  state.events = [];
  state.descriptor = descriptor();
  state.control.mockReset();
});
for (const type of [
  'permission_required',
  'agent_run_completed',
  'agent_run_failed',
  'agent_run_interrupted',
]) {
  test(`claim invalidates older ${type} before decoding malformed history`, () => {
    const events = [{ event_type: type, payload: { assistant_session_id: 7 } }, claim];
    const old = JSON.stringify(events);
    expect(reconstructAgentResultFromEvents(events, context)).toBeNull();
    expect(JSON.stringify(events)).toBe(old);
  });
}
test('new terminal after claim is recoverable, retains prior trace evidence', () => {
  const events = [
    { event_type: 'tool_trace', payload: { trace: { tool_name: 'old-written-side-effect' } } },
    pending,
    claim,
    start,
    completed,
  ];
  const result = reconstructAgentResultFromEvents(events, context);
  expect(result?.type).toBe('agent_result');
  expect((result as any).tool_trace[0].tool_name).toBe('old-written-side-effect');
});
for (const decision of ['reject', 'observe'] as const) {
  test(`claim prevents old proposal ${decision} from controlling new execution`, async () => {
    state.events = [start, pending, claim];
    await expect(
      settleSuggestionRun('/project', state.descriptor as ReturnType<typeof descriptor>, decision),
    ).rejects.toThrow('原运行的执行归属已变化');
    expect(state.control).not.toHaveBeenCalled();
  });
}
test('old automatic completion cannot settle after new claim', async () => {
  const value = descriptor();
  value.proposal.requiresConfirmation = false;
  state.descriptor = value;
  state.events = [start, completed, claim];
  await expect(settleSuggestionRun('/project', value, 'reject')).rejects.toThrow(
    '原运行完成状态尚未确认',
  );
  expect(state.control).not.toHaveBeenCalled();
});
test('legacy completed history without claim stays compatible', async () => {
  state.events = [start, pending, completed];
  await expect(
    settleSuggestionRun('/project', state.descriptor as ReturnType<typeof descriptor>, 'observe'),
  ).resolves.toBeUndefined();
  expect(state.control).not.toHaveBeenCalled();
});
test('late old interrupted finally cannot replay across a newer claim', () => {
  const oldStart = { ...start, id: 10 };
  const newerClaim = { ...claim, id: 20 };
  const lateOld = {
    event_type: 'agent_run_interrupted',
    payload: {
      execution_id: 10,
      execution_result: {
        type: 'agent_result',
        session_id: 'session',
        run_id: 'run',
        assistant_session_id: 7,
        intent: 'chat.explain',
        user_message: '',
        plan: [],
        tool_trace: [],
        proposed_patch: null,
        agent_result: {
          summary: 'Old worker stopped',
          requires_user_confirmation: false,
          runtime_interrupted: true,
        },
        runtime_interruption: { status: 'paused', boundary: 'worker_settled' },
      },
    },
  };
  expect(
    reconstructAgentResultFromEvents([oldStart, pending, newerClaim, lateOld], context),
  ).toBeNull();
});
test('late old interruption cannot obscure already committed current completion', () => {
  const currentStart = { ...start, id: 30 };
  const lateOld = {
    event_type: 'agent_run_interrupted',
    payload: { execution_id: 10, execution_result: {} },
  };
  const events = [
    { ...start, id: 10 },
    pending,
    { ...claim, id: 20 },
    currentStart,
    completed,
    lateOld,
  ];
  const before = JSON.stringify(events);
  expect(reconstructAgentResultFromEvents(events, context)?.type).toBe('agent_result');
  expect(JSON.stringify(events)).toBe(before);
});
test('caller-shaped resume metadata never counts as execution ownership boundary', () => {
  const events = [
    completed,
    {
      event_type: 'resume_run',
      payload: { control_effect: 'applied', runtime_state: 'in_flight', execution_id: 42 },
    },
  ];
  expect(reconstructAgentResultFromEvents(events, context)?.type).toBe('agent_result');
});
test('current matching interruption still reconstructs after claim and actual start', () => {
  const actualStart = { ...start, id: 30 };
  const current = {
    event_type: 'agent_run_interrupted',
    payload: {
      execution_id: 30,
      execution_result: {
        type: 'agent_result',
        session_id: 'session',
        run_id: 'run',
        assistant_session_id: 7,
        intent: 'chat.explain',
        user_message: '',
        plan: [],
        tool_trace: [],
        proposed_patch: null,
        agent_result: {
          summary: 'Current paused',
          requires_user_confirmation: false,
          runtime_interrupted: true,
        },
        runtime_interruption: { status: 'paused', boundary: 'worker_settled' },
      },
    },
  };
  const result = reconstructAgentResultFromEvents(
    [{ ...claim, id: 20 }, actualStart, current],
    context,
  );
  expect((result as any).agent_result.summary).toBe('Current paused');
});
