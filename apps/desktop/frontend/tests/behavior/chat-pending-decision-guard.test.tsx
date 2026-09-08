import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, test } from 'vitest';

import { ChatWindowView } from '../../src/components/chat-window/ChatWindowView';
import type { ChatWindowState } from '../../src/components/chat-window/useChatWindowState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let submitCalls = 0;
let newSessions = 0;
let selectedSessions: number[] = [];
let confirmNavigation: () => Promise<boolean> = async () => true;

function state(status: 'waiting' | 'completed'): ChatWindowState {
  return {
    selfPersistedSessionIdRef: { current: null },
    conversationTitle: '测试会话',
    assistantSessions: [
      { id: 7, title: '当前会话', updated_at: '2026-09-08' },
      { id: 8, title: '另一个会话', updated_at: '2026-09-08' },
    ],
    sessionLoadError: null,
    messages: [],
    projectName: '测试项目',
    contextRef: '正文/第01章.md',
    agentRun: {
      id: 'run-1',
      sessionId: 'run-1',
      goal: '改稿',
      status,
      steps: [
        {
          id: 'approval',
          title: '等待作者确认',
          tool: 'author.approval',
          status: status === 'waiting' ? 'waiting' : 'completed',
          detail: '',
          filePath: 'D:/book/正文/第01章.md',
          patchId: 'patch-1',
        },
      ],
    },
    agentRunRecovery: null,
    writingRunProjection: null,
    explicitContextPaths: [],
    contextCandidates: [],
    contextCandidatesLoading: false,
    contextCandidatesError: null,
    contextPickerOpen: false,
    lastContextBundle: null,
    missingContextPaths: [],
    chapterBrief: null,
    retryRequest: null,
    agentBusy: false,
    input: '继续下一轮',
    setInput: () => undefined,
  } as unknown as ChatWindowState;
}

const controls = {
  onApprovePermission: () => undefined,
  onDenyPermission: () => undefined,
  onPauseRun: () => undefined,
  onResumeRun: () => undefined,
  onStopRun: () => undefined,
  onAcceptPatch: () => undefined,
  onRejectPatch: () => undefined,
};

function render(
  status: 'waiting' | 'completed',
  composer?: {
    project: string;
    session: number | null;
    persisted?: number;
    value: string;
    onChange: (value: string) => void;
  },
) {
  root.render(
    <ChatWindowView
      state={
        composer
          ? {
              ...state(status),
              input: composer.value,
              setInput: composer.onChange,
              selfPersistedSessionIdRef: { current: composer.persisted ?? null },
            }
          : state(status)
      }
      projectPath={composer?.project ?? 'D:/book'}
      assistantSessionId={composer ? composer.session : 7}
      layoutMode="balanced"
      onSetLayoutMode={() => undefined}
      onOpenObservatory={() => undefined}
      observatoryAttention={false}
      agentPermissionProfile="ask"
      onAgentPermissionProfileChange={() => undefined}
      handleSelectSession={(id) => {
        selectedSessions.push(id);
      }}
      confirmDiscardInput={() => confirmNavigation()}
      handleNewSession={() => {
        newSessions += 1;
      }}
      retryAssistantSessionLoad={() => undefined}
      retryContextCandidates={() => undefined}
      addExplicitContext={() => undefined}
      togglePinnedContext={() => undefined}
      handleSubmit={async () => {
        submitCalls += 1;
      }}
      handleComposerSubmit={async () => undefined}
      userMessageHistory={composer ? ['历史消息'] : []}
      retryLastFailedRun={() => undefined}
      agentRunControls={controls}
    />,
  );
}

