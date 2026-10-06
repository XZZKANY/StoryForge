import assert from 'node:assert/strict';
import { StrictMode, act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';

import type { AgentSocketMessage } from '../src/lib/api-client';
import {
  AUTHOR_LOOP_RESULT_EVENT,
  PATCH_REJECTED_EVENT,
  SUGGESTION_RESULT_EVENT,
} from '../src/lib/assistant-events';
import type { AgentRun, Message } from '../src/components/chat-window/types';
import { useAgentRunControls } from '../src/components/chat-window/useAgentRunControls';
import { useAgentStreamEvent } from '../src/components/chat-window/useAgentStreamEvent';
import { useChatSessionContext } from '../src/components/chat-window/useChatSessionContext';
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

let queuedRuns: string[] = [];
let queueHarnessApi: {
  state: ReturnType<typeof useChatWindowState>;
  submission: ReturnType<typeof useChatSubmission>;
} | null = null;

function QueueHarness({ assistantSessionId }: { assistantSessionId: number }) {
  const state = useChatWindowState({ projectPath, currentFile: null, assistantSessionId });
  const runAuthorAgent: RunAuthorAgent = async (instruction) => {
    queuedRuns.push(instruction);
    // 模拟真实 run：启动后重新置 busy，完成由测试显式释放。
    state.setAgentBusy(true);
  };
  const submission = useChatSubmission(state, runAuthorAgent, {
    projectPath,
    assistantSessionId,
    pendingInitialPrompt: null,
    onPendingInitialPromptConsumed: undefined,
  });
  queueHarnessApi = { state, submission };
  return (
    <>
      <output data-testid="queued-messages">
        {submission.queuedMessages.map((message) => message.content).join('|')}
      </output>
      <output data-testid="busy">{String(state.agentBusy)}</output>
    </>
  );
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

test('Agent 忙碌时只保留一条待发，第二条留在草稿且切会话清空待发', async () => {
  queuedRuns = [];
  queueHarnessApi = null;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<QueueHarness assistantSessionId={7} />));
    await act(async () => queueHarnessApi?.state.setAgentBusy(true));
    await act(async () => queueHarnessApi?.state.setInput('第一条'));
    await act(async () => queueHarnessApi?.submission.handleSubmit());
    await act(async () => queueHarnessApi?.state.setInput('第二条'));
    await act(async () => queueHarnessApi?.submission.handleSubmit());
    assert.equal(container.querySelector('[data-testid="queued-messages"]')?.textContent, '第一条');
    assert.equal(queueHarnessApi?.state.input, '第二条');
    await act(async () => queueHarnessApi?.state.setAgentBusy(false));
    assert.deepEqual(queuedRuns, ['第一条']);
    assert.equal(queueHarnessApi?.state.input, '第二条');
    assert.equal(container.querySelector('[data-testid="queued-messages"]')?.textContent, '');
    await act(async () => queueHarnessApi?.state.setAgentBusy(false));
    assert.deepEqual(queuedRuns, ['第一条']);
    await act(async () => queueHarnessApi?.state.setAgentBusy(true));
    await act(async () => queueHarnessApi?.submission.handleComposerSubmit('旧会话消息'));
    await act(async () => root.render(<QueueHarness assistantSessionId={8} />));
    assert.equal(container.querySelector('[data-testid="queued-messages"]')?.textContent, '');
    await act(async () => queueHarnessApi?.state.setAgentBusy(false));
    assert.deepEqual(queuedRuns, ['第一条']);
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

let newSessionApi: {
  handleNewSession: () => void;
  state: ReturnType<typeof useChatWindowState>;
} | null = null;

function NewSessionHarness() {
  const state = useChatWindowState({
    projectPath: null,
    currentFile: null,
    assistantSessionId: null,
  });
  const { handleNewSession } = useChatSessionContext(state, {
    projectPath: null,
    currentFile: null,
    assistantSessionId: null,
    onAssistantSessionChange: () => undefined,
  });
  newSessionApi = { handleNewSession, state };
  return (
    <output data-testid="messages">
      {state.messages.map((message) => message.content).join('|')}
    </output>
  );
}

test('UF-10：草稿态点新建会话清空残留的本地消息', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  newSessionApi = null;
  try {
    act(() => root.render(<NewSessionHarness />));
    assert.ok(newSessionApi);
    // 播种一条旧草稿消息（模拟未持久化的失败对话残留）。
    act(() =>
      newSessionApi?.state.setMessages([{ role: 'user', content: '旧草稿消息' }] as Message[]),
    );
    assert.equal(container.querySelector('[data-testid="messages"]')?.textContent, '旧草稿消息');
    // 点「新建会话」：draft→draft 时 assistantSessionId 恒 null、reset effect 不重跑。
    act(() => newSessionApi?.handleNewSession());
    // 修复前：handleNewSession 不清消息 → 旧消息残留到新 draft 之下。
    assert.equal(container.querySelector('[data-testid="messages"]')?.textContent, '');
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

/** W02：正文已写回但闭环记录未完成时，聊天文案不得宣称「闭环记录已生成」。 */
function AuthorLoopResultHarness({ onRender }: { onRender: (messages: Message[]) => void }) {
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
  useEffect(() => {
    onRender(state.messages);
  });
  return null;
}

test('W02：审计失败降级文案如实说明记录未完成，不宣称闭环已生成', () => {
  const seen: Message[][] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    act(() =>
      root.render(<AuthorLoopResultHarness onRender={(messages) => seen.push(messages)} />),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent(AUTHOR_LOOP_RESULT_EVENT, {
          detail: {
            filePath: 'D:/Books/story/正文/第01章.md',
            status: 'completed',
            action: 'revision_accepted',
            message: '正文已写入，但闭环记录未完成：请重试记录，不要重新应用补丁。',
            warning: '正文已写入，但闭环记录未完成：请重试记录，不要重新应用补丁。',
          },
        }),
      );
    });

    const last = seen.at(-1) ?? [];
    const content = last.map((message) => message.content).join('\n');
    assert.match(content, /正文已写回，但闭环记录未完成/);
    assert.doesNotMatch(content, /已写回正文，并生成闭环记录/);
    assert.match(content, /不要重新应用补丁/);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('W02 对照：记录齐全的正常完成仍宣称闭环完成', () => {
  const seen: Message[][] = [];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    act(() =>
      root.render(<AuthorLoopResultHarness onRender={(messages) => seen.push(messages)} />),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent(AUTHOR_LOOP_RESULT_EVENT, {
          detail: {
            filePath: 'D:/Books/story/正文/第01章.md',
            status: 'completed',
            action: 'revision_accepted',
            message: '修订已写回并记录闭环',
            recordPath: 'D:/Books/story/.storyforge/author-loop/x.md',
          },
        }),
      );
    });

    const last = seen.at(-1) ?? [];
    const content = last.map((message) => message.content).join('\n');
    assert.match(content, /已写回正文，并生成闭环记录/);
    assert.doesNotMatch(content, /闭环记录未完成/);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

for (const scenario of [
  'same-run',
  'older-run',
  'other-session',
  'other-project',
  'failed-run',
  'unconfirmed',
] as const) {
  test(`author writeback event preserves durable run and conversation ownership: ${scenario}`, () => {
    const statuses: string[] = [];
    const refreshAgentRunRecovery = vi.fn(async () => undefined);
    const messages: Message[][] = [];
    function BoundResultHarness() {
      const state = useChatWindowState({ projectPath, currentFile: null, assistantSessionId: 7 });
      useEffect(() => {
        state.agentRunIdRef.current = 'current-run';
      }, [state.agentRunIdRef]);
      useAgentRunControls(
        state,
        async () => undefined,
        () => undefined,
        {
          ...recoveryHandlers,
          refreshAgentRunRecovery,
          updateAgentStatus: (status) => statuses.push(status),
        },
      );
      useEffect(() => {
        messages.push(state.messages);
      });
      return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => root.render(<BoundResultHarness />));
      act(() =>
        window.dispatchEvent(
          new CustomEvent(AUTHOR_LOOP_RESULT_EVENT, {
            detail: {
              filePath: `${projectPath}/chapter.md`,
              status: 'completed',
              action: 'revision_accepted',
              message: 'verified audit',
              runId: scenario === 'older-run' ? 'older-run' : 'current-run',
              projectPath: scenario === 'other-project' ? 'D:/Other' : projectPath,
              assistantSessionId: scenario === 'other-session' ? 8 : 7,
              runStatus:
                scenario === 'unconfirmed'
                  ? undefined
                  : scenario === 'failed-run'
                    ? 'failed'
                    : 'completed',
            },
          }),
        ),
      );
      assert.deepEqual(
        statuses,
        scenario === 'same-run' ? ['completed'] : scenario === 'failed-run' ? ['failed'] : [],
      );
      assert.deepEqual(
        refreshAgentRunRecovery.mock.calls,
        scenario === 'same-run' || scenario === 'failed-run' ? [['current-run']] : [],
      );
      const text =
        messages
          .at(-1)
          ?.map((message) => message.content)
          .join('\n') ?? '';
      if (scenario === 'other-project' || scenario === 'other-session') assert.equal(text, '');
      else assert.match(text, /verified audit/);
      if (scenario === 'failed-run') assert.match(text, /不代表整轮成功/);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
}

for (const scenario of [
  'original',
  'other-run',
  'other-session',
  'other-project',
  'unconfirmed',
] as const) {
  test(`persisted rejection updates only its original visible run: ${scenario}`, () => {
    const statuses: string[] = [];
    const refreshAgentRunRecovery = vi.fn(async () => undefined);
    function RejectionHarness() {
      const state = useChatWindowState({ projectPath, currentFile: null, assistantSessionId: 7 });
      useEffect(() => {
        state.agentRunIdRef.current = 'original-run';
      }, [state.agentRunIdRef]);
      useAgentRunControls(
        state,
        async () => undefined,
        () => undefined,
        {
          ...recoveryHandlers,
          refreshAgentRunRecovery,
          updateAgentStatus: (status) => statuses.push(status),
        },
      );
      return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => root.render(<RejectionHarness />));
      act(() =>
        window.dispatchEvent(
          new CustomEvent(PATCH_REJECTED_EVENT, {
            detail: {
              filePath: `${projectPath}/chapter.md`,
              patchId: 'patch',
              direction: '',
              runId: scenario === 'other-run' ? 'other-run' : 'original-run',
              projectPath: scenario === 'other-project' ? 'D:/Other' : projectPath,
              assistantSessionId: scenario === 'other-session' ? 8 : 7,
              runStatus: scenario === 'unconfirmed' ? undefined : 'failed',
            },
          }),
        ),
      );
      assert.deepEqual(statuses, scenario === 'original' ? ['failed'] : []);
      assert.deepEqual(
        refreshAgentRunRecovery.mock.calls,
        scenario === 'original' ? [['original-run']] : [],
      );
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
}
