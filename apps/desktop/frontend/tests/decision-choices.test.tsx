import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

// This fixture owns no persisted chapter checks; the dedicated history tests cover that read.
vi.mock('../src/lib/api/chapter-checks', () => ({
  queryChapterCheckHistory: vi.fn().mockResolvedValue({ entries: [], truncated: false }),
}));
import { ChatWindowView } from '../src/components/chat-window/ChatWindowView';
import { DecisionChoices } from '../src/components/chat-window/DecisionChoices';
import { RunActionBar } from '../src/components/chat-window/panels';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import type { AgentRun, ChapterBrief } from '../src/components/chat-window/types';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

// 作者 10-16：「交出修订时四个地方，不能依次弹出选择框吗，像 Claude Code 一样」「这个居中弹窗好恶心，我不想要」。
// 要作者拍板的事就地在对话底部一次出一件，不弹居中窗口；选项仍交给原来的处理函数。

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
});
function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  return root;
}

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

it('decisions show up inline in Chat, never as a dialog, and reach their original handlers', async () => {
  const approve = vi.fn();
  const accept = vi.fn();
  const reject = vi.fn();
  const confirm = vi.fn();
  const deny = vi.fn();
  const stop = vi.fn();
  const noop = () => {};
  function Harness({
    mode,
    busy = false,
  }: {
    mode: 'running' | 'permission' | 'patch' | 'brief';
    busy?: boolean;
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
          agentBusy: busy,
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
                      : mode === 'patch'
                        ? [
                            {
                              id: 'approval',
                              title: '等待作者确认',
                              status: 'waiting',
                              tool: 'author.approval',
                              detail: '',
                              filePath: 'D:/book/正文/第005章.md',
                              patchId: 'patch-1',
                            },
                          ]
                        : [],
                },
        }}
        projectPath="D:/book"
        assistantSessionId={1}
        layoutMode="balanced"
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
        agentRunControls={{
          onApprovePermission: approve,
          onDenyPermission: deny,
          onPauseRun: noop,
          onResumeRun: noop,
          onStopRun: stop,
          onAcceptPatch: accept,
          onRejectPatch: reject,
          onConfirmChapterBrief: confirm,
        }}
      />
    );
  }
  const r = mount();
  const render = (mode: Parameters<typeof Harness>[0]['mode'], busy = false) =>
    r.render(<Harness mode={mode} busy={busy} />);
  const noDialog = () => {
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[data-modal-backdrop]')).toBeNull();
    expect(host.querySelector('[aria-label="对话消息"]')?.textContent).toContain('原始聊天');
  };

  await act(async () => render('running'));
  noDialog();
  expect(host.querySelector('[data-testid="decision-choices"]')).toBeNull();

  await act(async () => render('permission'));
  noDialog();
  const permission = host.querySelector('[data-testid="decision-choices"]')!;
  expect(permission.textContent).toContain('允许 AI 执行这一步吗');
  expect(permission.textContent).toContain('本次工具请求');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="run-approve-permission"]')!.click(),
  );
  expect(approve).toHaveBeenCalledTimes(1);
  expect(deny).not.toHaveBeenCalled();

  await act(async () => render('patch'));
  noDialog();
  const patch = host.querySelector('[data-testid="decision-choices"]')!;
  expect(patch.textContent).toContain('第005章.md');
  // 确认补丁时不给停止：停了会把这轮标成失败，补丁却还挂在编辑器里。
  expect(host.querySelector('[data-testid="run-stop"]')).toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="run-accept-patch"]')!.click(),
  );
  expect(accept).toHaveBeenCalledTimes(1);

  await act(async () => render('brief'));
  noDialog();
  const goal = host.querySelector<HTMLTextAreaElement>('[data-testid="chapter-brief-goal"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      goal,
      '作者调整后的目标',
    );
    goal.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="chapter-brief-confirm"]')!.click(),
  );
  expect(confirm).toHaveBeenCalledWith({ ...brief, goal: '作者调整后的目标' });
  // 章纲待确认时后端不认「拒绝」；取消要真的停掉这一轮。
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="chapter-brief-cancel"]')!.click(),
  );
  expect(stop).toHaveBeenCalledTimes(1);
  expect(deny).not.toHaveBeenCalled();
  // 点了开始起草、结果还没回来：两个按钮都点不了。
  await act(async () => render('brief', true));
  const drafting = host.querySelector<HTMLButtonElement>('[data-testid="chapter-brief-confirm"]')!;
  expect(drafting.textContent).toBe('起草中…');
  expect(drafting.disabled).toBe(true);
  expect(
    host.querySelector<HTMLButtonElement>('[data-testid="chapter-brief-cancel"]')!.disabled,
  ).toBe(true);
  noDialog();
});