beforeEach(() => {
  newSessions = 0;
  selectedSessions = [];
  confirmNavigation = async () => true;
  submitCalls = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test('待确认补丁存在时 Composer 不能静默启动新一轮', async () => {
  await act(async () => render('waiting'));
  const submit = container.querySelector('[data-testid="composer-submit"]') as HTMLButtonElement;
  assert.ok(submit);

  await act(async () => submit.click());
  assert.equal(submitCalls, 0);

  await act(async () => render('completed'));
  await act(async () => {
    (container.querySelector('[data-testid="composer-submit"]') as HTMLButtonElement).click();
  });
  assert.equal(submitCalls, 1);
});

for (const destination of [
  { project: 'D:/book', session: 8 },
  { project: 'D:/book', session: null },
  { project: 'D:/other-book', session: 7 },
]) {
  test(`切换 Composer 归属不复活旧历史草稿：${JSON.stringify(destination)}`, () => {
    let scope = { project: 'D:/book', session: 7 as number | null };
    let value = '旧会话未发送草稿';
    const redraw = () =>
      render('completed', {
        ...scope,
        value,
        onChange: (next) => {
          value = next;
          redraw();
        },
      });
    act(redraw);
    const oldInput = container.querySelector('textarea')!;
    oldInput.setSelectionRange(0, 0);
    act(() => {
      oldInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    assert.equal(value, '历史消息');
    scope = destination;
    value = '新会话草稿';
    act(redraw);
    const input = container.querySelector('textarea')!;
    input.setSelectionRange(value.length, value.length);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    assert.equal(value, '新会话草稿');
    assert.equal(input.value, '新会话草稿');
  });
}

test('同一会话重渲染保留输入节点与历史草稿恢复', () => {
  let value = '当前草稿';
  const redraw = () =>
    render('completed', {
      project: 'D:/book',
      session: 7,
      value,
      onChange: (next) => {
        value = next;
        redraw();
      },
    });
  act(redraw);
  const input = container.querySelector('textarea')!;
  input.setSelectionRange(0, 0);
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  });
  act(redraw);
  assert.equal(container.querySelector('textarea') === input, true);
  input.setSelectionRange(value.length, value.length);
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  assert.equal(value, '当前草稿');
});

test('当前草稿首次持久化获得 ID 时保留 Composer 节点和焦点', () => {
  const props = {
    project: 'D:/book',
    session: null as number | null,
    value: '下一轮草稿',
    onChange: () => undefined,
  };
  act(() => render('completed', props));
  const input = container.querySelector('textarea')!;
  input.focus();
  act(() => render('completed', { ...props, session: 9, persisted: 9 }));
  assert.equal(container.querySelector('textarea') === input, true);
  assert.equal(document.activeElement === input, true);
});

test('草稿态显式新建会话也清空内部历史缓存', async () => {
  let value = '旧草稿';
  const redraw = () =>
    render('completed', {
      project: 'D:/book',
      session: null,
      value,
      onChange: (next) => {
        value = next;
        redraw();
      },
    });
  act(redraw);
  const input = container.querySelector('textarea')!;
  input.setSelectionRange(0, 0);
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="新建会话"]')!.click();
  });
  value = '新的草稿';
  act(redraw);
  const next = container.querySelector('textarea')!;
  next.setSelectionRange(value.length, value.length);
  act(() => {
    next.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  assert.equal(value, '新的草稿');
});

test('新建会话取消时保留草稿，不执行 reset', async () => {
  confirmNavigation = async () => false;
  act(() => render('completed'));
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[aria-label="新建会话"]')!.click();
  });
  assert.equal(newSessions, 0);
});
test('重复新建只确认一次，确认晚回不得作用于新项目草稿', async () => {
  let confirmCalls = 0;
  let resolve!: (value: boolean) => void;
  confirmNavigation = () => {
    confirmCalls += 1;
    return new Promise((done) => {
      resolve = done;
    });
  };
  act(() => render('completed'));
  act(() => {
    const button = container.querySelector<HTMLButtonElement>('[aria-label="新建会话"]')!;
    button.click();
    button.click();
  });
  assert.equal(confirmCalls, 1);
  assert.equal(newSessions, 0);
  act(() =>
    render('completed', {
      project: 'D:/other',
      session: null,
      value: '新草稿',
      onChange: () => undefined,
    }),
  );
  await act(async () => resolve(true));
  assert.equal(newSessions, 0);
});

test('切换会话取消不导航，确认后才切换', async () => {
  confirmNavigation = async () => false;
  act(() => render('completed'));
  const selectOther = () => {
    container
      .querySelector<HTMLButtonElement>('[data-testid="conversation-session-switch"]')!
      .click();
  };
  act(selectOther);
  await act(async () => {
    const other = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
      (button) => button.textContent?.includes('另一个会话'),
    )!;
    other.click();
  });
  assert.deepEqual(selectedSessions, []);
  confirmNavigation = async () => true;
  act(selectOther);
  await act(async () => {
    const other = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find(
      (button) => button.textContent?.includes('另一个会话'),
    )!;
    other.click();
  });
  assert.deepEqual(selectedSessions, [8]);
});
