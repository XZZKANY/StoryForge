/**
 * 对话区反馈缺口修复的行为测试：
 *  1. 写作任务进度订阅失败 → 面板明确区分「进度信号丢失」并提供「重试订阅」；
 *  2. 会话记录加载失败 / 项目上下文索引失败两条错误条可关闭且保留重试入口；
 *  3. run.status === 'failed' 时 live region 切 assertive 打断；
 *  4. 「停止本轮」两段式内联确认（第一次点只武装，超时/失焦/划走取消）。
 */
import assert from 'node:assert/strict';
import { act, useEffect, type Dispatch, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, test, vi } from 'vitest';

import { ChatWindowView } from '../src/components/chat-window/ChatWindowView';
import {
  ContextSummaryPanel,
  RunActionBar,
  WritingRunProgressPanel,
} from '../src/components/chat-window/panels';
import type { AgentRun, WritingRunProjection } from '../src/components/chat-window/types';
import { useAgentRunControls } from '../src/components/chat-window/useAgentRunControls';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import {
  markWritingRunSubscriptionLost,
  startWritingRunProjectionSubscription,
} from '../src/components/chat-window/useRunAuthorAgent';
import { subscribeWritingRunEvents } from '../src/lib/api-client';

vi.mock('../src/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api-client')>();
  return {
    ...actual,
    subscribeWritingRunEvents: vi.fn(),
    listAssistantSessions: vi.fn(async () => []),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockedSubscribe = vi.mocked(subscribeWritingRunEvents);

let host: HTMLDivElement;
let root: Root | undefined;

async function renderNode(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<>{node}</>));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  mockedSubscribe.mockReset();
});

function fakeProjectionSetter(): [
  () => WritingRunProjection | null,
  Dispatch<SetStateAction<WritingRunProjection | null>>,
] {
  let current: WritingRunProjection | null = null;
  const set: Dispatch<SetStateAction<WritingRunProjection | null>> = (updater) => {
    current = typeof updater === 'function' ? updater(current) : updater;
  };
  return [() => current, set];
}

function runningProjection(overrides: Partial<WritingRunProjection> = {}): WritingRunProjection {
  return {
    writingRunId: 700,
    status: 'running',
    currentChapterIndex: 3,
    totalChapters: 10,
    completedCount: 4,
    latestEvent: 'progress',
    failureReason: null,
    ...overrides,
  };
}

// ---------- 缺陷 1：订阅失败静默降级 ----------

test('订阅建立失败把投影标成进度信号丢失，终态任务不被误标', async () => {
  mockedSubscribe.mockRejectedValue(new Error('connect failed'));
  const [getProjection, setProjection] = fakeProjectionSetter();
  setProjection(runningProjection());
  const ref: { current: (() => void) | null } = { current: vi.fn() };

  startWritingRunProjectionSubscription(700, ref, setProjection);
  assert.equal(ref.current, null, '重开订阅前应先解除旧订阅');
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(getProjection()?.latestEvent, 'error');
  assert.equal(getProjection()?.failureReason, '写作任务进度订阅失败');

  setProjection(runningProjection({ status: 'completed', latestEvent: 'completed' }));
  markWritingRunSubscriptionLost(setProjection);
  assert.equal(getProjection()?.latestEvent, 'completed', '已完成任务不应被标成信号丢失');
});

test('订阅成功后保存解除函数，事件照常推进投影', async () => {
  const unsubscribe = vi.fn();
  let capturedOnEvent: ((event: unknown) => void) | undefined;
  mockedSubscribe.mockImplementation(async (_id, onEvent) => {
    capturedOnEvent = onEvent as (event: unknown) => void;
    return unsubscribe;
  });
  const [getProjection, setProjection] = fakeProjectionSetter();
  setProjection(runningProjection({ latestEvent: 'error', failureReason: '写作任务进度订阅失败' }));
  const ref: { current: (() => void) | null } = { current: null };

  startWritingRunProjectionSubscription(700, ref, setProjection);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(ref.current, unsubscribe);
  assert.ok(capturedOnEvent);
  act(() =>
    capturedOnEvent!({
      event: 'progress',
      data: { writing_run_id: 700, status: 'running', completed_count: 5 },
    }),
  );
  assert.equal(getProjection()?.completedCount, 5);
});

