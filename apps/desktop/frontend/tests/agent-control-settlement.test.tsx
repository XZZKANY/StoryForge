import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useRunAuthorAgent } from '../src/components/chat-window/useRunAuthorAgent';
import { useAgentRunRecovery } from '../src/components/chat-window/useAgentRunRecovery';
import { useAgentRunControls } from '../src/components/chat-window/useAgentRunControls';
import { useAgentStreamEvent } from '../src/components/chat-window/useAgentStreamEvent';
import { statusFromAgentResult } from '../src/components/chat-window/resumed-result';
import { reconstructAgentResultFromEvents } from '../src/lib/api/agent-run-events';
import { conversationKey } from '../src/components/chat-window/session-guard';
import {
  isAgentResultMessage,
  sendAgentControlMessage,
  sendAgentUserMessage,
  type AgentResultMessage,
} from '../src/lib/api-client';
import { APPLY_FILE_SUGGESTION_EVENT } from '../src/lib/assistant-events';

vi.mock('../src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api-client')>()),
  sendAgentUserMessage: vi.fn(),
  sendAgentControlMessage: vi.fn(),
  getAgentRunEvents: vi.fn().mockResolvedValue([]),
  getAgentRunSavePoints: vi.fn().mockRejectedValue(new Error('no projection')),
}));
vi.mock('../src/lib/project-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/project-context')>()),
  buildContextBundle: vi.fn(async () => ({
    projectRoot: 'D:/book',
    currentFile: null,
    files: [],
    summary: { hasStoryStructure: true, counts: {} },
    budget: {
      fileCount: 0,
      charCount: 0,
      maxFiles: 8,
      maxExcerptChars: 1200,
      truncated: false,
      pinnedFileCount: 0,
      missingPinnedFiles: [],
    },
  })),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function interrupted(status: 'stopped' | 'paused') {
  return {
    type: 'agent_result' as const,
    session_id: 'session',
    run_id: 'run',
    assistant_session_id: 7,
    intent: 'chat.explain',
    user_message: '检查第一章',
    plan: [],
    tool_trace: [],
    proposed_patch: null,
    agent_result: {
      summary: status === 'stopped' ? '已停止' : '已暂停',
      requires_user_confirmation: false,
      runtime_interrupted: true,
    },
    runtime_interruption: { status, boundary: 'after_model' },
  };
}
function ack(type = 'stop_run', effect = 'requested', runtime = 'in_flight', status = 'running') {
  return {
    type,
    session_id: 'session',
    run_id: 'run',
    event_id: 2,
    status: 'recorded',
    control_effect: effect,
    runtime_state: runtime,
    run_status: status,
  };
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let current: {
  state: ReturnType<typeof useChatWindowState>;
  run: ReturnType<typeof useRunAuthorAgent>;
  recovery: ReturnType<typeof useAgentRunRecovery>;
  onEvent: ReturnType<typeof useAgentStreamEvent>;
  controls: ReturnType<typeof useAgentRunControls>;
};
function Harness() {
  const state = useChatWindowState({
    projectPath: 'D:/book',
    currentFile: null,
    assistantSessionId: 7,
  });
  const recovery = useAgentRunRecovery(state, undefined);
  const onEvent = useAgentStreamEvent(state, recovery.refreshAgentRunRecovery);
  const run = useRunAuthorAgent(
    state,
    onEvent,
    recovery.updateAgentStatus,
    recovery.refreshAgentRunRecovery,
    undefined,
    'full',
  );
  const controls = useAgentRunControls(state, run, onEvent, recovery);
  current = { state, recovery, onEvent, run, controls };
  return null;
}
async function mount(status: 'running' | 'completed' | 'failed' = 'running') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness />));
  await act(async () => {
    current.state.agentRunIdRef.current = 'run';
    current.state.runStartConversationKeyRef.current = conversationKey('D:/book', 7, '');
    current.state.setAgentRun({ id: 'run', sessionId: 'session', goal: '检查', status, steps: [] });
    current.state.setAgentBusy(status === 'running');
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.clearAllMocks();
});

