import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  ExternalWritebackCoordinator,
  type CoordinatorPorts,
} from '../src/lib/external-writeback/coordinator';
import { ExternalWritebackProvider } from '../src/components/app/ExternalWritebackProvider';
import { ExternalWritebackPanel } from '../src/components/app/ExternalWritebackPanel';
import type { ExternalWriteback } from '../src/lib/api/managed-agent-host';
import type { AssistantSessionRecord } from '../src/lib/api/types';
import {
  useChatWindowState,
  type ChatWindowState,
} from '../src/components/chat-window/useChatWindowState';
import { useChatSessionContext } from '../src/components/chat-window/useChatSessionContext';
import { ChatWindowView } from '../src/components/chat-window/ChatWindowView';

const history = vi.hoisted(() => ({
  read: vi.fn<(id: number) => Promise<AssistantSessionRecord>>(),
}));
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('../src/lib/api-client', async (original) => ({
  ...(await original<typeof import('../src/lib/api-client')>()),
  getAssistantSession: history.read,
  listAssistantSessions: async () => [],
}));
vi.mock('../src/lib/project-context', async (original) => ({
  ...(await original<typeof import('../src/lib/project-context')>()),
  buildProjectIndex: async () => ({ files: [] }),
}));

function sessionRecord(id = 1, content: string[] = []): AssistantSessionRecord {
  return {
    id,
    title: `会话 ${id}`,
    task_type: 'chat',
    project_path: 'D:/book',
    blueprint_id: null,
    book_run_id: null,
    artifact_id: null,
    created_at: 'fixture',
    updated_at: 'fixture',
    messages: content.map((text, index) => ({
      id: index + 1,
      session_id: id,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: text,
      created_at: 'fixture',
      updated_at: 'fixture',
    })),
  };
}
beforeEach(() => {
  history.read.mockReset().mockImplementation(async (id) => sessionRecord(id));
});

let chatState: ChatWindowState;
const noop = () => {};
function Conversation({
  project = 'D:/book',
  sessionId = 1,
}: {
  project?: string;
  sessionId?: number | null;
}) {
  const props = { projectPath: project, currentFile: null, assistantSessionId: sessionId };
  const state = useChatWindowState(props);
  const context = useChatSessionContext(state, props);
  chatState = state;
  return (
    <div data-testid="right-chat-pane">
      <ChatWindowView
        state={state}
        {...props}
        layoutMode="balanced"
        onSetLayoutMode={undefined}
        onOpenObservatory={undefined}
        observatoryAttention={false}
        agentPermissionProfile="ask"
        onAgentPermissionProfileChange={noop}
        handleSelectSession={context.handleSelectSession}
        handleNewSession={noop}
        retryAssistantSessionLoad={context.retryAssistantSessionLoad}
        retryContextCandidates={noop}
        addExplicitContext={noop}
        togglePinnedContext={noop}
        handleSubmit={async () => {}}
        handleComposerSubmit={async () => {}}
        userMessageHistory={[]}
        retryLastFailedRun={noop}
        retryWritingRunSubscription={noop}
        agentRunControls={{}}
      />{' '}
    </div>
  );
}

