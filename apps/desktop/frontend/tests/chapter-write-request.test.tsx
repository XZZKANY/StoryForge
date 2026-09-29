import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ChatWindowState } from '../src/components/chat-window/useChatWindowState';
import type { ChapterBrief } from '../src/components/chat-window/types';

const { run, captured } = vi.hoisted(() => ({
  run: vi.fn(),
  captured: { state: null as ChatWindowState | null },
}));
vi.mock('../src/components/chat-window/useRunAuthorAgent', () => ({
  useRunAuthorAgent: () => run,
}));
vi.mock('../src/components/chat-window/useChatSessionContext', () => ({
  useChatSessionContext: () => ({
    handleSelectSession: () => {},
    handleNewSession: () => {},
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
// 保留真实 state hook，但把句柄暴露给测试，用于构造 agentBusy / 待确认守卫场景。
vi.mock('../src/components/chat-window/useChatWindowState', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/components/chat-window/useChatWindowState')>();
  return {
    ...actual,
    useChatWindowState: (props: Parameters<typeof actual.useChatWindowState>[0]) => {
      const state = actual.useChatWindowState(props);
      captured.state = state;
      return state;
    },
  };
});
import { ChatWindow } from '../src/components/ChatWindow';
import { emitChapterWriteRequest } from '../src/lib/assistant-events';
import { TOAST_EVENT, type ToastDetail } from '../src/lib/toast';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let toasts: string[];
const onToast = (event: Event) => {
  toasts.push((event as CustomEvent<ToastDetail>).detail.message);
};

const pendingBrief: ChapterBrief = {
  briefId: 'chapter-brief-1',
  revision: 1,
  targetPath: '正文/第004章.md',
  chapterOrdinal: 4,
  chapterTitle: null,
  goal: '推进冲突',
  pov: null,
  setting: null,
  requiredBeats: [],
  forbiddenItems: [],
  continuityConstraints: [],
  targetCharsMin: 1600,
  targetCharsMax: 2600,
};

beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  toasts = [];
  run.mockReset().mockResolvedValue(undefined);
  window.addEventListener(TOAST_EVENT, onToast);
  await act(async () =>
    root.render(<ChatWindow projectPath="D:/fixture" currentFile={null} assistantSessionId={1} />),
  );
});
afterEach(() => {
  window.removeEventListener(TOAST_EVENT, onToast);
  act(() => root.unmount());
  host.remove();
});

test('起草事件转成 chapter.write run：goal 带章号与标题，目标路径透传', async () => {
  await act(async () => {
    emitChapterWriteRequest({
      targetPath: '正文/第004章.md',
      chapterOrdinal: 4,
      chapterTitle: '潮声',
    });
  });

  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]).toEqual([
    '起草第4章《潮声》',
    undefined,
    'chapter.write',
    [],
    { targetFilePath: '正文/第004章.md' },
  ]);
  const userMessages = [...host.querySelectorAll('[data-testid="user-message"]')];
  expect(userMessages.map((node) => node.textContent)).toEqual(['起草第4章《潮声》']);
});

test('无章号时 goal 回退为「起草下一章」', async () => {
  await act(async () => {
    emitChapterWriteRequest({ targetPath: '正文/第001章.md' });
  });

  expect(run.mock.calls[0]?.[0]).toBe('起草下一章');
  expect(run.mock.calls[0]?.[4]).toEqual({ targetFilePath: '正文/第001章.md' });
});

test('agentBusy / 待确认 brief / waiting run 时拦截，不发起 run 也不进消息列表', async () => {
  const userMessageCount = () => host.querySelectorAll('[data-testid="user-message"]').length;

  await act(async () => captured.state!.setAgentBusy(true));
  await act(async () => {
    emitChapterWriteRequest({ targetPath: '正文/第004章.md', chapterOrdinal: 4 });
  });
  expect(run).not.toHaveBeenCalled();
  expect(toasts).toEqual(['先处理当前待确认内容，再发起新的起草。']);
  expect(userMessageCount()).toBe(0);

  await act(async () => {
    captured.state!.setAgentBusy(false);
    captured.state!.setChapterBrief(pendingBrief);
  });
  await act(async () => {
    emitChapterWriteRequest({ targetPath: '正文/第004章.md', chapterOrdinal: 4 });
  });
  expect(run).not.toHaveBeenCalled();
  expect(toasts).toHaveLength(2);

  await act(async () => {
    captured.state!.setChapterBrief(null);
    captured.state!.setAgentRun({
      id: 'r1',
      sessionId: 'r1',
      goal: '修订',
      status: 'waiting',
      steps: [],
    });
  });
  await act(async () => {
    emitChapterWriteRequest({ targetPath: '正文/第004章.md', chapterOrdinal: 4 });
  });
  expect(run).not.toHaveBeenCalled();
  expect(toasts).toHaveLength(3);
  expect(userMessageCount()).toBe(0);

  // 确认收口后恢复可发起。
  await act(async () =>
    captured.state!.setAgentRun((value) => (value ? { ...value, status: 'completed' } : null)),
  );
  await act(async () => {
    emitChapterWriteRequest({ targetPath: '正文/第004章.md', chapterOrdinal: 4 });
  });
  expect(run).toHaveBeenCalledTimes(1);
});
