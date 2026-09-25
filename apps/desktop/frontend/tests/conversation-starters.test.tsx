import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { ChatWindowView } from '../src/components/chat-window/ChatWindowView';
import { useChatWindowState } from '../src/components/chat-window/useChatWindowState';
import type { ContextBundle, SemanticFile } from '../src/lib/project-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const submit = vi.fn(async () => {});
const retryContext = vi.fn();
let root: Root | undefined;
let host: HTMLDivElement;
const candidates: SemanticFile[] = ['规则', '人物', '伏笔', '地理'].map((name) => ({
  name: `${name}.md`,
  path: `D:/book/资料/${name}.md`,
  relativePath: `资料/${name}.md`,
  kind: 'knowledge',
  size: 100,
  modified: 1,
}));
const bundle: ContextBundle = {
  projectRoot: 'D:/book',
  currentFile: null,
  files: [
    {
      path: 'D:/book/资料/规则.md',
      relativePath: '资料/规则.md',
      kind: 'knowledge',
      title: '规则',
      excerpt: '规则内容',
    },
  ],
  summary: {
    hasStoryStructure: false,
    counts: {
      outline: 0,
      character: 0,
      setting: 0,
      timeline: 0,
      foreshadowing: 0,
      knowledge: 1,
      draft: 0,
      quality: 0,
      export: 0,
      other: 0,
    },
  },
  budget: {
    fileCount: 1,
    charCount: 4,
    maxFiles: 8,
    maxExcerptChars: 2000,
    truncated: false,
    pinnedFileCount: 1,
    missingPinnedFiles: [],
  },
};
function Harness({
  project = 'D:/book',
  busy = false,
  waiting = false,
  currentFile = null,
  missing = [],
  contextError = null,
  contextLoading = false,
  lastBundle = null,
  withMessages = false,
}: {
  project?: string | null;
  busy?: boolean;
  waiting?: boolean;
  currentFile?: string | null;
  missing?: string[];
  contextError?: string | null;
  contextLoading?: boolean;
  lastBundle?: ContextBundle | null;
  withMessages?: boolean;
}) {
  const state = useChatWindowState({ projectPath: project, currentFile });
  return (
    <ChatWindowView
      state={{
        ...state,
        agentBusy: busy,
        contextCandidates: candidates,
        contextCandidatesLoading: contextLoading,
        contextCandidatesError: contextError,
        missingContextPaths: missing,
        lastContextBundle: lastBundle,
        messages: withMessages ? [{ role: 'assistant', content: '已有回复' }] : [],
        agentRun: waiting
          ? { id: 'run', sessionId: 'session', goal: '等待修改确认', status: 'waiting', steps: [] }
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
      retryContextCandidates={retryContext}
      addExplicitContext={() => state.setContextPickerOpen((open) => !open)}
      togglePinnedContext={(path) =>
        state.setExplicitContextPaths((paths) =>
          paths.includes(path) ? paths.filter((entry) => entry !== path) : [...paths, path],
        )
      }
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
  await act(async () => root!.render(<Harness {...props} />));
}
async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button, selector).not.toBeNull();
  await act(async () => button!.click());
}
async function draft(value: string) {
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  submit.mockClear();
  retryContext.mockClear();
});

test.each([{ project: 'D:/book' }, { project: null }, { busy: true }, { waiting: true }])(
  '默认会话没有起步推荐、标题或空参考卡：%j',
  async (props) => {
    await render(props);
    expect(host.querySelector('[data-testid="context-summary"]')).toBeNull();
    expect(host.querySelectorAll('button[aria-label^="填入"]').length).toBe(0);
    expect(host.querySelector('[data-testid="conversation-empty"]')).toBeNull();
    expect(host.textContent).not.toMatch(
      /选择一项填入|从一个想法开始|项目级创作会话|参考上下文|上下文尚未生成|未选择文件|本轮还没有|当前文件/,
    );
    expect(host.querySelector('textarea')!.disabled).toBe(props.project === null);
    if ('waiting' in props)
      expect(host.querySelector('[data-testid="run-action-bar"]')).not.toBeNull();
    expect(submit).not.toHaveBeenCalled();
  },
);

