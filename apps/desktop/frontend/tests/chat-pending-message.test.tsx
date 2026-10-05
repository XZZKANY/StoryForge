import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// This fixture owns no persisted chapter checks; the dedicated history tests cover that read.
vi.mock('../src/lib/api/chapter-checks', () => ({
  queryChapterCheckHistory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
}));
import { ChatWindowView } from '../src/components/chat-window/ChatWindowView';
import { useChatSubmission } from '../src/components/chat-window/useChatSubmission';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import { emitPatchRejected } from '../src/lib/assistant-events';
import type { RunAuthorAgent } from '../src/components/chat-window/useRunAuthorAgent';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let api: {
  state: ReturnType<typeof useChatWindowState>;
  submission: ReturnType<typeof useChatSubmission>;
};
const run = vi.fn<RunAuthorAgent>(async () => undefined);
function Harness({
  project = 'D:/fixture',
  session = 1,
}: {
  project?: string | null;
  session?: number | null;
}) {
  const state = useChatWindowState({
    projectPath: project,
    currentFile: null,
    assistantSessionId: session,
  });
  const submission = useChatSubmission(state, run, {
    projectPath: project,
    assistantSessionId: session,
  });
  api = { state, submission };
  return (
    <ChatWindowView
      state={state}
      projectPath={project}
      assistantSessionId={session}
      layoutMode="balanced"
      onSetLayoutMode={() => {}}
      onOpenObservatory={() => {}}
      observatoryAttention={false}
      agentPermissionProfile="ask"
      onAgentPermissionProfileChange={() => {}}
      handleSelectSession={() => {}}
      handleNewSession={() => {}}
      retryAssistantSessionLoad={() => {}}
      retryContextCandidates={() => {}}
      addExplicitContext={() => {}}
      togglePinnedContext={() => {}}
      handleSubmit={submission.handleSubmit}
      handleComposerSubmit={submission.handleComposerSubmit}
      userMessageHistory={submission.userMessageHistory}
      queuedMessages={submission.queuedMessages}
      onRemoveQueuedMessage={submission.removeQueuedMessage}
      conversationScope={submission.conversationScope}
      retryLastFailedRun={() => {}}
      retryWritingRunSubscription={() => {}}
      agentRunControls={{
        onApprovePermission: () => {},
        onDenyPermission: () => {},
        onPauseRun: () => {},
        onResumeRun: () => {},
        onStopRun: () => {},
      }}
    />
  );
}
async function render(props: Parameters<typeof Harness>[0] = {}) {
  await act(async () => root.render(<Harness {...props} />));
}
async function typeAndSubmit(value: string) {
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="composer-submit"]')!.click(),
  );
}
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  run.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test('真实 Composer 单条待发可见；第二次提交保留草稿，取消后不发送并回焦点', async () => {
  await render();
  await act(async () => api.state.setAgentBusy(true));
  await typeAndSubmit('请保留这条待发');
  expect(host.querySelector('[data-testid="composer-queued-messages"]')?.textContent).toContain(
    '请保留这条待发',
  );
  expect(host.querySelector('textarea')!.value).toBe('');
  await typeAndSubmit('第二条留在输入框');
  expect(api.submission.queuedMessages).toHaveLength(1);
  expect(host.querySelector('textarea')!.value).toBe('第二条留在输入框');
  const cancel = host.querySelector<HTMLButtonElement>(
    '[aria-label="取消待发送消息：请保留这条待发"]',
  )!;
  await act(async () => cancel.click());
  expect(document.activeElement).toBe(host.querySelector('textarea'));
  await act(async () => api.state.setAgentBusy(false));
  expect(run).not.toHaveBeenCalled();
  expect(host.querySelector('textarea')!.value).toBe('第二条留在输入框');
});

test('run 结束进入待确认时不自动执行待发，确认结束只执行一次且不清新草稿', async () => {
  await render();
  await act(async () => api.state.setAgentBusy(true));
  await typeAndSubmit('待发内容');
  await act(async () => {
    api.state.setInput('后续草稿');
    api.state.setAgentRun({
      id: 'r1',
      sessionId: 'r1',
      goal: '修订',
      status: 'waiting',
      steps: [],
    });
    api.state.setAgentBusy(false);
  });
  expect(run).not.toHaveBeenCalled();
  expect(api.submission.queuedMessages).toHaveLength(1);
  await act(async () =>
    api.state.setAgentRun((value) => (value ? { ...value, status: 'completed' } : null)),
  );
  expect(run.mock.calls.map(([instruction]) => instruction)).toEqual(['待发内容']);
  expect(host.querySelector('textarea')!.value).toBe('后续草稿');
  await render();
  expect(run).toHaveBeenCalledTimes(1);
});

test('同一批次取消与 busy 结束竞争时不发送已取消项', async () => {
  await render();
  await act(async () => api.state.setAgentBusy(true));
  await typeAndSubmit('取消项');
  const id = api.submission.queuedMessages[0].id;
  await act(async () => {
    api.state.setAgentBusy(false);
    api.submission.removeQueuedMessage(id);
  });
  expect(run).not.toHaveBeenCalled();
  expect(api.submission.queuedMessages).toEqual([]);
});