function Choices({
  decision,
  onTypeAhead,
  picks,
}: {
  decision: string;
  onTypeAhead?: () => void;
  picks: string[];
}) {
  return (
    <>
      <DecisionChoices
        key={decision}
        title={`决定 ${decision}`}
        onTypeAhead={onTypeAhead}
        choices={[
          { label: '接受', testid: 'pick-1', onSelect: () => picks.push(`${decision}:接受`) },
          { label: '拒绝', testid: 'pick-2', onSelect: () => picks.push(`${decision}:拒绝`) },
          {
            label: '拒绝，并说明',
            testid: 'pick-3',
            needsText: { placeholder: '说说', submitLabel: '发出', inputTestid: 'pick-3-input' },
            onSelect: (text) => picks.push(`${decision}:说明:${text}`),
          },
        ]}
      />
      <div data-testid="composer-surface">
        <textarea aria-label="输入框" />
      </div>
    </>
  );
}
const key = (target: Element, init: KeyboardEventInit) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });

it('keyboard works like Claude Code: arrows move, digits pick, typing goes back to the composer', async () => {
  const picks: string[] = [];
  const typeAhead = vi.fn();
  const r = mount();
  await act(async () => r.render(<Choices decision="a" onTypeAhead={typeAhead} picks={picks} />));
  const first = host.querySelector<HTMLButtonElement>('[data-testid="pick-1"]')!;
  const second = host.querySelector<HTMLButtonElement>('[data-testid="pick-2"]')!;
  await act(async () => first.focus());
  await key(first, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(second);
  expect(second.getAttribute('data-active')).toBe('true');
  await key(second, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(first);
  await key(first, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(host.querySelector('[data-testid="pick-3"]'));
  // 组字中的键不算。
  await key(first, { key: '1', isComposing: true });
  expect(picks).toEqual([]);
  await key(first, { key: '2' });
  expect(picks).toEqual(['a:拒绝']);
  await key(first, { key: 'h' });
  expect(typeAhead).toHaveBeenCalledTimes(1);
  expect(picks).toEqual(['a:拒绝']);
  // 要写一句话的选项：数字选中后出输入框，回车发出、Esc 回到选项。
  await key(first, { key: '3' });
  const input = host.querySelector<HTMLInputElement>('[data-testid="pick-3-input"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      '换个结尾',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await key(input, { key: 'Enter' });
  expect(picks).toEqual(['a:拒绝', 'a:说明:换个结尾']);
});

// 输入框一直在，选择框后出现：模拟作者发完话在等、或者正写着下一句。
function Stage({ decision, draft }: { decision: string | null; draft: string }) {
  const picks: string[] = [];
  return (
    <>
      {decision && (
        <DecisionChoices
          key={decision}
          title={`决定 ${decision}`}
          choices={[
            { label: '接受', testid: 'pick-1', onSelect: () => picks.push('接受') },
            { label: '拒绝', testid: 'pick-2', onSelect: () => picks.push('拒绝') },
          ]}
        />
      )}
      <div data-testid="composer-surface">
        <textarea aria-label="草稿" defaultValue={draft} />
      </div>
    </>
  );
}

it('focus moves to the choices only when the composer is empty', async () => {
  const r = mount();
  await act(async () => r.render(<Stage decision={null} draft="" />));
  const composer = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => composer.focus());
  await act(async () => r.render(<Stage decision="a" draft="" />));
  expect(document.activeElement).toBe(host.querySelector('[data-testid="pick-1"]'));
  // 下一件事出来时重新从第一项开始，不沿用上一件的高亮。
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="pick-2"]')!.focus());
  expect(host.querySelector('[data-testid="pick-2"]')?.getAttribute('data-active')).toBe('true');
  await act(async () => r.render(<Stage decision="b" draft="" />));
  expect(host.querySelector('[data-testid="pick-1"]')?.getAttribute('data-active')).toBe('true');
  expect(host.querySelector('[data-testid="pick-2"]')?.getAttribute('data-active')).toBe('false');
});

it('a half-written message keeps the focus where the author is typing', async () => {
  const r = mount();
  await act(async () => r.render(<Stage decision={null} draft="我还在写" />));
  const composer = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => composer.focus());
  await act(async () => r.render(<Stage decision="a" draft="我还在写" />));
  expect(document.activeElement).toBe(composer);
});

it('the next patch in the same run is a fresh decision, starting from the first choice', async () => {
  const r = mount();
  const noop = () => {};
  const controls = {
    onApprovePermission: noop,
    onDenyPermission: noop,
    onPauseRun: noop,
    onResumeRun: noop,
    onStopRun: noop,
    onAcceptPatch: noop,
    onRejectPatch: noop,
  };
  const runFor = (patchId: string): AgentRun => ({
    id: 'run',
    sessionId: 'session',
    goal: '改结尾',
    status: 'waiting',
    steps: [
      {
        id: 'approval',
        title: '等待作者确认',
        tool: 'author.approval',
        status: 'waiting',
        detail: '',
        filePath: 'D:/book/正文/第005章.md',
        patchId,
      },
    ],
  });
  await act(async () => r.render(<RunActionBar run={runFor('p1')} controls={controls} />));
  const reject = () => host.querySelector('[data-testid="run-reject-patch"]')!;
  const accept = () => host.querySelector('[data-testid="run-accept-patch"]')!;
  await act(async () => (reject() as HTMLButtonElement).focus());
  expect(reject().getAttribute('data-active')).toBe('true');
  await act(async () => r.render(<RunActionBar run={runFor('p2')} controls={controls} />));
  expect(accept().getAttribute('data-active')).toBe('true');
  expect(reject().getAttribute('data-active')).toBe('false');
});
