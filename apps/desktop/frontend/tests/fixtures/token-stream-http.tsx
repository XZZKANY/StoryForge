import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageList } from '../../src/components/chat-window/panels';
import { useChatWindowState } from '../../src/components/chat-window/useChatWindowState';
import { useChatSessionContext } from '../../src/components/chat-window/useChatSessionContext';
import { useAgentStreamEvent } from '../../src/components/chat-window/useAgentStreamEvent';
import { useAgentRunRecovery } from '../../src/components/chat-window/useAgentRunRecovery';
import { useRunAuthorAgent } from '../../src/components/chat-window/useRunAuthorAgent';
import { sendAgentControlMessage } from '../../src/lib/api-client';
import '../../src/index.css';

// Real production hooks and fetch; only the native filesystem seam is supplied by the runner.
function Fixture() {
  const projectPath = new URLSearchParams(location.search).get('project');
  if (!projectPath) throw new Error('Missing isolated fixture project');
  const [assistantSessionId, setAssistantSessionId] = useState<number | null>(null);
  const state = useChatWindowState({ projectPath, currentFile: null, assistantSessionId });
  useChatSessionContext(state, {
    projectPath,
    currentFile: null,
    assistantSessionId,
    onAssistantSessionChange: setAssistantSessionId,
  });
  const recovery = useAgentRunRecovery(state, setAssistantSessionId);
  const onEvent = useAgentStreamEvent(state, recovery.refreshAgentRunRecovery);
  const run = useRunAuthorAgent(
    state,
    onEvent,
    recovery.updateAgentStatus,
    recovery.refreshAgentRunRecovery,
    setAssistantSessionId,
    'read',
  );
  const stop = async () => {
    if (!state.agentRun) throw new Error('No active fixture run');
    onEvent(
      await sendAgentControlMessage({
        sessionId: state.agentRun.sessionId,
        runId: state.agentRun.id,
        type: 'stop_run',
      }),
    );
  };
  return (
    <main className="flex h-screen flex-col bg-surface text-foreground">
      <header className="shrink-0 border-b border-border p-3 text-xs">
        <strong>正文流 HTTP 连续验收 · 合成模型、本地真实 API</strong>
        <div className="my-2 flex gap-4">
          <button
            disabled={state.agentBusy || !!state.agentRun}
            onClick={() => {
              state.setMessages([{ role: 'user', content: '解释这段文字' }]);
              void run('解释这段文字', 'agent');
            }}
          >
            开始
          </button>
          <button disabled={!state.agentBusy} onClick={() => void stop()}>
            停止
          </button>
        </div>
        <output
          data-testid="http-state"
          data-run-id={state.agentRun?.id}
          data-session-id={assistantSessionId}
        >
          {state.agentRun?.status ?? 'idle'} · {state.agentBusy ? 'busy' : 'settled'}
        </output>
      </header>
      <MessageList
        messages={state.messages}
        agentRun={state.agentRun}
        agentRunRecovery={state.agentRunRecovery}
      />
      <footer className="shrink-0 border-t border-border p-3">
        <input className="w-full bg-panel p-2 text-sm" aria-label="输入焦点验收" />
      </footer>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
