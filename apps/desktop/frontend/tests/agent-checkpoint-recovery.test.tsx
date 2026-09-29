import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { RunActionBar } from '../src/components/chat-window/panels';
import { buildAgentRunRecoveryDisplay } from '../src/components/chat-window/recovery';
import { reconstructAgentResultFromEvents } from '../src/lib/api/agent-run-events';
import { displayFromResumeDiagnostic } from '../src/components/chat-window/resumed-result';
import { conversationKey } from '../src/components/chat-window/session-guard';
import { useAgentRunControls } from '../src/components/chat-window/useAgentRunControls';
import { useAgentRunRecovery } from '../src/components/chat-window/useAgentRunRecovery';
import { useAgentStreamEvent } from '../src/components/chat-window/useAgentStreamEvent';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import {
  getAgentRunSavePoints,
  getAgentRunEvents,
  sendAgentControlMessage,
  type AgentRunSavePointProjection,
} from '../src/lib/api-client';

vi.mock('../src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api-client')>()),
  sendAgentControlMessage: vi.fn(),
  getAgentRunSavePoints: vi.fn(),
  getAgentRunEvents: vi.fn(),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function diagnostic(reason = 'durable_checkpoint_ready') {
  const canResume = reason === 'durable_checkpoint_ready';
  return {
    kind: 'runtime_checkpoint_resume',
    artifact_id: 71,
    can_resume: canResume,
    reason,
    resume_strategy: canResume ? 'continue_checkpoint' : 'reconciliation_required',
    requires_manual_restart: false,
    resume_via_control_channel: canResume,
  };
}
function projection(reason = 'durable_checkpoint_ready'): AgentRunSavePointProjection {
  const checkpoint = diagnostic(reason);
  return {
    run_id: 'run',
    status: 'paused',
    current_step: 'runtime.recovery',
    save_points: [],
    pending: {},
    recoverability: {
      can_resume: checkpoint.can_resume,
      can_retry_from_checkpoint: false,
      resume_strategy: checkpoint.resume_strategy,
    },
    runtime_recovery: { checkpoint_resume: checkpoint },
    interruption_model: {},
  };
}
function controlAck() {
  return {
    type: 'resume_run',
    session_id: 'session',
    run_id: 'run',
    event_id: 8,
    status: 'recorded',
    control_effect: 'applied',
    runtime_state: 'in_flight',
    run_status: 'running',
  };
}
const runAuthorAgent = vi.fn(async () => undefined);
let host: HTMLDivElement;
let root: Root;
let current: {
  state: ReturnType<typeof useChatWindowState>;
  recovery: ReturnType<typeof useAgentRunRecovery>;
  controls: ReturnType<typeof useAgentRunControls>;
};
function Harness() {
  const state = useChatWindowState({
    projectPath: 'D:/synthetic-book',
    currentFile: null,
    assistantSessionId: 7,
  });
  const recovery = useAgentRunRecovery(state, undefined);
  const onEvent = useAgentStreamEvent(state, recovery.refreshAgentRunRecovery);
  const controls = useAgentRunControls(state, runAuthorAgent, onEvent, recovery);
  current = { state, recovery, controls };
  return (
    state.agentRun && (
      <RunActionBar
        run={state.agentRun}
        controls={controls.agentRunControls}
        recovery={state.agentRunRecovery}
        resumePending={state.agentBusy}
      />
    )
  );
}
async function mount(value = projection()) {
  vi.mocked(getAgentRunSavePoints).mockResolvedValue(value);
  vi.mocked(getAgentRunEvents).mockResolvedValue([
    { event_type: 'agent_run_interrupted', sequence: 10 },
  ]);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await act(async () => {
    current.state.agentRunIdRef.current = 'run';
    current.state.runStartConversationKeyRef.current = conversationKey('D:/synthetic-book', 7, '');
    current.state.setAgentRun({
      id: 'run',
      sessionId: 'session',
      goal: '检查合成章节',
      status: 'paused',
      steps: [],
    });
    await current.recovery.refreshAgentRunRecovery('run');
  });
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.resetAllMocks();
});