test.each([
  { project: 'D:/other', session: 1 },
  { project: 'D:/fixture', session: 2 },
  { project: null, session: null },
])('旧 scope 回调与待发在导航后失效：%j', async (next) => {
  await render();
  await act(async () => api.state.setAgentBusy(true));
  await typeAndSubmit('旧待发');
  const oldSubmit = api.submission.handleComposerSubmit;
  await render(next);
  expect(api.submission.queuedMessages).toEqual([]);
  await render(); // A → B → A must not revive the first lifetime.
  await act(async () => api.state.setAgentBusy(false));
  await act(async () => oldSubmit('迟到回调'));
  expect(run).not.toHaveBeenCalled();
  expect(api.state.messages.some((message) => message.content === '迟到回调')).toBe(false);
});

test('草稿首次持久化不清待发且保留 Composer/消息树；显式新草稿会失效', async () => {
  await render({ session: null });
  const input = host.querySelector('textarea');
  const scroll = host.querySelector('[data-testid="message-list-scroll"]');
  const initialScope = api.submission.conversationScope;
  await act(async () => api.state.setAgentBusy(true));
  await typeAndSubmit('持久化后继续');
  api.state.selfPersistedSessionIdRef.current = 8;
  await render({ session: 8 });
  expect(api.submission.conversationScope).toBe(initialScope);
  expect(api.submission.queuedMessages[0]?.content).toBe('持久化后继续');
  expect(host.querySelector('textarea')).toBe(input);
  expect(host.querySelector('[data-testid="message-list-scroll"]')).toBe(scroll);
  await act(async () => api.state.setAgentBusy(false));
  expect(run.mock.calls.map(([instruction]) => instruction)).toEqual(['持久化后继续']);
  await render({ session: null });
  await act(async () => api.state.setAgentBusy(true));
  await typeAndSubmit('废弃草稿待发');
  await act(async () => {
    api.state.draftNonceRef.current = 'new-explicit-draft';
    api.state.setMessages([]);
  });
  expect(api.submission.queuedMessages).toEqual([]);
  await act(async () => api.state.setAgentBusy(false));
  expect(run).toHaveBeenCalledTimes(1);
});

test('真实 deferred 提交不重复调用；busy 提前释放仍等待原请求收尾才发送单条待发', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  run.mockImplementationOnce(async () => {
    api.state.setAgentBusy(true);
    await pending;
  });
  await render();
  await act(async () => api.state.setInput('第一轮'));
  let first!: Promise<void>;
  await act(async () => {
    first = api.submission.handleSubmit();
    void api.submission.handleSubmit();
  });
  expect(run).toHaveBeenCalledTimes(1);
  await typeAndSubmit('第二轮待发');
  await act(async () => api.state.setAgentBusy(false));
  expect(run).toHaveBeenCalledTimes(1);
  expect(api.submission.queuedMessages).toHaveLength(1);
  await act(async () => {
    resolve();
    await first;
  });
  expect(run.mock.calls.map(([instruction]) => instruction)).toEqual(['第一轮', '第二轮待发']);
});

test('拒绝同一待确认补丁的明确方向不会被上一帧 waiting 状态吞掉，其他补丁不发送', async () => {
  await render();
  await act(async () =>
    api.state.setAgentRun({
      id: 'r1',
      sessionId: 'r1',
      goal: '修订',
      status: 'waiting',
      steps: [
        {
          id: 'approval',
          title: '确认',
          tool: 'approval',
          status: 'waiting',
          detail: '',
          patchId: 'p1',
        },
      ],
    }),
  );
  await act(async () =>
    emitPatchRejected({ filePath: 'D:/fixture/a.md', patchId: 'other', direction: '不属于本轮' }),
  );
  expect(run).not.toHaveBeenCalled();
  await act(async () =>
    emitPatchRejected({ filePath: 'D:/fixture/a.md', patchId: 'p1', direction: '保留叙述视角' }),
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][0]).toContain('保留叙述视角');
});

test('程序化第二条指令同样保留到草稿，不覆盖单条待发', async () => {
  await render();
  await act(async () => api.state.setAgentBusy(true));
  await act(async () => api.submission.handleComposerSubmit('第一条待发'));
  await act(async () => api.submission.handleComposerSubmit('第二条指令'));
  expect(api.submission.queuedMessages.map((item) => item.content)).toEqual(['第一条待发']);
  expect(host.querySelector('textarea')!.value).toBe('第二条指令');
});

test('卸载后的提交回调失效，取消旧 ID 不能移除后来待发项', async () => {
  await render();
  await act(async () => api.state.setAgentBusy(true));
  await typeAndSubmit('旧待发');
  const oldId = api.submission.queuedMessages[0].id;
  await act(async () => api.submission.removeQueuedMessage(oldId));
  await typeAndSubmit('新待发');
  await act(async () => api.submission.removeQueuedMessage(oldId));
  expect(api.submission.queuedMessages[0]?.content).toBe('新待发');
  const submit = api.submission.handleComposerSubmit;
  await act(async () => root.render(null));
  await act(async () => submit('迟到提交'));
  expect(run).not.toHaveBeenCalled();
});
