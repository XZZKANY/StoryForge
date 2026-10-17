import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../src/lib/api/chapter-checks', () => ({
  queryChapterCheckHistory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
}));
const { newSession, run } = vi.hoisted(() => ({ newSession: vi.fn(), run: vi.fn() }));
vi.mock('../src/components/chat-window/useRunAuthorAgent', () => ({
  useRunAuthorAgent: () => run,
}));
vi.mock('../src/components/chat-window/useChatSessionContext', () => ({
  useChatSessionContext: () => ({
    handleSelectSession: () => {},
    handleNewSession: newSession,
    retryAssistantSessionLoad: () => {},
    retryContextCandidates: () => {},
    addExplicitContext: () => {},
    togglePinnedContext: () => {},
  }),
}));
vi.mock('../src/components/chat-window/useAgentRunRecovery', () => ({
  useAgentRunRecovery: () => ({}),
}));
vi.mock('../src/components/chat-window/useAgentStreamEvent', () => ({
  useAgentStreamEvent: () => () => {},
}));
vi.mock('../src/components/chat-window/useAgentRunControls', () => ({
  useAgentRunControls: () => ({ retryLastFailedRun: () => {}, agentRunControls: {} }),
}));
vi.mock('../src/lib/api/cross-chapter', () => import('./support/http-cross-chapter-double'));
import { ChatWindow } from '../src/components/ChatWindow';
import { emitAgentPromptRequest, emitNewSessionRequest } from '../src/lib/assistant-events';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  newSession.mockReset().mockReturnValue(true);
  run.mockReset().mockResolvedValue(undefined);
  await act(async () =>
    root.render(<ChatWindow projectPath="D:/fixture" currentFile={null} assistantSessionId={1} />),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test('命令面板的「新建会话」事件走对话头按钮同一条路径', async () => {
  await act(async () => emitNewSessionRequest());
  expect(newSession).toHaveBeenCalledTimes(1);
});

test('对话栏卸载后不再响应新建会话事件', async () => {
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => emitNewSessionRequest());
  expect(newSession).not.toHaveBeenCalled();
});

test('观测镜「让 AI 查」的话走输入框同一条发送路径', async () => {
  await act(async () => emitAgentPromptRequest('做一次一致性观察：当前这章有没有对不上的地方？'));
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]?.[0]).toBe('做一次一致性观察：当前这章有没有对不上的地方？');
  const userMessages = [...host.querySelectorAll('[data-testid="user-message"]')];
  expect(userMessages.map((node) => node.textContent)).toContain(
    '做一次一致性观察：当前这章有没有对不上的地方？',
  );
});

test('空话不发', async () => {
  await act(async () => emitAgentPromptRequest('   '));
  expect(run).not.toHaveBeenCalled();
});