it('safe checkpoint is a same-run continuation, not a BookRun retry', () => {
  const display = buildAgentRunRecoveryDisplay(projection());
  expect(display?.checkpointResume?.canResume).toBe(true);
  expect(display?.canRetryFromCheckpoint).toBe(false);
  expect(display?.resumeText).toContain('同一运行');
  expect(display?.checkpointText).toContain('#71');
});
it.each([
  'tool_outcome_unknown',
  'model_outcome_unknown',
  'source_version_changed',
  'checkpoint_digest_mismatch',
  'terminal_checkpoint_requires_delivery_reconciliation',
  'future_reason',
])('savepoint and rejected ACK consistently require reconciliation: %s', (reason) => {
  const display = buildAgentRunRecoveryDisplay(projection(reason));
  const ackDisplay = displayFromResumeDiagnostic(diagnostic(reason));
  expect(display?.checkpointResume?.canResume).toBe(false);
  expect(display?.manualRestartRequired).toBe(false);
  expect(ackDisplay.status).toBe('paused');
  expect(ackDisplay.message).toBe(display?.resumeText);
  expect(ackDisplay.message).toContain('核对');
  expect(ackDisplay.message).toContain('不会自动重放');
  expect(ackDisplay.message).not.toContain('手动重启');
});
it('an incomplete new checkpoint contract cannot fall back to legacy resume', () => {
  const value = projection();
  delete value.recoverability.can_resume;
  delete value.runtime_recovery.checkpoint_resume;
  expect(buildAgentRunRecoveryDisplay(value)?.checkpointResume?.canResume).toBe(false);
});
it('an old permission/Brief wait does not inherit a non-resumable checkpoint restriction', () => {
  const value = projection('terminal_checkpoint_requires_delivery_reconciliation');
  value.current_step = 'permission.confirm';
  value.pending.permission_required = true;
  value.recoverability.resume_strategy = 'await_permission_decision';
  expect(buildAgentRunRecoveryDisplay(value)?.checkpointResume).toBeUndefined();
  expect(buildAgentRunRecoveryDisplay(value)?.resumeText).toBe('恢复：等待你确认');
});
it('clicking safe continuation sends resume_run for the same ID; accepted is not completed', async () => {
  await mount();
  vi.mocked(sendAgentControlMessage).mockResolvedValue(controlAck());
  const button = host.querySelector<HTMLButtonElement>('[data-testid="run-resume"]')!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(sendAgentControlMessage).toHaveBeenCalledExactlyOnceWith({
    sessionId: 'session',
    runId: 'run',
    type: 'resume_run',
    payload: { source: 'desktop.timeline' },
  });
  expect(runAuthorAgent).not.toHaveBeenCalled();
  expect(current.state.agentRun?.status).not.toBe('completed');
  expect(current.state.agentBusy).toBe(true);
});
it('unknown checkpoint disables the real button and the direct control handler', async () => {
  await mount(projection('tool_outcome_unknown'));
  const button = host.querySelector<HTMLButtonElement>('[data-testid="run-resume"]')!;
  expect(button.disabled).toBe(true);
  expect(host.textContent).toContain('核对');
  await act(async () => {
    button.click();
    current.controls.agentRunControls.onResumeRun();
  });
  expect(sendAgentControlMessage).not.toHaveBeenCalled();
  expect(runAuthorAgent).not.toHaveBeenCalled();
});
it('a rejection after an earlier safe projection immediately removes the replay action', async () => {
  await mount();
  vi.mocked(getAgentRunSavePoints).mockRejectedValue(new Error('projection unavailable'));
  vi.mocked(sendAgentControlMessage).mockResolvedValue({
    ...controlAck(),
    runtime_state: 'settled',
    run_status: 'paused',
    resume_diagnostic: diagnostic('source_version_changed'),
  });
  await act(async () => current.controls.agentRunControls.onResumeRun());
  expect(current.state.agentRun?.status).toBe('paused');
  expect(current.state.agentBusy).toBe(false);
  expect(host.querySelector<HTMLButtonElement>('[data-testid="run-resume"]')?.disabled).toBe(true);
  expect(current.state.messages.at(-1)?.content).toContain('核对');
});
it('a resumed terminal result settles the same run and refreshes its savepoint', async () => {
  await mount();
  const value = { ...projection(), status: 'completed' };
  value.recoverability.can_resume = false;
  value.recoverability.resume_strategy = 'none';
  vi.mocked(getAgentRunSavePoints).mockResolvedValue(value);
  vi.mocked(sendAgentControlMessage).mockResolvedValue({
    ...controlAck(),
    runtime_state: 'settled',
    run_status: 'completed',
    resumed_result: {
      type: 'agent_result',
      session_id: 'session',
      run_id: 'run',
      assistant_session_id: 7,
      intent: 'chat.explain',
      user_message: '检查合成章节',
      plan: [],
      tool_trace: [],
      proposed_patch: null,
      agent_result: { summary: '合成检查完成', requires_user_confirmation: false },
    },
  });
  await act(async () => current.controls.agentRunControls.onResumeRun());
  expect(current.state.agentRun?.id).toBe('run');
  expect(current.state.agentRun?.status).toBe('completed');
  expect(current.state.agentBusy).toBe(false);
  expect(host.querySelector('[data-testid="run-resume"]')).toBeNull();
  expect(getAgentRunSavePoints).toHaveBeenLastCalledWith('run');
});