it.each(['stopped', 'paused'] as const)(
  'live and replay preserve %s instead of success',
  async (status) => {
    const value = interrupted(status);
    expect(statusFromAgentResult(value)).toBe(status);
    vi.mocked(sendAgentUserMessage).mockResolvedValue(value);
    await mount('completed');
    await act(async () => current.run('检查', 'agent'));
    expect(sendAgentUserMessage).toHaveBeenCalledOnce();
    expect(current.state.agentRun?.status).toBe(status);
    expect(current.state.agentBusy).toBe(false);
    const replay = reconstructAgentResultFromEvents(
      [
        {
          event_type: 'permission_required',
          payload: {
            assistant_session_id: 7,
            proposed_patch: {
              kind: 'file_revision',
              file_path: 'chapter.md',
              before: 'old',
              after: 'obsolete',
              requires_confirmation: false,
            },
          },
        },
        { event_type: 'agent_run_interrupted', payload: { execution_result: value } },
      ],
      { sessionId: 'session', runId: 'run' },
    );
    expect(replay).toEqual(value);
    await act(async () => current.recovery.applyResumedAgentResult(value));
    expect(current.state.agentRun?.status).toBe(status);
    expect(current.state.agentRun?.steps.some((step) => step.status === 'waiting')).toBe(false);
  },
);

it.each(['onStopRun', 'onPauseRun'] as const)(
  'requested %s keeps UI busy until settlement',
  async (method) => {
    await mount();
    vi.mocked(sendAgentControlMessage).mockResolvedValue(
      ack(method === 'onStopRun' ? 'stop_run' : 'pause_run'),
    );
    await act(async () => current.controls.agentRunControls[method]?.());
    expect(current.state.agentBusy).toBe(true);
    expect(current.state.agentRun?.status).toBe('running');
    expect(current.state.agentRun?.steps.at(-1)).toMatchObject({ status: 'running' });
    expect(current.state.agentRun?.steps.at(-1)?.detail).toContain('等待当前操作结束');
  },
);

it.each(['completed', 'failed'] as const)(
  'late ignored stop cannot overwrite %s',
  async (status) => {
    await mount(status);
    vi.mocked(sendAgentControlMessage).mockResolvedValue(
      ack('stop_run', 'ignored', 'settled', status),
    );
    await act(async () => current.controls.agentRunControls.onStopRun?.());
    expect(current.state.agentRun?.status).toBe(status);
    expect(current.state.agentBusy).toBe(false);
  },
);

it.each(['stopped', 'paused'] as const)(
  'applied settled ACK uses authoritative %s',
  async (status) => {
    await mount();
    await act(async () => current.onEvent(ack('stop_run', 'applied', 'settled', status)));
    expect(current.state.agentRun?.status).toBe(status);
    expect(current.state.agentBusy).toBe(false);
  },
);

it('an in-flight applied or legacy recorded ACK cannot pretend the worker stopped', async () => {
  await mount();
  await act(async () => current.onEvent(ack('stop_run', 'applied', 'in_flight', 'stopped')));
  expect(current.state.agentBusy).toBe(true);
  expect(current.state.agentRun?.status).toBe('running');
  await act(async () =>
    current.onEvent({
      type: 'stop_run',
      status: 'recorded',
      run_id: 'run',
      session_id: 'session',
      event_id: 3,
    }),
  );
  expect(current.state.agentBusy).toBe(true);
  expect(current.state.agentRun?.status).toBe('running');
});

it('a requested ACK arriving after terminal does not revive a completed run', async () => {
  await mount('completed');
  await act(async () => current.onEvent(ack()));
  expect(current.state.agentRun?.status).toBe('completed');
  expect(current.state.agentBusy).toBe(false);
});

it('ACK for another run cannot settle the active run', async () => {
  await mount();
  await act(async () =>
    current.onEvent({ ...ack('stop_run', 'applied', 'settled', 'stopped'), run_id: 'old-run' }),
  );
  expect(current.state.agentRun?.status).toBe('running');
  expect(current.state.agentBusy).toBe(true);
});

it('latest interrupted event cannot fall through to an older permission patch', () => {
  expect(() =>
    reconstructAgentResultFromEvents(
      [
        { event_type: 'permission_required', payload: { assistant_session_id: 7 } },
        { event_type: 'agent_run_interrupted', payload: {} },
      ],
      { sessionId: 'session', runId: 'run' },
    ),
  ).toThrow();
});

it.each([
  { runtime_interruption: undefined },
  { runtime_interruption: { status: 'completed', boundary: 'after_model' } },
  { runtime_interruption: { status: 'stopped', boundary: '' } },
  {
    agent_result: {
      summary: '已停止',
      requires_user_confirmation: false,
      runtime_interrupted: false,
    },
  },
  {
    agent_result: {
      summary: '已停止',
      requires_user_confirmation: true,
      runtime_interrupted: true,
    },
  },
])('rejects invalid interruption instead of reconstructing success: %j', (change) => {
  expect(() =>
    reconstructAgentResultFromEvents(
      [
        {
          event_type: 'agent_run_interrupted',
          payload: { execution_result: { ...interrupted('stopped'), ...change } },
        },
      ],
      { sessionId: 'session', runId: 'run' },
    ),
  ).toThrow();
});

