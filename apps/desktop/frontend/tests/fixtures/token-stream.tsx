import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageList } from '../../src/components/chat-window/panels';
import { useChatTextStream } from '../../src/components/chat-window/useChatTextStream';
import type { AgentRun, Message } from '../../src/components/chat-window/types';
import { sendAgentUserMessage, isAgentResultMessage } from '../../src/lib/api-client';
import { isAgentTextFrame } from '../../src/lib/api/agent-text-stream';
import {
  statusFromAgentResult,
  textSettlementFromAgentResult,
} from '../../src/components/chat-window/resumed-result';
import '../../src/index.css';

// An isolated, explicitly synthetic fixture. No network or filesystem access.
let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
let posts = 0;
window.fetch = async (_input, init) => {
  if (init?.method !== 'POST' || !String(_input).endsWith('/sessions/fixture/stream'))
    throw new Error('Blocked non-fixture request');
  posts += 1;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    }),
    {
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
};
const emit = (frame: object) =>
  controller?.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(frame) + '\n\n'));
const identity = { run_id: 'fixture', stream_id: 'round-1', round_index: 1 };
const chunks = [
  '## 审稿建议\n\n先让人物的选择带动情节，而不是由旁白解释。\n\n**第一',
  '个转折**：她发现门锁被换过。😀\n\n- 保留旧钥匙的细节\n- 让对话留下悬念\n\n```text\n她把钥匙藏进袖口',
  '，没有敲门。\n```\n\n| 场景 | 调整 |\n| --- | --- |\n| 门外 | 减少解释，保留动作 |\n',
  '\n接下来逐段检查因果关系。\n'.repeat(8),
];
function Fixture() {
  const [messages, setMessages] = useState<Message[]>(() =>
    Array.from({ length: 8 }, (_, i) => ({
      id: 'history-' + i,
      role: i % 2 ? 'assistant' : 'user',
      content:
        i % 2
          ? '历史样例：这段场景可以从人物行动切入，留下读者想继续看的问题。'
          : '请检查这一章的节奏。',
    })),
  );
  const [run, setRun] = useState<AgentRun | null>(null);
  const [phase, setPhase] = useState('idle');
  const [index, setIndex] = useState(0);
  const stream = useChatTextStream(setMessages);
  const start = async () => {
    setPhase('waiting');
    stream.begin('fixture', () => true);
    setRun({ id: 'fixture', sessionId: 'fixture', goal: '审稿样例', status: 'running', steps: [] });
    const resultPromise = sendAgentUserMessage({
      sessionId: 'fixture',
      runId: 'fixture',
      userMessage: '审稿样例',
      onEvent: (frame) => {
        if (isAgentTextFrame(frame)) stream.accept(frame);
      },
    });
    // fetch config is asynchronous; start after the actual stream is attached.
    while (!controller) await new Promise((resolve) => setTimeout(resolve, 0));
    emit({ type: 'agent_text_stream_started', ...identity, chunk_sequence: 0 });
    const result = await resultPromise;
    if (!isAgentResultMessage(result)) throw new Error('Unexpected fixture terminal');
    const status = statusFromAgentResult(result);
    const stopped = status === 'stopped';
    stream.settle(
      'fixture',
      textSettlementFromAgentResult(result, result.agent_result.summary ?? ''),
      status,
    );
    setRun((value) => (value ? { ...value, status } : value));
    setPhase(stopped ? 'interrupted' : 'completed');
  };
  const advance = () => {
    emit({
      type: 'agent_text_delta',
      ...identity,
      chunk_sequence: index + 1,
      text_delta: chunks[index],
    });
    setIndex(index + 1);
    setPhase('streaming');
  };
  const finish = (stopped: boolean) =>
    emit({
      type: 'agent_result',
      run_id: 'fixture',
      session_id: 'fixture',
      assistant_session_id: 1,
      user_message: '审稿样例',
      intent: 'chat.explain',
      plan: [],
      tool_trace: [],
      ...(stopped
        ? { runtime_interruption: { status: 'stopped', boundary: 'fixture_after_model' } }
        : {}),
      agent_result: {
        summary: stopped ? '已停止，保留已收到的正文。' : chunks.join(''),
        requires_user_confirmation: false,
        runtime_interrupted: stopped,
      },
    });
  return (
    <main className="flex h-screen flex-col bg-surface text-foreground">
      <header className="shrink-0 border-b border-border p-3 text-xs">
        <strong>正文流验收 · 隔离样例（非真实模型）</strong>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => void start()} disabled={phase !== 'idle'}>
            开始
          </button>
          <button
            onClick={advance}
            disabled={
              !controller ||
              index >= chunks.length ||
              phase === 'completed' ||
              phase === 'interrupted'
            }
          >
            下一批
          </button>
          <button
            onClick={() => {
              stream.hold('fixture', 'working', false);
              setRun((value) =>
                value
                  ? {
                      ...value,
                      steps: [
                        {
                          id: 'read',
                          title: '读取正文',
                          tool: 'fs.read',
                          status: 'completed',
                          detail: '已读取样例章节',
                        },
                      ],
                    }
                  : value,
              );
            }}
          >
            工具进度
          </button>
          <button onClick={() => finish(false)} disabled={!controller}>
            完成
          </button>
          <button onClick={() => finish(true)} disabled={!controller}>
            中断
          </button>
          <button
            onClick={() => {
              document.documentElement.dataset.theme =
                document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            }}
          >
            切换主题
          </button>
        </div>
        <output data-testid="fixture-state">
          {phase} · POST {posts}
        </output>
      </header>
      <MessageList
        messages={messages}
        agentRun={run}
        agentRunRecovery={null}
        writingRunProjection={null}
      />
      <footer className="shrink-0 border-t border-border p-3">
        <input
          className="w-full bg-panel p-2 text-sm"
          aria-label="输入焦点验收"
          placeholder="输入不会被流刷新打断"
        />
      </footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