test('进度信号丢失时面板隐藏进度条并给出重试订阅按钮', async () => {
  const onRetry = vi.fn();
  await renderNode(
    <WritingRunProgressPanel
      projection={runningProjection({
        latestEvent: 'error',
        failureReason: '写作任务进度订阅失败',
      })}
      onRetrySubscription={onRetry}
    />,
  );

  assert.ok(host.querySelector('[data-testid="writing-run-subscription-lost"]'));
  assert.match(host.textContent ?? '', /进度信号丢失/);
  assert.equal(
    host.querySelector('[data-testid="writing-run-progress-meter"]'),
    null,
    '信号丢失后不再显示可能过期的进度条',
  );
  assert.doesNotMatch(host.textContent ?? '', /最近事件：error/);
  assert.match(host.textContent ?? '', /最后已知进度：4\/10/);

  const retry = host.querySelector<HTMLButtonElement>(
    '[data-testid="writing-run-subscription-retry"]',
  );
  assert.ok(retry);
  await act(async () => retry.click());
  assert.equal(onRetry.mock.calls.length, 1);
});

test('正常进度态不显示信号丢失块，进度条保留', async () => {
  await renderNode(
    <WritingRunProgressPanel projection={runningProjection()} onRetrySubscription={() => {}} />,
  );
  assert.equal(host.querySelector('[data-testid="writing-run-subscription-lost"]'), null);
  assert.ok(host.querySelector('[data-testid="writing-run-progress-meter"]'));
});

type RetryHarnessApi = {
  state: ReturnType<typeof useChatWindowState>;
  retry: () => void;
};

function RetryHarness({ apiRef }: { apiRef: { current: RetryHarnessApi | null } }) {
  const state = useChatWindowState({ projectPath: 'D:/book', currentFile: null });
  const controls = useAgentRunControls(
    state,
    async () => undefined,
    () => undefined,
    {
      updateAgentStep: () => undefined,
      updateAgentStatus: () => undefined,
      refreshAgentRunRecovery: async () => undefined,
      applyResumedAgentResult: () => undefined,
      applyResumeDiagnostic: () => undefined,
    },
  );
  useEffect(() => {
    apiRef.current = { state, retry: controls.retryWritingRunSubscription };
  });
  return null;
}

test('重试订阅会摘除丢失标记并重新建立同一写作任务的订阅', async () => {
  const unsubscribe = vi.fn();
  mockedSubscribe.mockResolvedValue(unsubscribe);
  const apiRef: { current: RetryHarnessApi | null } = { current: null };
  await renderNode(<RetryHarness apiRef={apiRef} />);
  const api = apiRef.current;
  assert.ok(api);

  act(() =>
    api.state.setWritingRunProjection(
      runningProjection({ latestEvent: 'error', failureReason: '写作任务进度订阅失败' }),
    ),
  );
  await act(async () => apiRef.current!.retry());

  assert.equal(mockedSubscribe.mock.calls.length, 1);
  assert.equal(mockedSubscribe.mock.calls[0]?.[0], 700);
  assert.notEqual(apiRef.current!.state.writingRunProjection?.latestEvent, 'error');
  assert.equal(apiRef.current!.state.writingRunProjection?.failureReason, null);
  assert.equal(apiRef.current!.state.unsubscribeWritingRunRef.current, unsubscribe);
});

// ---------- 缺陷 2：两条常驻错误条可关闭且分子系统 ----------

