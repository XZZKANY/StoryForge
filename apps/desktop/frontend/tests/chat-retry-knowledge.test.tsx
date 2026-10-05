import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// This fixture owns no persisted chapter checks; the dedicated history tests cover that read.
vi.mock('../src/lib/api/chapter-checks', () => ({
  queryChapterCheckHistory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
}));
import type { RunAuthorAgent } from '../src/components/chat-window/useRunAuthorAgent';

const { run } = vi.hoisted(() => ({ run: vi.fn<RunAuthorAgent>(async () => undefined) }));
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
import { ChatWindow } from '../src/components/ChatWindow';
import { emitRetryWithoutKnowledge } from '../src/lib/assistant-events';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const detail = {
  projectPath: 'D:/fixture',
  filePath: 'D:/fixture/a.md',
  knowledgeId: 'k1',
  relativePath: '资料/a.md',
  goal: '重新审阅',
};
beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  run.mockReset().mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <ChatWindow projectPath="D:/fixture" currentFile="D:/fixture/a.md" assistantSessionId={1} />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test('知识重试 emitter 等待真实 ChatWindow handler 的 deferred 请求结束，同帧双击被拒绝', async () => {
  let release!: () => void;
  run.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  let settled = false;
  let first!: Promise<void>;
  await act(async () => {
    first = emitRetryWithoutKnowledge(detail).then(() => {
      settled = true;
    });
    await expect(emitRetryWithoutKnowledge(detail)).rejects.toThrow('Agent 正忙');
  });
  expect(settled).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]).toEqual(['重新审阅', undefined, undefined, ['k1']]);
  expect(host.querySelectorAll('[data-testid="user-message"]')).toHaveLength(1);
  await act(async () => {
    release();
    await first;
  });
  expect(settled).toBe(true);
});

test('失败向原调用方报告并允许重新尝试；错误项目/文件不 claim', async () => {
  await expect(emitRetryWithoutKnowledge({ ...detail, projectPath: 'D:/other' })).rejects.toThrow(
    '没有可接收重试',
  );
  await expect(
    emitRetryWithoutKnowledge({ ...detail, filePath: 'D:/fixture/b.md' }),
  ).rejects.toThrow('没有可接收重试');
  expect(run).not.toHaveBeenCalled();
  run.mockRejectedValueOnce(new Error('测试请求失败'));
  await act(async () => {
    await expect(emitRetryWithoutKnowledge(detail)).rejects.toThrow('测试请求失败');
  });
  await act(async () => {
    await emitRetryWithoutKnowledge(detail);
  });
  expect(run).toHaveBeenCalledTimes(2);
});