function fixture() {
  const config = {
    baseUrl: 'http://api',
    apiKey: 'synthetic',
    managedHostGeneration: 'a'.repeat(64),
    executionProtocols: ['external_writeback_v1'] as const,
  };
  let wait: ExternalWriteback = {
    protocol: 'external_writeback_v1',
    run_id: 'original',
    session_id: 'session',
    assistant_session_id: 1,
    wait_id: 'wait',
    revision: 2,
    stage: 'await_authorization',
    run_status: 'paused',
    runtime_state: 'settled',
    event_sequence: 3,
    event_id: 3,
    project_path: 'D:/book',
    requested_path: 'chapter.md',
    raw_before: 'old',
    before_hash: '0'.repeat(64),
    after_hash: '1'.repeat(64),
    operation_key: 'patch:whole',
    source: 'frozen',
    proposal: { id: 'patch', before: 'old', after: 'new', requires_confirmation: false },
    identity: null,
    decision: null,
    observation: null,
    historical_applied: false,
    feedback_consumed: false,
    delivery_complete: false,
    permission_profile: 'auto',
    continuation_available: false,
  };
  const prepare = vi.fn();
  const reconcile = vi.fn();
  const describe = vi.fn();
  const recover = vi.fn(async () => {
    wait = { ...wait, revision: 3, event_sequence: 4, continuation_available: true };
    return {
      writeback: wait,
      mode: 'await_confirmation' as const,
      execution_epoch: 'e'.repeat(32),
    };
  });
  const ports: CoordinatorPorts = {
    config: async () => ({ ...config, executionProtocols: [...config.executionProtocols] }),
    capabilities: async () => ({
      execution_protocols: ['external_writeback_v1'],
      managed_host_generation: config.managedHostGeneration,
      disabled_reason: null,
    }),
    read: async () => wait,
    prepare,
    reconcile,
    describe,
    profile: () => 'auto',
    result: async () => null,
    list: async () => ({
      items: [
        {
          run_id: wait.run_id,
          session_id: wait.session_id,
          wait_id: wait.wait_id,
          revision: wait.revision,
          event_sequence: wait.event_sequence,
          requested_path: wait.requested_path,
          stage: wait.stage,
          run_status: wait.run_status,
          historical_applied: false,
          blocked_reason: null,
        },
      ],
      next_after_id: null,
    }),
    recover,
  };
  return {
    coordinator: new ExternalWritebackCoordinator(ports),
    ports,
    recover,
    prepare,
    reconcile,
    describe,
  };
}

it('mounted cold discovery and recovery never auto-approve even on auto project', async () => {
  const f = fixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ExternalWritebackProvider project="D:/book" coordinator={f.coordinator}>
          <ExternalWritebackPanel
            project="D:/book"
            assistantSessionId={1}
            coordinator={f.coordinator}
          />
        </ExternalWritebackProvider>,
      ),
    );
    expect(f.coordinator.getSnapshot()).toHaveLength(1);
    const key = f.coordinator.getSnapshot()[0]!.key;
    expect(f.coordinator.getSnapshot()[0]!.live).toBe(false);
    await act(async () => f.coordinator.recover(key));
    expect(f.recover).toHaveBeenCalledWith(expect.anything(), 'original', 'wait', {
      session_id: 'session',
      expected_revision: 2,
      expected_event_sequence: 3,
      permission_profile: 'auto',
    });
    expect(f.coordinator.getSnapshot()[0]!.live).toBe(true);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.reconcile).not.toHaveBeenCalled();
    expect(f.describe).not.toHaveBeenCalled();
    expect(container.textContent).toContain('接受整版并继续');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('A to B to A while recovery is pending cannot revive old page authority', async () => {
  const f = fixture();
  f.coordinator.setProject('D:/book');
  await f.coordinator.discover('D:/book');
  let finish!: (value: Awaited<ReturnType<NonNullable<CoordinatorPorts['recover']>>>) => void;
  f.ports.recover = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const key = f.coordinator.getSnapshot()[0]!.key;
  const operation = f.coordinator.recover(key);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  f.coordinator.setProject('D:/other');
  f.coordinator.setProject('D:/book');
  finish({
    writeback: {
      ...f.coordinator.getSnapshot()[0]!.wait!,
      revision: 3,
      event_sequence: 4,
      continuation_available: true,
    },
    mode: 'await_confirmation',
    execution_epoch: 'e'.repeat(32),
  });
  await operation;
  expect(f.coordinator.getSnapshot()[0]!.live).toBe(false);
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.describe).not.toHaveBeenCalled();
});