function ViewHarness({
  stateOverrides,
  retrySessionLoad = () => undefined,
}: {
  stateOverrides: Record<string, unknown>;
  retrySessionLoad?: () => void;
}) {
  const state = useChatWindowState({ projectPath: 'D:/book', currentFile: null });
  return (
    <ChatWindowView
      state={{ ...state, ...stateOverrides } as typeof state}
      projectPath="D:/book"
      assistantSessionId={7}
      layoutMode="balanced"
      onSetLayoutMode={() => undefined}
      onOpenObservatory={() => undefined}
      observatoryAttention={false}
      agentPermissionProfile="ask"
      onAgentPermissionProfileChange={() => undefined}
      handleSelectSession={() => undefined}
      handleNewSession={() => undefined}
      retryAssistantSessionLoad={retrySessionLoad}
      retryContextCandidates={() => undefined}
      addExplicitContext={() => undefined}
      togglePinnedContext={() => undefined}
      handleSubmit={async () => undefined}
      handleComposerSubmit={async () => undefined}
      userMessageHistory={[]}
      retryLastFailedRun={() => undefined}
      retryWritingRunSubscription={() => undefined}
      agentRunControls={{
        onApprovePermission: () => undefined,
        onDenyPermission: () => undefined,
        onPauseRun: () => undefined,
        onResumeRun: () => undefined,
        onStopRun: () => undefined,
      }}
    />
  );
}

test('会话记录加载失败条可关闭、重试入口保留，新错误会重新出现', async () => {
  const retrySessionLoad = vi.fn();
  await renderNode(
    <ViewHarness
      stateOverrides={{ sessionLoadError: '会话 #7 加载失败：sidecar unavailable' }}
      retrySessionLoad={retrySessionLoad}
    />,
  );

  const bar = () => host.querySelector('[data-testid="assistant-session-load-error"]');
  assert.ok(bar());
  assert.match(bar()!.textContent ?? '', /会话记录加载失败/);
  assert.match(bar()!.textContent ?? '', /会话 #7 加载失败/);

  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="assistant-session-load-retry"]')!.click(),
  );
  assert.equal(retrySessionLoad.mock.calls.length, 1);
  assert.ok(bar(), '重试后错误仍在时错误条保持可见');

  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[data-testid="assistant-session-load-error-dismiss"]')!
      .click(),
  );
  assert.equal(bar(), null, '关闭后不再常驻');

  await act(async () => {
    root!.render(
      <ViewHarness
        stateOverrides={{ sessionLoadError: '会话 #7 加载失败：第二次失败' }}
        retrySessionLoad={retrySessionLoad}
      />,
    );
  });
  assert.ok(bar(), '新的错误内容应重新出现');
});

test('上下文索引失败条可关闭且点明子系统，关闭后打开选择器仍有重试入口', async () => {
  const onRetry = vi.fn();
  const props = (error: string | null, pickerOpen: boolean) => (
    <ContextSummaryPanel
      compact
      currentFileLabel={null}
      explicitContextPaths={[]}
      contextCandidates={[]}
      contextCandidatesLoading={false}
      contextCandidatesError={error}
      contextPickerOpen={pickerOpen}
      lastContextBundle={null}
      missingContextPaths={[]}
      onAddContext={() => undefined}
      onTogglePinnedContext={() => undefined}
      onRetryContextCandidates={onRetry}
    />
  );
  await renderNode(props('上下文索引读取失败：目录不可读', false));

  const bar = () => host.querySelector('[data-testid="context-candidates-error"]');
  assert.ok(bar());
  assert.match(bar()!.textContent ?? '', /项目上下文索引失败/);
  assert.match(bar()!.textContent ?? '', /目录不可读/);

  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="context-candidates-retry"]')!.click(),
  );
  assert.equal(onRetry.mock.calls.length, 1);
  assert.ok(bar(), '重试后错误仍在时错误条保持可见');

  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[data-testid="context-candidates-error-dismiss"]')!
      .click(),
  );
  assert.equal(bar(), null, '关闭后错误条不再常驻');

  await act(async () => {
    root!.render(props('上下文索引读取失败：目录不可读', true));
  });
  const pickerRetry = host.querySelector<HTMLButtonElement>(
    '[data-testid="context-candidates-picker-retry"]',
  );
  assert.ok(pickerRetry, '关闭常驻条后，打开选择器仍能看到重试入口');
  await act(async () => pickerRetry.click());
  assert.equal(onRetry.mock.calls.length, 2);

  await act(async () => {
    root!.render(props('上下文索引读取失败：磁盘被拔出', false));
  });
  assert.ok(bar(), '新的错误内容应重新出现');
});

