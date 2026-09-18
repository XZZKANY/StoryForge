import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { ChatWindowView } from '../src/components/chat-window/ChatWindowView';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const submit = vi.fn(async () => {});
let root: Root;
let host: HTMLDivElement;
function Harness({
  project = 'D:/book',
  busy = false,
  waiting = false,
}: {
  project?: string | null;
  busy?: boolean;
  waiting?: boolean;
}) {
  const state = useChatWindowState({ projectPath: project, currentFile: null });
  return (
    <ChatWindowView
      state={{
        ...state,
        agentBusy: busy,
        agentRun: waiting
          ? {
              id: 'run',
              sessionId: 'session',
              goal: '等待修改确认',
              status: 'waiting',
              steps: [],
            }
          : null,
      }}
      projectPath={project}
      assistantSessionId={null}
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
      handleSubmit={submit}
      handleComposerSubmit={submit}
      userMessageHistory={[]}
      retryLastFailedRun={() => {}}
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
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => root.render(<Harness {...props} />));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined!;
  submit.mockClear();
});

test('提示填入真实 Composer，保留已有草稿并聚焦，不触发发送', async () => {
  await render();
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      '请保留我的草稿',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="填入审稿提示"]')!.click(),
  );
  expect(input.value).toBe('请保留我的草稿\n\n请审阅当前章节，指出最值得改进的问题，并说明理由。');
  expect(document.activeElement).toBe(input);
  for (const label of ['修订', '起草', '一致性检查']) {
    const previous = input.value;
    await act(async () =>
      host.querySelector<HTMLButtonElement>(`[aria-label="填入${label}提示"]`)!.click(),
    );
    expect(input.value.startsWith(`${previous}\n\n`)).toBe(true);
    expect(input.value.length).toBeGreaterThan(previous.length + 2);
    expect(document.activeElement).toBe(input);
  }
  expect(submit).not.toHaveBeenCalled();
});

test.each([{ project: null }, { busy: true }, { waiting: true }])(
  '无项目、运行中或等待确认时起步操作禁用：%j',
  async (props) => {
    await render(props);
    const buttons = host.querySelectorAll<HTMLButtonElement>('button[aria-label^="填入"]');
    expect(buttons.length).toBe(4);
    for (const button of buttons) {
      expect(button.disabled).toBe(true);
      await act(async () => button.click());
    }
    expect(host.querySelector('textarea')!.value).toBe('');
    expect(submit).not.toHaveBeenCalled();
  },
);