it('ACK loss and closing never dispatch a native writer or request continuation', async () => {
  const f = fixture();
  f.coordinator.setProject('D:/book');
  await f.coordinator.discover('D:/book');
  f.recover.mockRejectedValueOnce(new Error('ACK lost'));
  const key = f.coordinator.getSnapshot()[0]!.key;
  await f.coordinator.recover(key);
  expect(f.coordinator.getSnapshot()[0]!.live).toBe(false);
  f.coordinator.beginClose();
  await f.coordinator.recover(key);
  expect(f.recover).toHaveBeenCalledTimes(1);
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.reconcile).not.toHaveBeenCalled();
});

it('historical delivery stays idle through read-only refresh and explicit qualification', async () => {
  const f = fixture();
  f.coordinator.setProject('D:/book');
  await f.coordinator.discover('D:/book');
  const key = f.coordinator.getSnapshot()[0]!.key;
  let current: ExternalWriteback = {
    ...f.coordinator.getSnapshot()[0]!.wait!,
    stage: 'claimed',
    historical_applied: true,
    feedback_consumed: true,
    delivery_complete: true,
  };
  f.ports.read = async () => current;
  await f.coordinator.refresh(key);
  expect(f.coordinator.getSnapshot()[0]!.phase).toBe('waiting');
  expect(f.coordinator.getSnapshot()[0]!.live).toBe(false);
  f.recover.mockImplementation(async () => {
    current = { ...current, revision: 3, event_sequence: 4, continuation_available: true };
    return { writeback: current, mode: 'continue_verified', execution_epoch: 'e'.repeat(32) };
  });
  await f.coordinator.recover(key);
  await f.coordinator.refresh(key);
  expect(f.coordinator.getSnapshot()[0]!.phase).toBe('waiting');
  expect(f.coordinator.getSnapshot()[0]!.live).toBe(true);
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.reconcile).not.toHaveBeenCalled();
  expect(f.describe).not.toHaveBeenCalled();
});

it('mounted continuation polls an accepted paused dispatch without sending a second POST', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ExternalWritebackProvider project="D:/book" coordinator={f.coordinator}>
          <ExternalWritebackPanel
            project="D:/book"
            assistantSessionId={1}
            coordinator={f.coordinator}
          />
        </ExternalWritebackProvider>,
      ),
    );
    const key = f.coordinator.getSnapshot()[0]!.key;
    let current = f.coordinator.getSnapshot()[0]!.wait!;
    const result = vi.fn<CoordinatorPorts['result']>().mockResolvedValue(null);
    f.ports.result = result;
    f.ports.read = async () => current;
    f.recover.mockImplementation(async () => {
      current = {
        ...current,
        revision: 3,
        event_sequence: 4,
        stage: 'receipt_ready',
        decision: 'approve',
        identity: {
          operationId: '2'.repeat(64),
          fingerprint: '3'.repeat(64),
          relativePath: 'chapter.md',
        },
        historical_applied: true,
        feedback_consumed: true,
        continuation_available: true,
      };
      return { writeback: current, mode: 'continue_verified', execution_epoch: 'e'.repeat(32) };
    });
    f.reconcile.mockImplementation(async (_config, _run, _wait, request) => {
      if (request.resume_intent === 'continue_current_execution') {
        current = { ...current, revision: 4, event_sequence: 5, delivery_complete: true };
      }
      return current;
    });
    await act(async () => f.coordinator.recover(key));
    const continuation = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('继续原运行（不重写）'),
    )!;
    const action = vi.spyOn(f.coordinator, 'continueVerified');
    await act(async () => {
      continuation.click();
      await action.mock.results[0]!.value;
    });
    expect(current.run_status).toBe('paused'); // HTTP returns before the background owner starts.
    expect(f.coordinator.getSnapshot()[0]!.phase).toBe('running');
    expect(continuation.disabled).toBe(true);
    expect(container.textContent).toContain('已请求继续原运行，正在核对结算');
    // Switching away from the conversation must not dispose the App-owned observer.
    await act(async () =>
      root.render(
        <ExternalWritebackProvider project="D:/book" coordinator={f.coordinator}>
          <span>另一个可见会话</span>
        </ExternalWritebackProvider>,
      ),
    );
    expect(container.querySelector('[aria-label="连续修订待办"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(f.coordinator.getSnapshot()[0]!.phase).toBe('running');
    expect(f.reconcile).toHaveBeenCalledTimes(2); // Observe + one explicit continuation, never a retry.
    current = { ...current, run_status: 'completed', continuation_available: false };
    result.mockResolvedValue({
      type: 'error',
      session_id: 'session',
      run_id: 'original',
      detail: 'fixture terminal',
    });
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(f.coordinator.getSnapshot()[0]!.phase).toBe('finished');
    expect(container.textContent).not.toContain('继续原运行');
    expect(f.reconcile).toHaveBeenCalledTimes(2);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.describe).not.toHaveBeenCalled();
    expect(f.recover).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});

