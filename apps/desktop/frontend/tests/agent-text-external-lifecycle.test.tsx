import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useChatSessionContext } from '../src/components/chat-window/useChatSessionContext';
import { useExternalAgentConversation } from '../src/components/chat-window/useExternalAgentConversation';
import type { AgentSocketMessage, AgentRunWaitingMessage } from '../src/lib/api-client';

const coordinator = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../src/components/app/ExternalWritebackProvider', () => ({
  useExternalWritebackCoordinator: () => coordinator,
  useExternalWaits: () => [],
}));
vi.mock('../src/lib/api-client', async (original) => ({
  ...(await original<typeof import('../src/lib/api-client')>()),
  getAssistantSession: vi.fn(async (id: number) => ({ id, title: 'fixture', messages: [] })),
  listAssistantSessions: vi.fn(async () => []),
}));
vi.mock('../src/lib/project-context', async (original) => ({
  ...(await original<typeof import('../src/lib/project-context')>()),
  buildProjectIndex: vi.fn(async () => ({ files: [] })),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const status = vi.fn();
const refresh = vi.fn(async () => {});
let root: Root;
let host: HTMLDivElement;
let current: {
  state: ReturnType<typeof useChatWindowState>;
  external: ReturnType<typeof useExternalAgentConversation>;
  session: (value: number | null) => void;
};
function Harness({
  project = 'D:/book',
  initialSession = 7,
}: {
  project?: string;
  initialSession?: number | null;
}) {
  const [session, setSession] = useState(initialSession);
  const props = { projectPath: project, currentFile: null, assistantSessionId: session };
  const state = useChatWindowState(props);
  useChatSessionContext(state, props);
  const external = useExternalAgentConversation(state, status, refresh, setSession);
  current = { state, external, session: setSession };
  return null;
}
const wait: AgentRunWaitingMessage = {
  type: 'agent_run_waiting',
  protocol: 'external_writeback_v1',
  execution_epoch: 'live',
  run_id: 'run',
  session_id: 'run',
  assistant_session_id: 7,
  event_id: 2,
  sequence: 2,
  wait_id: 'wait',
  revision: 1,
  stage: 'await_authorization',
};
const result: AgentSocketMessage = {
  type: 'agent_result',
  run_id: 'run',
  session_id: 'run',
  assistant_session_id: 7,
  user_message: '原问题',
  intent: 'chat.explain',
  plan: [],
  tool_trace: [],
  agent_result: { summary: '最终回复', requires_user_confirmation: false },
};
async function begin(draft = false) {
  await act(async () => root.render(<Harness initialSession={draft ? null : 7} />));
  await act(async () => {
    current.state.agentRunIdRef.current = 'run';
    current.state.setAgentRun({
      id: 'run',
      sessionId: 'run',
      goal: '原问题',
      status: 'running',
      steps: [],
    });
    current.state.textStream.begin('run', () => true);
    current.state.textStream.accept({
      type: 'agent_text_stream_started',
      run_id: 'run',
      stream_id: 'stream',
      round_index: 1,
      chunk_sequence: 0,
    });
    current.state.textStream.accept({
      type: 'agent_text_delta',
      run_id: 'run',
      stream_id: 'stream',
      round_index: 1,
      chunk_sequence: 1,
      text_delta: '工具前预览',
    });
  });
}
async function track(owned = true) {
  await act(async () => {
    await current.external.handleWaiting(wait, {
      negotiated: true,
      project: 'D:/book',
      runId: 'run',
      owned,
    });
  });
  status.mockClear();
  refresh.mockClear();
  return coordinator.track.mock.calls.at(-1)?.[2] as
    | ((value: AgentSocketMessage) => void)
    | undefined;
}
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  coordinator.track.mockReset().mockResolvedValue(undefined);
  status.mockReset();
  refresh.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it.each(['session', 'project'])(
  'leaving and returning to the same %s never revives the old callback',
  async (kind) => {
    await begin();
    const deliver = await track();
    expect(deliver).toBeTypeOf('function');
    if (kind === 'session') {
      await act(async () => current.session(8));
      await act(async () => current.session(7));
    } else {
      await act(async () => root.render(<Harness project="D:/other" />));
      await act(async () => root.render(<Harness project="D:/book" />));
    }
    await act(async () => current.state.setMessages([{ role: 'assistant', content: '当前历史' }]));
    await act(async () => deliver?.(result));
    expect(current.state.messages.map((message) => message.content)).toEqual(['当前历史']);
    expect(status).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  },
);
it('an unowned wait is tracked without stealing a page-local result callback', async () => {
  await begin();
  expect(await track(false)).toBeUndefined();
  expect(coordinator.track).toHaveBeenCalledWith(wait, 'D:/book', undefined);
});
it('self-persisted draft keeps its preview and settles exactly once in place', async () => {
  await begin(true);
  const id = current.state.messages[0].id;
  const deliver = await track();
  expect(current.state.assistantSessionIdRef.current).toBe(7);
  await act(async () => {
    deliver?.(result);
    deliver?.(result);
  });
  expect(current.state.messages).toHaveLength(1);
  expect(current.state.messages[0]).toMatchObject({ id, content: '最终回复' });
  expect(status).toHaveBeenCalledTimes(1);
});
it.each(['unmount', 'new-run'])('old callback cannot affect %s', async (kind) => {
  await begin();
  const deliver = await track();
  if (kind === 'unmount') await act(async () => root.render(null));
  else
    await act(async () => {
      current.state.agentRunIdRef.current = 'next';
      current.state.textStream.begin('next', () => true);
    });
  await act(async () => deliver?.(result));
  expect(status).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