test('上下文只按需展开在消息滚动区外，添加和取消引用不改写草稿或重建输入框', async () => {
  await render({ withMessages: true });
  const input = await draft('请保留我的草稿');
  const messageList = host.querySelector('[data-testid="message-list-scroll"]')!;
  const opener = host.querySelector<HTMLButtonElement>('[aria-label="添加上下文"]')!;
  expect(opener).not.toBeNull();
  expect(opener.getAttribute('aria-expanded')).toBe('false');
  await click('[aria-label="添加上下文"]');
  const context = host.querySelector('[data-testid="context-summary"]')!;
  expect(context).not.toBeNull();
  expect(messageList.contains(context)).toBe(false);
  expect(opener.getAttribute('aria-expanded')).toBe('true');
  expect(context.textContent).not.toMatch(/上下文尚未生成|未选择文件|本轮还没有/);
  await click('[data-context-path="资料/规则.md"]');
  expect(host.querySelector('[aria-label="取消固定参考：资料/规则.md"]')).not.toBeNull();
  await click('[aria-label="添加上下文"]');
  expect(host.querySelector('[data-testid="context-summary"]')).toBeNull();
  await click('[aria-label="取消固定参考：资料/规则.md"]');
  expect(host.querySelector('[aria-label="取消固定参考：资料/规则.md"]')).toBeNull();
  expect(host.querySelector('textarea')).toBe(input);
  expect(input.value).toBe('请保留我的草稿');
  expect(submit).not.toHaveBeenCalled();
});

test('真实当前文件可固定，未固定前不额外展示参考卡', async () => {
  await render({ currentFile: 'D:/book/正文/第一章.md' });
  expect(host.querySelector('[data-testid="context-summary"]')).toBeNull();
  await click('button[title="正文/第一章.md · 点击固定为参考"]');
  expect(host.querySelector('[aria-label="取消固定参考：正文/第一章.md"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="context-summary"]')).toBeNull();
});

test('收纳引用的 +N 是可操作入口，能查看并取消第四项完整路径', async () => {
  await render();
  await click('[aria-label="添加上下文"]');
  for (const file of candidates) await click(`[data-context-path="${file.relativePath}"]`);
  await click('[aria-label="添加上下文"]');
  await click('button[aria-label="查看全部 4 个固定参考"]');
  const remove = host.querySelector<HTMLButtonElement>(
    '[data-testid="pinned-context-list"] button[aria-label="取消固定参考：资料/地理.md"]',
  );
  expect(remove).not.toBeNull();
  await act(async () => remove!.click());
  expect(host.querySelector('button[aria-label="查看全部 4 个固定参考"]')).toBeNull();
  expect(host.querySelector('[data-testid="pinned-context-list"]')!.textContent).not.toContain(
    '资料/地理.md',
  );
});

test('真实上下文预算与文件可按需查看，默认不挂空参考卡', async () => {
  await render({ lastBundle: bundle });
  expect(host.querySelector('[data-testid="context-summary"]')).toBeNull();
  await click('[aria-label="添加上下文"]');
  expect(host.querySelector('[data-testid="context-summary"]')!.textContent).toContain(
    '上下文 1/8 文件',
  );
  expect(host.querySelector('[data-testid="context-summary"]')!.textContent).toContain(
    '资料/规则.md',
  );
});

test('未打开参考选择时仍显示缺失和截断警告', async () => {
  await render({
    missing: ['资料/已删除.md'],
    lastBundle: { ...bundle, budget: { ...bundle.budget, truncated: true } },
  });
  expect(host.querySelector('[data-testid="missing-context-warning"]')!.textContent).toContain(
    '资料/已删除.md',
  );
  expect(host.querySelector('[data-testid="context-truncated-badge"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="context-picker"]')).toBeNull();
  expect(host.textContent).not.toMatch(/上下文尚未生成|未选择文件/);
});

test('未打开参考选择也不隐藏读取错误，重试入口仍调用原回调', async () => {
  await render({ contextError: '上下文索引读取失败：目录不可读' });
  expect(host.querySelector('[data-testid="context-candidates-error"]')!.textContent).toContain(
    '目录不可读',
  );
  expect(host.querySelector('[data-testid="context-picker"]')).toBeNull();
  await click('[data-testid="context-candidates-retry"]');
  expect(retryContext).toHaveBeenCalledOnce();
});

test('后台索引加载不制造空态，主动打开后才展示真实读取状态', async () => {
  await render({ contextLoading: true });
  expect(host.querySelector('[data-testid="context-summary"]')).toBeNull();
  await click('[aria-label="添加上下文"]');
  expect(host.querySelector('[data-testid="context-candidates-loading"]')).not.toBeNull();
  expect(host.textContent).not.toContain('当前项目还没有可选');
});

test('完成按需上下文选择后回到原输入框，保留草稿', async () => {
  await render();
  const input = await draft('继续写我的草稿');
  await click('[aria-label="添加上下文"]');
  const done = host.querySelector<HTMLButtonElement>('[data-testid="context-picker-toggle"]')!;
  done.focus();
  await act(async () => done.click());
  expect(host.querySelector('[data-testid="context-summary"]')).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('继续写我的草稿');
  expect(submit).not.toHaveBeenCalled();
});