// ---------- 缺陷 3：failed 相位要 assertive 打断 ----------

test.each([
  { status: 'failed' as const, role: 'alert', live: 'assertive' },
  { status: 'running' as const, role: 'status', live: 'polite' },
])('run 相位 $status 的 live region tone 正确', async ({ status, role, live }) => {
  const agentRun: AgentRun = { id: 'run-1', sessionId: 's', goal: '润色', status, steps: [] };
  await renderNode(<ViewHarness stateOverrides={{ agentRun }} />);
  const region = host.querySelector('[data-testid="agent-run-live"]');
  assert.ok(region);
  assert.equal(region.getAttribute('role'), role);
  assert.equal(region.getAttribute('aria-live'), live);
});

// ---------- 缺陷 4：「停止本轮」两段式内联确认 ----------

function runningRun(): AgentRun {
  return {
    id: 'run-1',
    sessionId: 's',
    goal: '润色',
    status: 'running',
    steps: [{ id: 's1', title: '思考', tool: 'think', status: 'running', detail: '' }],
  };
}

function stopControls(onStopRun: () => void) {
  return {
    onApprovePermission: () => undefined,
    onDenyPermission: () => undefined,
    onPauseRun: () => undefined,
    onResumeRun: () => undefined,
    onStopRun,
  };
}

const stopButton = () => host.querySelector<HTMLButtonElement>('[data-testid="run-stop"]');

test('停止本轮第一次点击只进入确认态，再点才执行', async () => {
  const onStopRun = vi.fn();
  await renderNode(<RunActionBar run={runningRun()} controls={stopControls(onStopRun)} />);

  assert.equal(stopButton()!.textContent, '停止');
  await act(async () => stopButton()!.click());
  assert.equal(onStopRun.mock.calls.length, 0, '第一次点击不得直接执行');
  assert.equal(stopButton()!.textContent, '确认停止本轮？');

  await act(async () => stopButton()!.click());
  assert.equal(onStopRun.mock.calls.length, 1);
  assert.equal(stopButton()!.textContent, '停止', '执行后回到未确认态');
});

test('停止确认超时自动取消', async () => {
  vi.useFakeTimers();
  try {
    const onStopRun = vi.fn();
    await renderNode(<RunActionBar run={runningRun()} controls={stopControls(onStopRun)} />);

    await act(async () => stopButton()!.click());
    assert.equal(stopButton()!.getAttribute('data-armed'), 'true');
    await act(async () => {
      vi.advanceTimersByTime(5100);
    });
    assert.equal(stopButton()!.textContent, '停止');
    assert.equal(stopButton()!.getAttribute('data-armed'), 'false');
    await act(async () => stopButton()!.click());
    assert.equal(onStopRun.mock.calls.length, 0, '超时后第一下只重新武装');
  } finally {
    vi.useRealTimers();
  }
});

test('停止确认在失焦或指针划走时取消', async () => {
  const onStopRun = vi.fn();
  await renderNode(<RunActionBar run={runningRun()} controls={stopControls(onStopRun)} />);

  await act(async () => stopButton()!.click());
  assert.equal(stopButton()!.getAttribute('data-armed'), 'true');
  await act(async () => {
    stopButton()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  assert.equal(stopButton()!.textContent, '停止');

  await act(async () => stopButton()!.click());
  assert.equal(stopButton()!.getAttribute('data-armed'), 'true');
  await act(async () => {
    stopButton()!.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
    );
  });
  assert.equal(stopButton()!.textContent, '停止');
  assert.equal(onStopRun.mock.calls.length, 0);
});
