import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useChatSessionContext } from '../src/components/chat-window/useChatSessionContext';
import { useAgentRunRecovery } from '../src/components/chat-window/useAgentRunRecovery';
import { MessageList } from '../src/components/chat-window/panels';
import { getAssistantSession, type AgentResultMessage } from '../src/lib/api-client';

vi.mock('../src/lib/api-client', async (original) => ({
  ...(await original<typeof import('../src/lib/api-client')>()),
  getAssistantSession: vi.fn(),
  listAssistantSessions: vi.fn().mockResolvedValue([]),
  getAgentRunSavePoints: vi.fn().mockRejectedValue(new Error('fixture')),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let current: {
  state: ReturnType<typeof useChatWindowState>;
  recovery: ReturnType<typeof useAgentRunRecovery>;
};
function Harness({ session = null }: { session?: number | null }) {
  const props = { projectPath: null, currentFile: null, assistantSessionId: session };
  const state = useChatWindowState(props);
  useChatSessionContext(state, props);
  const recovery = useAgentRunRecovery(state, undefined);
  current = { state, recovery };
  return (
    <MessageList
      messages={state.messages}
      agentRun={state.agentRun}
      agentRunRecovery={null}
      conversationScope="fixture"
    />
  );
}
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});
it.each(['streaming', 'settled', 'failed', 'partial'] as const)(
  'self-persisted history cannot overwrite %s text; recovery settles in place',
  async (phase) => {
    let resolveHistory!: (value: Awaited<ReturnType<typeof getAssistantSession>>) => void;
    vi.mocked(getAssistantSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
    await act(async () => {
      current.state.agentRunIdRef.current = 'r';
      current.state.setAgentRun({
        id: 'r',
        sessionId: 'r',
        goal: '原问题',
        status: 'running',
        steps: [],
      });
      current.state.setMessages([{ role: 'user', content: '原问题' }]);
      current.state.textStream.begin('r', () => true);
      current.state.textStream.accept({
        type: 'agent_text_stream_started',
        run_id: 'r',
        stream_id: 's',
        round_index: 1,
        chunk_sequence: 0,
      });
      current.state.textStream.accept({
        type: 'agent_text_delta',
        run_id: 'r',
        stream_id: 's',
        round_index: 1,
        chunk_sequence: 1,
        text_delta: '已收到的正文',
      });
      current.state.selfPersistedSessionIdRef.current = 7;
      root.render(<Harness session={7} />);
    });
    const result: AgentResultMessage = {
      type: 'agent_result',
      run_id: 'r',
      session_id: 'r',
      assistant_session_id: 7,
      user_message: '原问题',
      intent: 'chat.explain',
      plan: [],
      tool_trace: [],
      agent_result: {
        summary: '权威最终回复',
        requires_user_confirmation: false,
        ...(phase === 'failed' || phase === 'partial'
          ? {
              execution_outcome: {
                status: phase,
                code: 'fixture_failure',
                message: '执行未全部完成',
              },
            }
          : {}),
      },
    };
    const id = current.state.messages[1].id;
    const node = host.querySelector('[data-testid="assistant-message"]');
    if (phase !== 'streaming')
      await act(async () => current.recovery.applyResumedAgentResult(result));
    await act(async () =>
      resolveHistory({
        id: 7,
        title: 'IDE Agent: fixture',
        messages: [],
        book_id: null,
        created_at: '2026-10-02T00:00:00Z',
        updated_at: '2026-10-02T00:00:00Z',
      }),
    );
    expect(current.state.messages.map((message) => message.content)).toEqual([
      '原问题',
      phase !== 'streaming' ? '权威最终回复' : '已收到的正文',
    ]);
    await act(async () => {
      current.recovery.applyResumedAgentResult(result);
      current.recovery.applyResumedAgentResult(result);
    });
    expect(current.state.messages).toHaveLength(2);
    expect(current.state.messages[1].id).toBe(id);
    expect(current.state.messages[1].content).toBe('权威最终回复');
    expect(host.querySelector('[data-testid="assistant-message"]')).toBe(node);
    expect(host.querySelectorAll('[data-testid="assistant-message"]')).toHaveLength(1);
    expect(current.state.messages[1].stream?.detail).toBeUndefined();
    expect(current.state.agentRun?.status).toBe(
      phase === 'failed' || phase === 'partial' ? 'failed' : 'completed',
    );
  },
);

it.each(['completed', 'stopped', 'failed', 'paused'] as const)(
  'history starting after %s settlement preserves this page projection, but not after navigation',
  async (status) => {
    vi.mocked(getAssistantSession).mockImplementation(async (id) => ({
      id,
      title: 'IDE Agent: fixture',
      messages: [],
      book_id: null,
      created_at: '2026-10-02T00:00:00Z',
      updated_at: '2026-10-02T00:00:00Z',
    }));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
    await act(async () => {
      current.state.agentRunIdRef.current = 'r';
      current.state.setAgentRun({
        id: 'r',
        sessionId: 'r',
        goal: '原问题',
        status: 'running',
        steps: [],
      });
      current.state.setMessages([{ role: 'user', content: '原问题' }]);
      current.state.textStream.begin('r', () => true);
      current.state.textStream.accept({
        type: 'agent_text_stream_started',
        run_id: 'r',
        stream_id: 's',
        round_index: 1,
        chunk_sequence: 0,
      });
      current.state.textStream.accept({
        type: 'agent_text_delta',
        run_id: 'r',
        stream_id: 's',
        round_index: 1,
        chunk_sequence: 1,
        text_delta: '保留这段正文',
      });
      // Production result adoption + settlement share one React batch. The GET
      // starts only after this batch, so a revision-during-fetch guard cannot help.
      current.state.selfPersistedSessionIdRef.current = 7;
      current.state.textStream.settle(
        'r',
        status === 'completed'
          ? { kind: 'result', content: '权威收尾' }
          : { kind: 'diagnostic', detail: '中断原因' },
        status,
      );
      root.render(<Harness session={7} />);
    });
    expect(current.state.messages).toHaveLength(2);
    expect(current.state.messages[1]).toMatchObject({
      id: 'stream:r',
      content: status === 'completed' ? '权威收尾' : '保留这段正文',
      stream: { phase: status === 'completed' ? 'complete' : 'interrupted' },
    });
    expect(getAssistantSession).toHaveBeenCalledWith(7);
    await act(async () => root.render(<Harness session={8} />));
    await act(async () => root.render(<Harness session={7} />));
    expect(current.state.messages).toEqual([]);
  },
);