it('in-flight checkpoint waits for worker settlement instead of offering recovery', async () => {
  const value = projection('execution_in_flight');
  value.recoverability.resume_strategy = 'await_settlement';
  value.runtime_recovery.checkpoint_resume = {
    ...diagnostic('execution_in_flight'),
    resume_strategy: 'await_settlement',
  };
  await mount(value);
  expect(host.querySelector<HTMLButtonElement>('[data-testid="run-resume"]')?.disabled).toBe(true);
  expect(host.textContent).toContain('等待执行结算');
  await act(async () =>
    current.recovery.applyResumeDiagnostic({
      ...diagnostic('execution_in_flight'),
      resume_strategy: 'await_settlement',
    }),
  );
  expect(current.state.agentBusy).toBe(true);
  expect(current.state.agentRun?.status).toBe('paused');
});
it('double click while resume HTTP is pending never dispatches twice', async () => {
  await mount();
  let resolve!: (value: ReturnType<typeof controlAck>) => void;
  vi.mocked(sendAgentControlMessage).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => {
    current.controls.agentRunControls.onResumeRun();
    current.controls.agentRunControls.onResumeRun();
  });
  expect(sendAgentControlMessage).toHaveBeenCalledOnce();
  expect(host.querySelector<HTMLButtonElement>('[data-testid="run-resume"]')?.disabled).toBe(true);
  await act(async () => resolve(controlAck()));
});
it('lost resume response remains unknown, never replays or declares the worker settled', async () => {
  await mount();
  vi.mocked(sendAgentControlMessage).mockRejectedValue(new Error('response lost'));
  await act(async () => current.controls.agentRunControls.onResumeRun());
  expect(current.state.agentBusy).toBe(true);
  expect(current.state.agentRun?.status).not.toBe('completed');
  expect(current.state.messages.at(-1)?.content).toContain('不能判定执行是否结束');
  expect(host.querySelector<HTMLButtonElement>('[data-testid="run-resume"]')?.disabled).toBe(true);
  await act(async () => current.controls.agentRunControls.onResumeRun());
  expect(sendAgentControlMessage).toHaveBeenCalledOnce();
  expect(runAuthorAgent).not.toHaveBeenCalled();
});
it('parked backend interruption wins over earlier permission results without redelivering a patch', async () => {
  await mount();
  const parked = {
    type: 'agent_result' as const,
    session_id: 'session',
    run_id: 'run',
    assistant_session_id: 7,
    intent: 'chat.explain',
    user_message: '',
    plan: [],
    tool_trace: [],
    proposed_patch: null,
    agent_result: {
      summary: '本轮已暂停',
      requires_user_confirmation: false,
      runtime_interrupted: true,
    },
    runtime_interruption: { status: 'paused' as const, boundary: 'worker_settled' },
    runtime_recovery: {
      reason: 'tool_outcome_unknown',
      can_resume: false,
      resume_strategy: 'reconciliation_required',
    },
  };
  const result = reconstructAgentResultFromEvents(
    [
      { event_type: 'permission_required', payload: { proposed_patch: { after: 'obsolete' } } },
      {
        event_type: 'agent_run_interrupted',
        payload: { execution_result: parked, runtime_state: 'settled', run_status: 'paused' },
      },
    ],
    { runId: 'run', sessionId: 'session' },
  );
  expect(result).toEqual(parked);
  await act(async () => current.recovery.applyResumedAgentResult(parked));
  expect(current.state.agentRun?.status).toBe('paused');
  expect(host.querySelector<HTMLButtonElement>('[data-testid="run-resume"]')?.disabled).toBe(true);
  expect(current.state.agentRun?.steps.some((step) => step.id === 'approval')).toBe(false);
});