it.each(['live', 'recovery'] as const)(
  '%s interrupted results never deliver an obsolete patch',
  async (path) => {
    const suggestions: unknown[] = [];
    const listener = (event: Event) => suggestions.push((event as CustomEvent).detail);
    window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, listener);
    const value: AgentResultMessage = {
      ...interrupted('stopped'),
      proposed_patch: {
        kind: 'file_revision',
        file_path: 'chapter.md',
        before: 'old',
        after: 'obsolete',
        requires_confirmation: false,
      },
    };
    try {
      await mount('completed');
      if (path === 'live') {
        vi.mocked(sendAgentUserMessage).mockResolvedValue(value);
        await act(async () => current.run('检查', 'agent'));
        expect(sendAgentUserMessage).toHaveBeenCalledOnce();
        expect(current.state.agentRun?.status).not.toBe('completed');
      } else {
        expect(() => current.recovery.applyResumedAgentResult(value)).toThrow();
      }
      expect(suggestions).toHaveLength(0);
    } finally {
      window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, listener);
    }
  },
);

it('real provider progress updates one running step without inventing streamed prose', async () => {
  await mount();
  const beforeMessages = current.state.messages;
  for (const [index, detail] of [
    '正在请求模型。',
    '模型请求等待重试。',
    '正在重新请求模型。',
  ].entries()) {
    await act(async () =>
      current.onEvent({
        type: 'agent_step',
        session_id: 'session',
        run_id: 'run',
        event_id: 10 + index,
        sequence: 10 + index,
        index: -1,
        step: 'agent.provider',
        status: 'running',
        detail,
      }),
    );
    expect(current.state.agentRun?.steps).toHaveLength(1);
    expect(current.state.agentRun?.steps[0]).toMatchObject({
      title: '模型请求',
      status: 'running',
      detail,
    });
    expect(current.state.agentBusy).toBe(true);
    expect(current.state.messages).toEqual(beforeMessages);
  }
});

it.each(['stopped', 'paused'] as const)(
  'real pending run stays busy through permission and requested control until %s',
  async (status) => {
    let finish!: (value: AgentResultMessage) => void;
    vi.mocked(sendAgentUserMessage).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await mount('completed');
    let pending!: Promise<void>;
    await act(async () => {
      pending = current.run('检查', 'agent');
    });
    expect(sendAgentUserMessage).toHaveBeenCalledOnce();
    const runId = current.state.agentRun!.id;
    await act(async () =>
      current.onEvent({
        type: 'permission_required',
        session_id: 'session',
        run_id: runId,
        event_id: 3,
        sequence: 3,
        permission_profile: 'ask',
        reason: '确认写回',
        proposed_patch: null,
        blocked_tool: 'file.revise',
        confirmation_action: 'approve_permission',
      }),
    );
    expect(current.state.agentBusy).toBe(true);
    vi.mocked(sendAgentControlMessage).mockResolvedValue({
      ...ack(status === 'stopped' ? 'stop_run' : 'pause_run'),
      run_id: runId,
    });
    await act(async () => {
      if (status === 'stopped') current.controls.agentRunControls.onStopRun?.();
      else current.controls.agentRunControls.onPauseRun?.();
    });
    expect(current.state.agentBusy).toBe(true);
    expect(current.state.agentRun?.status).not.toBe(status);
    await act(async () => {
      finish({ ...interrupted(status), run_id: runId });
      await pending;
    });
    expect(current.state.agentRun?.status).toBe(status);
    expect(current.state.agentBusy).toBe(false);
  },
);

it('same-batch terminal settlement followed by requested ACK cannot revive busy', async () => {
  await mount();
  await act(async () => {
    current.recovery.applyResumedAgentResult(interrupted('stopped'));
    current.onEvent(ack());
  });
  expect(current.state.agentRun?.status).toBe('stopped');
  expect(current.state.agentBusy).toBe(false);
});

it('late provider progress for a previous run cannot mutate current steps', async () => {
  await mount();
  await act(async () =>
    current.onEvent({
      type: 'agent_step',
      session_id: 'session',
      run_id: 'old-run',
      event_id: 9,
      sequence: 9,
      index: -1,
      step: 'agent.provider',
      status: 'running',
      detail: '正在请求模型。',
    }),
  );
  expect(current.state.agentRun?.steps).toEqual([]);
});

