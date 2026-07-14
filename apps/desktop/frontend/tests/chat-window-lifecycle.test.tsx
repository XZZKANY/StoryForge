import assert from 'node:assert/strict';
import { StrictMode, act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';

import type { AgentSocketMessage } from '../src/lib/api-client';
import { AUTHOR_LOOP_RESULT_EVENT, SUGGESTION_RESULT_EVENT } from '../src/lib/assistant-events';
import type { AgentRun } from '../src/components/chat-window/types';
import { useAgentRunControls } from '../src/components/chat-window/useAgentRunControls';
import { useAgentStreamEvent } from '../src/components/chat-window/useAgentStreamEvent';
import { useChatSubmission } from '../src/components/chat-window/useChatSubmission';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import type { RunAuthorAgent } from '../src/components/chat-window/useRunAuthorAgent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const projectPath = 'D:/Books/story';

afterEach(() => {
  vi.restoreAllMocks();
});

function PendingPromptHarness({
  pendingInitialPrompt,
  onConsumed,
  runAuthorAgent,
}: {
  pendingInitialPrompt: string;
  onConsumed: () => void;
  runAuthorAgent: RunAuthorAgent;
}) {
  const state = useChatWindowState({
    projectPath,
    currentFile: null,
    assistantSessionId: null,
  });
  useChatSubmission(state, runAuthorAgent, {
    projectPath,
    pendingInitialPrompt,
    onPendingInitialPromptConsumed: onConsumed,
  });

  return <output data-testid="messages">{state.messages.map((message) => message.content)}</output>;
}

test('pendingInitialPrompt 在 effect 重跑时仍只消费并发送一次', async () => {
  const onConsumed = vi.fn();
  const runAuthorAgent = vi.fn<RunAuthorAgent>(async () => undefined);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const renderHarness = () =>
    root.render(
      <StrictMode>
        <PendingPromptHarness
          pendingInitialPrompt="检查第一章"
          onConsumed={onConsumed}
          runAuthorAgent={runAuthorAgent}
        />
      </StrictMode>,
    );

  try {
    await act(async () => {
      renderHarness();
      await Promise.resolve();
    });

    assert.equal(onConsumed.mock.calls.length, 1);
    assert.deepEqual(
      runAuthorAgent.mock.calls.map(([instruction]) => instruction),
      ['检查第一章'],
    );
    assert.equal(container.querySelector('[data-testid="messages"]')?.textContent, '检查第一章');

    await act(async () => {
      renderHarness();
      await Promise.resolve();
    });

    assert.equal(onConsumed.mock.calls.length, 1);
    assert.equal(runAuthorAgent.mock.calls.length, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

type StreamDispatch = (message: AgentSocketMessage) => void;

function StreamHarness({
  assistantSessionId,
  onDispatchReady,
}: {
  assistantSessionId: number;
  onDispatchReady: (dispatch: StreamDispatch) => void;
}) {
  const state = useChatWindowState({ projectPath, currentFile: null, assistantSessionId });
  const dispatch = useAgentStreamEvent(state, async () => undefined);

  useEffect(() => {
    const initialRun: AgentRun = {
      id: 'run-41',
      sessionId: 'run-41',
      goal: '检查第一章',
      status: 'running',
      steps: [],
    };
    state.setAgentRun(initialRun);
  }, [state.setAgentRun]);

  useEffect(() => onDispatchReady(dispatch), [dispatch, onDispatchReady]);

  return (
    <output data-testid="steps">{state.agentRun?.steps.map((step) => step.id).join(',')}</output>
  );
}

function stepEvent(index: number, step: string): AgentSocketMessage {
  return {
    type: 'agent_step',
    session_id: 'run-41',
    run_id: 'run-41',
    assistant_session_id: 41,
    index,
    step,
    detail: step,
    status: 'running',
  };
}

test('会话切换后旧 stream 事件不能写入当前 run 投影', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let dispatch: StreamDispatch | null = null;
  const onDispatchReady = (nextDispatch: StreamDispatch) => {
    dispatch = nextDispatch;
  };

  try {
    act(() => {
      root.render(<StreamHarness assistantSessionId={41} onDispatchReady={onDispatchReady} />);
    });
    assert.ok(dispatch);

    act(() => dispatch?.(stepEvent(0, 'old-session-first-step')));
    assert.equal(
      container.querySelector('[data-testid="steps"]')?.textContent,
      'plan-0-old-session-first-step',
    );

    act(() => {
      root.render(<StreamHarness assistantSessionId={42} onDispatchReady={onDispatchReady} />);
    });
    act(() => dispatch?.(stepEvent(1, 'stale-step-after-switch')));

    const projection = container.querySelector('[data-testid="steps"]')?.textContent ?? '';
    assert.match(projection, /old-session-first-step/);
    assert.doesNotMatch(projection, /stale-step-after-switch/);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

const recoveryHandlers = {
  updateAgentStep: () => undefined,
  updateAgentStatus: () => undefined,
  refreshAgentRunRecovery: async () => undefined,
  applyResumedAgentResult: () => undefined,
  applyResumeDiagnostic: () => undefined,
};

function EventListenerHarness() {
  const state = useChatWindowState({
    projectPath,
    currentFile: null,
    assistantSessionId: null,
  });
  useAgentRunControls(
    state,
    async () => undefined,
    () => undefined,
    recoveryHandlers,
  );
  return null;
}

test('ChatWindow run 结果事件监听器在卸载时以原回调移除', () => {
  const addEventListener = vi.spyOn(window, 'addEventListener');
  const removeEventListener = vi.spyOn(window, 'removeEventListener');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    act(() => root.render(<EventListenerHarness />));

    const trackedEvents = [SUGGESTION_RESULT_EVENT, AUTHOR_LOOP_RESULT_EVENT] as const;
    const registered = trackedEvents.map((eventName) =>
      addEventListener.mock.calls.find(([type]) => type === eventName),
    );
    assert.ok(registered.every(Boolean));

    act(() => root.unmount());

    trackedEvents.forEach((eventName, index) => {
      const listener = registered[index]?.[1];
      assert.ok(listener);
      assert.ok(
        removeEventListener.mock.calls.some(
          ([removedType, removedListener]) =>
            removedType === eventName && removedListener === listener,
        ),
      );
    });
  } finally {
    if (container.isConnected) {
      act(() => root.unmount());
      container.remove();
    }
  }
});
