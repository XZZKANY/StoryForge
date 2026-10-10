import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { useRunAuthorAgent } from '../src/components/chat-window/useRunAuthorAgent';
import { useAgentRunRecovery } from '../src/components/chat-window/useAgentRunRecovery';
import { useAgentStreamEvent } from '../src/components/chat-window/useAgentStreamEvent';
import { MessageList } from '../src/components/chat-window/panels';
import { isAgentTextFrame } from '../src/lib/api/agent-text-stream';
import type { AgentResultMessage } from '../src/lib/api-client';

vi.mock('../src/lib/api/config', async (original) => ({
  ...(await original<typeof import('../src/lib/api/config')>()),
  getApiConfig: vi.fn(async () => ({ baseUrl: 'http://fixture', apiKey: 'fixture' })),
}));
vi.mock('../src/lib/api-client', async (original) => ({
  ...(await original<typeof import('../src/lib/api-client')>()),
  getAgentRunEvents: vi.fn().mockResolvedValue([]),
  getAgentRunSavePoints: vi.fn().mockRejectedValue(new Error('no projection')),
}));
vi.mock('../src/lib/project-context', async (original) => ({
  ...(await original<typeof import('../src/lib/project-context')>()),
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

let root: Root;
let host: HTMLDivElement;
let controller: ReadableStreamDefaultController<Uint8Array>;
let current: {
  state: ReturnType<typeof useChatWindowState>;
  run: ReturnType<typeof useRunAuthorAgent>;
  onEvent: ReturnType<typeof useAgentStreamEvent>;
};
let pending: Promise<void>;
let finished = false;
let renderCount = 0;
let fetchMock: ReturnType<typeof vi.fn>;

function Harness({ project = 'D:/book' }: { project?: string }) {
  renderCount += 1;
  const state = useChatWindowState({
    projectPath: project,
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
    'read',
  );
  current = { state, run, onEvent };
  return (
    <MessageList
      messages={state.messages}
      agentRun={state.agentRun}
      agentRunRecovery={state.agentRunRecovery}
      conversationScope={project}
    />
  );
}
async function begin() {
  finished = false;
  fetchMock = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await act(async () => {
    pending = current.run('分析正文', 'agent');
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
}
const identity = (round = 1) => ({
  run_id: current.state.agentRunIdRef.current!,
  stream_id: 'stream-' + round,
  round_index: round,
});
async function emit(frame: object) {
  await act(async () => {
    controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(frame) + '\n\n'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function start(round = 1) {
  await emit({ type: 'agent_text_stream_started', ...identity(round), chunk_sequence: 0 });
}
async function delta(text: string, sequence: number, round = 1) {
  await emit({
    type: 'agent_text_delta',
    ...identity(round),
    chunk_sequence: sequence,
    text_delta: text,
  });
}
async function finish(
  summary = '最终回复',
  status?: 'stopped' | 'paused',
  result: Partial<AgentResultMessage['agent_result']> = {},
) {
  await emit({
    type: 'agent_result',
    session_id: current.state.agentRunIdRef.current,
    run_id: current.state.agentRunIdRef.current,
    assistant_session_id: 7,
    user_message: '分析正文',
    intent: 'chat.explain',
    plan: [],
    tool_trace: [],
    agent_result: {
      summary,
      requires_user_confirmation: false,
      runtime_interrupted: !!status,
      ...result,
    },
    ...(status ? { runtime_interruption: { status, boundary: 'after_model' } } : {}),
  });
  await act(async () => pending);
  finished = true;
}
afterEach(async () => {
  if (root && host.isConnected) {
    if (!finished) await finish();
    await act(async () => root.unmount());
    host.remove();
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('real SSE -> mounted owner renders before terminal, preserves nodes and reconciles final once', async () => {
  await begin();
  await start();
  expect(host.textContent).toContain('等待正文输出');
  const node = host.querySelector('[data-testid="assistant-message"]');
  await delta('第一段 **正', 1);
  expect(host.textContent).toContain('第一段');
  expect(current.state.agentBusy).toBe(true);
  await delta('文** 😀', 2);
  await delta('文** 😀', 2); // duplicate must not append
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(host.textContent).toContain('正文');
  expect(current.state.messages[0].content).toBe('第一段 **正文** 😀');
  expect(host.querySelector('[data-testid="assistant-message"]')).toBe(node);
  await start(2);
  await delta('工具后回复', 1, 2);
  await delta('尚未刷新', 2, 2);
  await finish('工具后的权威最终回复');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(host.querySelector('[data-testid="assistant-message"]')).toBe(node);
  expect(host.querySelectorAll('[data-testid="assistant-message"]')).toHaveLength(1);
  expect(current.state.messages[0].content).toBe('工具后的权威最终回复');
  expect(host.textContent).not.toContain('尚未刷新');
  expect(host.querySelector('[data-testid="stream-phase"]')).toBeNull();
});

it('stop is not settled on request, retains partial output and rejects late deltas', async () => {
  await begin();
  await start();
  await delta('保留已输出正文', 1);
  const ack = {
    type: 'stop_run',
    session_id: 's',
    run_id: current.state.agentRunIdRef.current!,
    event_id: 1,
    status: 'recorded',
    control_effect: 'requested',
    runtime_state: 'in_flight',
    run_status: 'running',
  };
  await act(async () => current.onEvent(ack));
  expect(current.state.agentBusy).toBe(true);
  await act(async () =>
    current.onEvent({
      ...ack,
      control_effect: 'applied',
      runtime_state: 'settled',
      run_status: 'stopped',
    }),
  );
  await delta('迟到内容', 2);
  await finish('已停止', 'stopped');
  expect(current.state.messages[0].content).toBe('保留已输出正文');
  expect(host.textContent).toContain('回复未完成');
  expect(host.textContent).not.toContain('迟到内容');
});

it('gaps stop preview instead of inventing text; final still reconciles', async () => {
  await begin();
  await start();
  await delta('可见片段', 1);
  await delta('缺号之后', 3);
  expect(host.textContent).toContain('等待核对');
  await act(async () =>
    current.onEvent({
      type: 'tool_trace',
      run_id: current.state.agentRunIdRef.current!,
      index: 0,
      trace: { tool_name: 'fs.read', status: 'completed', input_summary: {}, output_summary: {} },
    }),
  );
  expect(host.textContent).toContain('等待核对');
  await delta('后续也不能接', 4);
  expect(current.state.messages[0].content).toBe('可见片段');
  await finish('完整最终结果');
  expect(current.state.messages[0].content).toBe('完整最终结果');
});

it('navigation discards queued chunks and stale live/terminal delivery', async () => {
  await begin();
  await start();
  await delta('旧项目', 1);
  await delta('未刷新的旧片段', 2);
  await act(async () => root.render(<Harness project="D:/other" />));
  await act(async () => root.render(<Harness project="D:/book" />));
  await act(async () => current.state.setMessages([{ role: 'assistant', content: '新项目消息' }]));
  await delta('旧流又来了', 3);
  await finish('旧项目结算');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(current.state.messages.map((item) => item.content)).toEqual(['新项目消息']);
});

it.each(['completed', 'failed', 'partial'] as const)(
  'reader failure reconciles %s authoritative result by GET without replay',
  async (outcome) => {
    await begin();
    await start();
    await delta('网络中断前的正文', 1);
    let resolveRead!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveRead = resolve;
        }),
    );
    await act(async () => {
      controller.error(new TypeError('fixture disconnected'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('等待核对');
    expect(current.state.messages[0].content).toBe('网络中断前的正文');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 3100));
      resolveRead(
        Response.json([
          {
            event_type: outcome === 'completed' ? 'agent_run_completed' : 'agent_run_failed',
            payload: {
              assistant_session_id: 7,
              summary: '核对后的完整回复',
              requires_user_confirmation: false,
              ...(outcome !== 'completed'
                ? {
                    execution_result: {
                      type: 'agent_result',
                      run_id: current.state.agentRunIdRef.current,
                      session_id: current.state.agentRunIdRef.current,
                      assistant_session_id: 7,
                      user_message: '分析正文',
                      intent: 'chat.explain',
                      plan: [],
                      tool_trace: [],
                      agent_result: {
                        summary: '核对后的完整回复',
                        requires_user_confirmation: false,
                        execution_outcome: {
                          status: outcome,
                          code: 'fixture_failure',
                          message: '工具未全部完成',
                        },
                      },
                    },
                  }
                : {}),
            },
          },
        ]),
      );
      await pending;
    });
    finished = true;
    expect(current.state.messages).toHaveLength(1);
    expect(current.state.messages[0].content).toBe('核对后的完整回复');
    expect(current.state.agentRun?.status).toBe(outcome === 'completed' ? 'completed' : 'failed');
    expect(current.state.messages[0].stream?.detail).toBeUndefined();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls).toHaveLength(2);
  },
);

it('failed terminal flushes buffered text as incomplete, never as a successful answer', async () => {
  await begin();
  await start();
  await delta('已收到', 1);
  await delta('但尚未刷新', 2);
  await emit({
    type: 'error',
    run_id: current.state.agentRunIdRef.current,
    detail: 'provider unavailable',
  });
  await act(async () => pending);
  finished = true;
  expect(current.state.messages).toHaveLength(1);
  expect(current.state.messages[0].content).toBe('已收到但尚未刷新');
  expect(host.textContent).toContain('回复未完成');
  expect(host.textContent).toContain('provider unavailable');
  expect(current.state.agentRun?.status).toBe('failed');
});

it('decoder rejects malformed sequences, oversized chunks and non-text payloads', () => {
  const base = {
    type: 'agent_text_delta',
    run_id: 'r',
    stream_id: 's',
    round_index: 1,
    chunk_sequence: 1,
    text_delta: '正文',
  };
  expect(isAgentTextFrame(base)).toBe(true);
  for (const bad of [
    { chunk_sequence: 0 },
    { chunk_sequence: 1.5 },
    { round_index: -1 },
    { text_delta: {} },
    { text_delta: '字'.repeat(4097) },
    { stream_id: '' },
  ]) {
    expect(isAgentTextFrame({ ...base, ...bad })).toBe(false);
  }
});

it('permission waiting flushes pending text without claiming ongoing generation', async () => {
  await begin();
  await start();
  await delta('审批前正文', 1);
  await delta('尚未刷新的正文', 2);
  await act(async () =>
    current.onEvent({
      type: 'permission_required',
      run_id: current.state.agentRunIdRef.current!,
      session_id: current.state.agentRunIdRef.current!,
      event_id: 1,
      tool_name: 'file.revise',
      permission_request_id: 'request-1',
      proposed_patch: null,
    }),
  );
  expect(current.state.messages[0].content).toBe('审批前正文尚未刷新的正文');
  expect(host.textContent).toContain('等待下一步');
  expect(host.textContent).not.toContain('正在输出');
  expect(current.state.agentRun?.status).toBe('waiting');
  expect(current.state.agentBusy).toBe(true);
  await start(2);
  await delta('批准后的新轮回复', 1, 2);
  expect(host.textContent).toContain('正在输出');
  await finish('批准后的最终回复');
});

it('a burst of 100 deltas batches one paint and never turns正文 into a live region', async () => {
  await begin();
  await start();
  await delta('首段', 1);
  const node = host.querySelector('[data-testid="assistant-message"]');
  const status = host.querySelector('[data-testid="stream-phase"]');
  const phaseText = status?.textContent;
  const baseline = renderCount;
  vi.useFakeTimers();
  try {
    const frames = Array.from(
      { length: 100 },
      (_, index) =>
        'data: ' +
        JSON.stringify({
          type: 'agent_text_delta',
          ...identity(),
          chunk_sequence: index + 2,
          text_delta: '字',
        }) +
        '\n\n',
    ).join('');
    await act(async () => controller.enqueue(new TextEncoder().encode(frames)));
    expect(renderCount).toBe(baseline);
    await act(async () => vi.advanceTimersByTimeAsync(40));
    expect(renderCount).toBe(baseline + 1);
    expect(current.state.messages[0].content).toBe('首段' + '字'.repeat(100));
    expect(host.querySelector('[data-testid="assistant-message"]')).toBe(node);
    expect(host.querySelector('[data-testid="stream-phase"]')).toBe(status);
    expect(status?.textContent).toBe(phaseText);
    expect(status?.getAttribute('role')).toBe('status');
    expect(
      host
        .querySelector('[data-testid="assistant-markdown"]')
        ?.closest('[aria-live], [role="status"]'),
    ).toBeNull();
  } finally {
    vi.useRealTimers();
  }
  await finish();
});

it.each(['failed', 'partial'] as const)(
  'live %s execution outcome replaces preview with authoritative text without changing failure status',
  async (status) => {
    await begin();
    await start();
    await delta('流预览并非最终正文 ', 1);
    await delta('未刷新的预览尾巴', 2);
    const node = host.querySelector('[data-testid="assistant-message"]');
    const summary = '完整权威正文\n过滤后以此为准。';
    await finish(summary, undefined, {
      execution_outcome: { status, code: 'fixture_failure', message: '工具未全部完成' },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(current.state.messages[0].content).toBe(summary);
    expect(current.state.messages[0].stream).toEqual({
      runId: current.state.agentRunIdRef.current,
      phase: 'interrupted',
      detail: undefined,
    });
    expect(current.state.agentRun?.status).toBe('failed');
    expect(current.state.agentRun?.executionOutcome?.status).toBe(status);
    expect(host.querySelector('[data-testid="assistant-message"]')).toBe(node);
    expect(host.querySelectorAll('[data-testid="assistant-message"]')).toHaveLength(1);
    expect(host.textContent).not.toContain('流预览并非最终正文');
  },
);

it('failed review renders the authoritative formatted report instead of the model preview', async () => {
  await begin();
  await start();
  await delta('审稿前流预览', 1);
  await finish('权威审稿摘要', undefined, {
    execution_outcome: { status: 'partial', code: 'fixture_review', message: '部分审稿失败' },
    review_report: {
      mode: 'mixed',
      issues: [
        {
          id: 'plot-1',
          category: 'plot',
          message: '关键因果链缺失',
          suggested_action: '补足主动选择',
        },
      ],
    },
  });
  expect(current.state.messages[0].content).toContain('权威审稿摘要');
  expect(current.state.messages[0].content).toContain('关键因果链缺失');
  expect(current.state.messages[0].content).toContain('补足主动选择');
  expect(current.state.messages[0].content).not.toContain('审稿前流预览');
  expect(current.state.agentRun?.status).toBe('failed');
});

it.each(['stopped', 'paused'] as const)(
  '%s runtime interruption with an execution outcome still retains preview and separate diagnosis',
  async (status) => {
    await begin();
    await start();
    await delta('保留控制前片段', 1);
    await delta('以及尚未刷新的片段', 2);
    const node = host.querySelector('[data-testid="assistant-message"]');
    const reason = status === 'stopped' ? '本轮已停止' : '本轮已暂停';
    await finish(reason, status, {
      execution_outcome: {
        status: 'partial',
        code: 'fixture_failure',
        message: '此前执行未全部完成',
      },
    });
    expect(current.state.messages[0].content).toBe('保留控制前片段以及尚未刷新的片段');
    expect(current.state.messages[0].stream?.detail).toBe(reason);
    expect(current.state.agentRun?.status).toBe(status);
    expect(host.querySelector('[data-testid="assistant-message"]')).toBe(node);
  },
);

it.each(['tool_trace', 'permission_required'] as const)(
  'a valid late delta cannot clear the %s hold until a newer model round starts',
  async (type) => {
    await begin();
    await start();
    await delta('工具前片段', 1);
    const runId = current.state.agentRunIdRef.current!;
    await act(async () =>
      current.onEvent(
        type === 'tool_trace'
          ? {
              type,
              run_id: runId,
              index: 0,
              trace: {
                tool_name: 'fs.read',
                status: 'completed',
                input_summary: {},
                output_summary: {},
              },
            }
          : {
              type,
              run_id: runId,
              session_id: runId,
              event_id: 1,
              tool_name: 'file.revise',
              permission_request_id: 'fixture',
              proposed_patch: null,
            },
      ),
    );
    await delta('合法迟到片段', 2);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(current.state.messages[0].content).toBe('工具前片段合法迟到片段');
    expect(current.state.messages[0].stream?.phase).toBe('working');
    expect(host.textContent).not.toContain('正在输出');
    expect(current.state.agentBusy).toBe(true);
    await start(2);
    await delta('下一轮正文', 1, 2);
    expect(current.state.messages[0].stream?.phase).toBe('streaming');
    await finish();
  },
);

it('in-progress phases keep a continuous run indicator; working idles instead of vanishing', async () => {
  await begin();
  await start();
  // waiting：未收到正文前已有运行信号（不假装输出，但确在跑）。
  const waitingDot = host.querySelector('[data-testid="stream-indicator"]');
  expect(waitingDot).not.toBeNull();
  await delta('工具前片段', 1);
  // streaming：活跃输出用脉冲点。
  const streamingDot = host.querySelector('[data-testid="stream-indicator"]');
  expect(streamingDot?.className).toContain('animate-pulse');
  // working：进入工具 hold 后指示不消失，只从脉冲降级为常亮（区别于「停止」）。
  await act(async () =>
    current.onEvent({
      type: 'tool_trace',
      run_id: current.state.agentRunIdRef.current!,
      index: 0,
      trace: { tool_name: 'fs.read', status: 'completed', input_summary: {}, output_summary: {} },
    }),
  );
  const workingDot = host.querySelector('[data-testid="stream-indicator"]');
  expect(workingDot).not.toBeNull();
  expect(workingDot?.className).not.toContain('animate-pulse');
  // 终态后指示随相位容器一起消失。
  await finish();
  expect(host.querySelector('[data-testid="stream-indicator"]')).toBeNull();
});

it('duplicate or same-round replacement starts never erase preview; only a newer round resets', async () => {
  await begin();
  await start();
  await delta('旧轮正文', 1);
  await delta('待刷尾巴', 2);
  const node = host.querySelector('[data-testid="assistant-message"]');
  await start();
  await emit({
    type: 'agent_text_stream_started',
    ...identity(),
    stream_id: 'same-round-replacement',
    chunk_sequence: 0,
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(current.state.messages[0].content).toBe('旧轮正文待刷尾巴');
  await delta('原流继续', 3);
  await start(2);
  await delta('新轮正文', 1, 2);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  expect(current.state.messages[0].content).toBe('新轮正文');
  expect(host.querySelector('[data-testid="assistant-message"]')).toBe(node);
  await finish();
});

it('decoder counts supplementary Unicode characters as code points for the per-frame limit', () => {
  const frame = {
    type: 'agent_text_delta',
    run_id: 'r',
    stream_id: 's',
    round_index: 1,
    chunk_sequence: 1,
  };
  expect(isAgentTextFrame({ ...frame, text_delta: '😀'.repeat(4096) })).toBe(true);
  expect(isAgentTextFrame({ ...frame, text_delta: '😀'.repeat(4097) })).toBe(false);
});

it.each(['', '  \n'])(
  'failed result without an authoritative body (%j) falls back to preview',
  async (summary) => {
    await begin();
    await start();
    await delta('有正文但结果无正文', 1);
    await finish(summary, undefined, {
      execution_outcome: { status: 'failed', code: 'fixture_empty', message: '未取得正文' },
    });
    expect(current.state.messages[0].content).toBe('有正文但结果无正文');
    expect(current.state.messages[0].stream?.detail).toBeUndefined();
    expect(current.state.agentRun?.status).toBe('failed');
  },
);

it('an error before any text uses the original diagnostic rather than an empty preview', async () => {
  await begin();
  await start();
  await emit({
    type: 'error',
    run_id: current.state.agentRunIdRef.current,
    detail: 'provider unavailable',
  });
  await act(async () => pending);
  finished = true;
  expect(current.state.messages[0].content).toContain('provider unavailable');
  expect(current.state.messages[0].stream?.detail).toBeUndefined();
});

it('tool hold before the first visible text also remains working until a newer round', async () => {
  await begin();
  await start();
  await act(async () =>
    current.onEvent({
      type: 'tool_trace',
      run_id: current.state.agentRunIdRef.current!,
      index: 0,
      trace: { tool_name: 'fs.read', status: 'completed', input_summary: {}, output_summary: {} },
    }),
  );
  await delta('迟到的第一段', 1);
  expect(current.state.messages[0].content).toBe('迟到的第一段');
  expect(current.state.messages[0].stream?.phase).toBe('working');
  await finish();
});