it('unresumable paused run remains stopped after diagnostic and replay, without a waiting step', async () => {
  await mount();
  await act(async () => current.recovery.applyResumedAgentResult(interrupted('paused')));
  vi.mocked(sendAgentControlMessage).mockResolvedValue({
    ...ack('resume_run', 'applied', 'settled', 'stopped'),
    resume_diagnostic: {
      kind: 'runtime_pending_call_resume',
      can_resume: false,
      resume_via_control_channel: false,
      requires_manual_restart: false,
      reason: 'no_pending_call',
      resume_strategy: 'start_new_message',
      reverted_status: 'stopped',
    },
  });
  await act(async () => current.controls.agentRunControls.onResumeRun?.());
  expect(current.state.agentRun?.status).toBe('stopped');
  expect(current.state.agentBusy).toBe(false);
  expect(current.state.agentRun?.steps.find((step) => step.id === 'resume')).toMatchObject({
    status: 'completed',
  });
  expect(current.state.messages.at(-1)?.content).toContain('本轮已停止');
  expect(current.state.messages.at(-1)?.content).toContain('重新发送');
  const replay = reconstructAgentResultFromEvents(
    [
      { event_type: 'agent_run_interrupted', payload: { execution_result: interrupted('paused') } },
      {
        event_type: 'agent_run_interrupted',
        payload: { execution_result: interrupted('stopped') },
      },
    ],
    { sessionId: 'session', runId: 'run' },
  );
  expect(replay).toEqual(interrupted('stopped'));
  await act(async () => current.recovery.applyResumedAgentResult(replay as AgentResultMessage));
  expect(current.state.agentRun?.status).toBe('stopped');
  expect(current.state.agentRun?.steps.some((step) => step.status === 'waiting')).toBe(false);
});

it.each(['partial', 'failed'] as const)(
  'stop preserves %s execution evidence and never redelivers the pending patch',
  async (status) => {
    const executionOutcome = {
      status,
      code: 'provider_connection',
      message: '后续模型请求失败，已完成结果已保留。',
    };
    const prior: AgentResultMessage = {
      ...interrupted('stopped'),
      runtime_interruption: undefined,
      agent_result: {
        summary: executionOutcome.message,
        requires_user_confirmation: true,
        execution_outcome: executionOutcome,
      },
      proposed_patch: {
        id: 'retained-patch',
        kind: 'file_revision',
        file_path: 'chapter.md',
        before: '原稿',
        after: '建议稿',
        requires_confirmation: true,
      },
    };
    const suggestions: unknown[] = [];
    const listener = (event: Event) => suggestions.push((event as CustomEvent).detail);
    window.addEventListener(APPLY_FILE_SUGGESTION_EVENT, listener);
    try {
      vi.mocked(sendAgentUserMessage).mockResolvedValue(prior);
      await mount('completed');
      await act(async () => current.run('检查', 'agent'));
      expect(current.state.agentRun?.status).toBe('waiting');
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0]).toMatchObject({ requiresConfirmation: true });
      const stopped: AgentResultMessage = {
        ...interrupted('stopped'),
        agent_result: {
          ...interrupted('stopped').agent_result,
          execution_outcome: executionOutcome,
        },
      };
      expect(statusFromAgentResult(stopped)).toBe('stopped');
      const replay = reconstructAgentResultFromEvents(
        [
          { event_type: 'permission_required', payload: { execution_result: prior } },
          { event_type: 'agent_run_interrupted', payload: { execution_result: stopped } },
        ],
        { sessionId: 'session', runId: 'run' },
      );
      expect(replay).toEqual(stopped);
      if (!replay || !isAgentResultMessage(replay)) throw new Error('missing interrupted replay');
      await act(async () => current.recovery.applyResumedAgentResult(replay));
      expect(current.state.agentRun?.status).toBe('stopped');
      expect(current.state.agentRun?.executionOutcome).toEqual(executionOutcome);
      expect(current.state.agentBusy).toBe(false);
      expect(suggestions).toHaveLength(1);
      expect(replay.proposed_patch).toBeNull();
    } finally {
      window.removeEventListener(APPLY_FILE_SUGGESTION_EVENT, listener);
    }
  },
);

it.each([
  { status: 'success', code: 'provider_connection', message: 'invalid status' },
  { status: 'partial', code: 'provider_connection' },
])('interruption does not bypass malformed execution evidence: %j', (executionOutcome) => {
  const value = {
    ...interrupted('stopped'),
    agent_result: { ...interrupted('stopped').agent_result, execution_outcome: executionOutcome },
  };
  expect(() =>
    reconstructAgentResultFromEvents(
      [{ event_type: 'agent_run_interrupted', payload: { execution_result: value } }],
      { sessionId: 'session', runId: 'run' },
    ),
  ).toThrow();
});
