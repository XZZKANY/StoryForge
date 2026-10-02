import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AgentDecisionPrompt } from '../src/components/chat-window/AgentDecisionPrompt';
import { ChatWindowView } from '../src/components/chat-window/ChatWindowView';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import type { ChapterBrief } from '../src/components/chat-window/types';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('real ChatWindowView leaves messages/progress in Chat and sends permission/patch/brief choices to their original handlers', async () => {
  const approve = vi.fn();
  const accept = vi.fn();
  const confirm = vi.fn();
  const noop = () => {};
  const brief: ChapterBrief = {
    briefId: 'brief',
    revision: 1,
    targetPath: 'chapter.md',
    chapterOrdinal: 1,
    chapterTitle: null,
    goal: '原始目标',
    pov: null,
    setting: null,
    requiredBeats: [],
    forbiddenItems: [],
    continuityConstraints: [],
    targetCharsMin: 100,
    targetCharsMax: 200,
  };
  function Harness({
    mode,
    active = true,
  }: {
    mode: 'running' | 'permission' | 'patch' | 'brief';
    active?: boolean;
  }) {
    const state = useChatWindowState({
      projectPath: 'D:/book',
      currentFile: null,
      assistantSessionId: 1,
    });
    return (
      <ChatWindowView
        state={{
          ...state,
          messages: [{ role: 'user', content: '原始聊天' }],
          chapterBrief: mode === 'brief' ? brief : null,
          agentRun:
            mode === 'brief'
              ? null
              : {
                  id: 'run',
                  sessionId: 'session',
                  goal: '原任务',
                  status: mode === 'running' ? 'running' : 'waiting',
                  steps:
                    mode === 'permission'
                      ? [
                          {
                            id: 'permission-required',
                            title: '需要确认执行',
                            status: 'waiting',
                            tool: 'permission.confirm',
                            detail: '本次工具请求',
                          },
                        ]
                      : [],
                },
        }}
        projectPath="D:/book"
        assistantSessionId={1}
        layoutMode="balanced"
        decisionDialogsActive={active}
        onSetLayoutMode={noop}
        onOpenObservatory={noop}
        observatoryAttention={false}
        agentPermissionProfile="ask"
        onAgentPermissionProfileChange={noop}
        handleSelectSession={noop}
        handleNewSession={noop}
        retryAssistantSessionLoad={noop}
        retryContextCandidates={noop}
        addExplicitContext={noop}
        togglePinnedContext={noop}
        handleSubmit={async () => {}}
        handleComposerSubmit={async () => {}}
        userMessageHistory={[]}
        retryLastFailedRun={noop}
        retryWritingRunSubscription={noop}
        agentRunControls={{
          onApprovePermission: approve,
          onDenyPermission: noop,
          onPauseRun: noop,
          onResumeRun: noop,
          onStopRun: noop,
          onAcceptPatch: accept,
          onConfirmChapterBrief: confirm,
        }}
      />
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (mode: Parameters<typeof Harness>[0]['mode'], active = true) =>
    root.render(<Harness mode={mode} active={active} />);
  try {
    await act(async () => render('running'));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="run-action-bar"]')).not.toBeNull();
    await act(async () => render('permission', false));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => render('permission'));
    const permission = host.querySelector('[role="dialog"]')!;
    expect(permission.textContent).toContain('是否允许 Agent');
    expect(permission.textContent).not.toContain('原始聊天');
    expect(approve).not.toHaveBeenCalled();
    await act(async () =>
      permission
        .querySelector<HTMLButtonElement>('[data-testid="run-approve-permission"]')!
        .click(),
    );
    expect(approve).toHaveBeenCalledTimes(1);
    await act(async () => render('patch'));
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[role="dialog"] [data-testid="run-accept-patch"]')!
        .click(),
    );
    expect(accept).toHaveBeenCalledTimes(1);
    await act(async () => render('brief'));
    const goal = host.querySelector<HTMLTextAreaElement>('[data-testid="chapter-brief-goal"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        goal,
        '作者调整后的目标',
      );
      goal.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="agent-decision-defer"]')!.click(),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="agent-decision-open"]')!.click(),
    );
    expect(host.querySelector('[data-testid="chapter-brief-goal"]')).toBe(goal);
    expect(goal.value).toBe('作者调整后的目标');
    const confirmButton = host.querySelector<HTMLButtonElement>(
      '[role="dialog"] [data-testid="chapter-brief-confirm"]',
    )!;
    await act(async () => confirmButton.click());
    expect(confirm).toHaveBeenCalledWith({ ...brief, goal: '作者调整后的目标' });
    expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toContain('原始聊天');
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('only decisions open a modal; defer preserves chat/draft, focus and explicit reopening without an action', async () => {
  const action = vi.fn();
  function Draft() {
    const [value, setValue] = useState('原章纲');
    return (
      <input aria-label="章纲" value={value} onChange={(event) => setValue(event.target.value)} />
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (active = true, decisionKey: string | null = 'run:approve') =>
    root.render(
      <>
        <p data-testid="chat">原始聊天消息</p>
        <AgentDecisionPrompt decisionKey={decisionKey} active={active} title="确认修订">
          <Draft />
          <button onClick={action}>批准</button>
        </AgentDecisionPrompt>
      </>,
    );
  try {
    await act(async () => render());
    const modal = host.querySelector('[role="dialog"]')!;
    expect(modal.textContent).not.toContain('原始聊天消息');
    const later = modal.querySelector<HTMLButtonElement>('[data-testid="agent-decision-defer"]')!;
    expect(document.activeElement).toBe(later); // Enter must not accidentally approve.
    const draft = modal.querySelector<HTMLInputElement>('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        draft,
        '作者修改',
      );
      draft.dispatchEvent(new Event('input', { bubbles: true }));
      later.click();
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="chat"]')?.textContent).toBe('原始聊天消息');
    const reopen = host.querySelector<HTMLButtonElement>('[data-testid="agent-decision-open"]')!;
    expect(document.activeElement).toBe(reopen);
    await act(async () => render()); // A polling rerender is not a new decision.
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => reopen.click());
    expect(host.querySelector('input')).toBe(draft);
    expect(draft.value).toBe('作者修改');
    await act(async () => render(false)); // Hidden Chat must release modal isolation.
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="chat"]')?.hasAttribute('inert')).toBe(false);
    await act(async () => render(true, null)); // Progress/completion is not a decision.
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(action).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it('Escape defers, IME Escape does not; a distinct next decision requires a fresh explicit choice', async () => {
  const action = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (key: string) =>
    root.render(
      <AgentDecisionPrompt decisionKey={key} title="Agent 需要你决定">
        <button onClick={action}>确认</button>
      </AgentDecisionPrompt>,
    );
  try {
    await act(async () => render('run:recover'));
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
      ),
    );
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => render('run:recover'));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => render('run:approve'));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(action).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>('section button')!.click());
    expect(action).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