function completedEvent(sequence = 13) {
  return {
    event_type: 'agent_run_completed',
    sequence,
    payload: {
      assistant_session_id: 7,
      summary: '核对取回的新结果',
      requires_user_confirmation: false,
    },
  };
}
async function loseResumeResponse() {
  vi.mocked(sendAgentControlMessage).mockRejectedValue(new Error('lost ACK'));
  await act(async () => current.controls.agentRunControls.onResumeRun());
}
async function clickReconcile() {
  const button = host.querySelector<HTMLButtonElement>('[data-testid="run-reconcile"]');
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}
it('read-only reconcile button delivers only a fresh terminal and releases busy once', async () => {
  await mount();
  await loseResumeResponse();
  vi.mocked(getAgentRunEvents).mockResolvedValue([
    {
      event_type: 'permission_required',
      sequence: 9,
      payload: { assistant_session_id: 7, summary: '旧结果' },
    },
    { event_type: 'agent_execution_started', sequence: 12 },
    completedEvent(),
  ]);
  vi.mocked(getAgentRunSavePoints).mockResolvedValue({
    ...projection(),
    status: 'completed',
    recoverability: { resume_strategy: 'none' },
  });
  await clickReconcile();
  expect(current.state.agentBusy).toBe(false);
  expect(current.state.agentRun?.status).toBe('completed');
  expect(current.state.messages.filter((m) => m.content === '核对取回的新结果')).toHaveLength(1);
  await act(async () => current.controls.agentRunControls.onReconcileRun?.());
  expect(current.state.messages.filter((m) => m.content === '核对取回的新结果')).toHaveLength(1);
  expect(sendAgentControlMessage).toHaveBeenCalledOnce();
  expect(runAuthorAgent).not.toHaveBeenCalled();
});
it('an older permission or pause cannot settle the lost resume response', async () => {
  await mount();
  await loseResumeResponse();
  vi.mocked(getAgentRunEvents).mockResolvedValue([
    {
      event_type: 'permission_required',
      sequence: 9,
      payload: { assistant_session_id: 7, summary: '旧许可' },
    },
    { event_type: 'agent_run_interrupted', sequence: 10 },
  ]);
  await clickReconcile();
  expect(current.state.agentRun?.status).toBe('paused');
  expect(current.state.agentRunRecovery?.checkpointResume?.canResume).toBe(false);
  expect(current.state.messages.some((m) => m.content === '旧许可')).toBe(false);
  // Local observation has returned; uncertainty stays explicit, not an endless UI spinner.
  expect(current.state.agentBusy).toBe(false);
  expect(host.textContent).toContain('尚未找到本次请求的新结算');
  expect(sendAgentControlMessage).toHaveBeenCalledOnce();
});
it('a new worker start prevents the decoder from falling back to a previous terminal', () => {
  expect(
    reconstructAgentResultFromEvents(
      [completedEvent(10), { event_type: 'agent_execution_started', sequence: 12 }],
      { runId: 'run', sessionId: 'session' },
    ),
  ).toBeNull();
});
it('readback arriving before the control ACK cannot deliver the result twice', async () => {
  await mount();
  let finish!: (value: Awaited<ReturnType<typeof sendAgentControlMessage>>) => void;
  vi.mocked(sendAgentControlMessage).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => current.controls.agentRunControls.onResumeRun());
  vi.mocked(getAgentRunEvents).mockResolvedValue([completedEvent()]);
  await clickReconcile();
  expect(current.state.messages.filter((m) => m.content === '核对取回的新结果')).toHaveLength(1);
  await act(async () =>
    finish({
      ...controlAck(),
      runtime_state: 'settled',
      run_status: 'completed',
      resumed_result: {
        type: 'agent_result',
        session_id: 'session',
        run_id: 'run',
        assistant_session_id: 7,
        intent: 'chat.explain',
        user_message: '',
        plan: [],
        tool_trace: [],
        proposed_patch: null,
        agent_result: { summary: '核对取回的新结果', requires_user_confirmation: false },
      },
    }),
  );
  expect(current.state.messages.filter((m) => m.content === '核对取回的新结果')).toHaveLength(1);
});
it('unanswered GET is bounded and a later explicit reconciliation can finish', async () => {
  await mount();
  await loseResumeResponse();
  vi.useFakeTimers();
  try {
    vi.mocked(getAgentRunEvents).mockImplementationOnce(() => new Promise(() => {}));
    await clickReconcile();
    await act(async () => vi.advanceTimersByTimeAsync(20_000));
    expect(current.state.messages.at(-1)?.content).toContain('核对本轮失败');
    vi.mocked(getAgentRunEvents).mockResolvedValue([completedEvent()]);
    await clickReconcile();
    expect(current.state.agentRun?.status).toBe('completed');
    expect(current.state.agentBusy).toBe(false);
    expect(sendAgentControlMessage).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
it('late reconciliation after switching session cannot mutate the new session', async () => {
  await mount();
  await loseResumeResponse();
  let finish!: (value: Awaited<ReturnType<typeof getAgentRunEvents>>) => void;
  vi.mocked(getAgentRunEvents).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await clickReconcile();
  await act(async () => {
    current.state.assistantSessionIdRef.current = 8;
  });
  await act(async () => finish([completedEvent()]));
  expect(current.state.messages.some((m) => m.content === '核对取回的新结果')).toBe(false);
  expect(current.state.agentRun?.status).toBe('paused');
});

it('a conflicting checkpoint diagnostic cannot be enabled by a stale top-level boolean', () => {
  const value = projection();
  value.runtime_recovery.checkpoint_resume = diagnostic('tool_outcome_unknown');
  expect(buildAgentRunRecoveryDisplay(value)?.checkpointResume?.canResume).toBe(false);
});
it('reading the pre-dispatch boundary fails closed without a control POST', async () => {
  await mount();
  vi.mocked(getAgentRunEvents).mockRejectedValueOnce(new Error('events unavailable'));
  await act(async () => current.controls.agentRunControls.onResumeRun());
  expect(sendAgentControlMessage).not.toHaveBeenCalled();
  expect(current.state.agentBusy).toBe(false);
});
it('switching session while reading the dispatch boundary prevents the control POST', async () => {
  await mount();
  let finish!: (value: Awaited<ReturnType<typeof getAgentRunEvents>>) => void;
  vi.mocked(getAgentRunEvents).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => current.controls.agentRunControls.onResumeRun());
  await act(async () => {
    current.state.assistantSessionIdRef.current = 8;
  });
  await act(async () => finish([]));
  expect(sendAgentControlMessage).not.toHaveBeenCalled();
});
it('mismatched savepoint ownership cannot deliver even a new terminal', async () => {
  await mount();
  await loseResumeResponse();
  vi.mocked(getAgentRunEvents).mockResolvedValue([completedEvent()]);
  vi.mocked(getAgentRunSavePoints).mockResolvedValue({ ...projection(), run_id: 'foreign-run' });
  await clickReconcile();
  expect(current.state.messages.some((m) => m.content === '核对取回的新结果')).toBe(false);
  expect(current.state.messages.at(-1)?.content).toContain('归属不匹配');
});
it('a fresh unknown interruption takes precedence over an older safe savepoint response', async () => {
  await mount();
  await loseResumeResponse();
  const result = {
    type: 'agent_result' as const,
    session_id: 'session',
    run_id: 'run',
    assistant_session_id: 7,
    intent: 'chat.explain',
    user_message: '',
    plan: [],
    tool_trace: [],
    proposed_patch: null,
    agent_result: {
      summary: '本轮已暂停',
      requires_user_confirmation: false,
      runtime_interrupted: true,
    },
    runtime_interruption: { status: 'paused' as const, boundary: 'worker_settled' },
    runtime_recovery: {
      reason: 'tool_outcome_unknown',
      can_resume: false,
      resume_strategy: 'reconciliation_required',
    },
  };
  vi.mocked(getAgentRunEvents).mockResolvedValue([
    { event_type: 'agent_run_interrupted', sequence: 13, payload: { execution_result: result } },
  ]);
  await clickReconcile();
  expect(current.state.agentBusy).toBe(false);
  expect(current.state.agentRunRecovery?.checkpointResume?.canResume).toBe(false);
  expect(host.textContent).toContain('工具调用结果（当前未知）');
});
it('legacy ChapterBrief resume keeps its payload and captures a read-only recovery boundary', async () => {
  const value = projection();
  value.current_step = 'chapter.brief.confirm';
  value.recoverability = { resume_strategy: 'await_permission_decision' };
  value.runtime_recovery = {};
  await mount(value);
  vi.mocked(sendAgentControlMessage).mockResolvedValue({
    ...controlAck(),
    runtime_state: 'settled',
    run_status: 'paused',
    resume_diagnostic: { reason: 'pending_call_ready', requires_manual_restart: false },
  });
  await act(async () =>
    current.controls.agentRunControls.onConfirmChapterBrief?.({
      briefId: 'brief-1',
      revision: 2,
      targetPath: 'chapter.md',
      chapterOrdinal: 1,
      chapterTitle: null,
      goal: '推进冲突',
      pov: null,
      setting: null,
      requiredBeats: ['冲突'],
      forbiddenItems: [],
      continuityConstraints: [],
      targetCharsMin: 1000,
      targetCharsMax: 2000,
    }),
  );
  expect(getAgentRunEvents).toHaveBeenCalledOnce();
  expect(sendAgentControlMessage).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      runId: 'run',
      sessionId: 'session',
      type: 'resume_run',
      payload: expect.objectContaining({
        chapter_brief: expect.objectContaining({
          brief_id: 'brief-1',
          revision: 2,
          required_beats: ['冲突'],
        }),
      }),
    }),
  );
});

it('a late rejected control response cannot undo a result already delivered by readback', async () => {
  await mount();
  let fail!: (error: Error) => void;
  vi.mocked(sendAgentControlMessage).mockImplementation(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  await act(async () => current.controls.agentRunControls.onResumeRun());
  vi.mocked(getAgentRunEvents).mockResolvedValue([completedEvent()]);
  await clickReconcile();
  await act(async () => fail(new Error('late transport failure')));
  expect(current.state.agentRun?.status).toBe('completed');
  expect(current.state.agentBusy).toBe(false);
  expect(current.state.messages.at(-1)?.content).toBe('核对取回的新结果');
});