it('keeps cold status in its conversation and opens only a scoped, deferrable decision dialog', async () => {
  const f = fixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (sessionId: number) =>
    root.render(
      <ExternalWritebackProvider project="D:/book" coordinator={f.coordinator}>
        <Conversation sessionId={sessionId} />
      </ExternalWritebackProvider>,
    );
  try {
    await act(async () => render(1));
    const panel = container.querySelector('[aria-label="连续修订待办"]');
    expect(panel).not.toBeNull();
    expect(panel?.closest('[data-testid="right-chat-pane"]')).not.toBeNull();
    expect(panel?.classList.contains('fixed')).toBe(false);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="agent-decision-defer"]')!.click(),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const key = f.coordinator.getSnapshot()[0]!.key;
    await act(async () => f.coordinator.refresh(key));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="agent-decision-open"]')!.click(),
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => render(2));
    expect(container.querySelector('[aria-label="连续修订待办"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => render(1));
    expect(container.querySelector('[aria-label="连续修订待办"]')).not.toBeNull();
    expect(f.recover).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.reconcile).not.toHaveBeenCalled();
    expect(f.describe).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('cold completion reloads the persisted original conversation exactly once without replay or fabricated messages', async () => {
  const f = fixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ExternalWritebackProvider project="D:/book" coordinator={f.coordinator}>
          <Conversation />
        </ExternalWritebackProvider>,
      ),
    );
    expect(history.read).toHaveBeenCalledTimes(1);
    history.read.mockResolvedValue(sessionRecord(1, ['原始请求', '真实持久完成回复']));
    f.ports.result = async () => ({
      type: 'error',
      session_id: 'session',
      run_id: 'original',
      detail: 'not a replacement for persisted history',
    });
    const key = f.coordinator.getSnapshot()[0]!.key;
    await act(async () => f.coordinator.refresh(key));
    expect(history.read).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('原始请求');
    expect(container.querySelector('[data-testid="assistant-message"]')?.textContent).toContain(
      '真实持久完成回复',
    );
    expect(container.textContent).not.toContain('not a replacement for persisted history');
    await act(async () => f.coordinator.refresh(key));
    expect(history.read).toHaveBeenCalledTimes(2);
    expect(f.recover).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.reconcile).not.toHaveBeenCalled();
    expect(f.describe).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('late cold-history read cannot overwrite another session or a newly submitted live conversation', async () => {
  const f = fixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (sessionId: number) =>
    root.render(
      <ExternalWritebackProvider project="D:/book" coordinator={f.coordinator}>
        <Conversation sessionId={sessionId} />
      </ExternalWritebackProvider>,
    );
  try {
    await act(async () => render(1));
    let finish!: (record: AssistantSessionRecord) => void;
    history.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.ports.result = async () => ({
      type: 'error',
      session_id: 'session',
      run_id: 'original',
      detail: 'finished',
    });
    await act(async () => f.coordinator.refresh(f.coordinator.getSnapshot()[0]!.key));
    await act(async () => render(2));
    await act(async () => finish(sessionRecord(1, ['旧请求', '迟到的旧回复'])));
    expect(container.textContent).not.toContain('迟到的旧回复');
    await act(async () => render(1));
    // An ordinary history read may already be in flight when the user submits a new run.
    history.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => chatState.setSessionLoadRetry((value) => value + 1));
    await act(async () => {
      chatState.agentRunIdRef.current = 'new-live-run';
      chatState.setAgentBusy(true);
      chatState.setMessages([{ role: 'user', content: '新一轮请求' }]);
    });
    await act(async () => finish(sessionRecord(1, ['旧请求', '迟到的旧回复'])));
    expect(container.textContent).toContain('新一轮请求');
    expect(container.textContent).not.toContain('迟到的旧回复');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('a live result callback owns its reply; persisted cold refresh does not replace or duplicate it', async () => {
  const f = fixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ExternalWritebackProvider project="D:/book" coordinator={f.coordinator}>
          <Conversation />
        </ExternalWritebackProvider>,
      ),
    );
    await act(async () =>
      chatState.setAgentRun({
        id: 'original',
        sessionId: 'session',
        goal: '原请求',
        status: 'waiting',
        steps: [],
      }),
    );
    const frame = f.coordinator.getSnapshot()[0]!.frame;
    const delivered = vi.fn(() =>
      chatState.setMessages([{ role: 'assistant', content: '页内最终回复' }]),
    );
    await act(async () => f.coordinator.track(frame, 'D:/book', delivered));
    f.ports.result = async () => ({
      type: 'error',
      session_id: 'session',
      run_id: 'original',
      detail: 'live terminal',
    });
    await act(async () => f.coordinator.refresh(f.coordinator.getSnapshot()[0]!.key));
    await act(async () => f.coordinator.refresh(f.coordinator.getSnapshot()[0]!.key));
    expect(history.read).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[data-testid="assistant-message"]')).toHaveLength(1);
    expect(container.textContent).toContain('页内最终回复');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('cold-history failure stays explicit and retries only the original history GET', async () => {
  const f = fixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <ExternalWritebackProvider project="D:/book" coordinator={f.coordinator}>
          <Conversation />
        </ExternalWritebackProvider>,
      ),
    );
    history.read.mockRejectedValueOnce(new Error('history unavailable'));
    f.ports.result = async () => ({
      type: 'error',
      session_id: 'session',
      run_id: 'original',
      detail: 'not durable text',
    });
    await act(async () => f.coordinator.refresh(f.coordinator.getSnapshot()[0]!.key));
    expect(
      container.querySelector('[data-testid="assistant-session-load-error"]')?.textContent,
    ).toContain('history unavailable');
    expect(container.querySelector('[data-testid="assistant-message"]')).toBeNull();
    history.read.mockResolvedValue(sessionRecord(1, ['原始请求', '恢复后的持久回复']));
    const retry = container.querySelector<HTMLButtonElement>(
      '[data-testid="assistant-session-load-retry"]',
    )!;
    await act(async () => retry.click());
    expect(container.querySelector('[data-testid="assistant-message"]')?.textContent).toContain(
      '恢复后的持久回复',
    );
    expect(history.read).toHaveBeenCalledTimes(3);
    expect(f.recover).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.reconcile).not.toHaveBeenCalled();
    expect(f.describe).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('assigning a persisted session to a live external wait must not erase the original user message', async () => {
  const f = fixture();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (sessionId: number | null) =>
    root.render(
      <ExternalWritebackProvider project="D:/book" coordinator={f.coordinator}>
        <Conversation sessionId={sessionId} />
      </ExternalWritebackProvider>,
    );
  try {
    await act(async () => render(null));
    await act(async () => {
      chatState.agentRunIdRef.current = 'original';
      chatState.selfPersistedSessionIdRef.current = 1;
      chatState.setAgentRun({
        id: 'original',
        sessionId: 'session',
        goal: '原请求',
        status: 'waiting',
        steps: [],
        executionProtocol: 'external_writeback_v1',
      });
      chatState.setMessages([{ role: 'user', content: '不能消失的原始请求' }]);
    });
    await act(async () => render(1));
    expect(history.read).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="user-message"]')?.textContent).toContain(
      '不能消失的原始请求',
    );
    expect(container.querySelector('[aria-label="连续修订待办"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
